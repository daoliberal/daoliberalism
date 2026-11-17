# Birleşik ölçüm: dört davranış modülü birlikte (v13.0 üstüne)

**Sonuç.** Birleştirilmiş kod bayraklar kapalıyken v13.0 ile bit-bit aynı (gate fast+mid YEŞİL, `test_all` YEŞİL) ve dört bayrak birlikte açıkken de para korunumu ve para yaratımı kaydı tutuyor. Ölçümde **hiçbir birleşim 500 haftada çökmeden bitmiyor** (en iyisi 3 tohumdan 1'i hiç çökmedi, 2'si son haftalarda %50 üstü talepte). 200 haftada v13.0 tabanı (7/12 hiç çökmüyor) **aşılmadı**: en iyi sonuç TKP4 (T+K+PROFIT_KEEP, PK_WEEKS=4) 8/12; T, K ve T2K tabanla aynı 7/12 (ama son 30 haftada talep ≥%50 olan koşu 9/12'den 11-12/12'ye çıkıyor). ENTRY_EXP birleşimlerin hepsini belirgin kötüleştiriyor (ALL 0/12, 12 koşunun hepsi hf 54-77'de çöküyor). RATE_BEHAV ve kasa/kredi kombinasyonları gürültü düzeyinde. Bulgu: modüller Kalecki kısıtını (toplam kâr ≈ 0) gevşetmiyor; para stoku %19-39 büyüyor ama firma kârı pozitife dönmüyor.

Kısaltmalar: **B** = v13.0 tabanı; **T** = `TREASURY_RULE=1` (K-219); **K** = `CREDIT_MONEY=1` (K-218); **P** = `PROFIT_KEEP=1` (K-220; `P4`, `P8` = `PK_WEEKS` 4/8); **E** = `ENTRY_EXP=1`; **R** = `RATE_BEHAV=1` (+ `RB_CREDIT=1`). `T2K` = T+K ve `TR_WEEKS=2`.

## 1. Yöntem

- Kod: `simulasyon-birlesik` dalı (v13.0 + K-218..K-220 kararları + dört modül, bayraklar varsayılan kapalı). Hepsi `PYTHONHASHSEED=0`, 5 şehir.
- Tohumlar rapor-v13.0.md ile aynı: 200 hf için `PM_ADJ` 0,077...0,088 (12), 500 hf için 0,080/0,082/0,084. B'nin 200 hf sonucu v13.0 raporuyla aynı (7/12 hiç çökmüyor, 9/12 son 30 hf ≥%50, çöküşler 76/77/77/100/151); yani tabanı yeniden üretti.
- Çöküş = hf > 26 iken talep karşılama < 0,5 (v13.0 tanımı). Para stoku `para_toplam`; şehir kasası payı = `para_sehir/para_toplam` (son 50 hf); toplam firma kârı = firma gelir-gider defteri toplamı (`L.frev - L.fexp`, K-218 raporundaki tanım; yeni davranışsız `bm_kar_defter` sütunu, `KK_MEAS=1`); firma boyutu = `kk_kadro_ort` (NPC firma kadro ortalaması, son 50 hf). 52 hf firma sağkalımı yalnız `ENTRY_EXP` koşularında ölçülebiliyor (eo kaydı); diğerlerinde batan firma sayısı (kümülatif) verildi.
- Ham çıktılar `ornek-ciktilar/birlesik/` (git dışı); koşucular ve tablolar `ornek-ciktilar/birlesik-araclar/` (`kos.sh`, `batch200.sh`, `batch2.sh`, `yapilandirmalar.txt`, `ozet.py`, `ozet_birlesik_200.txt`, `ozet_birlesik_500.txt`).
- Not: n = 12 tohumda 7/12 ile 8/12 arası fark gürültüdür (v13.0 raporu: ±10-30 hf; sayım ±2). Yalnız 3+ koşu fark eden sonuçlar yorumlandı.

## 2. Birleştirme ve etkileşim denetimi

Birleştirme çatışmaları (tümü bayrakları koruyarak çözüldü): `atamalar/modules_v2.json` (üç modül eklendi, `layer_lint` temiz), `params.py`, `measure.py`, `.gitignore`, `test_units.py` (iki tarafın da eklemeleri korundu), `ledger.py` (`cexp` koşulu `TRANS_SUPPORT or FOUND_FUND or TREASURY_RULE` + K-218'in basım/yakım alanları). Para korunumu: `gate.py --cm-params` seçeneği eklendi; `CREDIT_MONEY=1,TREASURY_RULE=1` (91 hf): |total-minted| 5,0e-13; beşi birden (T,K,P,E,R, 91 hf): 3,8e-14; her ikisinde de `total = mali basım + kredi basımı - kredi yakımı` tutuyor.

Kancaların okunmasıyla bulunan çakışma adayları ve karar:

| Kesişme | Değerlendirme | Karar |
|---|---|---|
| PROFIT_KEEP temettüsü (`pk_div`/`pk_distribute`, NPC hanelerine) x TREASURY_RULE hane transferi (`tr_step`, şehir sakinlerine) | Farklı kaynaklar (firma fazlası ve şehir kasası), aynı alıcı sınıfı; çift sayım yok (hepsi `L.pay`, korunum testleri yeşil). Ama P, NPC kâr süpürmesini (kasanın ana geliri) kapattığı için kasayı boşaltıyor: kasa payı %34 -> %15-17, T'nin harcayacağı fazla da küçülüyor | Kod değişikliği yok; sonuçta belgelendi (bölüm 4) |
| CREDIT_MONEY basımı x PROFIT_KEEP tamponu | Kredi basımı firmalara nakit yetişmediği için değil talep kuralları yüzünden sınırlı (K-218 raporu); P'nin tamponu firma nakdini 2,5 kat yapıyor (hf 60, 4 tohum: 95 bin -> 238 bin) ama kredi talebini artırmıyor: iki mekanizma birbirini beslemiyor, çatışmıyor | Değişiklik yok |
| ENTRY_EXP kurucu sermayesi (`EE_OWN` %30 hane birikimi, kalanı lonca kredisi) x CREDIT_MONEY | Kurucu kredisi `cx_lend` yolundan geçiyor, basım/yakım kaydı ortak; korunum testi yeşil. Çift sayım yok | Değişiklik yok |
| RATE_BEHAV kredi talebi (`rb_credit_factor`) x CREDIT_MONEY PD rasyonlaması | İkisi de talebi/arzı ayrı kapılardan kısıyor (çarpan x `pd_ok`); çarpımsal, çakışma yok | Değişiklik yok |
| TREASURY_RULE hedefi (`TR_WEEKS` = 4 hf gider) x para ölçeği | Tabanda şehir kasaları para stokunun %34'ünü (bazı tohumlarda %55) tutuyor; 4 haftalık hedef ~%40'a denk geliyor: kural ölçek bakımından gevşek | `T2K` ek yapılandırması (`TR_WEEKS=2`) ölçüldü |

Gerçek bir çift sayım ya da çatışma bulunmadı; kodda düzeltme yapılmadı (yalnız ölçüm sütunu `bm_kar_defter`, `bm_kar_ema` ve `gate --cm-params`).

## 3. Sonuçlar (200 hf x 12 tohum)

| koşul | hiç çökmeyen | son30 talep ≥%50 | çöküş medyan / en erken | talep son hf | destek fonu net (bin) | para stoku (bin) | kasa payı | firma kârı /hf | kadro ort. | işsiz | batan firma |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **B** (v13.0) | 7/12 | 9/12 | 201 / 76 | 0,77 | 455 | 462 | %34 | -15,5 bin | 3,06 | 640 | 94 |
| T | 7/12 | 12/12 | 201 / 73 | 0,87 | 479 | 458 | %35 | -14,9 bin | 3,64 | 478 | 87 |
| K | 7/12 | 12/12 | 201 / 74 | 0,94 | 532 | 551 | %47 | -14,7 bin | 3,21 | 376 | 94 |
| T+K | 4/12 | 11/12 | 156 / 73 | 0,84 | 460 | 563 | %36 | -15,0 bin | 3,61 | 440 | 96 |
| T+K+P4 | **8/12** | 11/12 | 201 / 76 | 0,83 | 434 | 602 | %17 | -23,0 bin | 4,22 | 619 | 94 |
| T+K+P8 | 4/12 | 12/12 | 116 / 74 | 0,91 | 373 | 616 | %15 | -23,0 bin | 4,00 | 647 | 103 |
| T+K+E | 2/12 | 5/12 | 74 / 66 | 0,46 | 256 | 632 | %8 | -17,9 bin | 2,27 | 1141 | 46 |
| ALL (T+K+P8+E+R) | 0/12 | 0/12 | 72 / 54 | 0,11 | 67 | 641 | %0 | -18,7 bin | 1,33 | 1411 | 24 |
| ALL-P (T+K+E+R) | 0/12 | 8/12 | 78 / 72 | 0,65 | 293 | 619 | %11 | -18,9 bin | 3,03 | 1092 | 53 |
| T+K+R (ek) | 5/12 | 11/12 | 184 / 75 | 0,85 | 470 | 566 | %34 | -14,8 bin | 3,71 | 446 | 88 |
| T2K: T+K, `TR_WEEKS=2` (ek) | 7/12 | 11/12 | 201 / 72 | 0,85 | 412 | 553 | %33 | -13,9 bin | 3,63 | 399 | 77 |
| T+K+P8+R = ALL-E (ek) | 4/12 | 11/12 | 101 / 73 | 0,83 | 348 | 607 | %12 | -22,4 bin | 4,17 | 757 | 92 |

("hiç çökmeyen" = hiç hf > 26 iken talep karşılama < 0,5 olmayan koşu; çöküş medyanında çökmeyen koşu 201 sayılır. 52 hf firma sağkalımı: ENTRY_EXP koşularında yalnız %7 (T+K+E: 199/3054) ve %2 (ALL: 51/2082), ALL-P'de %6; ENTRY_EXP olmayanlarda ölçülemez.) Çöküş haftaları `ozet_birlesik_200.txt` içinde.

## 4. Sonuçlar (500 hf x 3 tohum: 0,080 / 0,082 / 0,084; en iyi üç + taban)

| koşul | hiç çökmeyen | son30 ≥%50 | çöküş haftaları | talep hf 100 / 200 / 300 / 400 / 500 (üç tohum) | destek fonu net (bin) | para (bin) | kadro ort. | işsiz |
|---|---|---|---|---|---|---|---|---|
| B | 0/3 | 0/3 | 312, 280, 100 | 0,91/0,98/0,66/0,42/0,20; 0,95/0,99/0,18/0,01/0,02; 0,49/0,97/0,39/0,02/0,01 | 946 | 538 | 0,64 | 1418 |
| T | 1/3 | 1/3 | -, 251, 152 | 0,92/0,96/0,89/0,81/0,97; 0,92/0,86/0,00/0,00/0,02; 0,78/0,95/0,04/0,05/0,01 | 870 | 514 | 1,31 | 1153 |
| K | 0/3 | 0/3 | 100, 284, 74 | 0,49/0,99/0,86/0,29/0,51; 0,93/0,97/0,07/0,04/0,00; 0,85/0,98/0,96/0,95/0,32 | 1097 | 863 | 0,74 | 1366 |
| T+K+P4 | 1/3 | 2/3 | 76, 302, - | 0,94/0,89/0,94/0,94/0,80; 0,70/0,89/0,64/0,03/0,26; 0,81/0,97/0,97/0,99/0,89 | 1050 | 863 | 3,92 | 968 |

Seçim ölçütü (200 hf): en çok hiç çökmeyen (T+K+P4), en yüksek son 30 hf başarısı ve düşük işsizlik (T, K, T2K). 500 hf'de hiçbir birleşim üç tohumun üçünde 500 haftayı tamamlamıyor; en çok dayanan T+K+P4 (2/3 koşu hf 500'de %80-89 talep karşılıyor, firma kadrosu 3,9; tabanda 0,6'ya çökmüş), ama üçüncü koşu hf 302'de çöküyor ve destek fonu net maliyeti tabandan yüksek (1,05 milyon vs 0,95 milyon Akçe).

## 5. Yorum (Kalecki ve para stoku çerçevesi)

1. **Para stoku gevşiyor, kâr gevşemiyor.** K ve P ile para stoku 462 bin -> 551-641 bin (+%19-39), ama toplam firma kârı tabanda -15,5 bin/hf, K'da -14,7, T+K'da -15,0, T2K'da -13,9: gürültü içinde sıfıra yakın negatif. Kalecki: firma kârı = yatırım + devlet açığı + dış açık - hane tasarrufu. K yalnız para arzı sınırını kaldırıyor; borçlanma talebi hâlâ kâr tabanlı limit ve işletme sermayesi çarpanıyla sınırlı (K-218 raporu), yani yatırım harcaması artmıyor. T devlet harcamasını kasadan hane/hizmet alımına çeviriyor ama geri dönen kısım NPC kâr süpürmesiyle yeniden kasaya sızıyor (kasa payı %35'te kalıyor).
2. **P para kâra çevirmiyor, firmaya hapsediyor.** P ile firma nakdi 95 bin -> 238 bin, şehir kasası payı %34 -> %15-17, ve ölçülen toplam firma kâr satırı -23 bin/hf'ye iniyor (temettü ve vergi gider tarafında). Kadro büyüyor (3,6 -> 4,2: Caiani birikim kuralı ve tavan kalkması), işsizlik T+K'ya göre artıyor (440 -> 619-647). Para derinliği (K) olmadan kasanın boşalması destek fonunun kaynağını kurutuyor; K ile birlikte P4 en çok koşuyu ayakta tutuyor (8/12) ama P8 tamponu (4/12) finanse edilemiyor: aynı bayrağın iki ayarı arasında 4 koşu fark var, bu sonuçta tohum duyarlılığını da gösteriyor.
3. **E (ENTRY_EXP) yeni firma sayar, yeni talep yaratmaz.** Sabit bir talep havuzunu daha çok firma paylaşıyor: kadro ortalaması 3,1 -> 2,3 (T+K+E) -> 1,3 (ALL), 52 hf sağkalım %2-7 (BLS BED'de ~%78), işsizlik 640 -> 1141-1411. Kalecki'ye göre giriş toplam kârı büyütmez, ancak kâr payını böler; yeni firmalar ilk yılda batıyor ve işçilerini işsizliğe salıyor. P'siz E bile (ALL-P) hiç çökmeyen sayısını 0'a indiriyor.
4. **R yalnız etkileşimde küçük pozitif:** T+K 4/12 -> T+K+R 5/12, medyan çöküş 156 -> 184 (gürültü içinde); P'ye eklenince fark görünmüyor (T+K+P8 4/12; ALL-E 4/12). Tek başına zaten küçük negatifti (rapor-faiz-davranis.md).
5. **T+K'nın tabandan kötü çıkması (4/12 vs 7/12) gürültü olabilir** (T ve K ayrı ayrı 7/12; T2K 7/12). `TR_WEEKS=2` ile (kasa hedefi gerçek ölçeğe yaklaşınca) fark kayboluyor: kasa para stokunun %34'ü, 4 haftalık hedef ölçeğe göre gevşek.
6. **500 haftada yavaş bozulma sürüyor:** üç koşuda da hf 200'de talep %86-99 iken sonra düşüyor; destek fonu net maliyeti kümülatif ~0,9-1,1 milyon Akçe (kalıcı gider). K, T, P hiçbiri bu geçiş açığını kapatmıyor; v13.0'ın saptadığı özel sektör eşiğine yaklaşamama sorunu sürüyor.

## 6. Varsayılan önerisi (bayrak başına)

| Bayrak | Öneri | Gerekçe |
|---|---|---|
| `TREASURY_RULE` (K-219) | **Aç** (`TR_WEEKS=2` ile; 4 yerine) | Tek başına zarar yok: 7/12, son30 12/12 (tabanda 9/12), işsiz 640 -> 478. K ile birlikte 4 yerine 2 hafta hedefi tabanı geri kazandırıyor (7/12). Mali kural ve sahip kararı; ek maliyeti yok. Bir 12 tohumlu ölçümde `TR_WEEKS` 2 ile 4 doğrudan karşılaştırılmadı (T2 yalnız K ile): açmadan önce `T2` tek başına ölçülmeli |
| `CREDIT_MONEY` (K-218) | **Kapalı bırak, T ile birlikte test et; tasarım gereği gerçekçi, ölçümde nötr** | Tek başına 7/12, talep 0,77 -> 0,94, işsiz 640 -> 376 (en iyi işsizlik), ama kâr değişmiyor ve T'siz-P'siz 500 hf'de 0/3. Para yaratımı kayıtlı akış ve korunum tutuyor. Yatırım talebi (kâr tabanlı limit) ayrıca gevşetilmeden etkisi sınırlı |
| `PROFIT_KEEP` (K-220) | **Kapalı**; aday ayar `PK_WEEKS=4` | En çok hiç çökmeyen (8/12) ve 500 hf'de en iyi (2/3 ≥%50) ama kasa payını %17'ye indiriyor, kâr satırı -23 bin, `PK_WEEKS=8` 4/12'ye düşüyor (ayara duyarlı), 12 tohumda 7/12 ile 8/12 fark gürültü. Açmadan önce şehir kasası gelirinin yerine geçen bir kaynak (hane temettü vergisi) gerekli |
| `ENTRY_EXP` | **Kapalı** | Her birleşimde belirgin kötü: 52 hf sağkalım %2-7, kadro 1,3-2,3. Giriş kuralı talep genişlemeden anlamsız; `EE_ENTRY_SIZE`, kurucu başına sermaye ve çıkış kuralı yeniden düşünülmeli |
| `RATE_BEHAV` (+`RB_CREDIT`) | **Kapalı** (nötr) | Tek başına küçük negatif, T+K ile küçük pozitif; hiçbiri gürültünün dışında. Oyuncu ayarı değil, "Dünyanın insanları"; faiz oyun faizi ölçeği (`RB_SCALE=5`) kalibrasyonu doğrulanmadan açılmamalı |

En iyi birleşim: sayıyla **T+K+P4** (8/12 hiç çökmüyor, 500 hf'de 2/3 koşu sonunda ayakta, firma kadrosu 3,9); riske göre düzeltilince **T** (veya T2K) tabanla eşit hiç çökmeyen sayısında, son 30 hf'de en tutarlı (12/12) ve P'nin kasa/kâr bedelini ödemiyor. Hiçbiri 500 haftayı çözmüyor.

## 7. Verinin gösterdiği sonraki model düzeltmeleri

1. **Geçiş desteği kalıcı gider** (K-211): destek net maliyeti 500 hf'de ~1 milyon Akçe ve hiçbir birleşimde azalmıyor; özel pay eşiğine yaklaşmıyor. Asıl darboğaz bu; davranış modülleri onu çözmüyor.
2. **Yatırım talebi kâr tabanlı limitle sınırlı:** K'nın para arzı serbestliği işe yaramıyor; kredi talebini (kapasite genişletme, işletme sermayesi) kâr beklentisinden ayıran bir yatırım fonksiyonu gerekiyor (`cap_k` x sönümlü kâr yerine beklenen talep).
3. **Şehir kasası para stokunun %34-55'i:** `TR_WEEKS` göreli bir ölçekle (para stokunun payı ya da yıllık GSYH oranı) tanımlanmalı; mevcut 4 hf bu modelde çok gevşek.
4. **Mali taraf temettüyü vergilemiyor:** P kasa gelirini boşaltıyor; hane temettü gelirine (stopaj ötesinde) gelir vergisi eklenirse P'nin mali bedeli kapanır.
5. **Giriş:** ENTRY_EXP firmaları 1-2 kişilik açılıp ilk yılda batıyor; giriş ölçeğini (`EE_MAXN`, başlangıç talebi) pano açığına bağlı kurup başarısız firmaların işçisini hızlı yeniden istihdam eden bir çıkış/yeniden eşleşme eklenmeli. Önce E'nin firma ömrünü modellemeden açmak talebi böler.
6. **Tohum duyarlılığı:** 7/12 ile 8/12 fark ayırt edilemiyor; sonraki kararlar için tohum sayısı en az 24'e çıkarılmalı ya da eşleşmiş çift karşılaştırma (aynı PM_ADJ) istatistiği kullanılmalı.

## 8. Riskler

- n = 12 (200 hf) ve 3 (500 hf); yalnız büyük farklar anlamlı.
- `bm_kar_defter` yalnız davranışsız ölçüm sütunudur; ölçüm bayrağı (`KK_MEAS=1`) tüm koşularda açıktı, davranışı değiştirmez; bayraklar kapalıyken gate sonrası yeniden yeşil doğrulandı (bölüm 1'deki gate).
- ENTRY_EXP sağkalımı yalnız E koşularında ölçülebiliyor; E'siz koşulların sağkalımı için batan firma sayısı (kümülatif) verildi.
- T2K'nın T ve P'li kardeşleri (T2 tek başına, T2+K+P4) ölçülmedi.
