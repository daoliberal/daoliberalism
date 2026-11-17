import { describe, expect, it } from "vitest";
import { formatValue, numberText } from "@/oyun/sim/formatValue";
import { hintApplies, hintVisible } from "@/oyun/sim/hints";
import type { RegistryControl, UIValue } from "@/oyun/sim/types";
import { contractRegistry, formatCases, hintCases, type FormatCase } from "../helpers/registryFixtures";

type Codec = { type: string; [k: string]: unknown };
const { words, cases } = formatCases();

/** Python codec'inden yayımlanan kontrolün eşi (kayıt yayımcısı ile aynı kural): etiketler `labels`tan gelir. */
function controlOf(c: Codec, labels: Record<string, string>, ctl?: unknown): RegistryControl {
  switch (c.type) {
    case "enum": return { type: "options", options: Object.keys(c.map as object).map((k) => ({ value: k, label: labels[k] ?? k })) };
    case "bool": return { type: "options", options: [{ value: true, label: words.acik! }, { value: false, label: words.kapali! }] };
    case "seed": return { type: "options", options: Object.entries(labels).map(([k, label]) => ({ value: Number(k), label })) };
    case "number": return ctl as RegistryControl;
    case "fields":
      return {
        type: "fields",
        fields: (c.fields as { key: string; codec: Codec }[]).map((f) => {
          const sub = f.codec;
          const num = sub.type === "number" ? ({ type: "number", min: sub.min, max: sub.max, step: sub.step, unit: sub.unit ?? null, integer: Boolean(sub.integer) } as RegistryControl) : undefined;
          return { key: f.key, label: labels[f.key] ?? f.key, control: controlOf(sub, {}, num) };
        }),
      };
    default: return { type: c.type as "order" | "multi", items: (c.items as string[] ?? []).map((v) => ({ value: v, label: labels[v] ?? v })) };
  }
}

describe("formatValue", () => {
  it("formatValue_matches_python_cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(57);
    const bad: string[] = [];
    for (const k of cases as FormatCase[]) {
      const control = controlOf(k.codec, k.labels ?? {}, k.control);
      const got = formatValue(control, k.ui_value as UIValue, words);
      if (got !== k.text) bad.push(`${JSON.stringify(k.ui_value)} -> ${got} (beklenen ${k.text})`);
    }
    expect(bad).toEqual([]);
  });

  it("number_text_turkish_grouping", () => {
    expect(numberText(1234567)).toBe("1.234.567");
    expect(numberText(-1500)).toBe("-1.500");
    expect(numberText(0.05)).toBe("0,05");
    expect(numberText(-0)).toBe("0");
  });

  it("unknown_option_value_falls_back_to_plain_text", () => {
    expect(formatValue({ type: "options", options: [{ value: "a", label: "A" }] }, "z", words)).toBe("z");
  });
});

describe("hintApplies (Python hint_applies ile birebir)", () => {
  const reg = contractRegistry();
  it("vaka_tabanlari", () => {
    expect(hintCases().length).toBeGreaterThanOrEqual(29);
    expect(cases.length).toBeGreaterThanOrEqual(57);
  });
  it("kart_kendini_atlar", () => {
    const faiz = reg.cards.find((x) => x.id === "ornek_faiz")!;
    // kartın kendi taslak değeri `context.values`ta başka olsa da öteki kartların varsayılan denetimini bozmaz
    expect(hintApplies(reg, faiz, 0.3, { values: { ornek_faiz: 0.9 }, weeks: 100 })).toBe(true);
  });
  it("sablon_bulunamazsa_hata_ve_hintVisible_false", () => {
    const faiz = reg.cards.find((x) => x.id === "ornek_faiz")!;
    const bad = { ...faiz, measured_with: { _sablon: "yok_boyle_sablon" } };
    expect(() => hintApplies(reg, bad, 0.3, { values: {}, weeks: 100 })).toThrow();
    expect(hintVisible(reg, bad, {}, 100)).toBe(false);
  });
  it("hintVisible_yalniz_sablon_bulunamadi_yakalar", () => {
    const faiz = reg.cards.find((x) => x.id === "ornek_faiz")!;
    // beklenmeyen hata (bozuk kart) yutulmaz
    const bozuk = { ...faiz, measured_values: 5 as unknown as UIValue[] };
    expect(() => hintVisible(reg, bozuk, {}, 100)).toThrow();
  });
  it.each(hintCases().map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const card = reg.cards.find((x) => x.id === c.card)!;
    expect(hintApplies(reg, card, c.value as UIValue, { values: c.context.values as Record<string, UIValue>, weeks: c.context.weeks })).toBe(c.applies);
  });
});
