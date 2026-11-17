# v13.0: yeni varsayılanlar, çakışma denetimi ve ayıklama

**Sonuç.** Ekonomi artık 200 haftada çoğu koşuda ayakta, ama 500 haftada hâlâ değil. Son pakette (aşağıdaki "açık" listesi) 200 haftalık 12 koşunun 7'si hiç çökmüyor (talep karşılama hiç %50'nin altına inmiyor), 9'u son 30 haftayı %50'nin üstünde bitiriyor; en kötü çöküş 76. hafta. Bu, eski en iyi tabanın (medyan çöküş 73. hafta, 0/6 ayakta) belirgin üstünde. 500 haftada 3 koşunun 3'ü de sonunda çöküyor (312., 280. ve 100. hafta; son haftada talep karşılama %19, %2, %0). Yani paket orta vadeyi taşıyor, uzun vadeyi taşımıyor. Sahibin isteğinin iki parçasını ölçüm tuttu, ikisini tutmadı: **genç firma kiti (K-216) ve girişim kapıları + rakip kohortu (K-213/K-215b) kapalı gönderildi**, çünkü ölçümde ekonomiyi açıkça kötüleştirdi (ikisi açıkken 0/12 hiç çökmeyen, kapalıyken 7/12). Silinmediler: `YOUNG_KIT=1` ve `ENTRY_OPEN=1` ile açılır. Çakışma denetiminde iki gerçek hata bulundu ve düzeltildi (kohort planı tek şehrin boş fonuyla duruyordu; genç firma panonun işe alım bekletmesine takılıyordu).

Ham çıktılar git dışındadır (`ornek-ciktilar/v13/`); koşucular ve özet tablolar `ornek-ciktilar/v13-araclar/` altındadır (`ozet_v13.txt`). Hepsi `PYTHONHASHSEED=0`, 200 hf, `PM_ADJ` 0,077…0,088 (ayıklamada 6 çift tohum, doğrulamada 12 tohum), 500 hf için 0,080/0,082/0,084.

## 1. Varsayılanlar

| Parça | v13.0 | Gerekçe |
|---|---|---|
| NPC_KEEP=2, FOUND_COLLAT=1, WAGE_TAX=0,1, CORP_TAX=0,2, INFRA_CONT=1, SHRINK_FIRST=1, ORDER_BOOK=1 | açık | Gece kombinasyonu. Ayıklamada (son paket tabanında) hiçbiri belirgin kötü çıkmadı; WAGE_TAX, SHRINK_FIRST, INFRA_CONT, ORDER_BOOK kapatılınca ayakta kalan sayısı 0-1/6'ya düştü (yararlı); NPC_KEEP ve FOUND_COLLAT ve CORP_TAX nötr (gürültü içinde): sahibin "mümkün olduğunca açık" ilkesiyle açık. |
| TRANS_SUPPORT=2 (tavan 28 bin/hf, özel pay eşiği 0,6, derin taban 0,5 hf: K-211 v2 raporunun "tam tarif" değerleri) | açık | Kapatılınca 0/6 ayakta (açıkken 4/6): ekonomiyi taşıyan ana parça. Net maliyeti 200 hf'de ortalama ~455 bin Akçe (~2,3 bin/hf), basımsız. Tam destek (tavan ve taban yok) daha iyi sonuç verir ama haftada ~9 bin Akçe: raporun önerisi tam tarif, o korundu. |
| TRANS_PRIV_OK=0 (destek sürerken özelleştirme yok) | açık | K-214. `=1` yapılınca 0/6 ayakta. Kod zaten böyleydi (mod 2'de destek oranı > 0 olan (şehir x tür) çiftinde özelleştirme engelli, oran 0 olunca açılır); kodda değişiklik gerekmedi. |
| SECTOR_BOARD=1, SB_ENTRY_PERSIST=-1 | açık / giriş kuralı kapalı | Pano kapatılınca 3/6 ayakta (açıkken 4/6): nötr, açık kaldı. Giriş kuralı K-212 raporunun önerisiyle kapalı. |
| NO_BAILOUT | açık | Kurucunun ilkesi; destek K-211 kanalından. |
| FOUND_FUND=1 | açık | K-215a. ENTRY_OPEN kapalıyken pasif (fona hiçbir kredi çıkmaz, ölçümde fon izi 0): zararsız. |
| **YOUNG_KIT=0** | **kapalı** | Ayıklama: kapatınca medyan çöküş 92'den 108,5'e (12 tohum), kohort sağkalımı ise %53'ten %16'ya düşüyor (kit firmaları yaşatıyor ama fon tükeniyor ve ekonomi daha erken çöküyor). Kapalıyken ENTRY_OPEN de kapatılınca 7/12 ayakta. Alt anahtar denemeleri (ortaklı kuruluş, giriş fiyatı, işe alım hızı, dayanma süresi, ödemesiz dönem) tek başına net bir suçlu göstermedi (medyan 88-102, gürültü içinde): bu yüzden parça bütünüyle kapalı. |
| **ENTRY_OPEN=0** | **kapalı** | Kit kapalıyken: açık 108,5 / 2/12 son-30; kapalı 201 / 9/12. Kohortsuz açık giriş (`EO_COHORT=0`) medyan 77,5, yalnız kohort (`EO_RATE=0`) 94, geç organik giriş 76: hiçbiri tek başına tutmadı. Kapıların açılması ve kohort oyuncuları NPC işlerinden çekiyor, firmalar ilk yıl batıyor. |
| GOV_PROC, OFFTAKE, ZOMBIE_LIQ, CONSOLIDATE, CHAIN_ORDER, CREDIT_MINT, NPC_WFLEX, CAPEX_REAL, APPR_LEVY, CITY_REBATE, BOND_HH, BRIDGE_REVOLVE, TRANS_SUPPORT=1 | kapalı / yok | Zararı ölçülmüş ya da modülerde yok (talimat gereği). |

Kodda iki tür düzeltme de gerekti: `NPC_KEEP` varsayılanı tamsayı (2) yazılınca `MODEL_PARAMS` 0,5'i 0'a kesiyordu (sıfıra bölme çökmesi); `2.0` ve `SB_ENTRY_PERSIST=-1.0` yapıldı.

## 2. Çakışma denetimi (kod okunarak)

| Kesişme | Risk | Karar | Değişiklik |
|---|---|---|---|
| Pano işe alım bekletmesi (`sb_hire_ok`) x genç kit talebe bağlı alım | Sektör stoku fazlaysa genç firma kendi sipariş açığına rağmen alamaz; iki kural aynı kararı veriyor | Genç firma kendi siparişine ve pano kıtlığına göre (`yk_target`) alır, bekletmeye tabi değil. 100 hf'de bekletme zaten yalnız 2 kez tetiklendi | `week_people.py` (ayrı commit) |
| SHRINK_FIRST x talebe bağlı alım | Zarardaki genç firma çıkarılıyor, ertesi hafta yeniden alınıyor (salınım) | Sayaç: 100 hf'de 528 küçülme, 276 salınım (%52). Sahip "küçülme muafiyeti yok" demişti; muafiyet verilmedi, alım tarafına `YK_REHIRE_WAIT` (küçültmeden sonra bekleme) eklendi. 8 hf ile ölçüldü: etkisiz (medyan 92, gürültü). Varsayılan 0; kit zaten kapalı | `young_kit.py`, `params.py` |
| FOUND_FUND tek alacaklı x lonca büyüme/yatırım kredisi | Fon borcu olan genç firma lonca kredisi alamaz | Bilinçli (K-215). Fon limiti (dayanma + yuva) büyüme ve yatırımı karşılıyor; asıl sorun fonun kendisi: 100 hf'de fon bakiyesi 130 bin'den 3 bin'e indi, alacak 71-133 bin. Fon kapasitesi kit için darboğaz | Kit kapalı, değişiklik yok |
| Kohort planı x şehir başına fon | **Gerçek hata:** bir şehrin fonu boşken `break` 248 firmalık planın tamamını durduruyordu (100 hf'de yalnız 8 kohort firması, 240 bekleyen) | Fon şehir başınaysa yalnız o şehrin sırası beklesin | `entry_open.py` (ayrı commit); düzeltmeyle kohort 120'ye çıktı (fon tükenince duruyor) |
| TRANS_SUPPORT=2 x NPC_KEEP / INFRA_CONT | NPC_KEEP tamponu ve destek aynı açığı iki kez kapatır mı | Fon borcu olan firmada NPC_KEEP devre dışı (kâr önce fona); tampon yalnız borçsuz firmada. Destek kamu altyapısına (NPC_EXEMPT) verilmez, INFRA_CONT yalnız onlara uygulanır: alanlar ayrık. NPC_KEEP=0,5 ile ölçüm: nötr (4/6 karşı 4/6) | Yok |
| TRANS_PRIV_OK=0 x kohortun NPC pazarına girmesi | Girişle özel pay artar, destek azalır | Tasarım gereği tutarlı (geçiş özel girişle ilerler); özelleştirme yalnız engelli, giriş serbest. Kohort kapalı olduğundan v13.0'da etkisiz | Yok |
| ENTRY_OPEN kapıları x `founding.worth` / `ENTRY_PM` | Eski kapılar hâlâ çalışıyor mu | Açıkken `worth` hiç çağrılmaz (kapılar atlanır); `ENTRY_PM` ve fizibilite `eo_weight`'te yumuşak ağırlığa dönüşmüş (`w_pm`, `w_feas`); tedarikçi sağlığı kapısı açıkken yok. Çelişki yok | Yok |
| Giriş fiyatlaması (K-216.4) x pano fiyat primi x PRICE_V2 | Üç fiyat kuralı üst üste | Giriş maliyeti tam maliyetin (`ucl`) yerine geçer, pano indirimi tabanı aynı `uc`, değişken maliyet tabanı `vc x (1+marj)` hep korunur; prim hedefin üstüne eklenir. Çelişki yok | Yok |
| Lonca itibar karışımı x müşteri skoru | İtibarın başka yerde kullanımı bozulur mu | Yalnız alıcı skorunda, `max(kurum itibarı, karışım)`, 52 hf'de söner; kredi faizi ve kurum itibarı etkilenmez | Yok |
| Kohort kurucu havuzu x ortaklı kuruluş (grup C: 3 oyuncu) x işgücü | Ortaklar NPC işlerinden çekilir | 100 hf'de grup dağılımı C 58, A 10, B 5; kurucu/ortak yok sayacı 0. Havuz yetmedi sorunu çıkmadı ama kurucular işgücünden çekiliyor: bu, ENTRY_OPEN'ın zararlı çıkmasının olası nedenlerinden biri (kanıtlanmadı) | Kapalı |

## 3. Ayıklama tablosu (200 hf)

Ölçütler: çöküş = talep karşılamanın hf 26'dan sonra ilk kez %50 altına indiği hafta; "hiç" = hiç inmeyen koşu sayısı; son30 = son 30 haftada ortalama ≥%50 olan koşu sayısı.

**A. V13 tam paket (YOUNG_KIT ve ENTRY_OPEN açık) tabanında, çıkarılan parça:**

| Koşul | n | çöküş medyan | min | hiç | son30 | yorum |
|---|---|---|---|---|---|---|
| Tam paket | 12 | 92 | 78 | 0 | 1 | |
| YOUNG_KIT çıkar | 12 | **108,5** | 92 | 0 | 2 | +16,5: kötü, kapatıldı |
| ENTRY_OPEN çıkar | 12 | 96,5 | 81 | 0 | **7** | son30 belirgin: kötü |
| FOUND_FUND çıkar | 6 | 79,5 | 74 | 0 | 1 | kötüleşme: kalsın |
| SECTOR_BOARD çıkar | 6 | 83 | 75 | 0 | 0 | kalsın |
| TRANS_SUPPORT çıkar | 6 | 73 | 67 | 0 | 0 | kalsın (en önemli) |
| TRANS_PRIV_OK=1 | 6 | 80,5 | 73 | 0 | 0 | kalsın 0 |
| NPC_KEEP=0,5 | 6 | 99,5 | 78 | 0 | 1 | +11,5 tek başına; 12 tohumla doğrulanmadı, C2 tabanında nötr: kalsın |
| FOUND_COLLAT çıkar | 6 | 88 | 81 | 0 | 0 | tam paketle aynı (kapı açıkken etkisiz): kalsın |
| WAGE_TAX çıkar | 12 | 86,5 | 73 | 0 | 3 | gürültü içinde: kalsın |
| CORP_TAX çıkar | 12 | 97,5 | 79 | 0 | 1 | +5,5 gürültü içinde: kalsın |
| INFRA_CONT çıkar | 6 | 90 | 82 | 0 | 0 | kalsın |
| SHRINK_FIRST çıkar | 12 | 102 | 86 | 0 | 0 | +10 sınırda; ENTRY_OPEN/kit kapalıyken tersi (aşağıda): kalsın |
| ORDER_BOOK çıkar | 12 | 82,5 | 77 | 0 | 0 | kalsın |

**B. Alt anahtarlar (genç kit, 6 tohum, taban medyan 88):** ortaklı kuruluş kapalı 93; giriş fiyatlaması kapalı 99; işe alım haftada 1 kişi 102; dayanma limiti 8 hf 89,5; ödemesiz dönem 13 hf 88; küçültme sonrası bekleme 92. Hiçbiri net: bütün parça kapatıldı.

**C. Kit ve girişim birleşik sınaması (12 tohum):**

| Koşul | çöküş medyan | hiç | son30 |
|---|---|---|---|
| Kit kapalı, giriş açık (kohortlu) | 108,5 | 0 | 2 |
| **Kit kapalı, giriş kapalı = v13.0** | **201 (ayakta)** | **7** | **9** |
| + FOUND_FUND çıkar (kit kapalı, giriş açık) | 102 | 0 | 1 |
| + SHRINK_FIRST çıkar (kit kapalı, giriş açık) | 88 | 0 | 0 |
| Kit kapalı, kohortsuz açık giriş | 77,5 | 0 | 0 |
| Kit kapalı, yalnız kohort (organik yok) | 94 | 0 | 0 |

**D. v13.0 tabanında ayıklama (6 tohum; tabanın aynı 6 tohumda ~4/6 ayakta):**

| Çıkarılan | çöküş medyan | hiç | son30 | yorum |
|---|---|---|---|---|
| TRANS_SUPPORT | 75,5 | 0 | 0 | çok kötüleşir |
| SECTOR_BOARD | 139,5 | 3 | 5 | nötr/biraz kötü |
| TRANS_PRIV_OK=1 | 88 | 0 | 2 | kötü |
| NPC_KEEP=0,5 | 201 | 4 | 5 | nötr |
| SHRINK_FIRST | 144 | 1 | 3 | kötüleşir |
| CORP_TAX | 155,5 | 3 | 5 | nötr |
| WAGE_TAX | 146 | 1 | 3 | kötüleşir |
| INFRA_CONT | 99 | 0 | 3 | kötüleşir |
| ORDER_BOOK | 104 | 0 | 5 | kötüleşir |
| FOUND_COLLAT | 201 | 4 | 6 | nötr |

Hiçbir gece parçası kapatınca belirgin iyileşmedi: hepsi açık kaldı.

**E. v13.0, 200 hf x 12 tohum ortalama dönemler:** talep karşılama hf 27-60 0,95; 61-100 0,85; 101-150 0,78; 151-200 0,79; çalışan 1445 -> 1011, işsiz 195 -> 640; şehir kasası 235 bin -> 156 bin (5 şehir); sepet fiyat endeksi ~184 (hf 200); servet Gini 0,89; oyuncu firması ~55; destek fonu net maliyeti ~455 bin Akçe (200 hf). Fon izi (kuruluş fonu) 0. Kohort sağkalımı ölçülemez (kohort kapalı). Son hafta talep karşılaması: 12 koşunun 9'unda ≥0,92; 3'ünde çökmüş (0,15, 0,44, 0,01).

**F. 500 hf x 3 (0,080/0,082/0,084):** çöküş 312 / 280 / 100; hf 200'de üçünde de talep karşılama 0,97-0,98; hf 500'de 0,19 / 0,02 / 0,00. Destek fonu net ~946 bin Akçe. İşsizlik (son 50 hf) ~1418, Gini 0,92.

## 4. Kalan riskler

1. **500 haftada çöküş sürüyor.** 200 haftalık "ayakta" sonucu uzun vadeyi garanti etmiyor; K-211 v2 raporunun saptadığı geçiş sorunu (özel pay eşiğe hiç yaklaşmıyor, destek kalıcı gider) ve fon/kasa erimesi aynen duruyor.
2. **Tohum duyarlılığı yüksek**: 12 tohumda 5'i hf 200'den önce çöküyor ya da son 30 haftada düşüyor; ±10 hf gürültü payı ayıklama kararlarında sınırda kalanları (SHRINK_FIRST, CORP_TAX, NPC_KEEP) belirsiz bırakıyor. Karar kuralı sıkı tutuldu: yalnız YOUNG_KIT ve ENTRY_OPEN belirgin çıktı.
3. **Sahibin istediği iki özellik kapalı.** Genç kit fonu tüketiyor (fon 50. haftada bitiyor), girişim kapıları ve kohort işgücünü çekiyor ve firmalar ilk yıl batıyor (K-213: %7-12 sağkalım). Açılabilmeleri için fon boyutu (`FF_SHARE`, `FF_WEEKLY`) ve kohort büyüklüğü (`EO_COHORT_PER`) ölçekli yeniden ayarlanmalı; bu ayrı bir iş.
4. **Etkileşim belirsizliği**: ayıklama tek parça çıkarma üzerinedir; iki parçanın birlikte etkisi (örneğin ENTRY_OPEN açık + SHRINK_FIRST kapalı) yalnız birkaç kombinasyonda sınandı.
5. **Eski varsayılan karşılaştırması artık `--legacy` ile**: v13.0 altınları artık orijinal `model.py` ile aynı değildir; bu denklik yalnız eski bayrak değerleriyle (LG_h8, LG_h100, `gate.py --legacy`) korunur.
