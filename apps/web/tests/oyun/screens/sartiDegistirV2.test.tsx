import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { Canli } from "@/oyun/screens/canli/Canli";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { GecisDestegiKarti } from "@/oyun/screens/ortak/GecisDestegiKarti";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import { onizlemeTarifi } from "@/oyun/screens/canli/SartiDegistir";
import type { Capabilities, ChangeResult, Job, PreviewSpec, RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { ayrintilariAc } from "../helpers/canliMount";
import { createFakeSource, type FakeSource } from "../helpers/fakeSource";

const NULL_WORLD = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum"].map((k) => [k, null]),
) as World;
const wk = (week: number): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week, version: 1, world: { ...NULL_WORLD, served: 0.9, unemployment_rate: 0.1 }, events: [] } as WeekPacket });
const st = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 5, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: { gecis_destegi: "kapali" }, scenarioId: "kapali", name: "Ada", cityNames: ["a", "b", "c", "d", "e"], ...over },
});
const ok = (): ChangeResult => ({ accepted: true, runId: "r2", mode: "live", scenarioId: "kapali", seamWeek: 5, version: 2 });

function Ekran() {
  const { route } = useHashRoute();
  const { status } = useRestoreRun(route.name === "canli" ? route.runId : null);
  return route.name === "canli" ? <Canli runId={route.runId} restore={{ status }} /> : null;
}

async function mount(script: SimEvent[] = [st(), wk(5)], kind: "live" | "replay" = "live", caps?: Partial<Capabilities>) {
  window.location.hash = "#/canli/r";
  const src: FakeSource = createFakeSource(script, { aliases: { r2: "r" }, kind, ...(caps ? { caps } : {}) });
  const applyChange = vi.spyOn(src, "applyChange");
  render(
    <SimSourceProvider source={src}>
      <Ekran />
    </SimSourceProvider>,
  );
  await waitFor(() => expect(within(screen.getByRole("region", { name: t("canli.saat") })).getByText(/^Hafta \d+ \/ 200$/)).toBeInTheDocument());
  return { src, applyChange };
}

/** Şart panelindeki "Şartı değiştir" düğmesi (Kurucu ekranının tek örneği). */
const ustDugme = () => screen.getByRole("button", { name: t("degistir.dugme") });
/** Menüyü açıp Karar günlüğünü açar. */
const gunlukAc = () => {
  fireEvent.click(screen.getByRole("button", { name: t("kurucu.menu.dugme") }));
  fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.gunluk") }));
};
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const kart = (title: string) => within(screen.getByRole("dialog")).getByRole("article", { name: title });
async function ac(): Promise<HTMLElement> {
  fireEvent.click(ustDugme());
  const dlg = await screen.findByRole("dialog");
  await within(dlg).findByRole("navigation", { name: t("sart.gruplar") });
  return dlg;
}
const grup = (ad: RegExp) => fireEvent.click(within(within(screen.getByRole("dialog")).getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: ad }));
const yaz = (baslik: string, v: string) => fireEvent.change(within(kart(baslik)).getByRole("textbox"), { target: { value: v } });
const uzmanAc = () => {
  const d = within(screen.getByRole("dialog")).getByRole("button", { name: /^(Göster|Gizle) \(\d+\)$/ });
  if (d.getAttribute("aria-expanded") === "false") fireEvent.click(d);
};
const uygulaAd = (n = 6) => t("degistir.uygula_live", { n });

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.location.hash = "";
  window.sessionStorage.clear();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  degistirKapat();
  const calls = errSpy.mock.calls.map((c: unknown[]) => String(c[0]).slice(0, 300));
  cleanup();
  errSpy.mockRestore();
  expect(calls).toEqual([]);
});

describe("Şartı değiştir v2: çok ayar", () => {
  it("multi_change_single_patch", async () => {
    const { applyChange } = await mount();
    applyChange.mockResolvedValue(ok());
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12,5");
    yaz("Kurumlar vergisi", "25");
    grup(/Kurtarma ve geçiş/);
    const g = within(kart("Geçiş desteği")).getByRole("group", { name: t("setting.gecis_destegi.name") });
    fireEvent.click(within(g).getByRole("button", { name: t("setting.gecis_destegi.options.kisa_sureli") }));
    await waitFor(() => expect(btn(uygulaAd())).toBeEnabled());
    fireEvent.click(btn(uygulaAd()));
    await waitFor(() => expect(applyChange).toHaveBeenCalledTimes(1));
    expect(applyChange).toHaveBeenCalledWith("r", { from: "next_week", patch: { gecis_destegi: "kisa_sureli", ucret_stopaji: 12.5, kurumlar_vergisi: 25 } });
  });

  it("note_gider_ve_bos_not_gitmez", async () => {
    const { applyChange } = await mount();
    applyChange.mockResolvedValue(ok());
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    fireEvent.change(screen.getByRole("textbox", { name: t("sart.degistir.not_etiket") }), { target: { value: "  Vergi indirimi  " } });
    await waitFor(() => expect(btn(uygulaAd())).toBeEnabled());
    fireEvent.click(btn(uygulaAd()));
    await waitFor(() => expect(applyChange).toHaveBeenCalledWith("r", { from: "next_week", patch: { ucret_stopaji: 12 }, note: "Vergi indirimi" }));
  });
});

describe("Şartı değiştir v2: not sınırı (son inceleme M4)", () => {
  it("not_alani_sunucunun_siniriyla_ayni_uzunlukla_sinirli", async () => {
    await mount();
    await ac();
    expect(screen.getByRole("textbox", { name: t("sart.degistir.not_etiket") })).toHaveAttribute("maxlength", "500");
  });
});

describe("Şartı değiştir v2: kilitler", () => {
  it("start_only_locked_and_new_run_offer", async () => {
    const { applyChange } = await mount();
    await ac();
    grup(/Kurtarma ve geçiş/);
    uzmanAc();
    const c = kart("Örnek faiz");
    expect(within(c).getByRole("textbox")).toBeDisabled();
    expect(within(c).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("lock.yeni_kosu")));
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    fireEvent.click(btn(t("sart.degistir.yeni_kosu")));
    expect(window.location.hash).toBe("#/kurucu/4");
    expect(applyChange).not.toHaveBeenCalled();
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak") ?? "{}") as { name: string; values: Record<string, unknown> };
    expect(taslak.name).toBe("Ada");
    expect(taslak.values.ucret_stopaji).toBe(12);
  });

  it("yeni_kosu_sablon_ve_ozel_dunya_degerlerini_korur_taslakOf", async () => {
    await mount([st({ scenarioId: "bos_sart", worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 7 } }), wk(5)]);
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    fireEvent.click(btn(t("sart.degistir.yeni_kosu")));
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak") ?? "{}") as { templateId: string; worldScenarioId: string; worldScenarioValues: Record<string, unknown>; values: Record<string, unknown> };
    expect(taslak.templateId).toBe("bos_sart");
    expect(taslak.worldScenarioId).toBe("ozel");
    expect(taslak.worldScenarioValues).toEqual({ dunya_x: 7 });
    expect(taslak.values.ucret_stopaji).toBe(12);
  });

  it("unknown_locked_live", async () => {
    await mount();
    await ac();
    grup(/Kurtarma ve geçiş/);
    uzmanAc();
    const c = kart("Örnek tahvil");
    expect(within(c).getByRole("heading", { name: "Örnek tahvil" })).toHaveAccessibleDescription(new RegExp(t("kart.dogrulanmadi")));
    for (const el of within(c).queryAllByRole("textbox")) expect(el).toBeDisabled();
  });
});

describe("Şartı değiştir v2: red ve kapatma", () => {
  it("partial_reject_shows_reasons_and_run_unchanged", async () => {
    const { applyChange } = await mount();
    applyChange.mockResolvedValue({ accepted: false, fields: [{ id: "ucret_stopaji", reason: "locked" }, { id: "kurumlar_vergisi", reason: "start_only" }] });
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    yaz("Kurumlar vergisi", "25");
    fireEvent.click(btn(uygulaAd()));
    expect(await screen.findByText(t("sart.degistir.red_baslik"))).toBeInTheDocument();
    expect(screen.getByText(t("sart.degistir.red_kart", { ad: "Ücret stopajı", neden: t("sart.degistir.red.locked") }))).toBeInTheDocument();
    expect(screen.getByText(t("sart.degistir.red_kart", { ad: "Kurumlar vergisi", neden: t("sart.degistir.red.start_only") }))).toBeInTheDocument();
    // Kısmi kabul yok: koşu aynen (hafta, sürüm, adres, dikiş yok); diyalog açık, değişiklikler duruyor.
    expect(window.location.hash).toBe("#/canli/r");
    expect(within(screen.getByRole("region", { name: t("canli.saat") })).getByText(t("canli.surum", { n: 1 }))).toBeInTheDocument();
    expect(document.querySelector('[data-isaret="seam"]')).toBeNull();
    expect(applyChange).toHaveBeenCalledTimes(1);
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("12");
    await waitFor(() => expect(btn(uygulaAd())).toBeEnabled());
  });

  it("discard_confirm_dialog", async () => {
    const { applyChange } = await mount();
    await ac();
    // değişiklik yokken onay istemez
    fireEvent.click(btn(t("degistir.kapat")));
    expect(screen.queryByRole("dialog")).toBeNull();
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    fireEvent.click(btn(t("degistir.kapat")));
    expect(screen.getByText(t("sart.degistir.kapat_onay"))).toBeInTheDocument();
    fireEvent.click(btn(t("sart.degistir.kapat_don")));
    expect(screen.queryByText(t("sart.degistir.kapat_onay"))).toBeNull();
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("12");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); // Esc de aynı onaydan geçer
    expect(await screen.findByText(t("sart.degistir.kapat_onay"))).toBeInTheDocument();
    fireEvent.click(btn(t("sart.degistir.kapat_at")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applyChange).not.toHaveBeenCalled();
  });

  it("week0_change_says_baslangic_sarti", async () => {
    await mount([st({ week: 0 }), wk(0)]);
    await ac();
    expect(screen.getByText(t("sart.degistir.baslangic_sarti"))).toBeInTheDocument();
  });

  it("computing_disables_controls", async () => {
    const { src } = await mount();
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "12");
    act(() => src.emit("r", st({ computing: true })));
    expect(btn(uygulaAd())).toBeDisabled();
    expect(btn(t("degistir.kapat"))).toBeDisabled();
    expect(ustDugme()).toBeDisabled();
    yaz("Ücret stopajı", "20"); // hesaplanırken taslak değişmez (şeritte hâlâ %12)
    expect(screen.getAllByText("Ücret stopajı: %10 → %12").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ücret stopajı: %10 → %20")).toBeNull();
  });
});

describe("Şart paneli eylem sırası", () => {
  it("sarti_degistir_sonra_sart_sirasi", async () => {
    await mount();
    const adlar = within(screen.getByRole("complementary", { name: t("kurucu.sart.baslik") })).getAllByRole("button").map((b) => b.textContent);
    const i = (a: string) => adlar.indexOf(a);
    expect(i(t("degistir.dugme"))).toBeGreaterThanOrEqual(0);
    expect(i(t("degistir.dugme"))).toBeLessThan(i(t("ustcubuk.sart_dugme")));
  });

  it("karar_gunlugu_menude_ve_sart_panelinde_yok", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: t("ustcubuk.gunluk") })).toBeNull(); // menü kapalıyken
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.menu.dugme") }));
    expect(screen.getAllByRole("button", { name: t("ustcubuk.gunluk") })).toHaveLength(1);
  });
});

describe("Karar günlüğü", () => {
  const surum = (id: string, week: number, changes: NonNullable<WorldEvent["changes"]>): SimEvent => ({
    type: "world_event",
    event: { id, week, kind: "neutral", textKey: "event.version", params: { hafta: week, surum: 2 }, critical: false, sector: null, rule_ids: [], changes } as WorldEvent,
  });

  it("decision_log_lists_versions_and_notes", async () => {
    await mount([
      st({
        version: 3, values: { ucret_stopaji: 12.5 },
        versions: [
          { version: 1, fromWeek: 0, values: { ucret_stopaji: 10 } },
          { version: 2, fromWeek: 12, values: { ucret_stopaji: 15 }, note: "Kriz önlemi" },
          { version: 3, fromWeek: 30, values: { ucret_stopaji: 12.5 } },
        ],
      }),
      wk(5),
    ]);
    gunlukAc();
    const d = await screen.findByRole("dialog");
    const baslik = (s: string) => within(d).getByRole("heading", { name: s });
    expect(baslik(t("karar.surum", { n: 3, hafta: 30 }))).toBeInTheDocument();
    expect(baslik(t("karar.surum", { n: 2, hafta: 12 }))).toBeInTheDocument();
    expect(baslik(t("karar.baslangic", { n: 1 }))).toBeInTheDocument();
    expect(within(d).getByText("Ücret stopajı: %10 → %15")).toBeInTheDocument();
    expect(within(d).getByText("Ücret stopajı: %15 → %12,5")).toBeInTheDocument();
    expect(within(d).getByText(t("karar.not", { not: "Kriz önlemi" }))).toBeInTheDocument();
  });

  it("sürüm_olayinin_changes_satirlarindan_turer_kaynak_versions_bildirmiyorsa", async () => {
    await mount([st({ version: 2 }), wk(5), surum("version:2:5:x", 5, [{ id: "gecis_destegi", from: "kapali", to: "kisa_sureli" }])]);
    gunlukAc();
    const d = await screen.findByRole("dialog");
    expect(within(d).getByRole("heading", { name: t("karar.surum", { n: 2, hafta: 5 }) })).toBeInTheDocument();
    expect(within(d).getByText("Geçiş desteği: kapalı → kısa süreli")).toBeInTheDocument();
  });

  it("degisiklik_yokken_bos_ileti", async () => {
    await mount();
    gunlukAc();
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText(t("ustcubuk.gunluk_bos"))).toBeInTheDocument();
  });
});

describe("Olay akışı sürüm satırları", () => {
  it("olay_akisi_baslik_ve_alt_satirlari_gosterir", async () => {
    await mount([
      st({ version: 2 }), wk(41),
      { type: "world_event", event: { id: "version:2:41:x", week: 41, kind: "neutral", textKey: "event.version", params: { hafta: 41, surum: 2 }, critical: false, sector: null, rule_ids: [], changes: [{ id: "gecis_destegi", from: "kapali", to: "kisa_sureli" }, { id: "ucret_stopaji", from: 10, to: 12.5 }] } as WorldEvent },
    ]);
    await ayrintilariAc("Olaylar");
    const akis = await screen.findByRole("region", { name: t("canli.olay_akisi") });
    expect(await within(akis).findByText("Hf 41: Şart değişti, 41. haftadan sonrası yeni kuralla")).toBeInTheDocument();
    expect(within(akis).getByText("Geçiş desteği: kapalı → kısa süreli")).toBeInTheDocument();
    expect(within(akis).getByText("Ücret stopajı: %10 → %12,5")).toBeInTheDocument();
  });
});

describe("Geçiş desteği kartı: yeni kilit nedenleri (C2 M3)", () => {
  const neden = (reason: "locked" | "start_only" | "unverified" | "no_recording") => {
    const src = createFakeSource([], { kind: "live" });
    render(
      <SimSourceProvider source={src}>
        <GecisDestegiKarti value="kapali" onChange={() => {}} availability={{ ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "kapali", reason }] }} />
      </SimSourceProvider>,
    );
  };
  for (const [reason, key] of [["start_only", "lock.yeni_kosu"], ["locked", "lock.yeni_kosu"], ["unverified", "kart.dogrulanmadi"], ["no_recording", "lock.kayitsiz.live"]] as const) {
    it(`gecis_karti_${reason}_dogru_metin`, () => {
      neden(reason);
      expect(screen.getByText(t(key))).toBeInTheDocument();
    });
  }
});

describe("Etki önizlemesi koşu ortasında (I1)", () => {
  const durum = (over: Partial<RunState> = {}): RunState => ({
    runId: "r", status: "paused", week: 41, durationWeeks: 200, speed: 1, computing: false, version: 3, seedIndex: 0, scenarioId: "kapali", name: "Ada", cityNames: ["a", "b", "c", "d", "e"],
    values: { gecis_destegi: "kurtarma_fonuyla", ucret_stopaji: 12.5 },
    versions: [
      { version: 1, fromWeek: 0, values: { gecis_destegi: "kapali", ucret_stopaji: 10, baska: 1 } },
      { version: 2, fromWeek: 12, values: { gecis_destegi: "kisa_sureli", ucret_stopaji: 10, baska: 1 } },
      { version: 3, fromWeek: 30, values: { gecis_destegi: "kurtarma_fonuyla", ucret_stopaji: 12.5, baska: 1 } },
    ],
    ...over,
  });

  it("onizlemeTarifi_ilk_degerler_ve_takvim_sürümlerden", () => {
    expect(onizlemeTarifi(durum())).toEqual({
      baseValues: { gecis_destegi: "kapali", ucret_stopaji: 10 },
      kosuOrtasi: { fromWeek: 41, schedule: [{ week: 12, patch: { gecis_destegi: "kisa_sureli" } }, { week: 30, patch: { gecis_destegi: "kurtarma_fonuyla", ucret_stopaji: 12.5 } }] },
    });
    // koşu başlamadıysa ya da sürümler bilinmiyorsa önizleme baştan koşar
    expect(onizlemeTarifi(durum({ week: 0 })).kosuOrtasi).toBeUndefined();
    expect(onizlemeTarifi(durum({ versions: undefined })).kosuOrtasi).toBeUndefined();
  });

  it("onizleme_fromWeek_koşu_süresiyle_sınırlı_son_inceleme_M3", () => {
    expect(onizlemeTarifi(durum({ week: 200 })).kosuOrtasi?.fromWeek).toBe(199);          // sunucu: fromWeek < süre
    expect(onizlemeTarifi(durum({ week: 199 })).kosuOrtasi?.fromWeek).toBe(199);
    expect(onizlemeTarifi(durum({ week: 41, durationWeeks: 100 })).kosuOrtasi?.fromWeek).toBe(41);
    expect(onizlemeTarifi(durum({ week: 100, durationWeeks: 100 })).kosuOrtasi?.fromWeek).toBe(99);
  });

  it("taban_tarif_koşunun_kendisi_taslak_taban_artı_yeni_karar_fromWeek_artı_1", async () => {
    const { src } = await mount([st({ week: 41, version: 3, values: durum().values, versions: durum().versions }), wk(41)], "live", { jobs: true });
    const bos: Job = { jobId: "job-1", kind: "preview", status: "running", progress: { done: 0, total: 184 }, members: [] };
    const startJob = vi.fn<(x: PreviewSpec) => Promise<string>>(async () => "job-1");
    src.startJob = startJob;
    src.job = async () => bos;
    src.cancelJob = async () => ({ ...bos, status: "cancelled" });
    await ac();
    grup(/Vergiler/);
    yaz("Ücret stopajı", "15");
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(t("sart.ozet.onizleme_bilgi_ortasi", { n: 52 }))).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByRole("button", { name: t("sart.ozet.onizleme_baslat") })).toBeEnabled());
    fireEvent.click(within(dlg).getByRole("button", { name: t("sart.ozet.onizleme_baslat") }));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    const spec = startJob.mock.calls[0]![0];
    expect(spec.fromWeek).toBe(41);
    expect(spec.weeks).toBe(52);
    expect(spec.base.values).toEqual({ gecis_destegi: "kapali", ucret_stopaji: 10 });
    expect(spec.base.schedule).toEqual([{ week: 12, patch: { gecis_destegi: "kisa_sureli" } }, { week: 30, patch: { gecis_destegi: "kurtarma_fonuyla", ucret_stopaji: 12.5 } }]);
    expect(spec.draft.schedule).toEqual([...spec.base.schedule!, { week: 41, patch: { ucret_stopaji: 15 } }]);
  });
});
