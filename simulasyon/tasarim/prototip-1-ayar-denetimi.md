# Prototip 1 ayar denetimi: her ayar oyuncunun gözünden ve modelin gerçeğiyle

Durum: denetim · 2026-10-28 · İncelenen: Claude Design kanvası `Main.dc.html` (ayar kataloğu `catalogSrc()`, 97 satır, 14 grup + Dünya geneli; veri olarak okundu) · Bayrak eşlemesi: `claude-design-prompt-v2.md` B.2 · Model: `kagit-ustu/modulerlestirme/simkit/` (v13.0 çalışma kopyası; satır numaraları `params.py` ve modüllerin bugünkü hali) · Kararlar: `simulasyon/kararlar.md` · Çıktı: `claude-design-revizyon-2.md` bu denetimden türetildi.

## 0. Kısa sonuç

- **Sahibin şikâyeti doğru ve tek tek ekranlarla sınırlı değil.** Prototipteki 97 ayarın 36'sı gerçek dünyada kimsenin "seçmediği" bir şeyi oyuncuya kaydırıcı olarak veriyor: hane ve firma davranışları (27), piyasa sonuçları (2) ve model yapısı anahtarları (7). Oyuncu bunları politika sanıyor; "kira düzeyini piyasa belirlemiyor mu?" sorusu tam bu karışıklıktan çıkıyor.
- **Kartlarda açıklama yok.** Katalogda her ayarın yalnız adı, aralığı, varsayılanı, rozeti ve "deneyimizden" ipucu var (`ad|katman|aralık|varsayılan|rozet|ipucu`); "bu ne demek", "gerçekte kim karar verir", "oyunda neyi değiştirir" satırı hiç yok. 97 kartın 45'inde ipucu da boş. Birimler model birimi: "haftalık %0,01–%1", "0–0,03 katsayı", "52–156 hf gelir", "× işletme sermayesi".
- **Sınıf dağılımı (97 satır, birincil sınıf):** **P 61 · V 27 · S 2 · Y 7.** Bileşik 4 kart (Girişim kapıları, Genç firma reçetesi, Sektör panosu, Doğal işsizlik) hem P hem V parça taşıyor; bölünmeleri gerekiyor (§1.16).
- **Modelin yapılandırılması (sahibin asıl kaygısı):** davranış ve piyasa tarafında beş büyük boşluk var: (1) tasarruf ve tüketim faize hiç tepki vermiyor; (2) kira, piyasa yerine en düşük ücretin sabit bir payına bağlı, konut fiyatı da kiradan sabit getiriyle türetiliyor; (3) ücretler sabit katman oranlarıyla şehir çapında tek endeks, üstelik iki ayrı "doğal işsizlik" değeri var; (4) girişim kâr beklentisine değil senaryoya (rakip kohortu, sabit olasılık) bağlı; (5) tahvil faizi borç düzeyine tepkisiz sabit formül. Ayrıca kira gelirinin %10'u ve lonca giderleri gizli birer vergi gibi şehre gidiyor. Ayrıntı ve öncelik §2'de.

- **Sahip yönü (2026-10-28, revizyon-2'ye işlendi):** ekranlar üç katmana ayrılır: **(a) Kurallar** (P; oyuncunun Ekonomi Şartı, kontrata işlenir), **(b) Simüle edilen davranışlar** (V; aktöre göre ayrı ekranlar: hane, girişimci, işçi, yatırımcı, yerleşik (NPC) firma; varsayılan gerçekçi kalibrasyon, değiştirmek "dünya senaryosu" olur, Şart'a girmez, koşu etiketinde görünür), **(c) Piyasa** (S; canlı gösterge, Kurucu'da yalnız "başlangıç piyasası" bilgisi). Y anahtarları (b)'nin yanında küçük "Dünya kuralları" bölümü. Kartlarda "Gerçek dünyada kim karar verir" satırı **yok**; aşağıdaki "Kim" sütunu yalnız sınıflandırmanın gerekçesidir. Revizyon-2 mevcut prototipi bu yapıya dönüştüren bir düzenlemedir (yeniden üretim değil). Aktör davranışlarının modeldeki durumu ve "davranış profilleri" modülü önerisi §3'te.

**Sınıf tanımları.** **P · Oyuncu politikası:** gerçekte bir kurumun seçtiği kural (şehir yönetimi, para otoritesi, düzenleyici, lonca yönetimi, kredi veren); oyuncu ayarlar. **V · Dünya varsayımı / davranış:** hane ve firma davranışı ya da kalibrasyon; ayar değildir; "Dünya varsayımları" panelinde salt okunur durur (uzman "deney için değiştir" kilidini açabilir, rozetli). **S · Piyasa sonucu:** kendiliğinden oluşan değer; gösterge olur; politika karşılığı varsa (tavan, sınır) o P olarak önerilir. **Y · Model yapısı anahtarı:** bir mekanizmayı açıp kapatır; "Dünya kuralları" altında anlatılarak verilir ya da gizlenir.

## 1. Ayar denetimi (14 grup + Dünya geneli)

Sütunlar: # · Prototipteki ad · Modelde (bayrak, `simkit/` altında dosya:satır) · Sınıf · Gerçekte kim belirler · Modelde nasıl çalışıyor · Sorun · Ekranda ne olmalı (yeni ad · oyuncu cümlesi). Tam kart metinleri (üç satır: Bu ne demek / Oyunda neyi değiştirir / İpucu) revizyon-2 R27, davranış satırları R25.

### 1.1 Para ve basım (5: P 5)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor | Sorun | Ekranda |
|---|---|---|---|---|---|---|---|
| 1 | Yıllık basım tavanı | `MINT_YEAR` params.py:373 | P | Para otoritesi | Tavan: şehir kasası açık verince basım bu izinle sınırlı. Fiilen basılan miktar açığa bağlı (sonuç) | Oyuncu fiilen basılanı görmüyor | "Yıllık en çok yeni para" · "Şehir kasası açık verdiğinde bir yılda en çok para arzının %2'si kadar yeni Akçe basılabilir." Yanında gösterge: bu yıl basılan / izin |
| 2 | Açılış basım muafiyeti | `MINT_OPEN_WEEKS` :374 | P (uzman) | Para otoritesi | İlk 13 hf açılış harcamaları tavana sayılmaz | "Muafiyet" anlaşılmıyor | "Açılış dönemi" · "İlk 13 hafta şehrin kuruluş harcamaları basım sınırına takılmaz." |
| 3 | Şehir tahvili | `CITY_BOND` :389, `BOND_TERM` :390, `BOND_DEBT_MAX_W` :393 | P | Şehir meclisi, borçlanma yasası | Basım izni dolunca açık lonca havuzlarına tahvil satılarak kapanır; borç tavanında harcama kısılır, temerrüt yok | "52–156 hf gelir" birimi | "Şehir borçlanabilir mi" + "Borç üst sınırı: en çok 104 haftalık (2 yıllık) gelir" |
| 4 | Şehirler arası kasa dengeleme | `EQUALIZE` :304 | P | Merkezi yönetim, şehirler birliği | Ortalama üstü kasa fazlasının %25'i her hafta zayıf şehirlere | Yok | "Zengin şehirden yoksul şehre aktarım" |
| 5 | Kredi parası | `CREDIT_MINT` (taşınmadı) | P (deneysel) | Para otoritesi (para rejimi) | Modelde yok | Yok (doğru rozetli) | "Loncalar kredi verirken para yaratabilir mi (deneysel)" |

### 1.2 Faiz politikası (7: P 6, S 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor | Sorun | Ekranda |
|---|---|---|---|---|---|---|---|
| 6 | Faiz kuralı | `RATE_POLICY` :400 | P | Merkez bankası | Tek politika faizi; kredi tabanı ve tahvil faizi buna bağlı (credit_core.py:237 `rate_ref`) | R23 | "Faizi ne belirler: sabit / kural" |
| 7 | Enflasyon hedefi ve katsayısı | `POL_INF_TGT` :403, `POL_A_INF` :402 | P | Merkez bankası | Sepet fiyat artışı hedefi aşınca faiz adım adım yükselir | Katsayı "0,01" oyuncuya anlamsız; R23'teki başlangıç durumu yanılgısı | "Enflasyon hedefi (%/yıl)" + "Enflasyona tepki: zayıf / orta / güçlü" (sayı uzman satırında) |
| 8 | Mevduat faizi tavanı | `DEP_RATE` :140 (+ `DEP_VAR` :232, `DEP_PAYOUT` :141) | P (uzman); asıl mevduat faizi **S** | Bankacılık düzenleyicisi | Mevduat faizi = havuzun tahsil ettiği kredi faizinin %80'i / toplam mevduat (piyasa sonucu). Tavan %1/hf (yıllık ~%52) ölçümde hiç bağlamadı (gerçekleşen ~%0,01/hf, K-179) | Ana katmanda "mevduat faizini ayarlıyorum" sanılıyor; tavan pratikte etkisiz | Uzmana in: "Mevduat faizi üst sınırı (düzenleme)". Göstergeye ekle: "Mevduat faizi (piyasa) %0,01/hf ≈ %0,5/yıl" |
| 9 | Tarafsız faiz, taban, tavan, adım | `POL_NEUT, POL_MIN, POL_MAX, POL_STEP` :401 | P (uzman) | Merkez bankası | Kuralın çıpası ve sınırları | Yalnız haftalık birim | Her değerin yanında yıllık karşılık |
| 10 | Doğal işsizlik ve katsayısı | `POL_U_STAR` :403, `POL_A_U` :402 | P (kuralın kabulü); doğal işsizliğin kendisi V | Merkez bankası tahmin eder | İşsizlik %25'in üstündeyse faiz düşer | Ücret denklemi ayrı bir doğal işsizlik kullanıyor: `LAB_U_STAR` = 0,20 (:489, week_open.py:186). Aynı dünyada iki "normal işsizlik" | "Kuralın normal saydığı işsizlik" + not: "Modelde ahırda çalışan ve iş arayanlar işsiz sayılır" (R23.4) |
| 11 | Kredi/mevduat oranı hedefi | `POL_CD, POL_CD_STAR, POL_A_CD` :404 | P (uzman) | Merkez bankası (alışılmadık araç) | Kredi/mevduat 0,7'nin altında kaldıkça faiz düşer; ölçümde oran ~0,05 olduğundan faiz tabana iner | Gerçek merkez bankalarının aracı değil; tasarrufun faize duyarsızlığını yamıyor (§2.1) | "Kredi canlılığı hedefi" · "Mevduat krediye dönmüyorsa faiz düşer." İpucu: "Faiz bu hedef eklenince düştü" |
| 12 | Tahvil faizi | `BOND_RATE_MULT` :391, `BOND_MARGIN` :392 | **S** | Piyasa (tahvil ihalesi) | policy.py:16,47: taban faiz × 0,5 + %0,05 sabit formül; borç düzeyine tepkisiz | Ayar olarak sunulmuş; modelde de piyasa değil | Ayar kaldırılır; gösterge "Şehir tahvili faizi". Formül Dünya varsayımlarında salt okunur. Model işi §2.5 |

### 1.3 Kredi (9: P 8, V 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor | Sorun | Ekranda |
|---|---|---|---|---|---|---|---|
| 13 | Kuruluş kredisi paketi | `LOAN_RATE` :117 (tavan), `CX_MARGIN, CX_RATE_MIN` :267, `FOUND_HARC` :41, `FOUND_BUF` :287, `FOUND_COLLAT` :535, `RM_LO/RM_HI` :182 | P | Kamu kredi programı (kredi garanti fonu) ve kredi veren lonca | Faiz = taban + %0,3 × itibar çarpanı, %0,2–%1/hf | R1 (sabit tür kartı) | R1 kartı |
| 14 | Genç firma paketi | `YOUNG_CREDIT` :455, `YOUNG_WEEKS/GRACE/RATE_MULT` :456, `YOUNG_LIM_MULT/POOL_SHARE` :457 | P | Kamu girişimci destek programı | İlk 52 hf, düşük faiz, ödemesiz dönem | R1 | R1 kartı |
| 15 | Büyüme / yatırım paketi | `LOAN_LEV` :124 (eski); `CX_GROW_K, CX_INV_K` :268 | P | Kredi veren (loncaların ortak kredi politikası) | Kredi genişlemesi açıkken limit kâr bazlı (30 / 40 hf kâr); prototip eski 1,5 × işletme sermayesini yazıyor | R1 düzeltti | R1 kartları |
| 16 | Konut ipoteği paketi | `CX_LTV, CX_MORT_TERM, CX_MORT_MARGIN, CX_DSR, CX_MORT_DEF` :272 | P (kredi/değer ve taksit/gelir sınırı: makroihtiyati); marj S/lonca | Bankacılık düzenleyicisi (sınırlar), lonca (marj) | %50 kredi/değer, taksit ≤ gelirin %35'i, 260 hf | "Aç/kapa + faiz marjı" yetersiz | R1 kartı; sınırlar "düzenleyici", marj "lonca" diye etiketli |
| 17 | NPC köprü kredisi | `NPC_BRIDGE, NPC_LEV` :508 | P | Kredi veren lonca (kamu işletmelerine) | Nakit açığı olan yerleşik firmaya borç ≤ 4 × işletme sermayesi | "NPC" terimi | "Yerleşik (kamu) firmalara köprü kredisi" |
| 18 | Sipariş defterine göre kredi | `ORDER_BOOK` :531 | **V** | Kredi verenin davranışı | Köprü kredisi hedef kadroya (karşılanmayan talep dahil) göre boyutlanır | Kural değil, kredi verenin makul davranışı; gerçekte banka zaten siparişe bakar | Dünya varsayımları: "Kredi veren sipariş defterine bakar" (şablon 2'de açık; şablon etiketiyle) |
| 19 | Temerrüt eşiği | `DEF_MISS` :120 | P | İflas ve takip hukuku | 6 hf tam taksit ödenmezse firma batar | Yok | "Kaç hafta ödemeyen firma iflas eder" |
| 20 | Kuruluş fonu kaynağı | `FOUND_FUND` :576, `FF_*` | P | Şehir yönetimi | Şehir kasasından basımsız döner fon | R1, R10 | R1 kaynak çipi |
| 21 | Yeni kredi paketi (serbest tür) | – | P (deneysel) | Kredi programı | Modelde yok | R1 Blok 4 | "Kopyala ve uyarla (deneysel)" |

### 1.4 Bankacılık (4: P 2, V 2)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor | Sorun | Ekranda |
|---|---|---|---|---|---|---|---|
| 22 | Lonca kaldıraç sınırı | `LONCA_LEVERAGE` :407, `LEV_K` :408 | P | Bankacılık düzenleyicisi | Toplam kredi ≤ 25 × özkaynak | "Kaldıraç" terimi | "Bir lonca özkaynağının en çok kaç katı kredi verebilir" |
| 23 | Mevduat nakit rezervi | `DEP_RESERVE` :144 | P | Merkez bankası (zorunlu karşılık) | Mevduatın %20'si nakit tutulur | Yok | "Loncanın kasada tutması gereken mevduat payı" |
| 24 | Faizin mevduata dağıtılan payı | `DEP_PAYOUT` :141 | **V** | Lonca (banka) davranışı | Mevduat faizini bu pay belirler | Oyuncu kuralı değil | Dünya varsayımı; sonucu göstergede (mevduat faizi) |
| 25 | Tahvile ayrılmayan havuz payı | `BOND_POOL_SHARE` :398 | **V** | Lonca portföy kararı | Havuz nakdinin en az yarısı krediye ayrılır | Çift olumsuz ad | Dünya varsayımı: "Loncalar nakdinin en çok yarısıyla tahvil alır" |

### 1.5 Vergiler (9: P 9)

| # | Prototip | Model | Sınıf | Kim | Sorun / not | Ekranda |
|---|---|---|---|---|---|---|
| 26 | Satış vergisi | `SALES_TAX` :301 | P | Şehir meclisi (vergi yasası) | Yok | "Satış vergisi (KDV)" |
| 27 | Ücret stopajı | `WAGE_TAX` :534 | P | Şehir meclisi | Yok | "Ücretten gelir vergisi" |
| 28 | Kurumlar vergisi | `CORP_TAX` :303 | P | Şehir meclisi | Yok | "Firma kârından vergi" |
| 29 | Temettü stopajı | `DIV_TAX` :302 | P | Şehir meclisi | Yok | "Kâr payından vergi" |
| 30 | Yönetici/uzman ve araştırmacı ücret vergisi | `ROLE_TAX` :192, `RES_TAX` :169 | P | Şehir meclisi | Ücret stopajıyla yan yana ikinci bir ücret vergisi; oyuncu ikisinin toplandığını bilmiyor | "Yüksek ücret dilimi (yönetici, uzman, araştırmacı)" + not "Ücretten gelir vergisinin üstüne eklenir" |
| 31 | Lonca sahibi stopajı | `OWNER_TAX` :170 | P | Şehir meclisi | Yok | "Lonca kurucu payından vergi" |
| 32 | Konut işlem harcı; kira geliri vergisi | `HOUSE_TXN` :238, `RENT_TAX` :204 | P | Şehir meclisi | Kira gelirinin %10'u zaten "bakım" adıyla şehre gidiyor (`HOUSE_MAINT` :132); kira vergisi %0 olsa da şehir pay alıyor (§2.8) | İki kart; kira vergisi kartında "kira gelirinin %10'u bakım payı olarak şehre gider" notu |
| 33 | Servet vergisi | `WEALTH_TAX` :202, `WT_FLOOR` :203 | P | Şehir meclisi | 2.000 Akçe eşiği görünmüyor | "Servet vergisi (2.000 Akçe üstüne, haftalık)" + yıllık karşılık |
| 34 | Satış vergisi bütçeyi izlesin | `TAX_RULE` :324 | P | Şehir meclisi (otomatik mali kural) | Ne yaptığı anlaşılmıyor | "Açık verince KDV kendiliğinden artsın" |

### 1.6 Şehir bütçesi (9: P 9)

| # | Prototip | Model | Sınıf | Kim | Sorun / not | Ekranda |
|---|---|---|---|---|---|---|
| 35 | Gider öncelik sırası | `MINT_PRIO` :377 | P | Şehir meclisi (bütçe) | Yok | Sürükle-sırala; "Para yetmezse önce hangisi ödenir" |
| 36 | İşsizlik ödeneği | `UNEMPLOY_BENEFIT` :32, `BENEFIT_WEEKS, BENEFIT_LONG` :31 | P | Şehir meclisi (sosyal güvenlik) | Süre sonrası çarpanı (0,4) görünmüyor | "İşsizlik ödeneği: ücretin %50'si, süre" + "süre bitince %40'ına iner" |
| 37 | Asgari güvence (şehir ödeneği çarpanı) | `WELF_CITY_MULT` :379 | P | Şehir meclisi | "Eski ödenek × 0,6" oyuncuya anlamsız | "Lonca paketi varken şehrin verdiği ödenek: ücretin %30'u" (= %50 × 0,6) |
| 38 | Belediye istihdamı tavanı | `MUNI_SPEND` :46 | P | Şehir meclisi | Yok | "Belediye ücretlerine haftada en çok kasanın %10'u" |
| 39 | Kamu hizmet sözleşmesi | `PUBSVC` :342, `PUBSVC_SHARE` :343 | P | Şehir meclisi | Uzun ad | "Altyapı açığını şehir ödesin" |
| 40 | Kasa tabanı | `TRANS_FLOOR_WEEKS` :539 | P | Şehir meclisi (mali kural) | "zorunlu gider" birimi | "Kasa en az 2 haftalık zorunlu gider kadar kalsın" |
| 41 | Bütçe yüzde payları | – | P (deneysel) | Şehir meclisi | Modelde yok | Değişmez |
| 42 | Kamu alımı | `GOV_PROC` (taşınmadı) | P (deneysel) | Şehir yönetimi | Modelde yok | Değişmez |
| 43 | Kuruluş fonu payı | `FOUND_FUND` :576, `FF_*` | P | Şehir meclisi | R10 | R10 |

### 1.7 Kurtarma ve destek (10: P 8, V 1, Y 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 44 | Zarar eden firmayı kurtarma | `NO_BAILOUT` :499 | P | Şehir yönetimi | Kurucunun ilkesi; doğru | Değişmez |
| 45 | Geçiş desteği | `TRANS_SUPPORT` :536 | P | Şehir yönetimi | "basit / kurtarma kanallı" teknik | "Geçiş desteği: kapalı / kısa süreli / kurtarma fonuyla" |
| 46 | Haftalık destek tavanı | `TRANS_CAP` :537 | P | Şehir meclisi | Yok | Değişmez; "şehirlere nüfusla bölünür" notu |
| 47 | Özel kesim eşiği | `TRANS_THRESH, TRANS_FLOOR2` :538, :541 | P | Şehir yönetimi | Uzun ad | "Destek ne zaman biter: özel firmalar talebin %60'ını karşılayınca" |
| 48 | Destek sürerken özelleştirme dursun | `TRANS_PRIV_OK` :543 | P | Şehir yönetimi | Yok | Değişmez |
| 49 | Özelleştirme | `PRIVATIZE` :512, `PRIV_WEEKS` :514 | P | Şehir yönetimi (özelleştirme idaresi) | Yok | "Zarar eden kamu firması satılsın (6 hafta zarar sonra)" |
| 50 | NPC kâr tamponu | `NPC_KEEP` :502 | P | Şehir yönetimi (kamu firmalarının sahibi olarak) | Kamu firması kâr tamponu üstünü şehre aktarır; "NPC" terimi | "Kamu firmaları kârın ne kadarını elde tutar" |
| 51 | Zararda önce küçül | `SHRINK_FIRST` :532 | **V** | Firma yönetimi (davranış) | Zarar eden firmanın önce kadro azaltması firmanın kendi kararıdır | Dünya varsayımı: "Zarar eden firma önce küçülür" (şablon 2'de açık) |
| 52 | Altyapı idari yönetimi (batmaz) | `INFRA_CONT` :533 | P | İflas hukuku (kamu hizmeti sürekliliği) | Yok | "Altyapı firması iflasta kapanmaz, kayyumla sürer" |
| 53 | Açılış geçiş süresi | `NPC_GRACE` :500 | **Y** | – (model açılış iskelesi) | Açılışta kurtarma eski kurala göre işler | Gizle; Dünya sabitleri kartında bir satır |

### 1.8 Girişim (8: P 3, V 4, Y 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 54 | Girişim kapıları açık | `ENTRY_OPEN` :559 | P (bileşik) | Şehir yönetimi (kuruluş izni) | Altı şeyi birden yapıyor: (2) itibar şartını ve itibara bağlı kredi tavanını kaldırmak politikadır; (1) "kalıcı kıtlık yoksa girme" ve (5) piyasa sinyali kapılarını kaldırmak girişimci davranışıdır; (4) genç kurucu verimi kalibrasyondur; (6) rakip kohortu senaryodur | Böl (R34): P "Firma kurmak için itibar şartı" + V "Girişimci piyasa sinyaline bakar" + V "Rakip kohortu" |
| 55 | Rakip kohortu | `EO_COHORT` :560, `EO_COHORT_PER` :561, `EO_COHORT_W0/W1` :562 | **V** | – (senaryo: kaç girişimci gelir) | Her NPC firmaya 2 rakip firma, 35–50. haftalara yayılarak kurulur; kâr beklentisinden bağımsız | Dünya varsayımı "Girişimci dalgası"; model işi §2.4 |
| 56 | Organik kuruluş hızı | `EO_RATE` :565 | **V** | Girişimci davranışı | Aday başına haftalık sabit %0,2 olasılık | Dünya varsayımı |
| 57 | Genç kurucu verimi | `EO_SKILL` :567 | **V** | Kalibrasyon | Genç firma çalışanı ortalama NPC verimiyle başlar | Dünya varsayımı |
| 58 | Kuruluş harcı | `FOUND_HARC` :41 | P | Şehir yönetimi | Yok | "Firma kuruluş harcı (Akçe)" |
| 59 | Piyasa sinyali şartı | `ENTRY_PM` :49, `WORTH_SHORT_X` :453 | **V** | Girişimci davranışı | Arz fazlasında / girdi eksiğinde girişimci kurmaz | Dünya varsayımı "Girişimci kârsız pazara girmez" |
| 60 | İşsiz deneyimli oyuncu firma kurabilir | `ENTRY_JOBLESS` :414 | **Y** | – | Gerçekte herkes firma kurabilir; bu bir model kısıtı | Gizle; açık kabul et (model işi: varsayılanı açık yap) |
| 61 | Genç firma reçetesi | `YOUNG_KIT` :582, `YK_*` | P (bileşik) | Kamu destek programı + firma davranışı | (1) dayanma limiti ve (6) ödemesiz dönem kredi programıdır (P); (2) talebe bağlı işe alım, (4) giriş fiyatı, (7) ölçek firmanın kararıdır (V); (5) lonca markası lonca kararıdır (P) | Böl (R34): P "Genç firma destek programı" + V "Genç firma davranışı" |

### 1.9 İşgücü (4: V 3, Y 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 62 | Oyuncu firması NPC işçi alabilir | `NPC_LAB_PF` :487 | **Y** | – | Gerçekte işçi istediği işverende çalışır; kapalı hali yapay bir kısıt (K-77 kalıntısı) | Gizle, açık; Dünya sabitleri satırı |
| 63 | Ücretin geçim endeksine uyumu | `WAGE_PASS` :34, `WAGE_CATCHUP` :35 | **V** | İşçi-işveren pazarlığı | week_open.py:189: ücret endeksi = fiyat artışının yarısı + işgücü kıtlığı terimi, haftada %15 yakınsar | Dünya varsayımı. P karşılığı "Asgari ücret" modelde yok (R33, deneysel) |
| 64 | Başlangıç parası (çırak) | `START_AKCE` :19 | **V** | – (başlangıç koşulu) | Açılış servet dağılımı | Dünya varsayımı |
| 65 | Göç payı | `MIGRATION_SHARE` :44, `PLAYER_MIGRATE_SHARE` :48 | **V** | Hanelerin kararı | İş arayanın haftalık göç olasılığı | Dünya varsayımı |

### 1.10 Fiyat ve düzenleme (6: P 2, V 4)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 66 | Düzenlenen sektörler | `PV2_REG` :341 | P | Düzenleyici kurum (tarife) | Tam maliyet tarifesi | Değişmez; "Bu sektörlerde fiyatı düzenleyici belirler" |
| 67 | Haftalık en çok fiyat artışı | `PV2_STEP_UP` :338 | **V** | Firma (fiyat yapışkanlığı) | Bütün firmaların fiyat ayarlama hızı sınırı; denetim değil | Dünya varsayımı. Fiyat kontrolü isteyen için P: "Sektöre özel fiyat tavanı" (#71) |
| 68 | Hedef kâr marjı | `PV2_M0` :327 | **V** | Firma | Maliyet üstü normal marj; rekabet aşırı marjı eritir (`PV2_REV`) | Dünya varsayımı |
| 69 | Kıtlıkta fiyat/kadro desteği | `PM_BOOST_MAX` :283 | **V** | Firma | Kıtlık sinyaliyle kadro hedefi en çok 2 kat | Dünya varsayımı |
| 70 | Navlun oranı | `NAVLUN` :22 | **V** | Taşıma maliyeti kalibrasyonu (gerçek navlun lojistik firmalarının fiyatı, S) | prices.py:81,112: referans fiyat × %20 × mesafe | Dünya varsayımı; ZP rozeti yanlış (zincir kuralı değil) |
| 71 | Sektöre özel fiyat tavanı | `PM_MAX` (genel) :370 | P (deneysel) | Düzenleyici | Modelde yalnız genel çarpan sınırı | Değişmez |

### 1.11 Loncalar (8: P 4, V 3, Y 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 72 | Fee aralığı | `FEE_MIN, FEE_MAX` :184 | P | Lonca kuruluş sözleşmesi / düzenleyici | Loncalar fee'yi bu aralıkta rekabetle oynatır | "Lonca aidatı en az–en çok" |
| 73 | Başlangıç fee'si; adım; sıklık | `LONCA_FEE` :21, `FEE_STEP, FEE_EVERY` :184 | **V** | Lonca sahibinin fiyatlama davranışı | Lonca sahibi 8 hf'de bir ±0,5 puan dener (tepe tırmanma); gerçekleşen fee piyasa sonucu (S) | Dünya varsayımı; gösterge "Ortalama lonca aidatı" |
| 74 | Lonca işletme payı | `expenseBps` (hazine) | P | Lonca yönetimi | Modelde karşılığı yok; modelde gider sabit (`LC_FIXED`) | "Lonca hazinesinin gider payı" + "Ölçülmedi: modelde karşılığı yok" |
| 75 | Lonca değiştirme bekleme süresi | `SWITCH_COOL` :185 (lonca.py:74) | **V** | Firma davranışı (modelde); kontratta `holdPeriod` bir lonca kuralıdır | Modelde firma kendi kararıyla 20 hf bekler | Dünya varsayımı. Zincirdeki üyelik kuralı ayrı P olarak istenirse modelde kurulmalı |
| 76 | Üye üst sınırı | `maxAgents` (hazine) | P | Lonca yönetimi | Modelde karşılığı yok | "Ölçülmedi: modelde karşılığı yok" rozeti |
| 77 | Sosyal paket | `LONCA_WELFARE` :378 | P | Lonca yönetimi | Yok | "Loncalar üyelerine ödenek ve burs sunsun" |
| 78 | Sabit gider; batış süresi | `LC_FIXED, LC_MEMBER` :229, `LONCA_DEAD_WEEKS` :214 | **V** | Maliyet kalibrasyonu | Gider şehre gidiyor (firms.py:124, §2.8) | Dünya varsayımı |
| 79 | Sigorta sektörü | `INSURANCE` :441 | **Y** | – | Sektörü açar | Dünya kuralı "Sigorta şirketleri var" |

### 1.12 Sektör panosu (6: P 1, V 5)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 80 | Sektör panosu | `SECTOR_BOARD` :545 | P (bileşik) | Şehir yönetimi / istatistik kurumu (piyasa verisi yayımı) | Pano yalnız zincirden türetilen veri; firmalar kararlarını ondan besler (alt kurallar V) | "Şehir sektör verisini herkese açık yayımlasın" |
| 81 | Kalıcı kıtlık yoksa oyuncu girmez | `SB_ENTRY_PERSIST` :558 | **V** | Girişimci davranışı | Ana katmanda politika gibi duruyor; gerçekte kimse "girme" diye karar vermez | Dünya varsayımı "Girişimci yalnız kalıcı kıtlıkta girer" |
| 82 | İkinci kaynağa zorunlu pay | `SB_SECOND` :552 | **V** | Alıcı firmanın tedarik kararı | "Zorunlu" adı düzenleme sanılıyor | Dünya varsayımı "Alıcı riskli tedarikçiye bağımlı kalmaz (%25 ikinci kaynak)" |
| 83 | Girdi tamponu | `SB_BUF_LO/HI` :551 | **V** | Firma stok kararı | Yok | Dünya varsayımı |
| 84 | Kıtlık eşiği | `SB_SCARCE` :550 | **V** | Panonun tanımı (kalibrasyon) | Yok | Dünya varsayımı |
| 85 | Fiyat, kadro ve üretim kuralları | `SB_GROW` :555, `SB_PREM_MAX` :557 | **V** | Firma | Yok | Dünya varsayımı |

### 1.13 Konut ve servet (5: P 1, S 1, V 2, Y 1): sahibin örneği

Koordinatörün tespiti doğrulandı, iki düzeltmeyle.

| # | Prototip | Model | Sınıf | Kim | Modelde nasıl çalışıyor | Sorun | Ekranda |
|---|---|---|---|---|---|---|---|
| 86 | Kişi başına yatırım konutu | `HOUSE_INV_MAX` :237 (housing.py:60, :209) | P | Şehir yönetimi / konut düzenleyicisi (K-179 sahip kararı) | Kişi başına en çok 2 konut alınabilir; fazlası zorla satılmaz, yenisi alınamaz | Ne seçildiği belli değil. **Düzeltme 1:** modelde oturulan ev yok (K-179 "Sınırlar"): herkes kiracı, sahip olunan her konut kiraya verilir; "oturduğu ev dışında" demek yanlış olur | "Konut yatırım sınırı" · "Bir kişi kiraya vermek için en çok kaç konut alabilir. Modelde herkes kirada oturur; alınan konut kiraya verilir." Örnek: "2 = bir kişi en çok iki evin kira gelirini toplar" |
| 87 | Kira düzeyi (ücretin payı) | `RENT_H` :126; `HOUSE_ELAST` :129; `RM_MIN, RM_MAX, RM_RATE` :130; week_close.py:65–67 | **S** (taban V) | Piyasa (doluluk) | Kira = %8 × çırak ücreti × ücret endeksi × kira çarpanı; çarpan = (doluluk × 1,15)^1,5, 0,7–2,5 arasında, haftada %10 yaklaşır. %8 doluluk normalken çırak kirasıdır, gerisi piyasa | Oyuncu kira seçiyor sanıyor. **Düzeltme 2:** %8 en düşük ücretin payı; params yorumu "gerçekte konut harcaması gelirin %25–30'u" diyor: kalibrasyon gerçeğin çok altında (§2.2) | Ayar kaldırılır. Gösterge "Kira (şehir ortalaması): çırak ücretinin %9'u · doluluk %96 · son 13 hf ▲". Politika karşılığı: P "Kira artış sınırı (kira kontrolü)" deneysel (R33) |
| 88 | Servetten yıllık harcama | `WEALTH_DRAW_YEAR` :231 (households.py:36, :48) | **V** | Hanelerin davranışı | 20 haftalık ücret tamponu üstü servetin yılda %4,5'i harcanır; faize tepkisiz | Oyuncu kuralı değil | Dünya varsayımı "Varlıklılar servetlerinin yılda %4,5'ini harcar" |
| 89 | Harcama eğrisi eğimi | `MPC0, MPC_SLOPE` :206 (households.py:36) | **V** | Hanelerin davranışı | Harcama = 0,9 × gelir × (gelir/ref)^-0,15 | "Eğim" teknik | Dünya varsayımı "Gelir arttıkça harcanan pay azalır" |
| 90 | İkinci el piyasası; mevduat | `RESALE_ON` :217, `DEP_ON` :137 | **Y** | – | `RESALE_ON` mücevher ve konut iyileştirmesinin ikinci el piyasasıdır (K-174); **konutun** ikinci el piyasası ayrı mekanizma (`HOUSE_INV`, K-179). `DEP_ON` kapanırsa lonca kredisinin kaynağı kurur | Ad yanıltıcı; iki ilgisiz anahtar tek kartta | Dünya kuralları: "Eşya (mücevher, ev eşyası) ikinci el satılabilir" ve "Haneler loncaya mevduat yatırır". Mevduat anahtarı gizlenebilir |

### 1.14 İnovasyon ve sektörler (6: P 3, V 2, Y 1)

| # | Prototip | Model | Sınıf | Kim | Nasıl çalışıyor / sorun | Ekranda |
|---|---|---|---|---|---|---|
| 91 | Ar-Ge payı (lonca programı) | `PROG_ARGE` :167 | P | Lonca yönetimi | Yok | "Lonca gelirinin Ar-Ge'ye giden payı" |
| 92 | Patent süresi | `PATENT_TERM` :161 | P | Patent yasası | Yok | Değişmez; "52 hf = 1 yıl" |
| 93 | Telif oranı tavanı; üyeye oran | `TELIF_X0, TELIF_XMIN` :159 | P | Düzenleyici (tavan), lonca (üye oranı) | Gerçekleşen oran rekabetle iner (S) | İki kontrol; gösterge "ortalama telif" |
| 94 | Teknoloji yayılma gecikmesi | `DIFFUSE_LAG` :110 | **V** | – | **Ölü parametre:** inovasyon açıkken tech.py:130 `PATENT_TERM` kullanıyor | Gizle |
| 95 | Yeni sektör açılış eşikleri | `SW_UNLOCK` :56 ve benzerleri | **V** | Teknoloji ağacı kalibrasyonu | Yok | Dünya varsayımı |
| 96 | Sektörleri aç/kapa | `DIRECT_AD, MEDIA_LONCA, HEALTH, EDUCATION, *_ON` | **Y** | – | Mekanizma anahtarları | Dünya kuralları, her sektör tek satır açıklamalı |

### 1.15 Dünya geneli (1: Y 1)

| # | Prototip | Model | Sınıf | Not | Ekranda |
|---|---|---|---|---|---|
| 97 | Şehre özel kural | – | **Y** (deneysel) | Kurallar bugün dünya geneli | Değişmez |

### 1.16 Sayım ve bölünecek kartlar

| Grup | P | V | S | Y |
|---|---|---|---|---|
| 1 Para | 5 | 0 | 0 | 0 |
| 2 Faiz | 6 | 0 | 1 | 0 |
| 3 Kredi | 8 | 1 | 0 | 0 |
| 4 Bankacılık | 2 | 2 | 0 | 0 |
| 5 Vergiler | 9 | 0 | 0 | 0 |
| 6 Bütçe | 9 | 0 | 0 | 0 |
| 7 Kurtarma | 8 | 1 | 0 | 1 |
| 8 Girişim | 3 | 4 | 0 | 1 |
| 9 İşgücü | 0 | 3 | 0 | 1 |
| 10 Fiyat | 2 | 4 | 0 | 0 |
| 11 Loncalar | 4 | 3 | 0 | 1 |
| 12 Pano | 1 | 5 | 0 | 0 |
| 13 Konut | 1 | 2 | 1 | 1 |
| 14 İnovasyon | 3 | 2 | 0 | 1 |
| Dünya geneli | 0 | 0 | 0 | 1 |
| **Toplam (97)** | **61** | **27** | **2** | **7** |

Ana katmanda (A) duran ve P olmayan kartlar (oyuncu ilk anda bunları görüyor): Sipariş defterine göre kredi, Kalıcı kıtlık yoksa oyuncu girmez, Rakip kohortu, Oyuncu firması NPC işçi alabilir, Ücretin geçim endeksine uyumu, Haftalık en çok fiyat artışı, Kira düzeyi, Mevduat faizi tavanı (P ama etkisiz), Genç firma reçetesi (bileşik). Bunlar ana katmandan çıkar.

Bölünecek bileşik kartlar: Girişim kapıları (#54), Genç firma reçetesi (#61), Sektör panosu (#80), Doğal işsizlik (#10). Şablonların V değiştirdiği yerler: şablon 2 (B paketi) `SHRINK_FIRST` ve `ORDER_BOOK`, şablon 5 kohort ve sinyal kapıları. Bu V değişiklikleri şablon kartında "Bu şablon 2 dünya varsayımını da değiştirir" diye görünmeli.

Önerilen yeni politika kartları (deneysel, gerçek dünyada var, modelde yok): Kira artış sınırı (kira kontrolü), Asgari ücret, Konut kredisinde düzenleyici sınırların ayrı kartı (R1 #9'da var). Hepsi "Deneysel / model işi".

## 2. Model yapılandırma denetimi (sahibin asıl kaygısı)

Soru: gerçekte piyasanın belirlemesi gereken ama modelde sabit ya da elle verilmiş değerler hangileri, tersi var mı? Öncelik: **Y** (yüksek) oyuncunun kararlarının sonucunu bozuyor; **O** (orta) gerçekçiliği bozuyor ama sonuç yönü doğru; **D** (düşük) temizlik.

| # | Konu | Modelde bugün | Neden sorun | Gerçekçi çözüm (kısaca) | Öncelik |
|---|---|---|---|---|---|
| 2.1 | **Tasarruf ve tüketim faize duyarsız** | households.py:36, :47–48: harcama = `MPC0` × gelir × eğri + servetin yılda %4,5'i; faiz terimi yok. Mevduat payı sabit (`DEP_KEEP_NEW` :233, `DEP_SHARE`; week_close.py:230–232). K-179 kendisi yazıyor: "tasarruf faize duyarsız olduğundan mevduat büyümeye devam etti", "birikimi dolaşıma döndüren yatırım talebi yok" | Para politikasının en büyük kanalı (faiz düşünce harcama artar, tasarruf azalır) yok. Faiz yalnız kredi ve konut üstünden işliyor. `POL_CD` (kredi/mevduat hedefi) bu eksikliğin yaması. Oyuncu faizi düşürünce talebin canlanmasını bekler, olmaz | Servetten harcama payı ve mevduata yatırılan pay reel faize bağlansın: pay = taban × (1 + k × (r* − r)), sınırlı. Kalibrasyon: faiz 1 puan/yıl düşünce harcama birkaç ayda %0,5–1 artar | Y |
| 2.2 | **Kira piyasadan değil sabit orandan; konut fiyatı kiradan** | week_close.py:65–67: kira = `RENT_H` %8 × çırak ücreti × ücret endeksi × doluluk çarpanı (0,7–2,5, %10/hf). world_init.py:127 açılış. Birincil konut fiyatı = kira / `HOUSE_YIELD` 0,003 (housing.py:37, params.py:131): şehir boş stoğunu faizden bağımsız sabit getiriyle satar | Kira hane gelirine, faize ve konut fiyatına değil, en düşük ücrete endeksli; doluluk çarpanı yalnız bir düzeltme. Fiyat kiradan türediği için faiz düşünce birincil fiyat değişmiyor; ikinci el fiyatı temel değere (net kira / faiz) çekilince temel değer 4 katına çıkabiliyor (K-179: tepe 153, dip 24, %84 düşüş). Kalibrasyon: %8 × çırak ücreti, params yorumundaki gerçek %25–30 gelir payının çok altında | Kira bir önceki kiradan doluluk ve hane gelir artışına göre sürüklensin (çıpa ücret değil, kiracı geliri ve boşluk oranı); `RENT_H` yalnız açılış değeri olsun. Birincil fiyat = temel değer (net kira / (faiz + risk primi)) ile inşaat maliyetinin büyüğü. Kira yükü hedefi gelirin %20–30'una kalibre edilsin | Y |
| 2.3 | **Ücretler sabit katman oranları, şehir çapında tek endeks; iki doğal işsizlik** | `TIER_WAGE` (10, 15, 20) :16; week_open.py:189: endeks = fiyat artışının `WAGE_PASS` payı + `LAB_K` × 0,1 × (`LAB_U_STAR` 0,20 − işsizlik). Faiz kuralı `POL_U_STAR` 0,25 kullanıyor. Firmalar ücretle işçi için yarışmıyor (yalnız yönetici/uzman `MWI` :200) | Kıt beceriye, kârlı sektöre ya da boş kadroya göre ücret farkı oluşmuyor; firma "daha çok öde, işçi bul" diyemiyor. İki ayrı normal işsizlik değeri tutarsız: ücret %20'nin altında yükselir, faiz %25'in altında yükselir | Tek doğal işsizlik parametresi (ya da ölçülen ortalama). `MWI` benzeri boş kadro primi bütün katmanlara ve sektör × şehir düzeyine; katman oranları açılış değeri olsun | Y |
| 2.4 | **Girişim senaryoya bağlı** | Rakip kohortu: her NPC firmaya 2 rakip, 35–50. haftalara yayılır (`EO_COHORT_*` :560–562); organik kuruluş sabit %0,2/hf (`EO_RATE` :565). `ENTRY_OPEN` sinyal kapılarını kaldırıp sektör seçimini "tercih ağırlığına" çeviriyor | Girişim sayısı kâr beklentisinden, kredi erişiminden, faizden bağımsız; oyuncunun girişim politikası (harç, kredi, itibar şartı) kuruluş sayısını değil yalnız sağkalımı değiştiriyor. %7–12 sağkalım bu yüzden kısmen senaryonun eseri | Kuruluş olasılığı = f(beklenen kâr marjı − kredi faizi, kıtlık sinyali, kredi onayı); kohort yalnız açılış tohumu olarak kalsın | Y |
| 2.5 | **Tahvil faizi borca tepkisiz** | policy.py:16, :47: faiz = taban × 0,5 + %0,05; borç tavanında yalnız harcama kısılıyor | Gerçekte borç arttıkça faiz (risk primi) artar; burada şehir borcu hep en ucuz borç. Oyuncu borçlanmanın bedelini görmüyor | Marj = f(borç / gelir) ya da lonca havuzlarının talebiyle basit ihale | O |
| 2.6 | **Konut inşaatı sektörsüz ve sert eşikli** | housing.py:156–158: inşaat maliyeti = malzeme × (1 + %25 emek), emek payı ve arsa (`HOUSE_PLOT` %10 × birincil fiyat) şehre gider; geliştirici yalnız faiz < %0,45/hf (`HOUSE_RATE_MAX` :432) iken kurar | Konut arzı istihdam yaratmıyor; faizle kademeli değil açık/kapalı tepki veriyor | İnşaat firmaları sipariş alsın (kadro ve ücret); eşik yerine getiri − faiz farkıyla orantılı inşaat hızı (zaten `HOUSE_BUILD_K` :244 var, eşiği kaldır) | O |
| 2.7 | **Oturulan ev yok** | K-179 "Sınırlar": herkes kiracı; sahiplik yalnız yatırım | "Ev sahibi olmak" (kira ödememek, ipotek ödemek) bir hane kararı olarak yok; yatırım sınırı ve ipotek oyuncuya garip görünüyor | Hane ev satın alabilsin: kira yerine taksit; kiracı/sahip seçimi kira ile taksit + bakımın karşılaştırması | O |
| 2.8 | **Şehre giden gizli kalemler** | Kira gelirinin %10'u "bakım ve vergi" adıyla şehre (`HOUSE_MAINT` :132, housing.py:44); lonca sabit ve üye giderleri şehre (`LONCA_COST` :228, firms.py:124); konut emek payı ve arsa şehre (housing.py:158) | Kira vergisi %0 görünürken şehir kiradan pay alıyor; kasa gelirinin bir kısmı oyuncunun yazmadığı vergilerden. Oyuncu kasa açığını yanlış yorumlar | Ya görünür kılınsın (Vergiler sekmesinde salt okunur "dünyanın sabit kalemleri" satırı) ya da gerçek alıcıya (bakım firması, lonca çalışanları, inşaat sektörü) aktarılsın | O |
| 2.9 | **Kredi marjı rekabetsiz** | `CX_MARGIN` %0,3/hf sabit :267; loncalar mevduat için yarışıyor (en yüksek faizi verene gider) ama kredi faizinde yarışmıyor; lonca risk marjı (credit_core.py:225) yalnız geçmiş kayba bakıyor | Bol nakitli lonca kredi faizini düşürmüyor; oyuncu "marj"ı ayar sandığı için kendi seçiyor | Lonca marjı boştaki nakde (kredi/mevduat) göre ayarlansın; Şart'ta yalnız taban ve tavan kalsın | O |
| 2.10 | **Yerli üretim programı görünmez** | `DOMESTIC_EVERY` = 6 :100: her 6 haftada şehir başına en çok ithal edilen türe NPC firma kurulur | Gerçekte bir sanayi politikası (ithal ikamesi); oyuncu görmüyor, seçmiyor | P kartı olsun ("Yerli üretim programı: her N haftada bir kamu firması kur") ya da Dünya varsayımlarında görünür satır | O |
| 2.11 | **Navlun sabit çarpan** | prices.py:81, :112: referans fiyat × %20 × mesafe; lojistik marjı denetleyiciyle (`PV2_MM_*`) sınırlı | Taşıma maliyeti lojistik kapasitesine ve yakıta tepki vermiyor; prototipte politika (ZP) sanılıyor | Navlun lojistik firmalarının fiyatından (maliyet + marj) türesin; `NAVLUN` yalnız açılış çıpası | D |
| 2.12 | **Fiyat ayarlama kalibrasyonu sonucu taşıyor** | `PM_ADJ` 0,08 :370; 0,078–0,088 aralığında çöküş haftası ±10 hf oynuyor | Bir kalibrasyon katsayısı politika etkisi kadar sonucu değiştiriyor; tek koşu sonucu yanıltıcı | Mevcut çözüm doğru (6 tohum, "dünya tohumu"); oyunda tek koşu sonucu her zaman aralıkla gösterilsin | D |
| 2.13 | **Ölü ve uyumsuz parametreler** | `DIFFUSE_LAG` (tech.py:130 inovasyon açıkken kullanmıyor); `SWITCH_COOL` modelde firma davranışı, kontratta `holdPeriod` lonca kuralı; `expenseBps`, `maxAgents` modelde yok | Prototip modelde karşılığı olmayan ya da çalışmayan ayarları gösteriyor | Gizle ya da "modelde karşılığı yok" rozeti | D |
| 2.14 | **Prototip varsayılanları ile v13.0 params farklı** | params.py bugün B paketi ve deney bayrakları açık: `WAGE_TAX` 0,1, `CORP_TAX` 0,2, `ENTRY_OPEN` 1, `SECTOR_BOARD` 1, `TRANS_SUPPORT` 2, `SB_ENTRY_PERSIST` −1, `FOUND_FUND` 1, `YOUNG_KIT` 1, `NPC_KEEP` 2. Prototip "serbest piyasa" tabanını gösteriyor | Hangisinin "varsayılan Şart" olduğu belirsiz; ölçüm metinleri hangi tabana göre okunacak | Sahip kararı: prototipte varsayılan = şablon 1 (serbest piyasa), model varsayılanı = deney tabanı; Dünya varsayımları paneline "model sürümü v13.0" etiketi | O |

**Tersi (oyuncuya verilen ama piyasa olması gereken):** kira düzeyi (#87), tahvil faizi (#12), mevduat faizi (#8 adı yüzünden), navlun (#70), başlangıç fee'si (#73), hedef kâr marjı (#68). Hepsi revizyon-2'de göstergeye ya da Dünya varsayımlarına taşındı.

**Tersi (politika olması gereken ama elle gömülü):** yerli üretim programı (2.10), şehre giden gizli kalemler (2.8), asgari ücret ve kira kontrolünün yokluğu (R33'te deneysel kart).

**Önerilen sıra (model işi, kod bu denetimde değişmedi):** 2.1 → 2.2 → 2.3 → 2.4 birlikte bir "davranış turu" (her biri tek bayrak, kapalıyken çıktı aynı, 6 tohumda ölçüm); 2.8 ve 2.13 hızlı temizlik; 2.5–2.7, 2.9–2.11 sonraki tur.

## 3. Aktör davranışları: modelde ne kodlu, ne eksik, gerçekçi kalibrasyon

Sahibin istediği (b) katmanı için her aktörün modeldeki davranışı. "Kodlu" = modelde açık bir kural var; "indirgenmiş" = tek parametre ya da sabit; "yok" = kodda bulunamadı (grep ile arandı; yokluk iddiası arama kapsamıyla sınırlı). Kalibrasyon sütunu gerçek dünya aralığıdır; kaynaklar tablonun altında. Oyun ölçeği (yıllık ~%52 kredi faizi gibi) gerçek değerlerden bilinçli sapabilir; o durumda oranlar (gelir payı, yıllık pay) karşılaştırılır.

### 3.1 Hane (tüketici) davranışı

| Davranış | Modelde bugün | Durum | Gerçekçi kalibrasyon | Not |
|---|---|---|---|---|
| Gelirden harcama, gelir sınıfına göre | households.py:36, :47: harcama = 0,9 × gelir × (gelir / ref)^-0,15 (`MPC0, MPC_SLOPE` params.py:206); ref = 12 × ücret endeksi. Sürekli tek eğri; ayrı sınıf yok. Gelir ref'in %30'unun altındaysa eğri sabitlenir ve oran 1'i aşar (~1,08: yoksul gelirinden fazla harcar) | İndirgenmiş (tek eğri, 2 parametre) | Yıllık marjinal tüketim eğilimi: düşük likiditeli/alt gelir 0,5–0,9; orta 0,3–0,5; üst gelir 0,1–0,3 [1][2][3]. Ortalama tüketim/gelir oranı: alt beşte bir ≥1, üst beşte bir ~0,6–0,7 [4] | Eğri yönü doğru; üst uçta düşüş zayıf (3 × ref gelirde oran hâlâ 0,76). Sınıf profiline çevrilmeli (aşağıda öneri) |
| Servetten harcama | `WEALTH_DRAW_YEAR` %4,5/yıl, 20 hf ücret tamponu üstü (households.py:36, :48; K-179) | Kodlu (tek parametre) | Servet etkisi yılda servetin %2–5'i [5][6] | Değer aralıkta. Faize ve servet türüne (konut/finansal) duyarsız |
| Az birikimli hanenin harcaması | `WRULE_ON` (K-185.13): birikim < 12 haftalık harcama ise zorunlu sepet + kira tam, ek harcama birikimin haftalık %3'ü (`WR_WEEKS, POOR_SHARE` :481); 0,75–1,25 × eşik arası karışım (`WR_BLEND` :482) | Kodlu | "Elden ağza" haneler (likit servet ~0) nüfusun ~%25–35'i; bunlar gelir şokunun büyük kısmını harcar [2] | Haftalık %3 = yılda birikimin ~%150'si: birikim birkaç ayda erir; yoksul hiç tampon biriktirmiyor (ihtiyat güdüsü yok) |
| Tasarruf, faize tepki | Yok: harcama ve mevduat payı faiz içermiyor; mevduat = elde 2 haftalık harcama tutulur, fazlanın haftalık %50'si yatırılır (`DEP_KEEP_NEW` :233, `DEP_SHARE`; week_close.py:230–232); yalnız *hangi* loncaya yatırılacağı faize bakar | Yok | Zamanlar arası ikame esnekliği 0,3–0,5 (meta-analiz) [7]: faiz 1 puan artınca tüketim büyümesi ~0,3–0,5 puan artar | §2.1, en yüksek öncelik |
| İhtiyat tasarrufu (gelir belirsizliğine karşı tampon) | Yok (tampon sabit: 20 hf ücret ya da 12 hf harcama eşiği) | Yok | Haneler ortalama 2–6 aylık gelir kadar likit tampon hedefler; işsizlik riski artınca tasarruf artar [8] | İşsizlik artınca harcamanın düşmemesi çöküşü yumuşatıyor ya da geciktiriyor olabilir |
| Alışkanlık (harcama yavaş uyum) | `HAB_UP, HAB_DOWN` %5 / %2 döngü başına (:208) | Kodlu | Tüketim alışkanlığı kalıcılığı yıllık 0,5–0,7 [9] | Makul |
| Lüks ve kalem seçimi | `LIFE_CATS` gelir esneklikleri (:210), düzey sınırları (:212) | Kodlu | – | Makul |
| Konut kararı | Herkes kiracı (K-179); kira payı = %8 × çırak ücreti × ücret endeksi × doluluk çarpanı (week_close.py:65–67); yatırım konutu yalnız getiri karşılaştırması | İndirgenmiş | Kira yükü gelirin %20–30'u [10]; brüt kira getirisi yılda %3–7, fiyat/yıllık kira 15–30 [11] | Modelde brüt getiri `HOUSE_YIELD` 0,003/hf = yılda %15,6 → fiyat/yıllık kira ~6,4: konut gerçeğe göre 2–4 kat ucuz; kira payı da düşük. §2.2, §2.7 |
| Göç | `MIGRATION_SHARE` %5 (NPC), `PLAYER_MIGRATE_AFTER` 2 hf, `PLAYER_MIGRATE_SHARE` %50 (:44–48); kira göçü frenler (`HOUSE_BRAKE` :136) | Kodlu (eşik + pay) | İç göç yılda nüfusun %1–3'ü; işsizlik farkına tepki yavaş (yıllar) [12] | 2 hf işsizlikten sonra haftada %50 göç gerçeğe göre çok hızlı; oyun hızı için bilinçli olabilir, işaretlenmeli |

### 3.2 Girişimci davranışı

| Davranış | Modelde bugün | Durum | Gerçekçi kalibrasyon | Not |
|---|---|---|---|---|
| Firma kurma eğilimi | Organik: aday başına haftalık %0,2 sabit (`EO_RATE` :565); rakip kohortu senaryo (:560–562); eski yol: piyasa sinyali kapıları (`ENTRY_PM` :49, `WORTH_SHORT_X` :453, `MARKET_ROOM` :223) | İndirgenmiş | Yıllık yeni işletme oranı nüfusun ~%0,3–1'i; giriş kârlılık ve kredi koşullarına duyarlı [13] | §2.4 |
| Sektör seçimi | Sinyal kapıları ya da `ENTRY_OPEN` ile "tercih ağırlığı" (deterministik) | Kodlu | – | Beklenen kâr yerine kıtlık sinyaline bakıyor |
| Risk alma | Yok (itibar ve kredi şartı dışında girişimci tipi yok) | Yok | Girişimciler risk toleransında farklıdır; yeni firma kurucularının çoğu aşırı iyimserdir [14] | Profil parametresi olabilir ("riskten kaçan girişimciler" senaryosu) |
| İşe alım ve küçülme | Kadro hedefi talebe göre (`STAFF_BUFFER` :28, `PM_BOOST_MAX` :283); genç firma haftada en çok 1 kişi (reçetesiz); `SHRINK_FIRST` zararda önce küçül (:532) | Kodlu | – | Makul; reçetesiz genç firma kuralı çok sıkı (ölçüm: kadro 2,2–3,6) |
| Fiyat stratejisi | `PRICE_V2` maliyet + %10 marj (:320, :327), rekabet aşırı marjı eritir (`PV2_REV` :334), haftalık artış sınırı %20 (:338), giriş fiyatlaması genç firma reçetesinde | Kodlu | Fiyatlar ortalama 8–11 ayda bir değişir (Nakamura–Steinsson, params yorumu :557) [15] | Makul |
| Sağkalım (sonuç) | 52 hf sağkalım %7–12 (ölçüm) | Sonuç | Yeni işletmelerin ~%80'i ilk yılı çıkarır [16] | Gerçeğin çok altında: girişim, kredi ya da talep davranışında yapısal sorun işareti; davranış turunda hedef ölçüt olmalı |

### 3.3 İşçi davranışı

| Davranış | Modelde bugün | Durum | Gerçekçi kalibrasyon | Not |
|---|---|---|---|---|
| Ücret | Şehir çapında endeks (week_open.py:189), katman ücretleri sabit oranlı (`TIER_WAGE` :16); işçi pazarlık yapmaz | İndirgenmiş | Ücretler aşağı yapışkan (kodlu: `LAB_DOWN` 0,3 :489); fiyat artışını kısmen yansıtır (0,5 makul) | §2.3 |
| İş arama, ücret beklentisi | İş arayan ilk uygun boş kadroya girer; rezervasyon (kabul) ücreti ve iş değiştirme kodda bulunamadı | Yok | Ödenek/ücret oranı (ikame oranı) yükseldikçe arama süresi uzar: ödenek süresi 1 hf uzayınca işsizlik süresi ~0,1–0,2 hf uzar [17] | İşsizlik ödeneğinin işgücüne etkisi bu yüzden modelde yok; ödenek yalnız talebi besliyor |
| Beceri ve terfi | `SKILL_ON` tecrübe basamakları, kontenjanlı terfi (week_open.py:191) | Kodlu | – | Makul |

### 3.4 Yatırımcı (varlıklı hane) davranışı

| Davranış | Modelde bugün | Durum | Gerçekçi kalibrasyon | Not |
|---|---|---|---|---|
| Mevduat / konut / DAO payı tercihi | Getiri karşılaştırması: konut net getirisi > mevduat + %0,05/hf (`HOUSE_RISK_PREM` :235); DAO payı beklenen getiri > mevduat + %0,3/hf (`EQ_RISK_INV` :251), yatırılabilir paranın en çok yarısı, kişi başı en çok 6 pay (:252); mevduat en yüksek faizli loncaya | Kodlu (en eksiksiz aktör) | Hisse risk primi yılda %4–6 [18]; konut risk primi yılda %2–4 | Modelde DAO primi %0,3/hf = yılda ~%16: oyun ölçeğinde yüksek; konut primi yılda ~%2,6 makul |
| Fiyat beklentisi | Konut: son ~12 haftanın eğilimi × 0,5, haftalık ±%0,3 (`HOUSE_EXP_N, HOUSE_EXP_DAMP` :236) | Kodlu | Konut fiyat beklentileri geçmişe dayalı (ekstrapolatif) [19] | Makul; kaldıraçla birlikte %84'lük düşüşü üretiyor (K-179) |
| Satış (sıkışma) | Nakit + mevduat < 0,5 hf harcama ise satar (`HOUSE_SQUEEZE_W` :243) | Kodlu | – | Makul |

### 3.5 Yerleşik (NPC) firma davranışı

| Davranış | Modelde bugün | Durum | Not |
|---|---|---|---|
| Üretim ve kadro | Talebe göre kadro, kıtlıkta en çok 2 kat (`PM_BOOST_MAX`), sipariş defterine göre kredi (`ORDER_BOOK`) | Kodlu | – |
| Kâr dağıtımı | Kâr tamponu (`NPC_KEEP`) üstü şehre | Kodlu (P olarak sınıflandı: şehir sahip) | – |
| Batma / özelleşme | 13 hf ödeme gücü yoksa batar (`NPC_DIE_WEEKS` :502), 6 hf zararda özelleştirmeye çıkar (`PRIV_WEEKS` :514) | Kodlu | – |
| Kurulma | Yerli üretim programı her 6 hf (`DOMESTIC_EVERY` :100) | Kodlu, görünmez | §2.10 |
| Fiyat | Oyuncu firmasıyla aynı (PV2) | Kodlu | – |

### 3.6 V ayarlarının aktör ekranlarına dağılımı (revizyon-2 R25)

| Ekran | Prototipten gelen kartlar (#) | Yeni (modelde var, prototipte yok) |
|---|---|---|
| Hane | 88 servetten harcama, 89 gelir-harcama eğrisi, 65 göç, 64 başlangıç parası | az birikimli hanenin harcaması (`POOR_SHARE`, `WR_WEEKS`), alışkanlık hızı, mevduat elde tutma (`DEP_KEEP_NEW`) |
| Girişimci | 55 rakip kohortu, 56 organik kuruluş, 57 genç kurucu verimi, 59 piyasa sinyali, 81 kalıcı kıtlık, 68 hedef marj, 67 fiyat artış hızı, 69 kıtlıkta kadro, 51 zararda önce küçül, 83 girdi tamponu, 82 ikinci kaynak, 85 pano fiyat/kadro kuralları | – |
| İşçi | 63 ücretin fiyatlara uyumu | ücret yapışkanlığı (`LAB_DOWN`), işgücü kıtlığında ücret artışı (`LAB_K`) |
| Yatırımcı | 24 mevduata dağıtılan faiz payı (lonca), 25 tahvile ayrılmayan pay (lonca), 73 lonca fee arama | konut risk primi, DAO payı risk primi, fiyat beklentisi |
| Yerleşik firma | 18 sipariş defterine göre kredi | batma süresi, özelleşme süresi (P'de kalır), yerli üretim programı |
| Dünya kalibrasyonu (aktörsüz, uzman) | 70 navlun, 84 kıtlık eşiği, 95 sektör açılış eşikleri, 78 lonca gideri | konut brüt getirisi (`HOUSE_YIELD`), kira tabanı (`RENT_H`) |

Not: lonca davranışları (24, 25, 73) "Yatırımcı" ekranında "loncalar (bankalar) böyle davranır" alt başlığıyla durur; ayrı ekran açmaya değmez.

### 3.7 Öneri: "davranış profilleri" modülü (model işi; kod değişmedi)

1. **Yeni modül `simkit/behavior.py` + `params.py` içinde tek sözlük `BEHAVIOR`**: aktör → parametre. Bugün dağınık duran davranış sabitleri (`MPC0, MPC_SLOPE, WEALTH_DRAW_YEAR, POOR_SHARE, WR_WEEKS, HAB_*, DEP_KEEP_NEW, DEP_SHARE, MIGRATION_*, EO_RATE, ENTRY_PM, WORTH_SHORT_X, SB_ENTRY_PERSIST, PV2_M0, PV2_STEP_UP, PM_BOOST_MAX, SHRINK_*, WAGE_PASS, WAGE_CATCHUP, LAB_*, HOUSE_RISK_PREM, HOUSE_EXP_*, EQ_RISK_INV, EQ_FRAC, ORDER_BOOK, SB_*`) buradan okunur. İlk adım yalnız taşımadır: çıktı birebir aynı (kapı ölçütü: 6 tohum, CSV eşitliği).
2. **Gelir sınıfı profili (hane):** tek eğri yerine üç sınıf (alt / orta / üst; sınırlar ücret endeksine göre, ör. < 0,7 × ref, 0,7–2 × ref, > 2 × ref) ve her sınıfa: gelirden harcama oranı (varsayılan 0,95 / 0,8 / 0,6), servetten yıllık harcama (%6 / %4,5 / %3), tampon hedefi (4 / 12 / 26 hafta harcama), faiz duyarlılığı (0,1 / 0,3 / 0,5). Geçişler sınır çevresinde karışımlı (bugünkü `WR_BLEND` gibi). İkinci adım bayrakla (`BHV_CLASS=0` kapalıyken bugünkü eğri).
3. **Faiz duyarlılığı (hane, yatırımcı):** harcama payı ve mevduat payı reel faizle (r − r*) ayarlanır (§2.1); `POL_CD` yaması ölçümden sonra gözden geçirilir.
4. **İhtiyat güdüsü:** tampon hedefi şehrin işsizlik oranıyla artar (işsizlik %10 puan artınca hedef +%20–30).
5. **Girişimci profili:** kuruluş olasılığı = taban × f(beklenen marj − kredi faizi) × risk toleransı; kohort yalnız açılış tohumu (§2.4). Hedef ölçüt: 52 hf sağkalım gerçeğe (~%80) yaklaşsın ya da farkın nedeni açıklansın.
6. **İşçi profili:** rezervasyon ücreti = max(ödenek, son ücret × (1 − düşüş hızı × işsiz hafta)); teklif altındaysa reddeder (§3.3).
7. **Piyasa olması gereken sabitler** aynı turda: kira (§2.2: önceki kiradan sürüklenme, `RENT_H` yalnız açılış), konut birincil fiyatı (temel değer / inşaat maliyeti), tahvil faizi (§2.5), navlun (§2.11), kredi marjı (§2.9), ücret primi (§2.3). Kalibrasyon hedefleri: kira yükü gelirin %20–30'u, fiyat/yıllık kira 15–25.
8. **Hazır dünya senaryoları** (oyundaki "dünya senaryosu" seçicisinin modeldeki karşılığı; her biri `BEHAVIOR` üstüne yama): *Gerçekçi (varsayılan)*, *Tutumlu toplum* (harcama oranları −0,1, tampon ×2), *Savurgan toplum* (+0,05, tampon ×0,5), *Riskten kaçan girişimciler* (kuruluş tabanı ×0,5, marj beklentisi +5 puan), *Atak girişimciler* (×2), *Hareketli işgücü* (göç ×2), *Yapışkan ücretler* (`LAB_DOWN` 0). Her senaryo 6 tohumda ölçülüp prototipe ölçüm metniyle girer; ölçülmeyen senaryo "Ölçülmedi" rozetli.
9. **Sıra:** 1 (taşıma, risksiz) → 3 + 2 (davranış turu, en büyük etki) → 7 (piyasa sabitleri) → 5, 6 → 8.

### 3.8 Kaynaklar (kalibrasyon)

[1] Jappelli, T., Pistaferri, L. (2014), "Fiscal Policy and MPC Heterogeneity", *AEJ: Macroeconomics* 6(4): ortalama MPC ~0,48, düşük nakitli hanelerde belirgin yüksek. [2] Kaplan, G., Violante, G. (2014), "A Model of the Consumption Response to Fiscal Stimulus Payments", *Econometrica* 82(4): "varlıklı elden ağza" haneler nüfusun ~1/3'ü. [3] Fagereng, A., Holm, M., Natvik, G. (2021), "MPC Heterogeneity and Household Balance Sheets", *AEJ: Macroeconomics* 13(4): piyango gelirinden ilk yıl harcanan pay ~0,5, likiditesi düşük hanelerde yüksek. [4] Dynan, K., Skinner, J., Zeldes, S. (2004), "Do the Rich Save More?", *JPE* 112(2): tasarruf oranı yaşam boyu gelirle artar. [5] Case, K., Quigley, J., Shiller, R. (2005), "Comparing Wealth Effects", *Advances in Macroeconomics* 5(1). [6] Carroll, C., Otsuka, M., Slacalek, J. (2011), "How Large Are Housing and Financial Wealth Effects?", *JMCB* 43(1): uzun dönem servet etkisi yılda ~%2–5 (servetin). [7] Havranek, T. (2015), "Measuring Intertemporal Substitution", *JEEA* 13(6): yayın yanlılığı düzeltilmiş esneklik ~0,3–0,4. [8] Carroll, C. (1997), "Buffer-Stock Saving and the Life Cycle/Permanent Income Hypothesis", *QJE* 112(1). [9] Havranek, T., Rusnak, M., Sokolova, A. (2017), "Habit Formation in Consumption: A Meta-Analysis", *EER* 95: makro verilerde ~0,6. [10] OECD Affordable Housing Database, HC1.2 (kira yükü). [11] Jordà, Ò. ve diğ. (2019), "The Rate of Return on Everything", *QJE* 134(3): konut kira getirisi uzun dönem yılda %4–7. [12] Molloy, R., Smith, C., Wozniak, A. (2011), "Internal Migration in the United States", *JEP* 25(3). [13] OECD Entrepreneurship at a Glance (işletme doğuş oranları). [14] Cooper, A., Woo, C., Dunkelberg, W. (1988), "Entrepreneurs' Perceived Chances for Success", *Journal of Business Venturing* 3(2). [15] Nakamura, E., Steinsson, J. (2008), "Five Facts about Prices", *QJE* 123(4). [16] US BLS Business Employment Dynamics, "Survival of private sector establishments by opening year" (ilk yıl ~%80). [17] Card, D., Chetty, R., Weber, A. (2007), "Cash-on-Hand and Competing Models of Intertemporal Behavior", *QJE* 122(4); Schmieder, J., von Wachter, T. (2016), *Annual Review of Economics* 8. [18] Dimson, E., Marsh, P., Staunton, M., *Global Investment Returns Yearbook* (hisse risk primi). [19] Case, K., Shiller, R., Thompson, A. (2012), "What Have They Been Thinking?", *Brookings Papers* 2012(2).

Kaynaklardaki sayılar bilinen yayınların özetidir; kalibrasyon turunda her biri tek tek doğrulanmalı.
