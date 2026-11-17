import type { Registry, UIValue, ValuesPatch } from "./types";

/**
 * Faiz kuralı hesabı: modelin politika faizi hedefi (`simkit/policy.py` `pol_step`), arayüzde "hedef faiz" olarak gösterilir.
 * Simülasyonu etkilemez; yalnız kuralın verilen girdilerde ne hedefleyeceğini hesaplar. Uydurma formül yoktur.
 *
 * Model birimleri: faiz haftalık kesir (0,003 = %0,3/hafta); enflasyon yıllık kesir; işsizlik, kredi/mevduat ve boşta mevduat payı kesir.
 * Satır atfı (policy.py): enflasyon -1..+1 kırpılır 90-92; hedef 96-99; POL_MIN/POL_MAX kırpması 100; haftalık adım 102;
 * kural kapalıyken pol_step hiçbir şey yapmaz 80-81. Sabitler params.py:401-405.
 */
export type FaizParametreleri = {
  /** POL_ON (`faiz_kurali` = "kural"). */
  on: boolean;
  /** POL_CD: kredi/mevduat oranı hedefi açık; kapalıyken boşta mevduat payı kullanılır. */
  cd: boolean;
  neut: number;
  min: number;
  max: number;
  step: number;
  aInf: number;
  aU: number;
  aCd: number;
  /** POL_A_IDLE: kartı yok, modelin sabiti (params.py:402). */
  aIdle: number;
  infTgt: number;
  uStar: number;
  cdStar: number;
  /** POL_IDLE_STAR: kartı yok, modelin sabiti (params.py:403). */
  idleStar: number;
};

export type FaizGirdileri = { infl: number; unemp: number; cd: number; idle: number };

/** Modelin kartsız sabitleri (params.py:402-403). */
export const POL_A_IDLE = 0.003;
export const POL_IDLE_STAR = 0.5;

/**
 * "Tepki" seçeneklerinin model katsayıları (kayıt kodlayıcısı: `settings.p1.json` codec `map`).
 * Arayüz kaydı yalnız seçenek adını yayımlar; eşitlik testle kilitlidir.
 */
export const TEPKI_KATSAYILARI = {
  enflasyon_hedefi: { zayif: 0.005, orta: 0.01, guclu: 0.02 },
  dogal_issizlik_kurali: { zayif: 0.002, orta: 0.004, guclu: 0.008 },
  kredi_canliligi_hedefi: { zayif: 0.003, orta: 0.006, guclu: 0.012 },
} as const satisfies Record<string, Record<string, number>>;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Hedef faiz (haftalık kesir), `POL_MIN`/`POL_MAX` ile kırpılmış. Kural kapalıysa politika faizi yoktur: `null`.
 * `infl` modelde olduğu gibi -1..+1 arasına kırpılır.
 */
export function hedefFaiz(p: FaizParametreleri, g: FaizGirdileri): number | null {
  if (!p.on) return null;
  const infl = clamp(g.infl, -1, 1);
  const ortak = p.neut + p.aInf * (infl - p.infTgt) - p.aU * (g.unemp - p.uStar);
  const tgt = p.cd ? ortak - p.aCd * (g.cd - p.cdStar) : ortak - p.aIdle * (g.idle - p.idleStar);
  return clamp(tgt, p.min, p.max);
}

/**
 * `POL_STEP` satırı: faiz bir haftada en çok bu kadar değişir. `eski` ve `hedef` verilirse sonraki haftanın faizi
 * (policy.py:102) döner; verilmezse yalnız adım sınırı.
 */
export function haftalikAdim(p: FaizParametreleri): number;
export function haftalikAdim(p: FaizParametreleri, eski: number, hedef: number): number;
export function haftalikAdim(p: FaizParametreleri, eski?: number, hedef?: number): number {
  if (eski === undefined || hedef === undefined) return p.step;
  return eski + Math.max(-p.step, Math.min(p.step, hedef - eski));
}

type Obj = Record<string, number | string | boolean>;
const asObj = (v: UIValue | undefined): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Taslak değerlerinden (kayıt arayüz birimleriyle) model birimli faiz parametreleri; gerekli kart kayıtta yoksa `null`. */
export function faizParametreleri(reg: Registry, values: ValuesPatch): FaizParametreleri | null {
  const card = (id: string) => reg.cards.find((c) => c.id === id);
  const val = (id: string): UIValue | undefined => {
    const c = card(id);
    return c === undefined ? undefined : id in values ? values[id] : c.default;
  };
  const kural = val("faiz_kurali");
  const taf = asObj(val("tarafsiz_faiz"));
  const enf = asObj(val("enflasyon_hedefi"));
  const isz = asObj(val("dogal_issizlik_kurali"));
  const kcd = asObj(val("kredi_canliligi_hedefi"));
  const [neut, min, max, step] = [num(taf.tarafsiz), num(taf.taban), num(taf.tavan), num(taf.adim)];
  const [infTgt, uStar, cdStar] = [num(enf.hedef), num(isz.normal), num(kcd.hedef)];
  const katsayi = <K extends keyof typeof TEPKI_KATSAYILARI>(id: K, o: Obj): number | null => {
    const k = (TEPKI_KATSAYILARI[id] as Record<string, number>)[String(o.tepki)];
    return k === undefined ? null : k;
  };
  const [aInf, aU, aCd] = [katsayi("enflasyon_hedefi", enf), katsayi("dogal_issizlik_kurali", isz), katsayi("kredi_canliligi_hedefi", kcd)];
  if (kural === undefined || [neut, min, max, step, infTgt, uStar, cdStar, aInf, aU, aCd].some((x) => x === null)) return null;
  return {
    on: kural === "kural", cd: kcd.acik === true,
    neut: neut! / 100, min: min! / 100, max: max! / 100, step: step! / 100,
    aInf: aInf!, aU: aU!, aCd: aCd!, aIdle: POL_A_IDLE,
    infTgt: infTgt! / 100, uStar: uStar! / 100, cdStar: cdStar!, idleStar: POL_IDLE_STAR,
  };
}
export const target = hedefFaiz;
