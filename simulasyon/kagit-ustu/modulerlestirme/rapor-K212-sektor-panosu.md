# K-212 sektör panosu: uygulama ve ölçüm raporu

**Sonuç.** Sektör panosu (firmalar tedarikçilerinin ve sektörün durumunu görüp ona göre karar veriyor) modüler modelde `SECTOR_BOARD` bayrağıyla çalışıyor; bayrak kapalıyken hiçbir şey değişmiyor (kapı ve testler yeşil). Ölçümde pano **tek başına çöküşü geciktirmedi**: en iyi bileşimde (NPC_KEEP=2, FOUND_COLLAT=1, WAGE_TAX=0.1, CORP_TAX=0.2, INFRA_CONT=1, SHRINK_FIRST=1, ORDER_BOOK=1, NO_BAILOUT) 6 PM_ADJ üzerinde çöküş haftası medyanı 73'ten 67'ye, en kötüsü 63'ten 61'e indi (gürültü düzeyi, hafif olumsuz). Parçalara ayırınca nedeni görüldü: "oyuncu girişi kalıcı kıtlık ister" kuralı toparlanmayı geciktiriyor; onu çıkarınca pano tek başına medyan 75,5 / en kötü 69 (taban 73 / 63) veriyor. **Asıl kazanç panonun (giriş kuralı hariç) K-211 geçiş desteğiyle birlikte çalışmasında:** 6 koşunun medyanı **87,5**, en kötüsü **74** ve bir koşu 200 haftada hiç çökmedi (taban 73 / 63; yalnız K-211: 72 / 61). Tedarikçi kaynaklı firma ölümleri 100. haftaya kadar 92'den 44'e düştü. Yani pano bir "ilaç" değil, geçiş desteğini tamamlayan bir bilgi katmanı; ama 200 haftada kalıcı çözüm sağlamadı (hâlâ çöken 5 koşu var), ayrıca altı koşu gürültü payı taşıdığından fark kesin sayılmamalı.

## Ne yapıldı (commit sırası)
1. `simkit/sector_board.py` (L1): hafta sonu (ölçümden önce) `W.board` hesaplanır; yalnız zincirden türetilen veri. Her ürün için talep, üretim, karşılanmayan pay, **kalıcı kıtlık** (karşılanmayan payın üstel ortalaması), toplam firma stoku ve stok örtüsü, çalışan/sağlıklı üretici sayısı, fiyat eğilimi; her (şehir × ürün) hücresi için talep/üretim/stok/üretici; her üretici firma için sağlık (kasa kaç haftalık gidere yeter, zarar serisi, kadrosuz mu, batık/tasfiye/özelleştirme ihalesinde mi, ödeme gücü sayacı); lonca için üyelerinin sektör kıtlığı. WEEKLY_CSV'ye `pano_*` sütunları, rapora "Sektör panosu" bölümü (en kıt 10 halka, tedarikçi sağlığı özeti, kural sayaçları), sonuç sözlüğüne yalnız bayrak açıkken `R["sbrd"]`.
2. `simkit/sector_core.py` (L0): karar okuyucuları (`sb_*`); pano yoksa nötr değer döner. Firma ve lonca kararları buradan beslenir (aşağıda kural tablosu).
3. Kalibrasyonlu `SB_*` parametreleri (params.py; her birinin yanında kaynak) ve karar bağlantıları.
4. `SectorBoardTests` (7 test: pano sayıları zincirle tutarlı, pano para hareketi yapmaz, bayrak kapalıyken nötr/iz yok, tampon tavanı, ikinci kaynak payı %25, fiyat tabanı, kısa tam koşuda para korunumu), WEEKLY_CSV'ye `olum_kum`/`olum_girdi_kum` ölçüm sütunları (bayrak bağımsız; yalnız WEEKLY_CSV açıkken), README bölümü.

Kapılar (bayrak kapalı): `tools/gate.py --tier fast,mid --jobs 2 --no-speed` YEŞİL (31 senaryo golden aynı, digest 101 hf özdeş, para korunumu 4,8e-14, layer_lint temiz); `tools/test_all.py` YEŞİL. Altınlar bu worktree'de `golden.py make ../model.py --tier fast,mid --allow-mixed` ile üretildi (eski kayıt başka model sürümündendi; bu yüzden `golden/SHA256SUMS.json` çalışma kopyasında değişik, commit edilmedi).

## Karar kuralları (pano bilgisi → karar)
| # | Pano bilgisi | Karar |
|---|---|---|
| 1 | Etkin sağlıklı tedarikçi sayısı (yerel + 0,5 × diğer şehirler), kalıcı kıtlık | Girdi tampon hedefi: ≥3 sağlıklı → 0,5 hf; 2 → 0,75; 1,5 → 1; 1 → 2; sağlıklı yok/tek sağlıksız → 4 hf (tavan); kalıcı kıtlık eklenir. Alım yine artık arzdan ve nakitle sınırlı |
| 2 | Alıcı satırında baskın tedarikçi payı > %75 ve sağlığı < 0,5 | O tedarikçinin ağırlığı kısılır: pay en çok %75, kalan en az %25 ikinci kaynağa (komşu şehir dahil, navlunla; yalnız firma alıcıları, alternatif varsa) |
| 3 | Ürünün kalıcı kıtlığı > %3 (sürüyor) | Şehir kadro hedefi en çok +%15 (NPC); NPC üretim ölçeği (ölçek < 1 iken) en çok +%15 |
| 4 | Sektör stok örtüsü > 28 gün ve kıtlık yok | Kadro hedefi en çok −%10; üretim ölçeği en çok ×0,7'ye kadar fren; oyuncu işe alımı bekler |
| 5 | Kalıcı kıtlık / stok fazlası / fiyat eğilimi | PRICE_V2 hedefine en çok +%10 prim (düşen eğilimde yarısı) ya da −%10 indirim (tam birim maliyetin altına inmez; adım hızı mevcut PV2 katsayılarıyla sınırlı) |
| 6 | Ürünün kalıcı kıtlığı < %2 | Oyuncu girişi yapılmaz ("geçici kıtlık"). **Ölçümde zararlı çıktı; önerilen ayar: `SB_ENTRY_PERSIST=-1` (kapalı)** |
| 7 | Girdi ürününün çalışan üreticisi var ama hiçbiri sağlıklı değil | Oyuncu o ürüne girmez, bekler |
| 8 | Üyelerin ana ürünündeki kalıcı kıtlık | Lonca büyüme/yatırım kredisi sırası: kıt halkadaki üye önce (aynı `cx_ok` risk kuralları içinde, kararlı sıralama) |

## Ölçüm
Koşul: `PYTHONHASHSEED=0`, 200 hf, NO_BAILOUT açık, en iyi bileşim, paralel en çok 3. Çöküş = WEEKLY_CSV'de talep karşılama < 0,5 olan ilk hafta (hf ≥ 20). Sütunlar: A = taban (pano 0); B = pano 1; C = pano 1 + K-211 geçiş desteği; D = yalnız K-211 (adil kıyas); E1 = pano, giriş-kalıcı-kıtlık kuralı kapalı; E2 = pano, tampon kuralı kapalı; E3 = pano, fiyat/üretim/kadro kuralları kapalı; G = E1 + K-211.

| PM_ADJ | A taban | B pano | C pano+K211 | D K211 | E1 pano−giriş | E2 pano−tampon | E3 pano−fiyat/kadro | G E1+K211 |
|---|---|---|---|---|---|---|---|---|
| 0.078 | 63 | 70 | 80 | 61 | 88 | 73 | 59 | 86 |
| 0.080 | 81 | 64 | 74 | 73 | 69 | 52 | 59 | >200 |
| 0.082 | 71 | 62 | 78 | 74 | 78 | 69 | 52 | 85 |
| 0.084 | 75 | 74 | 76 | 71 | 72 | 64 | 60 | 74 |
| 0.086 | 67 | 72 | 73 | 71 | 81 | 56 | 58 | 110 |
| 0.088 | 91 | 61 | 54 | 73 | 73 | 69 | 73 | 89 |
| **medyan / min** | **73 / 63** | 67 / 61 | 75 / 54 | 72 / 61 | 75,5 / 69 | 66,5 / 52 | 59 / 52 | **87,5 / 74** |

(Taban A, deney dalı tur 13'ün ORDER_BOOK=1 sütunuyla aynı çıktı: 73 / 63; yani modüler model deney hattıyla uyumlu.) Okuma:
- B (pano tek başına) tabandan iyi değil (−6 medyan). Çıkarma deneyleri: giriş kuralını çıkarmak (E1) +8,5 medyan ve en kötüyü 61'den 69'a yükseltiyor; tampon kuralını çıkarmak (E2) zarar veriyor (66,5), yani tampon işe yarıyor; fiyat/kadro/üretim kurallarını çıkarmak (E3) en büyük kaybı veriyor (59), yani bu kurallar pano içinde en değerli kısım.
- C ve D birbirine yakın (75 vs 72); K-211 ile pano ancak giriş kuralı olmadan (G) belirgin biçimde ayrışıyor: medyan 87,5, en kötü 74, bir koşu çökmedi.
- Dikkat: koşu sayısı 6; deney dalındaki gürültü ±10 hafta düzeyindeydi. G'nin farkı (+14 medyan, +11 min) bu gürültünün üstünde ama tek başına kesin sayılmaz; 500 hf ve ek PM_ADJ koşusu önerilir.

### Tedarikçi kaynaklı firma ölümleri (girdi bulunurluğu < %0,9 iken ölenler; altı koşu ortalaması)
| | 100. hf'ye kadar ölen (tümü / girdi kaynaklı) | 200. hf'ye kadar (tümü / girdi kaynaklı) |
|---|---|---|
| A taban | 347 / 92 | 634 / 179 |
| B pano | 325 / 104 | 562 / 177 |
| C pano+K211 | 323 / 76 | 671 / 175 |
| D K211 | 341 / 91 | 703 / 199 |
| E1 | 334 / 93 | 587 / 162 |
| G E1+K211 | 290 / 44 | 703 / 138 |

Pano tek başına tedarikçi kaynaklı ölümleri azaltmadı (B 104 vs A 92); G'de 100. haftaya kadar yarıya indi (44) ama çöküş sonrası dönemde (hf 100-200) tüm koşullarda ölümler sürüyor.

### En kıt halkalar (hf 20-100, altı koşu ortalaması, hafta başına karşılanmayan pay; CSV `kit_urun` sütunundan, her hafta ilk 6 kıt ürün raporlanır)
- A taban: deterjan 0,82; sandalye 0,54; yemek 0,41; kola 0,39; şişe süt 0,36; bilgisayar 0,34; kot 0,33; ekmek 0,29; eğlence 0,20; yolculuk 0,18.
- B pano: deterjan 0,73; sandalye 0,55; kola 0,48; şişe süt 0,42; yemek 0,38; ekmek 0,31; inşaat 0,27; eğlence 0,22; kot 0,21; bilgisayar 0,20.
- G (E1+K211): mücevher 0,69; deterjan 0,58; yemek 0,45; bilgisayar 0,39; sandalye 0,23; eğlence 0,18; kola 0,17; şişe süt 0,16; kot 0,15; ekmek 0,14.
Deterjan zinciri (tek kırılgan halka) tüm koşullarda en kıt; pano deterjanı çözmüyor (üreticisi yok olduğunda tampon/ikinci kaynak sonuç vermez). G'de hızlı tüketim zinciri (kola, şişe süt, ekmek, sandalye) belirgin düzeliyor; kıtlık mücevhere kayıyor.

Kural sayaçları (bir koşu, B 0.080, 200 hf): tampon yükseltme 17.813, düşürme 1.589, kadro artışı 47.207, kadro freni 302, üretim artışı 11.752, üretim freni 445, fiyat primi 4.554, fiyat indirimi 54, giriş reddi (geçici kıtlık) 1.843, (tedarikçi sağlıksız) 747, lonca önceliği değişen hafta 101, oyuncu işe alımı bekletme 13. Fiyat indirimi ve fren nadir: pano çoğunlukla kıtlık gösteriyor (model kıtlık rejiminde), bu yüzden "büyüt/prim" yönü baskın.

## Kalibrasyon tablosu
1 oyun haftası = 1 gerçek hafta, 1 döngü = 1 gün. Güven: yüksek = birincil/resmî kaynakla doğrulandı; orta = kaynak var ama bizim ölçeğe çevirme yaklaşık; düşük = yalnız satıcı/blog düzeyi; varsayım = kaynak bulunamadı.

| Parametre | Kullanılan değer | Gerçek dünya referansı | Kaynak | Güven |
|---|---|---|---|---|
| `SB_HEALTH_WEEKS` (tam sağlıklı kasa) | 4 hf | Küçük işletme medyanı 27 gün nakit tamponu (üst çeyrek >62 gün, alt çeyrek <13 gün). Not: 2025 verisi tüm örneklem için 17,6 gün, yani 27 gün 2016 tarihli | [JPMorgan Chase Institute, Cash is King / buffer days](https://www.jpmorganchase.com/corporate/institute/report-cash-flows-balances-and-buffer-days.htm) | yüksek (2016), orta (güncel) |
| `SB_H_OK` (sağlıksız eşiği) | h < 0,5 = kasa < 2 hf gider | Alt çeyrek 13 gün (~2 hf) | aynı rapor | orta |
| NPC için sağlık hedefi | NPC_KEEP × işletme sermayesi (~0,6-1,1 hf) | Modelin kendi politikası: NPC kasayı bu tamponda tutar, fazlası şehre süpürülür; gerçek dünya karşılığı yok | model tasarımı | varsayım |
| `SB_LOSS_WEEKS` (zarar serisi cezası) | 13 hf'de ceza yarım | Bir çeyrek (ardışık zararlı çeyrek eşiği) | koordinatör referansı; kaynak doğrulanmadı | varsayım |
| `SB_BUF_LO/HI` (girdi tamponu) | 0,5 hf (çok sağlıklı tedarikçi) ... 4 hf (tek/sağlıksız), tavan 4 hf (üst sınır 12 hf düşünülmüştü, model nakit/artık arz kısıtı nedeniyle 4'te tutuldu) | İmalat stok günü 60-120 gün (tüm stok; hammadde ayrı değil), perakende 30-60, bozulabilir gıda günler; güvenlik stoku = z·σ·√L, %95 hizmet düzeyi için z = 1,65 | [DIO kıyas rehberleri, ör. Cleverence](https://www.cleverence.com/articles/for-business/inventory-turnover-days-interpretation-3927/) (satıcı kaynağı); z standart tedarik zinciri formülü | düşük (DIO aralığı), orta (formül) |
| `SB_SECOND` (ikinci kaynak payı) | Sağlıksız baskın tedarikçi payı ≤ %75 → %25 ikinci kaynak | Tek kaynak payı >%70-80 ve risk varsa %20-30 ikinci kaynak | koordinatör referansı; bağımsız kaynak bulunamadı | varsayım |
| `SB_STOCK_HI` (stok fazlası) | 28 gün; 56 günde tam fren | Mamul stoku imalatta 4-8 hf | DIO aralıkları (yukarıdaki satıcı kaynağı) | düşük |
| `SB_BRAKE_MIN` | üretim ölçeği ≥ 0,7 | Kapasite kullanımı: imalat 1972-2024 ortalaması %78,2 (normal %75-85) | [Federal Reserve G.17 notları](https://www.federalreserve.gov/RELEASES/g17/CapNotes.htm) | yüksek |
| `SB_GROW` / `SB_STAFF_BRAKE` | +%15 / −%10 | Kullanım >%85 sürerse işe alım, <%70 sürerse küçülme; adım büyüklüğü | koordinatör referansı; adım büyüklüğü bize ait | varsayım |
| `SB_PREM_MAX` / `SB_DISC_MAX` | ±%10 hedef toplamı; haftalık adım mevcut PV2 hızlarıyla (≤ %20 yukarı) | Fiyatlar tipik olarak 8-11 ayda bir değişir (indirimsiz), üretici fiyatı medyanı ~%11/ay sıklıkla; yani haftalık ayar sınırlı, toplam sınır %10-20 | [Nakamura-Steinsson, Five Facts About Prices](https://business.columbia.edu/sites/default/files-efs/pubfiles/3556/fivefacts.pdf) | yüksek (sıklık), varsayım (%10 tavan) |
| `SB_PERSIST_A`, `SB_SCARCE` (%3), `SB_ENTRY_PERSIST` (%2) | 0,15 (~6-7 hf hafıza); %3; %2 | Kıtlığın "kalıcı" sayılma eşiği için yayınlanmış veri yok | — | varsayım |
| Kredi önceliği | Kıt halkadaki üye önce; mevcut `cx_ok`, CX_GROW_K, havuz limiti aynen | İşletme sermayesi kredisi 1-3 aylık gider: bu kalıcı parametrelere bırakıldı (değiştirilmedi) | modelin mevcut kredi kuralları | varsayım |

Kalibrasyon uyarısı: eşik ve katsayıların çoğu doğrudan ölçülmüş dünya verisi değil, makul aralıktır; ölçümde en etkili parçalar (fiyat/kadro/üretim kuralları, tampon) için aralık duyarlılığı (ör. SB_GROW 0,10-0,25; SB_BUF_HI 2-8) ayrıca taranmadı.

## Kalan işler (kapsam dışı ya da yarım)
- **Kapasite yatırımı (CAPEX) panoya bağlı değil**: oyuncu CAPEX kararı kalıcı kıtlığa/tedarikçi sağlığına bakmıyor (yalnız giriş ve işe alım bakıyor).
- **Lonca uyarısı/kısa kredi yok**: lonca yalnız kredi önceliğini panodan alıyor; üye firmaya "tedarikçi riski, tampon stoku için kısa kredi" önerisi yapılmadı. Pano `lo[lonca]` ile üyelerin sektör kıtlığını zaten tutuyor, ek kural küçük bir iş.
- NPC köprü kredisi sırası (restaff) panoya bağlı değil; yalnız oyuncu firmalarının büyüme/yatırım kredisi sıralanıyor.
- Kapasite kullanımı doğrudan ölçülmüyor; yerine stok örtüsü ve kıtlık kullanıldı (vekil).
- Giriş kuralı (`SB_ENTRY_PERSIST`) varsayılan olarak 0,02; ölçüm kapalı yapılmasını (−1 ya da 0) öneriyor. Varsayılan değiştirmek sahip kararıdır, bu dalda değiştirilmedi.
- 500 hf koşusu ve daha fazla PM_ADJ ile G bileşiminin doğrulanması.
- Oyunda aynı panonun oyuncuya gösterilmesi (01-roller) bu işte yok; yalnız rapor ve CSV.

## Yeniden üretim
Ölçüm betikleri: koşu başına `MODEL_PARAMS="NPC_KEEP=2,FOUND_COLLAT=1,WAGE_TAX=0.1,CORP_TAX=0.2,INFRA_CONT=1,SHRINK_FIRST=1,ORDER_BOOK=1,NO_BAILOUT=1,PM_ADJ=<pm>,SECTOR_BOARD=1[,SB_ENTRY_PERSIST=-1][,TRANS_SUPPORT=1]" WEEKLY_CSV=<yol> PYTHONHASHSEED=0 python3 model_mod.py --weeks 200`. Çöküş haftası, WEEKLY_CSV `hafta`/`talep_karsilama`; ölümler `olum_kum`/`olum_girdi_kum`; kıt ürünler `kit_urun`.
