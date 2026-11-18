import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { RunState, SimEvent } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { worldOf } from "../helpers/sehirZincirVeri";

/**
 * B8: tarayici kipinde (derleme bayragi) sunucuya/arka plan islerine bagli ekranlar gizlenir; sunucu ve bayraksiz derlemede AYNI ekranlar bugunku gibi gorunur.
 * Bayrak derleme zamani sabiti: her senaryoda modul sifirlanip yeniden alinir.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  window.location.hash = "";
  window.localStorage.clear();
});
beforeEach(() => {
  window.localStorage.clear();
});

async function yukle(bayrak: "tarayici" | ""): Promise<{ Sonuc: typeof import("@/oyun/screens/sonuc/Sonuc").Sonuc; SimSourceProvider: typeof import("@/oyun/sim/SimSourceContext").SimSourceProvider }> {
  vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", bayrak);
  vi.resetModules();
  const [{ Sonuc }, { SimSourceProvider }] = await Promise.all([import("@/oyun/screens/sonuc/Sonuc"), import("@/oyun/sim/SimSourceContext")]);
  return { Sonuc, SimSourceProvider };
}

async function sonucAc(bayrak: "tarayici" | ""): Promise<void> {
  const { Sonuc, SimSourceProvider } = await yukle(bayrak);
  const world = worldOf({ served: 0.9, city_cash_total: 50000, city_cash_weeks: 5, gini: 0.5, failed_cum: 0, failed_total_cum: 0 });
  const state: RunState = { runId: "r", status: "paused", week: 10, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "dayanikli_taban", name: "Deneme", cityNames: ["a", "b", "c", "d", "e"] };
  const script: SimEvent[] = [
    { type: "state", state },
    ...Array.from({ length: 10 }, (_, i): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week: i + 1, version: 1, world, events: [] } })),
  ];
  const src = createFakeSource(script, { kind: "live", caps: { jobs: true }, startJob: vi.fn(async () => "j"), listRuns: vi.fn(async () => []) });
  render(
    <SimSourceProvider source={src}>
      <Sonuc runId="r" restore={{ status: "ready" }} />
    </SimSourceProvider>,
  );
}

describe("Sonuc ekrani: yetenek listesi", () => {
  it("sunucu_kipinde_alti_dunya_ve_AB_karsilastirma_bugunku_gibi_gorunur", async () => {
    await sonucAc("");
    expect(await screen.findByRole("heading", { name: t("sonuc.dunya.baslik") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("sonuc.ab.baslik") })).toBeInTheDocument();
  });

  it("tarayici_kipinde_alti_dunya_AB_ve_yayinla_YOK_oyun_ici_sonuc_ozeti_VAR", async () => {
    await sonucAc("tarayici");
    expect(await screen.findByText(t("sonuc.canli"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("sonuc.dunya.baslik") })).toBeNull();
    expect(screen.queryByRole("heading", { name: t("sonuc.ab.baslik") })).toBeNull();
    expect(screen.queryByText(t("yayinla.dugme"), { exact: false })).toBeNull();
    expect(screen.queryByText(t("sonuc.is.yok_yetenek"))).toBeNull();
  });
});

describe("DAO paylasilan dunya rotasi", () => {
  it("tarayici_kipinde_bu_baglanti_bu_surumde_acilamaz_bilgisi_Baslangica_doner", async () => {
    vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", "tarayici");
    vi.resetModules();
    const { DaoEkrani } = await import("@/oyun/screens/dao/DaoEkrani");
    render(<DaoEkrani route={{ name: "dao", dunya: "KOD" }} />);
    expect(screen.getByRole("heading", { name: t("tarayici.acilamaz.baslik") })).toBeVisible();
    expect(screen.getByText(t("tarayici.acilamaz.dunya"))).toBeVisible();
    window.location.hash = "#/dao/d/KOD";
    screen.getByRole("button", { name: t("tarayici.acilamaz.baslangic") }).click();
    expect(window.location.hash).toBe("#/");
  });
});
