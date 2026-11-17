"""simkit.params: sabitler, statik tablolar ve içe aktarma anı kurulumu (plan v2 adım 2).

AMAÇ: model.py'nin 22-771. satırları arasındaki modül düzeyi içerik (parametreler, MODEL_PARAMS geçersiz kılma, RECIPES/TOPO/STAGES,
türetilmiş bayraklar, derive_prices) AYNI SIRAYLA burada, metin olarak taşındı. MODEL_PARAMS ortam değişkeni içe aktarma anında okunur (tuple/dict değerleri
ast.literal_eval ile); aynı süreçte çok konfigürasyon için `simbuild.build(Params(...))` her konfigürasyona AYRI bir paket kopyası kurar.
ARAYÜZ: tüm public adlar (`from simkit.params import *`); alt çizgili `_depth` açıkça içe aktarılır.
KATMAN: en alt (kimseyi içe aktarmaz). SALT-OKUNUR: yalnız sabitler ve şablonlar (REF_BASE, MM_BASE0, RECIPES0, TOPO0) burada durur;
çalışma zamanı durumu (REF, PRICE, PM, LAND, WI, NOW, RECIPES, TOPO ...) her koşuda simkit.world_init.new_world tarafından World'e kurulur.
"""
# ------------------------------------------------------------------ parametreler
VERSION = "v13.3"
CYCLES_PER_WEEK = 7                       # 02 Zaman; K-64
CITIES = 5
PLAYERS_PER_CITY = 300                    # 04
NPC_X, NPC_Y = 600, 3                     # K-77/K-87: tek havuz = x + y·N
TIER_WAGE = (10, 15, 20)                  # K-47, K-73
SPEND_SHARE = 0.9                         # K-97
LUXURY_SHARE_TIER2 = 0.5                  # K-78 (lüks zincir dışı; harcanmaz)
START_AKCE = 100                          # K-17 güncel
CITY_START_CASH = 0                       # D4 (sahip onaylı): şehir başına kuruluş kasası (Akçe); kuruluşta basım olarak yazılır (kind "baslangic_kasasi"); 0 = kapalı (çıktı v13.0 ile aynı)
RENT = 2                                  # K-47
LONCA_FEE = 0.05                          # K-73
NAVLUN = 0.2                              # K-52: referans × NAVLUN × mesafe; K-119: satıcı şehrin lojistik firmalarına
SERMAYE_CAP = 6000                        # K-120: lonca sermaye havuzu tavanı
LOG_BUFFER = 1.4                          # K-119: kapasite talebin %40 üstünde (sevkiyat dalgası tamponu)
LOG_INIT_WORKERS, CAP_LOG = 30, 80        # K-119: 1. hafta şehir başına lojistik kadrosu (tahmin); firma başına en çok çalışan
STORE_UNITS_PER_WORKER = 100              # mağaza: birim / çalışan-döngü (model varsayımı)
CAP_AHIR, CAP_OTHER = 50, 25              # K-74
STAFF_BUFFER = 1.1                        # K-88; K-96: tampon marjdan küçük
WORKING_CAPITAL_CYCLES = 2                # K-88
MEDYA_STAFF = 3
BENEFIT_WEEKS, BENEFIT_LONG = 26, 0.4      # K-157: tam ödenek süresi (hafta; 9999 = süresiz) ve sonrası ödenek çarpanı (uzun süreli işsizlik yardımı)
UNEMPLOY_BENEFIT = 0.5                    # K-109: iş arayan oyuncuya ücretin %50'si, şehir kasasından (otomatik dengeleyici)
WAGE_MIN, WAGE_MAX = 0.8, 2.0
WAGE_PASS = 0.5                           # K-116: ücret, geçim endeksindeki artışın yarısını yansıtır
WAGE_CATCHUP = 0.15                       # K-116: ücret endeksinin haftalık geçim endeksine yakınsama hızı
WEALTH_PROP, WEALTH_BUFFER = 0.01, 20      # K-115: tamponu aşan birikimin döngü başına %1'i dayanıklı/lüks harcamaya gider
PRICE_MARGIN, PRICE_WAGE = 0.5, 12.5
LOG_CAP = PRICE_WAGE * (1 + PRICE_MARGIN) / (1 - LONCA_FEE)   # K-119: bir lojistik çalışanın döngü başına taşıyabildiği navlun değeri      # K-93; K-96
AHIR_SPLIT = {"sut": 8, "deri": 4, "et": 9}
AHIR_KAMU, AHIR_HERD_WORKERS = True, 10   # K-95
FOUND_WEEK, FOUND_HARC, FOUND_WORKED = 2, 200, CYCLES_PER_WEEK   # K-98, K-33
GROW_FACTOR = 1.5
FOUND_PER_LONCA = 99                      # inceleme önerisi: 2 denendi, yazılım açılışı çevresinde krize yol açtı (kaotik); kapalı (99)
MIGRATION_SHARE = 0.05                    # K-87
NPC_RESERVE = 60                          # K-111: şehirde ahır sürü bakımı için bırakılan en az NPC (6 ahır × 10)
MUNI_SPEND = 0.10                         # K-112: şehir kasasının haftalık en çok %10'u belediye ücretlerine
PLAYER_MIGRATE_AFTER = 2                  # K-113: iş arayan oyuncu 2 hafta sonra iş olan şehre göçer
PLAYER_MIGRATE_SHARE = 0.5                # K-113: uygun göçmenlerin haftalık payı
ENTRY_PM = 0.9                            # K-117: arz fazlasında (fiyat çarpanı < 0,9) girişimci firma kurmaz
DERIVED_BUFFER = 1.0                      # K-124: türetilmiş girdi talebi tamponu (üst aşama kadrosu zaten ×1,1)
DIV_KEEP = 1.0                            # K-162: temettü eşiği çarpanı: firma kasasında en az bu kat (1,5 × işletme sermayesi) tutulur; şok tamponu (gerçekte firmalar 1–3 aylık nakit tutar)
DIVIDEND_SHARE = 0.5                      # K-126: oyuncu firmasının işletme sermayesi üstü fazlasının haftalık payı sahibine gider (temettü)
ENERGY_PER_WORKER = 3.0                   # K-130: üretim işyeri çalışan başına döngüde elektrik (birim); kapalıysa 0
ENERGY_ON = True
SOFT_ON = True                            # K-136: yazılım sektörü (teknoloji ağacı: malzeme + enerji → bilişim)
SW_UNLOCK = 15000.0                       # K-136: malzeme VE enerji dalında birikmiş Ar-Ge bu değere varınca yazılım açılır (donanım + elektrik altyapısı)
SW_PRICE = 0.5                            # K-136: koltuk-döngü başına abonelik fiyatı (değer bazlı, maliyet-artı değil: marjinal maliyet ~0)
SW_SEATS = 400                            # K-136: bir geliştirici döngüde bu kadar koltuğa hizmet eder (bir kez yazılır, sınırsız kopyalanır)
SW_GAIN = 0.07                            # K-136: yazılım kullanan firmada çalışan başına çıktı artışı (%5–10 bandı)
TRANS_ON = True                           # K-140: ulaşım (zorunlu haftalık yol kalemi) ve güvenlik (stok firesi, itibar)
SEC_LOSS = 0.025                          # K-140: güvenliksiz işyerinde çıktı/mal firesi (%2,5)
SEC_REP = 5.0                             # K-140: şehir güvenlik düzeyi itibara en çok bu kadar ekler (öneri)
TOUR_ON = True                            # K-138: turizm (tekstil → moda → marka/turizm) ve medya (şehir tanıtımı)
TOUR_UNLOCK = 20000.0                     # K-138: tekstil dalında birikmiş Ar-Ge bu değere varınca otel ve yeme-içme açılır (moda → marka → turizm)
TOUR_SHARE = 0.30                         # K-138: orta ve yüksek katmanın sepet dışı harcamasının turizme (konaklama, yeme-içme) giden payı
TOUR_PREF = 8.0                           # K-138: turist, itibarı yüksek şehri tercih eder (itibar farkı 10 puan = %80 × 0,1 fiyat farkı eşdeğeri)
PROMO_REP = 8.0                           # K-138: şehir tanıtımı (reklam gelirinin nüfusa oranı) itibara en çok bu kadar ekler
MEDIA_SAT = 6.0                           # K-138: kişi başına haftalık reklam geliri bu değere varınca tanıtım doygunluğa erişir
SKILL_ON = True                           # K-148: oyuncu çırak → kalfa → usta (01-roller, K-05, A-03): tecrübe ücreti ve verimi artırır
KALFA_WEEKS, USTA_WEEKS = 40, 150         # K-148: ödenen çalışma haftası eşikleri (öneri; 100 hafta ≈ 1 gerçek ay: kalfa ≈ 6 gün, usta ≈ 18 gün)
ULC_BASE = 1.087                          # K-150 (inceleme): PRICE_WAGE 60/30/10 karışımının ortalamasıdır: karışımın birim emek maliyeti (ücret 1,25 / verim 1,15); ulc buna normalize edilir
USTA_SHARE, KALFA_SHARE = 0.10, 0.30      # K-150: kontenjan: oyuncuların en çok %10'u usta, %30'u kalfa (NPC dağılımı 60/30/10; ustalık kadrosu sınırlıdır)
PROMO_FREE = 1                            # DAO oyunu M2.2 (sahip kararı): 1 = terfi kontenjansız ve sıralamasız; eşikleri (KALFA_WEEKS/USTA_WEEKS ödenen tecrübe haftası, REP_KALFA/REP_USTA itibar) geçen herkes (bot ve insan) terfi eder; USTA_SHARE/KALFA_SHARE yok sayılır; 0 = K-150 kontenjanlı terfi
FOUND_WC_REAL = 0                          # DAO oyunu M2.1: 1 = eski lonca yolu ve eo_found kuruluş sermayesi kurucunun GERÇEK döngü ücretini (önceki işinin ücreti, WI ve tür çarpanlarıyla) karşılar; 0 = kurucu TIER_WAGE[0] (ölçeksiz) sayılır, WI büyüdükçe ilk haftanın ücreti karşılanmaz ve kurucu kendini işten çıkarıp firmayı batırır (FOUNDER_DEFER > 0 ise gereksiz, uygulanmaz)
FOUNDER_DEFER = 4                          # DAO oyunu M2.1; v13.3 (M8) varsayılanı 4: kurucu kuruluş haftası dahil ilk N hafta kendine ücret ödemez (ücreti 0; gerçekte kurucu ilk haftalarda maaş almaz); 0 = kapalı (v13.2)
PROD_TIER = (1.0, 1.5, 2.0)               # K-148: tecrübeli çalışan verimi. v13.2 (M6): verim primi = ücret primi (10/15/20); v13.1 değeri (1.0, 1.3, 1.6): verim kısmen ücreti izlerdi
ULC_BASE_AUTO = 1                         # DAO oyunu M3.2: 1 = ULC_BASE, PROD_TIER ve TIER_WAGE'den NPC kademe karışımı (60/30/10, econ_core.tier_of) için yeniden hesaplanır (ücret/verim oranı): PROD_TIER=(1, 1.5, 2.0) (verim = ücret primi) ile 1,0; fiyat çıpası ve enflasyon ayıklaması kaymaz. 0 = sabit ULC_BASE (v13.1)
HIRE_TIER = ()                            # DAO oyunu M4 ayrıştırma: işe alım/çıkarma sıralamasında kademe verimi (labor.py _score/NLAB/FIRE_ORDER); () = PROD_TIER (v13.2: (1,1.5,2)). PROD_TIER=(1,1.5,2) paketinde işe alım davranışını üretimden ayırmak için (1.0,1.3,1.6) verilir
QUAL_TIER_TOP = 0.0                       # DAO oyunu M4 ayrıştırma: kalite ölçeğinde en üst kademe verimi (quality.py: (skill-1)/(top-1)); 0 = PROD_TIER[2] (v13.2: 2.0)
RUN_SEED = 0                              # DAO oyunu M3 ölçüm: bağımsız BAŞLANGIÇ tohumu. > 0 = NPC kademe karışımı (60/30/10) şehirlere rastgele dağıtılır (world_build; ölçülen dünyalarda ENTRY_OPEN=0 ve ENTRY_EXP=0 olduğundan girişim dizgeleri ölü yoldur, etkisi YALNIZ başlangıç dağılımıdır; sonrası belirlenimci); PM_ADJ varyantı değil. 0 = eski dağılım (tohum 0 dengesiz: şehir0 tamamen çırak, şehir4 kalfasız; RUN_SEED >= 1 her şehri ~%60/30/10 yapar, yani 1..N tohum 0'ın çevresi değil homojen bir aile), çıktı bayt bayt aynı
SKILL_ALL_WORK = 0                        # DAO oyunu M3.1: 1 = her ücretli iş tecrübedir: ahır, belediye ve Ar-Ge'de de skillw artar (gerçekte çalışma kıdemi işyeri türüne bağlı değildir); 0 = yalnız özel işyeri
KAMU_KINDS = ("okul", "universite", "hastane")   # DAO oyunu M3.4: KAMU_AVANS=1 iken şehirden ücret desteği alan kamu hizmeti türleri (yalnız sahipsiz = NPC yönetimli; SVC_KINDS ile kesişir)
KAMU_AVANS = 0                            # DAO oyunu M3.4: 1 = kamu hizmeti kurumlarında (üniversite, okul, hastane...: SVC_KINDS) işe alınanın avansı ve ücret açığı şehirden ödenir (ahır/belediye kalıbı, sehir_destekli); 0 = yalnız belediye ve küçük sahipsiz UTILITY
MODA_ON = True                            # K-147: tekstil → moda → marka → turizm (ürün inovasyonu; marka tüketici tercihini ve şehir itibarını etkiler)
MODA_UNLOCK = 8000.0                      # K-147: tekstil dalında birikmiş Ar-Ge bu değere varınca moda (tasarım) açılır; turizm moda açıldıktan sonra açılabilir (ağaç ön koşulu)
MODA_SHARE = 0.25                         # K-147: orta ve yüksek katmanın sepet dışı harcamasının modaya (markalı giyim) giden payı (kot/sandalyeden alınır); şehrin marka düzeyiyle artar
MARKA_PRIM = 0.6                          # K-147: tam markalı şehirde modanın fiyat primi (değer bazlı fiyat: marka fiyatlama gücüdür)
MODA_PREF = 0.6                           # K-147: tüketici markalı şehrin modasını tercih eder (primi telafi eder); fiyat farkı eşdeğeri
MODA_REP = 8.0                            # K-147: moda sektörünün şehirdeki ağırlığı itibara en çok bu kadar ekler (moda şehri turist çeker)
MODA_SAT = 2.0                           # K-147: şehirde bu kadar moda çalışanı itibar etkisini doyurur
BRAND_SAT = 0.8                           # K-147: kişi başına haftalık reklam geliri (Akçe/döngü) bu değere varınca marka doygunluğa erişir (şehir tanıtımı MEDIA_SAT'tan ayrı: marka ürün bazlıdır)
BRAND_RATE = 0.1                          # K-147: marka düzeyinin hedefe yakınsama hızı (haftalık; reklam birikimi)
HW_ON = True                              # K-142: elektronik donanım (bileşen → bilgisayar/telefon); donanım en hızlı ucuzlayan dal
HW_UNLOCK = 3000.0                        # K-142: malzeme dalında birikmiş Ar-Ge bu değere varınca elektronik donanım açılır (silika, alüminyum, plastik işleme bilgisi)
HW_SW_UNLOCK = 4000.0                     # K-142, K-136: yazılımın açılması için donanım dalında en az bu kadar Ar-Ge (yazılım bilgisayara bağlı)
HW_SHARE = 0.30                           # K-142: orta ve yüksek katmanın sepet dışı harcamasının bilgisayar/telefona giden payı
PC_LIFE = 350                             # K-142: bilgisayarın ömrü (döngü); firma çalışan başına 1/PC_LIFE bilgisayar-döngü yenileme (yıpranma ve yenileme talebi)
RAMP_WEEKS = 60                           # K-143: yeni sektörün hane talebi ve firma benimsemesi bu kadar haftada tam düzeye çıkar (benimseme eğrisi; açılış krizine yapısal çözüm)
HW_CHAIN = ("ahir", "yazilim", "guvenlik", "maden_silika", "maden_aluminyum", "plastik", "petrol", "santral", "maden_komur", "elektronik", "bilgisayar")   # bilgisayar girdisi almayan türler (döngüsel bağımlılığı önler)
FREIGHT_W = {"bilesen": 0.05, "bilgisayar": 0.05, "altin": 0.3, "mucevher": 0.02}   # K-144: navlun ürünün değerine değil ağırlığına bağlıdır; elektronik hafif ve değerlidir (ucuzlasa da taşıma maliyeti aynı kalır)
HW_ELAST = 0.0                            # K-142: firmaların bilgisayar harcaması fiyat düşünce birim olarak artar (birim esnek: aynı bütçeyle daha çok bilgisayar; gerçekte yazılım, sunucu ve cihaz sayısı artar)
HW_MAXQ = 30.0                            # K-142: firma başına bilgisayar yoğunluğu en çok bu kat artar
SW_HOUSE = 0.08                           # K-136: orta ve yüksek katmanın sepet dışı harcamasının yazılıma giden payı
ENERGY_FLOOR = 0.9                        # K-130: elektriksiz işyeri kapasitenin bu payında (jeneratör, elle çalışma) üretir; zincir tamamen çökmez (sadeleştirme)
UTILITY = ("maden_komur", "santral")        # K-135: kamu hizmeti niteliğindeki altyapı türleri (küçük NPC firmanın ücret açığını şehir kapatır)
UTILITY_MAX = 3                           # K-135: destek yalnız en çok bu kadar çalışanlı NPC firmaya (bölünmezlik, tek işçilik ince talep). K-145 notu: 40 denendi (tüm santrallere destek), 500 haftada oyuncu firması çöktü (nohw koşusu bile); 3'te kalır
RESERVE = {}                              # K-130 notu: santral için yedek kadro (4 kişi) denendi, zinciri bozdu (8. haftada talep %9); kapalı
GRID_GOOD = "elektrik"
NO_FREIGHT = ("elektrik", "yazilim")      # K-130, K-136: şebeke ve dijital mal navlunsuz, lojistik kapasitesi gerekmez
DOMESTIC_EVERY = 6                        # K-133: yerli üretim tabanı programı: şehir başına her 6 haftada bir, ithalata tam bağımlı en çok ithal edilen türe NPC firma kurulur (0 kapatır)
DOMESTIC_SEED = 2                         # K-133: program firmasının en az kadrosu (talep sinyali gelene kadar)
ARGE_ON = True                            # K-134: Ar-Ge, teknoloji, telif (bekleyen iş 7, 7b, 7c)
LONCA_PROGRAM = {"sermaye": 0.4, "reklam": 0.2, "kurucu_payi": 0.2, "arge": 0.2}   # K-134: Ar-Ge payı kurucu payından ve sermayeden ayrıldı (K-34'e göre lonca fee'sinden Ar-Ge)
BRANCH = {"tarla_bugday": "tarim", "tarla_seker": "tarim", "tarla_pamuk": "tarim", "un": "gida", "firin": "gida", "sise_sut": "gida", "kola": "gida",
          "tekstil": "tekstil", "giyim": "tekstil", "kereste": "malzeme", "mobilya": "malzeme", "cam": "malzeme", "maden_silika": "malzeme",
          "maden_aluminyum": "malzeme", "maden_kimyasal": "kimya", "plastik": "kimya", "deterjan": "kimya", "petrol": "kimya",
          "maden_komur": "enerji", "santral": "enerji", "yazilim": "bilisim", "elektronik": "donanim", "bilgisayar": "donanim", "moda": "tekstil"}
BRANCHES = ["tarim", "gida", "tekstil", "malzeme", "kimya", "enerji", "donanim", "bilisim"]
ARGE_COEF = {"tarim": 0.0005, "gida": 0.0005, "tekstil": 0.0008, "malzeme": 0.0006, "kimya": 0.0008, "enerji": 0.0010, "bilisim": 0.0010, "donanim": 0.012}   # K-134: verim = 1 + k·√birikmiş Ar-Ge (azalan getiri)
DIFFUSE_LAG = 100                          # K-134, K-37: teknoloji bu kadar hafta sonra kendiliğinden yayılır (telif biter)
TELIF = 0.02                              # K-134, K-37: lisanslı firmanın satışından lonca payı
BRANCH_WEIGHT = {"enerji": 6.0, "donanim": 1.0}            # K-134: stratejik dal ağırlığı (enerji tüm zincirin girdisi; gerçekte kamu Ar-Ge teşviki) — sahip kararı
LABOR_SHARE = 0.6                         # K-134: verim artışının birim maliyete yansıyan payı (emek payı)
GREEN_K = 30000.0                         # K-134: enerji dalındaki birikmiş Ar-Ge bu değere varınca elektrik tamamen temiz (kömürsüz)
GREEN_REP = 5.0                           # K-134: temiz enerji payı itibara en çok bu kadar ekler (öneri)
CREDIT_ON = True                          # K-158: kredi ve faiz: lonca sermaye havuzu kuruluş sermayesini kredi olarak verir; mevduat sahipleri faiz alır
LOAN_RATE = 0.01                         # K-158: haftalık faiz (kalan anapara üstüne; yıllık ~%52 basit, gerçekten 7–10 kat yüksek: oyun ölçeği)
LOAN_TERM = 60                            # K-158: vade (hafta; anapara eşit taksit)
LOAN_SHARE = 1.0                          # K-158: lonca sermayesinin kredi olan payı (kalanı hibe)
DEF_MISS = 6                              # K-158: üst üste bu kadar hafta tam taksit ödenemezse temerrüt: firma batar, kalan anapara havuz kaybı
LOAN_FLOOR = 0.5                          # K-158: firma işletme sermayesinin bu payı kasada kalmadan taksit ödemez (ücret önce)
GROW_LOAN = True                          # K-158: mevcut firma kasası yetmese de lonca havuzundan büyüme kredisi alır
GROW_LOAN_MIN = 0.6                       # K-158: büyüme kredisi için firmanın kasası eşiğin en az bu payında olmalı (sağlıklı firma göstergesi)
LOAN_LEV = 1.5                            # K-158: kalan borç en çok bu kadar işletme sermayesi
HOUSE_ON = True                           # K-159: konut ve kira (K-15, K-16 güncellemesi): hane kira öder, ev sahibi kira geliri alır, kira göçü frenler
RENT_H = 0.08                             # K-159: haftalık değil döngülük kira: çırak ücretinin bu payı (× ücret endeksi × kira çarpanı); gerçekte konut harcaması gelirin %25–30'u
HOUSE_NPC_TEN = 40                         # K-159: açılışta şehir başına çalışan NPC kiracı varsayımı (stok = boşluk × (oyuncu + bu))
HOUSE_SLACK = 1.15                        # K-159: açılış konut stoku / kiracı sayısı (boşluk oranı)
HOUSE_ELAST = 1.5                         # K-159: kira çarpanı = (doluluk / normal doluluk)^HOUSE_ELAST (talep fazlası kirayı artırır)
RM_MIN, RM_MAX, RM_RATE = 0.7, 2.5, 0.1   # K-159: kira çarpanı sınırları ve haftalık yakınsama hızı
HOUSE_YIELD = 0.003                       # K-159: brüt haftalık getiri (birim fiyatı = haftalık kira / getiri)
HOUSE_MAINT = 0.1                         # K-159: kira gelirinin bakım payı (şehre gider: bakım ve vergi)
HOUSE_BUILD = 0.95                         # K-159: yeni konutun maliyeti piyasa fiyatının bu payı (inşaat işçiliği ve malzeme belediye/şehir harcamasına gider: sadeleştirme)
BUILD_RM = 1.05                           # K-159: kira çarpanı bunun üstündeyse sahipler yeni konut yapar
HOUSE_BUY_MAX = 3                         # K-159: şehirde haftalık en çok bu kadar alım/inşaat (sınırlı sermaye hareketi)
HOUSE_BRAKE = 2.0                         # K-159: göç kapasitesi (iş açığı) kira çarpanının bu kuvvetiyle bölünür (kira göçü frenler)
DEP_ON = True                             # K-158: oyuncular fazla likit parayı lonca havuzuna mevduat yatırır (sermaye sahibi geliri)
DEP_KEEP = 6                              # K-158: mevduat yatırmadan önce elde tutulan haftalık ücret sayısı
DEP_SHARE = 0.5                           # K-158: eşik üstü fazlanın haftalık yatırılan payı
DEP_RATE = 0.01                          # K-158: mevduat haftalık faiz tavanı (havuzun o hafta tahsil ettiği faizle sınırlı: havuz zarara girmez)
DEP_PAYOUT = 0.8                          # K-158: havuzun haftalık kredi faizinin mevduat sahiplerine dağıtılan en çok payı (kalanı havuzda kalır: banka kârı/karşılık)
DEP_MULT = 2.0                            # K-158: banka mevduatı kredi talebi kadar toplar: mevduat en çok bu kat kalan kredi (kredisiz mevduat atıl para olurdu)
DEP_MIN = 2000.0                          # K-158: kalan kredi az olsa da kabul edilen en az mevduat
DEP_RESERVE = 0.2                         # K-158: havuz mevduatın bu payını nakit tutar (kredi verilemez); çekimler havuz nakdiyle sınırlı
INNOV_ON = True                           # K-167: inovatör oyuncular, Ar-Ge DAO'ları, araştırmacı mesleği, lonca sahibi oyuncu, patent ve telif (üye dahil), kişi itibarı (K-11)
INNOV_MOD = 4                             # K-167: oyuncu k % 10 == INNOV_MOD inovatör (şehir başına 30 = %10)
DAO_PER_CITY = 6                          # K-167: şehir başına Ar-Ge DAO'su (kalan inovatörler araştırmacı)
DAO_TEAM = 5                              # K-167: DAO kadrosu üst sınırı (kurucu + 4 araştırmacı)
DAO_START = 6                             # K-167: ilk DAO kuruluş haftası (lonca havuzları dolsun)
DAO_COOL = 8                              # K-167: şehirde DAO batışından sonra yenisinin kurulması için bekleme (hafta)
DAO_SEED_WEEKS = 4                        # K-167: kuruluşta iki kişilik kadronun bu kadar haftalık ücreti kredi + kurucu sermayesi olarak aranır
DAO_HIRE_RUNWAY, DAO_FIRE_RUNWAY = 6.0, 2.0   # K-167: kasa / haftalık gider: işe alma ve işten çıkarma eşikleri (hafta)
DAO_SURPLUS_WEEKS, DAO_PAYOUT, DAO_FOUNDER = 12.0, 0.5, 0.6   # K-167: kasa bu kadar haftalık gideri aşınca fazlanın haftalık %50'si dağıtılır; kurucu payı %60, kalanı araştırmacılara
RES_WAGE_MULT = 2.0                       # K-167, K-78: araştırmacı ücreti = usta ücretinin 2 katı (yüksek katman)
RWI_STEP, RWI_MIN, RWI_MAX = 0.03, 0.75, 1.8   # K-167: araştırmacı talebi > arz ise ücret çarpanı artar, arz > talep ise azalır (haftalık)
RES_EFF = 2.0                             # K-167: ödenen araştırmacı ücreti başına birikmiş Ar-Ge (K)
CATCHUP = 0.5                             # K-167 (sahip ek kararı): öncünün gerisindeki DAO'nun verimi (1 + CATCHUP × açık) kat artar: geç gelen daha ucuza yetişir, ölçülü
TELIF_KEEP = 0.5                          # K-167: tekel DAO telifi verim kazancının en çok bu payını alır (firma lisansı kaçırmasın)
TELIF_X0, TELIF_XMIN = 0.10, 0.01         # K-167: dışarıya telif oranı tavanı (tekel) ve tabanı; rakip DAO varsa oran rakibin sunduğu net kazanca eşitleninceye kadar iner
TELIF_MEMBER_RATIO = 1.0 / 3.0            # K-167 (sahip): lonca üyesine telif = dışarıdakinin 1/3'ü
PATENT_TERM = 200                         # K-167 (K-108): patent süresi (hafta); sonra buluş kamu malı olur (kendiliğinden bedava yayılma kalktı)
ADOPT_LAG = 4                             # K-167: firmaların yeni patentin düzeyini görme gecikmesi (hafta)
REEVAL = 6                                # K-167: oyuncu firması lisans seçimini bu kadar haftada bir gözden geçirir (NPC her hafta)
LIC_MARGIN = 0.005                        # K-167: lisans almak için verim kazancı - telif en az bu kadar olmalı
UNDERCUT = 0.0005                         # K-167 (sahip): rakip DAO'nun sunduğuna göre telif oranı haftalık bu kadar altına iner (taban TELIF_XMIN)
GAP_DEATH = 0.02                          # K-167: batan oyuncu firmasının maliyet açığı bu orandan büyükse ölüm nedeni `teknoloji_geride`
PROG_ARGE = 0.45                          # K-167: lonca programında Ar-Ge payı (kurucu payı sabit %20; kalan sermaye ve reklam arasında yarı yarıya)
CONTRACT_CAP = 2.5                        # K-167: lonca bir DAO'nun giderinin en çok bu katını sözleşme olarak öder; artan Ar-Ge fonu havuza
RES_TAX = 0.2                             # K-167: araştırmacı ücretinden gelir vergisi (şehir kasasına; Ar-Ge payı şehirden kişilere geçince kamu gelirini korur)
OWNER_TAX = 0.3                           # K-167: lonca sahibinin kurucu payı gelirinden stopaj (şehir kasasına; kamu gelirini korur)
OWNER_WEEK, REP_OWNER = 25, 6.0           # K-167: lonca sahibi bu haftadan sonra itibar eşiğini geçen en itibarlı oyuncu olur (öncesi kurucu payı şehre: K-73)
REP_DAO = 6.0                             # K-167: yeni DAO kurucusu için itibar eşiği (ilk dalga muaf)
REP_EFFECT = True                         # K-11: itibar işe alım önceliği, terfi, kredi limiti/faizi üzerinde etkili
REP_WORK_TAU, REP_WORK_CAP = 300.0, 40.0  # K-11: çalışılan hafta w için puan = CAP × (1 - exp(-w/TAU)) (doygunluk yavaş: uzun koşuda da ayrışır)
REP_FIS_RATE, REP_FIS_CAP = 0.05, 25.0    # K-11: firma sahibi: ücreti ödenen çalışan-hafta başına (kesilen fiş) puan, tavan
REP_SOZ_RATE, REP_SOZ_CAP, REP_SOZ_CLOSE = 0.3, 15.0, 5.0   # K-11: tutulan söz: tam ödenen kredi haftası, tavan; kredi kapanışı bonusu
REP_BANKRUPT, REP_DEFAULT, REP_WF = 10.0, 20.0, 1.5   # K-11: ceza: batan firma, temerrüt, ücret ödeyememe (ayrılan çalışan başına)
REP_DECAY = 0.015                         # K-11: cezaların haftalık sönümü
REP_PROMO = 1.0                           # K-11: terfi önceliği = tecrübe × (1 + REP_PROMO × itibar/100)
REP_KALFA, REP_USTA = 4.0, 12.0           # K-11: kalfa/usta terfisi için itibar eşiği
CM_BASE, CM_REP = 0.8, 40.0               # K-11: kuruluş kredisi çarpanı = CM_BASE .. 1 (itibar CM_REP'te tam)
RM_LO, RM_HI = 0.7, 1.3                   # K-11: faiz çarpanı = 1,3 - 0,6 × itibar/100, bu sınırlarda
FEE_ON = True                             # K-170: loncalar fee'yi kendileri belirler (lonca sahibi oyuncu, deterministik tepe tırmanma); firmalar fee + telif indirimi + krediye göre lonca seçer
FEE_MIN, FEE_MAX, FEE_STEP, FEE_EVERY = 0.02, 0.12, 0.005, 8   # K-170: fee tabanı/tavanı, adım, ayarlama aralığı (hafta)
SWITCH_EVAL, SWITCH_COOL, SWITCH_GAIN = 4, 20, 0.004          # K-170: firma 4 haftada bir değerlendirir, geçişten sonra 20 hafta bekler, toplam maliyet en az %0,4 puan düşmeli
CONGEST, LOCAL_W = 0.08, 0.01             # K-170: lonca kalabalığı (üye payı × 0,04: üye başına kredi/reklam/Ar-Ge payı seyrelir) ve yerel yakınlık (lonca merkezi firmanın şehrindeyse -0,01)
CREDIT_W = 0.01                           # K-170: lonca seçiminde kredi havuzu doluluğunun ağırlığı (oran puanı)
PATH_ON = True                            # K-170: inovatör yolları: DAO kurucusu / araştırmacı / inovatör firma sahibi / uzman
PATH_CYCLE = ("dao", "firma", "firma", "uzman", "arastirmaci")   # K-170: şehirde inovatör sırasına göre yol (30 inovatör: 6 DAO adayı, 12 firma, 6 uzman, 6 araştırmacı)
INNOV_FIRM_GAIN = 0.05                    # K-170: inovatör firma sahibinin firması çalışan başına çıktı artışı (erken teknoloji erişimi) ve lisansı üye oranından alır
MGR_ON = True                             # K-170 / K-78: yönetici ve uzman (yüksek ücretli meslek katmanı)
ROLE_TAX = 0.2                            # K-170: yönetici/uzman ücretinden gelir vergisi (şehir kasasına; fee düşünce kamu geliri çöküyordu: tur 43)
MGR_PASS = 0                              # K-170: 1 = yönetici/uzman ücreti fiyat çıpasına (birim emek maliyeti) yansır, 0 = yansımaz (varsayılan: verim artışının maliyeti karşıladığı sadeleştirmesi; 1 iken oyuncu firması hayatta kalma %12 çıktı)
MGR_MIN, MGR_SPAN = 8, 8                 # K-170: çalışanı bu sayıyı aşan firma yönetici alır; her MGR_SPAN çalışana bir yönetici
SPEC_MIN, SPEC_SPAN = 4, 5               # K-170: teknoloji yoğun sektörde bu sayıyı aşan firma uzman alır; her SPEC_SPAN çalışana bir uzman
MGR_MULT, SPEC_MULT = 3.0, 1.5            # K-170: yönetici ücreti usta ücretinin 2,5 katı, uzman 1,5 katı (× ücret endeksi × arz-talep çarpanı)
MGR_GAIN, SPEC_GAIN = 0.04, 0.06          # K-170: yönetici firma geneli verim artışı, uzman dalın verimi
MGR_WEEKS, MGR_REP = 60, 8.0              # K-170: yönetici eşiği: özel işyerinde ödenen çalışma haftası, itibar
SPEC_WEEKS, SPEC_REP, SPEC_WEEKS_INNOV, SPEC_REP_INNOV = 100, 12.0, 40, 6.0   # K-170: uzman eşiği (inovatör öncelikli ve düşük eşikli)
MWI_STEP, MWI_MIN, MWI_MAX = 0.02, 1.0, 1.6   # K-170: doldurulamayan kadro varsa yönetici/uzman ücret çarpanı artar (işgücü kıtlığı)
SPEC_KINDS = ("elektronik", "bilgisayar", "yazilim", "maden_kimyasal", "plastik", "deterjan", "petrol", "maden_komur", "santral", "moda", "medya", "otel")   # K-170: karmaşık/teknoloji yoğun sektörler
WEALTH_TAX = 0.0                          # K-170 (sahip onaylamadı; varsayılan kapalı, yalnız deneme): haftalık servet vergisi oranı (WT_FLOOR üstü bakiye)
WT_FLOOR = 2000.0
RENT_TAX = 0.0                            # K-170 (kapalı): kira gelirine vergi oranı
LIFE_ON = True                            # K-172: hayat düzeyleri (gelir + servet + alışkanlık → harcama bütçesi) ve lüks tüketim kataloğu (restoran, seyahat, mücevher, büyük konut, sanat/eğlence, moda)
MPC0, MPC_SLOPE, LIFE_YREF = 0.9, 0.15, 12.0   # K-172: harcama = 0,9 × y × (y / yref)^-0,15 (zenginin harcama payı küçülür, mutlak harcaması artar); yref = 12 × ücret endeksi (döngü başına)
WSPEND, WS_BUF = 0.01, 20.0              # K-172: servetin döngü başına harcanan payı (tampon: 20 ücret üstü); ölçülü
HAB_UP, HAB_DOWN = 0.05, 0.02             # K-172: alışkanlık: bütçe hedefe döngü başına %5 (artışta) / %2 (düşüşte) yaklaşır
LIFE_D0 = 10.0                            # K-172: sepet ve kira sonrası kalan bütçenin referansı (döngü başına, × ücret endeksi)
LIFE_CATS = {"dur": (3.0, 0.6), "yazilim": (0.3, 1.0), "hw": (0.8, 1.2), "moda": (0.8, 1.6), "restoran": (1.0, 1.2), "seyahat": (0.8, 1.5),
             "eglence": (0.5, 1.3), "mucevher": (0.4, 2.2), "konut": (0.6, 2.4)}   # K-172: kalem -> (ağırlık, gelir esnekliği); esneklik büyüdükçe pay yüksek bütçede artar
LEVEL_CUTS = (550.0, 1700.0)              # K-172: aylık (28 döngü) harcama sınırları (bugünkü fiyatla; fiyat endeksiyle ölçeklenir): normal < 550 <= rahat < 1700 <= lüks
GOLD_CITIES = (1, 4)                      # K-172: değerli maden yalnız bu şehirlerde çıkar
LONCA_MIN_MEMBERS, LONCA_DEAD_WEEKS, LONCA_MIN_CASH = 1, 12, 500.0   # K-171/K-172: üye sayısı bu kadar ya da az, bu kadar hafta sürerse ve kasa/havuz azsa lonca kapanır
LONCA_REFOUND, LONCA_FOUND_CAP = 30, 3000.0   # K-171: kapanan lonca slotunu itibarlı oyuncu bu bekleme sonrası yeniden kurabilir (sermaye)
BUDGET_FIRST = True                       # K-174: bütçe bakiyeyi aşınca önce sepet ve kira, sonra dayanıklı, en son lüks (mücevher, konut, marka önce) kısılır
RESALE_ON = True                          # K-174: ikinci el piyasası ve değer kaybı (mücevher, konut iyileştirmesi); servet piyasa değeriyle
DEPR = {"mucevher": 0.0005, "insaat": 0.005}   # K-174: haftalık değer kaybı (mücevher yavaş, konut iyileştirmesi yıpranır)
SH_DISC, SH_MIN, SH_ADJ = 0.7, 0.4, 0.05      # K-174: ikinci el fiyatı = referans × bu (ilk 0,7; talep/arz ile 0,4–1,0 arası oynar)
SH_SHARE = 0.3                            # K-174: rahat/lüks düzeyin mücevher ve konut talebinin ikinci elden karşılanan en çok payı (arz yetersizse azalır)
SQUEEZE_W, SELL_RATE, RESALE_KEEP = 2.0, 0.03, 3.0   # K-174: nakit < 2 haftalık sepet+kira ise satıcı; gönüllü satış haftalık %3 (varlık > 3 aylık harcama ise)
BUYBACK = 0.5                             # K-174: kuyumcu/inşaat firması geri alım fiyatı (referansın bu payı); alınan mal ikinci el stoğu olarak yeniden satılır
MARKET_ROOM = True                        # K-174: girişimci kurmadan önce şehirdeki (yerel) ya da dünyadaki (ticarete konu) talebin mevcut + yeni firma kapasitesini aştığına bakar
ROOM_ALL = 0                              # K-174: 1 = test tüm ürünlere uygulanır (denendi: fiyat endeksi ×1,4, sepet karşılama -9 puan, kuruluş 435 → 91); 0 = yalnız küçük/seyrek lüks pazarlara
ROOM_PRODUCTS = ("mucevher", "altin", "yemek", "eglence", "insaat", "moda", "konaklama", "yazilim", "bilgisayar")   # K-174: yeni ve seyrek talepli ürünler
ROOM_MINW = 2                             # K-174: sinyal son ROOM_N haftanın en az bu kadarında görülmeli (istikrar)
ROOM_N, ROOM_K, ROOM_YOUNG = 6, 0.5, 12   # K-174: talebin son 6 haftanın alt çeyreği (istikrar); boşluk en az 1,5 çalışanlık çıktı değeri; 12 haftadan genç firma en az 2 çalışanlı sayılır
LONCA_COST = True                         # K-174: lonca sabit + üye başına haftalık işletme gideri (şehre); ödenemeyen lonca kasayı eritir ve kapanır
LC_FIXED, LC_MEMBER = 400.0, 8.0         # K-174: haftalık sabit gider ve üye başına gider (Akçe; fee geliri %2–5'te lonca başına ~2–4k/hafta)
WEALTH_REAL = True                        # K-179: servetten harcama gerçek değere iner: tampon üstü servetin yılda %4,5'i (eskiden döngü başına %1 = yılda ~%97)
WEALTH_DRAW_YEAR = 0.045                  # K-179: tampon (20 haftalık ücret) üstü servetin yıllık harcanan payı (oyun yılı = 52 hafta = 364 döngü)
DEP_VAR = True                            # K-179: mevduat tavanı (DEP_MULT) kalkar; faiz = havuzun tahsil ettiği kredi faizinin dağıtılan payı / toplam mevduat (bolluk faizi düşürür)
DEP_KEEP_NEW = 2.0                        # K-179: mevduat yatırmadan önce elde tutulan haftalık harcama sayısı (eskiden 6)
HOUSE_INV = True                          # K-179: konut yatırımı (kiraya vermek için), oyuncular arası ikinci el konut piyasası, fiyat arz-talepten, inşaat fiyat maliyeti aşınca
HOUSE_RISK_PREM = 0.0005                  # K-179: konutun net getirisi mevduat faizinin bu kadar (haftalık) üstündeyse alınır (risk primi, yılda ~%2,6)
HOUSE_EXP_N, HOUSE_EXP_DAMP = 12, 0.5     # K-179: beklenen fiyat değişimi = son ~12 haftanın sönümlü eğilimi × 0,5 (haftalık ±%0,3 ile sınırlı)
HOUSE_INV_MAX = 2                         # K-179 (sahip): kişi başına en çok bu kadar yatırım konutu (oturduğu ev hariç; fazlası zorla satılmaz, yenisi alınamaz)
HOUSE_TXN = 0.02                          # K-179: ikinci el işlem harcı (alıcıdan şehir kasasına)
HOUSE_ANCHOR = 0.05                       # K-179: ikinci el fiyatı haftada temel değere (net kira / (mevduat faizi + risk primi)) bu oranda yaklaşır
HOUSE_PRICE_ADJ = 0.05                    # K-179: ikinci el fiyatı haftada (alıcı - satıcı) / (alıcı + satıcı) × bu oranda oynar
HOUSE_BUY_CAP = 10                        # K-179: şehirde haftalık en çok alım (eskiden 3; yatırım talebi arz-talepten)
HOUSE_SELL_MARGIN = 0.0005                # K-179: konutun net getirisi mevduatın bu kadar altına düşerse sahip satar
HOUSE_SQUEEZE_W = 0.5                     # K-179: nakdi + mevduatı bu kadar haftalık harcamanın altına düşen konut sahibi (sıkışık) satar
HOUSE_BUILD_K = 0.02                       # K-179: fiyat inşaat maliyetini aşınca haftalık yeni inşaat = bu × (fiyat/maliyet - 1) × stok (+1)
HOUSE_PX_MIN, HOUSE_PX_MAX = 0.4, 4.0     # K-179: ikinci el fiyatı / birincil fiyat sınırları
DAO_EQUITY = True                         # K-180: kâr eden DAO'ya (firma ve Ar-Ge DAO'su) pay karşılığı yatırım; kâr payı paya göre; DAO batarsa pay değeri sıfır
EQ_START, EQ_MAX_EXT = 25, 0.49           # K-180: pay satışı bu haftadan sonra; dış paylar toplamı en çok %49 (sahibin kontrolü korunur)
EQ_TRANCHE, EQ_COOL, EQ_MIN_AGE = 0.10, 4, 13   # K-180: bir seferde satılan pay, iki satış arası hafta, en az firma yaşı
EQ_MIN_PROFIT = 5.0                       # K-180: pay satabilmek için sönümlü haftalık net kâr (Akçe)
EQ_RISK_ISS, EQ_DISC = 0.004, 0.3         # K-180: değerleme = kâr / (mevduat faizi + 0,004 + batma oranı); ihraç fiyatı değerlemenin %70'i
EQ_RISK_INV = 0.003                       # K-180: yatırımcı beklenen haftalık getirinin mevduat faizini en az bu kadar (itibara göre ayarlı) aşmasını ister
EQ_FRAC, EQ_MIN_TRADE, EQ_MAX_HOLD = 0.5, 20.0, 6   # K-180: yatırılabilir paranın en çok yarısı, en az işlem, kişi başına en çok pay sayısı
EQ_KEEP, EQ_CASH_WEEKS = 1.0, 4.0         # K-180: toplanan sermaye temettü yerine firmada tutulur; kasa bu kadar haftalık giderin altındaysa ya da kadro boşsa pay satar
ORG_REP = True                            # K-180: lonca, DAO ve firma itibarı (marka): reklam birikimi, ödenen ücret ve söz, yaş, kurucunun kişi itibarı, başarı; müşteri/üye/DAO/yatırımcı çekimi
ORG_AD_DECAY, ORG_AD_SAT = 0.97, 200.0   # K-180: reklam birikimi haftada %3 aşınır; üye başına birikim bu değerde itibar terimi %63
ORG_LONCA_W, ORG_DAO_W = 0.01, 0.3       # K-180: lonca skoruna itibar terimi (fee puanı eşdeğeri, itibar 100'de 1 puan); DAO lonca seçiminde değer çarpanı
ORG_CONTRACT_K, ORG_SHARE_K = 0.5, 0.5   # K-180: DAO sözleşme ağırlığı = 1 + K × itibar/100; perakende müşteri payı ağırlığı
ORG_TEL_REF = 20.0                        # K-180: DAO başarı terimi: haftalık ortalama telif geliri bu değerde tam
MEDIA_OWN = True                          # K-180: lonca ve DAO medya firması satın alabilir; sahibi kendi reklamını indirimli yapar, medyanın kârı sahibine akar (şehir kasasına değil)
MEDIA_OWN_DISC = 0.5                      # K-180: sahibin kendi medyasına ödediği reklam bedeli = liste fiyatının bu kadar altı (itibar birikimi tam sayılır)
MEDIA_PE, MEDIA_PRICE_MIN = 80.0, 1500.0  # K-180: medya fiyatı = sönümlü haftalık kâr × 80 (en az 1.500 Akçe), şehir kasasına ödenir
CX_MEDIA_TERM = 156                       # K-181: medya kredisi vadesi (hafta)
MEDIA_HORIZON, MEDIA_SAVE = 260, 0.5      # K-180: alım için beklenen kazanç (kâr + reklam tasarrufu) × 260 hafta ≥ fiyat; lonca kasasının haftalık %50'sini ayırır
MEDIA_MAX_PER_OWNER = 2                   # K-180: lonca başına en çok medya sayısı (DAO başına 1)
MEDIA_AD_CREDIT = 0.5                     # K-180: medya sahibi firma/DAO kendi medyasının haftalık kârının bu katı kadar reklam birikimi kazanır
CREDIT_X = True                           # K-181: kredi genişlemesi: faiz = mevduat faizi + risk marjı (itibarla), kazanca bağlı büyüme kredisi, kapasite ve Ar-Ge yatırım kredisi, medya kredisi, konut kredisi (ipotek ve haciz)
CX_MARGIN, CX_RATE_MIN, CX_REPRICE = 0.003, 0.002, 4   # K-181: haftalık faiz = mevduat faizi (12 hf. sönümlü) + 0,003 (× itibar çarpanı), en az 0,002, en çok eski sabit oran (0,01); 4 haftada bir yeniden fiyatlanır
CX_GROW_K, CX_INV_K = 30.0, 40.0          # K-181: toplam borç tavanı = k × sönümlü haftalık net kâr (büyüme kredisi 30, yatırım kredisi 40 haftalık kâr)
CX_MIN_PROFIT, CX_MIN_AGE, CX_MIN_OREP = 5.0, 26, 30.0   # K-181: yatırım kredisi için kâr geçmişi (haftalık), yaş (hafta), kurum itibarı
CX_CAP_STEP, CX_CAP_WEEKS, CX_CAP_MAX = 2, 26.0, 3.0     # K-181: kapasite artışı +2 çalışan; maliyet = çalışan başına 26 haftalık ücret; tavan 3 × başlangıç kapasitesi
CX_MEDIA_LTV = 0.7                        # K-181: medya satın alımında kredi payı (fiyatın en çok %70'i); itibar ve kazanç şartı
CX_LTV, CX_MORT_TERM, CX_MORT_MARGIN, CX_DSR, CX_MORT_DEF = 0.5, 260, 0.002, 0.35, 6   # K-181: ipotek: fiyatın en çok %50'si, vade 260 hafta, faiz = mevduat + 0,002, taksit gelirin en çok %35'i, 6 hafta ödenmezse haciz
INNOV_LONCA = True                        # K-176: başarılı inovatörler yeni (girişimci) lonca kurabilir; 6 başlangıç lonca "yerleşik"
NEW_SLOTS = 0                             # K-178: önceden ayrılmış slot yok; girişimci lonca sınırsız, her kuruluşta yeni kimlik (lonca6, lonca7 ...), kapanan kimlik yeniden kullanılmaz
INNOV_LONCA_CAP = 3000.0                  # K-176: kurucunun lonca havuzuna koyduğu kuruluş sermayesi (ve en az likit bakiye)
REP_LFOUND, SUCC_TEL = 8.0, 150.0         # K-176: kurucu itibar eşiği; DAO kurucusu için DAO'nun toplam telif geliri eşiği (başarı)
FIRM_OWNER_MIN_WEEKS, FIRM_OWNER_MIN_WORKERS = 20, 4   # K-176: inovatör firma sahibi başarı eşiği (firma yaşı, çalışan)
FOUND_MARGIN, NEW_UNDERCUT, FOUNDER_BAN = 300.0, 0.15, 100   # K-176: beklenen kazanç farkı eşiği (Akçe/hafta); yeni lonca fee'si yerleşik ortalamasının %15 altı; batan loncanın kurucusu 100 hafta yeniden kurmaz
LC_SCALE_N, LC_SCALE_MIN = 30.0, 0.3      # K-176: küçük loncanın sabit gideri üyesine göre ölçeklenir ((üye/30)^0,5, en az %30): küçük ofis
DAO_RELOC_EVERY, DAO_RELOC_GAIN = 26, 1.3 # K-176: DAO lonca seçimini bu kadar haftada bir gözden geçirir; sözleşme geliri en az %30 fazlaysa geçer
ARGE_BOOST, ARGE_BOOST_MAX, ARGE_DECAY = 0.05, 0.15, 0.98   # K-176: yerleşik lonca DAO kaybedince Ar-Ge payını artırır (sermaye payından)
MIN_STAFF = 0.05                          # K-154: kadro açma eşiği (işçi cinsinden; 0 = kapalı)
PM_BOOST_MAX, PM_BOOST_FROM = 2.0, 1.5        # K-153: kıtlık fiyat sinyaliyle kadro/üretim hedefi çarpanı üst sınırı (1 = kapalı) ve eşik
WORTH_SHORT = 0.1                        # K-162: girdi eksiği bu orandan büyükse girişimci kurmaz (0,25 = eski kural)
ENTRY_YOUNG = 0                           # K-162: yeni oyuncu firması bu kadar hafta 'genç' sayılır (0 = kapalı)
ENTRY_ABSORB = 1.0                        # K-162: genç her firma sinyalin bu kat eşiğini önceden karşılar
FOUND_BUF = 3.0                           # K-164: açılış nakit tamponu çarpanı (kuruluşta işletme sermayesi × bu): ilk haftaların girdisi/ücreti peşin karşılanır
FEAS = 2.0                                # K-164: kuruluş öncesi fizibilite: işçi başına birim marj (satış - güncel yerinde teslim girdi) ücret + kiranın en az bu katı olmalı (0 = kapalı)
SELL_CYC = 0                              # K-164: 1 = döngü bazlı (denendi, haftalık kadar iyi değil), 0 = haftalık satış
PM_DOWN_OWN = 0.0                         # K-164: oyuncu firmalarının satılamayan üretimi (kendi payı kadar) fiyatı ek olarak aşağı çeker (satamayan girişimci indirim yapar)
PM_DOWN = 1.0                             # K-164: alıcısız kalan üretimin fiyatı aşağı çekme hızı çarpanı (satıcı fiyat indirir; gerçekte firma satamadığı malda hızla indirim yapar)
CONTRACT_N = 0                            # K-166: tedarik sözleşmesi: yeni oyuncu firması ilk N hafta girdisini en ucuz teslimli şehirden sabit fiyatla ve öncelikle alır (0 = kapalı)
CONTRACT_PX = 1.0                         # sözleşme fiyatı = imza anındaki satıcı fiyatı × bu (1,0 = piyasa)
ARB = 0.0                                 # K-166: arbitraj sınırı: yerel fiyat komşunun teslim fiyatının (fiyat+navlun) bu katını aşamaz (0 = kapalı; tek fiyat yasası)
ARB_FLOOR = 0.9                           # arbitraj sınırı en çok maliyet çıpasının bu katına iner (zarar satışa zorlamaz)
SELL_THRU = 1                             # K-164: oyuncu firması üretimini geçen haftanın satışına bağlar (1 = açık): satılmayan çıktı girdiyi boşa harcar, gerçek firma talebi görmeden kapasiteye üretmez
SELL_GROW = 1.25                          # K-164: haftalık en çok bu kat büyür (satış × bu)
SELL_FLOOR = 0.25                         # K-164: ölçek alt sınırı (talep dönerse toparlanabilsin)
SELL_START = 0.5                          # K-164: ilk haftanın ölçeği (kademeli rampa: pazar bilinmiyor)
ENTRY_COOLDOWN = 0                        # K-153: aynı şehirde aynı ürüne girişimci girişi arasında en az bu kadar hafta (ince sektörlerde kobweb: herkes aynı anda girer, arz aşar, batar)
SALES_TAX = 0.03                          # K-152: tüketici alımlarından şehir kasasına satış vergisi (KDV): kamu gelirinin etkinlikle birlikte değişen kalemi; basımı azaltır
DIV_TAX = 0.3                            # K-127: temettü stopajı (şehir kasasına): basım yerine vergiyle finansman
CORP_TAX = 0.2                           # K-188 (sahip kararı 2026-10-28): kurumlar vergisi oranı; firma/DAO dağıtılabilir kârından (kâr dağıtımından önce, simkit/fiscal.py) şehir kasasına; zararda/fazla yoksa vergi yok. 0 = kapalı (çıktı v12.3 ile birebir)
EQUALIZE = 0.25                          # K-128: haftalık, ortalamanın üstündeki şehir kasası fazlasının bu payı, ortalamanın altındaki şehirlere (kasa dengeleme)
OK_FLOOR = 0.3                            # K-125: girdisi gelmeyen NPC firma kadrosunu en çok bu orana indirir (en az 1 kişi kalır)
PM_TOL = 0.09                             # K-131: planlı yedek kapasite (kadro tamponu ×1,1) kadar alıcısız üretim fiyatı düşürmez (kalıcı deflasyon yanlılığını giderir)
# ---- K-183 (sahip kararı 2026-10-27): inovasyon belirleyici; firma fiyatı, geçici inovasyon rantı, kalite, doğrudan reklam, medya loncaları
FIRM_PRICE = True                         # K-183.1: her satıcı kendi fiyatını belirler (şehir referans fiyatı × firma çarpanı); alıcılar satıcıyı fiyat + kalite + itibar skoruyla seçer (orantılı pay)
FP_STEP_UP, FP_STEP_DN, FP_DN_K, FP_TOL = 0.03, 0.04, 0.5, 0.05   # K-183.1: haftalık en çok artış / azalış; azalış hızı = k × (alıcısız pay - tol)
FP_MIN, FP_MAX, FP_FLOOR, FP_POS = 0.6, 1.8, 0.85, 0.10           # K-183.1: çarpan sınırları; birim maliyetin bu payının altına indirim yapılmaz; rakiplere göre konumlanma hızı
FP_PASS = 0.5                             # K-183.1: maliyet avantajının alıcıya geçen payı (düşük maliyetli firma rakip ortalamasının bu kadar altında konumlanır: pay kazanır, kalanı rant)
FP_RIVAL_CAP = 1.6                       # K-183.1: stok bitince artış yalnız rakiplerin ağırlıklı ortalamasının bu katına kadar
SEG_W = {0: (9.0, 1.0, 0.3), 1: (6.0, 3.0, 0.8), 2: (3.5, 6.0, 1.5)}   # K-183.1 (K-78): hane katmanı -> (fiyat, kalite, itibar) ağırlıkları: normal fiyat ağır, rahat dengeli, lüks kalite+itibar ağır
FIRM_W = (9.0, 1.5, 0.5)                  # K-183.1: firma alıcı: girdi fiyatı ağır, girdi kalitesi ve satıcı itibarı ikinci
FP_PRUNE = 0.002                          # K-183.1: bir alıcı grubunun talebinde payı bunun altındaki satıcılar budanır (hız)
INNOV_RENT = True                         # K-183.2: piyasa fiyatı öncünün maliyetine hemen inmez; rakiplerin (kadro ağırlıklı) ortalama maliyetini izler, haftalık en çok RENT_FALL düşer
RENT_FALL = 0.015                         # K-183.2: çıpa fiyatının haftalık en çok düşüş oranı (rant: mucit rakipler yetişene, lisans yayılana, patent bitene kadar normal üstü kâr eder)
V2_SNAP_WEEKS = (8, 40, 100)
# ---- K-187 (sahip kararı 2026-10-27): PRICE_V2 firma kendi tam maliyetine marj koyarak fiyat belirler (gider defteri), normalizasyon yok
PRICE_V2 = True                           # K-187: her firma fiyatını kendi gider defterinden (firmanın gerçekte ödediği her gider) hesaplanan tam birim maliyet × (1+marj) ile belirler; piyasa tepkisi marjı ayarlar; şehir fiyatı firma fiyatlarının üretim ağırlıklı ortalamasıdır (PM gösterge)
DBG_CREDIT = ()
DBG_EVERY = 0
DBG_FIRMS = ''
TAX_RULE = False                          # K-187.6: satış vergisi (KDV) oranı bütçe dengesini izler: şehirlerin sönümlü birincil açığı (tahvil ihracı hariç gider - gelir) / sönümlü tüketim kadar haftalık TAX_GAIN ile artar, fazlada taban orana döner; [SALES_TAX, TAX_MAX]
TAX_MAX, TAX_GAIN, TAX_EMA = 0.25, 0.15, 0.2
PV2_ACCT = False                          # K-187: yalnız hesap (gider defteri ve sektör tablosu), fiyatı değiştirmez (karşılaştırma için)
PV2_M0 = 0.10                             # K-187: normal hedef marj (tam birim maliyet üstü)
PV2_EMA = 0.12                            # K-187: haftalık gider ve üretim üstel ortalaması (~8 hafta)
PV2_SLOW = 0.025                          # K-187: makine/bina (yatırım) giderinin sönümü (~40 hafta; amortisman gibi)
PV2_WARM = 6                              # K-187: geçmiş yokken standart tarife maliyeti; bu kadar hafta içinde defter maliyetine geçilir
PV2_VC_SHARE = 0.85                       # K-187: standart tarifede değişken maliyetin tam maliyete oranı (geçmiş yokken)
PV2_VC_MARGIN = 0.02                      # K-187: kısa vadede fiyat değişken maliyetin bu kadar üstünün altına inmez
PV2_CR = 0.30                             # K-187: talep kısıtı yokken fiyatın maliyet+marj hedefine haftalık yakınsama hızı (yukarı)
PV2_REV = 0.04                            # K-187: kıtlık yokken hedefin PV2_EXTRA üstündeki aşırı marjın haftalık aşınma hızı (rekabet rantı eritir)
PV2_EXTRA = 0.15
PV2_MM_RATE = 0.20                        # K-187: perakende marjı ve navlun denetleyicisi hızı (gider/gelir oranına)
PV2_MM_M = 0.04                           # K-187: perakende ve lojistik hedef marjı
PV2_STEP_UP = 0.20                        # K-187: haftalık en çok fiyat artışı (maliyet yansıması dahil)
PV2_UC_CAP = 2.5                          # K-187: defter birim maliyeti standart tarife çıpasının bu katını aşamaz (üretim ~0'a inince birim maliyetin patlamasını önler)
PV2_LOG_MAX, PV2_MM_MAX, PV2_MM_MIN = 1.6, 1.5, 0.7   # K-187: navlun çarpanı ve perakende marj çarpanı sınırları (düzenlenmiş hizmet: tavan; kalan açığı kamu hizmet sözleşmesi karşılar)
PV2_REG = ("lojistik", "santral", "maden_komur", "guvenlik", "ulasim")   # K-187: gerçekte düzenlenen zorunlu altyapı türleri (fiyat = tam maliyet tarifesi; yapısal açık: kamu hizmet sözleşmesi)
PUBSVC = True                             # K-187.3: kamu_hizmet_sozlesmesi: düzenlenen altyapıda fiyat düzeltmesinden sonra kalan yapısal açığı şehir KENDİ gelirinden (basımsız) şeffaf bir hizmet bedeliyle öder; özelleştirilince de sürer
PUBSVC_SHARE, PUBSVC_TARIFF_M = 1.0, 0.0  # K-187.3: açığın karşılanan payı; düzenlenmiş tarifede marj (tam maliyet üstü)
PV2_EXCL = ("market", "medya", "belediye", "lojistik", "arge", "ahir", "yazilim")     # K-187: firma fiyatı bu türlerde ayrı (perakende/navlun denetleyicisi, kamu, değer bazlı)
NONCOST_KINDS = frozenset(("npc_kar", "temettu", "temettu_vergisi", "kurumlar_vergisi", "kar_payi_dagitimi", "ozellestirme_kar_payi", "kurucu_payi", "kurucu_sermayesi", "kredi_geri", "kredi_tasfiye",
                           "tasfiye_satisi", "tasfiye_ucret", "tasfiye_kurucu", "tasfiye_pay_sahibi", "tasfiye_lonca", "batan_firma_kasasi", "batan_dao_kasasi", "dao_payi", "dao_pay_satisi",
                           "ozellestirme_bedeli", "kurulus_harci", "sermaye_fazlasi", "sermaye_havuzu", "sigorta_sermayesi", "sigorta_kar_payi", "sigorta_tasfiye", "mevduat", "mevduat_tasima", "mevduat_tasfiye", "lonca_devir",
                           "gelir_vergisi", "servet_vergisi", "ikinci_el_geri_alim", "ikinci_el_satis", "npc_havuz_vergisi", "lonca_tasfiye", "lonca_tasfiye_ic", "yenileme_fonu", "kredi_verilen", "kurulus_fonu_geri_odeme", "kurulus_fonu_tasfiye", "kurulus_fonu_fonlama", "ortak_payi"))   # K-187: gider defterine yazılmayan (sermaye/dağıtım/devir) kalemler; geri kalan her ödeme gider sayılır (yeni gider kendiliğinden yansır)
PV2_VAR_KINDS = ("ucret", "yonetici_ucreti", "uzman_ucreti", "satis_yerli", "satis_sehirlerarasi", "navlun", "lonca_fee", "telif_dis", "telif_uye", "satis_vergisi", "arastirmaci_ucreti")   # K-187: değişken maliyet kalemleri (üretimle değişen); kira, faiz, amortisman, depo, sigorta sabit sayılır
DIRECT_AD = True                         # K-183.5: DAO ve firmalar medyadan doğrudan reklam satın alır (medya sahibi olmadan); reklam kurum itibarını büyütür
MEDIA_LONCA = True                        # K-183.6: medya DAO'ları, sınırsız medya loncası, medya inovasyonu (kanallar)
QUALITY = True                            # K-183.3: ürün kalitesi (0-1): girdi kalitesi, çalışan tecrübesi, ürün Ar-Ge'si; strateji (ucuz / orta / pahalı); itibara yansır
MEDIA_COEF, MEDIA_BW = 0.001, 8.0          # K-183.6: medya dalı: verim katsayısı ve stratejik ağırlık (DAO dal seçiminde; reklam pazarı küçük olduğundan ağırlıkla desteklenir)
MEDIA_CH_K = (0.0, 12000.0, 35000.0, 60000.0)   # K-183.6: medya dalındaki Ar-Ge düzeyi eşikleri: gazete -> radyo -> televizyon -> internet (internet yazılım ve donanım altyapısını ister)
MEDIA_REACH = (1.0, 2.5, 6.0, 15.0)       # K-183.6: kanal erişim çarpanı (Akçe başına etkili reklam; her kanal kişi başı reklam maliyetini düşürür)
MEDIA_GAMMA = 2.0                         # K-183.6: reklamveren medya seçiminde etkili erişimin kuvveti (eski kanal küçülür)
MEDIA_ENTRY_K, MEDIA_COOL, MEDIA_START = 1.5, 6, 20
MEDIA_LF_MARGIN, MEDIA_LF_AGE, MEDIA_LF_SUCC, MEDIA_LF_CAP = -1000.0, 26, 0.3, 250.0   # K-183.6: medya loncası kurucusu (medya firması sahibi ya da medya DAO'su): beklenen kazanç eşiği normalin bu katı, firma yaşı, DAO telif başarı eşiği normalin bu katı   # K-183.6: yeni medya DAO'su kurmak için firma başına beklenen reklam geliri en az bu kat gider; şehirde kuruluşlar arası bekleme; ilk kuruluş haftası
QB, QWI, QWX, QWR, QRATE = 0.15, 0.35, 0.20, 0.40, 0.10   # K-183.3: kalite hedefi = QB + QWI·girdi kalitesi + QWX·tecrübe + QWR·ürün Ar-Ge'si + strateji kayması; haftalık yakınsama hızı
QK_SCALE = 80000.0                        # K-183.3: ürün Ar-Ge düzeyi L için kalite katkısı = 1 - exp(-L / QK_SCALE)
QG_RATE = (1.10, 1.0, 0.88)               # K-183.4: strateji (0 ucuz, 1 orta, 2 pahalı): işçi başına çıktı (ucuz = özensiz ve hızlı; pahalı = özenli ve yavaş)
QG_SHIFT = (-0.12, 0.0, 0.12)             # K-183.4: stratejinin kalite hedefine kayması
FIRM_WG = {0: (9.0, 0.3, 0.3), 1: FIRM_W, 2: (7.0, 3.5, 0.8)}   # K-183.4: firma alıcının stratejisine göre (fiyat, kalite, itibar) ağırlıkları: ucuz strateji ucuz girdi arar, pahalı strateji kaliteli girdi
GRADE_EVERY, GRADE_GAP = 13, 0.08         # K-183.4: oyuncu firması stratejisini 13 haftada bir gözden geçirir; açık (talep payı - arz payı) farkı en az 0,08 ise değiştirir
QPATH_EVERY, QPATH_SW = 13, 1.2           # K-183.3: DAO Ar-Ge yolunu (süreç / ürün) 13 haftada bir gözden geçirir; öbür yolun getirisi %20 fazlaysa değiştirir
QREP_W = 0.25                             # K-183.3: kalite itibarı etkiler: firma itibar hedefine 100·QREP_W·(kalite - 0,5)
AD_FIRM, AD_DAO, AD_KEEP, AD_MAXSURP, AD_START = 0.02, 0.10, 1.5, 0.25, 10   # K-183.5: oyuncu firması son haftalık gelirinin %2'sini (işletme sermayesi × 1,5 üstü fazlanın en çok %25'i), DAO fazlasının %10'unu medyadan doğrudan reklam alımına harcar; 10. haftadan sonra
QPREM = 0.5                               # K-183.3: kalite farkının fiyat primine yansıması (kalite 1 puan üstü = %50 prim hedefi)
QDEF = 0.5                                # K-183.3: kalite izlenmeyen satıcıların varsayılan kalitesi
PM_MIN, PM_MAX, PM_ADJ = 0.5, 2.5, 0.08    # K-110: arz-talep fiyat çarpanı sınırları ve haftalık hız
# ---- K-185 (sahip kararı 2026-10-27): para arzı tavanı, NPC kurtarma yok, lonca sosyal paketi, şehir tahvili, politika faizi, lonca kaldıracı, makine/bina yatırımı, konut inşaatı, medya loncası şartı
MONEY_CAP = True                          # K-185.1: basım yılda en çok para arzının %MINT_YEAR'ı (kümülatif haftalık izin); izin dolunca şehir kasası eksiye düşemez, harcama kısılır (ya da tahvil, K-185.4)
MINT_YEAR = 0.02                          # K-185.1: yıllık en çok basım / para arzı (oyun yılı = 52 hafta)
MINT_OPEN_WEEKS = 13                      # K-185.1: açılış (ilk 3 ay: yeni çırakların maaşı, NPC açılış sermayesi) tavandan muaf
MINT_LOW_SHARE = 0.5                      # K-185.1: öncelik sırası: işsizlik ödeneği ve çıraklık bursu (asgari güvence) iznin tamamını, belediye/kamu desteği yarısını kullanabilir
MINT_NOPRINT = ("sehirler_arasi_denge", "npc_kurulus_sermayesi", "altyapi_hizmet_sozlesmesi", "kamu_hizmet_sozlesmesi", "kamu_destek_fonu", "kurulus_fonu_fonlama", "tahvil_faizi", "tahvil_itfa")   # K-185.1: basım iznini kullanamayan kalemler (yalnız şehrin gerçek gelirinden)
MINT_PRIO = ("issizlik_odenegi", "ciraklik_bursu")                 # K-185.1: asgari güvence önce
LONCA_WELFARE = True                      # K-185.3: loncalar isteğe bağlı sosyal paket (işsizlik ödeneği, çıraklık bursu) sunar; paket fee gelirinden finanse edilir, rezerv şartı vardır; şehir yalnız asgari güvence verir
WELF_CITY_MULT = 0.6                      # K-185.3: asgari güvence: şehir işsizlik ödeneği = eski ödenek × bu
WELF_AHIR_MULT = 0.7                     # K-185.3: asgari güvence: şehir çıraklık ocağı (ahır) ücreti = eski × bu (çıraklık bursu asgariye iner)
WELF_G0 = (0.0, 0.1, 0.2)                 # K-185.3: lonca numarası % 3'e göre başlangıç cömertliği (ücretin payı olarak ek ödenek); sonra lonca kendi karar verir
WELF_GMAX, WELF_STEP, WELF_EVERY = 0.5, 0.05, 13   # K-185.3: cömertlik tavanı, adım, gözden geçirme sıklığı (hafta)
WELF_BURS_RATIO, WELF_BURS_WEEKS = 0.3, 26         # K-185.3: çıraklık bursu = cömertlik × bu (ücret payı); yalnız ilk 26 hafta özel işyeri tecrübesi olan çırağa
WELF_START = 26                           # K-185.3: stratejik gözden geçirme bu haftadan sonra
WELF_UNEMP_WEEKS = 26                     # K-185.3: lonca ödeneği iş kaybından sonra en çok bu kadar hafta
WELF_RES_WEEKS, WELF_SHARE_MAX = 8, 0.4   # K-185.3: rezerv şartı: taahhüdün (beklenen haftalık ödeme) bu kadar haftası nakit; fee gelirinin en çok bu payı pakete
WELF_ATTR = 0.03                          # K-185.3: lonca skoruna paketin değeri (fee puanı eşdeğeri: etkin cömertlik × bu); çalışan çekimi
WELF_EXPO = 0.05                          # K-185.3: beklenen ödeme önsel değeri: üye ücret toplamının haftalık bu payı × cömertlik
CITY_BOND = True                          # K-185.4: şehir kasası açık verince lonca havuzlarına tahvil satar (basım izni dolunca); faiz + anapara vergi gelirinden; aşırı borçta harcama kısılır (temerrüt yok)
BOND_TERM = 104                           # K-185.4: tahvil vadesi (hafta; anapara eşit taksit)
BOND_RATE_MULT = 0.5                      # K-185.4: tahvil faizi taban faizin bu payı (devlet borcu en düşük riskli borçtur: kredi faizinin altında) + BOND_MARGIN
BOND_MARGIN = 0.0005                      # K-185.4: tahvil faizi (haftalık) = taban faiz (politika / mevduat) + bu marj
BOND_DEBT_MAX_W = 104                     # K-185.4: borç tavanı = bu kadar haftalık referans şehir geliri (referans gelir yavaş sönümlenir: krizde borçlanma kapasitesi bir anda yok olmaz)
BOND_REV_DECAY = 0.995                    # K-185.4: referans gelirin haftalık en çok sönümü
BOND_DEBT_MAX_W_OLD = 52                      # K-185.4: borç tavanı = bu kadar haftalık sönümlü şehir geliri (borç/gelir sınırı)
BOND_MIN = 50.0                           # K-185.4: en küçük ihraç (Akçe)
RES_BONDS = True                          # K-185.4: tahvil rezerv şartını karşılar (aksi halde havuz tahvile girince kredi veremez)
BOND_POOL_SHARE = 0.5                     # K-185.4: havuz kredi için nakdinin en az yarısını tahvile ayırmaz
BOND_FIRST = False                        # K-185.4: True: tahvil basım izninden önce kullanılır; False: önce izin
RATE_POLICY = True                        # K-185.5: tek politika faizi (Taylor benzeri, deterministik, sınırlı adım): işsizlik ve boşta mevduat yüksekken düşer, sepet fiyat endeksi hızla artarken yükselir; havuz kredi faizi = politika faizi + kendi risk marjı
POL_NEUT, POL_MIN, POL_MAX, POL_STEP = 0.003, 0.0001, 0.01, 0.0003   # K-185.5: tarafsız haftalık faiz, taban, tavan, haftalık en çok değişim
POL_A_INF, POL_A_U, POL_A_IDLE = 0.01, 0.004, 0.003   # K-185.5: yıllık enflasyon sapması, işsizlik sapması, boşta mevduat payı sapması katsayıları
POL_INF_TGT, POL_U_STAR, POL_IDLE_STAR = 0.0, 0.25, 0.5   # K-185.5: hedef yıllık sepet fiyat artışı, doğal işsizlik, hedef boşta mevduat payı
POL_CD, POL_CD_STAR, POL_A_CD = True, 0.7, 0.006   # K-185.18 (sahip: faiz düşsün): boşta mevduat yerine kredi (+ipotek +tahvil) / mevduat oranı hedefin altında kaldıkça faiz düşer (taban ~0, negatif yok)
POL_INF_WEEKS = 13                        # K-185.5: enflasyon ölçüm penceresi (hafta)
RISK_K, RISK_MAX = 0.5, 0.005             # K-185.5: lonca risk marjı = CX_MARGIN + RISK_K × (sönümlü kredi kaybı / kalan kredi), en çok RISK_MAX
LONCA_LEVERAGE = True                     # K-185.6: loncanın toplam kredisi (firma + konut) kendi sermayesinin (özkaynak = nakit + krediler + tahviller - mevduat) en çok LEV_K katı; batan loncanın mevduat sahipleri kayıp yaşar (sigorta yok)
LEV_K = 25.0                              # K-185.6: kaldıraç sınırı
CAPEX = True                              # K-185.7: makine ve bina yatırımı: üretim = çalışan × min(1, sermaye ile desteklenen çalışan / çalışan); makine (alüminyum + elektronik bileşen) ve bina (inşaat) gerçek mal alımıdır, yıpranır; yatırım kredisi (K-181) finanse eder
CAPEX_CAL = True                          # K-187.2: makine/bina maliyeti ekonominin ölçeğine kalibre: yuva başına ~7 haftalık ücret (eski ~76 hafta: toplam sermaye stoku para arzının 4 katıydı, özelleştirmede alıcı çıkmıyordu)
MACH_AL_CAL, MACH_BI_CAL, BLD_INS_CAL = 9.0, 9.0, 4.0   # K-187.2: kalibre yuva: 9 alüminyum + 9 bileşen (~53 Akçe) + 4 inşaat (~54 Akçe) ≈ 107 Akçe/yuva (çırak haftalık ücreti ~15,6)
CRED_V2 = True                            # K-187.4: yeni kurulan (YOUNG_WEEKS) ve özelleştirmeyle devralınan firma yaş şartından muaf; devralınanda kâr şartı devir planıyla (ilk CRED_PLAN_WEEKS hafta, plan kârı = işletme sermayesinin CRED_PLAN_PROF'u) değerlendirilir
CRED_PLAN_WEEKS, CRED_PLAN_PROF = 26, 0.05
ENTRY_JOBLESS = False                     # K-187.5: işsiz ama deneyimli (worked) oyuncu da firma kurabilir (yalnız çalışanlar kurabiliyordu: çöküşte kurucu adayı kalmıyordu)
MACH_AL, MACH_BI = 100.0, 100.0          # K-185.7: bir makine "çalışan yuvası" için alüminyum ve bileşen birimi (maliyet ≈ 584 Akçe)
BLD_INS = 45.0                            # K-185.7: bir bina yuvası için inşaat birimi (maliyet ≈ 604 Akçe)
DEPR_M, DEPR_B = 0.002, 0.0005              # K-185.7: haftalık amortisman (makine ~2 yıl, bina ~5 yıl)
CAPEX_START = 26                          # K-185.7: yatırım ve amortisman bu haftadan sonra (açılış geçişinde firma nakdi yatırıma değil işletmeye gider)
CAPEX_HEAD = 1.1                          # K-185.7: hedef yuva = çalışan × bu
CAPEX_NEW_SLOTS = 2.0                     # K-185.7: yeni kurulan oyuncu firması başlangıç yuvası (kiralık/ikinci el atölye)
CAPEX_MIN_SLOTS = 12.0                    # K-185.7: açılış/program/yeniden kurulan NPC firmanın en az başlangıç yuvası (standart tesis)
CAPEX_INIT = 1.25                         # K-185.7: açılış firmalarına verilen başlangıç sermayesi: çalışan × bu yuva (makine ve bina)
CAPEX_MAXW = 0.3                         # K-185.7: haftalık en çok alım: hedef yuvanın bu payı (en az 1 yuva)
CAPEX_KEEP = 1.0                          # K-185.7: işletme sermayesinin bu katı kasada kalmadan yatırım yapılmaz
CAPEX_PROFIT = 2.0                        # K-185.7: büyüme yatırımı için NPC kasası işletme sermayesinin bu katından fazla olmalı
HOUSE_BUILD_X = True                      # K-185.8: konut inşaatı tetiklenir: ikinci el fiyat > gerçek inşaat maliyeti (inşaat malı × piyasa fiyatı + emek + arsa) ve faiz düşük ve fiziksel boşluk az -> yatırımcı yeni konut yaptırır; malzeme inşaat sektöründen takasla alınır
# (K-179 inşaat neden tetiklenmiyordu: geliştirici seçeneği yalnız şehrin SATILMAMIŞ kira stoku ve ikinci el arzı bittikten sonra devreye giriyordu; şehir stoğu (sahipsiz kiralık) 'boş' sayıldığından her zaman daha ucuz birincil seçenek vardı ve maliyet 0,95 × birincil fiyat varsayımıydı, gerçek girdi maliyeti değil)
HOUSE_INS_UNITS = 90.0                    # K-185.8: bir konut için inşaat malı birimi (referans 13,4 Akçe/birim ≈ 1.200 Akçe)
HOUSE_LABOR = 0.25                        # K-185.8: emek payı: malzemenin bu kadarı ek (şehre: inşaat işçileri ve belediye)
HOUSE_PLOT = 0.10                         # K-185.8: şehir arsası: birincil fiyatın bu payı (şehir kasasına)
HOUSE_DEV_MARGIN = 0.05                   # K-185.8: ikinci el fiyatı maliyeti en az bu oranda aşmalı
HOUSE_RATE_MAX = 0.0045                   # K-185.8: referans (politika/mevduat) faizi bundan düşükse inşaat yapılır (faiz düşükken)
HOUSE_VAC_MAX = 0.125                     # K-185.8: fiziksel boşluk (stok - kiracı) / stok bundan azsa yapılır
HOUSE_DEV_MAXW = 4                        # K-185.8: şehirde haftalık en çok yeni başlayan konut
MEDIA_LONCA_EASY = True                   # K-185.9: medya loncası kuruluş şartı gevşer: kurucu bir medya firması sahibi (≥2 çalışan, yaş şartı aynı), kuruluş sermayesi 250 Akçe (+100 likit tampon), kazanç şartı yok; gider ve batma kuralları aynı
MEDIA_EASY_CAP, MEDIA_EASY_BUF = 250.0, 100.0   # K-185.9
LIQUIDATION = True                        # K-185.10: batan firmanın makine ve binası ikinci elde satılır; gelir sırasıyla ödenmemiş ücret, kredi veren lonca, pay sahipleri, kurucu; batan loncanın kredi portföyü devredilir/satılır, gelir önce mevduat sahiplerine
LIQ_WEEKS = 4                             # K-185.10: tasfiye masası açık kalma süresi (hafta): alıcı aranır, sonra kapanır (satılmayan yuva hurda: gelir yok)
LIQ_DISC_M, LIQ_DISC_B = 0.60, 0.20      # K-185.10: ikinci el iskonto: makine sektöre özel (yeni maliyetin %40'ı, alıcı aynı sektörden), bina genel amaçlı (%80, aynı şehir)
LOAN_SALE_DISC, LOAN_SALE_BAD = 0.10, 0.50   # K-185.10: batan loncanın kredi portföyü satış iskontosu (sağlıklı kredi: %10; temerrütte olan: ek %50)
INSURANCE = True                          # K-185.11: sigorta ayrı sektör: sigorta DAO'ları işsizlik (ve sağlık) sigortası satar; sosyal paket sunmak isteyen lonca paketi prim ödeyerek sigortadan alır; poliçe sigortacıda durur (lonca batarsa devredilir); rezerv şartı, reasürans, batış kuralı
INS_MAX, INS_CAPITAL, INS_FOUND_EVERY = 4, 1500.0, 13   # K-185.11: en çok sigortacı, kuruluş sermayesi (kurucunun cebinden), kuruluş denemesi sıklığı (hafta)
INS_LOAD, INS_Q0, INS_QMAX = 0.25, 0.08, 0.6            # K-185.11: prim yüklemesi (gider + kâr), başlangıç hasar oranı (hasar / (cömertlik × bordro)), tavan
INS_RES_WEEKS, INS_FAIL_SOLV, INS_FAIL_WEEKS = 8, 0.3, 8   # K-185.11: rezerv şartı (beklenen haftalık hasarın 8 haftası), batış eşiği (rezerv / şart) ve süre
INS_REINS_SHARE = 0.3                     # K-185.11: reasürans: prim ve hasarın bu payı başka sigortacıya devredilir (orantılı anlaşma)
INS_DISC_MAX = 0.2                        # K-185.11: kurucu itibarı / sicili iyi sigortacı daha ucuz poliçe: prim indirimi en çok %20 (ölçülü)
INS_INVEST, INS_KEEP_MULT = 0.7, 1.5      # K-185.11: şart × 1,5 üstü fazlanın bu payı mevduata (boşta paraya yeni kanal); şart × 1,5 altına inince mevduat çekilir
INS_DIV_MULT, INS_DIV_SHARE = 2.5, 0.2    # K-185.11: rezerv şart × 2,5 üstüyse fazlasının haftalık %20'si kurucuya (kâr payı)
HEALTH_PREM = 0.03 * 0.8 * 40.0 * 1.5     # K-185.12: sağlık primi tabanı: kapsanan çalışan başına haftalık beklenen hasar (hastalanma × pay × bedel × ort. düzey)
INS_MIN_PAYOUT = 0.3                      # K-185.11: ödeme oranı en az bu (rezerv / şart düşükse hasar bu orana kısılır)
INS_FALLBACK = True                       # K-185.11: sigortacı yoksa (ya da hepsi battıysa) lonca paketi kendi fonundan öder (eski kural)
ENTRY_FIX = True                          # K-185.12: girişimci kapısı düzeltmeleri: kısmen eksik girdiyle kuruluş (WORTH_SHORT_X) ve kıtlık derinleşince kök eksiklik eşiği düşer (kıtlık sinyali)
WORTH_SHORT_X = 0.4                       # K-185.12: girdi eksiği bu orandan büyükse girişimci kurmaz (eski 0,1)
THR_MIN = 0.4                             # K-185.12: kök eksiklik eşiği fiyat çarpanı yükseldikçe 1/PM katına iner, en az bu kat
YOUNG_CREDIT = True                       # K-185.12: genç firma kredisi (ayrı kategori): ilk YOUNG_WEEKS hafta, düşük faiz, ödemesiz dönem (yalnız faiz), yaş/kâr şartı yok, limit kuruluş planı × itibar; havuzun en çok YOUNG_POOL_SHARE'i
YOUNG_WEEKS, YOUNG_GRACE, YOUNG_RATE_MULT = 52, 13, 0.7   # K-185.12: genç sayılma süresi, anapara ödemesiz süre (hafta), faiz çarpanı (kredi faizi × bu)
YOUNG_LIM_MULT, YOUNG_POOL_SHARE = 1.5, 0.5   # K-185.12: kredi limiti = bu × (işletme sermayesi + başlangıç yuvası maliyeti) × itibar çarpanı; havuz payı sınırı
RENEW_FUND = True                         # K-185.12: yenileme fonu: firma (oyuncu ve NPC) temettü ve NPC kâr süpürmesinden ÖNCE amortisman kadarını firma alt hesabına ayırır; yenileme alımı önce buradan
RENEW_KEEP = 0.5                          # K-185.12: yenileme yatırımı için kasada işletme sermayesinin bu katı yeter (büyüme yatırımında CAPEX_KEEP)
HEALTH = True                             # K-185.12 (madde 12, sade ilk sürüm): sağlık sektörü: ilaç sanayi, hastane, eczane (hizmet sektörleri: gelir hasta ödemelerinden); deterministik hastalık; tedavi ücretli (sigortalıysa sigorta DAO'su); sağlık düzeyi
SICK_RATE, SICK_LOSS, SICK_DUR_UNTREATED = 0.03, 0.7, 4   # hastalanma payı (haftalık, oyuncu başına), hasta çalışanın verim kaybı, tedavisiz hastalık süresi (hafta); NPC çalışanlar hasta sayılmaz (sade sürüm)
TREAT_COST = 40.0                         # temel tedavi bedeli (Akçe); rahat ×2, premium ×4 (gelire göre seçilir: gelir esnekliği > 1)
TREAT_SPLIT = (0.7, 0.3)                  # tedavi bedeli: hastane (hizmet) / eczane (ilaç perakendesi)
ILAC_SHARE_H, ILAC_SHARE_E = 0.15, 0.55   # hastanenin / eczanenin gelirinden ilaç sanayiine giden pay (toptan alım)
TREAT_PER_WORKER = 8.0                    # hastane çalışanı başına haftalık tedavi kapasitesi
HEALTH_WAGE_MULT = 1.5                    # hastane ve ilaç çalışanı ortalama ücret çarpanı (doktor ağırlıklı karışım: %20 doktor ×3, %80 hemşire ×1,2)
HEALTH_COVER = 0.8                        # sigortalı hasta için sigortacının üstlendiği tedavi payı (en çok rahat düzey bedeli)
HEALTH_LVL_EFF, HEALTH_REP = 0.3, 6.0     # şehir sağlık düzeyi hastalanmayı en çok %30 azaltır; şehir itibarına en çok bu kadar puan
PREVENT_RATE = 0.003                      # koruyucu sağlık: tampon üstü servetin haftalık bu payı (hastane gelirine, düzeyi artırır)
EDUCATION = True                          # K-185.12 (madde 13, sade ilk sürüm): eğitim sektörü: okul ve üniversite (hizmet sektörleri: gelir öğrenci ücretlerinden); burs; terfi hızlanır; üniversite mezunlarının bir kısmı inovatör olur; öğrenci tam çalışamaz
TUI_B, TUI_U = 8.0, 20.0                  # haftalık öğrenim ücreti: okul / üniversite
EDU_WEEKS = (26, 52)                      # okul ve üniversite süresi (hafta)
EDU_INTAKE = 0.012                        # şehirde haftalık en çok yeni öğrenci payı (oyuncu sayısına)
EDU_TIME = 0.5                            # öğrenci olan çalışanın verim kaybı (fırsat maliyeti)
EDU_SPEED = (0.0, 0.25, 0.5)              # diploma düzeyine göre terfi hızlanması (tecrübe haftası × (1 + bu))
EDU_INNOV_EVERY = 4                       # her 4. üniversite mezunu inovatör olur (deterministik oran %25)
EDU_BURS = 0.6                            # lonca paketi aktifse üyenin öğrenim ücretinin lonca fonundan karşılanan payı (isteğe bağlı burs, zorunlu değil)
EDU_WAGE_MULT = (1.3, 1.8)                # okul ve üniversite çalışanı ücret çarpanı (öğretmen, akademisyen)
EDU_AFFORD_WEEKS = 8                      # kayıt için öğrenim ücretinin en az bu kadar haftası nakit (ya da burs)
WEALTH_RULE = True                        # K-185.13 (sahip): servet bazlı harcama: birikim X haftalık normal harcamanın altındaysa ya da kişi işsizse tüketim düzleştirme (zorunlu sepet + kira birikimden tam, ek harcama birikimin hızlı payı); varlıklıysa eşik üstü servetin yılda %4,5'i + gelirden harcama; eşik civarında doğrusal karışım
WR_WEEKS, POOR_SHARE = 12, 0.03           # K-185.13: eşik = bu kadar haftalık normal harcama (≈ 6 oyun ayı); az birikimlinin ek harcaması birikimin haftalık bu payı
WR_BLEND = (0.75, 1.25)                   # K-185.13: karışım aralığı (eşik katı): altında tam 'az birikimli' kuralı, üstünde tam 'varlıklı' kuralı
NPC_POOL_CONS = True                      # K-185.13 (sahip: "NPC de tüketen olmalı"): işsiz (havuzdaki) NPC de hane olarak tüketir (nakdi varsa); kira modellenmez (konut stoku oyuncu + çalışan NPC için)
NPC_MIN_BAL = 1.0                         # K-185.13: tüketici sayılmak için havuz NPC'nin en az nakdi (altı 'yoksul': hesapta tutulur)
NPC_ASGARI = False                        # K-185.13: şehir asgari işsizlik güvencesi işsiz NPC'ye de verilir mi (maliyet ölçümü için; varsayılan kapalı: şehir geliri yetmez)
NPC_LABOR = True                          # K-185.15 (sahip: "gerçekte nasıl oluyorsa bize uyarlayarak"): NPC gerçek işgücü: iş arar (işveren seçimi deterministik skorla: tecrübe basamağı + (oyuncuysa) itibar + hafif oyuncu önceliği), oyuncu firmaları da NPC işçi alır, ücret işgücü kıtlığında yükselir / bollukta yavaş düşer
NPC_LAB_PF = True                         # K-185.15: oyuncu firması NPC işçi alabilir mi
PLAYER_PRIO, NPC_POOL_K = 0.3, 10         # K-185.15: oyuncu önceliği (skor puanı; tecrübe basamağı farkı 0,3-0,6), işverenin bakacağı havuz NPC sayısı
AHIR_MOVE, AHIR_MOVE_PREMIUM = 0, 0.20    # D6 (sahip onaylı): ahırdaki/belediyedeki oyuncunun NPC firmasındaki boş kadroya geçişi: 0 otomatik (v13.0: koşulsuz), 1 gönüllü (yalnız teklif edilen ücret şimdiki ücretin (1 + AHIR_MOVE_PREMIUM) katıysa), 2 kapalı (hiç geçmez)
HIRE_PRIORITY = 0                         # D6: NPC firması işe alım önceliği: 0 oyuncu önce (v13.0: PLAYER_PRIO yalnız iş arayan oyuncu ile havuz NPC'si arasında), 1 eşit (iş arayan oyuncu, geçişe uygun ahır/belediye oyuncusu ve havuz NPC'si aynı skorla: verimlilik basamağı + itibar), 2 NPC önce
FIRE_ORDER = 0                            # D6: NPC firması küçülürken çıkarma sırası: 0 yalnız NPC (v13.0), 1 son giren ilk çıkar, 2 en düşük verimlilik basamağı önce, 3 oyuncu/NPC ayrımı yok (hafta ve kişi adından deterministik sıra)
AHIR_BACKFILL = 0                         # D6: 1 ise ahırdan çıkan oyuncunun yerine havuzdan bir NPC ahıra girer (ahır ücretiyle, ahır kapasitesini aşmadan)
PLAYER_INFLOW, PLAYER_INFLOW_RATE = 0, 10   # D6: yeni oyuncu katılımı: 0 kapalı (v13.0), 1 ahır boşluğu kadar (ahırdaki oyuncu sayısı AHIR_TARGET altındaysa şehir başına fark kadar, ahır boş yerleriyle sınırlı), 2 sabit hız (şehir başına haftada en çok PLAYER_INFLOW_RATE)
AHIR_TARGET, PLAYER_MAX_PER_CITY, PLAYER_MAX_TOTAL = 0, 1000, 0   # D6: ahır hedefi (0 = PLAYERS_PER_CITY); şehirdeki oyuncu üst sınırı; toplam kişi (oyuncu + NPC) üst sınırı (0 = sınırsız; sunucu koşu içinde de uygular)
LAB_K, LAB_DOWN, LAB_U_STAR = 1.0, 1.0, 0.2   # K-185.15: haftalık ücret endeksi sürüklenmesi = LAB_K × 0,1 × (doğal işsizlik - işsizlik oranı); düşüş × LAB_DOWN (yapışkan ücret)
INVENTORY = True                          # K-185.16 (sahip: envanter): her firma kendi stokunu tutar: satılmayan çıktı stoğa girer (bozulur, depo gideri öder), girdi stoğu üretimi tedarik aksamasına karşı korur, üretim ve fiyat stok düzeyine bakar, batan firmanın stoğu indirimli satılır
INV_HI, INV_LO, INV_GAIN = 4.0, 1.0, 0.2  # K-185.16: stok örtüsü (stok / hedef döngülük üretim) bu eşiğin üstündeyse üretim kısılır, altındaysa NPC hedefi artar
INV_IN_CYC, INV_FILL = 7.0, 0.25          # K-185.16: girdi stoğu hedefi = bu kadar döngülük kullanım (≈1 hafta); her döngü açığın bu payı kadar tampon alım (nakit varsa, artık arzdan)
INV_HOLD = 0.0015                         # K-185.16: depo gideri: stok değerinin döngü başına payı (şehir kasasına)
INV_MAXC = 21.0                           # K-185.16: stok üst sınırı: son üretimin bu kadar döngüsü
INV_LIQ_DISC = 0.6                        # K-185.16: batan firmanın stoğu piyasa fiyatının bu katından satılır (tasfiye mali)
NO_STOCK = ("elektrik", "konaklama", "eglence", "yolculuk", "koruma", "yazilim")   # K-185.16: stoklanamayan hizmetler
STOCK_DECAY = {"ekmek": 0.08, "sut": 0.07, "et": 0.06, "yemek": 0.10, "sise_sut": 0.05, "kola": 0.012, "deterjan": 0.006, "un": 0.01, "bugday": 0.004, "seker": 0.002, "pamuk": 0.003, "tekstil": 0.003, "kot": 0.002, "moda": 0.004}   # K-185.16: döngü başına bozulma; listede olmayanlar (metal, mobilya, elektronik, bina) yavaş
STOCK_DECAY_DEF = 0.0008
NO_BAILOUT = True                         # K-185.2 (sahip KESİN kararı): şehir zarar eden NPC firmayı kurtarmaz; zarar eden NPC özelleştirilir (PRIVATIZE), özelleşene kadar şehir gelirinden (basımsız) kesintisiz çalışır; lonca kredisiyle yeniden kurulur
NPC_GRACE = 26                            # K-185.2: açılış geçişi (hafta): bu süre kurtarma eskisi gibi (açılıştaki NPC'ler kalır)
NPC_INFRA = ("market", "medya", "lojistik")   # K-185.2: girişimcinin kuramadığı altyapı türleri: sinyal aranmaz, lonca kredisiyle yeniden kurulur
NPC_DIE_WEEKS, NPC_KEEP, NPC_INSOLV = 13, 2.0, 0.5           # K-185.2: ödeme gücü (kasa < 2 döngü ücret) üst üste bu kadar hafta yoksa NPC batar; NPC kâr tamponu = NPC_KEEP × işletme sermayesi (üstü şehre)
NPC_FLOAT, NPC_FAIL = True, 0.4         # K-185.2: ayrım: KRONİK ZARARLI NPC (sönümlü işletme nakit akışı < -NPC_FAIL × işletme sermayesi) kurtarılmaz; sağlıklı ama nakit sıkışıklığı yaşayan NPC'ye şehir yalnız KENDİ GELİRİNDEN (basım ve tahvil yok) iade edilen nakit avansı verir (False = harfi harfine kurtarma yok: ekonomi çöker, ablasyon)
NPC_POOL_TAX, NPC_POOL_FLOOR = 0.0, 0.5     # K-185.2: işsiz NPC havuzunun birikmiş nakdi talepten kaçar (tüketmez): fazlasının haftalık bu payı şehir kasasına (vergi) döner; eşik = haftalık ücretin bu katı
NPC_EXEMPT = ("lojistik", "maden_komur", "santral", "guvenlik", "ulasim", "market")               # K-185.2: kamu altyapısı (ortak yük taşımacılığı): kurtarma değil, süregelen altyapı desteği (şehir gelirinden); aksi halde ticaret çöker
LOG_BUFFER_NB = 1.4                      # K-185.2: kurtarma yokken lojistik kadrosu fazla tamponla zarar eder; tampon küçülür
NPC_LONCA_FUND = True                     # K-185.2: sağlıklı NPC'nin nakit avansı şehir kasasından değil LONCA KREDİSİNDEN (havuzdaki boşta mevduat); NPC kârı önce krediyi öder, kalan şehre (vergi)
NPC_BRIDGE, NPC_LEV = True, 4.0            # K-185.2: nakit açığı olan NPC firmaya lonca köprü kredisi (toplam borç en çok NPC_LEV × işletme sermayesi)
NPC_REVIVE_DELAY, NPC_REVIVE_PM = 4, 1.0  # K-185.2: batan NPC en az bu kadar hafta sonra, ürün fiyat çarpanı >= eşik (kârlı sinyal) ise lonca kredisiyle yeniden kurulur
BIG_START = True                          # K-185.19 (sahip kararı 2026-10-27; K-74 'kıt kapasite' kuralını değiştirir): açılışta NPC firma planı ve kapasitesi NPC nüfusunun BIG_NPC_SHARE'ini çalıştıracak boyutta
BIG_NPC_SHARE, BIG_CAP_MULT = 0.8, 3.0    # K-185.19: açılış tüketici sayısı = oyuncu + pay × NPC nüfusu; NPC firma kapasitesi (ve açılış lojistik kadrosu) bu katsayıyla büyür
START_EMP = 0.0                           # D7 (A3, sahip onaylı): başlangıç NPC istihdam oranı (NPC nüfusunun payı); 0 = türetilmiş (BIG_NPC_SHARE tahmini, v13.0). Değer verilince yalnız hf1 kadro hedefi ve market kadrosu bu orana ölçeklenir (başka hiçbir şey değişmez)
FIRMS_PER_1000 = 0.0                      # D7 (A4): 1000 kişi (oyuncu + NPC) başına NPC işletmesi; 0 = bugünkü şehir planı. Plan tür dağılımını korur (her tür şehirde en az bir), yalnız adetler ölçeklenir
CAP_MODE = 0                              # D7 (A5): işletme açılış kapasitesi: 0 sabit (CAP_OTHER/CAP_LOG x BIG_CAP_MULT, v13.0), 1 otomatik (türe göre ceil(hf1 hedef kadrosu / türün şehirdeki işletme sayısı x CAP_AUTO_SHARE), en az CAP_AUTO_MIN), 2 elle (tür grubuna göre MCAP_*)
CAP_AUTO_SHARE, CAP_AUTO_MIN = 1.25, 25   # D7 (A5): otomatik kipte hedef kadronun üstüne eklenen pay (büyüme payı) ve işletme başına en az kapasite (küçük türler büyüyemez kalmasın)
MCAP_RAW, MCAP_MAKE, MCAP_SERV, MCAP_LOG = 75, 75, 75, 240   # D7 (A5, elle kip): işletme başına en çok çalışan: hammadde (tarla, maden, petrol, kereste), imalat, hizmet ve perakende, lojistik
CAP_GROWTH = 0                            # D7 (A5): büyüme tavanı (CX_CAP_MAX x taban kapasite): 0 CAP_OTHER'a bağlı (v13.0), 1 işletmenin AÇILIŞ kapasitesine bağlı; elle/otomatik kapasite tavanı sessizce değiştirmez
CAP_KIND_GROUP = {"tarla_bugday": "raw", "tarla_seker": "raw", "tarla_pamuk": "raw", "maden_silika": "raw", "maden_aluminyum": "raw", "maden_kimyasal": "raw", "maden_komur": "raw", "maden_altin": "raw", "petrol": "raw", "kereste": "raw",
                  "un": "make", "firin": "make", "santral": "make", "cam": "make", "plastik": "make", "tekstil": "make", "sise_sut": "make", "kola": "make", "deterjan": "make", "giyim": "make", "mobilya": "make",
                  "lojistik": "log"}   # D7 (A5): tür grupları (listede olmayan NPC türü "serv": market, medya, güvenlik, ulaşım, restoran, eğlence, kuyumcu, inşaat, sağlık ve eğitim)
START_DEMAND = 0                          # D7 (A6): hf1 kadro tahmini: 0 bugünkü (NPC nüfusunun BIG_NPC_SHARE'i tüketici sayılır, kişi başı talep ücretten), 1 tutarlı (döngünün talep fonksiyonuyla ve geliri olacak tüketici sayısıyla: oyuncular + işe alınacak NPC, sabit nokta)
START_STOCK_WEEKS = 0                     # D7 (A6): hf1 kadrosu belli olunca her NPC üretim işletmesine bu kadar haftalık girdi stoku (fiziksel stok, para yaratmaz); 0 = yok
NPC_START_CASH = 0.0                      # D7 (A7): her NPC'ye başlangıç nakdi, haftalık harcama cinsinden (MPC0 x ücret x döngü sayısı x bu hafta sayısı); kuruluş basımı olarak kayıtlı (kind npc_baslangic_nakdi); 0 = bugünkü (nakitsiz)
HOUSE_MODE = 0                            # D7 (A8): açılış konut stoku: 0 HOUSE_NPC_TEN (v13.0), 1 boşluk x (oyuncu + hf1'de çalışan NPC) (şehir başına)
POP_SCALE = False                         # D7 (E): True ise nüfus ölçeği s = toplam nüfus / 6600 (bugünkü nüfus) ile mutlak tutarlar ölçeklenir (TRANS_CAP, NPC_RESERVE, LOG_INIT_WORKERS, MEDYA_STAFF, AHIR_HERD_WORKERS, HOUSE_NPC_TEN, MODA_SAT, büyüme tavanı); kapalıyken s etkisiz
POP_BASE = 6600                           # D7 (E): bugünkü toplam nüfus (5 x 300 oyuncu + 600 + 3 x 1500 NPC); s = toplam nüfus / bu
POP_SCALE_FACTOR = 1.0                    # D7 (E): türetilmiş; POP_SCALE kapalıyken 1,0 (aşağıda geçersiz kılmadan sonra hesaplanır)
NPC_HOUSE = 0                             # D9 (A2, sahip onaylı): NPC hanesi: 0 tek kişi (v13.0: her NPC işgücünde), 1 hane: NPC'lerin NPC_LFPR payı işgücünde, kalanı işgücü dışı bakmakla yükümlü; çalışan hane üyesi ücretinin eşdeğerlik payını bağımlılarına aktarır (hane içi paylaşım; hesaplar arası gerçek bakiye hareketi, para yaratmaz, kasa transferi değil)
NPC_LFPR = 0.527                          # D9 (A2): NPC işgücüne katılım oranı (yalnız NPC_HOUSE=1; TÜİK Eylül 2026: %52,7); 1,0 = herkes işgücünde
HOUSE_DEP_EQ = 0.5                        # D9 (A2): bakmakla yükümlü her kişinin eşdeğerlik ağırlığı (OECD-değiştirilmiş ölçek: ek yetişkin 0,5; modelde bağımlı yaş ayrımı yok); çalışanın payı 1 / (1 + bağımlı x ağırlık)
OPEN_MODE = 0                             # D9 (A9, sahip onaylı): açılış geçişi: 0 geçiş (NPC_GRACE, TR_START, CAPEX_START ve süpürme tamponu hf26'ya dek; v13.0), 1 dengede başla (hepsi hf1'den işler), 2 elle (aşağıdaki süreler)
OPEN_GRACE, OPEN_TR, OPEN_CAPEX, OPEN_SWEEP = 26, 26, 26, 26   # D9 (A9, yalnız OPEN_MODE=2): NPC kurtarma geçişi, kasa harcama kuralı başlangıcı, yatırım/amortisman başlangıcı ve NPC kâr süpürmesi tamponunun (NPC_KEEP/PK_MULT) başlangıcı: hafta
SWEEP_FROM = 26                           # D9 (A9): türetilmiş; NPC kâr süpürmesi/temettü tamponu bu haftadan sonra işler (kip 0'da NPC_GRACE'e eşit: v13.0). Aşağıda geçersiz kılmadan sonra hesaplanır
STAFF_ADJ, SHRINK_CAP, GROW_CAP = 0, 0.03, 0.10   # D10 (B2, sahip onaylı): kadro düzeltme hızı: 0 kapalı (v13.0: kadro hedefe bir haftada varır), 1 açık: NPC işletmesinin kadrosu haftada en çok SHRINK_CAP oranında küçülür (zarar eden ve kasası eşiğin altındaki işletme SHRINK_FIRST ile muaf), en çok GROW_CAP oranında büyür (en az 1 kişi); kimin çıkacağını FIRE_ORDER, kaç kişinin çıkacağını bu belirler
SEP_RATE, FIND_RATE = 0.0, 1.0            # D10 (B3): haftalık işgücü akışları: SEP_RATE yerleşik işletmelerde çalışan her NPC'nin haftada kendiliğinden ayrılma olasılığı (0 = yok; deterministik, hafta ve kişi adından), FIND_RATE havuzdaki işsiz NPC'lerin haftada işe alınabilen en çok oranı (şehir başına; 1,0 = sınır yok; 1. hafta açılış kadrosu sınırsız)
WAGE_U_ALL = 0                            # D10 (B4): ücret endeksinin baktığı işsizlik: 0 yalnız iş arayan oyuncu / oyuncu (v13.0), 1 iş arayan oyuncu + işgücündeki işsiz NPC / oyuncu + işgücündeki NPC
MUNI_POOL, JG_WAGE, JG_MAX = 0, 1.0, 0.05  # D10 (B6): kamu istihdamı havuza bağlı: MUNI_POOL=1 ise belediye, iş arayan oyuncular bittikten sonra havuzdaki işsiz NPC'yi de işe alır (bütçe aynı MUNI_SPEND kuralıyla); JG_WAGE belediye ücretinin basamak-0 ücretine çarpanı (NPC için), JG_MAX belediyedeki NPC sayısı üst sınırı (şehrin NPC nüfusuna oranı)
DISCOURAGE_WEEKS, DISC_RATE, DISC_RETURN = 0, 0.05, 0.02   # D10 (B7): cesareti kırılmış işçi: DISCOURAGE_WEEKS > 0 ise havuzda bu kadar haftadır işsiz kalan NPC haftada DISC_RATE olasılıkla işgücü dışına çıkar (iş aramaz, işe alınmaz, tüketir); işgücü dışındaki NPC haftada DISC_RETURN olasılıkla havuza döner
MONEY_LOOP = 0                            # D11 (D1, sahip onaylı): para devresi: 0 kasa biriktirir (v13.0), 1 kasa gelirini geri döndürür (TREASURY_RULE açılır: kasa TR_WEEKS haftalık giderini tutar, fazlası hanelere, yerel firmalardan hizmet alımına ve belediyeye döner), 2 kâr hanelere temettü (PROFIT_KEEP açılır: NPC firma PK_WEEKS haftalık tampon tutar, üstü vergi sonrası hanelere gerçek bakiye aktarımıyla dağıtılır). Yalnız yönü seçer; zamanlama OPEN_MODE/OPEN_* kartındadır. Eski TREASURY_RULE ve PROFIT_KEEP bayrakları ayrıca açıksa onlar da işler
GHOST_MODE, GHOST_WEEKS = 0, 13           # D11 (D2, sahip onaylı): hayalet firma: işçisiz ve parasız (nakdi bir kişilik işletme sermayesinden az) yerleşik işletme. 0 kapalı (v13.0: sonsuza dek yaşar), 1 geçiş desteği (TRANS_SUPPORT=2) üst üste GHOST_WEEKS hafta gelmeyen işletme kapanır (eskiden destek reddi ödeme gücü sayacını sıfırda tutuyordu), 2 GHOST_WEEKS hafta üst üste işçisiz kalan işletme kapanır (yalnız NO_BAILOUT ve NPC_GRACE sonrası; kamu altyapısı hariç)
PRIVATIZE = True                          # K-185.17 (sahip kararı 2026-10-27): zarara düşen NPC firma BATMADAN özelleştirilir; alıcı oyuncu ya da lonca (lonca yalnız devralır, KURMAZ); lonca özelleştirme kredisiyle finanse eder; bedel şehir kasasına
PRIV_START = 26                           # K-185.17: özelleştirme bu haftadan sonra (açılış geçişi)
PRIV_WEEKS = 6                            # K-185.17: sönümlü işletme nakit akışı bu kadar hafta üst üste zararda ise ihaleye çıkar (tek haftalık gürültüye karşı)
PRIV_LOSS = 0.01                          # K-185.17: zarar eşiği: sönümlü akış < -bu × işletme sermayesi
PRIV_INSOLV = 3                           # K-185.17: ödeme gücü sayacı bu değere ulaşan NPC de ihaleye çıkar (batışa NPC_DIE_WEEKS kala)
PRIV_F0, PRIV_FSTEP, PRIV_ROUNDS, PRIV_FLOOR = 0.6, 0.15, 6, 0.05   # K-185.17: ilk ihale fiyatı = tasfiye + F0 × (devam eden değer - tasfiye); her tur taban FLOOR'a kadar FSTEP oranında düşer; ROUNDS tur alıcı yoksa tasfiye ya da bekleme
PRIV_GC = 0.8                             # K-185.17: devam eden işletme değeri = yeni maliyetin bu oranı (zarar eden işletme indirimli) + stok
PRIV_LTV = 0.8                            # K-185.17: özelleştirme kredisi = bedelin bu oranı (lonca finanse eder) + işletme sermayesi desteği
PRIV_GRACE, PRIV_RATE_MULT, PRIV_TERM = 26, 0.6, 156   # K-185.17: ödemesiz süre (hafta, yalnız faiz), faiz çarpanı, vade (hafta)
PRIV_POOL_SHARE = 0.5                     # K-185.17: tek devir için havuzun en çok bu payı
PRIV_TOPUP = True                         # K-185.17: kredi, devralınan işletmenin işletme sermayesine kadar nakit desteğini de içerir
PRIV_LONCA_FROM, PRIV_LONCA_SCORE, PRIV_LONCA_SHARE = 2, 0.4, 0.25   # K-185.17: lonca yalnız oyuncu alıcı çıkmazsa (ihale turu >= FROM, ya da en iyi oyuncu puanı SCORE altı) devralır; havuzun en çok SHARE'i
PRIV_ACC_SECTOR, PRIV_ACC_OTHER = 0, 2   # K-185.17: oyuncu alıcı bu ihale turundan itibaren teklif verir (sektör deneyimli / diğer)
PRIV_RETRY = 13                           # K-185.17: alıcı bulunmayan sağlıklı NPC bu kadar hafta sonra yeniden ihaleye çıkabilir
PRIV_MAX_NEW = 3                          # K-185.17: şehir başına haftada en çok bu kadar yeni ihale
RENEW_SOFT = True                         # K-185.17: yenileme fonu nakit çekmez: tutar firmada kalır, yalnız temettü ve şehre kâr süpürmesi kısıtlanır (firma yenileme yatırımına kadar kullanabilir)
DEBUG_FIRM = __import__("os").environ.get("DBGF")                         # izlenecek firma adı (ör. "s0_firin0"); stderr'e döngü döngü yazar
SDUMP_ON = bool(__import__("os").environ.get("SDUMP"))     # tur 7: sektör zarar ayrıştırma dökümü (yalnız teşhis; davranışı etkilemez)
WEEKLY_CSV = __import__("os").environ.get("WEEKLY_CSV")     # tur 3: haftalık ölçüm CSV yolu (kapalıyken rapor çıktısı değişmez)
ORDER_BOOK = 1                            # K-195 (tur 11 deneyi): sipariş defteri: 1 = NPC firmanın köprü kredisi (işletme sermayesi) mevcut kadroya değil HEDEF kadroya (karşılanmayan talep dahil) göre boyutlanır ve sıfır kadrolu firma ile batmış sektörün yeniden kuruluşunda kıtlık (karşılanmayan talep) fiyat çarpanı eşiği yerine geçer; 2 = ayrıca üreticisi olmayan üründe kıtlık fiyat çarpanını (PM) yükseltir; 0 = kapalı (çıktı değişmez). Gerçek karşılığı: banka kredi limitini sipariş defterine/talep görünürlüğüne göre kurar, kıt malın üreticisi olmayan pazarda kıtlık rantı yeni girişi çeker
SHRINK_FIRST, SHRINK_WEEKS = True, 4.0    # K-191 (tur 5 deneyi): zarar eden (sönümlü nakit akışı < 0) ve kasası SHRINK_WEEKS haftalık ücretin altına inen firma önce küçülür: talebi (tamponsuz) aşan kadro bırakılır, yeni işe alım durur (köprü kredisi çalışma sermayesidir, kadro şişirmez); 0 = kapalı (çıktı değişmez). Gerçek karşılığı: zarardaki firma iflastan önce işten çıkarır / yatırımı keser
INFRA_CONT = True                        # K-190 (tur 4 deneyi): kamu altyapısı NPC'si (NPC_EXEMPT) kredi temerrüdünde batmaz: idari yönetim/borç yeniden yapılandırma (alacak lonca kaybı), kadro ve hizmet sürer; 0 = kapalı (çıktı değişmez). Gerçek karşılığı: hizmet sürekliliği gerektiren altyapıda iflas yerine alacaklı yeniden yapılandırması
INFRA_CONT_PRIV = 0                       # DAO oyunu M4: 1 = INFRA_CONT özelleştirilmiş zorunlu altyapıyı da kapsar: alıcının kredisi temerrüde düşünce firma batmaz, ÖZEL İDARİ YÖNETİM (gerçekte özelleştirilmiş altyapı, ör. Railtrack 2001, iflasta hizmeti kesmeden idari yönetime alınır): borç yeniden yapılandırılır (alacak lonca kaybı), alıcı işletmeyi kaybeder, kadro ve hizmet sürer; 0 = eski yol (firma batar, tüm kadro bir haftada işsiz, altyapı kesilir: D dünyasında 358. hafta lojistik 99 kişi, ticaret çöker)
STAPLE_CONT = 0                           # DAO oyunu M4: 1 = temel sepet zincirinin (STAPLE_KINDS) sahipsiz NPC işletmeleri zorunlu altyapı sayılır (NPC_EXEMPT): kasası boşalınca şehir işletme sermayesini tamamlar (altyapi_hizmet_sozlesmesi), kârı tamponsuz şehre süpürülür, temerrütte idari yönetim (INFRA_CONT), bailout/destek fonu dışı. ÖZELLEŞTİRMEYİ KAPATMAZ: zarar eden sahipsiz işletme priv_step ile yine ihaleye alınabilir (trans_blocks_priv NPC_EXEMPT için False; M5 testi karakterize eder); gerçekte temel gıda zincirinde süreklilik (stratejik stok/gıda tedarik kuruluşu). Neden: BASKET'in %81'i ekmek+şişe süt+kola; iki zincir çökünce talep karşılama < 0,5 (D dünyasında kalıcı çöküşün ortak halkası). 0 = eski yol (çıktı bayt bayt aynı)
STAPLE_KINDS = ("tarla_bugday", "un", "firin", "tarla_seker", "kola", "sise_sut", "cam", "maden_silika", "maden_aluminyum")   # DAO oyunu M4: STAPLE_CONT=1 iken zorunlu sayılan türler (ekmek: bugday-un-firin; şişe süt: sise_sut-cam-silika; kola: seker-aluminyum-kola)
REVIVE_CAPITAL = 2                       # DAO oyunu M5: yeniden açılan (canlanan) sahipsiz NPC işletmenin tesisi. 0 = eski yol (tasfiyede yuva 0'lanır, canlanan işletmede capf = 0, üretim sıfır, kredi ücrete gider, işletme yine batar; çıktı bayt bayt aynı). 1 = ölçüm karşılaştırması: standart tesis (CAPEX_MIN_SLOTS = 12) bedelsiz verilir (yoktan tesis). 2 = yoktan tesis yok: önce kendi tasfiye masasındaki/kabuktaki satılmamış yuva geri alınır (liq_settle NPC kabuğunun kalanını hurdaya çevirmez, kabukta tutar), hedef yuva = CAPEX_HEAD x açılış kadrosu (12 değil: tesis açılış kadrosunu karşılar, sonrası capex_plan ile büyür; yeni oyuncu firması 2 yuva ile açılır), eksik açık başka masalardan bedelli (tasfiye_satisi) alınır, masa yoksa bedeli canlanma kredisine eklenir ve capex_plan girdi alımıyla kurulur. Gerçek karşılığı: iflas masasındaki tesisi devralan yeni işletmeci tesisle çalışır, eksiği ikinci el/yeni alır
WAGE_TAX = 0.1                           # K-189 (tur 2 deneyi): işçi ücretinden gelir vergisi / stopaj (şehir kasasına; ücret ödendikten sonra işçiden); 0 = kapalı (çıktı v12.3 ile birebir). Gerçek karşılığı: ücret geliri vergisi + sosyal güvenlik primi; kamu istihdamı/ödenekleri NPC kâr süpürmesine değil yaygın vergi tabanına bağlanır
FOUND_COLLAT = True                      # K-190 (tur 3 deneyi): kuruluş kredisi teminatlı (kredinin finanse ettiği stok/işletme sermayesi ve makine rehinli): düşük itibar kredi miktarını kısmaz, yalnız faizi artırır (RM_HI); 0 = kapalı (çıktı değişmez). Gerçek karşılığı: varlık teminatlı girişim kredisi (SBA/KGF tipi), kredi karnesi fiyatı belirler, miktarı değil
TRANS_SUPPORT = 2                         # K-211 (sahip kararı 2026-10-28): geçiş desteği. 2 (v2) = kurtarmalı rejimin kanalı (işletme sermayesi açığı şehirden, kamu_destek_fonu, tavan/oran/derin taban; kâr önce fona); 1 = köprü kredisi yetmeyen zarar eden NPC'ye şehir KENDİ kasasından (basımsız) işletme sermayesi desteği ("kamu_destek_fonu"); destek oranı (şehir × tür) = 1 - özel kesimin karşıladığı talep payı / TRANS_THRESH (özel kesim eşiği geçince 0); 0 = kapalı (çıktı değişmez)
TRANS_CAP = 28000.0                       # K-211: haftalık toplam destek tavanı, Akçe/hf (ölçülen yapısal açığın ~2 katı: 14k x 2); şehirlere hane sayısıyla orantılı bölünür
TRANS_THRESH = 0.6                        # K-211: özel kesim eşiği: oyuncu/özelleşmiş firmaların karşıladığı talep payı bu değere ulaşınca (şehir × tür) desteği sıfırlanır
TRANS_FLOOR_WEEKS = 2.0                   # K-211: kasa tabanı: şehir kasası, TRANS_FLOOR_WEEKS haftalık zorunlu giderin (destek/kurtarma/tahvil/denge hariç sönümlü haftalık çıkış) altına destekle indirilmez
TRANS_FIRST = 0                           # K-211: 1 = zarar eden (sönümlü nakit akışı < 0) NPC'ye destek köprü kredisinden ÖNCE verilir (kredi borcu biriktirmez); 0 = destek yalnız köprü kredisi yetmeyince (tur 23 yerleşimi)
TRANS_FLOOR2 = 0.5                       # K-211 v2 (TRANS_SUPPORT=2): derin kasa tabanı, hafta cinsinden zorunlu gider (burs/ödenek/belediye ücreti önce, destek sonra); mod 1 TRANS_FLOOR_WEEKS kullanır
TRANS_SHARE_DEF = "staff"                 # K-211 v2: özel pay tanımı: "staff" = özel/özelleşmiş kadro ÷ talep kadro ihtiyacı; "sales" = özel/özelleşmiş firmaların satış birimi payı (sönümlü, şehir × tür)
TRANS_PRIV_OK = 0                        # K-211 v2 (TRANS_SUPPORT=2): 0 = destek alan (şehir × tür) çiftinde zarar eden NPC özelleştirmeye çıkmaz (geçiş özel girişle ilerler; ölçüm: özelleştirme serbestken ekonomi çöküyor); 1 = serbest (mod 1 gibi)
TRANS_REVIVE = 0                         # K-211 v2 (TRANS_SUPPORT=2): 1 = destek alan sektörde batan NPC lonca kredisi yerine destek fonundan kredisiz yeniden açılır; 0 = eski yol (lonca canlandırma kredisi)
SECTOR_BOARD = 1                          # K-212 (sahip kararı 2026-10-28): sektör panosu. 1 = hafta sonunda (şehir × ürün) panosu hesaplanır (W.board; yalnız zincirden türetilen veri) ve firma/lonca kararları ondan beslenir: girdi tamponu (tedarikçi riski), alımda sağlıksız tedarikçinin payı azalır (ikinci kaynak), üretim/kadro (sektör stoğu, kalıcı kıtlık), fiyat (sınırlı prim/indirim), oyuncu girişi/işe alımı, lonca kredi önceliği; 0 = kapalı (çıktı değişmez)
SB_HEALTH_WEEKS = 4.0                     # K-212: firma sağlığı: kasa bu kadar haftalık gideri karşılıyorsa tam sağlıklı (h=1). Kaynak: JPMorgan Chase Institute "Cash is King" (2016): küçük işletme medyanı 27 gün (~4 hf) nakit tamponu
SB_H_OK = 0.5                             # K-212: h >= bu ise tedarikçi "sağlıklı" (kasa >= 2 hf gider; aynı raporda alt çeyrek <13 gün ~ 2 hf)
SB_LOSS_WEEKS = 13.0                      # K-212: zarar serisi bu kadar haftaya ulaşınca sağlık cezası tam (yarım) olur: bir çeyrek (varsayım: haftalık modelde çeyrek)
SB_PERSIST_A = 0.15                       # K-212: kalıcı kıtlık = karşılanmayan payın üstel ortalaması (~6-7 hf hafıza; varsayım)
SB_SCARCE = 0.03                          # K-212: kalıcı kıtlık eşiği: ortalama karşılanmayan pay > %3 (varsayım)
SB_BUF_LO, SB_BUF_HI = 0.5, 4.0           # K-212: girdi tampon hedefi çarpanı (x INV_IN_CYC=1 hf): sağlıklı çok tedarikçi 0,5 hf, sağlıksız/tek tedarikçi 4 hf (tavan; imalat stok devri 4-8 hf alt ucu, güvenlik stoğu z*sigma*sqrt(L), z=1,65)
SB_SECOND = 0.25                          # K-212: sağlıksız baskın tedarikçinin payı 1-SB_SECOND = %75'i aşamaz, kalan %25 ikinci kaynağa (alternatif varsa; yalnız firma alıcıları)
SB_STOCK_HI = 28.0                        # K-212: sektör stoku örtüsü (döngü=gün) bu eşiğin (4 hf) üstündeyse ve kıtlık yoksa üretim/kadro frenlenir; 2x'te tam fren (mamul stoku 4-8 hf)
SB_BRAKE_MIN = 0.7                        # K-212: sektör stok freninin ölçek tabanı (kapasite kullanımı ~%70'in altına zorlanmaz; normal %75-85, Fed G.17 imalat 1972-2024 ort. %78,2)
SB_GROW = 0.15                            # K-212: kalıcı kıtlıkta kadro hedefi/NPC üretim ölçeği artışı üst sınırı (kapasite kullanımı >%85 senaryosuna karşılık, varsayım)
SB_STAFF_BRAKE = 0.10                     # K-212: stok fazlası ve kıtlık yokken kadro hedefi azalışı üst sınırı (varsayım)
SB_PREM_MAX, SB_DISC_MAX = 0.10, 0.10     # K-212: fiyat hedefine toplam kıtlık primi/stok indirimi sınırı (%10; haftalık adım mevcut PV2 hız katsayılarıyla sınırlı; fiyat ayarı Nakamura-Steinsson: düzenli fiyat medyan 8-11 ay). İndirim tam birim maliyetin altına inmez
SB_ENTRY_PERSIST = -1.0                   # K-212: oyuncu girişi için ürünün kalıcı kıtlığı (ortalama karşılanmayan pay) en az %2 (varsayım; SB_SCARCE'in altı: giriş gecikmesi kısa)
ENTRY_OPEN = 0                            # K-213 (sahip kararı 2026-10-28): girişim kapıları açılır. 1 = (1) K-212 "kalıcı kıtlık yoksa oyuncu girmez" kuralı devre dışı, (2) firma/DAO kurmada itibar şartı ve itibara bağlı kredi tavanı kalkar (itibar yalnız faizi etkiler; lonca kurma aynen), (3) kuruluş kredisi harcı + işletme sermayesini (FOUND_BUF dahil) tam karşılar (havuz yetmezse sıradaki lonca), (4) genç firma kurucusu çırak verimiyle başlamaz (EO_SKILL), (5) piyasa sinyali/kıtlık/arz fazlası/ithal fiyat/kârlılık/girdi eşiği kapıları şart değil, sektör seçiminde tercih ağırlığı (deterministik), (6) rakip kohortu; 0 = kapalı (çıktı değişmez)
EO_COHORT = 1                             # K-213 (6): ENTRY_OPEN açıkken rakip kohortu kurulur (0 = yalnız kapılar açılır)
EO_COHORT_PER = 2                         # K-213 (6): her NPC firmaya (ahır, belediye, Ar-Ge hariç) en az bu kadar rakip oyuncu firması
EO_COHORT_W0, EO_COHORT_W1 = 35, 50       # K-213 (6) -> K-215 (sahip: "35-50 haftalar olsun, erken başlamasınlar"; eski 20-30): kohort kuruluşları bu hafta aralığına yayılır (zincir sırasıyla: önce ham madde/ara mal, sonra tüketim); yalnız ENTRY_OPEN açıkken etkili
EO_COHORT_SAMECITY = 1                    # K-213 (6): 1 = rakip NPC firmayla aynı şehirde (yerel hizmetler her zaman aynı şehirde); 0 = ticari mallarda komşu şehir
EO_COHORT_SKIP = ("ahir", "belediye", "arge")   # K-213 (6): rakibi kurulmayan NPC firma türleri
EO_RATE = 0.002                           # K-213 (5): organik kuruluş: aday oyuncu başına haftalık kurma olasılığı (kesirli birikimle, deterministik); eski kapılar yokken kurucu seli olmasın diye oran sınırı (varsayım: oyuncu yılda ~%10 girişimci; gerçekte yetişkin nüfusta yıllık ~%2-4)
EO_ORG_START = -1                         # K-213 (5): organik kuruluşun başladığı hafta; -1 = otomatik (kohort açıkken EO_COHORT_W1 + 1: kohort lonca havuzunu önce kullanır; kohort kapalıyken ilk hafta)
EO_SKILL = 1.15                           # K-213 (4): genç (YOUNG_WEEKS) oyuncu firmasının verim tabanı = NPC dağılımının (%60 çırak 1,0 / %30 kalfa 1,3 / %10 usta 1,6) ortalaması: kurucu hedef sektörde "standart" çalışan; çırak (1,0) cezası yok, usta primi de yok
EO_NOREP_DAO = 1                          # K-213 (2): Ar-Ge DAO kurmada itibar eşiği (REP_DAO) de kalkar
EO_W_SIG = 1.0                            # K-213 (5): tercih ağırlığı: kök eksiklik sinyalinin eşiğe oranı (1 + min(oran, EO_W_SIG_CAP) x bu)
EO_W_SIG_CAP = 4.0
EO_CROWD = 4.0                            # K-213 (5): şehirdeki aynı türden canlı firma sayısı n ise ağırlık 1/(1 + n/EO_CROWD) (rakip kalabalığı; kobweb freni)
EO_IMP_PEN = 0.5                          # K-213 (5): ithal teslim fiyatı yerelden ucuzsa ağırlık bu kadarla çarpılır (eski kapı: kuruluş yok)

# ---- ENTRY_EXP (sahip kararı 2026-10-28): firma kuruluşu beklenen kâra bağlı (simkit/entry_exp.py); kaynaklar rapor-giris-beklenen-kar.md ----
ENTRY_EXP = 0                             # 1 = aday girişimciler panodan (fiyat, birim maliyet, karşılanmayan talep, rakip sayısı) beklenen kârı hesaplar; getiri sermaye maliyetini (kredi faizi + risk primi) aşarsa kurar, olasılık marjla pürüzsüz artar; itibar/sektör verimi kapısı yok; kuruluş kredisi eo_found (FOUND_FUND). 0 = kapalı (çıktı değişmez)
EE_REPLACE = 0                            # ENTRY_EXP açıkken eski sinyal/worth kuruluş yolu kapanır (1) ya da yanında sürer (0)
EE_FIN_OLD = 1                            # 1 = finansman eski kuruluş yolunda: kurucu harcı kendi birikiminden (L.bal >= FOUND_HARC), işletme sermayesi lonca kredisi (FOUND_COLLAT teminatı; havuz yetmezse kuruluş olmaz); ENTRY_EXP yalnız NEREDE/NE ZAMAN kurulacağını belirler. 0 = kuruluş fonu (eo_found, FOUND_FUND)
EE_PMAX = 0.0015                          # aday başına haftalık kuruluş olasılığı tavanı (en çekici fırsatta). Gerçek: Kauffman Rate of New Entrepreneurs ~%0,3/ay yetişkin = ~%0,07/hf (ortalama); tavan ortalamanın ~2 katı (patlama dönemi); EO_RATE=0,002 ile aynı büyüklük
EE_TEMP = 0.5                             # lojistik sıcaklığı: oran = beklenen getiri/engel; oran 1 -> olasılık tavanın yarısı, oran 1,5 -> %73, oran 0,5 -> %27
EE_AMIN = 0.05                            # bu çekicilikten (a) düşük sektör seçilmez
EE_PAYBACK = 104                          # geri ödeme ufku (hf): ~2 yıl (küçük işletme sahiplerinin tipik beklenen geri dönüş süresi 2-3 yıl)
EE_SURV1 = 0.78                           # ilk yıl hayatta kalma: BLS Business Employment Dynamics: yeni işletmelerin ~%78-80'i ilk yılı tamamlar (beklenen kâr hayatta kalma olasılığıyla ağırlanır)
EE_RP = 0.0017                            # haftalık risk primi (~yıllık %9): kredi faizinin üstüne özsermaye/girişimci riski (küçük işletme özsermaye getiri beklentisi ~%15-20 - kredi faizi ~%8-10)
EE_ENTRY_SIZE = 0.33                      # yeni firmanın yakaladığı satış = rakip başına ortalama satışın bu kadarı (Dunne-Roberts-Samuelson 1988: yeni girişlerin boyutu rakip ortalamasının ~1/3'ü)
EE_OWN = 0.30                             # kurucunun işletme sermayesinde kendi birikiminden koyması gereken en az pay (Caiani/BAM uygulaması; BAM net_worth_ratio; sayı varsayım)
EE_REAL_W = 0.5                           # beklenen kârda gerçekleşen sektör kârı (rakiplerin işçi başı kâr EMA'sı) ağırlığı
EE_REAL_MIN = 2                           # gerçekleşen kâr için en az çalışan rakip firma
EE_LOOK = 52                              # girişimcinin baktığı geçmiş (hf): aynı türden son bir yılda kurulan firmaların kaderi (sektör hayatta kalma tahmini)
EE_MIN_AGE = 8                            # bu yaştan genç firma kader gözleminde sayılmaz (sağ-sansür)
EE_PRIOR_N = 10                           # önsel (EE_SURV1) ağırlığı: firma sayısı eşdeğeri (Bayes)
EE_MAXN = 5                               # beklenen planda başlangıç ölçeği üst sınırı (işçi); sonrası mevcut işe alım kurallarıyla
EE_CAP_CITY = 2                           # şehir başına haftalık en çok kuruluş (sektör başına haftada en çok 1)

# ---- K-215/K-216 (sahip kararı 2026-10-28): kuruluş fonu ve genç firma reçetesi ----
# Her parametrenin gerçek dünya karşılığı, kaynağı ve güveni rapor-K216-uygulama.md kalibrasyon tablosundadır; kaynağı olmayanlar "varsayım".
FOUND_FUND = 1                            # K-215a: 1 = şehir kasasından (basımsız) ayrı kuruluş fonu (şehir başına KFON<i>_sermaye); ENTRY_OPEN kuruluş kredisi (harç + işletme sermayesi) ve YOUNG_KIT dayanma limiti bu fondan verilir (lonca havuzunu tüketmez); geri ödeme/faiz fona döner. Ledger kind'ları: kurulus_fonu_fonlama (şehir -> fon), kurulus_fonu_kredi (fon -> firma), kurulus_fonu_geri_odeme / kurulus_fonu_faiz / kurulus_fonu_tasfiye (firma -> fon). 0 = kapalı (çıktı değişmez)
FF_SHARE = 0.5                            # K-215a: fon hedef büyüklüğü (sermaye) = bu pay x (şehir kasası + fon + fon alacağı); kredi verildikçe alacak da sayıldığından fon, hedefi aşan likiditeyi yeniden doldurmaz (sabit sermayeli döner fon). Model ölçeğinden: kohortun kuruluş kredisi ihtiyacı (~41 firma/şehir x ~500-2000 Akçe) ve ölçüm eski lonca havuzu (6-33 bin); kaynak yok: varsayım
FF_START = -1                            # K-215a: fonlamanın başladığı hafta; -1 = otomatik: kohort açıkken EO_COHORT_W0 - 10 (fon kohorttan ~10 hf önce dolar; boşta bekleyen fon şehir kasasını gereksiz tutmasın), kohort kapalıyken ilk hafta
FF_WEEKLY = 0.15                          # K-215a: haftalık aktarım üst sınırı = hedefin bu payı (kasayı bir haftada boşaltmaz)
FF_FLOOR_WEEKS = 2.0                      # K-215a: kasa tabanı: aktarım sonrası şehir kasası >= bu kadar hafta sönümlü zorunlu gider (Ledger.mand); K-211 TRANS_FLOOR_WEEKS ile aynı değer (GFOA genel fon bakiyesi tavsiyesi >= 2 ay ~ 8,7 hf; model tabanı daha gevşek)
FF_FALLBACK = 0                           # K-215a: 1 = fon yetmezse kuruluş kredisi lonca havuzundan; 0 = kuruluş fonda bekler (havuz yarışı yok)
YOUNG_KIT = 0                             # K-216 (sahip: "1, 2, 7, 6, 5, 4"): genç firma reçetesi (ilk YOUNG_WEEKS hafta). 1 = (1) 26 haftalık dayanma limiti (FOUND_FUND gerekir), (2) talebe bağlı işe alım, (4) giriş fiyatlaması, (5) lonca markası + açılış reklamı, (6) büyüme kredisi şartı kalkar + ödemesiz dönem YK_GRACE, (7) ölçeğe göre dağıtım (asgari etkin ölçek, ortaklı kuruluş); 0 = kapalı (çıktı değişmez)
YK_GRACE = 26                             # K-216 (6): YOUNG_KIT açıkken genç firma kredisinde anapara ödemesiz süre (hafta); eski YOUNG_GRACE = 13
YK_RUNWAY_WEEKS = 26                      # K-216 (1): fon, genç firmaya bu kadar haftalık işletme gideri kadar kredi limiti açar; ihtiyaç oldukça çekilir
YK_UPFRONT_WEEKS = 1.0                    # K-216 (1): kuruluşta peşin verilen nakit = harç + bu kadar haftalık işletme gideri (eski: FOUND_BUF = 3 işletme sermayesi = ~0,9 hafta)
YK_COVER_WEEKS = 1.5                      # K-216 (1): çekim hedefi: kasa bu kadar haftalık gideri karşılamalı
YK_TRIG = 0.7                             # K-216 (1): kasa hedefin bu payının altına inince çekim yapılır
YK_SWEEP_WEEKS = 4.0                      # K-216 (1): kasa bu kadar haftalık giderin üstüne çıkınca fazlası fona iade edilir (döner kredi limiti); temettü, fon borcu varken bu düzeyin üstündeki nakitten dağıtılır
YK_HIRE_MAX = 3                           # K-216 (2): genç firmada haftalık en çok işe alım (eski: 1)
YK_HIRE_COVER = 4.0                       # K-216 (2): işe alım için (kasa + çekilebilir limit) >= bu kadar haftalık yeni kadro gideri
YK_PROBE_WEEKS = 8                        # K-216 (2): bu yaşa kadar hedef kadro en az asgari etkin ölçektir (satış verisi oluşana dek)
YK_SELLOUT = 0.02                         # K-216 (2): satılamayan payı <= bu ise firma "satış tükeniyor" (kendi sipariş açığı) sayılır
YK_OWN_GAIN = 0.25                        # K-216 (2): kendi sipariş açığında hedef = kadro x (1 + bu) + 1
YK_SHORT_MIN = 0.02                       # K-216 (2): sektör (pano) kıtlığı (karşılanmayan pay) bu eşiği aşarsa kadro büyür
YK_SHORT_GAIN = 2.0                       # K-216 (2): kıtlıkta hedef = kadro x (1 + bu x kıtlık payı) + 1
YK_UNSOLD_BRAKE = 0.15                    # K-216 (2): satılamayan payı >= bu ise (satış eğilimi kötü) yeni alım durur; credit_core cx_ok ile aynı eşik
YK_OSC_WEEKS = 8                          # K-216 (2): işe alındıktan en geç bu kadar hafta içinde SHRINK_FIRST ile çıkarılan kişi "salınım" sayılır (ölçüm sayacı)
YK_REHIRE_WAIT = 0                        # v13.0 çakışma düzeltmesi (SHRINK_FIRST x talebe bağlı alım): genç firma SHRINK_FIRST ile kişi çıkardıysa bu kadar hafta yeniden işe alım yapmaz (alım/çıkarma salınımı); 0 = kapalı
YK_DRAW_UNSOLD_MAX = 1.01                 # K-216 (1): satılamayan payı bu eşiğin üstünde (ve yaş >= YK_PROBE_WEEKS) iken dayanma limitinden çekim yapılmaz; 1,01 = koşulsuz (sahip kararı: "ihtiyaç oldukça çeker"); ölçüm seçeneği: 0,15 (lonca kredisi cx_ok ile aynı eşik)
YK_ENTRY_WEEKS = 26                       # K-216 (4): giriş fiyatlaması süresi (ilk bu kadar hafta birim maliyet hedef ölçekteki çıktıya göre)
YK_REP_WEEKS = 52                         # K-216 (5): lonca markası etkisinin süresi (doğrusal sönümlenir)
YK_REP_FW = 0.5                           # K-216 (5): genç firmanın alıcıya görünen itibarı = bu x kurucu itibarı + (1 - bu) x lonca itibarı (kurum itibarından düşük değilse)
YK_AD_WEEKS = 1.0                         # K-216 (5): açılış reklamı = bu kadar haftalık işletme gideri (fon kredisiyle, DIRECT_AD mekanizması)
YK_AD_FUND_CAP = 0.01                     # K-216 (5): tek reklam fon bakiyesinin en çok bu payı
YK_AD_TRY = 6                             # K-216 (5): açılış reklamı için bu yaşa kadar denenir (medya firması yoksa/fon yoksa)
YK_MES_FRAC = 0.25                        # K-216 (7): asgari etkin ölçek (MES) = bu x gerçek ortalama işyeri büyüklüğü (YK_EST_SIZE), YK_MES_MAX ile sınırlı; varsayım (MES literatürde ortalama işyerinin küçük bir kesri)
YK_MES_MAX = 8
YK_SOLO_MAX, YK_B_MAX = 2, 4              # K-216 (7): MES <= 2 tek başına (grup A); <= 4 iki ortak (grup B); daha büyük üç ortak + büyük limit (grup C; limit hedef kadroya göre otomatik büyür)
YK_PARTNERS_B, YK_PARTNERS_C = 2, 3
YK_PARTNER_STAKE = 0.5                    # K-216 (7): her ortak nakdinin bu payını (en çok peşin nakdin yarısı) ortak sermaye olarak koyar (kurucu_sermayesi)
YK_MES_BE_PAYBACK = 52                    # K-216 (7): modelin kendi başabaş kadrosu: sabit giderler (kira, harç, ilk yuva) bu kadar haftada amorti
YK_EST_SIZE = {"ahir": 8, "guvenlik": 35, "maden_komur": 75, "santral": 38, "yazilim": 17, "tarla_bugday": 6, "tarla_seker": 6, "tarla_pamuk": 6, "maden_silika": 35,
               "maden_aluminyum": 100, "maden_kimyasal": 35, "petrol": 17, "plastik": 55, "elektronik": 70, "bilgisayar": 60, "kereste": 38, "un": 55, "cam": 60,
               "tekstil": 70, "firin": 10, "sise_sut": 60, "kola": 55, "deterjan": 40, "giyim": 20, "moda": 10, "mobilya": 25, "otel": 38, "ulasim": 20,
               "maden_altin": 60, "kuyumcu": 4, "restoran": 20, "eglence": 15, "insaat": 5, "market": 25, "medya": 30, "lojistik": 12, "hastane": 1000,
               "eczane": 10, "ilac": 80, "okul": 40, "universite": 1000}   # K-216 (7): ABD Census CBP (County Business Patterns) 2021, NAICS karşılığı ortalama işyeri çalışan sayısı (yaklaşık; ayrıntı rapor-K216-uygulama.md)

# ---- RATE_BEHAV (faiz davranışı modülü; sahip onaylı tasarım 2026-10-28): "Dünyanın insanları" katmanı, oyuncu ayarı DEĞİL ----
# Kaynaklar ve gerekçe: rapor-faiz-davranis.md. Faiz sapması gerçek dünya eşdeğerine (RB_SCALE'e bölünerek) çevrilir.
RATE_BEHAV = 0                            # 1 = hane harcama/tasarruf düzeyi gerçek mevduat faizine, firma ve ipotek kredi talebi gerçek kredi faizine duyarlı (kapsam rapor-faiz-davranis.md); 0 = kapalı (çıktı değişmez)
RB_CREDIT = 1                            # RATE_BEHAV alt bayrağı: 1 = kredi talebi (firma büyüme/yatırım/Ar-Ge, ipotek) faize duyarlı; 0 = yalnız hane harcaması. Kapalı-para modelinde düşük kredi talebi mevduatı yeniden dağıtır; toplam etkisi içsel kredi-para değişikliğinden sonra yeniden ölçülmeli
RB_SCALE = 5.0                            # oyun faizi / gerçek dünya faizi: tarafsız faiz POL_NEUT x 52 = %15,6 yıllık (gerçek nominal tarafsız ~%3), LOAN_RATE %52 (K-158 notu: gerçeğin 7-10 katı); 5 = tarafsız faiz oranı, ihtiyatlı (daha büyük ölçek duyarlılığı azaltır)
RB_START, RB_INFL_WEEKS = 26, 26             # sinyal bu haftadan başlar (açılış fiyat/faiz oturması: ilk haftalarda endeks sıçraması enflasyon sanılmasın); enflasyon = son 26 hafta sepet endeksi değişimi, yıllıklandırılmış (hane yıllık/yarıyıllık enflasyon algısı: Cavallo ve ark. 2017), ±%50 ile sınırlı
RB_ADJ = 0.1                              # sinyalin haftalık kısmi uyum hızı (yarı ömür ~6,6 hf; harcama ayrıca HAB_UP/HAB_DOWN ile yumuşar): salınımı önler
RB_GAP_MAX = 0.06                         # gerçek dünya eşdeğeri faiz sapmasının mutlak tavanı (6 puan: 2022-23 sıkılaşmasının büyüklüğü)
RB_EIS = (0.05, 0.15, 0.3)                 # gelir katmanına göre (yoksul, orta, zengin) gelirden harcamanın gerçek faiz duyarlılığı = zamanlararası ikame esnekliği (EIS): yoksul ~0 (elden ağıza, Kaplan-Violante 2014; geçim tabanı), orta 0,15 (alt uç; Havranek 2015 meta-analizi: mikro tahminlerin ortalaması 0,3-0,5, yayın yanlılığı düzeltmeli ~0,3; Best ve ark. 2020 ~0,1-0,3), zengin 0,3 (alt uç; Vissing-Jorgensen 2002: hisse sahiplerinde 0,3-0,4, en varlıklılarda ~1'e yakın; ihtiyatlı 0,5)
RB_EIS_WEALTH = (0.05, 0.1, 0.2)          # servetten harcama kısmının (WEALTH_DRAW_YEAR) faiz duyarlılığı: hafif; birikim getirisi yüksekken servet yemek yerine tutulur (Campbell-Mankiw 1989: duyarlılık düşük)
RB_F_MIN, RB_F_MAX = 0.85, 1.10           # harcama çarpanı sınırı (geçim tabanı ayrıca korunur: zorunlu sepet + kira altına inmez)
RB_LOAN_SEMI_FIRM = 2.0                   # firma kredi talebinin gerçek kredi faizine yarı-esnekliği (birim = 1,00 = 100 puan; yani puan başına -%2): yatırım kullanıcı maliyeti esnekliği -0,25...-1 (Chirinko 1993; Chirinko-Fazzari-Meyer 1999 ~-0,25), maliyet ~%12 (r+amortisman) -> puan başına %0,25-1 x 100/12 = %2-8; alt uç alındı
RB_LOAN_SEMI_HH = 2.0                     # ipotek talebinin gerçek kredi faizine yarı-esnekliği (puan başına -%2; literatür -%2...-%4, alt uç): konut kredisi hacmi faize firma kredisinden duyarlı (Best ve ark. 2020 UK; Fuster-Zafar 2021 ABD: ~ -%2...-%4 puan başına)
RB_C_MIN, RB_C_MAX_FIRM, RB_C_MAX_HH = 0.4, 1.15, 1.0   # kredi talebi çarpanı sınırı; ipotekte üst sınır 1 (CX_LTV teminat tavanı aşılmaz); firmada 1,15 (tavan/limit kuralları cx_lend'de aynen)
# ---- K-219 / K-220 (sahip kararı 2026-10-28): şehir kasası kuralı ve kâr firmada/hanede kalır (varsayılan kapalı) ----
TREASURY_RULE = 0                         # K-219: 1 = şehir kasası TR_WEEKS haftalık kendi giderini hedefler; fazlasının TR_CONV'u haftada geri harcanır (önce tahvil erken itfası, kalanı eşit üçe: hane transferi, yerel NPC hizmet alımı, belediye istihdamı). Kurtarma değildir (NO_BAILOUT değişmez; firmaya yalnız hizmet alımı karşılığı). Kaynak: arastirma-abm-karsilastirma.md 5.8; Caiani ve ark. 2016 / BeforeIT devlet bloğu (harcama gelire bağlı, birikmiş nakit yok)
TR_WEEKS = 4.0                            # K-219: kasa hedefi = bu kadar haftalık (sönümlü) kendi gideri (gerçek devletlerde nakit bakiyesi birkaç haftalık harcama; GFOA genel fon tavsiyesi >= 2 ay, bizde fon ayrı hesapta)
TR_CONV = 0.25                            # K-219: fazlanın haftalık geri harcanan payı (sahip kararı: 0,25/hf yakınsama; sert geçiş yok)
TR_START = 26                             # K-219: kural bu haftadan sonra işler (açılış geçişinde kasalar dolarken harcama başlamasın; CAPEX_START ile aynı)
TR_SPLIT = (1.0 / 3, 1.0 / 3, 1.0 / 3)    # K-219: harcama kanalı payları (hane transferi, yerel NPC hizmet alımı, belediye istihdam payı); sahip "altyapı, kamu hizmeti/istihdam, hane transferi" dedi, eşit ağırlık
TR_BOND_FIRST = 1                         # K-219: 1 = şehrin açık tahvili varsa fazla önce erken itfaya (borç, harcamadan önce) gider
PROFIT_KEEP = 0                           # K-220: 1 = NPC (ve oyuncu) firma PK_WEEKS haftalık nakit tamponu tutar; üstü kurumlar vergisi + stopaj sonrası NPC hanelerine servet payıyla temettü (şehre süpürülmez); CX_CAP_MAX kalkar; NPC kapasitesi Caiani birikim kuralıyla büyür (PK_GROW)
PK_WEEKS = 8.0                            # K-220: tampon haftaları. Caiani ve ark. 2016: sigma = 1 çeyrek (13 hf) ÜCRET bütçesi; ücret payı ~%65 => toplam gider ~8 hf. JPMorgan Chase Institute küçük işletme medyanı ~27 gün (~4 hf) alt uç
PK_DIV_EXP = 1.0                          # K-220: temettü payı = (nakit + mevduat)^bu ile orantılı (1 = servetle orantılı hisse sahipliği; 0 = kişi başı eşit)
PK_GROW = 1                               # K-220: 1 = NPC kapasite büyümesi Caiani birikim kuralıyla (g = G1 (r - rbar)/rbar + G2 (u - ubar)/ubar, çeyreklik; haftalığa /13); 0 = yalnız tavan kalkar, eski tetik (n >= 0,9 kapasite ve kasa > 2 isl. sermaye)
PK_G1, PK_G2, PK_UBAR = 0.01, 0.02, 0.8   # K-220: Caiani ve ark. 2016 (gamma1, gamma2, hedef kapasite kullanımı)
PK_RBAR_Q = 0.04345                       # K-220: Caiani hedef kâr oranı (çeyreklik); sektör ortalaması hesaplanamazsa (<= 0) kâr terimi 0 sayılır, bu değer yalnız rapor/eşik için
KK_MEAS = 0                              # K-219/K-220: 1 = bayraklar kapalıyken de kk_* ölçüm sütunları (firma boyutu dağılımı) WEEKLY_CSV'ye yazılır (davranışsız; v13.0 karşılaştırması için)
PK_RBAR_EMA = 0.05                        # K-220: sektör ortalama kâr oranı (rbar) üstel ortalaması (haftalık)
# ---- K-218 (sahip kararı 2026-10-28): kredi para yaratır (CREDIT_MONEY) ----
# Kaynaklar ve gerekçe: rapor-K218-kredi-para.md (Caiani, Godin, Caverzasi, Gallegati, Kinsella, Stiglitz 2016; BAM Engine; BeforeIT; Basel II F-IRB)
CREDIT_MONEY = 0                          # K-218: 1 = lonca kredi verirken (havuz nakdi yetmeyen kısım için) yeni Akçe basar (kredi = mevduat), anapara geri ödemesi/tasfiye geliri parayı yakar (faiz yakılmaz, loncanın gelirinde kalır); temerrüt kaybı lonca özsermayesinden düşer (kurtarma yok); sınır loncanın özsermayesi x LEV_K; 0 = kapalı (çıktı v13.0 ile bit-bit aynı)
CM_RESERVE = 0.08                         # K-218: CREDIT_MONEY açıkken karşılık oranı (mevduatın bu payı havuzda nakit kalır); DEP_RESERVE (0,20) yerine. Kaynak: Caiani 2016 likidite alt sınırı LR = %8 (Basel III LCR benzeri); araştırma raporu 5.7
CM_BRAKE = 0.10                           # K-218: toplam para stoku son 52 haftada (yıllıklandırılmış) bu oranı aşarsa yeni para basan kredi durur (güvenlik freni; mali basımın %2 tavanı MINT_YEAR ayrı kalır)
CM_BRAKE_SPAN = 52                        # K-218: fren penceresi (hafta); açılış (MINT_OPEN_WEEKS) öncesi ölçülmez; pencere 13 haftadan kısaysa fren yok
CM_BRAKE_MIN = 13                         # K-218: freni değerlendirmek için gereken en kısa pencere (hafta)
CM_PD = 1                                 # K-218: kredi rasyonlaması (Caiani tarzı): 1 = büyüme/yatırım/yenileme kredisinde tahmini temerrüt olasılığı eşiğin üstündeyse reddet
CM_PD_SIGMA = -3.17                      # K-218: PD = 1/(1+exp(OCF/borç servisi - SIGMA)). Caiani ς_c = 3,92245 kendi ölçeğine (vade 20 çeyrek, faiz %0,75/çeyrek) göre; bizde faiz ~8x, vade 60 hf: aynı YÖNTEMLE (ortalama çeyreklik PD = gözlenen temerrüt oranı %1) v13 örnekleminden (100 hf, 120 kredi sorgusu) kalibre edildi: -3,17 (rapor 3.4)
CM_LGD = 0.45                             # K-218: temerrütte kayıp oranı (teminatsız kıdemli alacak; Basel II temel IRB %45); teminatlı krediyi teminat oranı düşürür
CM_QWEEKS = 13                            # K-218: haftalık faizi çeyreğe çevirme çarpanı (PD çeyreklik tanımlı; Caiani)
CM_CSV = ""                               # K-218: ölçüm: haftalık para/kredi kaydı CSV yolu (boş = yazma; davranışsız)
# ---- PLAN-KREDI T5 (sahip kararı 2026-11-06, S3/S5): mevduat kredi verebilen loncalara gider; batık loncadan çıkış tam değerle ----
DEP_ROUTE = 1                             # 1 = yeni mevduat (ve sigorta rezervi yatırımı) kredi verebilen loncalara kaldıraç payına göre (su doldurma) gider; batık (öz kaynak < 0) loncanın hesapları her hafta DEP_RUN payına kadar tam değerle taşınır, batık hesaba yatırım yok, çekim sürer (yalnız DV_ACT açıkken etkili; credit_core.lo_classes/dep_pick, week_close.dep_flight, insurance). 0 = eski kural (en yüksek dep_ema), çıktı bayt bayt aynı
DEP_RUN = 0.25                            # DEP_ROUTE: batık loncanın hesapları her hafta (mevduat faizi ödendikten sonraki) sermaye nakdinin bu payına kadar taşınır (nakit yetmeyen lonca tam değerle ödeyemez: kademeli kaçış)
LONCA_INSOLV_CLOSE = 0                   # 1 = öz kaynağı eksi (batık) lonca, w >= OWNER_WEEK iken 12 haftalık kurala bakılmadan kapanır: bütün varlıkları (nakit, firma ve konut kredileri, tahviller) ve bütün mevduatı defter değeriyle kredi verebilen loncalara kaldıraç payı (h) oranında geçer, açık alıcı loncaların öz kaynağından düşer (LIQUIDATION/indirimli satış kullanılmaz); batık lonca tahvil havuzundan çıkar (W.lo_insolv). Kredi verebilen lonca yoksa ya da alıcıların öz kaynağı/nakdi açığa yetmezse kapanma bekler (W.lo_stat["batik_bekleme_hafta"]). 0 = eski kural, çıktı bayt bayt aynı (simkit.lonca.lonca_pa, policy.bond_hook)
# ---- PLAN-KREDI T7 (sahip kararı 2026-11-06, S7): lonca kurmak kolaylaşır ----
LONCA_EASY = 0                            # 1 = lonca kurma ve yeniden kurma eşikleri LE_* değerlerine düşer (girişimci loncası: lonca.nl_step; kapanmış yuvanın yeniden kurulması: lonca.lonca_step). Kurucunun inovatör/DAO kurucusu/medya firması sahibi olma şartı, FOUNDER_BAN ve REP_OWNER (lonca sahipliği) değişmez; medya loncası yolu (MEDIA_EASY_*; medya firması sahibi ve medya DAO kurucusu için itibar eşiği de REP_LFOUND kalır) değişmez. 0 = eski kural, çıktı bayt bayt aynı
LE_FOUND_CAP, LE_BUF = 750.0, 100.0       # LONCA_EASY: kuruluş sermayesi (yeni ve yeniden kurulan lonca; INNOV_LONCA_CAP ve LONCA_FOUND_CAP yerine); yeni lonca için ek nakit tamponu (500 yerine)
LE_REP_LFOUND, LE_REP_REFOUND = 4.0, 3.0  # LONCA_EASY: kurucu itibarı (yeni lonca; REP_LFOUND yerine) ve yeniden kurucu itibarı (REP_OWNER yerine, yalnız yeniden kurma kapısında)
LE_REFOUND = 10                           # LONCA_EASY: kapanmış yuvanın yeniden kurulma bekleme süresi, hafta (LONCA_REFOUND yerine)
LE_OWNER_MIN_WEEKS, LE_OWNER_MIN_WORKERS = 8, 2   # LONCA_EASY: inovatör firma sahibi eşiği, firma yaşı ve çalışan (FIRM_OWNER_MIN_* yerine)
LE_FOUND_MARGIN = 50.0                    # LONCA_EASY: beklenen kazanç farkı eşiği, Akçe/hafta (FOUND_MARGIN yerine)
STAFF_DEMAND = 1                          # 1 = kadro hedefi karşılanmayan talebi de görür (labor.base_need): need[p] += max(0, şehrin geçen hafta istediği − sattığı) / CYCLES_PER_WEEK × STAFF_BUFFER × STAFF_DEMAND_SHARE. Bugün hedef yalnız son satışa bağlı: satışı sıfıra inen ama talebi süren sektör kadro açmaz (eşgüdüm tuzağı). Hafta 1 açılış dalı değişmez. 0 = eski kural, çıktı bayt bayt aynı. Gerçek karşılığı: sipariş defteri
STAFF_DEMAND_SHARE = 1.0                  # STAFF_DEMAND: karşılanmayan talebin kadro hedefine giren payı
HIRE_CASH_GATE = 1                        # 1 = firma ücret ödeyecek kasası yoksa işçi almaz (labor.restaff, oyuncu işletmesi alımı, genç kit alımı): hafta > 1'de kasa >= HIRE_CASH_CYCLES x (mevcut kadronun döngü ücreti + yeni kişinin taban ücreti). Köprü kredisi bugünkü sırayla alımdan önce çekilir. 0 = eski kural, çıktı bayt bayt aynı. Gerçek karşılığı: işveren ücreti ödeyemeyecekse ilan açmaz
HIRE_CASH_CYCLES = 2                      # HIRE_CASH_GATE: kasanın karşılaması gereken ücret döngüsü sayısı
HIRE_GATE_REAL = 0                        # DAO oyunu M2.3: 1 = HIRE_CASH_GATE yeni kişinin ücretini gerçek ölçekte (TIER_WAGE[0] × şehir WI × tür çarpanı) sayar; 0 = ölçeksiz TIER_WAGE[0] (WI büyüdükçe kapı gevşer, alınan kişi aynı hafta avansı ödenemeyip çıkarılır)
HIRE_WAGE_REAL = 0                        # DAO oyunu M7: 1 = işe alınan kişi (NPC ve insan aynı kural) alım anında İLAN ÜCRETİNİ alır (wages.kadro_ucreti: kendi kademesi, şehir WI'ı, tür çarpanı KIND_WM); 0 = kişinin kayıtlı eski ücreti (işsiz ücreti: tür çarpanı yok, bir hafta önceki WI) alım haftasında kalır, gerçek ücret ertesi haftanın phase_wages'inde gelir (insanda ilan ücreti ise başvuru sonucunda). Kök neden: sermayesi hafta sonunda şehirden tamamlanan (capitalized=False) ya da köprü kredisiyle donatılan firmanın işletme sermayesi (working_capital) kadronun KAYITLI ücretiyle boyutlanır; insanın ilan ücreti (hastane, ilaç x1,5; WI) sermayeden sonra yazıldığı için iki döngülük ücret karşılanmaz, ilk avans ödenir, ikinci döngü ücret ödenmez, K-23 aynı hafta çıkarır (100 hf duman: 84 kabul, 84 ücret_odenmedi, tecrübe 17 hf). Gerçek karşılığı: işveren ilanda söylediği ücreti alıma göre sermayeye sayar, ilan ücreti ile ödenen ücret ayrışmaz
_KASA_ZAYIF = HIRE_CASH_CYCLES + 1               # DAO oyunu ilan göstergesi (davranışsız; alt çizgili: model parametresi/kayıt dışı, yalnız human.py okur): kasa / (döngülük ücret yükü + yeni kişi) bu DÖNGÜ sayısından küçükse "zayif" (işe alım kapısı HIRE_CASH_CYCLES döngü ister, +1 payla geçen kasa "orta" başlar)
_KASA_GUCLU = CYCLES_PER_WEEK                  # bu döngü sayısına eşit ya da büyükse "guclu" (bir haftalık ücret); arası "orta"
_MAAS_ODEYEMEDI_HAFTA = 4                  # DAO oyunu ilan göstergesi (davranışsız): son bu kadar haftada ücret ödeyemeyip çalışan kaybettiyse maas_odeyemedi
KR_MEAS = 0                               # 1 = davranışsız kredi/mevduat/iş piyasası ölçümü: kr_* WEEKLY_CSV sütunları (simkit/credit_meas.py), W.lab_stat (hafta içi işe alım/çıkış olayları, tür ve neden başına birikimli), W.lab_type (firma türü, kuruluşta bir kez), W.staff_tgt (firma -> haftanın hedef kadrosu). Hiçbir karara girmez; kapalıyken W'ye hiçbir şey eklenmez ve çıktı bayt bayt aynı
HUMAN_ON = 0                              # DAO oyunu (K-222): 1 = oyuncunun oynadığı insan karakteri var (simkit/human.py): HUMAN_CITY şehrinin ilk oyuncusu; kararları (mevduat, çekim, ayrılma, göç) haftanın açılışında uygulanır, kendiliğinden işletme/lonca/DAO sahibi olmaz ve şehir değiştirmez; 0 = kapalı (çıktı bayt bayt aynı)
HUMAN_CITY = 0                            # HUMAN_ON: insan karakterin başladığı şehir (şehir sırası); karakter o şehrin ilk oyuncusudur
HUMAN_REHIRE_BLOCK = 4                    # HUMAN_ON: insan işten kendi isteğiyle ayrılınca bu kadar hafta (ayrıldığı hafta dahil) aynı firmaya yeniden alınmaz

import os
import ast


def _split_top(s):
    """Virgülle ayırır ama (), [], {} içindeki virgülleri korur (tuple/dict parametre değerleri için)."""
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return out


for _kv in filter(None, _split_top(os.environ.get("MODEL_PARAMS", ""))):     # deney için: MODEL_PARAMS="PM_ADJ=0.08,FOUND_HARC=50,TIER_WAGE=(10,15,25)"
    _k, _v = _kv.split("=", 1)
    _cur = globals()[_k]
    if isinstance(_cur, (tuple, list, dict, set, frozenset)):
        globals()[_k] = type(_cur)(ast.literal_eval(_v))        # tuple/list/dict/küme parametre: Python değişmezi (ast.literal_eval)
    else:
        globals()[_k] = (_v if isinstance(_cur, str) else (type(_cur)(float(_v)) if not isinstance(_cur, bool) else bool(int(_v))))
if CAPEX_CAL:
    MACH_AL, MACH_BI, BLD_INS = MACH_AL_CAL, MACH_BI_CAL, BLD_INS_CAL
if MONEY_LOOP == 1:                              # D11 (D1): para devresi seçimi eski bayraklara aşağıdan türetilir (INCOME_KINDS ve ledger bayrağı bunlardan okur)
    TREASURY_RULE = 1
elif MONEY_LOOP == 2:
    PROFIT_KEEP = 1
if OPEN_MODE == 1:                               # D9 (A9): dengede başla: kurallar hf1'den
    NPC_GRACE = TR_START = CAPEX_START = SWEEP_FROM = 0
elif OPEN_MODE == 2:                             # D9 (A9): elle süreler
    NPC_GRACE, TR_START, CAPEX_START, SWEEP_FROM = OPEN_GRACE, OPEN_TR, OPEN_CAPEX, OPEN_SWEEP
else:                                            # kip 0: bugünkü; süpürme tamponu kurtarma süresine bağlı kalır
    SWEEP_FROM = NPC_GRACE
if POP_SCALE:                                    # D7 (E): nüfus ölçeği; geçersiz kılmadan SONRA (kullanıcının verdiği değer de ölçeklenir). Varsayılanda (kapalı) hiçbir ad değişmez
    POP_SCALE_FACTOR = (CITIES * PLAYERS_PER_CITY + NPC_X + NPC_Y * PLAYERS_PER_CITY * CITIES) / float(POP_BASE)
    TRANS_CAP = TRANS_CAP * POP_SCALE_FACTOR
    MODA_SAT = MODA_SAT * POP_SCALE_FACTOR
    NPC_RESERVE = max(1, int(round(NPC_RESERVE * POP_SCALE_FACTOR)))
    LOG_INIT_WORKERS = max(1, int(round(LOG_INIT_WORKERS * POP_SCALE_FACTOR)))
    MEDYA_STAFF = max(1, int(round(MEDYA_STAFF * POP_SCALE_FACTOR)))
    AHIR_HERD_WORKERS = max(1, int(round(AHIR_HERD_WORKERS * POP_SCALE_FACTOR)))
    HOUSE_NPC_TEN = max(1, int(round(HOUSE_NPC_TEN * POP_SCALE_FACTOR)))

REF_BASE = {}      # şablon (içe aktarma anı türetimi); koşu başına kopyası W.REF (simkit.world_init)
RECIPES = {
    "ahir": ({"sut": 20, "deri": 2, "et": 6}, {}),
    "tarla_bugday": ({"bugday": 40}, {}), "tarla_seker": ({"seker": 30}, {}), "tarla_pamuk": ({"pamuk": 40}, {}),
    "maden_silika": ({"silika": 30}, {}), "maden_aluminyum": ({"aluminyum": 10}, {}), "maden_kimyasal": ({"kimyasal": 10}, {}),
    "petrol": ({"petrol": 2}, {}), "kereste": ({"kereste": 200}, {}),
    "un": ({"un": 30}, {"bugday": 2.0}), "cam": ({"cam": 20}, {"silika": 2.0}), "plastik": ({"plastik": 60}, {"petrol": 1 / 30}),
    "tekstil": ({"tekstil": 30}, {"pamuk": 2.0}),
    "firin": ({"ekmek": 60}, {"un": 0.9}), "sise_sut": ({"sise_sut": 80}, {"sut": 0.25, "cam": 0.125}),
    "kola": ({"kola": 85}, {"seker": 5 / 17, "aluminyum": 1 / 17}), "deterjan": ({"deterjan": 40}, {"kimyasal": 0.3, "plastik": 0.1}),
    "giyim": ({"kot": 20}, {"tekstil": 1.0}), "mobilya": ({"sandalye": 10}, {"kereste": 10.0, "tekstil": 0.5}),
    "moda": ({"moda": 6}, {"tekstil": 2.0}),                                                   # K-147: tasarım ve markalı giyim (kot gibi sıradan giyimden ayrı ürün)
    "market": ({}, {}), "medya": ({}, {}), "belediye": ({}, {}), "lojistik": ({}, {}), "arge": ({}, {}),
    "yazilim": ({"yazilim": SW_SEATS}, {}),
    "guvenlik": ({"koruma": 25}, {}),                                                           # K-140: güvenlik hizmeti (çalışan başına 25 koruma birimi)
    "ulasim": ({"yolculuk": 40}, {}),                                                           # K-140: şehir içi yolculuk (toplu taşıma/taksi)
    "otel": ({"konaklama": 12}, {"ekmek": 0.4, "deterjan": 0.05}),                                # K-138: otel ve yeme-içme (oda-gece / yemek)                                                     # K-136: fiziksel girdisi yok
    "elektronik": ({"bilesen": 6}, {"silika": 0.15, "aluminyum": 0.02}),                      # K-142: elektronik bileşen (çip, ekran, pil)
    "bilgisayar": ({"bilgisayar": 0.2}, {"bilesen": 50.0, "plastik": 0.5}),                    # K-142: bilgisayar ve telefon (nihai donanım)
    "maden_komur": ({"komur": 40}, {}), "santral": ({"elektrik": 100}, {"komur": 0.05}),     # K-130: kömürden elektrik
}
if LIFE_ON and INNOV_ON:
    RECIPES.update({"maden_altin": ({"altin": 1.0}, {}), "kuyumcu": ({"mucevher": 0.5}, {"altin": 0.6}),
                    "restoran": ({"yemek": 15.0}, {"ekmek": 0.3, "sise_sut": 0.1, "deterjan": 0.01}), "eglence": ({"eglence": 8.0}, {}),
                    "insaat": ({"insaat": 2.0}, {"kereste": 20.0, "cam": 0.2})})        # K-172: yeni sektörler
if ENERGY_ON:                                                  # K-130: her üretim işyeri küçük bir elektrik girdisi kullanır (ahır, santral ve kömür hariç)
    for _k, (_o, _i) in RECIPES.items():
        if _o and _k not in ("ahir", "santral", "maden_komur", "yazilim", "guvenlik"):
            _i["elektrik"] = ENERGY_PER_WORKER / next(iter(_o.values()))
KIND_WM = {"hastane": HEALTH_WAGE_MULT, "ilac": HEALTH_WAGE_MULT, "eczane": 1.2, "okul": EDU_WAGE_MULT[0], "universite": EDU_WAGE_MULT[1]}
SVC_KINDS = (("hastane", "eczane", "ilac") if HEALTH else ()) + (("okul", "universite") if EDUCATION else ())     # K-185.12: gelirini doğrudan ödemelerden alan hizmet türleri (lojistik gibi: takas ürünü yok)
for _k in SVC_KINDS:
    RECIPES[_k] = ({}, {})
NPC_EXEMPT = NPC_EXEMPT + SVC_KINDS                         # K-185.12: sağlık ve eğitim kamu hizmeti çekirdeği (kurtarma değil, süregelen destek)
if STAPLE_CONT:                                  # DAO oyunu M4: temel sepet zincirinin NPC işletmeleri (ekmek, şişe süt, kola ve girdileri) zorunlu altyapı gibi sürer (gıda güvenliği; kurtarma değil, süregelen işletme sermayesi desteği şehir gelirinden)
    NPC_EXEMPT = NPC_EXEMPT + tuple(k_ for k_ in STAPLE_KINDS if k_ not in NPC_EXEMPT)
TOPO = ["ahir", "guvenlik", "maden_komur", "santral", "yazilim", "tarla_bugday", "tarla_seker", "tarla_pamuk", "maden_silika", "maden_aluminyum", "maden_kimyasal", "petrol",
        "plastik", "elektronik", "bilgisayar", "kereste", "un", "cam", "tekstil", "firin", "sise_sut", "kola", "deterjan", "giyim", "moda", "mobilya", "otel", "ulasim"]
if LIFE_ON and INNOV_ON:
    TOPO += ["maden_altin", "kuyumcu", "restoran", "eglence", "insaat"]
if TRANS_ON:
    for _k, (_o, _i) in RECIPES.items():
        if _o and _k not in ("ahir", "guvenlik", "yazilim", "ulasim"):
            _i["koruma"] = 1.0 / next(iter(_o.values()))                # K-140: işyeri çalışan başına bir koruma birimi (isteğe bağlı girdi: eksikse fire)
PRODUCER = {p: k for k in TOPO for p in RECIPES[k][0]}
PROD_OF = {k: next(iter(RECIPES[k][0])) for k in TOPO}      # tür -> ana ürün


def _depth(kind, RC):
    inputs = RC[kind][1]
    return 0 if not inputs else 1 + max(_depth(PRODUCER[q], RC) for q in inputs)


def _stages(TP, RC):
    return [[k for k in TP if _depth(k, RC) == dpt] for dpt in range(1 + max(_depth(k, RC) for k in TP))]


STAGES = _stages(TOPO, RECIPES)   # K-118
TOPO0 = list(TOPO)
BASKET = {"ekmek": 13, "sise_sut": 13, "kola": 13, "deterjan": 2, "et": 4, "yolculuk": 3}    # K-46 + et; ≈ ücretin %70'i (K-47)
DURABLES = ("kot", "sandalye")                                                  # K-45/K-97
COMMON = [("ahir", 6), ("market", 3), ("medya", 1), ("firin", 1), ("un", 1), ("lojistik", 1), ("santral", 1), ("guvenlik", 1), ("ulasim", 1)]
COAL_CITIES = (0, 3)                      # K-130: kömür yalnız bu şehirlerde çıkar, ötekiler kömürü (ya da elektriği) ithal eder
SPECIAL = ["tarla_bugday", "tarla_seker", "tarla_pamuk", "maden_silika", "maden_aluminyum", "maden_kimyasal", "petrol", "kereste",
           "cam", "plastik", "tekstil", "sise_sut", "kola", "deterjan", "giyim", "mobilya",
           "tarla_bugday", "sise_sut", "kola", "giyim", "tekstil", "kereste", "deterjan", "cam", "tarla_pamuk"]


def derive_prices(RECIPES, TOPO):
    """K-93: fiyat = (emek + girdi) / (1 − fee), zincir boyunca; emek = ücret × (1+marj) / çıktı hızı."""
    REF_BASE.clear()
    labor = PRICE_WAGE * (1 + PRICE_MARGIN)
    for kind in TOPO:
        outputs, inputs = RECIPES[kind]
        if kind == "ahir":
            target = labor / (1 - LONCA_FEE)
            tot = sum(AHIR_SPLIT.values())
            for p, rate in outputs.items():
                REF_BASE[p] = target * AHIR_SPLIT[p] / tot / rate
            continue
        main, rate = next(iter(outputs.items()))
        REF_BASE[main] = (labor / rate + sum(q * REF_BASE[p] for p, q in inputs.items())) / (1 - LONCA_FEE)
    REF_BASE["yazilim"] = SW_PRICE                                      # K-136: değer bazlı fiyat
    global MARKET_MARKUP0
    avg_unit = sum(q * REF_BASE[p] for p, q in BASKET.items()) / sum(BASKET.values())
    MARKET_MARKUP0 = (1 + labor / (STORE_UNITS_PER_WORKER * avg_unit)) / (1 - LONCA_FEE) * (1 + SALES_TAX)     # K-152: raf fiyatına satış vergisi (KDV) biner


derive_prices(RECIPES, TOPO)
MM_BASE0 = MARKET_MARKUP0                  # şablon; koşu başına W.MM_BASE = [MM_BASE0]
RECIPES0 = RECIPES                           # şablon tarifler (salt-okunur); koşu başına derin kopyası W.RECIPES (simkit.recipes.reset_order)
del RECIPES, TOPO, STAGES      # çalışma zamanı kopyaları World'de; tarif/sıra W.RECIPES, W.TOPO, W.STAGES


PROGRAM_INNOV = {"sermaye": (0.8 - PROG_ARGE) / 2, "reklam": (0.8 - PROG_ARGE) / 2, "kurucu_payi": 0.2, "arge": PROG_ARGE}   # K-167: DAO'lu düzende lonca programı (Ar-Ge payı sözleşme ile üye DAO'lara)
INCOME_KINDS = ("ucret", "lonca_issizlik_odenegi", "lonca_ciraklik_bursu", "issizlik_odenegi", "temettu", "ciraklik_bursu", "belediye_ucreti", "npc_kar", "mevduat_faizi", "konut_kira_geliri")
if INNOV_ON:
    INCOME_KINDS += ("arastirmaci_ucreti", "dao_payi", "kurucu_payi", "yonetici_ucreti", "uzman_ucreti")
if TREASURY_RULE or PROFIT_KEEP:
    INCOME_KINDS += ("kamu_transferi", "npc_kar_payi")       # K-219/K-220: gelir Gini'sine girer (kapalıyken tuple değişmez)
FEE_ACT = INNOV_ON and FEE_ON
PATH_ACT = INNOV_ON and PATH_ON
MGR_ACT = INNOV_ON and MGR_ON
LIFE_ACT = INNOV_ON and LIFE_ON
BUDGET_FIRST_ACT = LIFE_ACT and BUDGET_FIRST
RESALE_ACT = LIFE_ACT and RESALE_ON
ROOM_ACT = INNOV_ON and MARKET_ROOM
COST_ACT = LIFE_ACT and FEE_ON and LONCA_COST
NL_ACT = COST_ACT and INNOV_LONCA
WR_ACT = LIFE_ACT and WEALTH_REAL
WR_ACT_FLAG = WR_ACT
EQ_ACT = INNOV_ON and DAO_EQUITY and CREDIT_ON
ORG_ACT = INNOV_ON and ORG_REP
CX_ACT = CREDIT_ON and CREDIT_X and DAO_EQUITY and INNOV_ON
MO_ACT = INNOV_ON and TOUR_ON and MEDIA_OWN
DV_ACT = CREDIT_ON and DEP_ON and DEP_VAR
HI_ACT = HOUSE_ON and HOUSE_INV and CREDIT_ON and DEP_ON
FP_ACT = FIRM_PRICE
RENT_ACT = INNOV_RENT
QL_ACT = QUALITY and FIRM_PRICE
MEDIA_ACT = MEDIA_LONCA and INNOV_ON                # K-183.6: medya dalı, medya firmaları (oyuncu DAO'ları), kanallar; DAO/lonca mekanizması gerekir
if MEDIA_ACT:
    BRANCHES.append("medya")
    BRANCH["medya"] = "medya"
    ARGE_COEF["medya"] = MEDIA_COEF
    BRANCH_WEIGHT["medya"] = MEDIA_BW
DA_ACT = DIRECT_AD and ORG_ACT and FIRM_PRICE      # K-183.5: reklam yalnız kurum itibarı (ORG_REP) ve firma fiyatı/seçim mekanizması varken anlamlıdır
PRIO_RANK = {"kot": 1, "sandalye": 1, "yazilim": 2, "bilgisayar": 2, "eglence": 3, "yemek": 4, "konaklama": 5, "moda": 6, "mucevher": 7, "insaat": 8}
LOCAL_ONLY = ("yemek", "eglence", "insaat") if LIFE_ACT else ()


REV_KINDS = frozenset(("satis", "satis_yerli", "satis_sehirlerarasi", "navlun", "telif_dis", "telif_uye", "reklam", "arge_sozlesmesi", "saglik_hizmeti", "egitim_ucreti", "ilac_satisi", "belediye_ucreti", "reklam_alimi"))    # K-187: satış geliri sayılan alacaklar (rapor)


# model_mod.py'den taşındı (adım 7): hafta fazlarının (week_cycles) kullandığı salt sabit tablo
LIFE_CATNAME = {"kot": "dayanıklı", "sandalye": "dayanıklı", "moda": "moda", "bilgisayar": "donanım", "yazilim": "yazılım", "konaklama": "seyahat", "yemek": "restoran",
                "eglence": "sanat/eğlence", "mucevher": "mücevher", "insaat": "büyük konut"}
