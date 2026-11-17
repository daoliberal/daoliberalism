// E0 düzeltme 1 (I1): kayıt verisinden türetilen ölçüm metinleri bayatlamasın. Sayılar kayıt dosyalarından hesaplanır
// (çöküş = site kuralı: 26. haftadan sonra talep karşılama < %50, eventRules.ts) ve metindeki sayılarla karşılaştırılır.
// Kayıt yeniden üretilip sayılar değişirse bu test kırmızı olur: metinleri güncelle.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tr } from "@/oyun/copy/tr";
import { COKUS_ESIK, COKUS_ILK_HAFTA } from "@/oyun/sim/eventRules";

const ROOT = path.resolve(process.cwd(), "public/oyun-kayit");
const oku = <T>(rel: string): T => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")) as T;
const index = oku<{ seeds: unknown[]; sets: { id: string; files: Record<string, string> }[] }>("index.json");

type Kume = { cokus: (number | null)[]; hicCokmedi: number; ayakta: number; medyan: number; enErken: number };
function kume(id: string): Kume {
  const set = index.sets.find((s) => s.id === id)!;
  const cokus: (number | null)[] = [];
  let ayakta = 0;
  for (const f of Object.values(set.files)) {
    const served = oku<{ cols: { served: (number | null)[] } }>(f).cols.served;
    const w = served.findIndex((v, i) => i + 1 > COKUS_ILK_HAFTA && v !== null && v < COKUS_ESIK);
    cokus.push(w < 0 ? null : w + 1);
    if (served.slice(-30).every((v) => v === null || v >= COKUS_ESIK)) ayakta++;
  }
  const var_ = cokus.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const m = var_.length % 2 ? var_[(var_.length - 1) / 2]! : (var_[var_.length / 2 - 1]! + var_[var_.length / 2]!) / 2;
  return { cokus, hicCokmedi: cokus.length - var_.length, ayakta, medyan: m, enErken: var_[0]! };
}
const tr1 = (x: number): string => String(x).replace(".", ",");
const kapali = kume("kapali");
const kisa = kume("kisa");
const kurtarma = kume("kurtarma");
const hepsi = index.seeds.length;

describe("kayıttan türetilen ölçüm metinleri güncel", () => {
  it("dayanıklı taban (kapalı küme): çöküş medyanı, en erken çöküş, ayakta kalan yok", () => {
    expect(kapali.hicCokmedi).toBe(1);
    expect(tr["sablon.dayanikli_taban.olcum"]).toContain(`çöküş medyanı ${tr1(kapali.medyan)}. hafta`);
    expect(tr["sablon.dayanikli_taban.olcum"]).toContain(`en erken çöküş ${kapali.enErken}. hafta`);
    expect(tr["sablon.dayanikli_taban.olcum"]).toContain(`${hepsi} dünyanın ${kapali.ayakta} tanesi son 30 haftayı ayakta bitirdi`);
  });
  it("geçiş desteği şablonu ve kart ipucu: kurtarma fonuyla hiç çökmeyen ve son 30 haftayı ayakta bitiren dünyalar", () => {
    for (const k of ["sablon.gecis_destegi.olcum", "setting.gecis_destegi.hint"] as const) {
      expect(tr[k], k).toContain(`${hepsi} dünyanın ${kurtarma.hicCokmedi} tanesi hiç çökmedi`);
      expect(tr[k], k).toContain(`${kurtarma.ayakta} tanesi son 30 haftayı ayakta bitirdi`);
    }
  });
  it("kart ipucu: kısa süreli desteğin çöküş medyanı kapalıyla birlikte söylenir", () => {
    const k = tr["setting.gecis_destegi.hint"];
    expect(kisa.hicCokmedi).toBe(2);
    expect(k).toContain(`kısa süreli: ${hepsi} dünyanın ${hepsi - kisa.hicCokmedi} tanesi çöktü, çöküş medyanı ${tr1(kisa.medyan)}. hafta (kapalıda ${tr1(kapali.medyan)})`);
  });
  it("kayıt kaynağı kural kartı ipucu (metinler.tr.json)", () => {
    const m = JSON.parse(readFileSync(path.resolve(process.cwd(), "../../simulasyon/arayuz/registry/metinler.tr.json"), "utf8")) as { settings?: Record<string, { hint?: string }>; [k: string]: unknown };
    const hint = JSON.stringify(m).match(/"hint": ?"(Kayıtlı ölçümlerde kurtarma fonuyla[^"]*)"/)?.[1] ?? "";
    const bulunmada: Record<number, string> = { 1: "birinde", 2: "ikisinde", 3: "üçünde", 4: "dördünde", 5: "beşinde", 6: "altısında" };
    expect(hint).toContain(`altı dünyanın ${bulunmada[kurtarma.hicCokmedi]} hiç çöküş olmadı`);
    expect(kisa.cokus.length).toBe(6);
    const cokenKisi: Record<number, string> = { 1: "biri", 2: "ikisi", 3: "üçü", 4: "dördü", 5: "beşi", 6: "altısı" };
    expect(hint).toContain(`kısa süreli destekte altının ${cokenKisi[hepsi - kisa.hicCokmedi]} çöktü, çöküş medyanı kapalıda ${tr1(kapali.medyan)}, kısa süreli destekte ${tr1(kisa.medyan)}. hafta`);
  });
});
