"""simkit: kâğıt üstü oyun modeli paketi (model.py'nin modüler hali; plan v2).

Mimari: params (sabitler) -> ledger/world/world_init -> alan modülleri (L0-L6) -> week_* fazları (L6-L7) -> step (L8) -> engine (L9) -> results/report (L10-L11).
ARAYÜZ: paket; her modülün arayüzü kendi başlığındadır (ARAYÜZ/OKUR/KATMAN). Giriş: model_mod.py (ince sarmalayıcı: run, report, CLI). Davranış model.py ile bayt bayt aynıdır (tools/gate.py).

Model geçmişi (model.py başlık notları, aynen):

v12.1 (K-183, sahip kararı 2026-10-27; bayraklar FIRM_PRICE, INNOV_RENT, QUALITY, DIRECT_AD, MEDIA_LONCA; hepsi kapalıyken çıktı v12.0 ile birebir): inovasyon belirleyici; firma fiyatı ve skorla satıcı seçimi (fiyat + kalite + itibar, hane katmanına göre), geçici inovasyon rantı,
ürün kalitesi ve ucuz/pahalı strateji, doğrudan reklam, medya dalı (kanallar), medya DAO'ları ve sınırsız medya loncası.
v11.0 (K-167, sahip kararı 2026-10-27; bayrak INNOV_ON): kişi itibarı (K-11); oyuncuların %10'u inovatör; şehir başına 6 Ar-Ge DAO'su (toplam 30), kalan inovatörler araştırmacı (yüksek ücretli meslek);
DAO kendi teknoloji dalında bağımsız buluş/patent yapar (birden fazla DAO aynı dalda, her birinin kendi düzeyi); firmalar tüm lisans tekliflerine bakar, telif oranı rakip DAO'larla düşer, üyeye oran/3, patent süresi sonunda kamu malı;
lonca sahibi bir oyuncu (kurucu payı ona gider); batan DAO'nun patenti loncaya geçer. INNOV_ON=0 iken çıktı v10.5 ile birebir aynıdır.

Kâğıt üstü oyun, sürüm 7 (gece iterasyonu, GECE-GOREVI.md; değişiklik günlüğü iterasyon-gunlugu.md). Önceki sürüm 6: daoliberalism ekonomisinin deterministik hesap modeli, BEŞ ŞEHİR, KAPALI DÜNYA.

Kurallar simulasyon/00–08 ve kararlar.md'den; her parametrenin yanında karar numarası. Rastgelelik yok.
Kullanım: python3 model.py [--weeks N] [--cities N] [--ahir-kamu 0|1]

v6 (sahip kararları, 2026-10-27): dışsal dünya YOK (K-92 →): bir şehrin ithalatı başka şehrin ihracatıdır, navlunlu (K-52);
hiçbir şehir üretmiyorsa mal yoktur. Harcama = gelirin %90'ı, sepet + yerli dayanıklı (K-97). 2. haftadan firma kurma,
sermaye loncanın "sermaye" programından (K-98, K-34); kuruluş sinyali dünyadaki karşılanmayan talep (K-19).
Ahırdan gönüllü geçiş (K-81); açılış kadrosu NPC (K-77). Çıraklık ocağı varsayılan (K-95). Şehir itibarı (K-86) NPC
havuzunun şehirler arası dağılımını yönetir (K-87). Batan NPC firmayı NPC yönetici yeniden kurar; sayısı göstergedir.

v6.1: döngü içi eşleştirme sıralı değil, TAKAS: her ürün için şehir başına toplam arz ve talep; önce yerli, sonra
mesafeye göre diğer şehirler; kıtlıkta herkese orantılı paylaştırma; ödemeler sonra. Sıra ve kasa artefaktları kalkar.
"""
