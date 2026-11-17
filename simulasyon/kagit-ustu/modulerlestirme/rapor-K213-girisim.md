# K-213 girişim kapıları açılır ve rakip kohortu: uygulama ve ölçüm raporu

**Sonuç.** Sahibin altı kararı `ENTRY_OPEN` bayrağıyla modüler modelde çalışıyor (bayrak kapalıyken hiçbir şey değişmiyor; kapı ve testler yeşil). Ölçümde **kapıları açmak ve 248 rakip firmayı 20-30. haftalara yaymak çöküşü önlemedi**: 6 PM_ADJ üzerinde çöküş haftası medyanı 65 ile 80 arasında kaldı (taban 73, K-212 + K-211'in en iyisi 87,5); hiçbir koşulda son 30 haftada talep karşılama yüzde 50'ye dönmedi (0/6; K-212'nin en iyi bileşimi 1/6). Açık kapılar ilk 60 haftayı biraz iyileştirdi (50. haftada talep karşılama 0,84 yerine 0,83-0,96, 25. haftada 60-73 canlı oyuncu firması; tabanda 0-4) ama çöküşten sonraki dönem **daha kötü** (son 30 haftada ortalama karşılama 0,02; tabanda 0,07-0,25). Üç somut neden ölçüldü. (1) Kohortun yarısı lonca kredi havuzu yüzünden zamanında kurulamadı: 248 firmanın yaklaşık 125'i geciktiler (kurulanlarda ortalama 12-21 hafta), yüzde 8 ila 15'i (pano kapalıyken yüzde 24) 200 haftada hiç kurulamadı; havuz 20. haftada 27 bin iken 25. haftada 6 bine indi ve yalnızca geri ödemelerle doldu. (2) Kurulan kohort firmalarının büyük kısmı ilk haftalarda batıyor: 35 türden 15'inde (eğlence, kuyumcu, restoran, eczane, hastane, ilaç, okul, üniversite, medya, inşaat, kereste, petrol, plastik, pamuk, altın madeni) 12 hafta sonra hiç firma ayakta değil, çünkü tek kişilik yeni firma ilk haftada ücret + kira kadar satış yapamıyor (üç firmanın izi aşağıda). 52 haftalık sağkalım yalnızca yüzde 7-12. (3) K-77 (oyuncu firması NPC çalıştırmaz) bağlayıcı: 30. haftada canlı kohort firmalarının yüzde 71'i 1-2 kişide; K-77 kalkınca yüzde 37, firma başı kadro 2,2'den 3,6'ya çıkıyor ve 52 hf sağkalım 6,6'dan 11'e. Yani bu paket tek başına çözüm değil; darboğaz kredi havuzunun büyüklüğü, yeni firmanın ilk haftalardaki nakit akışı ve çalışan bulabilmek. Altı koşunun gürültüsü ±10 hafta düzeyinde olduğundan 5-10 haftalık farklar kesin sayılmamalı.

## Ne yapıldı (altı karar, tek bayrak)
Bayrak `ENTRY_OPEN` (varsayılan 0). Alt anahtarlar `EO_*` parametresi (params.py, her birinin yanında gerekçe). Kapalıyken altınlar bayt bayt aynı (gate YEŞİL).

| # | Karar | Uygulama |
|---|---|---|
| 1 | "Kalıcı kıtlık yoksa oyuncu girmez" kalkar | `sb_entry_ok` kıtlık kuralı ENTRY_OPEN'da atlanır; ayrıca sinyal/worth yolu zaten kullanılmadığından tedarikçi-sağlık girişi kuralı da etkisiz |
| 2 | Kurmada itibar şartı ve itibara bağlı kredi tavanı kalkar | Kuruluş kredisi (eo_found), genç firma kredisi limiti (`young_lend`), medya firması kuruluş kredisi, Ar-Ge DAO kurmada `REP_DAO` eşiği (`EO_NOREP_DAO`). İtibar yalnız faizi etkiler (`RM_LO..RM_HI` çarpanı aynen). Lonca kurma (`REP_LFOUND`, `REP_OWNER`) aynen |
| 3 | Kuruluş kredisi harç + işletme sermayesini tam karşılar | Kredi = `FOUND_HARC` + `FOUND_BUF` × işletme sermayesi; kurucunun cebinden para çıkmaz (aday olmak için 200 Akçe şartı da kalktı). Harç kredi parasıyla firmadan şehre ödenir. Havuzu yeten loncalar arasından `pick_lonca` seçer; tercih edilen yetmezse sıradaki loncaya geçer (`sonraki_lonca` sayacı), hiçbiri yetmezse kuruluş bekler (kohortta zincir sırası bozulmadan, her hafta yeniden denenir). Genç firma faizi ve ödemesiz dönem (YOUNG_RATE_MULT, YOUNG_GRACE) zaten bu firmalara uygulanıyor |
| 4 | Genç kurucu çırak verimiyle başlamaz | İlk `YOUNG_WEEKS` (52) hafta firma verim tabanı `EO_SKILL` = **1,15**. Kalibrasyon: NPC dağılımı (yüzde 60 çırak 1,0 / yüzde 30 kalfa 1,3 / yüzde 10 usta 1,6) ortalaması 1,15; yani kurucu "sektör ortalaması" çalışan sayılır, usta primi yok, çırak cezası yok. Ücret çırak ücretinde kalır (kurucunun maliyeti artmaz). Modelde sektöre özgü verim yok (verim genel basamak), bu yüzden "hedef sektörde" ifadesi firma türü bazında tabana çevrildi |
| 5 | Piyasa sinyali, kıtlık, arz fazlası, ithal fiyat, kârlılık, girdi eşiği şart değil, tercih ağırlığı | `eo_weight`: kök eksiklik sinyalinin eşiğe oranı, fiyat çarpanı PM (kıtlık yüksek, arz fazlası düşük), birim marj / (FEAS × ücret+kira) (kârlılık), ithal teslim fiyatı yerelden ucuzsa × 0,5, girdi eksik oranı, şehirdeki aynı türden canlı firma sayısına göre 1/(1+n/4) kalabalık freni, panoda kalıcı kıtlık varsa artış. Seçim: deterministik ağırlıklı sıralama (anahtar = u^(1/ağırlık), u = `Random(f"eo|hafta|şehir")`). Yalnız girdisi hiçbir şehirde üretilmiyorsa kurulmaz. Eski kapılar çıkınca kurucu seli olmasın diye oran sınırı: aday oyuncu başına haftalık `EO_RATE` = 0,002 (kesirli birikim; gerçek hayatta yetişkinlerde yıllık yüzde 2-4, oyunda girişimci oyuncu varsayımıyla yaklaşık yüzde 10). Organik kuruluş kohort bitene kadar (31. hafta) başlamaz (`EO_ORG_START`=-1 otomatik), yoksa havuzu kohort gelmeden tüketir |
| 6 | Rakip kohortu | Plan açılışta (2. hafta) NPC firmalardan (ahır, belediye, Ar-Ge hariç) kurulur: **124 firma × 2 = 248 slot**. Zincir sırası: önce ham madde/ara mal (tarif derinliği), sonra tüketim (market, medya, hizmetler en sonda; lojistik altyapı olarak başta). Slotlar 20-30. haftalara eşit dağıtılır (haftada yaklaşık 22). Kurucular şehir başına deterministik karıştırılmış oyuncu listesinden (`Random(f"eo-cohort|şehir")`); her oyuncu en çok 1 firma; göç etmiş oyuncu atlanır. Rakip aynı şehirde (yerel hizmetler her zaman; `EO_COHORT_SAMECITY`=0 ile ticari mal komşu şehre). K-77: kohort firması yalnız oyuncu çalıştırır (`NPC_LAB_PF=0` ile) |

Kodu: `simkit/entry_open.py` (kuruluş, tercih ağırlığı, kohort), `simkit/entry_open_meas.py` (durum, ölçüm sütunları `eo_*`, koşu sonu `.eo.json`), bağlantılar `week_people.py`, `week_open.py`, `credit_core.py`, `media.py`, `dao.py`, `sector_core.py`, `measure.py`, `results.py`. Bayrak açıkken `R["eo"]`.

Kapılar: `tools/gate.py --tier fast,mid --jobs 3 --no-speed` YEŞİL (31 senaryo aynı, digest 101 hf özdeş, para korunumu 4,8e-14, layer_lint temiz); `tools/test_all.py` YEŞİL. Yeni birim testleri (`EntryOpenTests`, 8 test): itibar kredi tavanını etkilemiyor (REP 0 ve 100 aynı kredi, düşük itibarda faiz aynı ya da yüksek); harç + sermaye krediyle karşılanıyor (kurucunun bakiyesi değişmez, şehir harcı alır, firma kasası = FOUND_BUF × işletme sermayesi); havuz boşken kuruluş bekler ve aynı kuruluş tek kez gecikme sayılır, havuz gelince sıradaki loncadan kurulur; kohort sayısı, 20-30. hafta zamanlaması, her (şehir, tür) için en az 2 rakip, tek oyuncu tek firma, zincir sırası, K-77; genç verim tabanı; girdisi hiçbir yerde üretilmeyen ürüne giriş yok; göç etmiş oyuncu seçilmez; para korunumu; bayrak kapalıyken iz yok.

Not: ilk ölçüm turunda 36 koşunun 16'sı çöktü (kohort kurucusu başka şehre göç etmiş bir oyuncuyu seçince oyuncu listeleri tutarsız kalıyordu). Düzeltildi (birim testli) ve 36 koşunun hepsi yeniden koşuldu; aşağıdaki tüm sayılar düzeltilmiş koddan.

## Ölçüm
Koşul: `PYTHONHASHSEED=0`, 200 hf, 5 şehir, paralel en çok 3; ortak bileşim NPC_KEEP=2, FOUND_COLLAT=1, WAGE_TAX=0.1, CORP_TAX=0.2, INFRA_CONT=1, SHRINK_FIRST=1, ORDER_BOOK=1, NO_BAILOUT=1; 6 PM_ADJ (0,078 ... 0,088). Çöküş = talep karşılama < 0,5 olan ilk hafta (hf ≥ 20). Sütunlar: **bA** taban (pano, ENTRY_OPEN yok); **bC** pano + K-211; **bG** pano (giriş kuralı kapalı) + K-211 (K-212'nin en iyisi). **Ea** = (a) SECTOR_BOARD + ENTRY_OPEN; **Eb** = (b) + TRANS_SUPPORT; **Ec** = (c) yalnız ENTRY_OPEN (pano kapalı). Sonundaki `0` = K-77 korunuyor (`NPC_LAB_PF=0`: oyuncu firması yalnız oyuncu çalıştırır); `1` = K-77 gevşek (`NPC_LAB_PF=1`, modelin varsayılanı: oyuncu firması NPC işçi alabilir, K-185.15). Taban sütunlarının hepsi `NPC_LAB_PF` varsayılanında (1); yani Ea1/Eb1/Ec1 tabanla doğrudan kıyaslanır, Ea0/Eb0/Ec0 K-77'nin etkisini de içerir.

| PM_ADJ | bA taban | bC pano+K211 | bG pano−giriş+K211 | Ea0 | Eb0 | Ec0 | Ea1 | Eb1 | Ec1 |
|---|---|---|---|---|---|---|---|---|---|
| 0.078 | 63 | 80 | 86 | 66 | 80 | 79 | 78 | 80 | 79 |
| 0.080 | 81 | 74 | >200 | 73 | 77 | 66 | 74 | 83 | 76 |
| 0.082 | 71 | 78 | 85 | 70 | 80 | 60 | 76 | 81 | 73 |
| 0.084 | 75 | 76 | 74 | 81 | 91 | 64 | 84 | 77 | 74 |
| 0.086 | 67 | 73 | 110 | 81 | 80 | 65 | 72 | 79 | 75 |
| 0.088 | 91 | 54 | 89 | 78 | 81 | 76 | 85 | 83 | 75 |
| **medyan / min** | 73 / 63 | 75 / 54 | **87,5 / 74** | 75,5 / 66 | **80 / 77** | 65,5 / 60 | 77 / 72 | **80,5 / 77** | 75 / 73 |
| son 30 hf karşılama ≥ %50 (koşu sayısı) | 0/6 | 0/6 | 1/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 |
| son 30 hf ortalama karşılama | 0,105 | 0,073 | 0,250 | 0,020 | 0,038 | 0,024 | 0,021 | 0,022 | 0,019 |

(bA, bC, bG K-212 raporundaki A, C, G sütunlarıyla aynı çıktı: 73/63, 75/54, 87,5/74.) Okuma:
- Açık kapılar + geçiş desteği (Eb) en iyi EO bileşimi: medyan 80, en kötü 77 (bC: 75 / 54; yani en kötü koşu belirgin düzeliyor), ama K-212'nin giriş kuralı kapalı + K-211 bileşiminin (bG: 87,5 / 74, bir koşu hiç çökmedi) gerisinde.
- Pano kapalı, yalnız kapılar açık (Ec0) tabandan kötü (65,5 / 60); Ec1 (K-77 gevşek) ise tabanla aynı (75 / 73). Yani kapı açmak tek başına ne iyi ne belirgin kötü; çökmeyi önleyen K-211 desteği.
- K-77 etkisi çöküş haftasında küçük (Ea0 75,5 / 66 ile Ea1 77 / 72; Eb0 80 / 77 ile Eb1 80,5 / 77; Ec0 65,5 / 60 ile Ec1 75 / 73): K-77 yalnız pano kapalıyken açıkça kötü (Ec).
- Çöküşten sonra EO koşulları taban koşullarından kötü: son 30 haftada ortalama karşılama 0,02-0,04 (taban 0,07-0,25). Sebep: çöküş anında oyuncu firması kalmıyor (aşağıda) ve tabanın aksine toparlanma gelmiyor.

### Oyuncu firması sayısı zamanla (6 koşu ortalaması, canlı oyuncu firması)
| hf | 20 | 25 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 | 125 | 150 | 200 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bA | 1 | 4 | 7 | 13 | 16 | 40 | 60 | 43 | 33 | 21 | 16 | 9 | 10 |
| bG | 0 | 1 | 4 | 6 | 10 | 34 | 46 | 62 | 67 | 61 | 49 | 29 | 16 |
| Ea0 | 22 | 73 | 68 | 56 | 52 | 47 | 32 | 15 | 6 | 2 | 17 | 4 | 0 |
| Eb0 | 22 | 73 | 68 | 55 | 60 | 53 | 45 | 30 | 11 | 2 | 8 | 8 | 1 |
| Ea1 | 21 | 68 | 62 | 61 | 59 | 53 | 42 | 20 | 3 | 4 | 14 | 2 | 1 |
| Eb1 | 21 | 68 | 62 | 62 | 60 | 58 | 56 | 32 | 9 | 0 | 13 | 12 | 1 |

Taban 60-80. haftada daha çok firma kuruyor (kıtlık gelince girişimci yükselişi), EO 25. haftada zirve yapıp 100. haftada hemen hemen sıfıra iniyor.

### Rakip kohortu (K-77 korunan Ea0 ve Eb0, 6 koşu toplamı 1.488 slot; K-77 gevşek Ea1 ve Eb1)
| ölçü | Ea0 | Eb0 | Ea1 | Eb1 |
|---|---|---|---|---|
| kurulan / planlanan | 1.317 / 1.488 | 1.263 / 1.488 | 1.331 / 1.488 | 1.369 / 1.488 |
| havuz yüzünden geciken kuruluş (20-30. hf programından sonra) | 749 (yüzde 50) | 749 (yüzde 50) | 749 (yüzde 50) | 749 (yüzde 50) |
| 200 hf'de hiç kurulamayan | 171 (yüzde 11) | 225 (yüzde 15) | 157 (yüzde 11) | 119 (yüzde 8) |
| kurulanların ortalama gecikmesi | 13,7 hf | 11,8 hf | 18,1 hf | 21,1 hf |
| 25. hf kurulan (ort) / canlı | 123 / 73 | 123 / 73 | 123 / 68 | 123 / 68 |
| 60. hf kurulan / canlı | 191 / 32 | 190 / 34 | 182 / 44 | 188 / 41 |
| 52 hf sağkalım (52 hf yaşayabilen kohort firmaları) | yüzde 6,6 (87/1.317) | yüzde 10,2 (129/1.259) | yüzde 11,0 (147/1.331) | yüzde 11,8 (161/1.362) |
| organik firma 52 hf sağkalım | yüzde 0,8 (5/604) | yüzde 0,3 | yüzde 0,2 | yüzde 0,3 |
| 12. hf'de kadro ≤ 2 kişi (ayakta olanlar) | yüzde 66 | yüzde 62 | yüzde 47 | yüzde 52 |
| 26. hf'de kadro ≤ 2 / ortalama kadro | yüzde 37 / 4,6 | yüzde 41 / 4,4 | yüzde 29 / 7,0 | yüzde 31 / 6,7 |
| 52. hf'de kadro ≤ 2 / ortalama kadro | yüzde 18 / 9,4 | yüzde 26 / 7,6 | yüzde 39 / 7,6 | yüzde 27 / 9,4 |
| ortalama kuruluş kredisi (harç dahil) | 534 Akçe | 515 | 482 | 544 |
| lonca sırası değişen kuruluş ("sonraki lonca", toplam) | 539 | 602 | 352 | 642 |

(Gecikme sayımı: planlanan haftadan sonra kurulan ya da hiç kurulamayan slot. Havuz boşken aynı slot her hafta yeniden denenir; plan sırası korunur.)

Kohortun kredi havuzuna etkisi (6 koşu ortalaması, lendable): 20. hf 27 bin (tabanda 33 bin), 25. hf 6,5 bin (tabanda 40 bin), 30. hf 4 bin, 60. hf 2 bin. Açık kredi 67-75 bin (tabanda 45-59 bin). Yani ilk 123 kohort firması havuzu bitiriyor; kalanı 31. haftadan sonra geri ödemelerle ve mevduat girişiyle teker teker kuruluyor. Temerrüt (kümülatif, tüm kredi türleri): Ea0 200. haftada 35, Eb0 58 (Ec0 33, Ea1 34).

### Kohort firmalarının türe göre yaşama durumu (Ea0, Eb0, Ea1, Eb1, 24 koşu toplamı)
12 hafta sonra ayakta kalma: market 487/500, un 238/240, firin 240/240, kola 96/96, sise_sut 96/96, lojistik 176/240, tarla_bugday 82/96, cam 52/96, ulasim 94/240, guvenlik 106/240, santral 114/240, maden_komur 36/96 ... **eglence 0/240, kuyumcu 0/240, restoran 1/240 (neredeyse hiç), insaat 5/240 (neredeyse hiç), eczane 0/235, hastane 0/230, ilac 0/230, medya 0/105, okul 0/98, universite 0/90, kereste 0/96, maden_altin 0/96, tarla_pamuk 0/96, petrol 0/48, plastik 0/48**. Bu 15 türün çoğu perakende/hizmet ya da yeni sektör; başka bir kısmı ham madde. Üç firmanın izi (eğlence, 21. hf'de kurulan, FOUND_BUF=8 ile izlendi): firma 87-102 Akçe nakitle başlıyor, kuruluşu izleyen haftada 28 Akçe satış alıyor, 85-89 Akçe ücret + 14 kira ödüyor, kasa bitiyor, tek çalışan (kurucu) ücret alamayınca ayrılıyor ve firma batıyor (FOUND_BUF=3'te guvenlik/santral/petrol/pamuk firmalarında da aynı: kasa 0-20 Akçe, 1-3 haftada ölüm). FOUND_BUF=8 ile bir deneme (70 hf, Ea0 0,080) bu türlerin hiçbirini kurtarmadı (eglence 0/10, kuyumcu 0/10, kereste 0/4, petrol 0/2 ...), yani sorun kuruluş sermayesinin büyüklüğü değil, yeni firmanın ilk haftalarda yerleşik NPC firmalar karşısında satış bulamaması. (Bu üç iz ve 70 haftalık deneme tek koşu; kanıt düzeyi: işaret.)

### NPC'ler, krediler, servet
- NPC üretim payı (satılan üretim değerinde NPC): 30. hf 0,59-0,73, 60. hf 0,10-0,34 (oyuncu firmaları üretimin üçte ikisinden fazlasını yapıyor ama çöküşle birlikte siliniyor), 100. hf 0,61-1,0. Taban koşularının eşdeğer ölçümü yok (ölçüm bayrak açıkken eklendi); bu yüzden NPC payı yalnız EO koşuları içinde okunabilir.
- NPC firma sayısı: 200. hf'de EO 63-71, taban bA 98, bG 128 (yani EO'da NPC sayısı daha az). NPC batışı (kümülatif, 100. hf / 200. hf): bA 212 / 425, bC 129 / 369, bG 88 / 328; Ea0 217 / 382, Eb0 136 / 346, Ec0 206 / 364, Ea1 214 / 378, Eb1 137 / 354. Yani geçiş desteği (b) batışları 100. haftaya kadar yüzde 35-40 azaltıyor, kapıların açılması etkilemiyor.
- Servet: oyuncu Gini'si 50. hf'de 0,82-0,89 (taban 0,82), 100. hf'de 0,73-0,85 (taban 0,86), 200. hf'de 0,89-0,92 (taban 0,93). Fark küçük. Koşu sonunda kurucu işaretli oyuncuların (6 koşu toplamı 206 kişi, Ea0) servet medyanı 3.402 Akçe (p90 14.636, en çok 40.796), kurucu olmayanların (8.794) medyanı 0 (p90 2.193). Kurucuların zenginleşmesi kısmen bu oyuncuların zaten çalışan olmaları, kısmen firma sahibi olarak ücret + kâr almaları (kredi parasıyla ücret ödenmesi). Bu açıklamayı sınamadım; yalnız dağılım ölçüldü.
- Genç firma kredisi hacmi: bkz. kohort tablosu (ortalama 482-544 Akçe, toplam 6 koşuda 650-745 bin). Temerrüt sayısı kümülatif 33-58; çoğu firma temerrüde gitmeden tasfiyeyle kapanıyor (alacaklı önce: kredi tasfiye).

## K-77'nin etkisi (ayrı)
K-77 (oyuncu firması NPC işçi almaz) modelde varsayılan olarak gevşek (`NPC_LAB_PF=1`, K-185.15). Karar metni K-77'nin korunmasını söylediği için ana koşullar `NPC_LAB_PF=0` ile (Ea0, Eb0, Ec0), karşılaştırma `NPC_LAB_PF=1` ile (Ea1, Eb1, Ec1) koşuldu.
- Kadro: 30. hf'de canlı kohort firmalarının ortalama kadrosu K-77 ile 2,2 (Ea0), K-77 yokken 3,6 (Ea1); 1-2 kişide kalan firma payı yüzde 71'e karşı yüzde 37 (30. hf, Ea0: 48 / 68 canlı firma; Ea1: 23 / 62). 26. haftada ortalama kadro 4,6'ya karşı 7,0; 52. haftada 9,4 ve 7,6 (ayakta kalanlar seçilmiş: büyüyenler hayatta kalıyor).
- Sağkalım: kohort firmalarının 52 hf sağkalımı yüzde 6,6'ya karşı yüzde 11 (Ea) ve yüzde 10,2'ye karşı yüzde 11,8 (Eb).
- Çöküş haftası: neredeyse etkisiz (Ea 75,5/66 ile 77/72; Eb 80/77 ile 80,5/77). Pano kapalı Ec'de K-77 açıkça zarar veriyor (65,5/60 ile 75/73).
- Anlam: yeni oyuncu firması çalışan bulamayınca büyüyemiyor; ama oyuncu sayısı sınırlı (kohort 248 kurucu ve onları çalıştıracak oyuncular) ve büyük kısmı zaten ilk haftalarda batıyor, bu yüzden K-77 çöküş haftasını değiştirmiyor. K-77 gevşetilirse sağkalım ve kadro belirgin iyileşir ama çöküşü önlemez. Kararı sahibe bırakıyorum.

## Gerçek dünya karşılığı ve kalibrasyon
| Parametre | Değer | Referans | Güven |
|---|---|---|---|
| `EO_SKILL` 1,15 | NPC dağılımı ortalaması | Modelin kendi basamak dağılımı (PROD_TIER 1,0/1,3/1,6; yüzde 60/30/10); dış kaynak gerekmiyor | model içi |
| `EO_RATE` 0,002 / aday / hf (oyuncu başına yılda yaklaşık yüzde 10) | gerçek yetişkin girişimci oranı yılda yaklaşık yüzde 2-4; oyunda girişimci oyuncu seçilmiş kitle varsayımı | doğrulanmadı | varsayım |
| `EO_COHORT_PER` 2, 20-30. hf, `EO_COHORT_*` | sahip kararı | karar metni | karar |
| `EO_CROWD` 4, `EO_IMP_PEN` 0,5, `EO_W_SIG_CAP` 4 | tercih ağırlığı katsayıları | sezgisel; duyarlılık taranmadı | varsayım |
| Kuruluş kredisi = harç + FOUND_BUF × işletme sermayesi | FOUND_BUF=3 (K-164 kararı) | gerçek: KOBİ kredisi 1-3 aylık gider | modelin mevcut değeri |

## Sınırlar ve açık işler
- Her sütunda yalnız 6 koşu; gürültü ±10 hf. 500 hf koşusu yapılmadı.
- Lonca havuzu darboğaz olarak ölçüldü ama havuz büyüklüğü duyarlılığı koşulmadı (başlangıç havuzu oyuncu mevduatından oluşuyor; tek parametre yok). "Havuz bolsa kohort ne kadar yaşar" sorusu açık; birim testte (bol havuzla) kohort tamamen zamanında kuruluyor.
- Kohort firmalarının büyük bölümü sektör özelliği yüzünden (satış bulamama) batıyor; bu bir uygulama hatası değil ama kohortun anlamını sorgulatır: eğlence, restoran, hastane, eczane, okul, medya, kuyumcu gibi türlerde yeni küçük firmanın NPC karşısında satış payı kurulamıyor. Seçenek: bu türlerde kohortu kurmamak ya da NPC talebini bölüştürerek başlatmak (sahip kararı).
- 52 hf sağkalım ölçüsü çöküş dönemine denk geldiği için firma kalitesinden çok çöküşü ölçüyor (20-45. haftada kurulan firmaların 52. haftası 72-97. haftaya düşüyor).
- Ar-Ge DAO itibar eşiği de ENTRY_OPEN'la kalkıyor (`EO_NOREP_DAO`=1); "DAO/firma" ifadesinden çıkarılan yorum, sahip onayı gerekir.
- NPC pazar payı yalnız ENTRY_OPEN koşullarında ölçüldü.

## Yeniden üretim
`MODEL_PARAMS="NPC_KEEP=2,FOUND_COLLAT=1,WAGE_TAX=0.1,CORP_TAX=0.2,INFRA_CONT=1,SHRINK_FIRST=1,ORDER_BOOK=1,NO_BAILOUT=1,PM_ADJ=<pm>,SECTOR_BOARD=1,ENTRY_OPEN=1,NPC_LAB_PF=0[,TRANS_SUPPORT=1]" WEEKLY_CSV=<yol> PYTHONHASHSEED=0 python3 model_mod.py --weeks 200` (Ea0, Eb0; Ec: SECTOR_BOARD yok; "1" koşullarında NPC_LAB_PF=1). Ölçüm sütunları `eo_*` (kohort/organik sayaçları, havuz gecikmesi, kadro, NPC/oyuncu üretim payı, servet, temerrüt); koşu sonu `<csv>.eo.json` (kuruluş kayıtları, plan, servet dağılımı). Ham çıktılar git'e eklenmedi (scratch). Düzeltme: ilk turda göç etmiş kurucu hatası (bkz. yukarıdaki not).
