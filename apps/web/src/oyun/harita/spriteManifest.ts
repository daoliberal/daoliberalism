import { sektorBilinir, sektorGrubu } from "./sektorGrubu";
import { fnv1a } from "./yerlesim";

/** Yayın klasörünün URL öneki (`apps/web/public/oyun-sprite/`). Kayıtların `dosya` alanı buna göre göreli yoldur. */
export const SPRITE_YOLU = "/oyun-sprite/";
/** `public/oyun-sprite/` toplam boyut sınırı (testle kilitli). */
export const SPRITE_BOYUT_SINIRI = 5 * 1024 * 1024;

export type SpriteKaydi = {
  ad: string;
  /** `SPRITE_YOLU` altında göreli yol (alt klasör olabilir). */
  dosya: string;
  genislik: number;
  yukseklik: number;
  /** Piksel; parselin alt köşesi (iki parselde tüm ayak izinin alt köşesi). Bindirmede kutu dışına düşebilir. */
  ankraj: { x: number; y: number };
  /** Ana parselin elmas kutusu (piksel). Parseli olmayan kayıtta sprite boyutu. */
  parsel: { genislik: number; yukseklik: number };
  kaynak: "kesim" | "uretim";
  insanli: boolean;
  oyunTurleri: string[];
  /** `hammadde|imalat|hizmet|lojistik|lonca|sehir|ahir|konut|tekil|dolgu|zemin|arac|bindirme|genel` */
  grup: string;
  boy: 1 | 2 | 3 | 4 | null;
  parselSayisi: 1 | 2;
  yalin: boolean;
  zeminTuru: string | null;
  baglanti: { K: boolean; D: boolean; G: boolean; B: boolean } | null;
  /** Yalnız araçta: ön yüzün baktığı çapraz (G = sol-aşağı, D = sağ-aşağı). */
  yon?: "G" | "D";
};

export type SpriteManifesti = {
  kayitlar: readonly SpriteKaydi[];
  /** `zeminKaro` ile aynı (eski ad). Gerçek 30 derece izometri: oran 2:1 DEĞİL. */
  karo: { genislik: number; yukseklik: number };
  /** Yapı padı karosu (sprite pikseli, ~208x120): bir parselin elmas kutusu. Bina ölçeği = oyun parsel genişliği / bu. */
  parselKaro: { genislik: number; yukseklik: number };
  /** Zemin/yol karosu (sprite pikseli, ~55x32): K5 gereği binalarla aynı faktörle ölçeklidir. */
  zeminKaro: { genislik: number; yukseklik: number };
  /** `zeminKaro.genislik / parselKaro.genislik` (~0,26): yol şeridi genişliği, parsel birimi cinsinden. Ana cadde 2 zemin karosu. */
  yolOrani: number;
};

const hata = (neden: string): Error => new Error(`spriteManifest:${neden}`);

type Ham = Record<string, unknown>;
const nesne = (v: unknown): v is Ham => typeof v === "object" && v !== null && !Array.isArray(v);
const sayi = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nokta = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && sayi(v[0]) && sayi(v[1]);

const BINA_TURLERI = new Set(["bina", "bina_merdiven"]);
const ZEMIN_TURLERI = new Set(["yol", "yol_kavsak", "yol_t", "yol_kose", "yol_sonu", "kaldirim", "cim", "cim_agacli", "bos_arsa", "dekor"]);
const YOL_SONEKI: Record<string, string> = { yol: "duz", yol_kavsak: "kavsak", yol_t: "t", yol_kose: "kose", yol_sonu: "sonu" };
const YOL_BAGLANTILI = new Set(Object.keys(YOL_SONEKI));
const ZEMIN_ADI: Record<string, string> = { kaldirim: "kaldirim", cim: "cim", cim_agacli: "agac", bos_arsa: "arsa", dekor: "dekor" };

function baglantiCoz(v: unknown): SpriteKaydi["baglanti"] {
  if (typeof v !== "string") throw hata("baglanti");
  if (!/^[KDGB]*$/.test(v)) throw hata("baglanti");
  return { K: v.includes("K"), D: v.includes("D"), G: v.includes("G"), B: v.includes("B") };
}

function zeminTuruCoz(tur: string, ad: string, g: Ham): string | null {
  if (YOL_BAGLANTILI.has(tur)) return `${g.stil === "genis" ? "yol-ana" : "yol"}-${YOL_SONEKI[tur]}`;
  if (tur in ZEMIN_ADI) return ZEMIN_ADI[tur] ?? null;
  if (tur === "serit") return ad.includes("nehir") ? "nehir" : ad.includes("park") ? "park" : null;
  if (ad === "arsa_cimen") return "cimen";
  if (ad === "arsa_otopark") return "otopark";
  return null;
}

function parselBoyutu(b: Ham, genislik: number, yukseklik: number): { genislik: number; yukseklik: number } {
  const kutu = (o: unknown): { genislik: number; yukseklik: number } | null => {
    if (!nesne(o) || !nokta(o.sol) || !nokta(o.sag) || !nokta(o.ust) || !nokta(o.alt)) return null;
    return { genislik: o.sag[0] - o.sol[0], yukseklik: o.alt[1] - o.ust[1] };
  };
  const karolar = Array.isArray(b.karolar) ? b.karolar : null;
  const sonuc = (karolar && kutu(karolar[0])) || kutu(b.parsel_kose) || kutu(b.karo);
  return sonuc && sonuc.genislik > 0 && sonuc.yukseklik > 0 ? sonuc : { genislik, yukseklik };
}

function dosyaGuvenli(d: unknown): d is string {
  return typeof d === "string" && d.length > 0 && !d.startsWith("/") && !d.split("/").includes("..") && !/^[a-z]+:/i.test(d);
}

/**
 * Yayın `manifest.json`'unu (sprite ajanının şeması, ölçekli değerlerle) `SpriteManifesti`'ne çevirir.
 * Eşleme: bina/bina_merdiven -> `yalin` bloğu; serit/arac -> `tam` bloğu; zemin ve bindirme -> kayıt kökü.
 * `insanli: true` kayıtlar ve desteklenmeyen türler (ör. 12 parsellik `blok`) süzülür. Bozukta `Error("spriteManifest:<neden>")`.
 */
export function manifestCoz(ham: unknown): SpriteManifesti {
  if (!nesne(ham)) throw hata("kok");
  const karo = nesne(ham.zemin_karosu) ? ham.zemin_karosu.piksel : null;
  if (!nokta(karo) || karo[0] <= 0 || karo[1] <= 0) throw hata("karo");
  const parselKaro = nesne(ham.parsel_karosu) ? ham.parsel_karosu.piksel : null;
  if (!nokta(parselKaro) || parselKaro[0] <= 0 || parselKaro[1] <= 0) throw hata("parsel_karo");
  if (!Array.isArray(ham.girdiler) || ham.girdiler.length === 0) throw hata("bos");

  const kayitlar: SpriteKaydi[] = [];
  for (const g of ham.girdiler) {
    if (!nesne(g)) throw hata("girdi");
    if (g.insanli === true) continue;
    const tur = g.tur;
    const ad = g.ad;
    if (typeof tur !== "string" || typeof ad !== "string" || ad === "") throw hata("ad");

    let blok: Ham | null = null;
    let yalin = false;
    if (BINA_TURLERI.has(tur)) {
      if (nesne(g.yalin)) {
        blok = g.yalin;
        yalin = true;
      } else if (nesne(g.tam)) blok = g.tam;
    } else if (tur === "serit" || tur === "arac") {
      blok = nesne(g.tam) ? g.tam : null;
    } else if (ZEMIN_TURLERI.has(tur) || tur === "iskele" || tur === "tahtali") {
      blok = g;
    } else continue; // blok vb.: bu yayında kullanılmaz
    if (!blok) throw hata("dosya");

    if (!dosyaGuvenli(blok.dosya)) throw hata("dosya");
    const { genislik, yukseklik, ankraj } = blok;
    if (!sayi(genislik) || !sayi(yukseklik) || genislik <= 0 || yukseklik <= 0) throw hata("boyut");
    if (!nokta(ankraj)) throw hata("ankraj");

    const boy = g.boy ?? null;
    if (boy !== null && boy !== 1 && boy !== 2 && boy !== 3 && boy !== 4) throw hata("boy");
    const parselSayisi = g.parsel_sayisi ?? 1; // zemin/bindirme kayıtlarında alan yok: tek parsel
    if (parselSayisi !== 1 && parselSayisi !== 2) throw hata("parsel_sayisi");

    const ham_turler = Array.isArray(g.oyun_turleri) ? g.oyun_turleri.filter((t): t is string => typeof t === "string" && !/^sektor\s+grubu:/.test(t)) : [];
    const grup = ((): string => {
      if (tur === "bina_merdiven") return typeof g.grup === "string" ? g.grup : "genel";
      if (tur === "iskele" || tur === "tahtali") return "bindirme";
      if (tur === "arac") return "arac";
      if (tur === "serit" || ZEMIN_TURLERI.has(tur)) return "zemin";
      if (ad.startsWith("arsa_")) return "dolgu";
      return ham_turler.includes("konut") ? "konut" : "tekil";
    })();
    const oyunTurleri = tur === "iskele" || tur === "tahtali" ? [tur] : grup === "sehir" ? [...ham_turler, "belediye"] : ham_turler;
    const kayit: SpriteKaydi = {
      ad,
      dosya: blok.dosya,
      genislik,
      yukseklik,
      ankraj: { x: ankraj[0], y: ankraj[1] },
      parsel: parselBoyutu(blok, genislik, yukseklik),
      kaynak: typeof g.kaynak === "string" && g.kaynak.startsWith("kesim") ? "kesim" : "uretim",
      insanli: false,
      oyunTurleri: [...new Set(oyunTurleri)],
      grup,
      boy,
      parselSayisi,
      yalin,
      zeminTuru: zeminTuruCoz(tur, ad, g),
      baglanti: YOL_BAGLANTILI.has(tur) ? baglantiCoz(g.baglanti) : null,
    };
    if (tur === "arac" && (g.yon === "G" || g.yon === "D")) kayit.yon = g.yon;
    kayitlar.push(kayit);
  }
  if (kayitlar.length === 0) throw hata("bos");
  const zeminKaro = { genislik: karo[0], yukseklik: karo[1] };
  return { kayitlar, karo: zeminKaro, zeminKaro, parselKaro: { genislik: parselKaro[0], yukseklik: parselKaro[1] }, yolOrani: karo[0] / parselKaro[0] };
}

const adSirasi = (a: SpriteKaydi, b: SpriteKaydi): number => (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0);

/**
 * Bir işletme türü + görsel boy için yalın bina sprite'ı. Aday sırası: `oyunTurleri` içinde `tur` olan boylu kayıtlar,
 * yoksa `sektorGrubu(tur)` grubu (bilinmeyen tür: `hizmet`), yoksa `genel`. Boy: tam eşleşme, yoksa en yakın küçük,
 * o da yoksa en küçük. Aynı boyda birden çok alternatif varsa `fnv1a(kimlik) % n` (ada göre sıralı).
 * Boy'suz (`boy: null`) tekil sprite'lar bu merdivene girmez: bkz. `tekilSprite`.
 */
export function turSprite(m: SpriteManifesti, tur: string, boy: 1 | 2 | 3 | 4, kimlik: string): SpriteKaydi {
  const aday = (kosul: (k: SpriteKaydi) => boolean): SpriteKaydi[] => m.kayitlar.filter((k) => k.yalin && !k.insanli && k.boy !== null && kosul(k));
  let havuz = aday((k) => k.oyunTurleri.includes(tur));
  if (havuz.length === 0) {
    const grup = sektorBilinir(tur) ? sektorGrubu(tur) : "hizmet";
    havuz = aday((k) => k.grup === grup);
  }
  if (havuz.length === 0) havuz = aday((k) => k.grup === "genel");
  if (havuz.length === 0) throw hata("aday-yok");

  const boylar = [...new Set(havuz.map((k) => k.boy as number))].sort((a, b) => a - b);
  const secilen = boylar.includes(boy) ? boy : (boylar.filter((b) => b < boy).pop() ?? boylar[0]!);
  const alternatifler = havuz.filter((k) => k.boy === secilen).sort(adSirasi);
  return alternatifler[fnv1a(kimlik) % alternatifler.length]!;
}

/** Boy'suz tekil yalın sprite (ör. tarla, değirmen, konut varyantları): `oyunTurleri` içinde `tur`, `fnv1a(kimlik)` ile seçilir; yoksa `null`. */
export function tekilSprite(m: SpriteManifesti, tur: string, kimlik: string): SpriteKaydi | null {
  const havuz = m.kayitlar.filter((k) => k.yalin && !k.insanli && k.boy === null && k.oyunTurleri.includes(tur)).sort(adSirasi);
  return havuz.length === 0 ? null : havuz[fnv1a(kimlik) % havuz.length]!;
}

/** Zemin/yol/dolgu karosu. `baglanti` verilirse K/D/G/B birebir eşleşen; yoksa ilk kayıt. Bulunamazsa `null` (çizici `Graphics`'e düşer). */
export function zeminSprite(m: SpriteManifesti, zeminTuru: string, baglanti?: { K: boolean; D: boolean; G: boolean; B: boolean }): SpriteKaydi | null {
  const adaylar = m.kayitlar.filter((k) => !k.insanli && k.zeminTuru === zeminTuru);
  if (baglanti === undefined) return adaylar[0] ?? null;
  return adaylar.find((k) => k.baglanti !== null && k.baglanti.K === baglanti.K && k.baglanti.D === baglanti.D && k.baglanti.G === baglanti.G && k.baglanti.B === baglanti.B) ?? null;
}

/** İskele/tahtalı bindirmesi. `parselSayisi` birebir eşleşir; `boy` verilmezse en büyük boy. Bulunamazsa `null`. */
export function bindirmeSprite(m: SpriteManifesti, tur: "iskele" | "tahtali", parselSayisi: 1 | 2, boy?: 1 | 2 | 3 | 4): SpriteKaydi | null {
  const adaylar = m.kayitlar
    .filter((k) => !k.insanli && k.grup === "bindirme" && k.oyunTurleri.includes(tur) && k.parselSayisi === parselSayisi && (boy === undefined || k.boy === boy))
    .sort((a, b) => (b.boy ?? 0) - (a.boy ?? 0) || adSirasi(a, b));
  return adaylar[0] ?? null;
}
