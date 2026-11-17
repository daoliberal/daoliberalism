import type { CopyKey } from "@/oyun/copy/t";

/** "Ayrıntılar" penceresinin sekmeleri (sıra = şerit sırası). */
export const SEKMELER = [
  { id: "genel", baslik: "ayrintilar.sekme.genel" },
  { id: "piyasa", baslik: "ayrintilar.sekme.piyasa" },
  { id: "tuketim", baslik: "ayrintilar.sekme.tuketim" },
  { id: "isletmeler", baslik: "ayrintilar.sekme.isletmeler" },
  { id: "makro", baslik: "ayrintilar.sekme.makro" },
  { id: "nufus", baslik: "ayrintilar.sekme.nufus" },
  { id: "zincir", baslik: "ayrintilar.sekme.zincir" },
  { id: "olaylar", baslik: "ayrintilar.sekme.olaylar" },
  { id: "zaman", baslik: "ayrintilar.sekme.zaman" },
  { id: "kosu", baslik: "ayrintilar.sekme.kosu" },
] as const satisfies readonly { id: string; baslik: CopyKey }[];

export type SekmeKimligi = (typeof SEKMELER)[number]["id"];

/** Satırın görünmesi için koşunun içinde bulunması gereken durum (test bu durumu kurar). */
export type Kosul = "bitti" | "hesaplaniyor" | "dikis" | "hata" | "ipucu" | "kosuyok";

/**
 * Bir yüzeyin yeni ekrandaki yeri. `sekme` dolu ise yüzeye Ayrıntılar penceresinin o sekmesinden ulaşılır; `rol` + `ad` pencere içinde aranır.
 * `sekme` boş ise yüzey pencerede değil kabuktadır (`yer` nereye bağlandığını söyler) ve `rol` + `ad` pencere dışında aranır.
 * `rol: "text"` düz metindir (`getByText`). Tek kaynak: test bu tablodaki her satırı sınar.
 */
export type Yuzey = {
  yuzey: string;
  sekme: SekmeKimligi | null;
  rol: "region" | "heading" | "button" | "slider" | "text" | "tab";
  ad: CopyKey;
  param?: Record<string, string | number>;
  kosul?: Kosul;
  /** Pencere dışındaki yüzeyin bağlanacağı `OyunEkrani` yuvası (T6b): `ustOrta` zaman kontrolleri, `menu` ana menü. */
  yer?: string;
};

export const ESLEME: readonly Yuzey[] = [
  // Genel
  { yuzey: "SaglikBasligi", sekme: "genel", rol: "region", ad: "canli.saglik.baslik" },
  { yuzey: "BuHaftaSeridi", sekme: "genel", rol: "region", ad: "canli.bu_hafta" },
  { yuzey: "Gostergeler", sekme: "genel", rol: "region", ad: "canli.gostergeler" },
  // Piyasa ve iş
  { yuzey: "PiyasaPaneli", sekme: "piyasa", rol: "region", ad: "canli.gosterge.piyasa_baslik" },
  { yuzey: "IssizlikPaneli", sekme: "piyasa", rol: "region", ad: "canli.issizlik.baslik" },
  { yuzey: "IseAlimPaneli", sekme: "piyasa", rol: "region", ad: "canli.ise_alim.baslik" },
  // Tüketim
  { yuzey: "TuketimPaneli", sekme: "tuketim", rol: "region", ad: "tuketim.baslik" },
  // İşletmeler ve iş gücü
  { yuzey: "IsletmeIsgucuPaneli", sekme: "isletmeler", rol: "region", ad: "isletme.baslik" },
  // Makro göstergeler
  { yuzey: "MakroPaneli", sekme: "makro", rol: "region", ad: "makro.baslik" },
  // Nüfus ve para
  { yuzey: "NufusPaneli", sekme: "nufus", rol: "region", ad: "canli.nufus.baslik" },
  { yuzey: "ParaDagilimiPaneli", sekme: "nufus", rol: "region", ad: "canli.sahiplik.baslik" },
  { yuzey: "LoncaTablosu", sekme: "nufus", rol: "heading", ad: "canli.sahiplik.lonca.baslik" },
  { yuzey: "IsgucuAkislariPaneli", sekme: "nufus", rol: "region", ad: "canli.akis.baslik" },
  { yuzey: "DunyaKurulumuPaneli", sekme: "nufus", rol: "region", ad: "canli.kurulum.baslik" },
  // Zincir
  { yuzey: "ZincirGorunumu", sekme: "zincir", rol: "region", ad: "canli.zincir.baslik" },
  // Olaylar
  { yuzey: "OlayAkisi", sekme: "olaylar", rol: "region", ad: "canli.olay_akisi" },
  { yuzey: "NedenSonuc", sekme: "olaylar", rol: "region", ad: "canli.neden.baslik" },
  { yuzey: "NeOlmuyor", sekme: "olaylar", rol: "region", ad: "canli.neden.olmuyor_baslik" },
  // Zaman çizgisi
  { yuzey: "ZamanCizgisi", sekme: "zaman", rol: "region", ad: "canli.zaman_cizgisi" },
  { yuzey: "Dallanma", sekme: "zaman", rol: "slider", ad: "canli.zaman.hafta_etiket" },
  // Koşu ve kararlar
  { yuzey: "KararGunlugu", sekme: "kosu", rol: "heading", ad: "ustcubuk.gunluk" },
  { yuzey: "SartiDegistir", sekme: "kosu", rol: "button", ad: "degistir.dugme" },
  { yuzey: "SartOkuyucu", sekme: "kosu", rol: "button", ad: "ustcubuk.sart_dugme" },
  { yuzey: "SifirdanBaslat", sekme: "kosu", rol: "button", ad: "canli.sifirla.baslik" },
  { yuzey: "AraDurum", sekme: "kosu", rol: "button", ad: "ustcubuk.ara_durum" },
  { yuzey: "BitisKarti", sekme: "kosu", rol: "region", ad: "bitis.baslik", param: { n: 3 }, kosul: "bitti" },
  { yuzey: "HesaplaniyorBandi", sekme: "kosu", rol: "text", ad: "degistir.hesaplaniyor.live", kosul: "hesaplaniyor" },
  { yuzey: "DikisBandi", sekme: "kosu", rol: "text", ad: "degistir.dikis_live", param: { n: 2 }, kosul: "dikis" },
  { yuzey: "HataBandi", sekme: "kosu", rol: "text", ad: "hata.degisiklik_basarisiz", kosul: "hata" },
  // Pencere dışı: durum ya da olay ile açılan kabuk katmanları
  { yuzey: "SaatCubugu.atla", sekme: null, rol: "button", ad: "canli.atla", yer: "ustOrta" },
  { yuzey: "Ipucu", sekme: null, rol: "button", ad: "rehber.ipucu.tamam", kosul: "ipucu", yer: "olaylar" },
  { yuzey: "KosuYok", sekme: null, rol: "button", ad: "canli.yeni_kosu", kosul: "kosuyok", yer: "tuval" },
  { yuzey: "AyrintilarDugmesi", sekme: null, rol: "button", ad: "ayrintilar.dugme", yer: "menu" },
];

/**
 * Pencerede sekme olarak yer almayan, durum ya da olay ile açılan kabuk katmanları (kabukta kalır; her birine pencereden de bir kapı vardır):
 * - BitisDiyalogu: pencerede BitisKarti "Bitiş özetini aç" ile açılır (pencere kapanır, diyalog açılır).
 * - SifirdanBaslat: Koşu sekmesindeki "Sıfırdan başlat" ile açılır.
 * - Hesaplaniyor (ara durum): Zaman çizgisi sekmesindeki "Bu haftadan dallan" ile açılır.
 * - DurduDiyalogu ve Ipucu (rehber): ilk kritik olayda kabuk açar; pencere açıkken bekletilir.
 * - KosuYok: koşu sunucuda yoksa ekranın tamamı yerine geçer (pencere anlamsız).
 * - DunyaGorunumu: şehir ekranının kendisi (harita); Canli sayfasında kalır.
 * - Cekmece: pencere içindeki bağlantılar Cekmece'yi açar (pencere kapanır).
 */
export const KABUK_KATMANLARI = ["BitisDiyalogu", "SifirdanBaslat", "Hesaplaniyor", "DurduDiyalogu", "Ipucu", "KosuYok", "Cekmece", "DunyaGorunumu"] as const;
