import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { Sonuc } from "@/oyun/screens/sonuc/Sonuc";
import { decodeRecipe } from "@/oyun/sim/recipe";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Capabilities, Job, JobMember, JobSpec, RunConfig, RunHandle, RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { worldOf } from "../helpers/sehirZincirVeri";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = "";
});
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

/** Kasa tabanı şarta bağlıdır: kapalı geçiş desteğinde TRANS_FLOOR_WEEKS (2 hafta). */
const KAPALI = { gecis_destegi: "kapali" } as const;
const ADLAR = ["Ada", "Bora", "Cem", "Dil", "Efe"];
const runState = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 120, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 2, values: {}, scenarioId: "dayanikli_taban", name: "Deneme", cityNames: ADLAR, ...over,
});
const pk = (week: number, world: Partial<World> = {}, events: WorldEvent[] = []): WeekPacket => ({
  v: 1, run_id: "r", week, version: 1, world: worldOf({ served: 0.9, city_cash_total: 50000, city_cash_weeks: 5, gini: 0.5, failed_cum: 3, failed_total_cum: 3, ...world }), events,
});
const ev = (id: string, hafta: number, chain?: WorldEvent["chain"]): WorldEvent => ({
  id: `${id}:${hafta}`, week: hafta, kind: "bad", textKey: "event.cokus", params: { hafta }, critical: true, sector: null, rule_ids: [], ...(chain ? { chain } : {}),
});

const CAPS_LIVE: Partial<Capabilities> = { jobs: true };
type Mount = {
  state?: Partial<RunState>; weeks?: number; world?: (w: number) => Partial<World>; events?: Record<number, WorldEvent[]>;
  cashWeeks?: (w: number) => (number | null)[];
  kind?: "live" | "replay"; caps?: Partial<Capabilities>; jobs?: Job[]; start?: (s: JobSpec) => Promise<string>; runs?: RunHandle[] | null;
};
function mount(o: Mount = {}) {
  const n = o.weeks ?? 120;
  const script: SimEvent[] = [
    { type: "state", state: runState({ week: n, ...o.state }) },
    ...Array.from({ length: n }, (_, i): SimEvent => ({ type: "week", packet: { ...pk(i + 1, o.world?.(i + 1) ?? {}, o.events?.[i + 1] ?? []), ...(o.cashWeeks ? { cash_weeks: o.cashWeeks(i + 1) } : {}) } })),
  ];
  const queue = [...(o.jobs ?? [])];
  const startJob = vi.fn<(s: JobSpec) => Promise<string>>(o.start ?? (async () => "job-1"));
  const job = vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]!));
  const cancelJob = vi.fn<(id: string) => Promise<Job>>(async () => is("cancelled", "seeds", []));
  const listRuns = vi.fn(async () => o.runs ?? []);
  const src = createFakeSource(script, {
    kind: o.kind ?? "live", caps: o.caps ?? CAPS_LIVE, startJob, job, cancelJob, ...(o.runs === null ? {} : { listRuns }),
  });
  render(
    <SimSourceProvider source={src}>
      <Sonuc runId="r" restore={{ status: "ready" }} />
    </SimSourceProvider>,
  );
  return { src, startJob, job, cancelJob, listRuns };
}

const uye = (label: string, seedIndex: number, status: JobMember["status"] = "done", served = [0.9, 0.8, 0.4], error?: string): JobMember => ({
  label, status, seedIndex, weeks: served.length,
  series: { served, failed_cum: [0, 1, 2], city_cash_total: [1000, 900, 800], gini: [0.4, 0.4, 0.4], unemployment_rate: [0.1, 0.1, 0.1] }, ...(error ? { error } : {}),
});
const is = (status: Job["status"], kind: Job["kind"], members: JobMember[], done = 0, total = 600): Job => ({ jobId: "job-1", kind, status, progress: { done, total }, members });
const seedsDone = (bad: { i: number; error?: string }[] = []): Job => {
  const lines = [0, 1, 2, 3, 4, 5].map((i) => {
    const b = bad.find((x) => x.i === i);
    return b ? uye(`seed-${i}`, i, "failed", [0.9], b.error ?? "model_error") : uye(`seed-${i}`, i, "done", Array.from({ length: 40 }, (_, w) => (i < 3 && w >= 30 ? 0.4 : 0.9)));
  });
  return is("done", "seeds", lines, 6 * 100 - bad.length * 100, 600);
};

/** Yoklama aralığı ilerler (sahte saat; gerçek zamana bağlı değil): her çağrı bir yoklama. */
const yokla = async (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** Düğmeye basar; başlatma yanıtı işlenir ve ilk yoklama (gecikmesiz) yapılır. */
const bas = async (el: HTMLElement) => {
  await waitFor(() => expect(el).toBeEnabled()); // kaynak bilgisi (yetenekler) eşzamansız gelir
  fireEvent.click(el);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await yokla(0);
};
const bolum = (ad: string) => within(screen.getByRole("region", { name: ad }));
const oturdu = async () => screen.findByRole("heading", { name: /Ara durum|Çöküş|Çökmedi/ });

describe("Sonuç başlığı", () => {
  it("collapse_and_recovery_weeks_in_the_title", async () => {
    mount({ weeks: 80, events: { 57: [ev("cokus", 57)], 70: [{ ...ev("toparlanma", 70), kind: "good" }] }, state: { week: 80 } });
    expect(await screen.findByRole("heading", { name: t("sonuc.baslik.cokus", { n: 57 }) })).toBeInTheDocument();
    expect(screen.getByText(t("sonuc.toparlanma.var", { n: 70 }))).toBeInTheDocument();
  });

  it("collapse_without_recovery_and_still_running", async () => {
    mount({ weeks: 60, events: { 57: [ev("cokus", 57)] }, state: { week: 60 } });
    expect(await screen.findByRole("heading", { name: t("sonuc.baslik.cokus", { n: 57 }) })).toBeInTheDocument();
    expect(screen.getByText(t("sonuc.toparlanma.bekliyor"))).toBeInTheDocument();
  });

  it("collapse_causes_listed_from_the_event_chain_only_when_present", async () => {
    const chain = [{ step: "a", textKey: "event.destek_basladi" as const, params: { hafta: 55 } }, { step: "b", textKey: "event.kasa25" as const, params: { hafta: 56 } }];
    mount({ weeks: 80, events: { 57: [ev("cokus", 57, chain)] }, state: { week: 80 } });
    await oturdu();
    const liste = screen.getByRole("list", { name: t("sonuc.neden.adimlar") });
    expect(within(liste).getAllByRole("listitem").map((x) => x.textContent)).toEqual([t("event.destek_basladi", { hafta: 55 }), t("event.kasa25", { hafta: 56 })]);
    cleanup();
    mount({ weeks: 80, events: { 57: [ev("cokus", 57)] }, state: { week: 80 } });
    await oturdu();
    expect(screen.queryByRole("list", { name: t("sonuc.neden.adimlar") })).toBeNull();
    expect(screen.getByText(t("sonuc.neden.yok"))).toBeInTheDocument();
  });

  it("no_collapse_says_cokmedi_when_over_and_ara_durum_otherwise", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended" } });
    expect(await screen.findByRole("heading", { name: t("sonuc.baslik.ayakta", { n: 200 }) })).toBeInTheDocument();
    cleanup();
    mount({ weeks: 120 });
    expect(await screen.findByRole("heading", { name: t("sonuc.baslik.ara", { n: 120, toplam: 200 }) })).toBeInTheDocument();
    expect(screen.getByText(/Koşu sürüyor\./)).toBeInTheDocument();
    expect(screen.getByText(/Hafta 120 itibarıyla talep karşılama %90, kümülatif 3 işletme batışı, kasa 50 bin\./)).toBeInTheDocument();
  });
});

describe("hedef karnesi", () => {
  it("kasa_value_is_rounded_down_so_the_text_never_contradicts_the_verdict", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: KAPALI }, world: (w) => ({ city_cash_weeks: w === 100 ? 1.996 : 5 }) });
    await oturdu();
    const li = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(li.textContent).toContain(`${t("sonuc.karne.kasa_esik", { n: "1,99", taban: "2" })}${t("sonuc.karne.missed")}`); // 2 görünüp "tutturulamadı" demez
  });

  it("kasa_text_names_the_lowest_city_when_per_city_data_exists_else_the_total", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: KAPALI }, cashWeeks: (w) => [6, w === 100 ? 3.5 : 6, 7] });
    await oturdu();
    const li = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(li.textContent).toContain(`${t("sonuc.karne.kasa_sehir_esik", { n: "3,5", taban: "2" })}${t("sonuc.karne.met")}`);
    expect(li.textContent).not.toContain("toplam");
    cleanup();
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: KAPALI } });         // şehir verisi yok: eski ölçü ve eski metin
    await oturdu();
    const eski = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(eski.textContent).toContain(`${t("sonuc.karne.kasa_esik", { n: "5", taban: "2" })}${t("sonuc.karne.met")}`);
  });

  it("kasa_text_shows_the_deep_floor_when_rescue_fund_is_on", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: { gecis_destegi: "kurtarma_fonuyla" } }, cashWeeks: () => [1.2, 6] });
    await oturdu();
    const li = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(li.textContent).toContain(`${t("sonuc.karne.kasa_sehir", { n: "1,2", taban: "0,5" })}${t("sonuc.karne.met")}`);   // derin taban 0,5: 1,2 hafta yeterli
  });

  it("kasa_text_says_model_floor_only_when_a_support_rule_applies_it", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: { gecis_destegi: "kisa_sureli" } }, cashWeeks: () => [3, 6] });
    await oturdu();
    const li = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(li.textContent).toContain(t("sonuc.karne.kasa_sehir", { n: "3", taban: "2" })); // destek sürerken model taban uygular
    cleanup();
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["kasa"], values: KAPALI }, cashWeeks: () => [3, 6] });
    await oturdu();
    const kapali = bolum(t("sonuc.karne.baslik")).getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(t("kurucu.hedef.kasa", { n: 200 })));
    expect(kapali.textContent).toContain(t("sonuc.karne.kasa_sehir_esik", { n: "3", taban: "2" }));
    expect(kapali.textContent).not.toContain("uyguladığı");
  });

  it("goal_statuses_selected_unselected_unmeasured_and_pending", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended", goals: ["alive", "kasa"], values: KAPALI }, world: (w) => ({ served: null, gini: w < 200 ? 0.5 : 0.9, city_cash_weeks: w === 100 ? 1.5 : 5 }) });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const satir = (hedef: string) => k.getByText((_, el) => el?.tagName === "LI" && (el.textContent ?? "").includes(hedef));
    expect(satir(t("kurucu.hedef.alive", { n: 200 })).textContent).toContain(`${t("sonuc.karne.alive_yok")}${t("sonuc.karne.met")}`);
    expect(satir(t("kurucu.hedef.serve", { n: 200 })).textContent).toContain(t("sonuc.karne.secilmedi", { durum: t("sonuc.karne.unmeasured") }));
    expect(satir(t("kurucu.hedef.kasa", { n: 200 })).textContent).toContain(`${t("sonuc.karne.kasa_esik", { n: "1,5", taban: "2" })}${t("sonuc.karne.missed")}`);
    expect(satir(t("kurucu.hedef.gini", { n: 200 })).textContent).toContain(`${t("sonuc.karne.gini", { n: "0,90" })}${t("sonuc.karne.secilmedi", { durum: t("sonuc.karne.missed") })}`);
    cleanup();
    mount({ weeks: 60, state: { week: 60, goals: ["alive"] } });
    await oturdu();
    expect(within(screen.getByRole("list", { name: t("sonuc.karne.liste") })).getAllByText(new RegExp(t("sonuc.karne.pending")))).toHaveLength(4);
  });
});

describe("aynı şartı 6 dünyada koş", () => {
  const baslat = () => screen.getByRole("button", { name: t("sonuc.dunya.baslat") });
  const bol = () => within(screen.getByRole("region", { name: t("sonuc.dunya.baslik") }));
  const seriler = () => bol().queryAllByText((_, el) => el?.getAttribute("data-seri") !== null && el?.getAttribute("data-seri") !== undefined).length;
  const cizgiler = () => document.querySelectorAll("[data-seri]").length;
  const surum: Partial<RunState> = { versions: [{ version: 1, fromWeek: 0, values: {} }, { version: 2, fromWeek: 40, values: { ucret_stopaji: 12.5 } }], version: 2, values: { ucret_stopaji: 12.5 }, goals: ["alive"] };

  it("six_worlds_progress_cancel_and_partial_failure", async () => {
    const calls = mount({ state: surum, jobs: [is("running", "seeds", [uye("seed-0", 0, "running")], 100, 600), seedsDone([{ i: 4 }])] });
    await oturdu();
    await bas(baslat());
    expect(calls.startJob).toHaveBeenCalledTimes(1);
    const spec = calls.startJob.mock.calls[0]![0];
    // Tarif: başlangıç değerleri + sürüm takvimi (tarifOf); şehir adları ve ad da gider, `schedule` yapılandırmada değil tarifte.
    const beklenen = tarifOf(runState({ ...surum }));
    const { schedule, ...config } = beklenen;
    expect(spec).toEqual({ kind: "seeds", recipe: { config, schedule } });
    expect(spec.kind === "seeds" && "schedule" in spec.recipe.config).toBe(false);
    expect(bol().getByText(t("sonuc.dunya.ilerleme", { n: 16 }))).toBeInTheDocument();
    expect(bol().getByRole("progressbar", { name: t("sonuc.dunya.ilerleme_ad") })).toBeInTheDocument();
    // Başlatma düğmesi iş sürerken kapalıdır; iptal yoktur sunucuya gider.
    expect(baslat()).toBeDisabled();
    // Sayaç (`done` 500 < `total` 600) ile değil durumla biter: 5 çizgi + bir uyarı.
    await yokla();
    expect(cizgiler()).toBe(5);
    expect(bol().getByText(t("sonuc.dunya.uye_hata", { ad: "Dünya 5", neden: t("sonuc.hata.model_error") }))).toBeInTheDocument();
    expect(bol().getByText(/5 dünyanın 3 tanesi 40\. haftaya kadar çöktü; medyan çöküş haftası 31, en erken çöküş haftası 31\./)).toBeInTheDocument();
    expect(baslat()).toBeEnabled();
  });

  it("cancel_calls_the_server_and_says_so", async () => {
    const calls = mount({ jobs: [is("running", "seeds", [uye("seed-0", 0, "running")], 100, 600)] });
    await oturdu();
    await bas(baslat());
    fireEvent.click(bol().getByRole("button", { name: t("sonuc.dunya.iptal") }));
    await waitFor(() => expect(calls.cancelJob).toHaveBeenCalledWith("job-1"));
    expect(await bol().findByText(t("sonuc.is.iptal"))).toBeInTheDocument();
    expect(cizgiler()).toBe(0);
    expect(baslat()).toBeEnabled();
  });

  it("unknown_error_codes_get_a_neutral_text_and_all_failed_says_so", async () => {
    mount({ jobs: [seedsDone([{ i: 1, error: "yepyeni_kod" }])] });
    await oturdu();
    await bas(baslat());
    expect(bol().getByText(t("sonuc.dunya.uye_hata", { ad: "Dünya 2", neden: t("sonuc.hata.diger") }))).toBeInTheDocument();
    expect(bol().queryByText(/yepyeni_kod/)).toBeNull();
    cleanup();
    mount({ jobs: [is("failed", "seeds", [0, 1].map((i) => uye(`seed-${i}`, i, "failed", [], "model_error")), 0, 600)] });
    await oturdu();
    await bas(baslat());
    expect(bol().getByText(t("sonuc.is.bitmedi"))).toBeInTheDocument();
    expect(cizgiler()).toBe(0);
  });

  it("start_errors_busy_and_invalid", async () => {
    mount({ start: async () => { throw new SimUnsupported("job_running"); } });
    await oturdu();
    await waitFor(() => expect(baslat()).toBeEnabled());
    fireEvent.click(baslat());
    expect(await bol().findByText(t("sonuc.is.mesgul"))).toBeInTheDocument();
    cleanup();
    mount({ start: async () => { throw new SimUnsupported("invalid_job"); } });
    await oturdu();
    await waitFor(() => expect(baslat()).toBeEnabled());
    fireEvent.click(baslat());
    expect(await bol().findByText(t("sonuc.is.gecersiz"))).toBeInTheDocument();
  });

  it("disabled_with_reason_without_jobs_or_for_the_custom_world_and_open_for_replay_recordings", async () => {
    mount({ caps: { jobs: false } });
    await oturdu();
    expect(baslat()).toBeDisabled();
    expect(bol().getByText(t("sonuc.is.yok_yetenek"))).toBeInTheDocument();
    cleanup();
    mount({ state: { worldScenarioId: "ozel" } }); // eski sunucu: özel dünya değerleri durumda yok
    await oturdu();
    expect(baslat()).toBeDisabled();
    expect(bol().getByText(t("sonuc.is.ozel"))).toBeInTheDocument();
    cleanup();
    mount({ state: { version: 2, values: { ucret_stopaji: 12.5 } } }); // eski sunucu: sürüm takvimi durumda yok
    await oturdu();
    expect(baslat()).toBeDisabled();
    expect(bol().getByText(t("sonuc.is.surum"))).toBeInTheDocument();
    cleanup();
    const r = mount({ kind: "replay", caps: { seeds: true }, jobs: [seedsDone()] });
    await oturdu();
    expect(baslat()).toBeEnabled();
    expect(bol().getByText(t("sonuc.dunya.kayit"))).toBeInTheDocument();
    await bas(baslat());
    expect(r.startJob).toHaveBeenCalledTimes(1);
    expect(cizgiler()).toBe(6);
    void seriler;
  });

  it("custom_world_values_go_to_the_job_when_the_server_gives_them", async () => {
    const calls = mount({ state: { worldScenarioId: "ozel", worldScenarioValues: { ornek_akce: 3000 } }, jobs: [seedsDone()] });
    await oturdu();
    await bas(baslat());
    const spec = calls.startJob.mock.calls[0]![0];
    expect(spec.kind === "seeds" && [spec.recipe.config.worldScenarioId, spec.recipe.config.worldScenarioValues]).toEqual(["ozel", { ornek_akce: 3000 }]);
  });

  it("polling_continues_when_the_source_returns_the_same_job_object", async () => {
    // Kayıt kaynağı aynı `Job` nesnesini döndürebilir: yoklama nesne kimliğine değil sayaca bağlı olmalı.
    const calls = mount({ jobs: [is("running", "seeds", [uye("seed-0", 0, "running")], 100, 600)] });
    await oturdu();
    await bas(baslat());
    const once = calls.job.mock.calls.length;
    await yokla();
    await yokla();
    expect(calls.job.mock.calls.length).toBe(once + 2);
  });

  it("running_job_is_cancelled_when_leaving_the_screen", async () => {
    const calls = mount({ jobs: [is("running", "seeds", [uye("seed-0", 0, "running")], 100, 600)] });
    await oturdu();
    await bas(baslat());
    cleanup();
    expect(calls.cancelJob).toHaveBeenCalledWith("job-1");
  });
});

describe("A/B karşılaştırma", () => {
  const B_STATE: RunState = runState({
    runId: "b", name: "Dal koşusu", week: 80, values: { ucret_stopaji: 5, kurumlar_vergisi: 20, gecis_destegi: "kapali" },
    versions: [{ version: 1, fromWeek: 0, values: { ucret_stopaji: 5, kurumlar_vergisi: 20, gecis_destegi: "kapali" } }],
  });
  const A: Partial<RunState> = { values: { ucret_stopaji: 12.5, kurumlar_vergisi: 20, gecis_destegi: "kapali" } };
  const runs = (): RunHandle[] => [{ runId: "r", state: runState(A) }, { runId: "b", state: B_STATE }];
  const abDone = (): Job => is("done", "ab", [uye("a", 2), uye("b", 2, "done", [0.9, 0.8, 0.8])], 400, 400);
  const bol = () => within(screen.getByRole("region", { name: t("sonuc.ab.baslik") }));

  it("ab_lists_only_differences", async () => {
    const calls = mount({ state: A, runs: runs(), jobs: [abDone()] });
    await oturdu();
    // Kendisi B listesinde yoktur; yalnız öteki koşu seçenektir.
    // Grup koşu listesi gelmeden de çizilir (listRuns eşzamansız); aday düğmesi gelince denetlenir.
    const grup = await bol().findByRole("group", { name: t("sonuc.ab.b_grup") });
    await within(grup).findByRole("button");
    expect(within(grup).getAllByRole("button").map((b) => b.textContent)).toEqual([t("sonuc.ab.secenek", { ad: "Dal koşusu", n: 80 })]);
    expect(bol().getByRole("button", { name: t("sonuc.ab.baslat") })).toBeDisabled();
    fireEvent.click(within(grup).getByRole("button"));
    expect(within(grup).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await bas(bol().getByRole("button", { name: t("sonuc.ab.baslat") }));
    expect(calls.startJob).toHaveBeenCalledTimes(1);
    const spec = calls.startJob.mock.calls[0]![0];
    const a = tarifOf(runState(A));
    const b = tarifOf(B_STATE);
    const sansTakvim = (c: RunConfig): Omit<RunConfig, "schedule"> => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "schedule")) as Omit<RunConfig, "schedule">;
    expect(spec).toEqual({ kind: "ab", a: { config: sansTakvim(a), schedule: [] }, b: { config: sansTakvim(b), schedule: [] } });
    expect(document.querySelectorAll("[data-seri]")).toHaveLength(2);
    const tablo = bol().getByRole("table", { name: t("sonuc.ab.tablo") });
    const satirlar = within(tablo).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(satirlar).toEqual([["Ücret stopajı", "%12,5", "%5"]]); // Kurumlar vergisi ve Geçiş desteği aynı: listelenmez
    expect(within(tablo).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([t("sonuc.ab.tablo"), t("sonuc.ab.sutun_a"), t("sonuc.ab.sutun_b")]);
  });

  it("identical_settings_say_so_and_missing_values_use_the_card_default", async () => {
    const ayni = [{ runId: "r", state: runState({ values: { ucret_stopaji: 10 } }) }, { runId: "b", state: { ...B_STATE, values: {} } }];
    mount({ state: { values: { ucret_stopaji: 10 } }, runs: ayni, jobs: [abDone()] });
    await oturdu();
    fireEvent.click(await bol().findByRole("button", { name: /Dal koşusu/ }));
    await bas(bol().getByRole("button", { name: t("sonuc.ab.baslat") }));
    // Eksik değer kartın varsayılanıdır (ücret stopajı 10): fark yok.
    expect(bol().getByText(t("sonuc.ab.ayni"))).toBeInTheDocument();
    expect(bol().queryByRole("table", { name: t("sonuc.ab.tablo") })).toBeNull();
  });

  it("ab_none_replay_and_custom_world_reasons", async () => {
    mount({ runs: [{ runId: "r", state: runState() }] });
    await oturdu();
    expect(await bol().findByText(t("sonuc.ab.yok"))).toBeInTheDocument();
    cleanup();
    mount({ kind: "replay", caps: { seeds: true }, runs: null });
    await oturdu();
    expect(bol().getByText(t("sonuc.ab.yok_kayit"))).toBeInTheDocument();
    cleanup();
    mount({ runs: [{ runId: "r", state: runState() }, { runId: "b", state: { ...B_STATE, worldScenarioId: "ozel" } }] }); // eski sunucu: değerler yok
    await oturdu();
    fireEvent.click(await bol().findByRole("button", { name: /Dal koşusu/ }));
    expect(bol().getByRole("button", { name: t("sonuc.ab.baslat") })).toBeDisabled();
    expect(bol().getByText(t("sonuc.ab.ozel"))).toBeInTheDocument();
  });

  it("only_one_job_at_a_time_across_sections", async () => {
    mount({ state: A, runs: runs(), jobs: [is("running", "ab", [uye("a", 2, "running")], 10, 400)] });
    await oturdu();
    fireEvent.click(await bol().findByRole("button", { name: /Dal koşusu/ }));
    await bas(bol().getByRole("button", { name: t("sonuc.ab.baslat") }));
    expect(screen.getByRole("button", { name: t("sonuc.dunya.baslat") })).toBeDisabled();
  });
});

describe("şartı paylaş ve eylemler", () => {
  const kod = () => screen.getByRole("textbox", { name: t("sonuc.paylas.etiket") }) as HTMLInputElement;
  const surum: Partial<RunState> = { versions: [{ version: 1, fromWeek: 0, values: {} }, { version: 2, fromWeek: 40, values: { ucret_stopaji: 12.5 } }], version: 2, values: { ucret_stopaji: 12.5 } };

  it("share_code_is_the_runs_recipe_and_copy_uses_the_clipboard", async () => {
    const yaz = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: yaz }, configurable: true });
    mount({ state: surum });
    await oturdu();
    expect(kod()).toHaveAttribute("readonly");
    const d = decodeRecipe(kod().value);
    expect(d.ok && d.recipe.schedule).toEqual([{ week: 40, patch: { ucret_stopaji: 12.5 } }]);
    expect(d.ok && d.recipe.seedIndex).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: t("sonuc.paylas.kopyala") }));
    await waitFor(() => expect(yaz).toHaveBeenCalledWith(kod().value));
    expect(await screen.findByRole("button", { name: t("sonuc.paylas.kopyalandi") })).toBeInTheDocument();
  });

  it("without_clipboard_the_code_is_selected_for_manual_copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mount({ state: surum });
    await oturdu();
    fireEvent.click(screen.getByRole("button", { name: t("sonuc.paylas.kopyala") }));
    expect(await screen.findByText(t("sonuc.paylas.elle"))).toBeInTheDocument();
    expect(document.activeElement).toBe(kod());
    expect(kod().selectionEnd).toBe(kod().value.length);
    cleanup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("izin yok"); } }, configurable: true });
    mount({ state: surum });
    await oturdu();
    fireEvent.click(screen.getByRole("button", { name: t("sonuc.paylas.kopyala") }));
    expect(await screen.findByText(t("sonuc.paylas.elle"))).toBeInTheDocument();
  });

  it("custom_world_values_travel_in_the_code_and_old_servers_without_them_close_sharing", async () => {
    mount({ state: { worldScenarioId: "ozel", worldScenarioValues: { ornek_akce: 3000 } } });
    await oturdu();
    const d = decodeRecipe(kod().value);
    expect(d.ok && [d.recipe.worldScenarioId, d.recipe.worldScenarioValues]).toEqual(["ozel", { ornek_akce: 3000 }]);
    cleanup();
    mount({ state: { worldScenarioId: "ozel" } }); // eski sunucu: değerler yok
    await oturdu();
    expect(screen.queryByRole("textbox", { name: t("sonuc.paylas.etiket") })).toBeNull();
    expect(screen.getByText(t("sonuc.paylas.kapali_ozel"))).toBeInTheDocument();
  });

  it("changed_rule_without_server_versions_closes_sharing_with_a_reason", async () => {
    mount({ state: { version: 2, values: { ucret_stopaji: 12.5 } } }); // şart değişmiş ama sunucu `versions` vermiyor
    await oturdu();
    expect(screen.queryByRole("textbox", { name: t("sonuc.paylas.etiket") })).toBeNull();
    expect(screen.getByText(t("sonuc.paylas.kapali_surum"))).toBeInTheDocument();
  });

  it("go_live_and_change_rule_navigate_to_the_live_world", async () => {
    mount({ state: { status: "paused" } });
    await oturdu();
    fireEvent.click(screen.getByRole("button", { name: t("sonuc.canli") }));
    expect(window.location.hash).toBe("#/canli/r");
    cleanup();
    window.location.hash = "";
    mount({ state: { status: "paused" } });
    await oturdu();
    fireEvent.click(screen.getByRole("button", { name: t("sonuc.degistir") }));
    expect(window.location.hash).toBe("#/canli/r");
  });

  it("change_rule_is_closed_with_a_reason_when_the_run_ended", async () => {
    mount({ weeks: 200, state: { week: 200, status: "ended" } });
    await oturdu();
    const b = screen.getByRole("button", { name: t("sonuc.degistir") });
    expect(b).toBeDisabled();
    expect(screen.getByText(t("sonuc.degistir.kapali"))).toBeInTheDocument();
  });

  it("header_line_has_name_version_week_and_world", async () => {
    mount({ state: { version: 3 } });
    await oturdu();
    expect(screen.getByText(`Deneme · Şart v3 · Hafta 120 / 200 · Dünya: ${t("ustcubuk.dunya_varsayilan")}`)).toBeInTheDocument();
  });
});

describe("hedef karnesi: işe alım ve nüfus (D6)", () => {
  it("toplam_oyuncu_artisi_ve_npc_istihdam_orani_satirlari", async () => {
    mount({ weeks: 40, world: (w) => ({ players_total: 1500 + w, players_new_total: w, npc_employed: w === 1 ? 2000 : 2500, npc_pool: w === 1 ? 3000 : 2500 }) });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const artis = k.getByText((_, el) => el?.getAttribute("data-karne") === "oyuncu_artisi");
    expect(artis.textContent).toContain(t("sonuc.karne.oyuncu_artisi_detay", { ilk: "1.501", son: "1.540", yeni: "40" }));
    const npc = k.getByText((_, el) => el?.getAttribute("data-karne") === "npc_istihdam");
    expect(npc.textContent).toContain(t("sonuc.karne.npc_istihdam_detay", { ilk: "%40,0", son: "%50,0" }));
  });

  it("olculmediyse_satir_hic_gorunmez", async () => {
    mount({ weeks: 40 });
    await oturdu();
    expect(document.querySelector('[data-karne="oyuncu_artisi"]')).toBeNull();
    expect(document.querySelector('[data-karne="npc_istihdam"]')).toBeNull();
  });
});

describe("D10: iş piyasası akışları karne satırı", () => {
  it("is_bulma_orani_ve_sure_satiri_ve_toplam_akislar", async () => {
    mount({ weeks: 40, world: (w) => ({ job_finding_rate: w === 1 ? null : 0.05, unemployment_duration: w === 1 ? null : 20, hires: 10, separations: 12 }) });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const li = k.getByText((_, el) => el?.getAttribute("data-karne") === "is_akislari");
    expect(li.textContent).toContain(t("sonuc.karne.is_akislari_detay", { oran: "%5,0", sure: "20", alim: "400", ayrilma: "480" }));
  });

  it("olculmediyse_satir_hic_gorunmez", async () => {
    mount({ weeks: 40 });
    await oturdu();
    expect(document.querySelector('[data-karne="is_akislari"]')).toBeNull();
  });
});

describe("D11: para dağılımı karne satırı", () => {
  const dolu = { money_households: 60000, money_npc_firms: 30000, money_player_firms: 8000, money_city: 250000, money_lonca: 90000, money_other: 12000, ghost_firms: 41, ghost_closed: 1 };
  it("son_haftanin_paylari_ve_hayalet_sayisi", async () => {
    mount({ weeks: 40, world: () => dolu });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const li = k.getByText((_, el) => el?.getAttribute("data-karne") === "para_dagilimi");
    expect(li.textContent).toContain(t("sonuc.karne.para_dagilimi_detay", { hane: "%13,3", yerlesik: "%6,7", oyuncu: "%1,8", kasa: "%55,6", lonca: "%20,0", hayalet: "41", kapanan: "40" }));
    expect(li.textContent).toContain(t("sonuc.karne.para_dagilimi"));
  });

  it("olculmediyse_satir_hic_gorunmez", async () => {
    mount({ weeks: 40 });
    await oturdu();
    expect(document.querySelector('[data-karne="para_dagilimi"]')).toBeNull();
  });
});

describe("D10 ve D11: açılan iş piyasası ve para devresi kartları sonuçta yazılır (D10-M6)", () => {
  it("is_piyasasi_ve_para_devresi_kartlari_kurulum_satirinda", async () => {
    mount({
      weeks: 40,
      state: { week: 40, values: { kadro_hizi: { kural: "acik", kucul: 3, buyu: 10 }, para_devresi: "kar_hanelere", hayalet_firma: { kip: "iscisiz_kalan", hafta: 13 } } },
    });
    await oturdu();
    const p = document.querySelector('[data-sonuc="kurulum"]') as HTMLElement;
    expect(p.textContent).toContain("Kadro düzeltme hızı");
    expect(p.textContent).toContain("Paranın devri: kasada mı, hanede mi");
    expect(p.textContent).toContain("kâr hanelere temettü");
    expect(p.textContent).toContain("Hayalet işletmeler");
  });

  it("eski_kasa_ya_da_kar_karti_aciksa_bugunku_secimle_celisen_not_gorunur", async () => {
    mount({ weeks: 40, state: { week: 40, values: { sehir_kasasi_kurali: { acik: true, hafta: 4, yakinsama: 25 } } } });
    await oturdu();
    const n = document.querySelector('[data-sonuc="para-devri-notu"]') as HTMLElement;
    expect(n).not.toBeNull();
    expect(n.textContent).toBe(t("sonuc.para_devri_notu"));
    expect(t("sonuc.para_devri_notu")).toContain("eski iki kart");
  });

  it("eski_kartlar_kapaliyken_ya_da_yeni_secim_yapilmisken_not_yok", async () => {
    mount({ weeks: 40, state: { week: 40, values: { kar_firmada_kalir: { acik: true, hafta: 8 }, para_devresi: "kar_hanelere" } } });
    await oturdu();
    expect(document.querySelector('[data-sonuc="para-devri-notu"]')).toBeNull();
  });

  it("varsayilandaki_kartlar_yazilmaz", async () => {
    mount({ weeks: 40, state: { week: 40, values: { para_devresi: "kasa_biriktirir", kadro_hizi: { kural: "kapali", kucul: 3, buyu: 10 } } } });
    await oturdu();
    expect(document.querySelector('[data-sonuc="kurulum"]')).toBeNull();
  });
});

describe("D8: dünya kurulumu ayarları ve ölçüleri", () => {
  it("varsayilandan_farkli_secilen_kurulum_ayarlari_sonucta_yazilir", async () => {
    mount({ weeks: 40, state: { week: 40, values: { isletme_sayisi: 30, nufus_olcegi: true, baslangic_istihdami: 0 } } });
    await oturdu();
    const p = document.querySelector('[data-sonuc="kurulum"]') as HTMLElement;
    expect(p.textContent).toContain("Dünya kurulumu ayarları:");
    expect(p.textContent).not.toContain("hane geliri ayarları");
    expect(p.textContent).not.toContain("deneysel ayarlar");
    expect(p.textContent).toContain("Nüfus başına işletme");
    expect(p.textContent).toContain("Nüfus ölçeği");
    expect(p.textContent).not.toContain("İlk haftada işe alınan NPC oranı");          // varsayılanda kalan ayar yazılmaz
  });

  it("kurulum_ayarlari_liste_olarak_ve_ad_iki_nokta_deger_biciminde_yazilir", async () => {
    mount({ weeks: 40, state: { week: 40, values: { kadro_hizi: { kural: "acik", kucul: 5, buyu: 20 }, nufus_olcegi: true } } });
    await oturdu();
    const p = document.querySelector('[data-sonuc="kurulum"]') as HTMLElement;
    const maddeler = Array.from(p.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(maddeler).toHaveLength(2);
    expect(maddeler.some((m) => m.startsWith("Kadro düzeltme hızı: "))).toBe(true);
    expect(maddeler.some((m) => m.startsWith("Nüfus ölçeği: "))).toBe(true);
    expect(maddeler.join("|")).not.toContain("; Nüfus");                          // maddeler ";" ile birleştirilmez: alan ayırıcısı madde ayırıcısıyla karışmaz
  });

  it("active_hane_geliri_karti_varsayilandan_farkliysa_kurulum_satirinda_gorunur", async () => {
    mount({ weeks: 40, state: { week: 40, values: { servet_kurali: false } } });
    await oturdu();
    const p = document.querySelector('[data-sonuc="kurulum"]') as HTMLElement;
    expect(p.textContent).toContain("Servete göre harcama");
  });

  it("kurulum_ayari_degismediyse_satir_hic_gorunmez", async () => {
    mount({ weeks: 40 });
    await oturdu();
    expect(document.querySelector('[data-sonuc="kurulum"]')).toBeNull();
  });

  it("karne_isletme_sayisi_doluluk_ve_acilis_kadrosu", async () => {
    mount({ weeks: 40, world: (w) => ({ firms_total: 120 + w, staff_fill: w === 1 ? 0.8 : 0.6, opening_staff: 2663 }) });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const isletme = k.getByText((_, el) => el?.getAttribute("data-karne") === "isletme_sayisi");
    expect(isletme.textContent).toContain(t("sonuc.karne.isletme_detay", { ilk: "121", son: "160" }));
    const doluluk = k.getByText((_, el) => el?.getAttribute("data-karne") === "kadro_doluluk");
    expect(doluluk.textContent).toContain(t("sonuc.karne.doluluk_detay", { ilk: "%80", son: "%60" }));
    const acilis = k.getByText((_, el) => el?.getAttribute("data-karne") === "acilis_kadrosu");
    expect(acilis.textContent).toContain(t("sonuc.karne.acilis_detay", { n: "2.663" }));
    expect(acilis.textContent).toContain("İlk haftada işe alınan NPC");
  });

  it("olculmediyse_kurulum_satirlari_gorunmez", async () => {
    mount({ weeks: 40 });
    await oturdu();
    expect(document.querySelector('[data-karne="isletme_sayisi"]')).toBeNull();
    expect(document.querySelector('[data-karne="acilis_kadrosu"]')).toBeNull();
  });
});

describe("D9: hane geliri ve NPC hanesi ayarları Sonuç'ta", () => {
  it("varsayilandan_farkli_hane_ayarlari_kurulum_satirinda_yazilir", async () => {
    mount({ weeks: 40, state: { week: 40, values: { npc_hanesi: { kip: "hane", katilim: 50, agirlik: 50 }, npc_asgari: true, acilis_gecisi: { kip: "dengede", kurtarma: 26, kasa: 26, yatirim: 26, supurme: 26 }, servet_kurali: true } } });
    await oturdu();
    const p = document.querySelector('[data-sonuc="kurulum"]') as HTMLElement;
    expect(p.textContent).toContain("NPC hanesi ve işgücüne katılım");
    expect(p.textContent).toContain("Açılış geçişi");
    expect(p.textContent).toContain("İşsiz NPC'ye asgari güvence");
    expect(p.textContent).not.toContain("Servete göre harcama");                // varsayılanda kalan ayar yazılmaz
  });
});

describe("D9: karnede işgücü satırı", () => {
  it("hane_kipinde_katilim_ve_bakmakla_yukumlu_yazilir", async () => {
    mount({ weeks: 40, world: () => ({ npc_lfp: 0.527, npc_dependents: 2410 }) });
    await oturdu();
    const k = bolum(t("sonuc.karne.baslik"));
    const satir = k.getByText((_, el) => el?.getAttribute("data-karne") === "isgucu");
    expect(satir.textContent).toContain(t("sonuc.karne.isgucu_detay", { oran: "%53", n: "2.410" }));
  });

  it("tek_kisi_kipinde_ya_da_olculmediyse_satir_gorunmez", async () => {
    mount({ weeks: 40, world: () => ({ npc_lfp: 1, npc_dependents: 0 }) });
    await oturdu();
    expect(document.querySelector('[data-karne="isgucu"]')).toBeNull();
  });
});
