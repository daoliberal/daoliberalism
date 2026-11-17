import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainPacket, packet } from "../helpers/sehirZincirVeri";
import { ayrintilariAc, ayrintilarHazir, mountCanli, packets, state, week } from "../helpers/canliMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** İlk hafta (kare sınırlı) ekrana geldi ve Ayrıntılar penceresi `sekme` sekmesinde açık. */
const hazir = async (sekme = "Genel"): Promise<void> => {
  await ayrintilarHazir(sekme);
};

describe("W9a canlı görünümler (Ayrıntılar penceresi)", () => {
  it("table_mode_same_data_as_chart", async () => {
    const script = [state({ week: 4 }), ...[1, 2, 3, 4].map((w) => week(packet(w, { world: { served: 0.5 + w / 100, unemployment_rate: 0.05 + w / 100 } })))];
    mountCanli(script);
    await hazir();
    expect(document.querySelector("[data-seri='served']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tablo olarak göster" }));
    const tablo = await screen.findByRole("table", { name: /Talep karşılama/ });
    expect(document.querySelector("[data-seri='served']")).toBeNull();
    const satirlar = within(tablo).getAllByRole("row").slice(1);
    expect(satirlar).toHaveLength(4);
    const hucre = (r: number) => within(satirlar[r]!).getAllByRole("cell").map((c) => c.textContent);
    expect(hucre(0).slice(0, 3)).toEqual(["4", "%54", "%9"]); // en yeni hafta üstte
    expect(hucre(3).slice(0, 3)).toEqual(["1", "%51", "%6"]);
    fireEvent.click(screen.getByRole("button", { name: "Grafik olarak göster" }));
    expect(document.querySelector("[data-seri='served']")).toBeTruthy();
  });

  it.each([
    [3, 0.1, "ok"], [10, 0.6, "warn"], [30, 0.4, "bad"], [30, 0.8, "ok"], [10, null, "none"],
  ] as const)("health_header_levels_%i_%s", async (w, served, level) => {
    mountCanli([state({ week: w }), week(packet(w, { world: { served } }))]);
    await hazir();
    const baslik = await screen.findByRole("region", { name: "Sağlık başlığı" });
    expect(baslik).toHaveAttribute("data-seviye", level);
    const metin = { ok: "Sağlıklı", warn: "Uyarı", bad: "Çöküş", none: "ölçülmüyor" }[level];
    expect(baslik.textContent).toContain(metin);
  });

  it("health_header_names_worst_city_and_scarce_link", async () => {
    mountCanli([state(), ...packets(3)]);
    await hazir();
    const baslik = await screen.findByRole("region", { name: "Sağlık başlığı" });
    expect(baslik.textContent).toContain("Efe"); // en düşük karşılama
    expect(within(baslik).getByRole("button", { name: /En kıt halka/ }).textContent).toContain("Un değirmeni");
  });

  it("market_panel_inflation_before_week_66_and_nulls", async () => {
    mountCanli([state(), ...packets(3, { world: { inflation_yoy: null, policy_inflation: 0.03, wage_index: 104, house_index: 100, deposit_rate: null } })]);
    await hazir("Piyasa ve iş");
    const panel = await screen.findByRole("region", { name: "Piyasa" });
    expect(panel.textContent).toContain("66. haftadan itibaren");
    expect(panel.textContent).toContain("%3");
    expect(within(panel).getByText("Mevduat faizi (haftalık)").closest("[data-piyasa]")!.textContent).toContain("ölçülmüyor");
  });

  it("board_off_shows_reason", async () => {
    window.location.hash = "#/canli/r/zincir";
    mountCanli([state(), ...packets(3, { chain: chainPacket({}, false) })]);
    expect(await screen.findByText(/Sektör panosu kapalı/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "En kıt halkalar" })).toBeNull();
  });

  it("replay_zincir_sekmesi_kilitli_neden_gorunur", async () => {
    mountCanli([state(), ...packets(3, { cities: null, chain: null })], { kind: "replay", caps: {}, world: undefined, drawer: undefined });
    await ayrintilariAc("Zincir");
    expect(screen.getByText("Bu kayıtta zincir bilgisi yok")).toBeInTheDocument();
    // Kayıt kaynağında şehir kırılımı yok: pencerede şehir kapsamı seçici çizilmez (yalnız dünya).
    fireEvent.click(screen.getByRole("tab", { name: "Genel" }));
    expect(screen.queryByRole("group", { name: "Kapsam" })).toBeNull();
  });

  it("deposit_and_bond_labels_say_weekly", async () => {
    mountCanli([state(), ...packets(3)]);
    await hazir("Piyasa ve iş");
    const panel = await screen.findByRole("region", { name: "Piyasa" });
    expect(within(panel).getByText("Mevduat faizi (haftalık)")).toBeTruthy();
    expect(within(panel).getByText("Tahvil faizi (haftalık)")).toBeTruthy();
  });

  it("trend_threshold_is_correct_for_negative_values", async () => {
    const script = [state({ week: 14 }), ...Array.from({ length: 14 }, (_, i) => week(packet(i + 1, { world: { inflation_yoy: i === 0 ? -0.02 : i === 13 ? -0.0201 : -0.02 } })))];
    mountCanli(script);
    await hazir("Piyasa ve iş");
    const satir = document.querySelector("[data-piyasa='enflasyon']") as HTMLElement;
    await waitFor(() => expect(satir.textContent).toContain("değişmedi"));
    expect(satir.textContent).not.toContain("▼");
  });

  it("table_header_has_no_double_unit_and_names_range", async () => {
    mountCanli([state(), ...packets(3)]);
    await hazir();
    fireEvent.click(screen.getByRole("button", { name: "Tablo olarak göster" }));
    const tablo = await screen.findByRole("table", { name: /son 10 hafta/ });
    expect(within(tablo).getByRole("columnheader", { name: "Kasa" })).toBeTruthy();
  });

});
