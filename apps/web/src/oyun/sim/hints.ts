import type { Registry, RegistryCard, UIValue, ValuesPatch } from "./types";

/** Ölçüm süresi bilinmiyorsa mevcut ölçümlerin süresi (Python `MEASURED_WEEKS_DEFAULT`). */
export const MEASURED_WEEKS_DEFAULT = 200;
const EPS = 1e-9;
const TEMPLATE_MISSING = "hint_template_missing:";

export type HintContext = { values: ValuesPatch; weeks: number };

/** Toleranslı değer eşitliği (sayılarda EPS, `multi`'de küme eşitliği). */
export function same(kind: string, a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPS;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (kind === "multi") return new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
    return a.length === b.length && a.every((x, i) => same("", x, b[i]));
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same("", (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/**
 * Ölçüm ipucu geçerlilik kuralı (DK-5), Python `hint_applies` ile birebir: ipucu yalnız ölçüldüğü bağlamda gösterilir.
 * `context.values`ta olmayan kart varsayılan değerindedir.
 */
export function hintApplies(reg: Registry, card: RegistryCard, value: UIValue, context: HintContext): boolean {
  const mv = card.measured_values;
  if (!mv || mv.length === 0) return false;
  if (context.weeks !== (card.measured_weeks ?? MEASURED_WEEKS_DEFAULT)) return false;
  if (!mv.some((m) => same(card.kind, value, m))) return false;
  const mw = card.measured_with;
  let expected: ValuesPatch = {};
  if (mw && "_sablon" in mw) {
    const tpl = reg.templates.find((x) => x.id === mw._sablon);
    if (!tpl) throw new Error(`${TEMPLATE_MISSING}${String(mw._sablon)}`); // Python KeyError ile aynı: sessizce {} sayılmaz
    expected = tpl.values;
  } else if (mw) {
    expected = mw;
    // Python ile aynı: ölçüm bağlamındaki kart kayıtta yoksa bağlam yeniden kurulamaz, ipucu gösterilmez
    if (Object.keys(mw).some((k) => k !== card.id && !reg.cards.some((c) => c.id === k))) return false;
  }
  for (const other of reg.cards) {
    if (other.id === card.id) continue;
    const want = other.id in expected ? expected[other.id]! : other.default;
    const have = other.id in context.values ? context.values[other.id]! : other.default;
    if (!same(other.kind, have, want)) return false;
  }
  return true;
}

/** Kartın ipucu satırı gösterilsin mi: `draft` taslak değerleri (kart kimliği -> değer), `durationWeeks` koşu süresi. */
export function hintVisible(reg: Registry, card: RegistryCard, draft: ValuesPatch, durationWeeks: number): boolean {
  if (card.hint === undefined) return false;
  const value = card.id in draft ? draft[card.id]! : card.default;
  try {
    return hintApplies(reg, card, value, { values: draft, weeks: durationWeeks });
  } catch (e) {
    // yalnız beklenen bozukluk (şablon yok): ipucu gösterilmez, "Bu değer ölçülmedi" der; öteki hatalar yükselir
    if (e instanceof Error && e.message.startsWith(TEMPLATE_MISSING)) return false;
    throw e;
  }
}
