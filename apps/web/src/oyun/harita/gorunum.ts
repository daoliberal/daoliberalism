import { HARITA_STILI } from "./haritaStili";
import { DUNYA, type Gorunum } from "./tipler";

export const DUNYA_GENISLIK = DUNYA.genislik;
export const DUNYA_YUKSEKLIK = DUNYA.yukseklik;
export const OLCEK_EN_AZ = 0.5;
export const OLCEK_EN_COK = 4;
/** Odak komutunda ölçek: tüm şehri sığdıran ölçeğin bu kat fazlası. */
export const ODAK_CARPANI = 1.8;

export type Kutu = { genislik: number; yukseklik: number };
const VARSAYILAN_KUTU: Kutu = { genislik: DUNYA_GENISLIK, yukseklik: DUNYA_YUKSEKLIK };

const sigdirOlcegi = (k: Kutu, d: Kutu): number => Math.min(k.genislik / d.genislik, k.yukseklik / d.yukseklik);
/** Alt sınır 0.5'tir; harita bundan küçük bir kutuya sığıyorsa "sığdır" ölçeği alt sınır olur (yoksa sığdır ulaşılamaz kalırdı). */
const enAz = (k: Kutu, d: Kutu): number => Math.min(OLCEK_EN_AZ, sigdirOlcegi(k, d));
const kenetle = (olcek: number, k: Kutu, d: Kutu): number => Math.min(OLCEK_EN_COK, Math.max(enAz(k, d), olcek));

/** Haritayı kutudan taşırmaz: harita kutudan büyükse kutuyu doldurur, küçükse içinde kalır. */
function sinirla(g: Gorunum, k: Kutu, d: Kutu): Gorunum {
  const eksen = (konum: number, harita: number, kutu: number): number => {
    const a = kutu - harita;
    return Math.min(Math.max(a, 0), Math.max(Math.min(a, 0), konum));
  };
  return {
    x: eksen(g.x, d.genislik * g.olcek, k.genislik),
    y: eksen(g.y, d.yukseklik * g.olcek, k.yukseklik),
    olcek: g.olcek,
  };
}

/** `nokta` kutu (ekran) koordinatıdır; ölçek sınırlarda kenetlenmedikçe o noktanın altındaki dünya noktası sabit kalır. */
export function yakinlastir(g: Gorunum, nokta: { x: number; y: number }, carpan: number, kutu: Kutu = VARSAYILAN_KUTU, dunya: Kutu = VARSAYILAN_KUTU): Gorunum {
  const olcek = kenetle(g.olcek * carpan, kutu, dunya);
  const dx = (nokta.x - g.x) / g.olcek;
  const dy = (nokta.y - g.y) / g.olcek;
  return sinirla({ x: nokta.x - dx * olcek, y: nokta.y - dy * olcek, olcek }, kutu, dunya);
}

export function kaydir(g: Gorunum, dx: number, dy: number, kutu: Kutu = VARSAYILAN_KUTU, dunya: Kutu = VARSAYILAN_KUTU): Gorunum {
  return sinirla({ x: g.x + dx, y: g.y + dy, olcek: kenetle(g.olcek, kutu, dunya) }, kutu, dunya);
}

export type Nokta = { x: number; y: number };

/**
 * İki parmakla yakınlaştırma: `onceki`/`simdi` iki işaretçinin kutu (ekran) konumudur. Önceki orta noktanın altındaki dünya noktası şimdiki orta
 * noktaya gelir (orta nokta kayması kaydırmayı da uygular); ölçek parmak açıklığı oranıyla çarpılır, sınırlarda kenetlenir ve harita kutudan taşmaz.
 */
export function kistir(g: Gorunum, onceki: { a: Nokta; b: Nokta }, simdi: { a: Nokta; b: Nokta }, kutu: Kutu = VARSAYILAN_KUTU, dunya: Kutu = VARSAYILAN_KUTU): Gorunum {
  const d0 = Math.hypot(onceki.a.x - onceki.b.x, onceki.a.y - onceki.b.y);
  const d1 = Math.hypot(simdi.a.x - simdi.b.x, simdi.a.y - simdi.b.y);
  const oran = d0 > 1e-6 && Number.isFinite(d1 / d0) ? d1 / d0 : 1;
  const olcek = kenetle(g.olcek * oran, kutu, dunya);
  const m0 = { x: (onceki.a.x + onceki.b.x) / 2, y: (onceki.a.y + onceki.b.y) / 2 };
  const m1 = { x: (simdi.a.x + simdi.b.x) / 2, y: (simdi.a.y + simdi.b.y) / 2 };
  const dx = (m0.x - g.x) / g.olcek;
  const dy = (m0.y - g.y) / g.olcek;
  return sinirla({ x: m1.x - dx * olcek, y: m1.y - dy * olcek, olcek }, kutu, dunya);
}

/** Kutunun kenarlarında yüzen öğelerin kapladığı yer (ekran pikseli): sığdırma bu payların içindeki alana yapılır. */
export type Pay = { ust: number; alt: number; sol: number; sag: number };
export const PAYSIZ: Pay = { ust: 0, alt: 0, sol: 0, sag: 0 };

/**
 * Dünyayı (varsayılan 1000x700; tek şehirde sahnenin ölçüsü) verilen kutuya orantıyla sığdırır ve ortalar. `g` yalnız imza uyumu içindir: sığdırma görünümden bağımsızdır.
 * `pay` verilirse (oyun kabuğunda üst şerit, alt şerit gibi yüzen öğeler) dünya kutunun payların dışında kalan alanına sığdırılıp orada ortalanır.
 */
export function sigdir(_g: Gorunum, genislik: number, yukseklik: number, dunya: Kutu = VARSAYILAN_KUTU, pay: Pay = PAYSIZ): Gorunum {
  const ic = { genislik: Math.max(1, genislik - pay.sol - pay.sag), yukseklik: Math.max(1, yukseklik - pay.ust - pay.alt) };
  const olcek = Math.min(OLCEK_EN_COK, sigdirOlcegi(ic, dunya));
  return { x: pay.sol + (ic.genislik - dunya.genislik * olcek) / 2, y: pay.ust + (ic.yukseklik - dunya.yukseklik * olcek) / 2, olcek };
}

/**
 * `hedef` (dünya koordinatı) payların dışında kalan serbest alanın ortasına gelir; ölçek tüm şehri sığdıran ölçeğin `carpan` katıdır
 * (üst sınır `OLCEK_EN_COK`). Kenar sınırı uygulanmaz: köşedeki hedef de tam ortalanır (seçili bina kaydırması gibi).
 */
export function odakla(hedef: { x: number; y: number }, genislik: number, yukseklik: number, dunya: Kutu = VARSAYILAN_KUTU, pay: Pay = PAYSIZ, carpan: number = ODAK_CARPANI): Gorunum {
  const ic = { genislik: Math.max(1, genislik - pay.sol - pay.sag), yukseklik: Math.max(1, yukseklik - pay.ust - pay.alt) };
  const olcek = Math.min(OLCEK_EN_COK, sigdirOlcegi(ic, dunya) * carpan);
  return { x: pay.sol + ic.genislik / 2 - hedef.x * olcek, y: pay.ust + ic.yukseklik / 2 - hedef.y * olcek, olcek };
}

export type TekerlekGirdisi = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean };
export type TekerlekEylemi = { tur: "yakin"; carpan: number } | { tur: "kaydir"; dx: number; dy: number };

/**
 * Tekerlek olayını eyleme çevirir. ctrlKey (trackpad kıstırması): ince katsayıyla üstel yakınlaştırma. Satır/sayfa modu ya da büyük adımlı (|deltaY| >= eşik) ve
 * yatay bileşeni olmayan piksel deltası fare tekerleğidir: üstel yakınlaştırma. Kalanı (küçük, sürekli, çoğu zaman yatay bileşenli) ctrlKey'siz iki parmak
 * trackpad kaydırmasıdır: harita kayar, yakınlaşmaz.
 */
export function tekerlekEylemi(e: TekerlekGirdisi): TekerlekEylemi {
  const Y = HARITA_STILI.yakinlastir;
  const px = (v: number): number => (e.deltaMode === 1 ? v * Y.satirPx : e.deltaMode === 2 ? v * Y.sayfaPx : v);
  const dy = px(e.deltaY);
  const sinirli = Math.max(-Y.enFazlaDelta, Math.min(Y.enFazlaDelta, dy));
  if (e.ctrlKey) return { tur: "yakin", carpan: Math.exp(-sinirli * Y.kistirK) };
  const fare = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(dy) >= Y.tekerlekAdimEsigi);
  if (fare) return { tur: "yakin", carpan: Math.exp(-sinirli * Y.tekerlekK) };
  return { tur: "kaydir", dx: -px(e.deltaX), dy: -dy };
}
