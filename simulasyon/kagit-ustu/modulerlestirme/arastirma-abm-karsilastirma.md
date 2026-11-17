# Açık kaynak ajan tabanlı makro modellerle karşılaştırma: ne ödünç alınmalı?

Tarih: 2026-10-28. Kapsam: yalnız araştırma ve rapor; proje kodu değiştirilmedi. Model: `simkit/` v13.0 (K-217 varsayılanları).
İndirilen kod ve belgeler (güvenilmeyen veri olarak yalnız okundu, hiçbiri çalıştırılmadı): `yerel çalışma klasörü (aktarımda maskelendi)/` altında `bam-engine/`, `caiani-benchmark/`, `jmab/`, `beforeit/`.

---

## 1. Yönetici özeti (sahip için, düz dille)

1. İncelenen üç gerçek model (BAM Engine, Caiani ve ark. 2016 benchmark, BeforeIT) ayakta kalıyor, çünkü **bankalar kredi verince yeni para yaratıyor**. Bizde loncalar yalnız elde var olan parayı ödünç veriyor; toplam para 200 hafta boyunca **sabit kaldı: 448.516 Akçe** (ölçüm, bölüm 2).
2. Bu yüzden "firmaların toplam kârı sıfır" bulgusu bir hata değil, kapalı para sisteminin kaçınılmaz sonucu: bir sektörün kâr edebilmesi için başka sektörün (devlet, hane, banka) açık vermesi ya da kredi parasıyla yatırım yapılması gerekir. Bizde bunların hiçbiri yok.
3. Ölçüm şaşırtıcı: ilk 200 haftada paranın **%30 ile %57'si şehir kasalarında** duruyor (hafta 5, 20, 50, 100, 200 için sırasıyla 134 bin, 256 bin, 224 bin, 192 bin, 181 bin Akçe; toplam para 448 bin). Gerçek ekonomide devletin nakit bakiyesi paranın birkaç yüzdesidir. Yani devlet paradan çok fazlasını emip harcamıyor.
4. %2 basım tavanı ilk 250 haftada hiç devreye girmiyor (basım sıfır); asıl sorun şehrin parayı tutması. Tavan ancak çöküşte devreye giriyor ve o zaman tahvil borcu 0,6 ile 1,9 milyon Akçeye şişiyor.
5. "Kurtarma yok" kuralı (NO_BAILOUT) tek başına yanlış değil: üç modelde de batan firmanın yerine yeni firma geliyor ve yeni firmanın sermayesi (BAM'de sıfırdan, Caiani'de hane sahiplerinden, BeforeIT'te bankadan) sisteme bir yerden giriyor. Bizde yerine geçen sermaye zaten var olan paradan çekiliyor.
6. Firmalar küçük kalıyor çünkü kodda kapasite 3 katla sınırlı (`CX_CAP_MAX`) ve kâr, işletme sermayesinin 2 katını (işletme sermayesi = 2 günlük gider, yani 4 günlük gider) aşınca şehre süpürülüyor (`NPC_KEEP`); gerçek küçük işletme tamponu ~27 gün, Caiani 13 hafta. Bu iki kural firmanın kendi kârıyla büyümesini kapatıyor.
7. Önerinin özü: (a) şehir kasasının fazlasını harcatan bir mali kural, (b) loncalarda kredi = para yaratımı (sermaye/kaldıraç sınırıyla, sabit %2 tavanla değil), (c) firma kârının şehre süpürülmesi yerine temettü olarak hanelere akması ve firmanın 4 ila 13 haftalık nakit tamponu tutması, (d) kapasite tavanının kaldırılıp Caiani'nin birikim kuralının konulması.
8. Hazırlanan iki modül için kritik uyarı (bölüm 3): beklenen kâra bağlı girişte kâr toplamda sıfıra yakın olduğu sürece giriş hiç tetiklenmez; faize duyarlı kredi/tasarruf, para yaratımı yokken toplam talebi artırmaz, yalnız dağılımı değiştirir.
9. Doğrulama durumu: BAM Engine kodu ve belgeleri, Caiani makalesi (denklemler ve Tablo 3) ve JMAB XML'leri, BeforeIT kaynak kodu okundu. BeforeIT'in sayısal parametreleri `.jld2` dosyasında; Julia kurulu olmadığı için okunamadı, yalnız kalibrasyon formülleri alındı. Dosi K+S ve JAMEL ile gerçek dünya para büyümesi rakamları **hafızadan**, doğrulanmadı; işaretlendi.
10. Sahibe tek ilke sorusu en sonda (bölüm 9): loncalar kredi vererek para yaratabilsin mi?

---

## 2. Bizim modelden ölçülen bulgular (mevcut çıktılardan, yeni koşu yapılmadı)

Kaynak: `ornek-ciktilar/v13/C2_pm0.080_h200.csv` ve `F_pm0.080_h500.csv` (v13.0, `WEEKLY_CSV`).

| Hafta | Para toplamı | Şehir kasaları | NPC firmalar | Oyuncu firmaları | Üç hane katmanı (yoksul+orta+zengin) | Lonca sermayesi | Talep karşılama | Çalışan / işsiz |
|---|---|---|---|---|---|---|---|---|
| 5 | 448.516 | 133.879 (%30) | 178.320 | 0 | 28.459 | 59.002 | 1,00 | 2220 / 39 |
| 20 | 448.516 | 255.953 (%57) | 80.190 | 41.268 | 22.391 | 32.783 | 0,98 | 1628 / 152 |
| 50 | 448.516 | 223.986 (%50) | 101.768 | 42.115 | 30.350 | 36.724 | 0,99 | 1425 / 178 |
| 100 | 448.516 | 191.520 (%43) | 80.192 | 89.697 | 60.089 | 3.900 | 0,91 | 1293 / 298 |
| 200 | 448.516 | 181.345 (%40) | 56.304 | 64.298 | 66.004 | 60.636 | 0,98 | 1208 / 380 |
| 300 (500 hf koşusu) | 458.400 | 83.174 | 35.560 | 53.358 | 96.132 | 165.291 | 0,66 | 915 / 662 |
| 400 | 503.083 | 14.498 | 68.569 | 52.206 | 255.686 | 16.259 | 0,42 | 355 / 1180 |
| 500 | 535.851 | 12.970 | 117.978 | 54.139 | 167.076 | 12.824 | 0,20 | 341 / 1327 |

Ek göstergeler (aynı dosyalar): şehir tahvil borcu hf 400'de 679 bin, hf 500'de 1,88 milyon Akçe. Sepet fiyat endeksi (500 hf koşusu): hf 100'de 201, hf 200'de 129, hf 300'de 116, hf 400'de 399, hf 500'de 533 (para sabitken önce enflasyon, sonra çöküşte arz şoku). Servet Gini 0,84 ile 0,96. Para toplamı haftalık ücret ödemesinin (~110 ile 160 bin Akçe) yalnız ~3,4 katı.

Okuma: (i) basım hf 250'ye kadar sıfır: %2 tavanı bağlayıcı değil; (ii) paranın yarıya yakını şehir kasasında dolaşım dışı; (iii) hane likiditesi çok düşük: üç katmanın toplamı ~60 bin, kişi başına üçte bir ile yarım hafta ücret; (iv) çöküşte para ancak şehir açığıyla (basım ve tahvil) artıyor, bu da geç ve zararlı.

Karşılaştırma: Caiani kararlı durumunda firmalar bir çeyrek ücret bütçesi kadar mevduat tutar (σ = 1), hane mevduatı yaklaşık 2,5 çeyrek gelir (varlık normu: (1 - α1) / α2 = (1 - 0,386) / 0,25 = 2,46 çeyrek). Bizde hane likiditesi bunun ~%1 ile 2'si. Dikkat: bizim para tanımımız (nakit ve lonca hesapları) dar olabilir; M1 ve M2 ayrımı için hane mevduatının nerede tutulduğu (`mev_*` sütunları) ayrıca kontrol edilmeli.

---

## 3. Hazırlanmakta olan iki modül için uyarılar (öne alındı)

### 3.1 `ENTRY_EXP` (beklenen kâra bağlı firma girişi, worktree `sim-giris`)

| Konu | Bulgu (kaynak) | Modüle etkisi |
|---|---|---|
| Referans modellerde giriş nasıl? | BAM: batan firma aynı dönemde bire bir yenisiyle değişir; yeni firma özsermayesi = 0,5 × hayatta kalanların budanmış ortalaması, fiyat = piyasa ortalaması × 1,15 ila 1,20, ücret teklifi 0,5 × ortalama (`events/_internal/bankruptcy.py::spawn_replacement_firms`, `defaults.yml: new_firm_*`). Caiani: `NoEntryPopulationHandler`; sayı sabit, batan firma hane sahiplerinin kurtarma katkısıyla (bail-in) sürer (makale 3.3). BeforeIT: firma sayısı sabit, insolvent firma bankasının özsermayesiyle yeniden finanse edilir (`bank.jl::finance_insolvent_firms!`, yeni borç = ζ_b × P × K, ζ_b = 0,5) | Üç modelde de giriş kâra bağlı değil, ikamedir. Girişi kâra bağlamak daha gerçekçi ama **kararlılık için ikame tabanı gerekir**. |
| Kâr toplamda ~0 iken | Beklenen kâr (fiyat - birim maliyet - faiz) sektör ortalaması 0'a yakınsa getiri eşiği (EE_RP, kredi faizi, geri ödeme 104 hf) hiçbir sektörde aşılmaz | Modül yapısal olarak sessiz kalabilir; makro kaçak (bölüm 4) kapanmadan giriş "kapalı" gibi davranır |
| Sermaye kaynağı | Girişe verilen sermaye şehir fonundan (`eo_found`, FOUND_FUND) geliyor: şehir kasasındaki para zaten kapalı sistemin içinde | Yeni para girmiyor, sadece yer değiştiriyor; fon tükeniyor (v13 raporu: fon 50. haftada bitiyor). Giriş sermayesinin bir kısmı **kurucu hanenin kendi mevduatından** (Caiani'deki gibi sahip katkısı) gelmeli |
| Parametre kontrolü | `EE_ENTRY_SIZE` = 0,33 (Dunne ve ark. 1988); BAM varsayılanı yeni firma boyutu 0,5 | 0,33 ile 0,5 arası makul; BAM'in 0,5'i daha yüksek kalan güvenli taraf. `EE_PMAX` = 0,0015/hf × ~1500 aday ≈ 2,3 giriş/hf üst sınır; 170 NPC firma ve %8 ile 10 yıllık çıkışla ~0,3 çıkış/hf: kapasite yeterli |
| Öneri | (a) NPC kadrosunun batışında 4 hafta bekleyip lonca kredisiyle yeniden kurma kuralı (`NPC_REVIVE_DELAY`) **kalsın**: BAM'in ikamesinin eşdeğeri. (b) `EE_REPLACE=1` ile eski yolu tamamen kapatmak yerine, ilk testlerde `EE_REPLACE=0` (eski yol sürsün) ve `ENTRY_EXP` yalnız ek giriş olsun. (c) Beklenen kâr hesabına **sektör gerçekleşen kâr oranı** (pano) da girsin: yalnız bireysel hesap kâr toplamı ~0 iken girişi söndürür. (d) Kurucu katkısı: sermayenin en az %30'u kurucu mevduatından (BAM `net_worth_ratio`, Caiani bail-in oranları açık değil: sayı varsayım). |

### 3.2 `RATE_BEHAV` (faize duyarlı tasarruf ve kredi talebi, worktree `sim-faiz`)

| Konu | Bulgu | Modüle etkisi |
|---|---|---|
| Referanslarda hane faiz duyarlılığı | BAM: tüketim eğilimi yalnız göreli tasarruftan (c = 1/(1 + tanh(S/S̄)^β), β = 2,5). Caiani: c = α1 × gelir + α2 × servet, faiz yalnız mevduat geliri üzerinden dolaylı. BeforeIT: c = ψ × beklenen gelir / (1 + KDV), ψ sabit. K+S (hafızadan): işçiler tüm gelirini harcar | Modülün EIS yaklaşımı (0,05 / 0,3 / 0,5) bu üç modelde **yok**; literatürle (Havranek vb.) gerekçeli ek bir katman. Küçük tutulması doğru; `RB_F_MIN/MAX` = 0,85 / 1,10 makul |
| Kredi tarafı | Caiani makalesi açık: bankalar fiyatla değil **miktar rasyonlamasıyla** ayrım yapar, "kredi, kredinin fiyatından daha önemli bir reel sürücü" (3.2, Waters 2013 atfı). Caiani kredi miktarı: beklenen getiri ≥ 0 ise ver; temerrüt olasılığı pr = 1 / (1 + exp((OCF/ds - ς) ...)), ς_c = 3,92245 (tek dönem PD %1'e göre kalibre) | `RB_LOAN_SEMI_*` (kredi talebinin faize yarı-esnekliği) fiyat kanalını güçlendiriyor; asıl kaldıraç **arz tarafı** (sermaye oranı, LTV, nakit akışı). Öneri: arz kuralını (bölüm 5.7) önce kur, esnekliği sonra |
| Kapalı para uyarısı | Para yaratımı yokken kredi talebi düşünce yalnız loncada boşta mevduat artar (K-182 "tasarruf paradoksu"); toplam talep artmaz. Faiz düşünce kredi talebi artması, kredi para yaratırsa makro etki yapar, yoksa yalnız dağılım | `RATE_BEHAV` etkisi **para yaratımı olmadan ölçülemeyebilir**. Test sırası: önce endojen kredi parası, sonra RATE_BEHAV |
| Faiz ölçeği | Bizim faizler gerçeğin 5 ile 9 katı (K-158). Caiani: kredi 0,0075/çeyrek (yıllık %3), mevduat 0,0025/çeyrek (%1), risk farkı 0,5 puan/çeyrek; BeforeIT: kredi faizi = r_bar + μ, μ ulusal hesaplardan (firma faiz gideri / borç) - r_bar | `RB_SCALE = 5` ihtiyatlı; haftalık faizi çeyreğe çevirirken çarpan ~13: haftalık 0,003 risk farkı = çeyrek 0,039 (Caiani'nin 0,005'inin ~8 katı). Ölçek tutarlı kalmalı |

---

## 4. Asıl soru: gerçek modeller toplam kârı nasıl pozitif tutuyor, bizde ne engelliyor?

### 4.1 Kalecki özdeşliği (her modelde geçerli)

Brüt kâr toplamı = yatırım + devlet açığı + kâr gelirinden tüketim + net ihracat - işçi tasarrufu.

Kâr dağıtım sonrası kalan (tutulan) kâr = devlet açığı + (yatırım - hane tasarrufu) + dış açık, temettünün tamamı harcanıyorsa. Kapalı ve büyümeyen bir ekonomide yatırım = tasarruf olduğundan **tutulan kâr = devlet açığı**. Firmaların özsermayesi büyüyecekse, kayıpları kapatacaksa ya da firmalar büyüyecekse ya devlet açık verir ya da net yatırım kredi parasıyla finanse edilir ya da dışarıdan talep gelir.

### 4.2 Modellerin mekanizması

| Mekanizma | BAM Engine | Caiani 2016 | BeforeIT | Bizim model |
|---|---|---|---|---|
| Para yaratımı | Banka kredisi ücret bütçesini finanse eder (kredi talebi B = ücret bütçesi - özsermaye); bankalar yalnız özsermaye/v ile sınırlı (v = 0,10, kaldıraç ≤ 10) (`bam_model.rst` Faz 3) | Her kredi mevduat yaratır (SFC); sermaye oranı alt sınırı %6, hedef oranı ayarlanır (3.2) | Kredi = min(istenen, ζ_LTV × K - L, E_k/ζ - maruziyet), ζ = 0,03, ζ_LTV = 0,6 (`search_and_matching_credit.jl`) | **Yok**: `lendable` = nakit - %20 rezerv, `LEV_K = 25` nakitle sınırlı; para yalnız şehir basımıyla (≤ %2/yıl) artar |
| Yatırım talebi | Yok (sermaye yok) | Kredili yatırım: g^D = γ1 (r - r̄)/r̄ + γ2 (u - ū)/ū, γ1 = 0,01, γ2 = 0,02, ū = 0,8, r̄ = 0,04345 | Yenileme yatırımı δ/κ ve konut yatırımı ψ_H × gelir | `CAPEX` var ama ağırlıkla firma kasasından, kapasite tavanı 3×, `CX_*` kredi sınırlı |
| Kâr gelirinden tüketim | Temettü yalnız %10 (δ = 0,10); %90 firmada kalır, özsermaye birikir (Kalecki tuzağı) | Temettü = %90 × vergi sonrası kâr (ρ = 0,9), hanelere gider; firma σ = 1 çeyrek ücret bütçesi mevduat tutar | θ_DIV ulusal hesaplardan kalibre | NPC kârı `NPC_KEEP = 2` × işletme sermayesini aşınca **şehre süpürülür**; oyuncu firması temettüsü %30 stopaj |
| Devlet | Yok | Kamu çalışanı Ng = 1360 (8000 haneden), dole ω = 0,4 × ortalama ücret, flat vergi %18, açık 1 dönemlik tahvillerle MB/banka tarafından finanse (3.5) | Devlet tüketimi C_G log-AR(1), açık borç birikimi (`government.jl`) | Şehir dengeli bütçeye yakın, nakit tutuyor (%40 ile 57), açık yalnız basım izni (≤ %2) ve tahvil (lonca boş nakdi) ile |
| Dış talep | Yok | Yok | ROTW ihracat/ithalat | Yok ("dışsal dünya yok") |
| Giriş sermayesi | Yeni firma: ortalama özsermayenin %50'si, **yoktan** | Sahiplerden (bail-in), sayı sabit | Banka özsermayesinden (bail-out gibi), sayı sabit | Şehir fonu ya da lonca havuzu (var olan para) |
| Nominal büyüme | Dolaylı | Kararlı durumda g_SS = 0,0075/çeyrek ≈ %3/yıl nominal büyüme ve enflasyon | Hesaplardan | Para sabit; fiyat yükselince reel para erir |

Kaynak: BAM `src/bamengine/events/_internal/{credit_market,revenue,bankruptcy}.py`, `docs/user_guide/bam_model.rst`; Caiani makale 3.1 ile 3.5, Ek A, Tablo 3; BeforeIT `src/agent_actions/{bank,government,households,firms}.jl`, `src/markets/search_and_matching_credit.jl`, `src/utils/calibration.jl`.

### 4.3 BAM'in kendi itirafı

BAM Engine yazarı da bir "Kalecki tuzağı" tespit etmiş: kâr özdeşliği firma özsermayesini bir çekim merkezine çekiyor ve borçlanmayı neredeyse bitiriyor; tek etkili parametre temettü oranı δ (`docs/glossary.rst`, `paper/paper.md`). BAM yine de çökmüyor çünkü (i) yeni firma sermayesi sıfırdan yaratılıyor, (ii) kredi ücret bütçesini ön finanse ediyor, (iii) hane tüketimi servet temelli. BAM stok-akış tutarlı değil: giriş sermayesi muhasebeye yoktan giriyor.

### 4.4 %2 basım tavanı ve NO_BAILOUT engelliyor mu?

| Soru | Cevap |
|---|---|
| %2 tavanı ilk 200 haftada bağlayıcı mı? | **Hayır.** Basım sıfır, para sabit (448.516). Şehir kasası harcamadığı için tavan hiç sınanmıyor. |
| O halde engel ne? | (1) Şehir parayı tutuyor (%30 ile 57). (2) NPC kâr süpürmesi + 4 vergi (ücret %10, kurumlar %20, temettü %30, KDV %3) parayı şehre çekiyor, şehir geri harcamıyor. (3) Hane tasarrufu pozitif (MPC0 = 0,9; zengin payı (y/yref)^-0,15 ile daha da düşük) ve yatırım talebi yok: tutulan kâr = açık + (yatırım - tasarruf) negatif kalır. (4) Para kredi yoluyla artmıyor. Bu 4 madde kuramsal çıkarımdır; bölüm 8'deki sektör akış ölçümüyle doğrulanmalı. |
| Çöküşte tavan zarar veriyor mu? | **Evet, geç.** hf 300'den sonra şehir açık veriyor, basım izni dolunca tahvile geçiyor (0,6 ile 1,9 milyon); bu tahvili lonca boş nakdinden alıyor: yeni para yok, havuz tükeniyor. Gerçek dünyada devlet tahvilini bankalar mevduat yaratarak alır ya da MB alır. |
| NO_BAILOUT neyi engelliyor? | Zarar eden NPC'ye şehir parası verilmesini. Kuralın kendisi gerçekçi. Fakat K-211 destek fonu fiilen bailout: kalıcı maliyet (~455 bin Akçe / 200 hf, ~946 bin / 500 hf) ve kâr süpürmesi destek fonuna önce gidiyor. Referans modellerde "kurtarma" sistemin yapısal parçası (bail-in, banka kurtarma) ve para yaratımını gerektirmiyor. |
| Önerilen çerçeve | Kural "kurtarma yok" kalsın; ama (a) banka kredisi para yaratsın, (b) şehir kasası nakdi hedefi ≤ 4 haftalık harcama, (c) devlet açığı bono ile ve bono alımı mevduat yaratsın, borç/gelir tavanıyla. |

Rakam notları: Kaldıraç sınırı olarak BAM v = 0,10 (en çok 10×), Caiani %6 alt sermaye oranı (en çok ~16,7×), BeforeIT ζ = 0,03 (~33×); bizdeki `LEV_K = 25` bu aralıkta, yani **sınırın kendisi uygun, uygulama biçimi (nakitle sınırlı) uygun değil**. Hedef nominal büyüme için Caiani'nin kararlı durumu %3/yıl; gerçek dünyada geniş para (M2) büyümesi uzun dönemde nominal GSYH büyümesine yakın, yaklaşık %5 ile 7 (hafızadan, doğrulanmadı).

---

## 5. Yan yana tablolar (alan alan)

Zaman birimi: BAM ve Caiani çeyreklik, BeforeIT çeyreklik, bizimki haftalık (1 hf = 7 döngü). Çeyrek oranını haftaya çevirmek için yaklaşık 13'e bölün.

### 5.1 Hane tüketimi ve tasarrufu

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | `households.py::life_budget`: c = MPC0 × y × (max(y, 0,3 yref)/yref)^-MPC_SLOPE + servetten harcama; alışkanlık yumuşatması `HAB_UP/HAB_DOWN`; yoksul/zengin geçişi `WR_*` ve `POOR_SHARE`; mevduat: elde tutma 2 haftalık harcama, fazlanın haftalık %50'si yatırılır (`week_close.py`, `DEP_KEEP_NEW`, `DEP_SHARE`); mevduat faizi = havuzun tahsil ettiği faizin %80'i / mevduat, üst sınır %1/hf (`DEP_PAYOUT`, `DEP_RATE`) | MPC0 = 0,9; MPC_SLOPE = 0,15; yref = 12 × WI; WEALTH_DRAW_YEAR = 0,045; WS_BUF = 20; faize duyarlılık yok (RATE_BEHAV yolda) |
| (b) BAM | c_j = 1/(1 + tanh(S_j/S̄)^β), bütçe = c × (tasarruf + gelir), harcanmayan tasarrufa döner (`goods_market.py::consumers_calc_propensity`, `consumers_decide_income_to_spend`). Ek: buffer-stock c = 1 + (d - h g)/(1 + g) | β = 2,5; S = S̄'de c ≈ 0,66; buffer_stock_h = 2,0 |
| (b) Caiani | c^D = α1 × NI/p^e + α2 × NW/p^e (3.16) | α1 = 0,38581 (SS'den türetilmiş), α2 = 0,25 (çeyrek başına servet harcama payı); σ = 1 firma hesabı; işsiz dole ω = 0,4 |
| (b) BeforeIT | C = ψ × Y_e/(1 + τ_VAT); konut yatırımı I_H = ψ_H × Y_e/(1 + τ_CF); ψ = (hane tüketimi + ürün vergileri) / kullanılabilir gelir (`calibration.jl`) | ψ ve ψ_H ulusal hesaplardan (sayıları .jld2'de, okunamadı) |
| (c) Boşluk ve öneri | Bizde yoksulda bütçe gelire bağlı (MPC0 = 0,9) iyi; ama **servet normu yok**: Caiani'de servet/gelir normu ≈ 2,5 çeyrek (32 hf) ve servet harcama hızı çeyrekte %25; bizde hane servet stoku ≈ 0,5 hf ücret, servet harcama hızı yılda %4,5 (haftalık %0,087, Caiani'nin haftalık ~%1,9'unun ~1/22'si). **Öneri:** (1) hane likidite normunu belirle: hedef 4 hf (medyan ABD işlem hesabı, hafızadan) ile 32 hf (Caiani) arası; ilk adım 8 hf. (2) Normun üstü için harcama hızı yılda %4,5 yerine %25'e kadar (çeyrekte %6'ya karşılık) çıkarılabilir, **ama yalnız endojen para varken** (K-182: tek başına talebi düşürdü). (3) Gelirden harcama MPC0 = 0,9 kalsın (BeforeIT ψ gerçek veride 0,85 ile 0,95 aralığında olması beklenir; doğrulanmadı). (4) Saving için faiz duyarlılığı RATE_BEHAV'a bırakılsın (bölüm 3.2). |

### 5.2 Firma girişi ve çıkışı

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | NPC: `NPC_DIE_WEEKS` = 13 hf üst üste kasa < 2 döngü ücret ise batar (`firm_exit.py::npc_die`), özelleştirme (`PRIVATIZE`), destek sürerken özelleştirme yok (`TRANS_PRIV_OK = 0`), 4 hf sonra ve fiyat çarpanı ≥ 1 ise lonca kredisiyle yeniden kurulur. Oyuncu: `founding.worth`/`threshold`, giriş kapısı `ENTRY_PM` = 0,9, kuruluş harcı 200, `FOUND_COLLAT`; `ENTRY_OPEN` ve `YOUNG_KIT` v13'te kapalı | NPC_KEEP = 2, NPC_GRACE = 26, FOUND_FUND = 1; oyuncu firması 52 hf'de sağkalım %7 ile 12 (K-213), kit ile %53 |
| (b) BAM | Çıkış: özsermaye < 0 ya da üretim ≈ 0 (`mark_bankrupt_firms`); aynı dönemde yenisi gelir; yeni: NW = 0,5 × budanmış ortalama, üretim 0,5×, ücret teklifi 0,5×, fiyat 1,15 ile 1,20 × ortalama | new_firm_size_factor = 0,5; new_firm_production_factor = 0,5; new_firm_wage_factor = 0,5; new_firm_price_markup = 1,20 (defaults.yml; kodda varsayılan 1,15) |
| (b) Caiani | Likidite bitince ya da net değer negatif olunca batar; kayıp bankalara (takipteki kredi) ve hane sahiplerine (varlık satışı, değer kaybı ι = 0,5) dağılır; firma sayısı sabit (3.3, `FirmBankruptcy.java`) | ι = 0,5; 100 tüketim firması, 20 sermaye firması, 10 banka, 8000 hane |
| (b) BeforeIT | Insolvent: D_i < 0 ve E_i < 0 ise bankası yeniden finanse eder: yeni kredi = ζ_b × P × K, kalan banka özsermayesinden düşer (`finance_insolvent_firms!`) | ζ_b = 0,5 |
| (c) Boşluk ve öneri | Bizde yerine yeni firma yok (oyuncu kuruluşu kâra bağlı ve kapıları sıkı; ikame tabanı yok), batışın bedelini **lonca havuzu ve şehir** öder, bu da para yaratmaz. **Öneri:** (1) NPC kadro için ikame **hemen** (BAM: aynı dönem; bizde 4 hf) ve yeni firma boyutu 0,5 × hayatta kalan ortalaması; (2) kurtarma maliyeti Caiani/BeforeIT gibi bankaya (lonca özsermayesine) yazılsın, lonca özsermayesi eksiye gidemez (K-171 loncalar batabilir ile uyumlu); (3) **ENTRY_EXP için bölüm 3.1**. |

### 5.3 Üretim, istenen çıktı, beklentiler, stok

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | `labor.py::base_need`: şehrin geçen haftaki satışına dayalı hedef × `STAFF_BUFFER`; kıtlık fiyat sinyali ile 2× artış (`PM_BOOST_*`); stok örtüsü > 4 ise üretim kısılır, < 1 ise artar (`INV_*`); sektör panosu `SB_*` (kıtlık, stok > 28 döngü ise fren) | STAFF_BUFFER = 1,1; PM_BOOST_MAX = 2,0 (eşik 1,5); INV_HI/INV_LO/INV_GAIN = 4,0/1,0/0,2; SB_GROW = 0,15; SB_STOCK_HI = 28 |
| (b) BAM | Y^d = Y_{t-1} (1 ± ρ), ρ ~ U(0, 0,10): stok yok ve fiyat ≥ ortalama ise artar, stok var ve fiyat < ortalama ise azalır; L^d = ceil(Y^d/φ); eksik işçiyi tek tek işten çıkarır | h_rho = 0,10; φ = 0,5 |
| (b) Caiani | y^D = s^e (1 + ν) - envanter_{t-1}; s^e adaptif beklenti z^e_t = z^e_{t-1} + λ (z_{t-1} - z^e_{t-1}); işçi talebi N = u^D × k/l_k, işçi devri %5 | ν = 0,1; λ = 0,25; ϑ = 0,05 |
| (b) BeforeIT | Q_s = Q_d × (1 + γ_e) (beklenen büyüme); Leontief üretim min(Q_s, N α, K κ, M β) | γ_e, π_e geçmiş verilerden AR(1) tahmini (`estimations.jl`) |
| (c) Boşluk ve öneri | Bizde beklenti **yok**: hedef doğrudan son haftanın satışı (λ = 1) ×1,1; haftalık gürültü doğrudan istihdama yansıyor, bu işe alma/çıkarma salınımı (K-216: %52 salınım) yapıyor. **Öneri:** beklenen satış s^e = s^e + λ_w (s - s^e) ve hedef s^e × (1 + ν). Caiani λ = 0,25 çeyrekte yarı ömür ~2,4 çeyrek; haftalıkta aynı yarı ömür λ_w ≈ 0,022 çok yavaş, bizde pratik ara değer **λ_w = 0,05 ile 0,10** (yarı ömür 7 ile 14 hf) önerilir (sayı gerekçesi varsayım, ayar testiyle sınanmalı). Envanter hedefi ν = 0,1 (Caiani) ≈ 1,3 hf satış; bizim stok freni 4 hf, pano girdi tamponu 0,5 ile 4 hf: ürün stokunda eşiği 4 hf'den 2 hf'ye çekmek Caiani'ye yaklaştırır. |

### 5.4 Fiyatlama ve markup

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | `PRICE_V2`: fiyat = kendi tam birim maliyeti (gider defterinden, EMA) × (1 + marj); satılamayan stok marjı indirir, kıtlık artırır; haftalık artış tavanı %20; değişken maliyetin %2 üstü taban (`prices.py::fp_prices_v2`) | PV2_M0 = 0,10; PV2_EMA = 0,12; PV2_STEP_UP = 0,20; PV2_REV = 0,04; PV2_EXTRA = 0,15; PM_ADJ = 0,08 (şehir çarpanı hızı, PM_MIN/MAX = 0,5/2,5) |
| (b) BAM | Fiyat ± η, η ~ U(0, 0,10): stok var ve fiyat ≥ ortalama ise indir, stok yok ve fiyat < ortalama ise artır; başabaş taban = (ücret + faiz) / hedef üretim | h_eta = 0,10 |
| (b) Caiani | p = (1 + μ) × beklenen birim emek maliyeti (W^e N^D / y^D); μ_t = μ_{t-1}(1 ± FN) stok/satış oranı eşiğin üstündeyse düşer, altındaysa artar (`AdaptiveMarkUpAveragePrice.java`, eşik 0,2, adaptiveParameter 0,5) | μ_c0 = 0,318857 (değişken maliyet üstü; toplam birim maliyet üstü 0,10), μ_k0 = 0,075; FN (1; 0,0094) |
| (b) BeforeIT | P_new = P × (1 + maliyet itmeli enflasyon π_c) × (1 + π_e); π_c emek, ara mal, sermaye maliyetlerinin fiyata oranından | (`cost_push_inflation`) |
| (c) Boşluk ve öneri | **Hedef marj tutarlı:** bizim 0,10 Caiani'nin toplam maliyet üstü 0,10'una eşit (Ek A.4: "mark-up over total unit costs of 0.1"). Fark: bizim fiyat kuralı maliyet-artı + haftalık %20'ye kadar yukarı adım + ücret endekslemesi (aşağıda) **maliyet-fiyat sarmalı** yaratabilir (fiyat endeksi 100 hf'de 201). Kapalı para olduğu için sarmal talebi kısar; BAM'in göreli fiyat kuralı (ortalamaya göre ve stoka göre) ve Caiani'nin stok-eşikli adaptif markup'ı sarmalı doğal olarak sınırlar. **Öneri:** PV2_STEP_UP 0,20 → 0,05 haftalık (BAM'de çeyrekte ≤ %10 = haftada ~%0,8; 0,05 ihtiyatlı bir üst sınır, ayar testiyle sınanmalı); hedef marjı sektör ortalamasının üstüne çıkarma yok (zaten `PV2_REV` aşındırıyor). |

### 5.5 Ücret belirleme ve emek eşleşmesi

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | Ücret = kademe ücreti × şehir ücret endeksi WI; WI haftalık: WI += 0,15 × (1 + 0,5 (CPI - 1) - WI) + emek kıtlığı terimi; terim = LAB_K × 0,1 × (u* - u), düşüşte ×0,3; tecrübe kademeleri 10/15/20, kontenjan %30/%10; işsizlik ödeneği ücretin %50'si × 0,6 = 0,30 (şehir) (+ lonca paketi) | WAGE_CATCHUP = 0,15; WAGE_PASS = 0,5; LAB_K = 0,1; LAB_DOWN = 0,3; **LAB_U_STAR = 0,2**; UNEMPLOY_BENEFIT = 0,5; WELF_CITY_MULT = 0,6 |
| (b) BAM | Firma teklifi w = max(ŵ, w_{t-1}(1 + ξ)) yalnız açık pozisyon varsa, ξ ~ U(0, 0,05); asgari ücret her 4 çeyrekte yıllık enflasyonla tam endekslenir; işçi M = 4 firmaya başvurur, yüksek ücretliye öncelik; sözleşme θ = 8 çeyrek | h_xi = 0,05; max_M = 4; θ = 8; min_wage_rev_period = 4 |
| (b) Caiani | İşçi istek ücreti: son 4 çeyrekte 2'den fazla işsizse w^d = w (1 - FN), değilse ve u_{t-1} ≤ υ ise w (1 + FN); işsiz dole ω = 0,4 ortalama ücret; devir ϑ = 0,05; her açık iş için 10 aday (χ_n = 10) | υ = 0,08; ω = 0,4; ϑ = 0,05; başlangıç işsizlik 0,08 |
| (b) BeforeIT | Firma ücreti w_i = w̄ × min(1,5, hedef üretim/(N α̅)); θ_UB = 0,55 × net ücret (kalibre) | θ_UB = 0,55 (formül `calibration.jl`: 0,55 × (1 - τ_INC)(1 - τ_SIW)) |
| (c) Boşluk ve öneri | (1) **Doğal işsizlik hedefi 0,20, gerçekçi 0,04 ile 0,08'in 2,5 ile 5 katı;** Caiani υ = 0,08, başlangıç 0,08. Bu, ücretin düşmesi yerine işsizlik %20'ye çıkana kadar yukarı ücret baskısı verebilir; öneri LAB_U_STAR = 0,08 (Caiani). (2) İşsizlik ödeneği şehirde 0,30; Caiani 0,40, BeforeIT 0,55 (net ücretin): gerçek kalibrasyon aralığı 0,40 ile 0,55; öneri şehir düzeyi 0,40 ile 0,55 (WELF_CITY_MULT 0,8 ile 1,1); bu otomatik dengeleyici, bölüm 4'te devlet açığının kaynağı. (3) Ücret endekslemesi: tek kural CPI pass-through 0,5 + hızlı yakınsama; BAM yıllık tam endeksleme, firma ücreti yalnız açık pozisyonda. Ücret-fiyat sarmalı için BAM tarzı "yalnız açık pozisyon varsa artır" kuralı eklenebilir. |

### 5.6 Yatırım ve sermaye

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | `firms.py::capex_plan/capex_buy`: makine ve bina yuvaları, hedef yuva = çalışan × 1,1, haftalık en çok hedefin %30'u, kasada işletme sermayesinin 1× tutulması şartı, büyüme yatırımı için kasa > 2× işletme sermayesi; büyüme kredisi ve yatırım kredisi (`cx_*`) kâr tabanlı: toplam borç ≤ 30 ile 40 × sönümlü haftalık net kâr; kapasite adımı +2 çalışan, **tavan 3× başlangıç kapasitesi** | CAPEX_HEAD = 1,1; CAPEX_MAXW = 0,3; CAPEX_KEEP = 1,0; CAPEX_PROFIT = 2,0; CX_GROW_K = 30; CX_INV_K = 40; CX_CAP_STEP = 2; **CX_CAP_MAX = 3**; DEPR_M = 0,002/hf; DEPR_B = 0,0005/hf |
| (b) Caiani | İstenen kapasite büyümesi g^D = γ1 (r_{t-1} - r̄)/r̄ + γ2 (u^D - ū)/ū; sermaye ömrü κ = 20 çeyrek, kredi vadesi η = 20 çeyrek; r̄ = 0,04345, ū = 0,8 | γ1 = 0,01; γ2 = 0,02 |
| (b) BeforeIT | Yatırım I_d = (δ/κ) × min(Q_s, K κ); yenileme ağırlıklı; konut yatırımı ψ_H | δ, κ sektör bazlı (ulusal hesaplardan) |
| (b) BAM | Yok; Growth+ uzantısı: kâr payı σ ≤ 0,1 Ar-Ge'ye, verimlilik artışı üstel | sigma_max = 0,1 |
| (c) Boşluk ve öneri | **Kapasite tavanı 3× yapay.** Firmalar küçük kalıyor (kullanıcının gözlemi) tam bundan. Öneri: tavanı kaldır, Caiani birikim kuralını (haftalığa çevirerek) koy: g^D_haftalık ≈ (γ1 (r - r̄)/r̄ + γ2 (u - ū)/ū) / 13, γ1 = 0,01, γ2 = 0,02, ū = 0,8, r̄ gerçekleşen sektör kâr oranı ortalaması. Yatırımın para etkisi için **kredili finansman** gerekir (bölüm 5.7), yoksa yatırım yalnız firmalar arası transfer olur ve kârı artırmaz. |

### 5.7 Kredi arzı, talebi ve banka davranışı (endojen para)

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | Lonca havuzu: `credit_core.py::lendable_cash` = havuz nakdi - %20 rezerv; `lendable` = min(nakit, `LEV_K` × özsermaye - kredi); faiz = mevduat faizi (12 hf EMA) + 0,003 × itibar çarpanı, min 0,002, max 0,01/hf (`CX_*`); firma kredisi: işletme sermayesi × `LOAN_LEV` = 1,5; vade 60 hf, haftalık %1 (K-158 ilk hali); politika faizi Taylor benzeri (`RATE_POLICY`); mevduat: yeni mevduat en yüksek faiz veren loncaya | DEP_RESERVE = 0,2; LEV_K = 25; CX_MARGIN = 0,003; CX_RATE_MIN = 0,002; POL_NEUT = 0,003; POL_MIN/MAX = 0,0001/0,01; BOND_RATE_MULT = 0,5 |
| (b) BAM | Banka arzı C_k = E_k/v; kredi talebi B = max(0, WB - A); faiz r = r̄ × (1 + φ × kırılganlık), kırılganlık = B/A (≤ 10); başvurular artan kırılganlığa göre sıralı; bireysel kredi ≤ 2 × özsermaye | v = 0,10; r̄ = 0,02/çeyrek; h_phi = 0,10; max_loan_to_net_worth = 2; max_H = 2 |
| (b) Caiani | Kredi talebi L^D = I^D + beklenen temettü + σ W N - OCF^e; banka beklenen getiri ≥ 0 ise ver; PD = 1/(1 + exp(OCF/ds^L - ς)); teminat: sermaye değeri; faiz: sermaye oranı hedefin altındaysa banka faizi artırır (i^l_{t-1}(1 + FN)); mevduat faizi: likidite hedefinin altındaysa artırır; bankaların sermaye oranı alt sınırı %6, likidite %8; kredi vadesi 20 çeyrek | ς_c = 3,92245 (PD %1), ς_k = 21,51335; i^l = 0,0075; i^d = 0,0025; CR^T_0 = 0,17996; LR^T_0 = 0,258; σ = 1 (hassasiyet 0,5 ile 1,5); ε = 4,62098 (kredi/mevduat seçim yoğunluğu); χ = 3 |
| (b) BeforeIT | Kredi = max(0, min(istenen, ζ_LTV K_e - L_e, E_k/ζ - maruziyet)); faiz = r_bar + μ (tüm bankalara aynı); r_bar Taylor kuralı; yeni borç taksidi θ = 0,05/çeyrek | ζ = 0,03; ζ_LTV = 0,6; θ = 0,05; ζ_b = 0,5 |
| (c) Boşluk ve öneri | **En önemli yapısal fark.** Bizde kredi var olan parayı tahsis eder; üç modelde kredi parayı yaratır (BAM: wage bill ön finansmanı; Caiani: SFC mevduat yaratımı; BeforeIT: banka özsermayesi/ζ). **Öneri (kod parçası):** `lendable` içinde nakit sınırını kaldır: kredi hacmi ≤ `LEV_K` × lonca özsermayesi - mevcut kredi; verilen kredi borçlunun hesabına yeni para olarak yazılsın (`Ledger.settle`'a benzer "kredi basımı" kalemi, basım tavanı MINT_YEAR'dan bağımsız), geri ödeme parayı yok etsin (itfa), temerrüt kaybı lonca özsermayesinden düşsün. Rezerv: DEP_RESERVE %20 (kredi çarpanını 5'e kısar); gerçek bankalarda sermaye yeterliliği asıl sınırdır (Caiani %6, BeforeIT %3), öneri DEP_RESERVE 0,08 (Caiani likidite alt sınırı) ile başla. Risk fiyatlaması: itibar çarpanı yerine Caiani PD (OCF/borç servisi) mantığı. Hedef: geniş para büyümesinin kredi ile **içsel** çıkması, kararlı durumda ~%3 ile 4/yıl (Caiani g_SS = %3; gerçek M2 ~%5 ile 7, hafızadan). |

### 5.8 Kamu maliyesi

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | Şehir: vergiler ücret %10 (`WAGE_TAX`), kurumlar %20 (`CORP_TAX`), temettü stopajı %30 (`DIV_TAX`), KDV %3 (`SALES_TAX`); NPC kâr süpürmesi; harcama: işsizlik ödeneği, çıraklık bursu, belediye, altyapı sözleşmeleri, destek fonu; çıkış kısıtı: kasa + basım izni (`MONEY_CAP`, `MINT_YEAR` = 0,02) + tahvil (`CITY_BOND`, lonca boş nakdi, tavan 104 hf gelir) | MINT_YEAR = 0,02; MINT_OPEN_WEEKS = 13; BOND_DEBT_MAX_W = 104; TRANS_CAP = 28.000/hf; TRANS_FLOOR_WEEKS = 2,0 |
| (b) Caiani | Flat gelir ve kâr vergisi τ = %18; kamu çalışanı sabit pay (Ng = 1360); dole 0,4 × ortalama ücret; **açık sınırsız, 1 dönemlik tahvil**; MB satın alınmayan tahvili alır; MB kârı devlete | τ_i = τ_π = 0,18; ω = 0,4; i^b = 0,0025/çeyrek |
| (b) BeforeIT | Gelir, kâr, KDV, işveren ve işçi sosyal sigorta, ihracat ve sermaye oluşumu vergileri ulusal hesaplardan kalibre; devlet tüketimi C_G = exp(α_G log C_G,t-1 + β_G + ε); açık borç birikimi; faiz Taylor kuralı | τ_INC, τ_FIRM, τ_VAT, τ_SIF, τ_SIW kalibre formülleri `calibration.jl` 490 ile 560. satırlar |
| (c) Boşluk ve öneri | (1) **Şehir nakdi** paranın %30 ile 57'si: hedefi 4 haftalık çıkış (≈ paranın %3 ile 5'i). Kural: şehir harcama = gelir + 0,25 × (kasa - hedef) / hf; fazlası kamu istihdamı ve hizmet satın alma (yerel NPC firmalardan) olarak geri dönsün. (2) Otomatik dengeleyici: dole 0,40 ile 0,55 (bölüm 5.5). (3) Açık: bono ihracı bono alımı lonca için **mevduat yaratsın** (bölüm 5.7), borç tavanı yıllık gelirin 2× (104 hf, zaten var). (4) `MINT_YEAR` fiskal doğrudan basım için kalsın; kredi parası ayrı. (5) K-211 destek fonu kalıcı maliyet olmaktan çıkar: fon kâr süpürmesiyle önce geri ödenir (zaten); asıl çözüm bölüm 4.4. |

### 5.9 Konut ve kira

| | Kural | Parametreler |
|---|---|---|
| (a) Bizim | `housing.py`: kira = RENT_H × çırak ücreti × WI × kira çarpanı (doluluk^1,5); yatırımcı alımı net getiri > mevduat + risk primi ise; ikinci el piyasası; inşaat maliyet aşımında; ipotek LTV %50, vade 260 hf, DSR %35 | RENT_H = 0,08; HOUSE_YIELD = 0,003/hf; HOUSE_MAINT = 0,1; CX_LTV = 0,5; CX_DSR = 0,35 |
| (b) Caiani, BAM | Konut modellenmemiş | (yok) |
| (b) BeforeIT | Hane geliri payı ψ_H konut yatırımına (sermaye oluşumu talebi), ipotek LTV ζ_LTV | ψ_H ulusal hesaplardan |
| (c) Boşluk ve öneri | Kira geliri payı gerçekte %25 ile 30 (modelin kendi notu K-159) ama bizde %8; getiri %16/yıl brüt, gerçek ~%4 ile 6 (K-160 kendisi "hâlâ yüksek" diyor). Kapalı parada kira yükünü artırmak kriz yarattı (K-159: 0,12 ile 0,18 denendi, işsizlik 340 ile 640). **Öneri:** endojen para olmadan kira payına dokunma. Endojen para sonrası RENT_H 0,08 → 0,15 ile 0,25'e kademeli (K-159 testi tekrarlansın), HOUSE_YIELD 0,003 → 0,0012 (yıllık ~%6, gerçekçi). BeforeIT'in sade yaklaşımı (gelirin sabit payı konut yatırımı) alternatif: inşaat sektörüne talep akışı ekler. |

---

## 6. Dosi K+S ve JAMEL (yalnız hafızadan; doğrulanmadı)

İndirilen kaynakta yok; sayılar vermiyorum. Beklenen kural çizgileri:
- **K+S (Dosi, Fagiolo, Roventini 2010; Dosi ve ark. 2013):** tüketim malı firması talebi adaptif tahmin eder, hedef stok payı ι (≈ 0,1), markup pazar payı değişimine bağlı; işçiler gelirini tamamen harcar (tasarruf yok); firma kârı geri tutulur, yatırım ve Ar-Ge kredi ve içsel kaynakla finanse edilir; devlet işsizlik yardımı + vergi ile otomatik dengeleyici (açık/fazla). Kalecki bakışıyla: kâr = yatırım + devlet açığı, işçi tasarrufu sıfır olduğu için sızıntı yok. Bizim için ders: **tasarrufu toplamda yatırıma bağlayan bir kanal** (K-182 eksikliği) ve otomatik dengeleyici.
- **JAMEL (Seppecher):** emek piyasasında firma başına sözleşme, eşleşme sürtünmeli, işsizlik ödeneği, dividend ve mevduat; banka kredisi parayı yaratır ve parayı yok eder (Caiani benzeri). Ders: BAM ve Caiani ile aynı.

Bunlar araştırma yönünü doğruluyor, ek sayısal öneri üretmiyor.

---

## 7. Öncelikli değişiklik listesi

Etiketler: **[M]** mevcut modüller (`sim-giris`, `sim-faiz`) için kritik; **[D]** önce teşhis; **[K]** kod değişikliği; **[A]** ayar (parametre).

| Sıra | Değişiklik | Rakam | Beklenen etki | Risk |
|---|---|---|---|---|
| 0 [D] | Teşhis koşusu: `WEEKLY_CSV=... SECDUMP=1 BDUMP=1` ile 200 hf. Çıktı: sektör net akış matrisi (firma, hane, şehir, lonca), şehir kasasının haftalık giriş/çıkışı | 1 koşu, ~birkaç dk | Bölüm 4.4'teki dört maddenin hangisinin ne kadar sızdırdığını sayısallaştırır | Yok; ölçüm bayrakları davranışsız |
| 1 [K][M] | **Şehir nakit hedefi ve harcama kuralı**: şehir kasası hedef = 4 hf çıkış, fazla harcamaya geri | kasa %40 ile 57 → %5 civarı; ~150 ile 200 bin Akçe geri dolaşıma | Özel sektör parası ~%45 artar; kâr sızıntısının en büyük kalemi kapanır | Şehir iflası riski yok (nakit azalır ama gelir sürer); sert geçiş yerine 0,25/hf yakınsama |
| 2 [K][M] | **Endojen kredi parası**: kredi = `LEV_K` × özsermaye - kredi, yeni para; itfa parayı yok eder; rezerv %20 → %8 | nominal büyüme hedefi %3 ile 4/yıl (içsel) | Toplam kâr pozitif olabilir; `ENTRY_EXP` ve `RATE_BEHAV` ancak bundan sonra anlam kazanır | Para enflasyonu: büyüme sermaye oranıyla sınırlı, ayrı tavan: yıllık %10 toplam para büyümesi güvenlik freni |
| 3 [A] | `LAB_U_STAR` 0,20 → 0,08; işsizlik ödeneği şehir düzeyi 0,30 → 0,40 ile 0,55 (WELF_CITY_MULT 0,8 ile 1,1) | Caiani 0,08 / 0,4; BeforeIT 0,55 | Ücret/fiyat dinamiği normalleşir, otomatik dengeleyici güçlenir | Şehir gideri artar: kalem 1 ile birlikte yapılmalı |
| 4 [K] | **Kâr süpürmesi yerine temettü**: NPC kârı, tampon (4 ile 13 hf gider) üstünde hane sahiplerine temettü (stopaj mevcut %30). `working_capital` = 2 döngülük (2 günlük) gider olduğundan `NPC_KEEP` 2 şu an 4 günlük tampon demek | NPC_KEEP 2 → 14 (4 hf, JPMorgan medyanı ~27 gün, K-212 `SB_HEALTH_WEEKS`); üst uç 91 (13 hf = Caiani σ = 1 çeyrek) | Firma kâr geliri hanelere gider ve harcanır (Kalecki: kâr gelirinden tüketim); firma özsermaye biriktirebilir | Eşit pay mı, zengin odaklı mı: Gini yükselir (hane katmanı bazında) |
| 5 [K] | Kapasite tavanı `CX_CAP_MAX` 3 → kaldır; Caiani birikim kuralı (γ1 = 0,01, γ2 = 0,02, ū = 0,8) haftalığa çevrilmiş | g_hf ≈ 1/13 × çeyreklik | Firmalar büyüyebilir (boyut dağılımı sağa çarpık) | Kredili yatırım ve (2) olmadan etkisiz |
| 6 [K][M] | **`ENTRY_EXP` ayarı**: kurucu katkısı ≥ %30 hane mevduatından; `EE_REPLACE=0` ile eski yol yanında; sektör kâr oranı kapıya eklensin; giriş boyutu 0,33 ile 0,5 | EE_ENTRY_SIZE 0,33 → 0,4 (iki kaynak ortası) | Giriş kâr toplamı 0 iken ölmez | Bölüm 3.1 |
| 7 [K] | Beklenen satış yumuşatma: s^e = s^e + λ_w (s - s^e), hedef s^e × 1,1; λ_w = 0,05 ile 0,10 | Caiani λ = 0,25/çeyrek | İşe alma/çıkarma salınımı azalır (K-216'daki %52) | λ_w değeri varsayım; ayar testi |
| 8 [A] | `PV2_STEP_UP` 0,20 → 0,05 haftalık; ücret endekslemesi yalnız açık pozisyon varsa (BAM kuralı) | BAM çeyrekte ≤ %10 | Fiyat endeksi 100 hf'de 201 yerine ≤ 130 hedefi | Düşük değer maliyet şoklarını geciktirir |
| 9 [M][K] | `RATE_BEHAV`: önce endojen para, sonra aç; kredi **arz** kuralına Caiani PD (OCF/borç servisi) eklenmeli; talep esnekliği ikincil | ς_c = 3,92 kalibrasyonu: SS'de PD %1'e karşı seçilir | Faiz etkisi ölçülebilir olur | Bölüm 3.2 |
| 10 [A] | Hane likidite normu: hedef 8 hf gelir, normun üstünde servet harcama hızı %4,5 → %25/yıl (yalnız 2. sıra yapıldıktan sonra) | Caiani α2 = 0,25/çeyrek ≈ %1,9/hf (norm 32 hf) | Hane talebi sabit kalır, tasarruf paradoksu azalır | K-182: endojen para olmadan tek başına talebi düşürdü |
| 11 [A] | Konut: RENT_H 0,08 → 0,15 → 0,25; HOUSE_YIELD 0,003 → 0,0012 (endojen para sonrası) | Gerçek pay %25 ile 30 | Kira geliri talep kanalı | K-159 testi: 0,12 ile 0,18 kapalı parada kötüydü |

Sıra mantığı: 0 ölçer; 1 ve 2 kâr sızıntısını kapatır (asıl sebep); 3 ve 4 dağılımı düzeltir; 5, 6, 7 büyümeyi ve girişi açar; 8 ile 11 sonrasında ince ayar. 1 ve 2'yi birlikte denemek önerilir, çünkü 1 tek başına parayı özel sektöre geri verir ama büyüme parasını vermez; 2 tek başına hâlâ şehirde para tutuluyorsa etkisi sınırlı.

---

## 8. Doğrulama ve güvenilirlik notları

- **Okunan, doğrulanan:** BAM Engine (`defaults.yml`, `docs/user_guide/bam_model.rst`, `implementation_decisions.rst`, `events/_internal/{bankruptcy,revenue,goods_market,credit_market}.py`, uzantı belgeleri). Caiani makalesi tam metin (pdftotext ile; denklemler 3.1 ile 3.17, Ek A, Tablo 3), JMAB XML'leri (`modelBenchmark_full.xml`), `FirmBankruptcy.java`, `AdaptiveMarkUpAveragePrice.java`. BeforeIT: `one_step.jl`, `households.jl`, `firms.jl`, `bank.jl`, `government.jl`, `central_bank.jl`, `search_and_matching_credit.jl`, `calibration.jl` formülleri.
- **Okunamadı:** BeforeIT'in `.jld2` içindeki sayısal kalibre parametreleri (ψ, τ'lar, θ_DIV, μ); Julia kurulu değil ve çalıştırma gereği yok. Yalnız sabit değerler (θ = 0,05; ζ = 0,03; ζ_LTV = 0,6; ζ_b = 0,5) ve formüller kullanıldı.
- **Hafızadan, doğrulanmadı:** Dosi K+S ve JAMEL tarifleri; gerçek dünya M2 büyümesi (%5 ile 7), gerçek hane likidite medyanı (4 hf); BeforeIT ψ aralığı (0,85 ile 0,95). Bunlar karar için yeterli değil, kaynak aranmalı.
- **Bizim ölçüm sınırları:** Bölüm 2 mevcut tek-tohum çıktılarından (PM_ADJ 0,080, tohum 0), yeni koşu yapılmadı. Şehir kasasının neden harcamadığını (kural mı, yetersiz gider kalemi mi) akış matrisi olmadan söyleyemem; önerilen koşu (sıra 0) bunu verir.
- **BAM Engine'i çalıştırmadım** (gerek duymadım; kuralları kod ve belgeden doğrudan okudum). İzole ortam gerekmedi, projeye hiçbir şey kurulmadı.
- Birim dönüşümleri (çeyrek → hafta, ÷13) yaklaşıktır.

---

## 9. Sahibe tek ilke sorusu

Loncalar (bankalar) kredi verirken **yeni para yaratabilsin mi** (gerçek dünyada olduğu gibi, sermaye oranıyla sınırlı), yoksa para yalnız şehrin basımıyla mı artsın? Bu, `NO_BAILOUT` ilkesini bozmaz (kurtarma değil, kredi), ama "para yalnız oyun yöneticisinden çıkar" sezgisini değiştirir. Cevap evetse bölüm 7'deki sıra 2 uygulanır; hayırsa üç referans modelin hiçbirinin kullanmadığı bir yapıda kalırız ve toplam kârın ~0 kalması beklenmelidir.
