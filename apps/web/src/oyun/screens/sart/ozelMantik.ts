import { same } from "@/oyun/sim/hints";
import type { ConsistencyRule, Registry, RegistryCard, UIValue, ValuesPatch } from "@/oyun/sim/types";

/** Kredi türlerinin A-D grupları (prototip `crGroupTitles`): kredi türü kimliği (`credit_type`) gruba eşlenir. */
export const KREDI_GRUPLARI = [
  { id: "A", turler: ["kurulus", "genc", "dayanma"] },
  { id: "B", turler: ["buyume", "yatirim", "arge"] },
  { id: "C", turler: ["devir", "kopru"] },
  { id: "D", turler: ["konut", "medya"] },
] as const;
export type KrediGrupId = (typeof KREDI_GRUPLARI)[number]["id"];

export const KREDI_ORTAK_KARTI = "kredi_ortak";
export const KREDI_VARYANT_KARTI = "kredi_varyant";
export const KURULUS_KREDISI_KARTI = "kredi_kurulus";
export const KURULUS_FONU_KARTI = "kurulus_fonu";

export type KrediBolumleri = {
  ortak: RegistryCard | undefined;
  gruplar: { id: KrediGrupId; cards: RegistryCard[] }[];
  /** Tür kimliği tanınmayan ya da türü olmayan öteki kartlar (ör. temerrüt eşiği). */
  diger: RegistryCard[];
  varyant: RegistryCard | undefined;
};

/** "Kredi" grubunun kartlarını ortak kurallar, A-D türleri, öteki kartlar ve varyant olarak böler; her kart tam bir yerde çıkar. */
export function krediBolumleri(cards: RegistryCard[]): KrediBolumleri {
  const ortak = cards.find((c) => c.id === KREDI_ORTAK_KARTI);
  const varyant = cards.find((c) => c.id === KREDI_VARYANT_KARTI);
  const gruplar = KREDI_GRUPLARI.map((g) => ({
    id: g.id,
    cards: g.turler.flatMap((tur) => cards.filter((c) => c.credit_type === tur)),
  })).filter((g) => g.cards.length > 0);
  const yerlesen = new Set([ortak?.id, varyant?.id, ...gruplar.flatMap((g) => g.cards.map((c) => c.id))]);
  return { ortak, gruplar, diger: cards.filter((c) => !yerlesen.has(c.id)), varyant };
}

const val = (registry: Registry, draft: ValuesPatch, id: string): UIValue | undefined => {
  const c = registry.cards.find((x) => x.id === id);
  return c === undefined ? undefined : id in draft ? draft[id]! : c.default;
};
const obj = (v: UIValue | undefined): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {});

/** Kuruluş fonu kartı var ve kapalı mı (`acik: false`). */
export function fonKapali(registry: Registry, draft: ValuesPatch): boolean {
  const v = val(registry, draft, KURULUS_FONU_KARTI);
  return v !== undefined && obj(v).acik === false;
}

export type Uyari = { id: string; text: string; kart: string; kartAd: string };

const eslesir = (kind: string, value: UIValue | undefined, beklenen: UIValue): boolean => {
  if (value === undefined) return false;
  if (typeof beklenen === "object" && beklenen !== null && !Array.isArray(beklenen)) {
    const o = obj(value);
    return Object.entries(beklenen).every(([k, b]) => k in o && same("", o[k], b));
  }
  return same(kind, value, beklenen);
};

/** Kuralın ilgilendirdiği kartlar (bağlantı hedefi ilkidir). */
const kartlari = (r: ConsistencyRule): string[] => [...Object.keys(r.when ?? {}), ...(r.artan ? [r.artan.kart] : [])];

/**
 * Tutarlılık uyarıları (R1b biçimi): `when` kartların hepsi aynı anda eşleşirse, `artan` kartın alanları küçükten büyüğe değilse uyarı çıkar.
 * Kayıtta olmayan karta bağlı kural hiç ateşlenmez. Kilitli kartın değeri (şablonun değeri) sunucuda yine geçerlidir; bu yüzden
 * kilit kuralı susturmaz: değerlendirme taslağın etkin değerleriyle yapılır.
 */
export function tutarlilikUyarilari(registry: Registry, draft: ValuesPatch): Uyari[] {
  const out: Uyari[] = [];
  for (const r of registry.consistency ?? []) {
    const ids = kartlari(r);
    const cards = ids.map((id) => registry.cards.find((c) => c.id === id));
    if (ids.length === 0 || cards.some((c) => c === undefined)) continue;
    let ates = false;
    if (r.when) ates = Object.entries(r.when).every(([id, b]) => eslesir(registry.cards.find((c) => c.id === id)!.kind, val(registry, draft, id), b));
    else if (r.artan) {
      const o = obj(val(registry, draft, r.artan.kart));
      const v = r.artan.alanlar.map((k) => o[k]);
      ates = v.every((x): x is number => typeof x === "number") && v.some((x, i) => i > 0 && v[i - 1]! > x);
    }
    if (ates) out.push({ id: r.id, text: r.text, kart: ids[0]!, kartAd: cards[0]!.title });
  }
  return out;
}
