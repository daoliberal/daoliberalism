import { describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { detectEvents, eventCtxUpTo, type EventCtx } from "@/oyun/sim/replay/events";
import type { WeekPacket, World } from "@/oyun/sim/types";

const NULL_WORLD = Object.fromEntries(
  ["served","unemployed","employed","npc_firms","player_firms","failed_cum","city_cash_total","city_cash_weeks","gini","price_index","inflation_yoy","unemployment_rate","policy_rate","minted_year","mint_cap","loans_applied","loans_rejected","loans_granted","loan_rate_avg","support_weekly","survival_52","wage_index","rent_pct","occupancy","house_index","deposit_rate","bond_rate","lonca_fee_avg","royalty_avg","money_total","velocity","privatized_firms","no_founder","reject_pool","reject_reputation","no_buyer_cum"].map((k) => [k, null]),
) as World;
const pk = (week: number, w: Partial<World> = {}): WeekPacket => ({ v: 1, run_id: "r", week, version: 1, world: { ...NULL_WORLD, served: 1, ...w }, events: [] });
const ctx = (): EventCtx => ({ fired: new Set(), collapseWeek: null, recoveryWeek: null });
const ids = (p: WeekPacket, c = ctx(), prev: WeekPacket | null = null) => detectEvents(prev, p, c).map((e) => e.id);

describe("olay kurallari esikleri", () => {
  it("batis", () => {
    expect(ids(pk(5, { failed_cum: 9 }))).toEqual([]);
    expect(ids(pk(5, { failed_cum: 10 }))).toEqual(["batis10:5"]);
    expect(ids(pk(5, { failed_cum: 39 }))).toEqual(["batis10:5", "batis39:5"]);
  });
  it("batis_olayi_yerlesik_isletme_sayar_oyuncu_isletmesini_saymaz", () => {
    // failed_cum yalnız yerleşik işletme iflasıdır: oyuncu işletmesi sayacı olay eşiğini etkilemez, metin doğru adı söyler
    expect(ids(pk(5, { failed_cum: 3, failed_player_cum: 500 }))).toEqual([]);
    const e = detectEvents(null, pk(5, { failed_cum: 12, failed_player_cum: 500 }), ctx())[0]!;
    expect(e.params).toEqual({ hafta: 5, sayi: 12 });
    expect(t(e.textKey, e.params)).toBe("Hf 5: toplam 12 yerleşik işletme battı");
  });
  it("kredi_ret w>20", () => {
    expect(ids(pk(20, { loans_rejected: 5 }))).toEqual([]);
    expect(ids(pk(21, { loans_rejected: 2 }))).toEqual([]);
    expect(ids(pk(21, { loans_rejected: 3 }))).toEqual(["kredi_ret:21"]);
  });
  it("karsilama70 ve cokus w>26", () => {
    expect(ids(pk(26, { served: 0.4 }))).toEqual([]);
    expect(ids(pk(27, { served: 0.7 }))).toEqual([]);
    expect(ids(pk(27, { served: 0.69 }))).toEqual(["karsilama70:27"]);
    expect(ids(pk(27, { served: 0.5 }))).toEqual(["karsilama70:27"]);
    expect(ids(pk(27, { served: 0.49 }))).toEqual(["karsilama70:27", "cokus:27"]);
  });
  it("karsilama70 gosterilen deger esigin altinda", () => {
    const e = detectEvents(null, pk(30, { served: 0.697 }), ctx())[0]!;
    expect(e.params.oran).toBe(69);
    expect(t(e.textKey, e.params)).not.toContain("%70 ile");
    expect(detectEvents(null, pk(30, { served: 0.58 }), ctx())[0]!.params.oran).toBe(58);
  });
  it("kasa25 w>30, oyuncu20, ozellestirme, destek", () => {
    expect(ids(pk(30, { city_cash_total: 100 }))).toEqual([]);
    expect(ids(pk(31, { city_cash_total: 25000 }))).toEqual([]);
    expect(ids(pk(31, { city_cash_total: 24999 }))).toEqual(["kasa25:31"]);
    expect(ids(pk(3, { player_firms: 19 }))).toEqual([]);
    expect(ids(pk(3, { player_firms: 20 }))).toEqual(["oyuncu20:3"]);
    expect(ids(pk(3, { privatized_firms: 0 }))).toEqual([]);
    expect(ids(pk(3, { privatized_firms: 1 }))).toEqual(["ozellestirme:3"]);
    expect(ids(pk(3, { support_weekly: 0 }))).toEqual([]);
    expect(ids(pk(3, { support_weekly: 5 }))).toEqual(["destek_basladi:3"]);
  });
  it("null alan tetiklemez", () => {
    expect(detectEvents(null, { ...pk(50), world: NULL_WORLD }, ctx())).toEqual([]);
  });
  it("her kural bir kez, toparlanma yalniz cokustan sonra", () => {
    const c = ctx();
    expect(ids(pk(30, { served: 0.9 }), c)).toEqual([]);
    expect(ids(pk(31, { served: 0.75 }), c)).toEqual([]);
    expect(ids(pk(40, { served: 0.45 }), c)).toEqual(["karsilama70:40", "cokus:40"]);
    expect(c.collapseWeek).toBe(40);
    expect(ids(pk(41, { served: 0.4 }), c)).toEqual([]);
    expect(ids(pk(60, { served: 0.69 }), c)).toEqual([]);
    expect(ids(pk(80, { served: 0.75 }), c)).toEqual(["toparlanma:80"]);
    expect(c.recoveryWeek).toBe(80);
    expect(ids(pk(81, { served: 0.9 }), c)).toEqual([]);
  });
  it("ayni dizi iki kez ayni kimlikler; eventCtxUpTo", () => {
    const seq = Array.from({ length: 100 }, (_, i) => pk(i + 1, { served: i + 1 >= 40 && i + 1 < 80 ? 0.45 : 0.9, failed_cum: i }));
    const run = () => { const c = ctx(); let prev: WeekPacket | null = null; return seq.flatMap((p) => { const e = detectEvents(prev, p, c); prev = p; return e.map((x) => x.id); }); };
    expect(run()).toEqual(run());
    const c60 = eventCtxUpTo(seq, 60);
    expect(c60.collapseWeek).toBe(40);
    expect(c60.recoveryWeek).toBeNull();
    expect(c60.fired.has("batis10")).toBe(true);
    expect(c60.fired.has("batis39")).toBe(true);
    expect(eventCtxUpTo(seq, 30).collapseWeek).toBeNull();
    expect(eventCtxUpTo(seq, 90).recoveryWeek).toBe(80);
  });
  it("metin anahtarlari var ve yer tutucular params ile eslesir", () => {
    const c = ctx();
    const evs = [
      ...detectEvents(null, pk(40, { failed_cum: 50, loans_rejected: 9, served: 0.4, city_cash_total: 1, player_firms: 25, privatized_firms: 2, support_weekly: 3 }), c),
      ...detectEvents(null, pk(80, { served: 0.8 }), c),
    ];
    expect(new Set(evs.map((e) => e.id.split(":")[0]))).toEqual(new Set(["batis10", "batis39", "kredi_ret", "karsilama70", "cokus", "kasa25", "oyuncu20", "ozellestirme", "destek_basladi", "toparlanma"]));
    for (const e of evs) {
      expect(e.textKey in tr).toBe(true);
      const ph = [...tr[e.textKey].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph).toEqual(Object.keys(e.params).sort());
      expect(t(e.textKey, e.params)).not.toMatch(/[{}]/);
      expect(e.params.hafta).toBe(e.week);
    }
    const cokus = evs.find((e) => e.id === "cokus:40")!;
    expect(cokus.critical).toBe(true);
    expect(t(cokus.textKey, cokus.params)).toBe("Hf 40: talep karşılama %50 düzeyinin altına indi: kriz");
    expect(evs.find((e) => e.id === "toparlanma:80")!.kind).toBe("good");
    expect(evs.find((e) => e.id === "batis39:40")!.critical).toBe(false);
    expect(cokus.sector).toBeNull();
  });
});
