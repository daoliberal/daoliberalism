import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRegistry } from "@/oyun/sim/live/wire";
import type { Registry } from "@/oyun/sim/types";

const DIR = path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/server/tests/fixtures");
const read = (name: string): unknown => JSON.parse(readFileSync(path.join(DIR, name), "utf-8"));

/** Gerçek sözleşme fikstürü (K1): gerçek kayıt + `ornek_*` kartlar. Her çağrıda taze nesne. */
export const contractRegistryRaw = (): Record<string, unknown> => read("registry_contract.json") as Record<string, unknown>;
export const contractRegistry = (): Registry => parseRegistry(contractRegistryRaw());

export type FormatCase = {
  codec: { type: string; [k: string]: unknown };
  model_value: unknown;
  ui_value: unknown;
  labels?: Record<string, string>;
  control?: unknown;
  text: string;
};
export const formatCases = (): { words: Record<string, string>; cases: FormatCase[] } => read("registry_format_cases.json") as { words: Record<string, string>; cases: FormatCase[] };

export type HintCase = { name: string; card: string; value: unknown; context: { values: Record<string, unknown>; weeks: number }; applies: boolean };
export const hintCases = (): HintCase[] => (read("registry_hint_cases.json") as { cases: HintCase[] }).cases;

/** Bir kartın uygulama sınıfını açıkça ayarlar (taze kayıt döner): gerçek kayıttaki sınıflar ölçümle değişse de davranış testleri kararlı kalır. */
export const withApply = (reg: Registry, cardId: string, apply: Registry["cards"][number]["apply"]): Registry => {
  if (!reg.cards.some((c) => c.id === cardId)) throw new Error(`withApply: kayıtta ${cardId} yok`);
  return { ...reg, cards: reg.cards.map((c) => (c.id === cardId ? { ...c, apply } : c)) };
};

/** Sentetik `unknown` kural kartı: gerçek kayıtta hiç `unknown` kalmasa da DK-17 kilidi bu kartla denenir. */
export const ORNEK_BILINMEYEN = "ornek_bilinmeyen";
export const ORNEK_BILINMEYEN_BASLIK = "Bilinmeyen deneme kartı";
export const withUnknownCard = (reg: Registry): Registry => {
  const model = reg.cards.find((c) => c.kind === "number" && c.layer === "P" && c.editable && c.status === "active" && c.level === "A");
  if (!model) throw new Error("withUnknownCard: kayıtta örnek sayı kartı yok");
  const ilkGrup = [...reg.groups].sort((a, b) => a.order - b.order)[0]!.id; // ilk sekmede görünsün
  const kart = { ...model, id: ORNEK_BILINMEYEN, group: ilkGrup, title: ORNEK_BILINMEYEN_BASLIK, aliases: [], apply: "unknown" as const };
  return { ...reg, cards: [...reg.cards, kart] };
};
export const contractRegistryWithUnknown = (): Registry => withUnknownCard(contractRegistry());
