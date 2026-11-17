import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { akisOzeti } from "@/oyun/sim/result";
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
const hazir = async (sekme = "Nüfus ve para"): Promise<void> => {
  await ayrintilarHazir(sekme);
};
const satir = (id: string) => document.querySelector(`[data-akis="${id}"]`) as HTMLElement;
const dolu: Partial<World> = {
  hires: 42, separations: 51, quits_npc: 9, job_finding_rate: 0.05, unemployment_duration: 20, npc_discouraged: 300, muni_npc: 14,
};

describe("D10 Canlı: işgücü akışları", () => {
  it("panel_ise_alim_panelinin_hemen_yaninda_ve_degerleri_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.akis.baslik") });
    // İşe alım paneli artık Piyasa ve iş sekmesindedir; Nüfus ve para sekmesinde akış paneli nüfus panelinin hemen altındadır.
    const nufus = await screen.findByRole("region", { name: t("canli.nufus.baslik") });
    expect(nufus.nextElementSibling).toBe(panel);
    expect(panel.textContent).toContain(t("canli.akis.alt"));
    expect(satir("alim").textContent).toContain("42");
    expect(satir("ayrilma").textContent).toContain("51");
    expect(satir("kendiliginden").textContent).toContain("9");
    expect(satir("bulma").textContent).toContain("%5,0");
    expect(satir("sure").textContent).toContain("20");
    expect(satir("disarida").textContent).toContain("300");
    expect(satir("kamu").textContent).toContain("14");
    expect(within(panel).getByText(t("canli.akis.sure"))).toBeTruthy();
    expect(t("canli.akis.sure")).toBe("Ortalama işsizlik süresi (tahmin)");           // U19: ölçülen süre değil, 1 / iş bulma oranı tahmini
  });

  it("olculmeyen_alan_olculmuyor_der_ve_not_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: { hires: null, separations: null, job_finding_rate: null, unemployment_duration: null, npc_discouraged: null, muni_npc: null, quits_npc: null } })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.akis.baslik") });
    expect(satir("alim").textContent).toContain("ölçülmüyor");
    expect(satir("bulma").textContent).toContain("ölçülmüyor");
    expect(satir("sure").textContent).toContain("ölçülmüyor");
    expect(panel.textContent).toContain(t("canli.akis.olculmuyor.live"));
  });

  it("sure_tahmin_oldugunu_soyler", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    expect(t("canli.akis.sure.not")).toContain("tahmin");
    expect(satir("sure").textContent).toContain(t("canli.akis.sure.not"));
  });
});

describe("D10 karne özeti", () => {
  const w = (week: number, o: Partial<World>) => ({ ...packet(week, { world: o }) });
  it("ortalama_is_bulma_orani_sure_ve_toplam_akislar", () => {
    const o = akisOzeti([
      w(1, { job_finding_rate: null, hires: 0, separations: 0 }),
      w(2, { job_finding_rate: 0.04, unemployment_duration: 25, hires: 10, separations: 30 }),
      w(3, { job_finding_rate: 0.06, unemployment_duration: 16.7, hires: 20, separations: 25 }),
    ]);
    expect(o).not.toBeNull();
    expect(o!.isBulma).toBeCloseTo(0.05, 6);
    expect(o!.sure).toBeCloseTo(20.85, 6);
    expect(o!.alim).toBe(30);
    expect(o!.ayrilma).toBe(55);
  });
  it("olculmediyse_null", () => {
    expect(akisOzeti([w(1, {}), w(2, {})])).toBeNull();
    expect(akisOzeti([])).toBeNull();
  });
});
