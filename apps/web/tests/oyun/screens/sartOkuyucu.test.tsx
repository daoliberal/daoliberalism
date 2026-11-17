import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { SartOkuyucu } from "@/oyun/screens/ortak/SartOkuyucu";
import { formatValue } from "@/oyun/sim/formatValue";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Registry, RunState, ValuesPatch } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { contractRegistry } from "../helpers/registryFixtures";

afterEach(cleanup);

const reg = contractRegistry();
const faiz = reg.cards.find((c) => c.id === "ornek_faiz")!;
/** Sözleşme: `versions[].values` TAM değer kümesidir (yama değil). */
const tam = (over: ValuesPatch): ValuesPatch => ({ ...Object.fromEntries(reg.cards.map((c) => [c.id, c.default])), ...over });
const state = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 12, durationWeeks: 200, speed: 1, computing: false, version: 2, seedIndex: 0,
  values: tam({ ornek_faiz: 0.4 }), scenarioId: "x", name: "Ada", cityNames: [],
  versions: [
    { version: 1, fromWeek: 0, values: tam({ ornek_faiz: 0.3 }) },
    { version: 2, fromWeek: 8, values: tam({ ornek_faiz: 0.4 }) },
  ],
  ...over,
});

function ac(s: RunState = state()) {
  return render(
    <SimSourceProvider source={createFakeSource([])}>
      <SartOkuyucu state={s} onKapat={() => {}} />
    </SimSourceProvider>,
  );
}

describe("SartOkuyucu", () => {
  it("sart_okuyucu_version_pick_and_diff", async () => {
    ac();
    const d = screen.getByRole("dialog");
    expect(within(d).getByRole("heading", { name: t("okuyucu.baslik", { ad: "Ada", n: 2, hafta: 8 }) })).toBeInTheDocument();
    const v1 = screen.getByRole("button", { name: "v1" });
    const v2 = screen.getByRole("button", { name: "v2" });
    expect(v2).toHaveAttribute("aria-pressed", "true");
    expect(v1).toHaveAttribute("aria-pressed", "false");
    // tam metin: kart başlığı ve biçimlenmiş değer
    await waitFor(() => expect(within(d).getByText("Örnek faiz")).toBeInTheDocument());
    expect(within(d).getAllByText(formatValue(faiz.control, 0.4, reg.units)).length).toBeGreaterThan(0);
    // fark
    fireEvent.click(screen.getByRole("button", { name: t("okuyucu.fark_ac", { a: 1, b: 2 }) }));
    expect(screen.getByText(t("okuyucu.fark_baslik", { a: 1, b: 2, hafta: 8 }))).toBeInTheDocument();
    expect(screen.getByText(t("okuyucu.fark_deger", { eski: formatValue(faiz.control, 0.3, reg.units), yeni: formatValue(faiz.control, 0.4, reg.units) }))).toBeInTheDocument();
    expect(screen.getByText(t("okuyucu.fark_no", { n: 1 }))).toBeInTheDocument();
    // sürüm 1: fark yok
    fireEvent.click(v1);
    expect(screen.getByRole("heading", { name: t("okuyucu.baslik", { ad: "Ada", n: 1, hafta: 0 }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("okuyucu.ilk_surum") })).toBeDisabled();
    expect(screen.queryByText(t("okuyucu.fark_no", { n: 1 }))).toBeNull();
  });

  it("surum_listesi_yoksa_tek_surum_olarak_okur", async () => {
    ac(state({ versions: undefined, version: 1, values: tam({ ornek_faiz: 0.3 }) }));
    expect(screen.getByRole("button", { name: "v1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: t("okuyucu.ilk_surum") })).toBeDisabled();
    await waitFor(() => expect(screen.getByText("Örnek faiz")).toBeInTheDocument());
  });

  it("degisen_deger_isaretlenir", async () => {
    ac();
    await waitFor(() => expect(screen.getByText("Örnek faiz")).toBeInTheDocument());
    expect(screen.getAllByText(t("okuyucu.degisen")).length).toBeGreaterThan(0);
  });

  it("senaryo_bandi_gorunur_ve_sarta_dahil_degil_der", async () => {
    ac();
    expect(screen.getByText(t("okuyucu.senaryo", { ad: t("ustcubuk.dunya_varsayilan") }))).toBeInTheDocument();
    cleanup();
    ac(state({ worldScenarioId: "yok_boyle" }));
    expect(screen.getByText(t("okuyucu.senaryo", { ad: "yok_boyle" }))).toBeInTheDocument();
  });

  it("yukleniyor_durumu_okuyucu_metniyle", () => {
    ac();
    expect(screen.getByText(t("okuyucu.yukleniyor"))).toBeInTheDocument();
  });

  it("grup_basliklari_ve_satir_numaralari", async () => {
    ac();
    // Numara kataloğun tam sırasındaki yerdir (N2); fikstürdeki grup sırası değişse de test onu kayıttan okur.
    const no = (id: string): number => [...reg.groups].sort((x, y) => x.order - y.order).findIndex((g) => g.id === id) + 1;
    const baslik = (id: string): string => reg.groups.find((g) => g.id === id)!.title;
    await waitFor(() => expect(screen.getByRole("heading", { name: t("okuyucu.grup", { n: no("kurtarma"), ad: baslik("kurtarma") }) })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: t("okuyucu.grup", { n: no("vergi"), ad: baslik("vergi") }) })).toBeInTheDocument();
    expect(screen.getByText(t("okuyucu.no", { g: no("kurtarma"), k: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("okuyucu.no", { g: no("vergi"), k: 1 }))).toBeInTheDocument();
  });

  it("satir_basina_canlilik_rozeti_apply_den", async () => {
    ac();
    await waitFor(() => expect(screen.getByText("Örnek faiz")).toBeInTheDocument());
    const satir = (ad: string) => screen.getByText(ad).closest("li")!;
    expect(within(satir("Örnek faiz")).getByText(t("okuyucu.rozet_start_only"))).toBeInTheDocument();
    expect(within(satir("Örnek tutar")).getByText(t("okuyucu.rozet_unknown"))).toBeInTheDocument();
    expect(within(satir("Örnek anahtar")).getByText(t("okuyucu.rozet_live"))).toBeInTheDocument();
  });

  it("toleransli_esitlik_kayan_nokta_artigi_fark_sayilmaz", async () => {
    ac(state({ versions: [
      { version: 1, fromWeek: 0, values: tam({ ornek_faiz: 0.3 }) },
      { version: 2, fromWeek: 8, values: tam({ ornek_faiz: 0.30000000000001 }) },
    ] }));
    await waitFor(() => expect(screen.getByText("Örnek faiz")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: t("okuyucu.fark_ac", { a: 1, b: 2 }) }));
    expect(screen.getByText(t("okuyucu.fark_yok"))).toBeInTheDocument();
  });

  function acReg(r: Registry) {
    const base = createFakeSource([]);
    const source = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { registry: async () => r });
    const v = Object.fromEntries(r.cards.map((c) => [c.id, c.default]));
    return render(
      <SimSourceProvider source={source}>
        <SartOkuyucu state={state({ values: v, versions: undefined, version: 1 })} onKapat={() => {}} />
      </SimSourceProvider>,
    );
  }
  const kart = (id: string, group: string, extra: Partial<Registry["cards"][number]> = {}): Registry["cards"][number] => ({ ...faiz, id, title: `Kart ${id}`, group, ...extra });

  it("bos_grup_suzulse_de_numaralar_katalog_sirasini_korur", async () => {
    acReg({
      ...reg,
      groups: [{ id: "a", order: 1, title: "Birinci" }, { id: "b", order: 2, title: "Boş grup" }, { id: "c", order: 3, title: "Üçüncü" }],
      cards: [kart("k1", "a"), kart("k2", "c")],
    });
    await waitFor(() => expect(screen.getByText("Kart k1")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: t("okuyucu.grup", { n: 1, ad: "Birinci" }) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("okuyucu.grup", { n: 3, ad: "Üçüncü" }) })).toBeInTheDocument();
    expect(screen.getByText(t("okuyucu.no", { g: 3, k: 1 }))).toBeInTheDocument();
  });

  it("diger_grubu_numarasiz_ve_14_den_sonrasi_numarasiz", async () => {
    const groups = Array.from({ length: 15 }, (_, i) => ({ id: `g${i}`, order: i, title: `Grup ${i + 1}` }));
    acReg({ ...reg, groups, cards: [kart("k1", "g0"), kart("k15", "g14"), kart("kx", "bilinmeyen")] });
    await waitFor(() => expect(screen.getByText("Kart k1")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Grup 15" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("okuyucu.diger") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("okuyucu.grup", { n: 1, ad: "Grup 1" }) })).toBeInTheDocument();
  });

  it("pasif_kartta_modelde_henuz_yok_bir_kez_gorunur", async () => {
    acReg({ ...reg, groups: [{ id: "a", order: 1, title: "Birinci" }], cards: [kart("p1", "a", { status: "passive", apply: "passive" })] });
    await waitFor(() => expect(screen.getByText("Kart p1")).toBeInTheDocument());
    expect(screen.getAllByText(t("rozet.passive"))).toHaveLength(1);
  });
});
