# Bina resimlerini değiştirme

Şehir ekranı varsayılan olarak **izometrik sprite görünümüyle** açılır. Bu rehber önce o görünümü (sprite seti), sonra "Sade görünüm"ün eski SVG/PNG yolunu anlatır.

## İzometrik sprite seti (varsayılan görünüm)

Resimler `apps/web/public/oyun-sprite/` altındadır; hepsini `manifest.json` tanımlar, hangi işletme türünün hangi resmi aldığı `tur_eslemesi.md` dosyasındadır.

- **Yeni sprite eklemek:** PNG'yi uygun klasöre koy (`yalin/`, `merdiven/`, `zemin/`, `overlay/`, ...), `manifest.json` `girdiler` listesine bir kayıt ekle (`ad`, `tur`, `insanli`, `parsel_sayisi`, `oyun_turleri` ve `yalin` alt nesnesi: `dosya`, `genislik`, `yukseklik`, `ankraj`, `merkez`, `parsel_kose`, `parsel_karo`), ardından `tur_eslemesi.md` tablosuna hangi işletme türünün onu kullanacağını yaz. Örnek için `manifest.json` içindeki mevcut bir girdiyi kopyala. Oyun açılışta manifesti doğrular; bozuk kayıt görünümü bozmaz, Sade görünüme düşürür.
- **Parsel karosu ve yalın sürüm:** yayına giren bina resmi **yalın** sürümdür (yalnız bina, zemin olmadan, `yalin/<ad>_yalin.png`). Oyun onu parsel karosunun (`parsel_karosu`, 208x120 piksel) üstüne oturtur; `yalin.ankraj` binanın parseldeki alt köşesi, `yalin.parsel_kose` parselin dört köşesidir.
- **`insanli: false` şartı:** haritada insan çizilmez. İnsan içeren her sprite kaydı `"insanli": true` olmalı; oyun bu kayıtları kullanmaz. Yeni resimde insan varsa temizle ya da `true` yaz.
- **Boy varyantları:** bir bina türü 1 ile 4 arası boy alır (işletme büyüdükçe boy artar, `merdiven/` klasörü). Boy 4, **2 parsellik** (iki parseli kaplayan) yapıdır; onun `parsel_sayisi` değeri 2 olmalıdır.
- **Zemin ve yol karoları:** `zemin/` altındaki karolar (~55x32 piksel, 30 derece izometri) arsa, yol ve su kenarını döşer; yeni karo aynı ölçüde ve aynı yön sözleşmesinde (`manifest.json` > `yon_sozlesmesi`) olmalıdır.
- **İskele ve tahtalı bindirme:** `overlay/iskele_boy1..4.png` inşaat/kuruluş durumunu, `overlay/tahtali_boy1..4.png` kapanmış işletmeyi gösterir; bina resmini değiştirmeden bu iki katman üstüne biner. Boyları binayla aynı kalmalıdır.
- **Boyut sınırları:** `public/oyun-sprite/` altındaki dosyaların toplamı **5 MB'ı aşmamalı** (`spriteManifest.test.ts` > `public_oyun_sprite_5MBi_asmaz`). Ayrıca bütün setin GPU doku belleği (benzersiz dosya x genişlik x yükseklik x 4 bayt, mipmapli x4/3) `haritaStili.ts` içindeki `dokuButcesiMB` tavanını aşmamalı (`spriteDoku.test.ts` > `doku_butcesi_sinirin_altinda_gercek_set`). Yeni resim ekleyince iki testi de çalıştır; resimleri sıkıştır, gereksiz büyük çizme.
- **Sade görünüm ayarı:** **Menü** içindeki "Görünüm" düğmesi şehir görünümü ile **Sade görünüm** (eski çizim) arasında geçiş yapar. Tercih tarayıcıda saklanır. Bağlantıya `?gorunum=klasik` (Sade) ya da `?gorunum=izo` eklemek tercihi geçersiz kılar. Tarayıcıda WebGL yoksa, sprite/manifest yüklenemezse ya da hata olursa oyun kendiliğinden Sade görünüme, o da olmazsa erişilebilir şehir tablosuna düşer; tablo her zaman vardır.
- **Düşük performans** ayarı animasyonları kapatır; "Hareketi azalt" da aynısını yapar.

Eski `public/oyun-harita/sablonlar/*.svg` çizimleri Sade görünüm ve yedek zincir için olduğu gibi kalır. Aşağıdaki bölümler o yolu anlatır.

---

## Sade görünüm: bina resimlerini değiştirme

Kod yazmadan, üç adımda: resmi koy, katalogda bir satırı değiştir, önizlemede bak.

## 1. Resmi nereye koyacağım?

`apps/web/public/oyun-harita/` klasörüne. İstersen alt klasör aç (şimdiki çizimler `sablonlar/` içinde).

- Biçim: **PNG** ya da **WebP**. Arka plan **saydam** olmalı (düz beyaz ya da renkli zemin bırakma; bina zemine doğrudan oturur).
- Ad: küçük harf, boşluksuz, Türkçe harfsiz. Şablon ve boy adı iyi olur: `imalat-2.png`, `imalat-2-koyu.png`.
- Ölçü: genişlik 300 ile 600 piksel arası yeter. Büyük dosya yavaşlatır, küçük dosya bulanık görünür. Oran serbest (kare olmak zorunda değil).
- Bina resmi kendi başına eksiksiz olsun: gölge, zemin, ağaç gibi şeyleri de içine çizebilirsin.
- Haritada insan çizilmez; resimde de insan olmasın.

Şablonlar: `hammadde`, `imalat`, `hizmet`, `lojistik`, `lonca`, `sehir`, `ahir`. Boylar: 1 (en küçük) ile 4 (en büyük). Yani en çok 7 x 4 = 28 resim; istediğin kadarını değiştir, kalanlar geçici çizimle kalır.

## 2. Çapa ve taban ne demek?

Her resim için katalogda iki ölçü var.

```
   resmin sol üstü
   +--------------------+
   |                    |
   |      (bina)        |
   |                    |
   |         x <------- çapa: resmin zemine "basan" noktası
   +--------------------+
        +--------+
        | taban  |  <--- taban: binanın zeminde kapladığı alan (g = genişlik, d = derinlik)
        +--------+
```

- **Çapa** `capa: { x, y }`: resmin hangi noktası zemine konur. Resmin genişliğinin ve yüksekliğinin oranı olarak yazılır (0 ile 1). `x: 0.5` yatayda tam orta, `y: 0.9` dikeyde alta yakın (resmin %90'ı). Bina taban çizgisinin biraz altında kalıyorsa `y`'yi büyüt, havada duruyorsa küçült.
- **Taban** `taban: { g, d }`: binanın parselde kapladığı yer. Bina yerleşimi yalnız buna bakar; resmin kendisi büyük de olsa taban küçükse binalar birbirine yakın dizilir. Resmin ekrandaki genişliği taban genişliğinin 1,4 katıdır. Tabanı değiştirmek yerleşimi de değiştirir; emin değilsen elleme.

## 3. Katalogda hangi satırı değiştireceğim?

Dosya: `src/oyun/harita/binaKatalogu.ts`, içinde `VARSAYILAN_KATALOG` tablosu. Her şablon x boy için **tek bir satır** var (toplam 28). Resmi değiştireceğin satırı bul (şablon adı ve boy numarası satırın başında) ve **yalnız `dosya` ile `tur`'u** değiştir.

Önce (geçici çizim):

```ts
  imalat: {
    2: { dosya: "sablonlar/imalat-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 40, d: 32 } },
```

Sonra (kendi resmin):

```ts
  imalat: {
    2: { dosya: "imalat-2.png", tur: "resim", capa: { x: 0.5, y: 0.9 }, taban: { g: 40, d: 32 } },
```

- `dosya`: `public/oyun-harita/` altındaki yol (alt klasördeyse `bina/imalat-2.png` gibi yaz).
- `tur`: PNG/WebP için `"resim"`. Resim olduğu gibi gösterilir; renkler **sektör rengine göre boyanmaz**.
- `capa` ve `taban` satırda açıkça yazılı; ilk denemede elleme. Çapa bina zemine yanlış oturuyorsa önizlemedeki çizgilere bakıp `capa` değerini oynat. Tabanı değiştirmek yerleşimi de değiştirir.
- Koyu tema için ayrı resim istersen satırın sonuna `dosyaKoyu` ekle (virgülden önce): `taban: { g: 40, d: 32 }, dosyaKoyu: "imalat-2-koyu.png" },`. Yazmazsan koyu temada da aynı resim kullanılır.
- Resmi sonradan aynı adla değiştirirsen yalnız dosyayı üzerine yazman yeter; satır aynı kalır.

## 4. Sonucu nasıl kontrol ederim?

Tarayıcıda önizleme sayfasını aç:

- Geliştirme sunucusunda: `http://localhost:3000/oyun#/stil`
- Yayındaki sitede: `https://<site>/oyun?stil=1#/stil` (`?stil=1` olmadan sayfa kapalıdır)

Sayfada her şablon x boy için resim, dosya adı, tür, çapa ve taban görünür. Resmin üstünde çapa çizgileri (çapraz) ve taban kutusu çizilir; bina kutunun içinde, çapa da kutunun alt kenarında olmalıdır. Üstteki düğmeyle açık/koyu temayı değiştir; resmi değiştirdiysen **Yeniden yükle** düğmesine bas (tarayıcı eski resmi tutabilir). Bir kartta "Dosya yüklenemedi" yazıyorsa dosya adı ya da klasör yanlış yazılmıştır.

Haritada (şehir ekranı) görmek için oyunu aç ve bir şehre gir: önizlemedeki resim orada da aynı yoldan yüklenir.

## Zemin süsleri (ağaç, park, meydan döşemesi, çit)

Binaların dışında dört süs vardır: `agac-kumesi`, `park` (boş parsellerin bir kısmında), `meydan-dosemesi` (loncaların altında), `cit` (ahırın önünde). Süsler seçilemez ve veri katmanlarının rengine girmez. Resimle değiştirmek aynı üç adımdır, ama satır `src/oyun/harita/susKatalogu.ts` içindeki `SUS_KATALOGU` tablosundadır (`dosya`, `tur`, `capa`, `taban`). Çapa süsün **ayak izinin merkezine** konur (binalarda tabanın alt kenarına); süs resminin genişliği `taban.g` kadardır. Hangi parsellerin süs aldığı ve oranları `haritaStili.ts` içindeki `SUS_STILI` ile ayarlanır.

## Renkleri değiştirmek

Renkleri resimlere değil, tek bir dosyaya yaz: `apps/web/src/oyun/ekran/ekranRenkleri.module.css`. Orada `--harita-...` (harita) ve `--ekran-...` (arayüz) takma adları var; her biri bir renk belirtecine işaret eder, örnek:

```css
--harita-grup-imalat: var(--color-ink-2);   /* imalat binalarının ana rengi */
```

Sağdaki `var(--color-...)` kısmını başka bir belirtece değiştir. Belirteçlerin kendisi `src/styles/tokens.css` içindedir ve **kilitlidir, değiştirme**; yeni renk gerekiyorsa bana söyle. Önizleme sayfasının en altındaki "Renk takma adları" listesi her adın o an hangi renge çözüldüğünü gösterir. Katmanlı SVG çizimleri (geçici çizimler) bu takma adlarla boyanır; PNG/WebP resimler boyanmaz.
