"""Modelin canlı dünyasından (`W`) doğrudan, SALT OKUNUR ölçümler (S5). Model içe aktarılmaz; `W` ve `P` (params) çağıran verir.

Kurallar: `W`'ye yazılmaz (defaultdict'lere `[]` ile erişilmez, `.get` kullanılır); okunamayan değer `None`, sayılar sonlu.
Her alanın TANIMI `FIELD_NOTES`'tadır; değerler yuvarlanmaz, birimler modelin birimidir:
oranlar 0-1 kesir, faizler HAFTALIK oran (politika faiziyle aynı birim), endeksler 100 tabanlı.
`MISSING`: kaynağı modelde bulunmayan alanlar ve nedeni. Bu alanlar her pakette `null` kalır (uydurma değer yok).
"""
from __future__ import annotations

import re

import math
from typing import Any, Callable, Mapping

from . import credit

# Alan -> neden. Şu an her alanın modelde bir kaynağı var; ileride kaynağı kaybolan alan buraya nedenle eklenir
# (extract.NULL_FIELDS bu sözlükten türetilir, testle kilitli).
MISSING: dict[str, str] = {}

FIELD_NOTES: dict[str, str] = {
    "price_index": "Sepet fiyat endeksi (100 = başlangıç referans fiyatları); `W.weekly[-1].series.pidx`.",
    "inflation_yoy": "Yıllık fiyat artışı: pidx(t) / pidx(t-52) - 1. Taban hafta açılış dönemini (MINT_OPEN_WEEKS, ilk fiyat sıçraması) "
                     "aşmalıdır: 66. haftadan önce null. Politika kuralının gördüğü (daha kısa pencereli, sınırlı) değer `policy_inflation`'dır.",
    "policy_inflation": "Faiz kuralının o hafta gördüğü yıllıklandırılmış enflasyon (`pol_hist[-1][3]`; 12-13 haftalık pencere x 52/13, "
                        "-1..+1 sınırlı); kural kapalıysa ya da ilk hafta null.",
    "policy_rate": "Politika faizi, haftalık oran (`pol[0]`); kural kapalıysa null. ModelHost.facts() verir.",
    "minted_year": "BİRİKİMLİ (yıllık değil): tavan açıldığından beri kullanılan basım izni (Akçe) = verilen izin eksi kalan izin; yıl başında "
                    "sıfırlanmaz. Ad geriye uyum için kalır, anlamı `minted_total` ile aynıdır. Tavan açılana (13. hafta sonrası) dek null.",
    "minted_total": "Tavan açıldığından beri kullanılan birikimli basım izni (Akçe); `minted_year` ile aynı değer, doğru adıyla. 1e-6 altı 0 sayılır.",
    "mint_cap": "Tavan açıldığından beri verilen kümülatif basım izni (Akçe; `W.mint_allow_tot`); yıl başında sıfırlanmaz. Tavan açılana dek null.",
    "deposit_rate": "Mevduat faizi, haftalık: loncaların 4 haftalık sönümlü mevduat faizinin mevduat ağırlıklı ortalaması; mevduat yoksa null.",
    "bond_rate": "Açıktaki tahvillerin bakiye ağırlıklı haftalık faizi; açık tahvil yoksa null.",
    "lonca_fee_avg": "Açık loncaların komisyon oranı ortalaması (kesir); lonca yoksa null.",
    "royalty_avg": "Ar-Ge kuruluşlarının dışarıya telif oranlarının ortalaması (kesir; yaşayan kuruluşlar); telif yoksa null.",
    "rent_pct": "Kira / çırak ücreti (kesir; şehir ortalaması): kira çarpanıyla yükselir; konut kapalıysa null.",
    "occupancy": "Konut doluluğu, modelin tanımıyla (housing.py): Σ min(kiracı, konut) / Σ konut; 0-1 arası. Konut kapalıysa null.",
    "chain_edges": "Zincir kenarları: istemci kenar kümesini 1. haftadan itibaren paketlerden yeniden kurar (`/weeks`): başlangıç kümesi `/info.world.chain`, "
                   "her `chain.edges` bir sonraki kümedir (`chain.edges_rev` sürüm). Geç katılan istemci `/weeks?from=1` ile okur; sunucu değişmez. Miktar yalnız çekmecede.",
    "tenants_per_house": "Ham kiracı / konut oranı (1'in üstü konut yetersizliği; kira çarpanını süren sinyal). Konut kapalıysa null.",
    "house_index": "Konut fiyat endeksi, modelin rapor tanımıyla: ikinci el fiyatı (kira x ikinci el oranı; şehir ortalaması), İLK ÖLÇÜM (1. hafta) = 100. "
                   "Taban ModelHost.facts'ta tutulur; `world_facts` tek başına açılış kirasına göre ham değeri verir. Konut kapalıysa null.",
    "house_resale_ratio": "İkinci el konut fiyatı / birincil (kira temelli) fiyat; 1 = eşit. İkinci el piyasası (HI_ACT) kapalıysa null.",
    "survival_52": "Oyuncu işletmelerinden (`_oy` kimlikli, Ar-Ge hariç; ölenler dahil) en az 52 hafta önce kurulanlardan 52 hafta yaşayanların ya da hâlâ canlı olanların oranı; pencere boşsa null.",
    "wage_index": "Ücret endeksi (100 = başlangıç; şehir ortalaması).",
    "loan_rate_avg": "Açık firma kredilerinin bakiye ağırlıklı haftalık faizi; kredi yoksa null.",
    "city_cash_weeks": "Şehir kasalarının toplamı / sönümlü haftalık zorunlu gider (model kasa tabanı): kasa kaç haftalık gidere yeter; gider ölçülmüyorsa null.",
    "npc_pool": "Havuzdaki işsiz NPC sayısı (`Σ len(c[\"pool\"])`): iş arayan ama oyuncu olmayan kişiler. Oyuncu işsizliği (`unemployed`) bunları saymaz.",
    "npc_employed": "Bir firmada çalışan NPC sayısı (modelin `series.emp_npc` ölçüsü; ahır ve belediye dahil). npc_pool + npc_employed = işgücündeki NPC sayısı (göç ve ölüm olmadıkça sabit); tek kişi kipinde NPC nüfusudur, hane kipinde bakmakla yükümlü NPC'ler (`npc_dependents`) hariçtir.",
    "npc_broke": "Fiilen çalışmayan NPC'lerin nakitsiz kısmı: nakdi `NPC_MIN_BAL` altında kalan işsiz havuz NPC'si; hane kipinde bakmakla yükümlü NPC'ler ve işgücü dışına çıkmış NPC'ler de sayılır (işi olan NPC sayılmaz): tüketici sayılmaz, hesapta tutulur (haftanın sonundaki bakiyeye göre; modelin döngü içi `npcpov` sayacından ayrı, aynı eşik).",
    "npc_dependents": "Bakmakla yükümlü NPC sayısı: hane kipinde işgücü dışındaki NPC'ler (iş aramaz, işe alınmaz; tüketimi çalışan hane üyesinin ücretinden karşılanır). Tek kişi kipinde 0.",
    "npc_lfp": "NPC işgücüne katılım oranı: işgücündeki NPC / NPC nüfusu (tek kişi kipinde 1; hane kipinde kurulumdaki katılım oranı; işgücü dışına çıkan NPC'ler düşürür).",
    "npc_pool_cash_avg": "Havuzdaki NPC'lerin ortalama nakdi (Akçe, haftanın sonunda); havuz boşsa null.",
    "players_seeking": "İş arayan oyuncu sayısı (`Σ len(c[\"seekers\"])`); `unemployed` ile aynı olgudur (parite testi kilitler).",
    "players_in_ahir": "Ahırda (çıraklık ocağı) çalışan oyuncu sayısı; ahırdaki NPC'ler dahil değildir. Bu kişiler `employed` içinde sayılır.",
    "players_students": "Okulda ya da üniversitede öğrenci oyuncu sayısı (`len(W.student)`); eğitim sektörü kapalıysa null. Öğrenci aynı zamanda çalışan ya da iş arayan olabilir.",
    "unemployment_rate_all": "Toplam işsizlik = (iş arayan oyuncu + havuz NPC) / (çalışan + iş arayan oyuncu + havuz NPC). Payda tüm işgücüdür: firmalarda çalışan herkes (NPC ve ahır dahil) artı işsizler. `unemployment_rate` yalnız oyuncu işsizliğidir: iş arayan oyuncu / (çalışan + iş arayan oyuncu). Havuz ölçülmediyse null.",
    "benefit_paid": "Haftada oyunculara ödenen işsizlik ödeneği (Akçe): şehir ödeneği (`issizlik_odenegi`) + lonca ödeneği (`lonca_issizlik_odenegi`); modelin birikimli akışının haftalık farkı.",
    "benefit_paid_npc": "Haftada havuz NPC'lerine ödenen şehir ödeneği (Akçe, `issizlik_odenegi_npc`); yalnız `NPC_ASGARI` açıkken var, kapalıyken null (böyle bir ödenek yok).",
    "muni_wages": "Haftada belediye işlerinde ödenen ücret (Akçe, `belediye_ucreti` akışının haftalık farkı).",
    "bursary_paid": "Haftada ödenen çıraklık bursu (Akçe): şehir ahır avansı (`ciraklik_bursu`) + lonca bursu (`lonca_ciraklik_bursu`); haftalık fark.",
    "benefit_cut": "Haftada basım izni ve tahvil yetmediği için kısılan işsizlik ödeneği (Akçe; `L.cut[\"issizlik_odenegi\"]` haftalık farkı).",
    "players_total": "Toplam oyuncu sayısı (`Σ len(c[\"players\"])`): başlangıçtaki oyuncular ve sonradan katılanlar; göç toplamı değiştirmez.",
    "players_new": "O hafta katılan yeni oyuncu (`PLAYER_INFLOW` açıkken; kapalıyken 0). Her biri ahırda çırak olarak, başlangıç parası kayıtlı basımla girer.",
    "players_new_total": "Başlangıçtan bu yana katılan yeni oyuncu (birikimli).",
    "ahir_capacity": "Ahırların toplam kapasitesi (kişi): şehir başına ahır sayısı x ahır kapasitesi x şehir.",
    "ahir_fill": "Ahır doluluğu: ahırdaki kişi (oyuncu ve NPC) / ahır kapasitesi. 1'in üstü kapasite aşıldığını gösterir (başlangıçta oyuncu sayısı kapasiteyi aşabilir).",
    "npc_firm_npc": "NPC firmalarında (ahır ve belediye hariç, canlı) çalışan NPC sayısı.",
    "npc_firm_players": "NPC firmalarında (ahır ve belediye hariç, canlı) çalışan oyuncu sayısı: ahırdan ya da iş aramadan geçenler.",
    "hired_player": "O hafta NPC firmalarına işe alınan oyuncu (1. haftanın açılış kadrosu sayılmaz).",
    "hired_npc": "O hafta NPC firmalarına işe alınan NPC (1. haftanın açılış kadrosu sayılmaz).",
    "fired_player": "O hafta NPC firmalarının küçülmesiyle çıkarılan oyuncu (çıkarma sırası `npc_only` iken hep 0).",
    "fired_npc": "O hafta NPC firmalarının küçülmesiyle havuza dönen NPC.",
    "ahir_moves": "O hafta ahırdan ya da belediyeden NPC firmasına geçen oyuncu (işe alım sırasında seçilenler; iş arayanlar dahil değil).",
    "ahir_backfilled": "O hafta boşluk zinciriyle (`AHIR_BACKFILL`) ahıra giren havuz NPC'si.",
    "inflow_blocked": "O hafta toplam kişi sınırı yüzünden katılamayan yeni oyuncu sayısı (sınır sunucuda sabittir).",
    "staff_fill": "Yerleşik (NPC) işletmelerin kadro doluluğu: çalışan / kapasite (ahır ve belediye hariç, canlı işletmeler). 1'e yakınsa kapasite tıkanıyor.",
    "kinds_full": "Kapasitesi dolan tür sayısı: türün canlı işletmelerinde çalışan / kapasite en az 0,95 (tıkanan türler; tür ayrıntısı sektör çekmecesinde).",
    "house_stock": "Toplam konut stoku (tüm şehirler); konut kapalıysa null. Başlangıçta oyuncu sayısı ve kiracı varsayımından kurulur, sonra konut yatırımıyla büyür.",
    "npc_discouraged": "İşgücü dışına çıkmış (cesareti kırılmış) NPC sayısı: uzun süre işsiz kalıp iş aramayı bırakanlar (`c[\"out\"]`); işgücü dışı kuralı kapalıyken 0. İşsiz havuzda sayılmazlar, işsizlik oranına girmezler, nakitleri varsa tüketirler; dönüş kuralıyla havuza geri dönebilirler.",
    "muni_npc": "Belediye işlerinde çalışan NPC sayısı (kamu istihdamı havuza bağlı kuralı açıkken; kapalıyken 0). `npc_employed` içinde de sayılır.",
    "hires": "O hafta NPC firmalarına işe alınan toplam kişi: `hired_player` + `hired_npc` (1. haftanın açılış kadrosu sayılmaz).",
    "separations": "O hafta NPC firmalarından ayrılan toplam kişi: küçülmeyle çıkarılan oyuncu ve NPC (`fired_player` + `fired_npc`) artı kendiliğinden ayrılan NPC (`quits_npc`). Avansını alamayıp ayrılanlar ile belediye ya da kamu işinden havuza dönenler (daralma, iş arayan oyuncunun yerine geçme) dahil değildir.",
    "quits_npc": "O hafta kendiliğinden ayrılıp havuza dönen NPC (haftalık ayrılma olasılığı kuralı açıkken; kapalıyken 0). Küçülmeyle çıkarılanlar `fired_npc`'dedir.",
    "job_finding_rate": "İş bulma oranı: o hafta işsizlikten işe giren kişi (havuz NPC'si ve iş arayan oyuncu; NPC işletmesine, belediyeye ya da kamu işine, ahır sürüsünün tamamlanmasına ve ahırdaki boşluğun doldurulmasına girenler dahil) / işe alım turu başındaki işsiz sayısı (havuz + iş arayan oyuncu); 0-1 arası. Ahırdan ya da belediyeden geçenler işsiz sayılmadığından payda ve paya girmez. İşsiz yoksa null.",
    "unemployment_duration": "Ortalama işsizlik süresi (TAHMİN), hafta: 1 / `job_finding_rate`. Kararlı durumda ortalama bekleme süresinin tahminidir (ölçülen tamamlanmış süre değil); iş bulma oranı 0 ya da ölçülmemişse null. "
                             "Ölçülen süre dağılımı paketin `labour.spells` alanındadır (PLAN-KREDI U19); bu tahminin yerine geçmez.",
    "money_households": "Hanelerin (oyuncu ve NPC) elindeki nakit, Akçe, haftanın sonunda. Banka mevduatı hane sayılmaz: mevduat lonca hesabında durur (`money_lonca`). Altı kesim para stokunun tamamını verir: hane + yerleşik işletme + oyuncu işletmesi + şehir kasası + lonca + diğer.",
    "money_npc_firms": "Yerleşik (NPC) işletmelerin kasaları toplamı, Akçe. Kamu işletmeleri (belediye, ahır) buraya girmez, `money_other`'dadır.",
    "money_player_firms": "Oyuncu işletmelerinin kasaları toplamı, Akçe: sahibi oyuncu olan ve bir loncaya ya da DAO'ya bağlı işletmeler.",
    "money_city": "Şehir kasalarının toplamı, Akçe (`city_cash_total` ile aynı) ve hafta içinde şehir kasasıyla ev sahiplerine boşalan kira emaneti (`emanet<i>`; akış tablosundaki `city` kesimiyle aynı).",
    "money_lonca": "Loncaların hesapları toplamı, Akçe: sermaye (kredi havuzu ve mevduatlar), refah ve rezerv hesapları.",
    "money_other": "Öbür hesaplar, Akçe: kamu işletmeleri (belediye, ahır), işletmelerin yenileme fonları ve vergi havuzları. Para stokundan diğer beş kesim çıkarılınca kalandır.",
    "city_in_tax": "Şehir kasalarına o hafta giren vergiler, Akçe: gelir, satış, kurumlar, temettü stopajı, kira ve işsiz havuzu vergisi.",
    "city_in_profit": "O hafta yerleşik işletmelerden şehir kasalarına süpürülen kâr, Akçe. Kâr hanelere temettü seçilince bu kalem azalır, kâr payı hanelere gider.",
    "city_in_rent": "Şehir kasalarına o hafta giren kiralar, Akçe: sahipsiz konutun kirası ve işletme kiraları.",
    "city_in_mint": "O hafta şehir kasalarının eksiğini kapatmak için basılan para, Akçe (kasa eksiye düşünce yıllık basım iznine göre tamamlanır; basım ve tahvil gelire girmez). Yeni katılan oyunculara verilen başlangıç parası da kayıtlı bir basımdır ama doğrudan oyuncuya gider; buraya girmez. Kredi parası ayrı bir basımdır, buraya da girmez.",
    "city_in_other": "O hafta şehir kasalarına giren öbür kalemler, Akçe (kurucu payı, depo gideri, sermaye fazlası, kuruluş harcı): haftalık toplam girişten vergi, kâr ve kira çıkarılınca kalan. Tahvil ihracı ve şehirler arası denge girişe sayılmaz.",
    "city_out_households": "Şehir kasalarından o hafta hanelere giden para, Akçe: çıraklık bursu, işsizlik ödeneği ve kasa kuralı açıkken hane transferi.",
    "city_out_wages": "Şehir kasalarından o hafta belediye çalışanlarına ödenen ücret, Akçe.",
    "city_out_services": "Şehir kasalarından o hafta kamu hizmeti ve altyapı sözleşmeleri ve yerel hizmet alımı için işletmelere giden para, Akçe.",
    "city_out_firms": "Şehir kasalarından o hafta işletmelere giden sermaye ve destek, Akçe: yerleşik işletmelerin işletme sermayesi, geçiş desteği ve kuruluş fonu aktarımı.",
    "city_out_other": "Şehir kasalarından o hafta çıkan öbür kalemler, Akçe (tahvil faizi ve itfası vb.). Şehirler arası denge çıkışa sayılmaz.",
    "ghost_firms": "Hayalet işletme sayısı: işçisi olmayan ve nakdi bir kişilik işletme sermayesinden az olan yerleşik işletme (kamu altyapısı, ahır ve belediye hariç). Haftanın işe alımından sonra sayılır (ilk haftada henüz sermayesi verilmemiş işletmeler sayılmaz); iş gelince işçi alırlar. Kapanış kuralı kapalıyken sonsuza dek yaşarlar.",
    "ghost_closed": "O hafta hayalet işletme kuralı yüzünden kapanan işletme sayısı (kural kapalıyken 0).",
    "wealth_top10": "Oyuncu servetinde üst %10'un payı, 0-1 (modelin `W.series[\"top10\"]`). Servet = nakit + mevduat + konut + mal [+ hisse]; firma kasası dahil DEĞİL. "
                    "Firma kasasını sahibine sayan sahip serveti paketin `holdings.wealth` bloğundadır.",
    "wealth_top1": "Oyuncu servetinde üst %1'in payı, 0-1 (modelin `W.series[\"top1_w\"]`); servet tanımı `wealth_top10` ile aynı, firma kasası dahil değil.",
    "wealth_median": "Medyan oyuncunun serveti, Akçe (modelin `W.series[\"med_w\"]`); servet tanımı `wealth_top10` ile aynı, firma kasası dahil değil.",
    "income_gini": "Oyuncu gelirinin Gini katsayısı (modelin `W.series[\"gini_inc\"]`): o haftanın gelir türleri (`INCOME_KINDS`), stok değil akış.",
    "income_top10": "Oyuncu gelirinde üst %10'un payı, 0-1 (modelin `W.series[\"top10_inc\"]`): o haftanın gelir türleri.",
    "failed_cum": "Yerleşik işletme iflası, BİRİKİMLİ (modelin `npc_batis_adet` sayacı): zarar edip batan yerleşik işletme. Temerrüt ölümü, oyuncu işletmesi ve Ar-Ge DAO hariç; "
                  "bunlar `failed_npc_default_cum`, `failed_player_cum`, `failed_dao_cum`'dadır. Yeniden açılan işletme sayaçtan düşmez (açılış ayrıca sayılır).",
    "failed_total_cum": "Batan işletme, toplam, BİRİKİMLİ: `failed_cum` + `failed_player_cum` + `failed_dao_cum` + `failed_npc_default_cum` (yerleşik iflas + oyuncu işletmesi + Ar-Ge DAO + temerrüt). "
                        "Dört sayaçtan biri yoksa (eski kayıt) null. Pano 'batan' göstergesi budur; kırılım ipucundadır.",
    "failed_player_cum": "Batan oyuncu işletmesi, BİRİKİMLİ (modelin `batan_oyuncu_firmasi_adet` sayacı): kurucusu ayrılınca ya da kadrosu boşalınca kapanan, sahibi olan işletme (Ar-Ge DAO hariç). "
                         "Kuruluş haftasında kurucunun ayrılmasıyla batanlar dahildir. Ölü `_oy` kimlikli işletme sayısına eşittir.",
    "failed_dao_cum": "Batan Ar-Ge DAO, BİRİKİMLİ (modelin `batan_dao_adet` sayacı): kadrosu boşalıp kapanan DAO işletmesi.",
    "failed_npc_default_cum": "Temerrütle ölen yerleşik işletme, BİRİKİMLİ: kredisini ödeyemeyip batan sahipsiz işletme (`W.npc_log` \"temerrut\" kayıtları). `failed_cum` (iflas) ile toplamından "
                              "yeniden açılanlar çıkınca ölü yerleşik işletme sayısı kalır.",
    "vacancies": "Açık kadro, toplam (PLAN-KREDI T4b): canlı yerleşik ve oyuncu işletmelerinde Σ max(0, hedef kadro - çalışan). Hedef kadro modelin davranışsız kaydından (`W.staff_tgt`, T5) gelir; kayıt yoksa null.",
    "staffless_npc": "İşçisiz canlı yerleşik işletme sayısı (PLAN-KREDI T4b): sahipsiz, `org_owner`sız, ahır ve belediye dışı, kadrosu boş (stok).",
    "wage_fail": "Haftada ücreti ödenemediği için işten çıkan kişi sayısı (PLAN-KREDI T4b; modelin haftalık satırındaki `wage_fail`). Döner kapının en olası nedenidir.",
    "unemp_long_share": "Uzun süreli işsiz payı (PLAN-KREDI T4b): NOT: payda ve pay havuzdaki NPC'leri de içerir (hiç çalışmamış NPC kitlesi payı şişirir); oyuncuya özgü ölçü modelin `kr_uzun_issiz_oyuncu_pay` sütunudur. 26 haftadan uzun süredir iş arayanlar / bütün iş arayanlar (`seekers` + `pool`). Süre ölçülmüştür (host durum farkı); koşu ya da çatallanma öncesi başlayan süreler "
                        "başlangıç haftasından sayılır, yani gerçekte daha uzundur (`labour.spells.censored`).",
    "hires_stable4": "Dört hafta önce işe girip bu hafta hâlâ aynı firmada olan kişi sayısı (PLAN-KREDI T4b; net girişler, dört hafta gecikmeli; ilk haftalarda null). İşe alımın kalıcı kısmıdır.",
    "founders_applied": "Haftada kuruluş kredisi isteyen FARKLI kurucu sayısı (PLAN-KREDI U4). `loans_applied` eski anlamıyla deneme sayısıdır: ret olunca aynı kurucu her lonca turunda yeniden denenir "
                        "(şehir-hafta başına ret ya 0 ya tam lonca sayısıdır). = verilen + reddedilen farklı kurucu. Ret lonca sayısına bölünmüyorsa null.",
    "founders_rejected": "Haftada kuruluş kredisi reddedilen FARKLI kurucu sayısı = `loans_rejected` / lonca sayısı (PLAN-KREDI U4); bölünmüyorsa null. `kurulus_kredisi_yok` tanısı bu alanı kullanır.",
    "liquid_b50": "Likit varlıkta (nakit + mevduat) alt %50 oyuncunun payı, 0-1: (`para_yoksul` + `mev_yoksul`) / toplam; oyuncular nakit + mevduata göre sıralanır (`measure.py` sınıfları). Satırda sütunlar yoksa ya da toplam 0 ise null.",
    "liquid_m40": "Likit varlıkta (nakit + mevduat) orta %40 oyuncunun payı, 0-1: (`para_orta` + `mev_orta`) / toplam. Satırda sütunlar yoksa ya da toplam 0 ise null.",
    "liquid_t10": "Likit varlıkta (nakit + mevduat) üst %10 oyuncunun payı, 0-1: (`para_zengin` + `mev_zengin`) / toplam; üçünün toplamı 1'dir. Satırda sütunlar yoksa ya da toplam 0 ise null.",
    "opening_staff": "Birinci haftada işe alınan NPC sayısı (açılış kadrosu, sabit). Birinci hafta sonunda avansını alamayan işçiler ayrılabilir; sonraki çalışan sayısı `npc_firm_npc`'dir.",
}

_SAFE = (AttributeError, KeyError, IndexError, TypeError, ValueError, ZeroDivisionError, OverflowError)


def finite(x: Any) -> float | None:
    """Sonlu sayı ya da None (bool, NaN, inf ve sayı olmayanlar None)."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    if not math.isfinite(x):
        return None
    return 0.0 if abs(x) < 1e-9 else float(x)                  # kayan nokta artığı (ör. 1e-14) sıfır sayılır


def _safe(fn: Callable[[], Any]) -> float | None:
    try:
        return finite(fn())
    except _SAFE:
        return None


def city_ids(W) -> list[int]:
    return [c["i"] for c in W.cities]


def _weighted_rate(items) -> float | None:
    """Bakiye (`out`) ağırlıklı `rate` ortalaması; bakiye yoksa None."""
    tot = sum(max(0.0, float(i["out"])) for i in items)
    if tot <= 1e-9:
        return None
    return sum(max(0.0, float(i["out"])) * float(i["rate"]) for i in items) / tot


def _mean(vals) -> float | None:
    vals = list(vals)
    return sum(vals) / len(vals) if vals else None


def _price_index(W) -> float | None:
    return W.weekly[-1]["series"]["pidx"] if W.weekly else None


def _inflation(W, P) -> float | None:
    """52 haftalık fiyat artışı; taban haftası açılış döneminin (MINT_OPEN_WEEKS) sonrasında olmalı."""
    if len(W.weekly) < 53:
        return None
    base = W.weekly[-53]
    if base.get("week", W.week_no - 52) <= int(getattr(P, "MINT_OPEN_WEEKS", 13)) or not base["series"]["pidx"]:
        return None
    return W.weekly[-1]["series"]["pidx"] / base["series"]["pidx"] - 1.0


def _policy_inflation(W) -> float | None:
    if not getattr(W, "POL_ON", False) or not W.pol_hist or W.pol_hist[-1][0] != W.week_no:
        return None
    return W.pol_hist[-1][3]


def _mint_cap(W) -> float | None:
    return W.mint_allow_tot if W.L.cap_on else None


def _minted_year(W) -> float | None:
    if not W.L.cap_on:
        return None
    used = W.mint_allow_tot - sum(W.L.allow.values())
    return 0.0 if used < 1e-6 else used


def _deposit_rate(W) -> float | None:
    dt = sum(W.dep_tot.get(lo, 0.0) for lo in W.loncas)
    if dt <= 1e-9:
        return None
    return sum(W.dep_ema.get(lo, 0.0) * W.dep_tot.get(lo, 0.0) for lo in W.loncas) / dt


def _fee_avg(W, P) -> float | None:
    return _mean(W.FEES.get(lo, P.LONCA_FEE) for lo in W.loncas if lo not in W.closed)


def _royalty_avg(W) -> float | None:
    return _mean(r for (n, _b), r in W.xrate.items() if n in W.firms and not W.firms[n].get("dead"))


def _rent_pct(W, P) -> float | None:
    if not P.HOUSE_ON:
        return None
    return _mean(W.RENT_CY[i] / (P.TIER_WAGE[0] * W.WI[i]) for i in city_ids(W))


def _occupancy(W, P) -> float | None:
    """Modelin doluluğu: min(kiracı, konut) toplamı / konut toplamı (şehir başına `min(1, occ/hs)`, konut ağırlıklı)."""
    if not P.HOUSE_ON:
        return None
    hs = sum(W.hs.get(i, 0.0) for i in city_ids(W))
    return sum(min(W.occ.get(i, 0.0), W.hs.get(i, 0.0)) for i in city_ids(W)) / hs if hs > 1e-9 else None


def _tenants_per_house(W, P) -> float | None:
    if not P.HOUSE_ON:
        return None
    hs = sum(W.hs.get(i, 0.0) for i in city_ids(W))
    return sum(W.occ.get(i, 0.0) for i in city_ids(W)) / hs if hs > 1e-9 else None


def _house_index(W, P) -> float | None:
    """Ham konut fiyat endeksi: ikinci el fiyat = birincil fiyat x oran; birincil fiyat kirayla (`RENT_CY`) orantılı. Açılış KİRASINA göre
    100 (şehir ortalaması); modelin rapor tanımındaki "ilk ölçüm = 100" yeniden tabanlaması `ModelHost.facts`'ta yapılır."""
    if not P.HOUSE_ON:
        return None
    base = P.RENT_H * P.TIER_WAGE[0]
    m = _mean(W.RENT_CY[i] * W.hratio.get(i, 1.0) for i in city_ids(W))
    return None if m is None or base <= 0 else 100.0 * m / base


def _house_resale_ratio(W, P) -> float | None:
    if not (P.HOUSE_ON and getattr(P, "HI_ACT", False)):
        return None
    return _mean(W.hratio.get(i, 1.0) for i in city_ids(W))


def _wage_index(W) -> float | None:
    m = _mean(W.WI[i] for i in city_ids(W))
    return None if m is None else 100.0 * m


_OY_KIMLIK = re.compile(r"_oy\d+$")      # oyuncu işletmesi kimliği: `s<şehir>_<tür>_oy<sayı>`


def _survival_52(W) -> float | None:
    """F1: payda `W.firms` içinde `_oy` kimlikli, Ar-Ge olmayan, doğumundan 52 hafta geçmiş tüm oyuncu işletmeleri (canlı ya da ölü: ölen firma `W.player_firms`'ten silinir, `W.firms`'te kalır);
    pay: ömrü (`died - born`) >= 52 olan ya da hâlâ canlı olanlar. Pencere boşsa None."""
    week = W.week_no
    els = [d for f, d in W.firms.items()
           if _OY_KIMLIK.search(f) and d.get("kind") != "arge" and "born" in d and week - d["born"] >= 52]
    if not els:
        return None
    return sum(1 for d in els if d.get("died", 10 ** 9) - d["born"] >= 52) / len(els)


def city_cash_weeks(W) -> list[float | None]:
    """Şehir başına kasa-hafta: şehir kasası / sönümlü haftalık zorunlu gider (`L.mand`; modelin K-211 kasa tabanı `TRANS_FLOOR_WEEKS`
    aynı ölçüyle işler: `L.bal[acct] - TRANS_FLOOR_WEEKS * L.mand[acct]`). Kasa tabanı kuralı kapalıysa (`L.cexp is None`) ya da
    şehrin gideri ölçülmüyorsa (<= 0) o şehir için None. Saf okuma."""
    if getattr(W.L, "cexp", None) is None:
        return [None for _ in W.cities]
    out: list[float | None] = []
    for c in W.cities:
        mand = max(0.0, W.L.mand.get(c["acct"], 0.0))
        out.append(None if mand <= 1e-9 else finite(W.L.bal.get(c["acct"], 0.0) / mand))
    return out


def _cash_weeks(W) -> float | None:
    if getattr(W.L, "cexp", None) is None:
        return None
    mand = sum(max(0.0, W.L.mand.get(c["acct"], 0.0)) for c in W.cities)
    if mand <= 1e-9:
        return None
    return sum(W.L.bal.get(c["acct"], 0.0) for c in W.cities) / mand


LABOR_STOCK = ("x_npc_pool", "x_npc_employed", "x_npc_broke", "x_npc_dependents", "x_npc_lfp", "x_npc_pool_cash_avg", "x_players_seeking", "x_players_in_ahir", "x_players_students")
LABOR_FLOWS = ("benefit_paid", "benefit_paid_npc", "muni_wages", "bursary_paid", "benefit_cut")


def _pool(W) -> list:
    return [q for c in W.cities for q in c["pool"]]


def labor_facts(W, P) -> dict[str, float | int | None]:
    """D5: işsizlik ve NPC havuzu olguları (`x_<alan>`). Her değer modelin kendi durumundan okunur (tanımlar `FIELD_NOTES`); `W`'yi değiştirmez.
    Akış kalemleri (`benefit_paid` vb.) birikimli olduğundan `labor_flow_totals` ile ayrıdır: haftalık farkı `ModelHost.facts` alır."""
    bal = W.L.bal
    pool = _pool(W)
    floor = float(getattr(P, "NPC_MIN_BAL", 1.0))
    people = W.people
    npc_emp = sum(1 for d in W.firms.values() for q in d["workers"] if people[q]["who"] == "npc")
    in_ahir = sum(1 for d in W.firms.values() if d["kind"] == "ahir" for q in d["workers"] if people[q]["who"] == "oyuncu")
    students = len(W.student) if getattr(W, "EDU_ON", False) and getattr(W, "student", None) is not None else None
    cash = [bal.get(q, 0.0) for q in pool]
    deps = [q for c in W.cities for q in c.get("deps", ())]                       # D9 (A2): bakmakla yükümlü NPC (hane kipi; yoksa boş)
    outs = [q for c in W.cities for q in c.get("out", ())]                        # D10 (B7): işgücü dışına çıkmış (cesareti kırılmış) NPC (kural kapalıyken boş)
    f: dict[str, Any] = {
        "x_npc_pool": len(pool),
        "x_npc_employed": npc_emp,
        "x_npc_broke": sum(1 for v in cash if v < floor) + sum(1 for q in deps + outs if bal.get(q, 0.0) < floor),
        "x_npc_dependents": len(deps),
        "x_npc_lfp": finite((len(pool) + npc_emp) / (len(pool) + npc_emp + len(deps) + len(outs))) if (len(pool) + npc_emp) else None,
        "x_npc_pool_cash_avg": finite(sum(cash) / len(cash)) if cash else None,
        "x_players_seeking": sum(len(c["seekers"]) for c in W.cities),
        "x_players_in_ahir": in_ahir,
        "x_players_students": students,
    }
    return f


def labor_flow_totals(W, P) -> dict[str, float | None]:
    """D5: işsizlik ve belediye akışlarının BİRİKİMLİ toplamları (modelin `L.flows` / `L.cut` kalemleri); host haftalık farkı alır.
    `benefit_paid_npc`: NPC güvencesi (`NPC_ASGARI`) kapalıysa null (böyle bir ödenek yok)."""
    fl, cut = W.L.flows, W.L.cut
    g = lambda k: float(fl.get(k, 0.0))
    return {
        "benefit_paid": g("issizlik_odenegi") + g("lonca_issizlik_odenegi"),
        "benefit_paid_npc": g("issizlik_odenegi_npc") if getattr(P, "NPC_ASGARI", False) else None,
        "muni_wages": g("belediye_ucreti"),
        "bursary_paid": g("ciraklik_bursu") + g("lonca_ciraklik_bursu"),
        "benefit_cut": float(cut.get("issizlik_odenegi", 0.0)),
    }


HIRE_STOCK = ("x_players_total", "x_players_new_total", "x_ahir_capacity", "x_ahir_fill", "x_npc_firm_npc", "x_npc_firm_players")
START_STOCK = ("x_staff_fill", "x_kinds_full", "x_house_stock", "x_opening_staff")        # D7: dünya kurulumu göstergeleri
FULL_AT = 0.95                                                                            # tür doluluğu bu orana varınca tıkanmış sayılır
HIRE_FLOWS = ("players_new", "hired_player", "hired_npc", "fired_player", "fired_npc", "ahir_moves", "ahir_backfilled", "inflow_blocked")
_HIRE_SRC = {"players_new": ("yeni_oyuncu",), "hired_player": ("ise_alinan_oyuncu",), "hired_npc": ("ise_alinan_npc",),
             "fired_player": ("isten_cikan_oyuncu",), "fired_npc": ("isten_cikan_npc",), "ahir_moves": ("ahir_gecis", "belediye_gecis"),
             "ahir_backfilled": ("ahir_dolgu_npc",), "inflow_blocked": ("katilim_sinir_engel",)}


def hire_facts(W, P) -> dict[str, float | int | None]:
    """D6: işe alım ve ahır stok olguları (`x_<alan>`); `W`'yi değiştirmez. Haftalık akışlar `hire_flow_totals` ile ayrıdır (host haftalık farkı alır)."""
    people = W.people
    firms = W.firms
    st = getattr(W, "hire_stat", None)
    ahirs = [d for d in firms.values() if d["kind"] == "ahir"]
    cap = sum(d.get("capacity", 0) for d in ahirs)
    inside = sum(len(d["workers"]) for d in ahirs)
    nf_npc = nf_pl = 0
    for d in firms.values():
        if d["owner"] is not None or d["kind"] in ("ahir", "belediye") or d.get("dead"):
            continue
        for q in d["workers"]:
            if people[q]["who"] == "npc":
                nf_npc += 1
            else:
                nf_pl += 1
    return {
        "x_players_total": sum(len(c["players"]) for c in W.cities),
        "x_players_new_total": int(st.get("yeni_oyuncu", 0)) if st is not None else None,
        "x_ahir_capacity": cap,
        "x_ahir_fill": finite(inside / cap) if cap > 0 else None,
        "x_npc_firm_npc": nf_npc,
        "x_npc_firm_players": nf_pl,
    }


def start_facts(W, P) -> dict[str, float | int | None]:
    """D7: dünya kurulumu göstergeleri (`x_<alan>`): kadro doluluğu (toplam ve tıkanan tür sayısı), konut stoku, açılış kadrosu. `W`'yi değiştirmez."""
    firms = W.firms
    st = getattr(W, "hire_stat", None)
    cap_t = work_t = 0
    by_kind: dict[str, list[int]] = {}
    for d in firms.values():
        if d["owner"] is not None or d["kind"] in ("ahir", "belediye") or d.get("dead"):
            continue
        cap = d.get("capacity", 0)
        n = len(d["workers"])
        cap_t += cap
        work_t += n
        a = by_kind.setdefault(d["kind"], [0, 0])
        a[0] += n
        a[1] += cap
    return {
        "x_staff_fill": finite(work_t / cap_t) if cap_t > 0 else None,
        "x_kinds_full": sum(1 for n, c in by_kind.values() if c > 0 and n / c >= FULL_AT),
        "x_house_stock": finite(sum(W.hs.values())) if getattr(P, "HOUSE_ON", False) else None,
        "x_opening_staff": int(st.get("acilis_kadrosu", 0)) if st is not None else None,
    }


MARKET_STOCK = ("x_npc_discouraged", "x_muni_npc")                                        # D10: iş piyasası akışları göstergeleri
MARKET_FLOWS = ("hires", "separations", "quits_npc", "job_finders", "unemployed_start")      # son ikisi yalnız iş bulma oranının payı ve paydası (host oranı hesaplar; dünya alanı değil)
_MARKET_SRC = {"hires": ("ise_alinan_oyuncu", "ise_alinan_npc"), "separations": ("isten_cikan_oyuncu", "isten_cikan_npc", "ayrilan_npc"),
               "quits_npc": ("ayrilan_npc",), "job_finders": ("ise_giren_issiz",), "unemployed_start": ("issiz_haftabasi",)}


def market_facts(W, P) -> dict[str, float | int | None]:
    """D10: iş piyasası akışları stok olguları (`x_<alan>`); `W`'yi değiştirmez."""
    people = W.people
    firms = W.firms
    muni = sum(1 for d in firms.values() if d["kind"] == "belediye" for q in d["workers"] if people[q]["who"] == "npc")
    return {
        "x_npc_discouraged": sum(len(c.get("out", ())) for c in W.cities),
        "x_muni_npc": muni,
    }


def market_flow_totals(W, P) -> dict[str, float | None]:
    """D10: işe alım, ayrılma ve iş bulma sayaçlarının BİRİKİMLİ toplamları (`W.hire_stat`); host haftalık farkı alır. Sayaç yoksa (eski model) null."""
    st = getattr(W, "hire_stat", None)
    if st is None:
        return {k: None for k in MARKET_FLOWS}
    return {k: float(sum(st.get(n, 0.0) for n in src)) for k, src in _MARKET_SRC.items()}


MONEY_STOCK = ("x_money_households", "x_money_npc_firms", "x_money_player_firms", "x_money_city", "x_money_lonca", "x_money_other")      # D11: para dağılımı
CITY_FLOWS = ("city_in_tax", "city_in_profit", "city_in_rent", "city_in_mint",
              "city_out_households", "city_out_wages", "city_out_services", "city_out_firms", "city_out_other")                 # D11: şehir gelir-gider kalemleri (birikimli toplam)
_CITY_IN = {"city_in_tax": ("gelir_vergisi", "satis_vergisi", "kurumlar_vergisi", "temettu_vergisi", "kira_vergisi", "npc_havuz_vergisi"),
            "city_in_profit": ("npc_kar",), "city_in_rent": ("konut_kirasi_sehir", "kira")}
_CITY_OUT = {"city_out_households": ("ciraklik_bursu", "issizlik_odenegi", "kamu_transferi"), "city_out_wages": ("belediye_ucreti",),
             "city_out_services": ("kamu_hizmet_sozlesmesi", "kamu_hizmet_alimi", "altyapi_hizmet_sozlesmesi", "kamu_hizmet_destegi"),
             "city_out_firms": ("npc_kurulus_sermayesi", "kamu_destek_fonu", "kurulus_fonu_fonlama")}
_CITY_OUT_SKIP = ("sehirler_arasi_denge",)                                                 # şehirden şehre: ne gelir ne gider
GHOST_FLOWS = ("ghost_firms", "ghost_closed")
_GHOST_SRC = {"ghost_firms": ("hayalet_firma",), "ghost_closed": ("hayalet_kapanan",)}


def money_facts(W, P) -> dict[str, float | None]:
    """D11: para stokunun kesimlere dağılımı (`x_money_*`); modelin ölçüm satırındaki `para_*` sütunlarıyla aynı sınıflama (`measure.py`), toplamı `Σ L.bal`.
    Hane: oyuncu + NPC nakdi; yerleşik işletme: sahibi olmayan, belediye/ahır dışı; oyuncu işletmesi: sahibi (ya da lonca/DAO'su) olan; kasa: şehir hesapları;
    lonca: `<lonca>_sermaye/_refah/_rezerv` ve lonca önekli hesaplar; diğer: kalan. Kira emaneti (`emanet<i>`) akış kancasıyla aynı biçimde şehirdir. `W`'yi değiştirmez."""
    people, firms = W.people, W.firms
    cacc = {c["acct"] for c in W.cities}
    loncas = set(getattr(W, "loncas", ()) or ())
    seg = {"hh": 0.0, "npc": 0.0, "ply": 0.0, "city": 0.0, "lonca": 0.0, "other": 0.0}
    for k, v in W.L.bal.items():
        if k in people:
            seg["hh"] += v
        elif k in firms:
            d = firms[k]
            if d.get("owner") is not None or d.get("org_owner"):
                seg["ply"] += v
            elif d["kind"] in ("belediye", "ahir"):
                seg["other"] += v
            else:
                seg["npc"] += v
        elif k in cacc or k.startswith("emanet"):               # `emanet<i>` (kira emaneti) akış kancasıyla (`flowhook._classify`) aynı: şehir
            seg["city"] += v
        elif k.rsplit("_", 1)[-1] in ("sermaye", "refah", "rezerv") or k.split("_")[0] in loncas:
            seg["lonca"] += v
        else:
            seg["other"] += v
    return {"x_money_households": seg["hh"], "x_money_npc_firms": seg["npc"], "x_money_player_firms": seg["ply"], "x_money_city": seg["city"],
            "x_money_lonca": seg["lonca"], "x_money_other": seg["other"]}


def city_flow_totals(W, P) -> dict[str, float | None]:
    """D11: şehir gelir-gider kalemlerinin BİRİKİMLİ toplamları. Gelirler modelin `L.flows` kalemlerinden (yalnız şehir hesabına giden türler), basım `L.fiscal_minted`;
    giderler `L.city_out` (şehir hesabından çıkan her ödeme türü) kalemlerinden, kalan `city_out_other`. Host haftalık farkı alır. Kayıt yoksa (eski model) null."""
    L = W.L
    try:
        fl, co, mint = L.flows, L.city_out, L.fiscal_minted
    except AttributeError:
        return {k: None for k in CITY_FLOWS}
    out: dict[str, float | None] = {k: float(sum(fl.get(n, 0.0) for n in names)) for k, names in _CITY_IN.items()}
    st = getattr(W, "hire_stat", None)
    out["city_in_mint"] = max(0.0, float(mint) - float(st.get("baslangic_parasi_basim", 0.0) if st is not None else 0.0))      # yeni oyuncuların başlangıç parası kayıtlı basımdır ama oyuncuya gider, şehir kasasına girmez
    listed = 0.0
    for k, names in _CITY_OUT.items():
        out[k] = float(sum(co.get(n, 0.0) for n in names))
        listed += out[k]
    out["city_out_other"] = max(0.0, float(sum(v for n, v in co.items() if n not in _CITY_OUT_SKIP)) - listed)
    return out


def city_inflow_week(W) -> float | None:
    """D11: şehir hesaplarına o hafta dışarıdan giren toplam (modelin `L.inflow` sayacı: tahvil ihracı ve şehirler arası denge hariç; haftalık sıfırlanır)."""
    inflow = getattr(W.L, "inflow", None)
    return None if inflow is None else float(sum(inflow.values()))


def ghost_flow_totals(W, P) -> dict[str, float | None]:
    """D11: hayalet işletme sayaçlarının BİRİKİMLİ toplamları (`W.hire_stat`): her hafta sayılan hayalet işletme (haftalık fark = o haftaki sayı) ve kapanış. Sayaç yoksa null."""
    st = getattr(W, "hire_stat", None)
    if st is None:
        return {k: None for k in GHOST_FLOWS}
    return {k: float(sum(st.get(n, 0.0) for n in src)) for k, src in _GHOST_SRC.items()}


def hire_flow_totals(W, P) -> dict[str, float | None]:
    """D6: işe alım/çıkarma/katılım sayaçlarının BİRİKİMLİ toplamları (`W.hire_stat`); host haftalık farkı alır. Sayaç yoksa (eski model) null."""
    st = getattr(W, "hire_stat", None)
    if st is None:
        return {k: None for k in HIRE_FLOWS}
    return {k: float(sum(st.get(n, 0.0) for n in src)) for k, src in _HIRE_SRC.items()}


def series_facts(W) -> dict[str, float | None]:
    """§4.5 dilim dünya alanları (`x_<alan>`): modelin KENDİ haftalık ölçüleri (`W.series`; `week_metrics`), sunucuda yeniden hesaplanmaz. Okunamayan değer None. `W`'yi değiştirmez."""
    s = getattr(W, "series", None)
    names = {"x_wealth_top10": "top10", "x_wealth_top1": "top1_w", "x_wealth_median": "med_w", "x_income_gini": "gini_inc", "x_income_top10": "top10_inc"}
    return {k: _safe(lambda src=src: s[src]) for k, src in names.items()}


def world_facts(W, P) -> dict[str, float | None]:
    """`x_<alan>` olguları (extract.EXTRA_FIELDS bunları dünya alanlarına eşler). `W`'yi değiştirmez; okunamayan olgu None."""
    f = {
        "x_price_index": lambda: _price_index(W),
        "x_inflation_yoy": lambda: _inflation(W, P),
        "x_policy_inflation": lambda: _policy_inflation(W),
        "x_minted_year": lambda: _minted_year(W),
        "x_minted_total": lambda: _minted_year(W),
        "x_mint_cap": lambda: _mint_cap(W),
        "x_deposit_rate": lambda: _deposit_rate(W),
        "x_bond_rate": lambda: _weighted_rate(W.bonds),
        "x_lonca_fee_avg": lambda: _fee_avg(W, P),
        "x_royalty_avg": lambda: _royalty_avg(W),
        "x_rent_pct": lambda: _rent_pct(W, P),
        "x_occupancy": lambda: _occupancy(W, P),
        "x_tenants_per_house": lambda: _tenants_per_house(W, P),
        "x_house_index": lambda: _house_index(W, P),
        "x_house_resale_ratio": lambda: _house_resale_ratio(W, P),
        "x_survival_52": lambda: _survival_52(W),
        "x_wage_index": lambda: _wage_index(W),
        "x_loan_rate_avg": lambda: _weighted_rate(list(W.loans.values())),
        "x_city_cash_weeks": lambda: _cash_weeks(W),
    }
    out = {k: _safe(fn) for k, fn in f.items()}
    try:
        out.update(labor_facts(W, P))
    except _SAFE:
        out.update({k: None for k in LABOR_STOCK})
    try:
        out.update(hire_facts(W, P))
    except _SAFE:
        out.update({k: None for k in HIRE_STOCK})
    try:
        out.update(start_facts(W, P))
    except _SAFE:
        out.update({k: None for k in START_STOCK})
    try:
        out.update(market_facts(W, P))
    except _SAFE:
        out.update({k: None for k in MARKET_STOCK})
    try:
        out.update({k: finite(v) for k, v in money_facts(W, P).items()})
    except _SAFE:
        out.update({k: None for k in MONEY_STOCK})
    return out


def credit_facts(W, P, row: Mapping[str, Any] | None) -> dict[str, int | None]:
    """`x_founders_applied` / `x_founders_rejected` (PLAN-KREDI U4): modelin bu haftaki satırından (`row`) farklı kurucu sayıları; satır yoksa ya da ret lonca sayısına
    bölünmüyorsa None. `x_failed_player_cum` / `x_failed_dao_cum` / `x_failed_npc_default_cum` (T3, B5): birikimli firma ölümleri (`credit.cum_deaths`; satırdan bağımsız,
    okunamazsa None). `W`'yi değiştirmez."""
    try:
        app, rej = credit.founders(row, len(W.loncas))
    except _SAFE:
        app = rej = None
    try:
        cum = credit.cum_deaths(W)
    except _SAFE:
        cum = {"player": None, "dao": None, "npc_default": None}
    return {"x_founders_applied": app, "x_founders_rejected": rej, "x_failed_player_cum": cum["player"], "x_failed_dao_cum": cum["dao"],
            "x_failed_npc_default_cum": cum["npc_default"]}
