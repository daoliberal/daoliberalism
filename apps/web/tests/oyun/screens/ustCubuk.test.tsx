import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { OyunRoute } from "@/oyun/hooks/useHashRoute";
import { spriteHatasiYaz } from "@/oyun/harita/gorunumDurumu";
import { UstCubuk } from "@/oyun/screens/ortak/UstCubuk";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState, SimEvent } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";

const mk = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: {
    runId: "r", status: "paused", week: 12, durationWeeks: 200, speed: 1, computing: false, version: 2, seedIndex: 0, values: {},
    scenarioId: "x", name: "Ada", cityNames: [], ...over,
  },
});
const tercih = () => ({ tema: "light" as const, toggleTema: vi.fn(), azalt: false, etkinAzalt: false, toggleAzalt: vi.fn(), dusukPerformans: false, toggleDusukPerformans: vi.fn(), gorunum: null as "izo" | "klasik" | null, setGorunum: vi.fn() });

function ac(route: OyunRoute, script: SimEvent[], p = tercih()) {
  render(
    <SimSourceProvider source={createFakeSource(script)}>
      <UstCubuk route={route} tercih={p} />
    </SimSourceProvider>,
  );
  return p;
}
const dugme = (k: Parameters<typeof t>[0]) => screen.queryByRole("button", { name: t(k) });

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  spriteHatasiYaz(false);
  window.history.replaceState(null, "", "/");
});

describe("UstCubuk", () => {
  it("ust_cubuk_chips_and_buttons_by_context", async () => {
    ac({ name: "canli", runId: "r" }, [mk()]);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(t("ustcubuk.sart", { n: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("ustcubuk.saat_durdu"))).toBeInTheDocument();
    expect(screen.getByText(/^Dünya:/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: t("ustcubuk.menu") })).toBeInTheDocument();
    for (const k of ["ustcubuk.sart_dugme", "ustcubuk.gunluk", "ustcubuk.ara_durum", "ustcubuk.kosular", "ustcubuk.tema_koyu", "ustcubuk.hareket_azalt"] as const) expect(dugme(k)).toBeInTheDocument();
    expect(dugme("ustcubuk.canli")).toBeNull(); // zaten Canlı Dünya'da
    expect(dugme("canli.sifirla.baslik")).toBeInTheDocument(); // yalnız Canlı Dünya'da
  });

  it("sonuc_rotasinda_canli_dunya_ve_hafta_cipi", async () => {
    ac({ name: "sonuc", runId: "r" }, [mk({ status: "ended", week: 200 })]);
    expect(await screen.findByText(t("ustcubuk.hafta", { n: 200, toplam: 200 }))).toBeInTheDocument();
    expect(dugme("ustcubuk.canli")).toBeInTheDocument();
    expect(dugme("ustcubuk.sonuc")).toBeInTheDocument();
    fireEvent.click(dugme("ustcubuk.canli")!);
    expect(window.location.hash).toBe("#/canli/r");
  });

  it("koşusuz_rotada_yalniz_genel_dugmeler", () => {
    ac({ name: "kurucu" }, []);
    expect(screen.getByText(t("ustcubuk.adsiz"))).toBeInTheDocument();
    expect(dugme("ustcubuk.sart_dugme")).toBeNull();
    expect(dugme("ustcubuk.gunluk")).toBeNull();
    expect(dugme("ustcubuk.kosular")).toBeInTheDocument();
    fireEvent.click(dugme("ustcubuk.kosular")!);
    expect(window.location.hash).toBe("#/kosular");
  });

  it("sart_ve_gunluk_diyaloglari_acilir", async () => {
    ac({ name: "canli", runId: "r" }, [mk()]);
    await screen.findByText("Ada");
    dugme("ustcubuk.gunluk")!.focus(); // tarayıcıda tıklama odağı da taşır
    fireEvent.click(dugme("ustcubuk.gunluk")!);
    expect(screen.getByRole("dialog", { name: t("ustcubuk.gunluk") })).toBeInTheDocument();
    expect(screen.getByText(t("ustcubuk.gunluk_bos"))).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dugme("ustcubuk.gunluk")).toHaveFocus();
    fireEvent.click(dugme("ustcubuk.sart_dugme")!);
    expect(screen.getByRole("dialog", { name: /Ekonomi Şartı/ })).toBeInTheDocument();
  });

  it("tema_ve_hareket_dugmeleri", async () => {
    const p = ac({ name: "kosular" }, []);
    fireEvent.click(dugme("ustcubuk.tema_koyu")!);
    expect(p.toggleTema).toHaveBeenCalled();
    const h = dugme("ustcubuk.hareket_azalt")!;
    expect(h).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(h);
    expect(p.toggleAzalt).toHaveBeenCalled();
    await waitFor(() => expect(h).toBeInTheDocument());
  });
});

describe("Düşük performans düğmesi", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); localStorage.removeItem("oyun.gorunum"); });
  it("klasik_gorunumde_yok", () => {
    window.history.replaceState(null, "", "/?gorunum=klasik");
    ac({ name: "kosular" }, []);
    expect(dugme("ustcubuk.dusuk_performans")).toBeNull();
  });
  it("izo_gorunumde_var_ve_tiklaninca_anahtari_cevirir", () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    const p = ac({ name: "kosular" }, []);
    const d = dugme("ustcubuk.dusuk_performans")!;
    expect(d).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(d);
    expect(p.toggleDusukPerformans).toHaveBeenCalled();
  });
});

describe("UstCubuk parçaları", () => {
  it("parcalar_ayri_bilesen_olarak_bulunur", async () => {
    const m = await import("@/oyun/screens/ortak/UstCubuk");
    expect(typeof m.UstCipler).toBe("function");
    expect(typeof m.UstMenu).toBe("function");
    expect(typeof m.TercihDugmeleri).toBe("function");
  });
  it("menu_tek_basina_cizilir", async () => {
    const { UstMenu } = await import("@/oyun/screens/ortak/UstCubuk");
    render(
      <SimSourceProvider source={createFakeSource([mk()])}>
        <UstMenu route={{ name: "canli", runId: "r" }} tercih={tercih()} />
      </SimSourceProvider>,
    );
    expect(await screen.findByRole("button", { name: t("ustcubuk.gunluk") })).toBeInTheDocument();
    expect(screen.queryByText("Ada")).toBeNull();
  });
  it("gorunum_dugmesi_sade_eski_ve_sehir_yeni_arasinda_degistirir", () => {
    const p = ac({ name: "kurucu" }, [], { ...tercih(), gorunum: "klasik" as const });
    fireEvent.click(screen.getByRole("button", { name: "Görünüm: Sade (eski)" }));
    expect(p.setGorunum).toHaveBeenCalledWith("izo");
    cleanup();
    const v = ac({ name: "kurucu" }, []);                                                   // belirtilmemiş = şehir (varsayılan izo)
    fireEvent.click(screen.getByRole("button", { name: "Görünüm: Şehir (yeni)" }));
    expect(v.setGorunum).toHaveBeenCalledWith("klasik");
    cleanup();
    const q = { ...tercih(), gorunum: "izo" as const };
    ac({ name: "kurucu" }, [], q);
    fireEvent.click(screen.getByRole("button", { name: "Görünüm: Şehir (yeni)" }));
    expect(q.setGorunum).toHaveBeenCalledWith("klasik");
    expect(screen.getByRole("button", { name: t("ustcubuk.dusuk_performans") })).toBeInTheDocument();   // yalnız şehir görünümünde
  });

  it("gorunum_dugmesi_etkin_modu_gosterir_sprite_hatasiyla_dusulmusse_sade", () => {
    spriteHatasiYaz(true);
    ac({ name: "kurucu" }, [], { ...tercih(), gorunum: "izo" as const });
    expect(screen.getByRole("button", { name: "Görünüm: Sade (eski)" })).toBeInTheDocument();
  });

  it("gorunum_dugmesi_url_bayragini_da_yansitir", () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    ac({ name: "kurucu" }, []);
    expect(screen.getByRole("button", { name: "Görünüm: Şehir (yeni)" })).toBeInTheDocument();
  });
});
