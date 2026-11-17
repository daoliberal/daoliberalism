import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Baslangic } from "@/oyun/screens/baslangic/Baslangic";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import { createFakeSource } from "../helpers/fakeSource";

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("Baslangic", () => {
  it("baslangic_uc_kart_ve_alt_sira", () => {
    render(
      <SimSourceProvider source={createFakeSource([])}>
        <Baslangic />
      </SimSourceProvider>,
    );
    for (const ad of ["baslangic.kurucu_ad", "baslangic.dao_ad", "baslangic.evren_ad"] as const) {
      expect(screen.getByRole("heading", { level: 2, name: t(ad) })).toBeInTheDocument();
    }
    for (const ac of ["baslangic.kurucu_ac", "baslangic.dao_ac", "baslangic.evren_ac"] as const) {
      expect(screen.getByText(t(ac))).toBeInTheDocument();
    }
    // Tema düğmesi giriş kabuğundadır (GirisKabi), kartlarda değil.
    expect(screen.queryByRole("button", { name: t("ustcubuk.tema_koyu") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("baslangic.kosular") })).toBeNull();
  });

  it("evren_dugmesi_kapali_ve_yakinda_rozeti_var", () => {
    render(
      <SimSourceProvider source={createFakeSource([])}>
        <Baslangic />
      </SimSourceProvider>,
    );
    const evren = screen.getByRole("group", { name: t("baslangic.evren_ad") });
    expect(within(evren).getByRole("button", { name: t("baslangic.yakinda") })).toBeDisabled();
    expect(within(evren).queryByRole("link")).toBeNull();
  });

  it("baslangic_buttons_navigate", async () => {
    const src = createFakeSource([]);
    src.listRuns = async () => [{ runId: "r", state: { runId: "r", status: "paused", week: 1, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "x", name: "A", cityNames: [] } }];
    render(
      <SimSourceProvider source={src}>
        <Baslangic />
      </SimSourceProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("baslangic.rehberli") }));
    expect(window.location.hash).toBe("#/kurucu/rehberli");
    fireEvent.click(screen.getByRole("button", { name: t("baslangic.kurucu_dugme") }));
    expect(window.location.hash).toBe("#/kurucu");
    fireEvent.click(screen.getByRole("button", { name: t("baslangic.dao_dugme") }));
    expect(window.location.hash).toBe("#/dao");
    fireEvent.click(await screen.findByRole("button", { name: t("baslangic.kosular") }));
    expect(window.location.hash).toBe("#/kosular");
    await waitFor(() => expect(screen.getByRole("button", { name: t("baslangic.kosular") })).toBeInTheDocument());
  });

  it("stil_baglantisi_yalniz_stil_onizleme_aciksa_cizilir", () => {
    const ac = () => {
      const v = render(
        <SimSourceProvider source={createFakeSource([])}>
          <Baslangic />
        </SimSourceProvider>,
      );
      return v;
    };
    vi.stubEnv("NODE_ENV", "production");
    const uretim = ac();
    expect(screen.queryByRole("link", { name: t("baslangic.stil") })).toBeNull();
    uretim.unmount();
    window.history.replaceState(null, "", "/oyun?stil=1");
    ac();
    expect(screen.getByRole("link", { name: t("baslangic.stil") })).toHaveAttribute("href", "#/stil");
  });
});
