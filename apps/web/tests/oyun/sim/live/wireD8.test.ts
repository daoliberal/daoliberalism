import { describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import { WireError, parseWorldPlan, parsePacket } from "@/oyun/sim/live/wire";
import { kurulumOzeti, isletmeSayisi } from "@/oyun/sim/result";
import { tarifOf, taslakOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { decodeRecipe, encodeRecipe } from "@/oyun/sim/recipe";
import { parseEntry } from "@/oyun/sim/library";
import type { RunConfig, RunState, ValuesPatch } from "@/oyun/sim/types";
import { createFakeLiveServer, packetOf } from "../../helpers/fakeLiveServer";
import { planYaniti } from "../../helpers/dunyaPlan";

const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { isletme_sayisi: 30 }, schedule: [{ week: 3, patch: { x: 1 } }], fastForwardTo: 5 };

describe("D8 /api/world/plan: tel ve LiveSource", () => {
  it("plan_yaniti_ayristirilir_ve_eksik_alan_wire_hatasi", () => {
    const p = planYaniti();
    expect(parseWorldPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseWorldPlan({ ...p, housing: null }).housing).toBeNull();
    const eksik = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    delete eksik.firms;
    expect(() => parseWorldPlan(eksik)).toThrow(WireError);
    expect(() => parseWorldPlan({ ...p, capMode: "baska" })).toThrow(WireError);
  });

  it("govde_yalniz_config_takvim_ve_ileri_sarma_gonderilmez", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const server = createFakeLiveServer();
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      calls.push({ url: u, ...(init ? { init } : {}) });
      return new Response(JSON.stringify(planYaniti()), { status: 200 });
    }) as typeof fetch;
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl, eventSourceImpl: server.EventSource });
    const plan = await source.worldPlan!(cfg);
    expect(plan.firms.total).toBe(124);
    expect(calls[0]!.url).toMatch(/\/api\/world\/plan$/);
    expect(calls[0]!.init?.method).toBe("POST");
    const govde = JSON.parse(String(calls[0]!.init?.body)) as { config: Record<string, unknown> };
    expect(Object.keys(govde)).toEqual(["config"]);
    expect(govde.config.values).toEqual({ isletme_sayisi: 30 });
    expect(govde.config).not.toHaveProperty("schedule");
    expect(govde.config).not.toHaveProperty("fastForwardTo");
    source.dispose();
  });

  it.each([[422, "invalid"], [500, "hata.sunucu_bozuk"]] as const)("durum_%i_hata_kodu_%s", async (status, kod) => {
    const server = createFakeLiveServer();
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: status === 422 ? "invalid_config" : "plan_failed", fields: [] } }), { status })) as typeof fetch;
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl, eventSourceImpl: server.EventSource });
    const err = await source.worldPlan!(cfg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimUnsupported);
    expect((err as SimUnsupported).message).toBe(kod);
    source.dispose();
  });
});

describe("D8 işletme sayısı göstergesi", () => {
  const SEHIR = { index: 0, served: 0.9, employed: 10, unemployed: 2, cash: 5, firms_npc: 3, firms_player: 1, rent_pct: null, occupancy: null, tenants_per_house: null, migration_in: 0, migration_out: 1 };

  it("dunya_ve_sehir_firms_total_istege_bagli_bozuk_tur_wire_hatasi", () => {
    const p = packetOf("r", 1, 1);
    expect(parsePacket({ ...p, world: { ...p.world, firms_total: 541 } }).world.firms_total).toBe(541);
    expect(parsePacket(JSON.parse(JSON.stringify(p))).world.firms_total ?? null).toBeNull();
    expect(() => parsePacket({ ...p, world: { ...p.world, firms_total: "x" } })).toThrow(WireError);
    expect(parsePacket({ ...p, cities: [{ ...SEHIR, firms_total: 4 }] }).cities![0]!.firms_total).toBe(4);
    expect(parsePacket({ ...p, cities: [SEHIR] }).cities![0]).not.toHaveProperty("firms_total");
    expect(() => parsePacket({ ...p, cities: [{ ...SEHIR, firms_total: "x" }] })).toThrow(WireError);
  });

  it("firms_total_yoksa_yerlesik_ve_oyuncu_isletmesinden_turetilir", () => {
    const w = packetOf("r", 1, 1).world;
    expect(isletmeSayisi({ ...w, npc_firms: 400, player_firms: 20 })).toBe(420);
    expect(isletmeSayisi({ ...w, npc_firms: 400, player_firms: 20, firms_total: 421 })).toBe(421);
    expect(isletmeSayisi({ ...w, npc_firms: null, player_firms: null })).toBeNull();
  });

  it("karne_ozeti_ilk_son_isletme_doluluk_ve_acilis_kadrosu", () => {
    const hafta = (n: number, d: object) => { const p = packetOf("r", n, 1); return { ...p, world: { ...p.world, npc_firms: null, player_firms: null, ...d } }; };
    const o = kurulumOzeti([hafta(1, { firms_total: 120, staff_fill: 0.8, opening_staff: 2663 }), hafta(2, { firms_total: 130, staff_fill: 0.7, opening_staff: 2663 })]);
    expect(o).toEqual({ isletme: { ilk: 120, son: 130 }, doluluk: { ilk: 0.8, son: 0.7 }, acilis: 2663 });
    expect(kurulumOzeti([hafta(1, {})])).toEqual({ isletme: null, doluluk: null, acilis: null });
  });
});

describe("D8 yeni ayarlar tarif, kütüphane ve Kurucu taslağında taşınır", () => {
  const D7: ValuesPatch = {
    baslangic_istihdami: 48, isletme_sayisi: 30, acilis_konut_stoku: "acilis_kadrosu", kapasite_buyume_tavani: "acilis_kapasitesi",
    isletme_kapasitesi: { kip: "elle", pay: 125, en_az: 25, hammadde: 300, imalat: 120, hizmet: 50, lojistik: 400 },
    acilis_talebi: { tahmin: "tutarli", stok: 2 }, npc_baslangic_nakdi: 1, nufus_olcegi: true,
  };
  const durum: RunState = { runId: "r", status: "ended", week: 20, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 2, scenarioId: "dayanikli_taban", name: "A", cityNames: ["1", "2", "3", "4", "5"], values: D7 };

  it("tarifOf_taslakOf_kurucuya_aynen_tasir", () => {
    const tarif = tarifOf(durum);
    expect(tarif.values).toEqual(D7);
    expect(taslakOf(tarif, tarif.values).values).toEqual(D7);
  });

  it("tarif_kodu_gidis_donus_ve_kutuphane_girdisi", () => {
    const tarif = tarifOf(durum);
    const kod = encodeRecipe(tarif);
    expect(kod.ok).toBe(true);
    const dec = decodeRecipe((kod as { ok: true; code: string }).code);
    expect(dec.ok && dec.recipe.values).toEqual(D7);
    const giris = parseEntry({ id: "k1", name: "Kayıt", recipe: dec.ok ? dec.recipe : null, savedAt: new Date().toISOString(), source: "live" });
    expect(giris.ok && giris.run.recipe.values).toEqual(D7);
  });
});
