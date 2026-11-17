// Yalnız commit'li kayıt JSON'larını okur (kaynak CSV gerekmez).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WeekPacket, World } from "@/oyun/sim/types";

const DIR = path.resolve(process.cwd(), "public/oyun-kayit");
const read = (rel: string): string => readFileSync(path.join(DIR, rel), "utf8");

type Num = number | null;
type Cols = Record<string, Num[]>;
type Rec = { set: string; pm_index: number; weeks: number; cols: Cols };
type SetEntry = {
  id: string; values: Record<string, string>; flags: Record<string, number>;
  files: Record<string, string>; source_sha256: Record<string, string>; report: string;
};
type Index = {
  schema: string; model_note: string; weeks: number; seeds: { index: number; label: number }[];
  sets: SetEntry[]; derived: string[]; fixed_rules: { settingId: string; valueKey: string }[];
  templates: { id: string; values: Record<string, string> }[]; zero_filled: Record<string, string[]>;
};

const NULL_WORLD = Object.fromEntries(
  "served unemployed employed npc_firms player_firms failed_cum city_cash_total city_cash_weeks gini price_index inflation_yoy unemployment_rate policy_rate minted_year mint_cap loans_applied loans_rejected loans_granted loan_rate_avg support_weekly survival_52 wage_index rent_pct occupancy house_index deposit_rate bond_rate lonca_fee_avg royalty_avg money_total velocity privatized_firms no_founder reject_pool reject_reputation no_buyer_cum"
    .split(" ")
    .map((k) => [k, null]),
) as World;

const index = JSON.parse(read("index.json")) as Index;
const rec = (set: string, i: number): Rec => {
  const s = index.sets.find((x) => x.id === set)!;
  return JSON.parse(read(s.files[String(i)]!)) as Rec;
};
const packet = (r: Rec, w: number): WeekPacket => {
  const c = (k: string): Num => r.cols[k]![w - 1] ?? null;
  return {
    v: 1, run_id: `${r.set}.${r.pm_index}`, week: w, version: 1, events: [],
    world: {
      ...NULL_WORLD,
      served: c("served"), unemployed: c("unemployed"), employed: c("employed"), npc_firms: c("npc_firms"),
      player_firms: c("player_firms"), failed_cum: c("failed_cum"), city_cash_total: c("city_cash_total"),
      gini: c("gini"), unemployment_rate: c("unemployment_rate"), loans_applied: c("loans_applied"),
      loans_rejected: c("loans_rejected"), loans_granted: c("loans_granted"), support_weekly: c("support_weekly"),
      privatized_firms: c("privatized_firms"), money_total: c("money_total"), velocity: c("velocity"),
      no_founder: c("no_founder"), reject_pool: c("reject_pool"), reject_reputation: c("reject_reputation"),
      no_buyer_cum: c("no_buyer_cum"),
    },
  } satisfies WeekPacket;
};

const allFiles = index.sets.flatMap((s) => Object.values(s.files));

describe("oyun-kayit index.json", () => {
  it("üç küme, altı tohum", () => {
    expect(index.schema).toBe("oyun-kayit/1");
    expect(index.weeks).toBe(200);
    expect(index.seeds).toHaveLength(6);
    expect(index.sets.map((s) => s.id)).toEqual(["kapali", "kisa", "kurtarma"]);
    for (const s of index.sets) expect(Object.keys(s.files)).toHaveLength(6);
    expect(index.derived).toEqual(["unemployment_rate", "loans_granted"]);
  });
  it("şablonlar ve sabit kurallar", () => {
    expect(index.templates).toHaveLength(2);
    expect(index.fixed_rules).toHaveLength(3);
    for (const r of index.fixed_rules) expect(r.valueKey.startsWith("lock.deger.")).toBe(true);
    expect(index.zero_filled).toEqual({ kapali: ["support_weekly"] });
  });
  it("karar numarası yalnız model_note ve report alanlarında geçer (bu ikisi arayüze akmaz)", () => {
    const strip = JSON.parse(JSON.stringify(index)) as Index;
    strip.model_note = "";
    for (const s of strip.sets) s.report = "";
    expect(JSON.stringify(strip)).not.toMatch(/K-\d+/);
  });
});

describe("oyun-kayit: kasa-hafta ve sürüm bilgisi (E0)", () => {
  const idx = index as Index & { model_version?: string; model_sha256?: string; generated_by?: string };
  it("index model sürümünü ve üretim yolunu taşır", () => {
    expect(idx.generated_by).toBe("model");
    expect(idx.model_version).toMatch(/^v\d+\.\d+-[0-9a-f]{8}$/);
    expect(idx.model_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(idx.model_note).toContain(idx.model_version!);
  });
  it("her dosyada toplam ve beş şehir için kasa-hafta sütunu var; ölçülmüş (hepsi null değil)", () => {
    for (const f of allFiles) {
      const c = (JSON.parse(read(f)) as Rec).cols;
      for (const k of ["city_cash_weeks", ...[0, 1, 2, 3, 4].map((i) => `city_cash_weeks_c${i}`)]) {
        expect(c[k], `${f}:${k}`).toHaveLength(200);
        expect(c[k]!.some((v) => v !== null), `${f}:${k}`).toBe(true);
        for (const v of c[k]!) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("en düşük şehir toplamdan düşük ya da eşittir (toplam, şehirlerin giderle ağırlıklı ortalamasıdır)", () => {
    for (const f of allFiles) {
      const c = (JSON.parse(read(f)) as Rec).cols;
      for (let w = 0; w < 200; w++) {
        const sehir = [0, 1, 2, 3, 4].map((i) => c[`city_cash_weeks_c${i}`]![w] ?? null).filter((v): v is number => v !== null);
        const toplam = c.city_cash_weeks![w] ?? null;
        if (toplam !== null && sehir.length > 0) expect(Math.min(...sehir)).toBeLessThanOrEqual(toplam * 1.0001 + 1e-6);
      }
    }
  });
});

describe("oyun-kayit paketleri", () => {
  it("18 dosya; NaN yok, hafta 200, her sütun 200 uzunlukta", () => {
    expect(allFiles).toHaveLength(18);
    for (const f of allFiles) {
      const text = read(f);
      expect(text).not.toMatch(/NaN|Infinity/);
      const r = JSON.parse(text) as Rec;
      expect(r.weeks).toBe(200);
      for (const [k, col] of Object.entries(r.cols)) {
        expect(col, `${f}:${k}`).toHaveLength(200);
        for (const v of col) expect(v === null || typeof v === "number").toBe(true);
      }
    }
  });
  it("served [0,1] ya da null", () => {
    for (const f of allFiles) {
      for (const v of (JSON.parse(read(f)) as Rec).cols.served!) {
        if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
    }
  });
  it("ilk satır gerçek değerler", () => {
    const w = packet(rec("kapali", 0), 1).world;
    expect(w.served).toBe(0.6108);
    expect(w.employed).toBe(3682);
    expect(w.unemployed).toBe(0);
    expect(w.unemployment_rate).toBe(0);
    expect(w.npc_firms).toBe(124);
  });
  it("kapali: support_weekly 200 hafta 0 (null değil)", () => {
    for (let i = 0; i < 6; i++) expect(rec("kapali", i).cols.support_weekly).toEqual(Array(200).fill(0));
  });
  it("kisa/kurtarma: 27/28. haftaya kadar support_weekly 0", () => {
    for (let i = 0; i < 6; i++) {
      expect(rec("kisa", i).cols.support_weekly!.slice(0, 27).every((v) => v === 0)).toBe(true);
      expect(rec("kurtarma", i).cols.support_weekly!.slice(0, 26).every((v) => v === 0)).toBe(true);
    }
  });
  it("tamsayı alanlar tamsayı", () => {
    for (const f of allFiles) {
      const c = (JSON.parse(read(f)) as Rec).cols;
      for (const k of ["employed", "unemployed", "npc_firms", "city_cash_total", "money_total", "failed_cum"]) {
        for (const v of c[k]!) if (v !== null) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
  it("ilk 26 haftada üç kümenin tüm sütunları eşit", () => {
    for (let i = 0; i < 6; i++) {
      const [a, b, c] = [rec("kapali", i), rec("kisa", i), rec("kurtarma", i)];
      for (const k of Object.keys(a.cols)) {
        expect(b.cols[k]!.slice(0, 26), k).toEqual(a.cols[k]!.slice(0, 26));
        expect(c.cols[k]!.slice(0, 26), k).toEqual(a.cols[k]!.slice(0, 26));
      }
    }
  });
  it("belgeleyici: kurtarma 27. haftada, kisa 28. haftada ayrışır (tohum 0.078)", () => {
    const kap = rec("kapali", 0).cols, kis = rec("kisa", 0).cols, kur = rec("kurtarma", 0).cols;
    const diverges = (x: Cols, from: number) => Object.keys(kap).some((k) => x[k]![from - 1] !== kap[k]![from - 1]);
    expect(diverges(kur, 27)).toBe(true);
    expect(diverges(kis, 27)).toBe(false);
    expect(diverges(kis, 28)).toBe(true);
  });
});
