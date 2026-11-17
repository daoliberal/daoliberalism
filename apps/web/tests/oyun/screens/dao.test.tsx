import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Baslangic } from "@/oyun/screens/baslangic/Baslangic";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { Kosular } from "@/oyun/screens/kosular/Kosular";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunHandle, RunState, SimSource } from "@/oyun/sim/types";
import { GOZLEM_AHIR } from "../helpers/daoVeri";
import { createFakeSource } from "../helpers/fakeSource";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const ADLAR = ["Közlüdere", "Yaldızova", "Bakırbük", "Demirpınar", "Taşyaka"];
const durum = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 3, durationWeeks: 520, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "canli", name: "Dünya", cityNames: ADLAR, mode: "dao", ...over,
});

beforeEach(() => {
  window.location.hash = "#/dao/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DaoGiris", () => {
  function giris(source: SimSource) {
    return render(
      <SimSourceProvider source={source}>
        <DaoEkrani route={{ name: "dao" }} />
      </SimSourceProvider>,
    );
  }
  const canli = () => {
    const src = createFakeSource([], { kind: "live" });
    const baslangic: RunHandle = { runId: "yeni", state: durum({ runId: "yeni", week: 0 }) };
    const start = vi.fn(async () => baslangic);
    const info = { kind: "live" as const, modelNote: "", seeds: [{ index: 2 }], durationWeeks: 200, settings: [], fixedRules: [], templates: [{ id: "dayanikli_taban", values: {} }], durations: [100, 200, 500, 520] };
    Object.assign(src, { start, info: async () => info, daoKarar: async () => ({ kabul: true, hafta: 1 }), daoGozlem: async () => GOZLEM_AHIR });
    return { src, start };
  };

  it("baslat_mode_dao_520_ile_kosu_kurar_ve_oyuna_gider", async () => {
    const { src, start } = canli();
    giris(src);
    expect(await screen.findByText(t("dao.kayit_notu"))).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: t("dao.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const cfg = (start.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(cfg).toMatchObject({ mode: "dao", durationWeeks: 520, templateId: "dayanikli_taban", seedIndex: 2, values: {} });
    expect(String(cfg.name).length).toBeGreaterThan(0);
    await waitFor(() => expect(window.location.hash).toBe("#/dao/yeni"));
  });

  it("baslatma_hatasi_metin_olur_ve_dugme_yeniden_acilir", async () => {
    const { src, start } = canli();
    start.mockRejectedValueOnce(new SimUnsupported("too_many_runs"));
    giris(src);
    fireEvent.click(await screen.findByRole("button", { name: t("dao.baslat") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("kurucu.baslat_hata_cok_kosu"));
    expect(screen.getByRole("button", { name: t("dao.baslat") })).toBeEnabled();
  });

  it("sunucu_yoksa_not_gosterir_ve_baslatilamaz", () => {
    giris(createFakeSource([], { kind: "replay" }));
    expect(screen.getByText(t("dao.sunucu_yok"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("dao.baslat") })).toBeNull();
  });
});

describe("DAO koşuları listelerde", () => {
  const dao: RunHandle = { runId: "canli-dao1", state: durum({ runId: "canli-dao1", name: "Benim DAO" }) };
  const kurucu: RunHandle = { runId: "canli-k1", state: durum({ runId: "canli-k1", name: "Kurucu dünya", mode: undefined }) };

  it("kosular_acik_dao_kosusunu_oyuna_baglar", async () => {
    window.location.hash = "#/kosular";
    const src = createFakeSource([], { kind: "live", listRuns: async () => [kurucu, dao] });
    render(
      <SimSourceProvider source={src}>
        <Kosular />
      </SimSourceProvider>,
    );
    const dugme = await screen.findByRole("button", { name: `${t("kosular.dao_ac")}: Benim DAO` });
    expect(screen.queryByRole("button", { name: `${t("kosular.dao_ac")}: Kurucu dünya` })).toBeNull();
    fireEvent.click(dugme);
    expect(window.location.hash).toBe("#/dao/canli-dao1");
  });

  it("baslangic_dao_kartinda_oyuna_don", async () => {
    window.location.hash = "";
    const src = createFakeSource([], { kind: "live", listRuns: async () => [dao, kurucu] });
    render(
      <SimSourceProvider source={src}>
        <Baslangic />
      </SimSourceProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("baslangic.dao_devam") }));
    expect(window.location.hash).toBe("#/dao/canli-dao1");
  });
});
