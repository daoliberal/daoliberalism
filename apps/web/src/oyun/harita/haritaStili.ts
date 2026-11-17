import type { BinaBoyu, BinaTuru, KurumTuru, Sablon, SektorGrubu, TonAdi } from "./tipler";

/**
 * Harita görünümünü değiştirmek için yalnız bu dosyayı düzenleyin.
 * Sahne (HaritaSahnesi), lejand (SehirHaritasi) ve tablo (HaritaTablosu) renk, şekil ve ölçüyü yalnız buradan alır.
 * Renkler CSS token ADIDIR (değer değil); değerler çalışma anında `getComputedStyle` ile okunur, tema değişince yeniden okunur.
 * Ölçüler dünya birimidir (1000x700 dünya, ölçek 1 iken piksel).
 *
 * Stil ilkeleri (Mini Metro / Mini Motorways'in düz anlatımından esinlendi, kopya yok):
 * 1. Şekil bir dildir: işletme kare, lonca daire, şehir ve ahır dikdörtgen. Başka bina varyantı yok.
 * 2. Renk yalnız işletmenin sektör grubunu söyler; geri kalan her şey sakin, nötr tonlarda kalır.
 * 3. Düz dolgu, yuvarlatılmış köşe, ince kenarlık, bol boşluk, gölge ve doku yok.
 * 4. Etiket hiyerarşisi: bölge adı her zaman, şehir/ahır/lonca adı her zaman, işletme adı yalnız seçiliyken ya da Ben iken.
 * 5. Seçili durum: kalın kenarlık. Ben: daha kalın `--color-cta` kenarlık ve "Senin işyerin" etiketi.
 */
export type HaritaSekli = "kare" | "daire" | "dikdortgen";

export type BinaStili = { sekil: HaritaSekli; renk: string };

export type HaritaStili = {
  /** Sahne zemini (yumuşak arka plan). */
  arkaplan: string;
  /** Dünya dikdörtgeni (haritanın kendisi). */
  dunya: { dolgu: string; kose: number };
  bolge: { dolgu: string; cerceve: string; seciliCerceve: string; kalinlik: number; seciliKalinlik: number; kose: number; etiketIc: number };
  /** Binalar arası en küçük boşluk (dünya birimi); yerleşim yarıçapı boyut/2 + bu değerdir. */
  aralik: number;
  /** İşletme ve lonca için boyut basamağı (1-4) -> piksel. */
  boyut: Record<1 | 2 | 3 | 4, number>;
  kose: { isletme: number; sehir: number; ahir: number };
  /** Şehir DAO ve ahır büyük dikdörtgenlerinin ölçüsü. */
  buyukBina: { sehir: { genislik: number; yukseklik: number }; ahir: { genislik: number; yukseklik: number } };
  /** Tür başına şekil ve renk. İşletmenin rengi sektör grubundan gelir. */
  tur: Record<Exclude<BinaTuru, "isletme" | KurumTuru>, BinaStili> & { isletme: { sekil: HaritaSekli } };
  grup: Record<SektorGrubu, { renk: string }>;
  kenarlik: { normal: number; secili: number; ben: number; renk: string; seciliRenk: string; benRenk: string };
  etiket: { aile: string; renk: string; bolgeBoyut: number; binaBoyut: number; altBoyut: number; bina: Record<BinaTuru, boolean>; yatayBosluk: number };
  /** Etiket katmanı binaların üstündedir; `olayModu: "none"` etiketin altındaki binanın tıklamasını engellemez. */
  etiketKatmani: { olayModu: "none" | "static" };
  /**
   * Yakınlaştırma düğmesi adımı (çarpan) ve tekerlek/trackpad katsayıları: çarpan = exp(-deltaPiksel x k).
   * `tekerlekK`: fare tekerleği; `kistirK`: trackpad kıstırması (ctrlKey, küçük ve sık deltalar: daha hassas); `satirPx`/`sayfaPx`: deltaMode satır/sayfa -> piksel;
   * `enFazlaDelta`: tek olayın en çok piksel deltası; `tekerlekAdimEsigi`: ctrlKey'siz piksel modunda bundan küçük |deltaY| (ya da yatay bileşen) iki parmak trackpad kaydırmasıdır.
   */
  yakinlastir: { adim: number; tekerlekK: number; kistirK: number; satirPx: number; sayfaPx: number; enFazlaDelta: number; tekerlekAdimEsigi: number };
  /** Sürükleme ile tıklamayı ayıran eşik (piksel): fare ve dokunmatik (el titremesi için daha geniş). */
  suruklemeEsigi: number;
  suruklemeEsigiDokunma: number;
  /** Tabloda bir şehir için listelenen en çok işletme düğmesi. */
  tablo: { isletmeSiniri: number };
  /** Lejand şekil kutusu (SVG görünüm kutusu, kenar uzunluğu). */
  lejand: { kutu: number; kose: number };
  /** Token okunamazsa kullanılacak değerler. */
  yedek: { renk: string; aile: string };
};

export const HARITA_STILI: HaritaStili = {
  arkaplan: "--color-bg",
  dunya: { dolgu: "--color-surface-muted", kose: 20 },
  bolge: { dolgu: "--color-surface", cerceve: "--color-line", seciliCerceve: "--color-brand-strong", kalinlik: 1, seciliKalinlik: 3, kose: 14, etiketIc: 14 },
  aralik: 1,
  boyut: { 1: 12, 2: 18, 3: 26, 4: 36 },
  kose: { isletme: 4, sehir: 8, ahir: 8 },
  buyukBina: { sehir: { genislik: 64, yukseklik: 36 }, ahir: { genislik: 96, yukseklik: 30 } },
  tur: {
    isletme: { sekil: "kare" },
    lonca: { sekil: "daire", renk: "--color-warn-dot" },
    sehir: { sekil: "dikdortgen", renk: "--color-ink-2" },
    ahir: { sekil: "dikdortgen", renk: "--color-line-strong" },
  },
  grup: {
    hammadde: { renk: "--color-caution-accent" },
    imalat: { renk: "--color-brand" },
    hizmet: { renk: "--color-panel-accent" },
    lojistik: { renk: "--color-slate" },
  },
  kenarlik: { normal: 1, secili: 3, ben: 5, renk: "--color-surface", seciliRenk: "--color-brand-strong", benRenk: "--color-cta" },
  etiket: {
    aile: "--font-body", renk: "--color-ink-3", bolgeBoyut: 14, binaBoyut: 12, altBoyut: 11,
    bina: { isletme: false, lonca: false, sehir: true, ahir: true, liman: true, ihracat: true }, yatayBosluk: 8,
  },
  etiketKatmani: { olayModu: "none" },
  yakinlastir: { adim: 1.25, tekerlekK: 0.0015, kistirK: 0.01, satirPx: 16, sayfaPx: 400, enFazlaDelta: 300, tekerlekAdimEsigi: 50 },
  suruklemeEsigi: 4,
  suruklemeEsigiDokunma: 10,
  tablo: { isletmeSiniri: 40 },
  lejand: { kutu: 14, kose: 3 },
  yedek: { renk: "#808080", aile: "sans-serif" },
};

/** Bir binanın şekli ve rengi (işletme: sektör grubu rengi). Şekil yalnız burada tutulur (veri katmanında yok). */
export function binaStili(tur: BinaTuru, grup: SektorGrubu | undefined): BinaStili {
  if (tur === "isletme") return { sekil: HARITA_STILI.tur.isletme.sekil, renk: HARITA_STILI.grup[grup ?? "hizmet"].renk };
  if (tur === "liman" || tur === "ihracat") return HARITA_STILI.tur.sehir;      // kurumlar klasik sahnede çizilmez; yalnız tür güvenliği için şehir stili
  return HARITA_STILI.tur[tur];
}

/** Çalışan sayısından bina boyu: 1-7, 8-19, 20-49, 50+ (alt sınırlar). */
export const BOY_ESIKLERI: readonly [number, number, number] = [8, 20, 50];
export function boyOf(isci: number | null | undefined): BinaBoyu {
  const n = isci ?? 0;
  return n >= BOY_ESIKLERI[2] ? 4 : n >= BOY_ESIKLERI[1] ? 3 : n >= BOY_ESIKLERI[0] ? 2 : 1;
}

/**
 * Tek şehir ekranının ölçüleri (sahne birimi). Blok = parsel sütun x satır; sokaklar blokların arasındadır.
 * Ana cadde ortadaki yatay ve dikey sokaktır, meydan kesişimde durur. Belediye üst bantta, ahır alt bantta (parsel almazlar).
 */
export const SEHIR_STILI = {
  parsel: { genislik: 64, yukseklik: 56 },
  blok: { sutun: 3, satir: 2 },
  sokak: { ana: 24, ara: 14 },
  kenar: 60,
  ustBant: 100,
  altBant: 90,
  /** Meydan en az bu yarıçaptadır; lonca halkaları sığmazsa büyür. */
  meydan: { yaricap: 92, ilkHalka: 36, halkaAdimi: 34, halkaAralik: 36, tasma: 24, halkaEnAzYuva: 3, enAzHalka: 2, halkaKaymasi: 0.4 },
  /** Belediye ve ahır sabit yerleri: ahır alt bandın sağ kenarında. */
  ahirKenarPayi: 20,
  /** Binalara bırakılan en az boş parsel çarpanı: gereken parsel = ceil(işletme x bu). */
  bosluk: 1.25,
} as const;

/**
 * Zemin süsleri yerleşimi (sahne birimi ve oranlar). Süsler seçilemez, katman tonuna girmez; konumları kimlikten türer (deterministik).
 * Boş parsellerin `bosOran`ı süs alır; bunların `parkOrani` kadarı park, kalanı ağaç kümesi. Meydan döşemesi meydanın altında
 * (kenar = yarıçap x `meydanKenar`), ahır çiti ahırın önünde (`citBosluk`: çizim ayak izinin altına taşar, çit onun da altında kalsın).
 */
export const SUS_STILI = {
  bosOran: 0.4,
  parkOrani: 0.3,
  meydanKenar: 1.5,
  citBosluk: 30,
} as const;

/** Veri katmanları: ton takma adı -> `--harita-*` takma adı (ekran/ekranRenkleri.module.css) ve eşikler. Ton adları `tipler.TonAdi`. */
export const KATMAN_STILI = {
  /** Talep karşılama = 1 - shortage; >= iyi eşiği "iyi", >= orta eşiği "orta", altı "dar". */
  talep: { iyi: 0.9, orta: 0.7 },
  /** 4 haftalık fiyat değişimi (oran): <= düşen eşiği "dusen", >= artan eşiği "artan", arası "yatay". */
  fiyat: { dusen: -0.05, artan: 0.05, hafta: 4 },
  ton: {
    iyi: "--harita-ton-iyi", orta: "--harita-ton-orta", dar: "--harita-ton-dar",
    dusen: "--harita-ton-dusen", yatay: "--harita-ton-yatay", artan: "--harita-ton-artan",
  } satisfies Record<TonAdi, string>,
} as const;

/** Tek şehir çiziminin renk takma adları (`ekran/ekranRenkleri.module.css`, `.kok` öğesinin computed stilinden okunur). */
export const SEHIR_RENGI = {
  zemin: "--harita-zemin", sokak: "--harita-sokak", sokakAna: "--harita-sokak-ana", parsel: "--harita-parsel", meydan: "--harita-meydan",
  etiket: "--harita-etiket", secili: "--harita-secili", ben: "--harita-ben", ilan: "--harita-ilan", rozet: "--harita-rozet", rozetYazi: "--harita-rozet-yazi",
  ipucuZemin: "--harita-ipucu-zemin", ipucuYazi: "--harita-ipucu-yazi", ipucuCerceve: "--harita-ipucu-cerceve",
  /** Çizgi ailesi (etiket yazı tipi) `.kok` üzerinden miras alınır; okunamazsa yedek kullanılır. */
  yazi: "--font-body",
} as const;

/** SVG katman adı -> renk kuralı. `grup`: şablonun ana rengi (işletme: sektör grubu, diğerleri kendi takma adı); `karisim`: ana renge katılan renk ve oran. */
export type KatmanKurali = { renk: string; karisim?: { ile: string; oran: number }; cizgisiz?: true };
export const SVG_KATMANLARI: Record<string, KatmanKurali> = {
  duvar: { renk: "grup" },
  duvar2: { renk: "grup", karisim: { ile: "--harita-golge", oran: 0.16 } },
  cati: { renk: "grup", karisim: { ile: "--harita-golge", oran: 0.3 } },
  cati2: { renk: "grup", karisim: { ile: "--harita-isik", oran: 0.22 } },
  pencere: { renk: "--harita-pencere" },
  kapi: { renk: "--harita-kapi" },
  ayrinti: { renk: "--harita-ayrinti" },
  ayrinti2: { renk: "--harita-vurgu" },
  metal: { renk: "--harita-metal" },
  cit: { renk: "--harita-metal" },
  saman: { renk: "--harita-saman" },
  agac: { renk: "--harita-agac" },
  "agac-isik": { renk: "--harita-agac", karisim: { ile: "--harita-isik", oran: 0.3 }, cizgisiz: true },
  govde: { renk: "--harita-govde" },
  cim: { renk: "--harita-cim" },
  yol: { renk: "--harita-yol", cizgisiz: true },
  duman: { renk: "--harita-duman", cizgisiz: true },
};
/** Şablon -> ana renk takma adı (işletme şablonları sektör grubu rengidir). */
export const SABLON_RENGI: Record<Sablon, string> = {
  hammadde: "--harita-grup-hammadde", imalat: "--harita-grup-imalat", hizmet: "--harita-grup-hizmet", lojistik: "--harita-grup-lojistik",
  lonca: "--harita-grup-lonca", sehir: "--harita-grup-sehir", ahir: "--harita-grup-ahir",
};

/** Varlık yükleme ve çizim ölçüleri. */
export const VARLIK_STILI = {
  /** Varlıkların sunulduğu yol (public/oyun-harita). */
  kok: "/oyun-harita/",
  /** Doku çözünürlüğü (2-3): svg bu çarpanla rasterlanır. */
  cozunurluk: 2,
  /** Süs çizimlerinde kullanılmayan "ana renk" yerine geçen takma ad (süslerde `grup` katmanı yok). */
  susAnaRenk: "--harita-parsel",
  /** Konturu çizilen katmanlarda çizgi kalınlığı (svg birimi). */
  konturKalinligi: 0.9,
  /** Bina çiziminin genişliği = ayak izi genişliği x bu çarpan (yükseklik dokunun oranından). */
  genislikCarpani: 1.4,
  /** Ton/seçili/ben tabanı: ayak izinin her yana taşma payı ve köşe yuvarlaklığı. */
  taban: { pay: 4, kose: 6, seciliKalinlik: 3, benKalinlik: 5, ilanKalinlik: 2, ilanDolgu: 0.3 },
  /** Rozet (işsiz sayısı) kapsülü. */
  rozet: { yaricap: 12, yaziBoyut: 12, yBosluk: 8 },
  /** Seçili binanın serbest alanın kenarından en az bu kadar (ekran pikseli) içeride kalması için kamera payı. */
  seciliPay: 24,
  /** Etiket yazısı ölçüleri (ekranda sabit boyut). */
  etiket: { boyut: 12, sehirBoyut: 14, bosluk: 8 },
} as const;

/**
 * İzometrik şehir görünümü iskeleti (saf geometri + büyüme ayarları). Sonraki görevler alan ekler.
 * karo: elmas hücrenin piksel ölçüsü (sprite setinin gerçek 30° izometrisi, 2:1 değil). kenarHucre: ızgara dışı boş hücre payı. pad: sınır kutusu kenar payı.
 */
export const IZO_STILI = {
  karo: { genislik: 104, yukseklik: 60 },
  kenarHucre: 1,
  pad: 48,
  /** Çerçeve karolarının yüzde kaçı ağaçlı. */
  agacOrani: 38,
  /** Boş parsel dolgusu (K6): işletmesiz blokta (dış halka) yüzde kaçı konut, kalanı park. İşletmeli bloktaki boş parsel arsa. */
  dolgu: { konutOrani: 70 },
  /** Şerit sprite'ı yokken yedek ölçü (parsel birimi): uzunluk x genişlik. */
  seritYedek: { uzunluk: 3.6, genislik: 0.8 },
  buyume: { histerezisHafta: 3, bindirmeMs: 2500 },
  /**
   * Görsel durum tablosu (`durumGorunumu`): bina sprite'ının `alfa`'sı, çarpma `tint`'i (gri/soluk; sprite başına filtre YOK, batching korunur) ve
   * hangi öğelerin çizileceği. `tint` bir tema rengi değil nötr bir çarpandır (0xffffff = değişmez); iskele/tahta/duman/ışık yedek renkleri `IZO_RENGI`'dedir.
   */
  durum: {
    uretim: { alfa: 1, tint: null, tahta: false, iskele: false, duman: true, isik: true },
    zayif: { alfa: 0.9, tint: null, tahta: false, iskele: false, duman: false, isik: false },
    issiz: { alfa: 1, tint: null, tahta: false, iskele: false, duman: false, isik: false },
    kapali: { alfa: 0.55, tint: 0x8c8c8c, tahta: true, iskele: false, duman: false, isik: false },
    kuruluyor: { alfa: 0.85, tint: null, tahta: false, iskele: true, duman: false, isik: false },
    canlandi: { alfa: 1, tint: null, tahta: false, iskele: false, duman: false, isik: true },
  },
  /** Bacası olan işletme türleri (üretimdeyken duman tüter); diğer türlerde duman çizilmez. */
  dumanTurleri: ["maden_komur", "maden_altin", "maden_aluminyum", "maden_kimyasal", "maden_silika", "santral", "petrol", "cam", "plastik", "deterjan", "tekstil", "kereste", "un"],
  /** Animasyon: aynı anda en çok bu kadar binada duman; ticker `maxFps`; duman döngüsü, parlama halkası ve ışık yumuşatma süreleri (ms). */
  animasyon: { enCok: 24, isikEnCok: 60, maxFps: 30, dumanMs: 3600, parlamaMs: 1400 },
  /** Işık/duman/parlama/yedek bindirme görsel sabitleri (sprite ölçeği `olcek` ile çarpılır; konumlar sprite ankraj yüksekliğinin oranı). */
  efekt: {
    isik: { yaricap: 6, enAz: 2, alfa: 0.9, yukseklik: 0.35 },
    duman: { yaricap: 7, enAz: 2, alfa: 0.6, yukseklik: 0.85, yatay: 10, yukselme: 60, adet: 3, olcekBaslangic: 0.6 },
    parlama: { cizgi: 3, olcekBaslangic: 0.3, egim: 0.55 },
    yedek: { yukseklik: 0.8, direk: 3, cita: 3, tahtaOran: 0.08 },
  },
  gecis: { enCok: 12 },
  /**
   * Hafta geçişi olay balonları (Görev 18): aynı anda en çok `enCok`; ömür (ms) normalde `omurMs`, oyuncunun kendi olayında `benOmurMs`, azaltılmış harekette `azaltMs` (animasyonsuz, statik).
   * Boyutlar ekran pikselidir (kamera yakınlaşmasından bağımsız); `yukselme` süresince hafif yükselir, son `solmaMs`'de silinir; çakışan balonlar `aralik` ile üst üste dizilir.
   */
  balon: { enCok: 3, omurMs: 3500, benOmurMs: 5500, azaltMs: 1500, solmaMs: 500, yukselme: 14, yaziBoyut: 12, yanBosluk: 8, dikeyBosluk: 5, aralik: 4, ustBosluk: 6 },
  /** Ekran dışı bina elemesi: görünür kutu her yana bu oranda (kutu boyutuna göre) genişletilerek hesaplanır; kamera bu pay içinde kaldıkça yeniden hesap yapılmaz. */
  gorunurluk: { pay: 0.35 },
  /** Katman tonu plakası (bina tabanındaki elmas): dolgu saydamlığı. Seçili, ben ve ilan çizgileri/dolguları klasikle aynı kalınlıktadır. */
  plaka: { alfa: 0.55, ilanDolgu: 0.3, ilanKalinlik: 2, seciliKalinlik: 3, benKalinlik: 5 },
  /** Etkileşim: hover parlaması, seçimde halka belirmesi, Ben halkası nabzı (ms) ve ipucu kutusu (Pixi sahnesinde imleci izler; `genislik`/`yukseklik` ölçülemezse yaklaşık ölçü, `bosluk` imleçten uzaklık, diğerleri ekran pikseli). */
  etkilesim: { hoverAlfa: 0.22, hoverRenk: 0xffffff, secimMs: 180, nabizMs: 1600, nabizEnAz: 0.35, nabizEk: 4 },
  ipucu: { genislik: 220, yukseklik: 72, bosluk: 12, yaziBoyut: 13, yanBosluk: 12, dikeyBosluk: 8, satirAralik: 4, kose: 12, cerceve: 1 },
  /** Bina tıklama alanı: üst saydam köşeler bu oranda (gövde genişliğinin) çapraz kesilir. */
  vurus: { kesik: 0.25 },
  /**
   * Performans ve bellek bütçesi (Görev 14). `dprUst`: izo tuvalinin en çok bu çözünürlükte (DPR) çizilmesi (3x ekranda dolgu hızı 2.25 kat düşer).
   * `mipmap`: sprite dokuları ekranda ~3-4x küçültülerek (yayın ölçeği x kamera uzaklaştırması) çizildiğinden yüklemede mipmap üretilir; kaynak PNG'ler
   * zaten oyun ölçeğine indirilmiş (en büyüğü 460x270; tek parça büyük blok PNG'si yok), bu yüzden yeniden örnekleme yerine mipmap yeterli.
   * `dokuButcesiMB`: bütün sprite setinin (benzersiz dosya x genişlik x yükseklik x 4 bayt, mipmapli x4/3) GPU doku belleği tavanı; ölçülen 15,4 MB (125 dosya, ham 11,5 MB), ~%30 pay bırakılmış.
   * `gorunenSpriteButcesi`: okunur yakınlıkta (olcek 1) kapsama kutusu içinde (ekran + her yana pay) aynı anda çizilmesine izin verilen en çok sprite (ölçülen 300 işletmede 2366).
   * `toplamSpriteButcesi`: bütün şehir tek ekrana sığdırılınca (hiçbir şey elenmez) en çok sprite (ölçülen 300 işletmede 8761; önceki düzen 28 921).
   * `pisirmeCozunurlugu`: parsel zemini dokusunun (16 kaldırım karosunun tek dokuya pişirilmesi) en az çözünürlüğü; yakınlaştırmada keskin kalsın.
   */
  performans: { dprUst: 2, mipmap: true, dokuButcesiMB: 20, gorunenSpriteButcesi: 4000, toplamSpriteButcesi: 10_000, pisirmeCozunurlugu: 2 },
} as const;

/** Tuval çözünürlüğü: izo modunda `devicePixelRatio` `performans.dprUst` ile sınırlanır; geçersiz değer 1 sayılır. */
export function izoCozunurluk(dpr: number, izo: boolean): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return izo ? Math.min(d, IZO_STILI.performans.dprUst) : d;
}

/** İzometrik çizimin renk takma adları (`ekran/ekranRenkleri.module.css`); yedek (sprite yok) zemin, seçim, ben, tahta/iskele/duman ve ton plakaları. */
export const IZO_RENGI = {
  cim: "--harita-izo-cim", asfalt: "--harita-izo-asfalt", nehir: "--harita-izo-nehir", secili: "--harita-izo-secili", ben: "--harita-izo-ben",
  tahta: "--harita-izo-tahta", iskele: "--harita-izo-iskele", duman: "--harita-izo-duman", isik: "--harita-izo-isik", isikSicak: "--harita-izo-isik-sicak",
  ton: {
    iyi: "--harita-izo-ton-iyi", orta: "--harita-izo-ton-orta", dar: "--harita-izo-ton-dar",
    dusen: "--harita-izo-ton-dusen", yatay: "--harita-izo-ton-yatay", artan: "--harita-izo-ton-artan",
  } satisfies Record<TonAdi, string>,
} as const;
