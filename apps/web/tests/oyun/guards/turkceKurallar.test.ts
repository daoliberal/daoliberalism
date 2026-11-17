import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tr } from "@/oyun/copy/tr";

const REGISTRY_DIR = path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/registry");
const rules = (JSON.parse(readFileSync(path.join(REGISTRY_DIR, "metin_kurallari.json"), "utf-8")) as { forbidden: { id: string; pattern: string; message: string }[] }).forbidden;

function violations(texts: [string, string][]): string[] {
  const out: string[] = [];
  for (const [where, text] of texts) {
    for (const r of rules) if (new RegExp(r.pattern, "u").test(text)) out.push(`${where} [${r.id}]: ${text}`);
  }
  return out;
}

/** Bir JSON'daki bütün dize değerleri, yolu ile (kimlik/anahtar alanları kuralın konusu değil). */
function strings(x: unknown, p: string, out: [string, string][] = []): [string, string][] {
  if (typeof x === "string") out.push([p, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, `${p}[${i}]`, out));
  else if (typeof x === "object" && x !== null) {
    for (const [k, v] of Object.entries(x)) {
      if (["id", "value", "key", "unit", "kind", "type", "layer", "level", "group", "actor", "status", "apply", "params", "requires", "aliases", "hint_source", "credit_type", "source_world_field", "schema", "default", "measured_values", "measured_with"].includes(k)) continue;
      strings(v, `${p}.${k}`, out);
    }
  }
  return out;
}

describe("dil kuralları (metin_kurallari.json)", () => {
  it("kurallar_yuklendi", () => {
    expect(rules.map((r) => r.id)).toEqual(expect.arrayContaining(["sayi_sabit_ek", "sayi_birim_bitisik", "yer_tutucu_ek"]));
  });

  it("tr_ts_butun_degerler_istisnasiz", () => {
    expect(violations(Object.entries(tr))).toEqual([]);
  });

  it("yayimlanan_registry_json_metinleri", () => {
    const reg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../public/oyun-kayit/registry.json"), "utf-8")) as unknown;
    const texts = strings(reg, "registry");
    expect(texts.length).toBeGreaterThan(20);
    expect(texts.some(([where]) => where.startsWith("registry.units."))).toBe(true); // birim şablonları da taranır
    expect(violations(texts)).toEqual([]);
  });

  it("denetim_kendi_sinamasi", () => {
    expect(violations([["a", "6'nın 3'ü"]]).length).toBeGreaterThan(0);
    expect(violations([["a", "6 dünyanın 3 tanesi"]])).toEqual([]);
    expect(violations([["a", "{n}'den"]]).length).toBeGreaterThan(0);
  });
});
