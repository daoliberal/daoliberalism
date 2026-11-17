import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { detectEvents, newEventCtx } from "@/oyun/sim/eventRules";
import { iseAlimOzeti } from "@/oyun/sim/result";
import type { World } from "@/oyun/sim/types";
import { packet } from "../helpers/sehirZincirVeri";
import { mountCanli, packets, state, ayrintilarHazir } from "../helpers/canliMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** İlk haftalar geldi ve Ayrıntılar penceresi `sekme` sekmesinde açık. */
const hazir = async (sekme = "Piyasa ve iş"): Promise<void> => {
  await ayrintilarHazir(sekme);
};
const satir = (id: string) => document.querySelector(`[data-ise-alim="${id}"]`) as HTMLElement;
const dolu: Partial<World> = {
  players_total: 1510, players_new: 4, players_new_total: 10, players_in_ahir: 1200, ahir_capacity: 1500, ahir_fill: 0.85, npc_firm_npc: 800, npc_firm_players: 120,
  hired_player: 12, hired_npc: 30, fired_player: 3, fired_npc: 45, ahir_moves: 12, ahir_backfilled: 5, inflow_blocked: 0,
};

describe("D6 Canlı: işe alım ve ahır", () => {
  it("panel_dunya_gorunumunde_bolum_olarak_gorunur_ve_degerleri_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.ise_alim.baslik") });
    expect(panel.textContent).toContain(t("canli.ise_alim.alt"));
    expect(satir("toplam_oyuncu").textContent).toContain("1.510");
    expect(satir("yeni_hafta").textContent).toContain("4");
    expect(satir("yeni_toplam").textContent).toContain("10");
    expect(satir("ahir_oyuncu").textContent).toContain("1.200");
    expect(satir("ahir_doluluk").textContent).toContain("%85");
    expect(satir("firma_npc").textContent).toContain("800");
    expect(satir("firma_oyuncu").textContent).toContain("120");
    expect(satir("alinan_oyuncu").textContent).toContain("12");
    expect(satir("alinan_npc").textContent).toContain("30");
    expect(satir("cikan_oyuncu").textContent).toContain("3");
    expect(satir("cikan_npc").textContent).toContain("45");
    expect(satir("gecis").textContent).toContain("12");
    expect(satir("zincir").textContent).toContain("5");
    expect(within(panel).getByText(t("canli.ise_alim.zincir"))).toBeTruthy();
  });

  it("panel_issizlik_bolumunun_hemen_yaninda", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    const issizlik = await screen.findByRole("region", { name: t("canli.issizlik.baslik") });
    const iseAlim = await screen.findByRole("region", { name: t("canli.ise_alim.baslik") });
    expect(issizlik.nextElementSibling).toBe(iseAlim);
  });

  it("olculmeyen_alan_olculmuyor_der_ve_not_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: { players_total: null, ahir_fill: null, hired_npc: null } })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.ise_alim.baslik") });
    expect(satir("toplam_oyuncu").textContent).toContain("ölçülmüyor");
    expect(satir("ahir_doluluk").textContent).toContain("ölçülmüyor");
    expect(satir("alinan_npc").textContent).toContain("ölçülmüyor");
    expect(panel.textContent).toContain(t("canli.ise_alim.olculmuyor.live"));
  });

  it("sinira_takilan_katilim_satirda_gorunur", async () => {
    mountCanli([state(), ...packets(3, { world: { ...dolu, inflow_blocked: 6 } })]);
    await hazir();
    expect(satir("engel").textContent).toContain("6");
  });
});

describe("D6 olay kuralı", () => {
  it("katilim_siniri_bir_kez_ve_notr_olarak_tetiklenir", () => {
    const ctx = newEventCtx();
    const a = detectEvents(null, packet(5, { world: { inflow_blocked: 0 } }), ctx);
    expect(a.find((e) => e.rule_ids.includes("katilim_siniri"))).toBeUndefined();
    const b = detectEvents(null, packet(6, { world: { inflow_blocked: 3 } }), ctx);
    const e = b.find((x) => x.rule_ids.includes("katilim_siniri"));
    expect(e?.kind).toBe("neutral");
    expect(e?.critical).toBe(false);
    expect(e?.params).toEqual({ hafta: 6, sayi: 3 });
    expect(detectEvents(null, packet(7, { world: { inflow_blocked: 3 } }), ctx).find((x) => x.rule_ids.includes("katilim_siniri"))).toBeUndefined();
    expect(t("event.katilim_siniri", { hafta: 6, sayi: 3 })).toBe("Hf 6: yeni oyuncu katılımı toplam kişi sınırına ulaştı, 3 oyuncu katılamadı");
  });
});

describe("D6 karne özeti", () => {
  const w = (week: number, o: Partial<World>) => ({ ...packet(week, { world: o }) });
  it("oyuncu_artisi_ve_npc_istihdam_orani", () => {
    const weeks = [
      w(1, { players_total: 1500, players_new_total: 0, npc_employed: 2000, npc_pool: 3000 }),
      w(2, { players_total: 1520, players_new_total: 20, npc_employed: 1000, npc_pool: 4000 }),
      w(3, { players_total: 1550, players_new_total: 50, npc_employed: 2500, npc_pool: 2500 }),
    ];
    const o = iseAlimOzeti(weeks);
    expect(o.oyuncu).toEqual({ ilk: 1500, son: 1550, yeni: 50 });
    expect(o.npcIstihdam).toEqual({ ilk: 0.4, son: 0.5 });
  });
  it("olculmediyse_null", () => {
    expect(iseAlimOzeti([w(1, {}), w(2, {})])).toEqual({ oyuncu: null, npcIstihdam: null });
    expect(iseAlimOzeti([])).toEqual({ oyuncu: null, npcIstihdam: null });
    const eksik = iseAlimOzeti([w(1, { players_total: 1500 }), w(2, {})]);
    expect(eksik.oyuncu).toEqual({ ilk: 1500, son: 1500, yeni: 0 });           // yeni oyuncu ölçülmediyse 0: son ölçülen oyuncu sayısı
  });
});
