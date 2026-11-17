import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { OyunApp } from "@/oyun/OyunApp";
import { Canli } from "@/oyun/screens/canli/Canli";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { createFakeSource, type FakeSource } from "../helpers/fakeSource";
import { allFiles, makeFetch } from "../helpers/replayFixture";
import { ayrintilariAc } from "../helpers/canliMount";

// P-04: kaynak seçimi artık asenkron yoklar; bu test dosyası kayıt kaynağıyla çalışır (sunucu yok).
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const NULL_WORLD = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum"].map((k) => [k, null]),
) as World;

const wk = (week: number, world: Partial<World> = {}, version = 1): SimEvent => ({
  type: "week",
  packet: { v: 1, run_id: "r", week, version, world: { ...NULL_WORLD, served: 0.9, unemployment_rate: 0.1, ...world }, events: [] } as WeekPacket,
});
const st = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "kapali", name: "Ada", cityNames: [], ...over },
});
const ev = (id: string, week: number, over: Partial<WorldEvent> = {}): SimEvent => ({
  type: "world_event",
  event: { id, week, kind: "neutral", textKey: "event.destek_basladi", params: { hafta: week }, critical: false, sector: null, rule_ids: [], ...over },
});
const cokus = (w: number) => ev(`cokus:${w}`, w, { kind: "bad", critical: true, textKey: "event.cokus" });
const toparlanma = (w: number) => ev(`toparlanma:${w}`, w, { kind: "good", textKey: "event.toparlanma", params: { hafta: w, oran: 72 } });

function mount(script: SimEvent[], props: { runId?: string } = {}, opts: Parameters<typeof createFakeSource>[1] = {}) {
  const src = createFakeSource(script, opts);
  const control = vi.spyOn(src, "control");
  const ui = (runId: string) => (
    <SimSourceProvider source={src}>
      <Canli runId={runId} restore={{ status: "ready" }} />
    </SimSourceProvider>
  );
  const view = render(ui(props.runId ?? "r"));
  return { src, control, view, ui };
}
const emit = (src: FakeSource, ...es: SimEvent[]): void => {
  act(() => es.forEach((e) => src.emit("r", e)));
};
const btn = (name: string) => screen.getByRole("button", { name });
const strip = (id: string) => document.querySelector(`[data-olcu="${id}"]`) as HTMLElement;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.location.hash = "";
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  const calls = errSpy.mock.calls.map((c: unknown[]) => String(c[0]).slice(0, 300));
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  errSpy.mockRestore();
  expect(calls).toEqual([]);
});

describe("Canlı: Bu hafta şeridi", () => {
  it("yeni_hafta_serit_guncellenir_fark_glif_ve_isaretli_sayi", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { gini: 0.3, failed_total_cum: 4, served: 0.6, city_cash_total: 23000 }));
    await waitFor(() => expect(strip("gini")).toHaveTextContent("0,30"));
    emit(src, wk(2, { gini: 0.32, failed_total_cum: 3, served: 0.6, city_cash_total: 24000 }));
    await waitFor(() => expect(strip("gini")).toHaveTextContent(/▲ \+0,02 artış/));
    expect(strip("batan")).toHaveTextContent(/▼ −1 düşüş/);
    expect(strip("karsilama")).toHaveTextContent(/= 0 değişmedi/);
    expect(strip("kasa")).toHaveTextContent("24 bin");
    expect(strip("kasa")).toHaveTextContent(/▲ \+1 bin artış/);
    expect(screen.getAllByRole("definition").length).toBeGreaterThan(0);
  });

  it("dokuz_etiket", async () => {
    mount([st(), wk(1)]);
    await ayrintilariAc("Genel");
    for (const k of ["karsilama", "calisan", "issiz", "npc", "oyuncu", "batan", "batan_oyuncu", "kasa", "gini"] as const) {
      await waitFor(() => expect(strip(k)).toBeInTheDocument());
      expect(strip(k)).toHaveTextContent(t(`canli.sk.${k}`));
    }
  });

  it("batan_etiketleri_yerlesik_isletme_ve_oyuncu_isletmesi", async () => {
    mount([st(), wk(1)]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(strip("batan")).toBeInTheDocument());
    expect(strip("batan")).toHaveTextContent("Batan işletme (toplam)");
    expect(strip("batan_oyuncu")).toHaveTextContent("Batan oyuncu işletmesi (toplam)");
  });

  it("batan_oyuncu_satiri_deger_ve_fark", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { failed_cum: 4, failed_total_cum: 130, failed_player_cum: 120 }));
    await waitFor(() => expect(within(strip("batan_oyuncu")).getAllByRole("definition")[0]).toHaveTextContent("120"));
    emit(src, wk(2, { failed_cum: 4, failed_total_cum: 130, failed_player_cum: 133 }));
    await waitFor(() => expect(strip("batan_oyuncu")).toHaveTextContent(/▲ \+13 artış/));
    expect(within(strip("batan_oyuncu")).getAllByRole("definition")[0]).toHaveTextContent("133");
    expect(strip("batan")).toHaveTextContent(/= 0 değişmedi/);                                  // toplam sayaç ayrı
  });

  it("eski_kayitta_batan_oyuncu_olculmuyor", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { failed_cum: 4, failed_total_cum: 4 }), wk(2, { failed_cum: 5, failed_total_cum: 5 }));      // failed_player_cum alanı hiç yok (eski kayıt)
    await waitFor(() => expect(strip("batan")).toHaveTextContent(/▲ \+1 artış/));
    const [deger, fark] = within(strip("batan_oyuncu")).getAllByRole("definition");
    expect(deger!.textContent).toBe(t("canli.gosterge.olculmuyor"));
    expect(fark!.textContent).toBe("–");
  });

  it("served_null_dash_ve_grafik_cokmez", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { served: 0.6, gini: 0.3 }));
    await waitFor(() => expect(strip("karsilama")).toHaveTextContent("%60"));
    emit(src, wk(2, { served: null, gini: null }));
    await waitFor(() => expect(within(strip("karsilama")).getAllByRole("definition")[0]).toHaveTextContent("–"));
    // değer hücresi "–" (pct(null) "%0" olmamalı); fark da ölçülmeyen taraf nedeniyle "–"
    for (const id of ["karsilama", "gini"]) {
      const [deger, fark] = within(strip(id)).getAllByRole("definition");
      expect(deger!.textContent).toBe("–");
      expect(fark!.textContent).toBe("–");
    }
    expect(document.querySelector("svg[role=img]")).toBeInTheDocument();
  });

  it("tek_haftada_null_deger_hucresi_dash", async () => {
    mount([st(), wk(1, { served: null, gini: null })]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(strip("karsilama")).toBeInTheDocument());
    expect(within(strip("karsilama")).getAllByRole("definition")[0]!.textContent).toBe("–");
    expect(within(strip("gini")).getAllByRole("definition")[0]!.textContent).toBe("–");
  });

  it("issizlik_null_olculmuyor_ve_cokme_yok", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { unemployment_rate: null }), wk(2, { unemployment_rate: null }));
    await waitFor(() => expect(screen.getByText(t("seri.issiz_olculmuyor"))).toBeInTheDocument());
    expect(document.querySelector('[data-seri="unemployment"]')).toBeNull();
    expect(document.querySelector('[data-seri="served"]')).toBeInTheDocument();
  });

  it("baslik_issizlik_genis_orani_okur_null_ise_oyuncu_oranina_dusmez", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { unemployment_rate: 0.05, unemployment_rate_all: 0.6 }));
    const gost = (id: string) => document.querySelector(`[data-gosterge="${id}"]`) as HTMLElement;
    await waitFor(() => expect(within(gost("issiz")).getAllByRole("definition")[0]).toHaveTextContent("%60"));
    expect(gost("issiz")).toHaveTextContent("İşsizlik (genel");
    expect(within(gost("issiz_oyuncu")).getAllByRole("definition")[0]).toHaveTextContent("%5");
    expect(gost("issiz_oyuncu")).toHaveTextContent("İşsizlik (oyuncu)");
    emit(src, wk(2, { unemployment_rate: 0.05, unemployment_rate_all: null }));
    await waitFor(() => expect(within(gost("issiz")).getAllByRole("definition")[0].textContent).toBe(t("canli.gosterge.olculmuyor")));        // oyuncu oranına (%5) düşmez
    expect(within(gost("issiz_oyuncu")).getAllByRole("definition")[0]).toHaveTextContent("%5");
  });

  it("batan_toplam_kirilim_ipucunda_eski_kayitta_olculmuyor", async () => {
    const { src } = mount([st()]);
    await ayrintilariAc("Genel");
    emit(src, wk(1, { failed_cum: 3, failed_player_cum: 5, failed_dao_cum: 1, failed_npc_default_cum: 2, failed_total_cum: 11 }));
    await waitFor(() => expect(within(strip("batan")).getAllByRole("definition")[0]).toHaveTextContent("11"));
    expect(strip("batan").getAttribute("title")).toBe("Yerleşik 3 · oyuncu 5 · Ar-Ge DAO 1 · temerrüt 2");
    emit(src, wk(2, { failed_cum: 3 }));                                                                              // eski kayıt: toplam yok
    await waitFor(() => expect(within(strip("batan")).getAllByRole("definition")[0].textContent).toBe(t("canli.gosterge.olculmuyor")));
    expect(strip("batan").getAttribute("title")).toBeNull();
  });

  it("issizlik_olculuyorsa_iki_seri", async () => {
    mount([st(), wk(1), wk(2)]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(document.querySelector('[data-seri="unemployment"]')).toBeInTheDocument());
    expect(screen.queryByText(t("seri.issiz_olculmuyor"))).toBeNull();
  });
});

describe("Canlı: düzen ve saat", () => {
  it("bolum_sirasi_sekmelere_gore_prototipi_izler", async () => {
    mount([st(), wk(1)]);
    const pencere = await ayrintilariAc("Genel");
    const basliklar = () => within(pencere).getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((x) => x !== t("ayrintilar.baslik"));
    expect(basliklar()).toEqual([t("canli.bu_hafta"), t("canli.gostergeler")]);
    await ayrintilariAc("Piyasa ve iş");
    expect(basliklar()).toEqual([t("canli.gosterge.piyasa_baslik"), t("canli.issizlik.baslik"), t("canli.ise_alim.baslik")]);
    await ayrintilariAc("Nüfus ve para");
    expect(basliklar()).toEqual([t("canli.nufus.baslik"), t("canli.akis.baslik"), t("canli.sahiplik.baslik"), t("canli.kurulum.baslik")]);
    await ayrintilariAc("Olaylar");
    expect(basliklar()).toEqual([t("canli.olay_akisi"), t("canli.neden.baslik"), t("canli.neden.olmuyor_baslik")]);
    expect(screen.getByText(t("canli.olay_bos"))).toBeInTheDocument();
    await ayrintilariAc("Zaman çizgisi");
    expect(basliklar()).toEqual([t("canli.zaman_cizgisi")]);
    expect(screen.getByText("v1 · hafta 0–0")).toBeInTheDocument();
    expect(screen.getByText(t("canli.hafta", { n: 0, toplam: 200 }))).toBeInTheDocument();
    expect(screen.getByText(t("canli.kaynak"))).toBeInTheDocument();
    expect(screen.getByText(t("canli.surum", { n: 1 }))).toBeInTheDocument();
  });

  it("art_arda_oynat_duraklat_oynat_tek_abonelik_ve_unmount_kapatir", async () => {
    const { src, control, view } = mount([st()]);
    await screen.findByRole("button", { name: t("canli.oynat") });
    fireEvent.click(btn(t("canli.oynat")));
    emit(src, st({ status: "running" }));
    expect(btn(t("canli.duraklat"))).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn(t("canli.duraklat")));
    emit(src, st({ status: "paused" }));
    fireEvent.click(btn(t("canli.oynat")));
    expect(control.mock.calls.map((c) => c[1])).toEqual([
      { action: "play", speed: 1 },
      { action: "pause" },
      { action: "play", speed: 1 },
    ]);
    expect(src.subscribeCalls).toBe(1);
    expect(src.activeSubscriptions).toBe(1);
    view.unmount();
    expect(src.activeSubscriptions).toBe(0);
  });

  it("hiz_dugmesi_yalniz_hiz_ayarlar_duraklatiksa_duraklatik_kalir", async () => {
    const { control } = mount([st()]);
    await screen.findByRole("button", { name: t("canli.oynat") });
    for (const n of [1, 4, 16]) fireEvent.click(btn(t("canli.hiz", { n })));
    expect(control.mock.calls.map((c) => c[1])).toEqual([1, 4, 16].map((speed) => ({ action: "pause", speed })));
    expect(btn(t("canli.hiz", { n: 1 }))).toHaveAttribute("aria-pressed", "true");
  });

  it("hiz_dugmesi_calisirken_oynatmayi_surdurur", async () => {
    const { control } = mount([st({ status: "running" })]);
    await screen.findByRole("button", { name: t("canli.duraklat") });
    fireEvent.click(btn(t("canli.hiz", { n: 4 })));
    expect(control.mock.calls.map((c) => c[1])).toEqual([{ action: "play", speed: 4 }]);
  });

  it("dikis_bandi_surum_olayindan_turetilir_yenilemeden_sonra_da", async () => {
    for (const [mod, text] of [
      ["exact", "8. haftadan sonrası seçilen kuralla kayıtlıdır"],
      ["nearest", "8. haftadan sonrası seçilen senaryonun kaydıdır; değerlerde sıçrama olabilir"],
    ] as const) {
      const { src } = mount([st({ week: 9, version: 2 })]);
      await screen.findByRole("button", { name: t("canli.oynat") });
      expect(screen.queryByText(text)).not.toBeInTheDocument();
      emit(src, ev("version:2:8:kurtarma", 8, { textKey: "event.version", params: { hafta: 8, mod }, rule_ids: ["gecis_destegi"] }));
      expect(await screen.findByText(text)).toBeInTheDocument();
      cleanup();
    }
  });

  it("bosluk_calisirken_duraklatir", async () => {
    const { src, control } = mount([st({ status: "running" })]);
    await screen.findByRole("button", { name: t("canli.duraklat") });
    fireEvent.keyDown(window, { key: " " });
    expect(control).toHaveBeenCalledWith("r", { action: "pause" });
    emit(src, st({ status: "paused" }));
  });

  it("olay_akisi_yeni_ustte", async () => {
    mount([st(), wk(1), ev("a:1", 1, { textKey: "event.destek_basladi" }), ev("b:2", 2, { kind: "good", textKey: "event.oyuncu20", params: { hafta: 2, sayi: 20 } })]);
    await ayrintilariAc("Olaylar");
    await screen.findByText(t("event.oyuncu20", { hafta: 2, sayi: 20 }));
    fireEvent.click(btn(t("canli.olay.tumu"))); // "Yalnız önemli olaylar" nötr olayı gizler
    const items = screen.getAllByRole("listitem").map((l) => l.textContent ?? "");
    const i2 = items.findIndex((x) => x.includes(t("event.oyuncu20", { hafta: 2, sayi: 20 })));
    const i1 = items.findIndex((x) => x.includes(t("event.destek_basladi", { hafta: 1 })));
    expect(i2).toBeGreaterThanOrEqual(0);
    expect(i2).toBeLessThan(i1);
  });

  it("tek_hafta_step", async () => {
    const { control } = mount([st()]);
    fireEvent.click(await screen.findByRole("button", { name: t("canli.tek_hafta") }));
    expect(control).toHaveBeenCalledWith("r", { action: "step" });
  });

  it("klavye_bosluk_ok_ve_1_2_3", async () => {
    const { control } = mount([st()]);
    await screen.findByRole("button", { name: t("canli.oynat") });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(control.mock.calls.map((c) => c[1])).toEqual([
      { action: "pause", speed: 4 },
      { action: "pause", speed: 16 },
      { action: "play", speed: 1 },
      { action: "step" },
    ]);
  });

  it("klavye_yazi_alaninda_calismaz", async () => {
    const { control } = mount([st()]);
    await screen.findByRole("button", { name: t("canli.oynat") });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "2" });
    input.remove();
    expect(control).not.toHaveBeenCalled();
  });

  it("computing_iken_tum_saat_dugmeleri_disabled", async () => {
    const { control } = mount([st({ computing: true })]);
    await screen.findByRole("button", { name: t("canli.oynat") });
    for (const n of [t("canli.oynat"), t("canli.hiz", { n: 1 }), t("canli.hiz", { n: 4 }), t("canli.hiz", { n: 16 }), t("canli.tek_hafta"), t("canli.atla")]) {
      expect(btn(n)).toBeDisabled();
    }
    fireEvent.keyDown(window, { key: " " });
    expect(control).not.toHaveBeenCalled();
  });

  it("kaynak_failed_hata_gorunumu", async () => {
    mount([st({ status: "failed", error: { messageKey: "hata.kayit_yok", week: 0 } })]);
    expect(await screen.findByText(t("hata.kayit_yok"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("durum.yeniden") })).toBeInTheDocument();
  });
});

describe("Canlı: sonraki kritik olaya atla", () => {
  it("kritik_olay_gelince_durur_ve_hizi_geri_yukler", async () => {
    const { src, control } = mount([st({ status: "paused", week: 5, speed: 4 }), wk(5)]);
    fireEvent.click(await screen.findByRole("button", { name: t("canli.atla") }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "play", speed: 16 });
    emit(src, st({ status: "running", speed: 16, week: 6 }), wk(6), ev("kredi_ret:6", 6, { kind: "warn" }));
    expect(control).toHaveBeenCalledTimes(1);
    emit(src, wk(7), ev("batis10:7", 7, { kind: "bad", critical: true, textKey: "event.batis10", params: { hafta: 7, sayi: 10 } }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "pause", speed: 4 });
    expect(control).toHaveBeenCalledTimes(2);
    emit(src, ev("cokus:9", 9, { critical: true, textKey: "event.cokus" }));
    expect(control).toHaveBeenCalledTimes(2);
  });

  it("kritik_olay_ayni_senkron_dongude_durdurulur_react_render_beklenmez", async () => {
    const { src, control } = mount([st({ status: "paused", week: 5, speed: 4 }), wk(5)]);
    fireEvent.click(await screen.findByRole("button", { name: t("canli.atla") }));
    emit(src, st({ status: "running", speed: 16, week: 6 }));
    // act dışı, zamanlayıcı/render turu yok: ReplaySource.emit gibi senkron yayın
    src.emit("r", wk(7));
    src.emit("r", ev("batis10:7", 7, { kind: "bad", critical: true, textKey: "event.batis10", params: { hafta: 7, sayi: 10 } }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "pause", speed: 4 });
    expect(control).toHaveBeenCalledTimes(2);
    expect(src.activeSubscriptions).toBe(2 - 1); // atlama aboneliği kapandı, yalnız useRun açık
    act(() => {});
  });

  it("atla_dugmesi_yalniz_duraklatilmisken_acik_ve_unmount_aboneligi_kapatir", async () => {
    const { src, view } = mount([st({ status: "paused", week: 5 })]);
    fireEvent.click(await screen.findByRole("button", { name: t("canli.atla") }));
    expect(src.activeSubscriptions).toBe(2);
    emit(src, st({ status: "running", speed: 16, week: 6 }));
    expect(btn(t("canli.atla"))).toBeDisabled();
    view.unmount();
    expect(src.activeSubscriptions).toBe(0);
  });

  it("kritik_olay_yoksa_200e_gider_ve_etkisizdir", async () => {
    const { src, control } = mount([st({ status: "paused", week: 5 })]);
    fireEvent.click(await screen.findByRole("button", { name: t("canli.atla") }));
    emit(src, st({ status: "running", speed: 16 }), wk(6), ev("kredi_ret:6", 6, { kind: "warn" }), wk(200), st({ status: "ended", week: 200, speed: 16 }));
    expect(control.mock.calls.map((c) => c[1])).toEqual([{ action: "play", speed: 16 }]);
    expect(btn(t("canli.atla"))).toBeDisabled();
    expect(src.activeSubscriptions).toBe(1);
  });
});

describe("Canlı: çöküş, toparlanma, bitiş", () => {
  it("cokus_bandi_igne_ve_dugmeler_acik_ended_yok", async () => {
    const { src } = mount([st({ status: "running", week: 70 })]);
    await ayrintilariAc("Olaylar");
    emit(src, wk(71, { served: 0.4 }), cokus(71));
    const kriz = await screen.findByText(t("event.cokus", { hafta: 71 }));
    expect(kriz.closest("div")).toHaveTextContent(t("banner.kriz"));
    await ayrintilariAc("Genel");
    await waitFor(() => expect(document.querySelector('[data-isaret="collapse"]')).toBeInTheDocument());
    expect(screen.getByText(t("chart.isaret", { hafta: 71, ad: t("seri.isaret_cokus") }))).toBeInTheDocument();
    expect(btn(t("canli.duraklat"))).toBeEnabled();
    expect(btn(t("canli.hiz", { n: 4 }))).toBeEnabled();
    expect(screen.queryByText(t("bitis.baslik", { n: 200 }))).toBeNull();

    emit(src, wk(112, { served: 0.72 }), toparlanma(112));
    await waitFor(() => expect(document.querySelector('[data-isaret="recovery"]')).toBeInTheDocument());
    expect(screen.getByText(t("chart.isaret", { hafta: 112, ad: t("seri.isaret_toparlanma") }))).toBeInTheDocument();
    await ayrintilariAc("Olaylar");
    expect(screen.getByText(t("event.toparlanma", { hafta: 112, oran: 72 }))).toBeInTheDocument();
  });

  it("ended_karti_cokus_ve_toparlanmayi_birlikte_yazar", async () => {
    const { src } = mount([st({ status: "running", week: 70 })]);
    emit(src, wk(71, { served: 0.4 }), cokus(71), wk(112), toparlanma(112), wk(200), st({ status: "ended", week: 200 }));
    expect(await screen.findByRole("heading", { name: t("bitis.baslik", { n: 200 }) })).toBeInTheDocument();
    expect(screen.getByText(t("bitis.cokus_toparlanma", { c: 71, r: 112 }))).toBeInTheDocument();
    expect(btn(t("canli.oynat"))).toBeDisabled();
  });

  it("yalniz_cokus_toparlanmadi", async () => {
    const { src } = mount([st({ week: 70 })]);
    emit(src, wk(71), cokus(71), wk(200), st({ status: "ended", week: 200 }));
    expect(await screen.findByText(t("bitis.cokus_toparlanmadi", { c: 71 }))).toBeInTheDocument();
  });

  it("cokus_yoksa_cokmedi_ve_sifirdan_baslat_kurucuya_doner", async () => {
    const { src } = mount([st({ week: 150 })]);
    window.location.hash = "#/canli/r";
    emit(src, wk(200), st({ status: "ended", week: 200 }));
    expect(await screen.findByText(t("bitis.cokmedi"))).toBeInTheDocument();
    fireEvent.click(btn(t("bitis.yeniden"))); // bitiş diyaloğu: sıfırdan başlat diyaloğu açılır
    fireEvent.click(btn(t("canli.sifirla.kurucu")));
    expect(window.location.hash).toBe("#/kurucu");
  });
});

describe("Canlı: sürüm ve dikiş", () => {
  const seam = ev("version:2:30:kisa", 30, { textKey: "event.version", params: { hafta: 30 } });

  it("dikiste_yeni_runid_ile_events_ve_weeks_korunur_yeni_surum_satiri", async () => {
    const { src } = mount([st({ week: 29 }), wk(28), wk(29), cokus(29)], {}, { aliases: { r2: "r" } });
    await ayrintilariAc("Olaylar");
    await waitFor(() => expect(screen.getByText(t("event.cokus", { hafta: 29 }))).toBeInTheDocument());
    emit(src, st({ runId: "r2", version: 2, week: 30 }), wk(30, {}, 2), seam);
    await ayrintilariAc("Zaman çizgisi");
    await waitFor(() => expect(screen.getByText("v2 · hafta 30–30")).toBeInTheDocument());
    expect(screen.getByText("v1 · hafta 0–30")).toBeInTheDocument();
    expect(screen.getByText(t("canli.surum", { n: 2 }))).toBeInTheDocument();
    await ayrintilariAc("Olaylar");
    expect(screen.getByText(t("event.cokus", { hafta: 29 }))).toBeInTheDocument();
    expect(screen.getByText(t("event.version", { hafta: 30 }))).toBeInTheDocument();
    await ayrintilariAc("Genel");
    expect(document.querySelector('[data-isaret="seam"]')).toBeInTheDocument();
    // saat artık yeni kimliği kullanır
    fireEvent.click(btn(t("canli.tek_hafta")));
  });

  it("hash_yeni_kimlige_gecince_abonelik_ve_veri_korunur", async () => {
    const { src, ui, view, control } = mount([st({ week: 5 }), wk(5)], {}, { aliases: { r2: "r" } });
    await ayrintilariAc("Genel");
    await waitFor(() => expect(strip("karsilama")).toHaveTextContent("%90"));
    emit(src, st({ runId: "r2", version: 2, week: 5 }));
    view.rerender(ui("r2"));
    expect(src.subscribeCalls).toBe(1);
    expect(strip("karsilama")).toHaveTextContent("%90");
    fireEvent.click(btn(t("canli.tek_hafta")));
    expect(control).toHaveBeenLastCalledWith("r2", { action: "step" });
  });
});

describe("Canlı: boyut ve hız", () => {
  it("bos_tek_ve_200_hafta_cokmez", async () => {
    const two = mount([st({ week: 200 }), ...Array.from({ length: 200 }, (_, i) => wk(i + 1, { served: 0.5 + i / 400 }))]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(strip("karsilama")).toHaveTextContent("%100"));
    two.view.unmount();
    mount([st()]);
    await ayrintilariAc("Genel");
    expect(document.querySelector("svg[role=img]")).toBeInTheDocument();
    expect(screen.getByText(t("chart.bos"))).toBeInTheDocument();
    cleanup();
    mount([st({ week: 1 }), wk(1)]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(strip("karsilama")).toHaveTextContent("%90"));
  });

  it("hiz_16da_guncelleme_saniyede_en_cok_10", async () => {
    vi.useFakeTimers();
    const { src } = mount([st({ status: "running", speed: 16 })]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: t("ayrintilar.dugme") })); // Bu hafta şeridi Ayrıntılar > Genel'dedir (ilk sekme)
    const seen: string[] = [];
    const read = () => strip("oyuncu")?.textContent ?? "";
    for (let w = 1; w <= 160; w++) {
      await act(async () => {
        src.emit("r", wk(w, { player_firms: w }));
        await vi.advanceTimersByTimeAsync(37);
      });
      const now = read();
      if (seen[seen.length - 1] !== now) seen.push(now);
    }
    // 160 hafta ≈ 5,9 sn
    expect(seen.length).toBeLessThanOrEqual(62);
    expect(seen.length).toBeGreaterThan(3);
    // tek saniyelik pencere
    const before = read();
    const updates: string[] = [];
    for (let w = 161; w <= 187; w++) {
      await act(async () => {
        src.emit("r", wk(w, { player_firms: w }));
        await vi.advanceTimersByTimeAsync(37);
      });
      const now = read();
      if (now !== (updates[updates.length - 1] ?? before)) updates.push(now);
    }
    expect(updates.length).toBeLessThanOrEqual(10);
  });
});

describe("Canlı: kayıp koşu", () => {
  it("canli_missing_banda_ve_yeni_kosu_dugmesi", async () => {
    const src = createFakeSource([]);
    window.location.hash = "#/canli/yok";
    render(
      <SimSourceProvider source={src}>
        <Canli runId="yok" restore={{ status: "missing" }} />
      </SimSourceProvider>,
    );
    expect(screen.getByText(t("canli.kosu_yok"))).toBeInTheDocument();
    fireEvent.click(btn(t("canli.yeni_kosu")));
    expect(window.location.hash).toBe("#/kurucu");
    expect(src.subscribeCalls).toBe(0);
  });

  it("bilinmeyen_tarifle_uygulama_bandi_ve_konsol_temiz", async () => {
    vi.stubGlobal("fetch", makeFetch(Object.fromEntries(Object.entries(allFiles()).map(([k, v]) => [k.replace("/k/", "/oyun-kayit/"), v]))));
    window.location.hash = "#/canli/çöp";
    render(<OyunApp />);
    expect(await screen.findByText(t("canli.kosu_yok"))).toBeInTheDocument();
    const yeni = within(screen.getByRole("main")).getByRole("button", { name: t("canli.yeni_kosu") });
    fireEvent.click(yeni);
    await waitFor(() => expect(window.location.hash).toBe("#/kurucu"));
    expect(await screen.findByRole("button", { name: t("kurucu.baslat") })).toBeInTheDocument();
  });
});
