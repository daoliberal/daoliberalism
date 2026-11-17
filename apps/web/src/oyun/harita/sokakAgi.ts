import { SEHIR_STILI as S } from "./haritaStili";
import type { Meydan, Parsel, Sokak } from "./tipler";
import { fnv1a } from "./yerlesim";

const SOKAK_ONBELLEGI = 24;
const ATAMA_ONBELLEGI = 96;
/** Konum yuvarlama çarpanı (0.1 birim). */
const YUVARLA = 10;

/**
 * Sokak ağı ve parsel ızgarası. Izgara kademelidir: (blok sütun, blok satır) = (4,2), (4,4), (6,4), (6,6), ...
 * (hep çift: ana cadde ortadadır). Meydan ortadaki kesişimdedir; ona değen parseller kullanılmaz.
 * Saf ve önbellekli: aynı (kademe, meydan yarıçapı) aynı nesneyi verir.
 */
export type SokakAgi = {
  kademe: number;
  genislik: number;
  yukseklik: number;
  sokaklar: readonly Sokak[];
  /** Meydanla çakışmayan parseller. Kimlik merkeze göre konumdan türer: kademe değişince aynı yer aynı kimliği korur. */
  parseller: readonly Parsel[];
  meydan: Meydan;
  sehirBinasi: { x: number; y: number };
  ahir: { x: number; y: number };
};

const blokSayisi = (kademe: number): { bx: number; by: number } => ({ bx: 4 + 2 * Math.floor(kademe / 2), by: 2 + 2 * Math.ceil(kademe / 2) });

/** Parselin ilk göründüğü kademe (merkeze göre ofsetten): iç kademeler önce dolar, ızgara büyüyünce içtekiler yerinde kalır. */
function parselKademesi(dr: number, dc: number): number {
  for (let k = 0; ; k++) {
    const { bx, by } = blokSayisi(k);
    if (dc >= (-S.blok.sutun * bx) / 2 && dc < (S.blok.sutun * bx) / 2 && dr >= (-S.blok.satir * by) / 2 && dr < (S.blok.satir * by) / 2) return k;
  }
}

const onbellek = new Map<string, SokakAgi>();

export function sokakAgi(kademe: number, meydanYaricap: number): SokakAgi {
  const anahtar = `${kademe}|${meydanYaricap}`;
  const onceki = onbellek.get(anahtar);
  if (onceki) return onceki;
  const a = kur(kademe, meydanYaricap);
  if (onbellek.size >= SOKAK_ONBELLEGI) onbellek.delete(onbellek.keys().next().value as string);
  onbellek.set(anahtar, a);
  return a;
}

function kur(kademe: number, meydanYaricap: number): SokakAgi {
  const { bx, by } = blokSayisi(kademe);
  const pw = S.parsel.genislik;
  const ph = S.parsel.yukseklik;
  const blokG = S.blok.sutun * pw;
  const blokY = S.blok.satir * ph;
  const ortaDikey = bx / 2 - 1;
  const ortaYatay = by / 2 - 1;
  const sokakG = (k: number, orta: number): number => (k === orta ? S.sokak.ana : S.sokak.ara);
  const dikeyG = Array.from({ length: bx - 1 }, (_, k) => sokakG(k, ortaDikey));
  const yatayG = Array.from({ length: by - 1 }, (_, k) => sokakG(k, ortaYatay));
  const topla = (d: number[], n: number): number => d.slice(0, n).reduce((t, v) => t + v, 0);
  const izgaraG = bx * blokG + topla(dikeyG, bx - 1);
  const izgaraY = by * blokY + topla(yatayG, by - 1);
  const x0 = S.kenar;
  const y0 = S.ustBant;
  const genislik = izgaraG + 2 * S.kenar;
  const yukseklik = izgaraY + S.ustBant + S.altBant;

  const sokaklar: Sokak[] = [];
  dikeyG.forEach((w, k) => sokaklar.push({ id: `sokak-d${k}`, ana: k === ortaDikey, yon: "dikey", x: x0 + (k + 1) * blokG + topla(dikeyG, k), y: y0, genislik: w, yukseklik: izgaraY }));
  yatayG.forEach((w, k) => sokaklar.push({ id: `sokak-y${k}`, ana: k === ortaYatay, yon: "yatay", x: x0, y: y0 + (k + 1) * blokY + topla(yatayG, k), genislik: izgaraG, yukseklik: w }));
  const dikey = sokaklar.find((s) => s.yon === "dikey" && s.ana)!;
  const yatay = sokaklar.find((s) => s.yon === "yatay" && s.ana)!;
  const meydan: Meydan = { x: dikey.x + dikey.genislik / 2, y: yatay.y + yatay.yukseklik / 2, yaricap: meydanYaricap };

  const parseller: Parsel[] = [];
  for (let r = 0; r < by * S.blok.satir; r++) {
    const bj = Math.floor(r / S.blok.satir);
    for (let c = 0; c < bx * S.blok.sutun; c++) {
      const bi = Math.floor(c / S.blok.sutun);
      const x = x0 + c * pw + topla(dikeyG, bi);
      const y = y0 + r * ph + topla(yatayG, bj);
      // En yakın nokta meydan dairesinin içindeyse parsel kullanılmaz.
      const en = { x: Math.min(Math.max(meydan.x, x), x + pw), y: Math.min(Math.max(meydan.y, y), y + ph) };
      if (Math.hypot(en.x - meydan.x, en.y - meydan.y) < meydan.yaricap) continue;
      const dr = r - (by * S.blok.satir) / 2;
      const dc = c - (bx * S.blok.sutun) / 2;
      parseller.push(Object.freeze({ id: `p${dr}_${dc}`, x: x + pw / 2, y: y + ph / 2, genislik: pw, yukseklik: ph, kademe: parselKademesi(dr, dc) }));
    }
  }
  sokaklar.forEach(Object.freeze);
  return Object.freeze({
    kademe, genislik, yukseklik, sokaklar: Object.freeze(sokaklar), parseller: Object.freeze(parseller), meydan: Object.freeze(meydan),
    sehirBinasi: Object.freeze({ x: genislik / 2, y: S.ustBant / 2 }),
    ahir: Object.freeze({ x: genislik - S.kenar - S.ahirKenarPayi, y: yukseklik - S.altBant / 2 }),
  });
}

/** `gereken` parsele yetecek en küçük kademe (ızgara büyür). */
export function izgaraSec(gereken: number, meydanYaricap: number): SokakAgi {
  for (let k = 0; ; k++) {
    const a = sokakAgi(k, meydanYaricap);
    if (a.parseller.length >= gereken) return a;
  }
}

/** Meydan halkası yuvaları: sabit sırada (iç halka önce); n yuvaya yetecek halkalar ve gereken meydan yarıçapı. */
export function halkaYuvalari(n: number): { yuvalar: { id: string; oncelik: number; dx: number; dy: number }[]; yaricap: number } {
  const yuvalar: { id: string; oncelik: number; dx: number; dy: number }[] = [];
  let r = S.meydan.ilkHalka;
  let son = r;
  for (let h = 0; yuvalar.length < n || h < S.meydan.enAzHalka; h++) {
    const say = Math.max(S.meydan.halkaEnAzYuva, Math.floor((2 * Math.PI * r) / S.meydan.halkaAralik));
    for (let i = 0; i < say; i++) {
      const aci = (2 * Math.PI * i) / say + h * S.meydan.halkaKaymasi;
      yuvalar.push({ id: `h${h}-${i}`, oncelik: h, dx: Math.round(Math.cos(aci) * r * YUVARLA) / YUVARLA, dy: Math.round(Math.sin(aci) * r * YUVARLA) / YUVARLA });
    }
    son = r;
    r += S.meydan.halkaAdimi;
  }
  return { yuvalar, yaricap: Math.max(S.meydan.yaricap, son + S.meydan.tasma) };
}

const ataOnbellek = new Map<string, ReadonlyMap<string, string>>();

export type Yuva = { id: string; oncelik: number };

/**
 * Kimlik tabanlı yuva ataması (rendezvous / HRW). Her (kimlik, yuva) çifti `fnv1a(tohum|kimlik|yuva)` skoru alır;
 * kimlikler sıralı gelir, her biri en düşük öncelikli (iç) kademede boş yuva kalan en yüksek skorlu yuvayı alır.
 * Yuva kimlikleri geometrik olarak kararlıdır ve izgara büyüyünce yalnız dış kademeye yuva eklenir; bu yüzden
 * ızgara büyümesi ya da dış yuvanın kaybı içtekileri oynatmaz. Çakışmasız durumda bir kimliğin yuvası yalnız kendi
 * kimliğine bağlıdır (gidip gelen ötekileri kaydırmaz); çakışmada yalnız o yuvayı kaybedenler taşınır.
 * Sonuç: kimlik -> yuva kimliği; önbelleklidir (aynı girdi aynı nesne).
 */
export function yuvaAta(idler: readonly string[], yuvalar: readonly Yuva[], tohum: string): ReadonlyMap<string, string> {
  const sirali = [...idler].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const anahtar = `${tohum}|${yuvalar.map((y) => `${y.id}:${y.oncelik}`).join(",")}|${sirali.join(",")}`;
  const onceki = ataOnbellek.get(anahtar);
  if (onceki) return onceki;
  if (sirali.length > yuvalar.length) throw new Error(`yuvaAta:${sirali.length}>${yuvalar.length}`);
  const kademeler = new Map<number, Yuva[]>();
  for (const y of yuvalar) kademeler.set(y.oncelik, [...(kademeler.get(y.oncelik) ?? []), y]);
  const sirasi = [...kademeler.keys()].sort((a, b) => a - b).map((k) => kademeler.get(k)!);
  const dolu = new Set<string>();
  const sonuc = new Map<string, string>();
  for (const id of sirali) {
    const bos = sirasi.map((k) => k.filter((y) => !dolu.has(y.id))).find((k) => k.length > 0)!;
    let en = bos[0];
    let enSkor = -1;
    for (const y of bos) {
      const skor = fnv1a(`${tohum}|${id}|${y.id}`);
      if (skor > enSkor || (skor === enSkor && y.id < en.id)) { en = y; enSkor = skor; }
    }
    dolu.add(en.id);
    sonuc.set(id, en.id);
  }
  if (ataOnbellek.size >= ATAMA_ONBELLEGI) ataOnbellek.delete(ataOnbellek.keys().next().value as string);
  ataOnbellek.set(anahtar, sonuc);
  return sonuc;
}

// --- İzometrik görünüm (izo) yardımcıları: klasik ızgarayı değiştirmez, aynı ızgarayı domino ve plaza olarak yorumlar ---

/** Ağın tüm hücrelerinin (`p<dr>_<dc>`) kimlikleri; meydan deliği dahil. */
function tumHucreler(kademe: number): string[] {
  const { bx, by } = blokSayisi(kademe);
  const kimlikler: string[] = [];
  for (let r = 0; r < by * S.blok.satir; r++) for (let c = 0; c < bx * S.blok.sutun; c++) kimlikler.push(`p${r - (by * S.blok.satir) / 2}_${c - (bx * S.blok.sutun) / 2}`);
  return kimlikler;
}

const delikOnbellegi = new WeakMap<SokakAgi, readonly string[]>();

/** Meydanın kestiği (parsel olarak kullanılmayan) tam hücreler: izo görünümde plaza hücreleri. */
export function meydanDeligi(ag: SokakAgi): readonly string[] {
  const onceki = delikOnbellegi.get(ag);
  if (onceki) return onceki;
  const var_ = new Set(ag.parseller.map((p) => p.id));
  const delik = Object.freeze(tumHucreler(ag.kademe).filter((id) => !var_.has(id)));
  delikOnbellegi.set(ag, delik);
  return delik;
}

const DELIK_KADEMESI = 20; // yarıçap aramasında deliğin tamamen içinde kaldığı büyük ızgara
const DELIK_ARAMA_ENCOK = 1200;
const meydanYaricapiOnbellegi = new Map<number, number>();

/**
 * İzo görünümde `loncaSayisi` lonca için meydan yarıçapı: meydan deliğindeki tam hücre >= loncaSayisi olan en küçük (tam sayı) yarıçap,
 * hiçbir zaman klasik `S.meydan.yaricap`'tan küçük değil. Delik sayısı yarıçapla monotondur, bu yüzden sonuç lonca sayısıyla monoton artar.
 */
export function izoMeydanYaricapi(loncaSayisi: number): number {
  const n = Math.max(0, Math.floor(loncaSayisi));
  const onceki = meydanYaricapiOnbellegi.get(n);
  if (onceki !== undefined) return onceki;
  const delikSayisi = (y: number): number => meydanDeligi(kur(DELIK_KADEMESI, y)).length;
  let sonuc: number = S.meydan.yaricap;
  if (delikSayisi(sonuc) < n) {
    // ikili arama: alt sınırda yetmez, üst sınırda yeter
    let alt = sonuc;
    let ust = sonuc * 2;
    while (ust < DELIK_ARAMA_ENCOK && delikSayisi(ust) < n) { alt = ust; ust *= 2; }
    ust = Math.min(ust, DELIK_ARAMA_ENCOK);
    while (ust - alt > 1) {
      const orta = Math.floor((alt + ust) / 2);
      if (delikSayisi(orta) >= n) ust = orta;
      else alt = orta;
    }
    sonuc = ust;
  }
  meydanYaricapiOnbellegi.set(n, sonuc);
  return sonuc;
}

/** Domino yuva: ana parsel (çift satır) + r+1 komşusu (aynı blokta, genişleme parseli). `kademe`: ana parselin ilk göründüğü kademe. */
export type DominoYuva = { ankraj: string; genisleme: string; kademe: number };

const dominoOnbellegi = new WeakMap<SokakAgi, readonly DominoYuva[]>();

/**
 * Izgaradaki domino yuvalar: iki hücresi de meydan dışında kalan (ana, ana+1 satır) çiftleri. Blok 2 satır olduğundan çift satırdaki parselin
 * r+1 komşusu hep aynı bloktadır (araya yol girmez). Meydan deliğine düşen yarım domino yuva değildir.
 */
export function dominoYuvalari(ag: SokakAgi): readonly DominoYuva[] {
  const onceki = dominoOnbellegi.get(ag);
  if (onceki) return onceki;
  const kume = new Map(ag.parseller.map((p) => [p.id, p]));
  const yuvalar: DominoYuva[] = [];
  for (const p of ag.parseller) {
    const m = /^p(-?\d+)_(-?\d+)$/.exec(p.id)!;
    const dr = Number(m[1]);
    if (((dr % 2) + 2) % 2 !== 0) continue;
    const genisleme = `p${dr + 1}_${m[2]}`;
    if (kume.has(genisleme)) yuvalar.push({ ankraj: p.id, genisleme, kademe: p.kademe });
  }
  const donuk = Object.freeze(yuvalar);
  dominoOnbellegi.set(ag, donuk);
  return donuk;
}

/** `gereken` domino yuvaya ve `loncaSayisi` plaza hücresine yetecek en küçük kademe (izo ızgarası büyür). */
export function izoIzgaraSec(gereken: number, loncaSayisi: number, meydanYaricap: number): SokakAgi {
  for (let k = 0; ; k++) {
    const a = sokakAgi(k, meydanYaricap);
    if (dominoYuvalari(a).length >= gereken && meydanDeligi(a).length >= loncaSayisi) return a;
  }
}
