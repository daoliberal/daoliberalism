import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { Canli } from "@/oyun/screens/canli/Canli";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, ChangeResult, RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { ayrintilariAc, ayrintilariKapat } from "../helpers/canliMount";
import { createFakeSource, type FakeSource } from "../helpers/fakeSource";

const NULL_WORLD = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum"].map((k) => [k, null]),
) as World;

const wk = (week: number, version = 1): SimEvent => ({
  type: "week",
  packet: { v: 1, run_id: "r", week, version, world: { ...NULL_WORLD, served: 0.9, unemployment_rate: 0.1 }, events: [] } as WeekPacket,
});
const st = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 5, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: { gecis_destegi: "kapali" }, scenarioId: "kapali", name: "Ada", cityNames: [], ...over },
});
const verEv = (week: number): SimEvent => ({
  type: "world_event",
  event: { id: `version:2:${week}:kurtarma`, week, kind: "neutral", textKey: "event.version", params: { hafta: week }, critical: false, sector: null, rule_ids: [] } as WorldEvent,
});

const ok = (over: Partial<Extract<ChangeResult, { accepted: true }>> = {}): ChangeResult => ({
  accepted: true, runId: "r2", mode: "exact", scenarioId: "kurtarma", seamWeek: 5, version: 2, ...over,
});

type Harness = { src: FakeSource; applyChange: ReturnType<typeof vi.spyOn>; control: ReturnType<typeof vi.spyOn>; hashChange: ReturnType<typeof vi.fn> };

function Ekran() {
  const { route } = useHashRoute();
  const { status } = useRestoreRun(route.name === "canli" ? route.runId : null);
  return route.name === "canli" ? <Canli runId={route.runId} restore={{ status }} /> : null;
}

async function mount(script: SimEvent[] = [st(), wk(5)]): Promise<Harness> {
  window.location.hash = "#/canli/r";
  const src = createFakeSource(script, { aliases: { r2: "r" } });
  const applyChange = vi.spyOn(src, "applyChange");
  const control = vi.spyOn(src, "control");
  const hashChange = vi.fn();
  window.addEventListener("hashchange", hashChange);
  render(
    <SimSourceProvider source={src}>
      <Ekran />
    </SimSourceProvider>,
  );
  await waitFor(() => expect(screen.getAllByText(/^Hafta \d+ \/ 200$/).length).toBeGreaterThan(0));
  await waitFor(() => expect(src.opens).toBe(1));
  hashChange.mockClear();
  return { src, applyChange, control, hashChange };
}

const emit = (src: FakeSource, ...es: SimEvent[]): void => {
  act(() => es.forEach((e) => src.emit("r", e)));
};
/** "Hafta N / T" hem üst çubukta hem saat çubuğunda görünür (aynı değer); saat çubuğundakine daraltılır. */
const haftaMetni = (n: number, toplam = 200) => within(screen.getByRole("region", { name: t("canli.saat") })).getByText(t("canli.hafta", { n, toplam }));
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const uygulaAd = t("degistir.uygula", { n: 6 });
/** Şart panelindeki tek "Şartı değiştir" düğmesi; diyalog editörü kayıt yüklenince çizilir. */
const acik = async () => {
  fireEvent.click(screen.getByRole("button", { name: t("degistir.dugme") }));
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(await within(dlg).findByRole("button", { name: /Kurtarma ve geçiş/ }));
  await within(dlg).findByRole("group", { name: t("setting.gecis_destegi.name") });
};
const sec = (k: "kapali" | "kisa_sureli" | "kurtarma_fonuyla") =>
  fireEvent.click(within(within(screen.getByRole("dialog")).getByRole("group", { name: t("setting.gecis_destegi.name") })).getByRole("button", { name: t(`setting.gecis_destegi.options.${k}`) }));

/** Gerçek kaynak gibi: hesaplanıyor durumu, sonra yeni kimlikli durum ve sürüm olayı, sonra sonuç. */
function sonuclandir(h: Harness, result: ChangeResult, values = { gecis_destegi: "kurtarma_fonuyla" }) {
  let finish: (r: ChangeResult) => void = () => {};
  h.applyChange.mockImplementation(
    () =>
      new Promise<ChangeResult>((res) => {
        finish = res;
      }),
  );
  return {
    compute: () => emit(h.src, st({ computing: true })),
    settle: async () => {
      if (result.accepted) emit(h.src, st({ runId: result.runId, version: result.version, values, computing: false }), verEv(result.seamWeek));
      await act(async () => finish(result));
    },
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.location.hash = "";
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  degistirKapat();
  const calls = errSpy.mock.calls.map((c: unknown[]) => String(c[0]).slice(0, 300));
  cleanup();
  vi.unstubAllGlobals();
  errSpy.mockRestore();
  expect(calls).toEqual([]);
});

describe("Şartı değiştir: panel", () => {
  it("degisiklik_yokken_uygula_kapali_ve_neden_gorunur", async () => {
    await mount();
    await acik();
    expect(screen.getByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeInTheDocument();
    const uygula = btn(uygulaAd);
    expect(uygula).toBeDisabled();
    expect(document.getElementById(uygula.getAttribute("aria-describedby") ?? "")).toHaveTextContent(t("degistir.fark_yok"));
    sec("kurtarma_fonuyla");
    expect(btn(uygulaAd)).toBeEnabled();
    expect(screen.getAllByText(t("degistir.fark", { ad: t("setting.gecis_destegi.name"), eski: t("setting.gecis_destegi.options.kapali"), yeni: t("setting.gecis_destegi.options.kurtarma_fonuyla") })).length).toBeGreaterThan(0);
    sec("kapali");
    expect(btn(uygulaAd)).toBeDisabled();
  });

  it("acilinca_kosu_duraklatilir_ve_kapat_degistirmeden_kapatir", async () => {
    const h = await mount([st({ status: "running" }), wk(5)]);
    await acik();
    expect(h.control).toHaveBeenCalledWith("r", { action: "pause" });
    fireEvent.click(btn(t("degistir.kapat")));
    expect(screen.queryByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeNull();
    expect(h.applyChange).not.toHaveBeenCalled();
  });

  it("govde_yalniz_degisen_ayari_tasir", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    expect(h.applyChange).toHaveBeenCalledTimes(1);
    expect(h.applyChange).toHaveBeenCalledWith("r", { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    await s.settle();
  });

  it("kayitsiz_birlesim_availability_kartta_gorunur_ve_uygula_kapali", async () => {
    const h = await mount();
    const blocked: Availability = { ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "kisa_sureli", reason: "no_recording" }] };
    vi.spyOn(h.src, "availability").mockResolvedValue(blocked);
    await acik();
    sec("kisa_sureli");
    expect(await screen.findByText(t("lock.kayitsiz"))).toBeInTheDocument();
    expect(btn(uygulaAd)).toBeDisabled();
  });

  it("kosu_ortasi_availability_kosu_kimligini_gecirir", async () => {
    const h = await mount();
    const spy = vi.spyOn(h.src, "availability");
    await acik();
        sec("kisa_sureli");
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ gecis_destegi: "kisa_sureli" }, "r"));
  });

  it("kilitli_availability_yalniz_yeni_kosuda_secilebilir_der", async () => {
    const h = await mount();
    const locked: Availability = { ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "kisa_sureli", reason: "locked" }] };
    vi.spyOn(h.src, "availability").mockResolvedValue(locked);
    await acik();
    sec("kisa_sureli");
    expect(await screen.findByText(t("lock.yeni_kosu"))).toBeInTheDocument();
    expect(screen.queryByText(t("lock.kayitsiz"))).toBeNull();
    expect(screen.queryByText(t("lock.kayitsiz.live"))).toBeNull();
    expect(btn(uygulaAd)).toBeDisabled();
  });

  it("locked_degisiklik_reddi_yalniz_yeni_kosuda_metnini_gosterir", async () => {
    const h = await mount();
    await acik();
    sec("kisa_sureli");
    h.applyChange.mockResolvedValue({ accepted: false, fields: [{ id: "gecis_destegi", reason: "locked" }] });
    fireEvent.click(btn(uygulaAd));
    expect(await screen.findByText(t("sart.degistir.red_kart", { ad: t("setting.gecis_destegi.name"), neden: t("sart.degistir.red.locked") }))).toBeInTheDocument();
    sec("kurtarma_fonuyla");
    expect(screen.getByText(t("sart.degistir.red_baslik"))).toBeInTheDocument(); // ret, yeni seçimle silinmez: kullanıcı yeniden dener
  });

  it("no_recording_yanitinda_hata_metni_panel_acik_hafta_ve_hash_ayni", async () => {
    const h = await mount();
    await acik();
    sec("kisa_sureli");
    h.applyChange.mockResolvedValue({ accepted: false, fields: [{ id: "gecis_destegi", reason: "no_recording" }] });
    fireEvent.click(btn(uygulaAd));
    expect(await screen.findByText(t("sart.degistir.red_kart", { ad: t("setting.gecis_destegi.name"), neden: t("sart.degistir.red.no_recording") }))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeInTheDocument();
    expect(haftaMetni(5)).toBeInTheDocument();
    expect(window.location.hash).toBe("#/canli/r");
    expect(h.hashChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-isaret="seam"]')).toBeNull();
    // yeni seçimle yeniden denenebilir
    sec("kurtarma_fonuyla");
    await waitFor(() => expect(btn(uygulaAd)).toBeEnabled());
  });

  it("busy_yanitinda_genel_hata_ve_yeniden_denenebilir", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    h.applyChange.mockResolvedValue({ accepted: false, fields: [{ id: "*", reason: "busy" }] });
    fireEvent.click(btn(uygulaAd));
    expect(await screen.findByText(t("sart.degistir.red.busy"))).toBeInTheDocument();
    await waitFor(() => expect(btn(uygulaAd)).toBeEnabled());
  });

  it("ended_kosuda_sarti_degistir_dugmesi_yok", async () => {
    await mount([st({ status: "ended", week: 200 })]);
    await waitFor(() => expect(haftaMetni(200)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: t("degistir.dugme") })).toBeNull();
  });
});

describe("Şartı değiştir: hesaplanıyor ve dikiş", () => {
  it("computing_iken_saat_ve_panel_dugmeleri_kapali_ikinci_uygula_cagrisi_yok", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    fireEvent.click(btn(uygulaAd)); // çift tıklama
    s.compute();
    expect(h.applyChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("degistir.hesaplaniyor"))).toBeInTheDocument();
    for (const n of [t("canli.oynat"), t("canli.tek_hafta"), t("canli.atla"), t("degistir.dugme"), uygulaAd]) expect(btn(n)).toBeDisabled();
    fireEvent.click(btn(uygulaAd));
    expect(h.applyChange).toHaveBeenCalledTimes(1);
    await s.settle();
    expect(screen.queryByText(t("degistir.hesaplaniyor"))).toBeNull();
  });

  it("hesaplanma_ve_sonuc_bandi_tek_canli_bolge", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    s.compute();
    const warn = screen.getByText(t("degistir.hesaplaniyor")).closest("[role=status]")!;
    expect(warn).toHaveTextContent(t("banner.uyari"));
    await s.settle();
    const bilgi = screen.getByText(t("degistir.dikis_exact", { n: 5 })).closest("[role=status]")!;
    expect(bilgi).toHaveTextContent(t("banner.bilgi"));
    expect(screen.queryByText(t("degistir.hesaplaniyor"))).toBeNull();
    const bandlar = screen.getAllByRole("status").filter((e) => e.textContent?.includes(t("banner.bilgi")) || e.textContent?.includes(t("banner.uyari")));
    expect(bandlar).toHaveLength(1);
  });

  for (const [mode, key] of [["exact", "degistir.dikis_exact"], ["nearest", "degistir.dikis_nearest"]] as const) {
    it(`basari_${mode}_bandi_igne_surum_ve_sayac_degismez`, async () => {
      const h = await mount();
      await acik();
      sec("kurtarma_fonuyla");
      const s = sonuclandir(h, ok({ mode }));
      fireEvent.click(btn(uygulaAd));
      s.compute();
      await s.settle();
      expect(screen.getByText(t(key, { n: 5 }))).toBeInTheDocument();
      await ayrintilariAc("Genel"); // iğneler göstergelerde (Ayrıntılar > Genel)
      expect(document.querySelector('[data-isaret="seam"]')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-isaret="version"]')).toHaveLength(0); // aynı hafta tek iğne
      expect(screen.getByText(t("canli.surum", { n: 2 }))).toBeInTheDocument();
      expect(haftaMetni(5)).toBeInTheDocument();
      // panel kapandı
      expect(screen.queryByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeNull();
    });
  }

  it("hash_yalniz_yeni_kimlikli_state_gelince_replace_ile_yazilir_open_yok_weeks_korunur", async () => {
    const h = await mount();
    emit(h.src, wk(4));
    await ayrintilariAc("Genel");
    await waitFor(() => expect(document.querySelector('[data-olcu="karsilama"]')).toHaveTextContent("%90"));
    ayrintilariKapat();
    await acik();
    sec("kurtarma_fonuyla");
    // sonuç state olayından ÖNCE çözülür: hash henüz değişmez
    let finish: (r: ChangeResult) => void = () => {};
    h.applyChange.mockImplementation(() => new Promise<ChangeResult>((res) => (finish = res)));
    fireEvent.click(btn(uygulaAd));
    await act(async () => finish(ok()));
    expect(window.location.hash).toBe("#/canli/r");
    emit(h.src, st({ runId: "r2", version: 2, values: { gecis_destegi: "kurtarma_fonuyla" } }));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r2"));
    expect(h.hashChange).not.toHaveBeenCalled();
    expect(h.src.opens).toBe(1); // yalnız ilk yükleme
    expect(h.src.subscribeCalls).toBe(2); // Canlı: useRun + useRestoreRun (Kurucu ekranının kendi üst çubuğu yok); yeniden abonelik yok
    await ayrintilariAc("Genel");
    expect(document.querySelector('[data-olcu="karsilama"]')).toHaveTextContent("%90");
    expect(haftaMetni(5)).toBeInTheDocument();
    expect(screen.queryByText(t("durum.yukleniyor"))).toBeNull();
  });

  it("devam_oynat_yeni_kimlikle_gider_ve_sonraki_hafta_gelir", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    s.compute();
    await s.settle();
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r2"));
    fireEvent.click(btn(t("canli.oynat")));
    expect(h.control).toHaveBeenLastCalledWith("r2", { action: "play", speed: 1 });
    emit(h.src, st({ runId: "r2", version: 2, status: "running", week: 6 }), wk(6, 2));
    await waitFor(() => expect(haftaMetni(6)).toBeInTheDocument());
    expect(h.src.opens).toBe(1);
  });

  it("ikinci_acilista_current_yeni_degeri_gosterir", async () => {
    const h = await mount();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    s.compute();
    await s.settle();
    await acik();
    const grup = screen.getByRole("group", { name: t("setting.gecis_destegi.name") });
    expect(within(grup).getByRole("button", { name: t("setting.gecis_destegi.options.kurtarma_fonuyla") })).toHaveAttribute("aria-pressed", "true");
    expect(btn(t("degistir.uygula", { n: 6 }))).toBeDisabled();
    // sürüm satırları kısılmış (100 ms) akıştan gelir: başlık "v2" olarak oturur
    expect(await screen.findByRole("heading", { name: t("degistir.baslik_ayni", { a: 2 }) })).toBeInTheDocument(); // aynı hafta ikinci karar: sonuç yine v2
  });
});

describe("Saat çubuğu: atla aboneliği koşu kimliği değişince kapanır", () => {
  it("runid_degisince_atla_aboneligi_kapanir", async () => {
    const h = await mount();
    const base = h.src.activeSubscriptions;
    fireEvent.click(btn(t("canli.atla")));
    expect(h.src.activeSubscriptions).toBe(base + 1);
    emit(h.src, st({ runId: "r2", version: 2, status: "running" }));
    await waitFor(() => expect(h.src.activeSubscriptions).toBe(base));
  });
});

describe("Şartı değiştir: Türkçe ek, odak, Esc, saat kilidi", () => {
  const evAt = (id: string, week: number, over: Partial<WorldEvent>): SimEvent => ({
    type: "world_event",
    event: { id, week, kind: "bad", textKey: "event.cokus", params: { hafta: week }, critical: false, sector: null, rule_ids: [], ...over } as WorldEvent,
  });

  it("dikis_bandi_ve_surum_olayi_sayidan_bagimsiz_ek_8_ve_40", async () => {
    for (const [n, exact, near] of [
      [8, "8. haftadan sonrası seçilen kuralla kayıtlıdır", "8. haftadan sonrası seçilen senaryonun kaydıdır; değerlerde sıçrama olabilir"],
      [40, "40. haftadan sonrası seçilen kuralla kayıtlıdır", "40. haftadan sonrası seçilen senaryonun kaydıdır; değerlerde sıçrama olabilir"],
    ] as const) {
      for (const mode of ["exact", "nearest"] as const) {
        const h = await mount();
        await acik();
        sec("kurtarma_fonuyla");
        const s = sonuclandir(h, ok({ seamWeek: n, mode }));
        fireEvent.click(btn(uygulaAd));
        s.compute();
        await s.settle();
        expect(screen.getByText(mode === "exact" ? exact : near)).toBeInTheDocument();
        await ayrintilariAc("Olaylar");
        expect(await screen.findByText(`Hf ${n}: Şart değişti, ${n}. haftadan sonrası yeni kuralla`)).toBeInTheDocument();
        cleanup();
      }
    }
  });

  it("hafta_0_degisikligi_eski_dikis_bandini_gecersiz_kilar", async () => {
    const h = await mount([st({ week: 0 }), wk(0), verEv(30)]);
    await acik();
    sec("kurtarma_fonuyla");
    // Gerçek kaynak 0. haftada sürüm olayı üretmez: yalnız yeni kimlikli durum yayılır.
    h.applyChange.mockResolvedValue(ok({ seamWeek: 0, mode: "nearest", version: 1 }));
    fireEvent.click(btn(t("degistir.uygula", { n: 1 })));
    emit(h.src, st({ runId: "r2", week: 0, values: { gecis_destegi: "kurtarma_fonuyla" } }));
    await screen.findByText(t("degistir.dikis_nearest", { n: 0 }));
    expect(screen.getByText(t("degistir.dikis_nearest", { n: 0 }))).toBeInTheDocument();
    expect(screen.queryByText(t("degistir.dikis_exact", { n: 30 }))).not.toBeInTheDocument();
    expect(screen.queryByText(t("degistir.dikis_nearest", { n: 30 }))).not.toBeInTheDocument();
    cleanup();
  });

  it("bitis_karti_sayidan_bagimsiz_ek", async () => {
    await mount([st({ status: "ended", week: 200 }), evAt("cokus:40", 40, { critical: true }), evAt("toparlanma:48", 48, { kind: "good", textKey: "event.toparlanma" })]);
    expect(await screen.findByText("40. haftada çöktü; 48. haftada toparlandı")).toBeInTheDocument();
    cleanup();
    await mount([st({ status: "ended", week: 200 }), evAt("cokus:8", 8, { critical: true })]);
    expect(await screen.findByText("8. haftada çöktü; toparlanmadı")).toBeInTheDocument();
  });

  it("panel_acikken_oynat_tek_hafta_hiz_atla_kapali_kapaninca_acik", async () => {
    await mount();
    await acik();
    for (const n of [t("canli.oynat"), t("canli.tek_hafta"), t("canli.atla"), t("canli.hiz", { n: 4 })]) expect(btn(n)).toBeDisabled();
    fireEvent.click(btn(t("degistir.kapat")));
    for (const n of [t("canli.oynat"), t("canli.tek_hafta")]) expect(btn(n)).toBeEnabled();
  });

  it("kapatinca_ve_uygulayinca_odak_sarti_degistir_dugmesine_doner", async () => {
    const h = await mount();
    await acik();
    fireEvent.click(btn(t("degistir.kapat")));
    expect(btn(t("degistir.dugme"))).toHaveFocus();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    s.compute();
    await s.settle();
    await waitFor(() => expect(btn(t("degistir.dugme"))).toHaveFocus());
  });

  it("esc_paneli_kapatir_hesaplanirken_kapatmaz", async () => {
    const h = await mount();
    await acik();
    fireEvent.keyDown(screen.getByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) }), { key: "Escape" });
    expect(screen.queryByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeNull();
    await acik();
    sec("kurtarma_fonuyla");
    const s = sonuclandir(h, ok());
    fireEvent.click(btn(uygulaAd));
    s.compute();
    fireEvent.keyDown(screen.getByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) }), { key: "Escape" });
    expect(screen.getByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeInTheDocument();
    await s.settle();
  });
});


describe("Şartı değiştir: bağlam kilidi (son inceleme I2)", () => {
  const kilitli = (over: Partial<RunState> = {}) => st({ settingLocks: [{ id: "gecis_destegi", reason: "no_cash_floor" }], ...over });

  it("kilitli_baglamda_gecis_destegi_secenekleri_kapali_ve_neden_notr_olgu_soyler", async () => {
    await mount([kilitli(), wk(5)]);
    await acik();
    const grup = within(screen.getByRole("dialog")).getByRole("group", { name: t("setting.gecis_destegi.name") });
    for (const b of within(grup).getAllByRole("button")) expect(b).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByText(t("lock.kasa_tabani_yok"))).toBeInTheDocument();
    expect(t("lock.kasa_tabani_yok")).toMatch(/kapalı başladı/);
  });

  it("kilitli_kart_yamaya_girmez_uygula_kapali", async () => {
    await mount([kilitli(), wk(5)]);
    await acik();
    expect(btn(uygulaAd)).toBeDisabled();
  });

  it("kilit_yoksa_secenekler_acik", async () => {
    await mount([st(), wk(5)]);
    await acik();
    const grup = within(screen.getByRole("dialog")).getByRole("group", { name: t("setting.gecis_destegi.name") });
    for (const b of within(grup).getAllByRole("button")) expect(b).toBeEnabled();
    expect(screen.queryByText(t("lock.kasa_tabani_yok"))).toBeNull();
  });
});
