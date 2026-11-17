import type { CopyKey } from "@/oyun/copy/t";
import { SimUnsupported } from "../SimSource";
import type {
  Availability, Capabilities, ChangeResult, Job, JobMember, JobSeriesKey, JobSpec, RunConfig, RunHandle, RunState, SettingAvail, SimEvent, SimSource, SourceInfo, Speed, ValuesPatch, WeekPacket, WorldEvent,
} from "../types";
import { detectEvents, eventCtxUpTo } from "./events";
import { createLoader, RecordingError, toPackets, type RecordingIndex } from "./loader";
import { encodeRunId, parseRunId, type RunRecipe } from "./runId";
import { scenarioFor, SETTING_ID } from "./scenarioMap";
import { prefixEqual, stitch } from "./stitch";
import { realTimer, type Timer } from "./timer";

export type ReplayOptions = { baseUrl?: string; fetchImpl?: typeof fetch; timer?: Timer; weekMs?: number; computeMs?: number };

type Run = {
  id: string;
  recipe: RunRecipe;
  packets: WeekPacket[];
  state: RunState;
  listeners: Set<(e: SimEvent) => void>;
  timer: number | null;
  /** `versionSets[v-1]`: v. sürümün ayar değerleri ve kayıt kümesi. */
  versionSets: { values: ValuesPatch; scenarioId: string }[];
  /** `versionEvents[v-2]`: v. sürümün "Şart değişti" olayı; `shown` yayıldıysa true. */
  versionEvents: { event: WorldEvent; shown: boolean }[];
  /** Karar notları (oturum belleği; kayıtta saklanmaz): sürüm numarası -> not. */
  notes: Map<number, string>;
};

/** Sürümler (Karar günlüğü): değer kümeleri ve oturumda yazılmış notlar. */
const versionsOf = (run: Run): NonNullable<RunState["versions"]> =>
  run.versionSets.map((s, i) => {
    const note = run.notes.get(i + 1);
    return { version: i + 1, fromWeek: i === 0 ? 0 : (run.recipe.changes[i - 1]?.week ?? 0), values: s.values, ...(note ? { note } : {}) };
  });

/** Kayıtta yalnız "aynı şartı başlangıç dünyalarının hepsinde koş" vardır (kayıtlı altı dünya); dal, karşılaştırma, kütüphane ve işler kapalıdır. */
const NO_CAPS: Capabilities = { branch: false, seeds: true, compare: false, library: false, city: false, chain: false, jobs: false };
const JOB_SERIES: readonly JobSeriesKey[] = ["served", "failed_cum", "city_cash_total", "gini", "unemployment_rate", "failed_total_cum", "unemployment_rate_all"];
const emptySeries = (): JobMember["series"] => ({ served: [], failed_cum: [], city_cash_total: [], gini: [], unemployment_rate: [], failed_total_cum: [], unemployment_rate_all: [] });
/** Kayıtta yalnız geçiş desteği değişir: iki sürümün değerleri farklıysa tek satır ("kapalı → kısa süreli"); eski değer yoksa `from: null`. */
const surumDegisimi = (from: ValuesPatch | undefined, to: ValuesPatch | undefined): NonNullable<WorldEvent["changes"]> => {
  const a = from?.[SETTING_ID];
  const b = to?.[SETTING_ID];
  return b === undefined || a === b ? [] : [{ id: SETTING_ID, from: a ?? null, to: b }];
};
const versionEvent = (version: number, week: number, setId: string, mod: "exact" | "nearest", changes: NonNullable<WorldEvent["changes"]> = []): WorldEvent => ({
  id: `version:${version}:${week}:${setId}`, week, kind: "neutral", textKey: "event.version", params: { hafta: week, mod, surum: version },
  critical: false, sector: null, rule_ids: [SETTING_ID], ...(changes.length > 0 ? { changes } : {}),
});
const errKey = (e: unknown): CopyKey => {
  if (!(e instanceof RecordingError)) throw e;
  return e.code === "http" || e.code === "network" ? "hata.kayit_yok" : "hata.kayit_bozuk";
};

export function createReplaySource(opts: ReplayOptions = {}): SimSource {
  const timer = opts.timer ?? realTimer;
  const weekMs = opts.weekMs ?? 600;
  const loader = createLoader({ baseUrl: opts.baseUrl, fetchImpl: opts.fetchImpl });
  const runs = new Map<string, Run>();
  const aliases = new Map<string, string>();
  const computeMs = opts.computeMs ?? 400;
  const computeWaits = new Set<(e: Error) => void>();
  const jobs = new Map<string, { job: Job; cancelled: boolean }>();
  let jobSeq = 0;
  let indexSync: RecordingIndex | null = null;
  let disposed = false;

  const guard = (): void => {
    if (disposed) throw new SimUnsupported("disposed");
  };
  const emit = (run: Run, e: SimEvent): void => {
    for (const l of [...run.listeners]) {
      try {
        l(e);
      } catch {
        // dinleyici hatası koşuyu bozmaz
      }
    }
  };
  const setState = (run: Run, patch: Partial<RunState>): void => {
    run.state = { ...run.state, ...patch };
    emit(run, { type: "state", state: run.state });
  };
  const getIndex = async (): Promise<RecordingIndex> => (indexSync = await loader.loadIndex());
  const resolve = (id: string): string => aliases.get(id) ?? id;
  const stopTimer = (run: Run): void => {
    if (run.timer !== null) timer.clearTimeout(run.timer);
    run.timer = null;
  };

  const schedule = (run: Run): void => {
    stopTimer(run);
    run.timer = timer.setTimeout(() => {
      run.timer = null;
      if (disposed || run.state.status !== "running") return;
      advance(run);
    }, weekMs / run.state.speed);
  };

  function showVersion(run: Run, ve: Run["versionEvents"][number] | undefined): void {
    if (!ve || ve.shown) return;
    ve.shown = true;
    emit(run, { type: "world_event", event: ve.event });
  }

  /** Tam bir hafta ilerletir; 200. haftada koşuyu bitirir (`ended` bir kez). */
  function advance(run: Run): void {
    if (run.state.status === "ended" || run.state.status === "failed") return;
    const week = run.state.week + 1;
    const packet = run.packets[week - 1];
    if (!packet) return;
    emit(run, { type: "week", packet });
    for (const ev of packet.events) emit(run, { type: "world_event", event: ev });
    const vs = run.versionSets[packet.version - 1];
    const ve = packet.version !== run.state.version ? run.versionEvents[packet.version - 2] : undefined;
    const crossing: Partial<RunState> = packet.version !== run.state.version && vs ? { version: packet.version, ...vs } : {};
    if (week >= run.state.durationWeeks) {
      stopTimer(run);
      setState(run, { week, status: "ended", endedReason: "duration", ...crossing });
      showVersion(run, ve);
      emit(run, { type: "ended", reason: "duration", week });
      return;
    }
    setState(run, { week, ...crossing });
    showVersion(run, ve);
    if (run.state.status === "running") schedule(run);
  }

  const baseState = (id: string, recipe: RunRecipe, index: RecordingIndex, values: ValuesPatch): RunState => ({
    runId: id, status: "paused", week: 0, durationWeeks: index.weeks, speed: 1, computing: false, version: 1,
    seedIndex: recipe.seedIndex, values, scenarioId: recipe.setId, name: recipe.name, cityNames: recipe.cityNames,
  });

  /** `week` sonrası paketlerin olaylarını, `week`'e kadarki bağlamdan yeniden kurar. */
  const annotate = (packets: WeekPacket[], week: number): void => {
    const ctx = eventCtxUpTo(packets, week);
    let prev: WeekPacket | null = packets[week - 1] ?? null;
    for (const p of packets) {
      if (p.week <= week) continue;
      p.events = detectEvents(prev, p, ctx);
      prev = p;
    }
  };

  /** Tarifteki taban kaydı ve dikişleri yükleyip birleştirir. */
  async function assemble(recipe: RunRecipe, id: string): Promise<{ packets: WeekPacket[]; modes: ("exact" | "nearest")[] }> {
    let packets = toPackets(await loader.loadRun(recipe.setId, recipe.seedIndex), id);
    annotate(packets, 0);
    const modes: ("exact" | "nearest")[] = [];
    for (const [i, c] of recipe.changes.entries()) {
      const next = toPackets(await loader.loadRun(c.setId, recipe.seedIndex), id);
      modes.push(prefixEqual(packets, next, c.week) ? "exact" : "nearest");
      packets = stitch(packets, next, c.week, i + 2);
      annotate(packets, c.week);
    }
    return { packets, modes };
  }

  async function build(recipe: RunRecipe, index: RecordingIndex, values: ValuesPatch, status: "ready" | "paused", prior?: Run): Promise<Run> {
    const id = encodeRunId(recipe);
    let packets: WeekPacket[] = [];
    let modes: ("exact" | "nearest")[] = [];
    let state: RunState = { ...baseState(id, recipe, index, values), status };
    try {
      ({ packets, modes } = await assemble(recipe, id));
    } catch (e) {
      state = { ...state, status: "failed", error: { messageKey: errKey(e), week: 0 } };
    }
    guard();
    const versionSets = [recipe.setId, ...recipe.changes.map((c) => c.setId)].map((sid) => ({
      values: index.sets.find((x) => x.id === sid)?.values ?? {}, scenarioId: sid,
    }));
    const versionEvents = recipe.changes.map((c, i) => ({ event: versionEvent(i + 2, c.week, c.setId, modes[i] ?? "exact", surumDegisimi(versionSets[i]?.values, versionSets[i + 1]?.values)), shown: false }));
    const run: Run = prior ?? { id, recipe, packets, state, listeners: new Set(), timer: null, versionSets, versionEvents, notes: new Map() };
    if (prior) {
      stopTimer(prior);
      prior.packets = packets;
      prior.recipe = recipe;
      prior.versionSets = versionSets;
      prior.versionEvents = versionEvents;
      setState(prior, { ...state, versions: versionsOf(prior) });
    }
    if (!prior) run.state = { ...run.state, versions: versionsOf(run) }; // kaynak takvimi bilir: tarif ("aynı şartla") kurulabilir
    aliases.delete(id);
    runs.set(id, run);
    return run;
  }

  const handle = (run: Run): RunHandle => ({ runId: run.id, state: run.state });
  const lookup = (runId: string): Run => {
    const run = runs.get(resolve(runId));
    if (!run) throw new SimUnsupported("run");
    return run;
  };

  return {
    kind: "replay",
    capabilities: NO_CAPS,

    async info(): Promise<SourceInfo> {
      guard();
      const index = await getIndex();
      const registry = await loader.loadRegistry();
      guard();
      // Kayıtta yalnız geçiş desteği ve başlangıç dünyası var; öbür kartlar kilitli ve nedeni "kayıt yok".
      const recorded = new Set<string>([SETTING_ID, "dunya_tohumu"]);
      const unrecorded: SettingAvail[] = (registry?.cards ?? []).filter((c) => !recorded.has(c.id)).map((c) => ({ id: c.id, options: [], changeable: false, reason: "no_recording" }));
      return {
        ...(registry ? { registry } : {}),
        capabilities: NO_CAPS,
        kind: "replay",
        modelNote: index.model_note,
        seeds: index.seeds.map((s) => ({ index: s.index })),
        durationWeeks: index.weeks,
        settings: [{
          id: SETTING_ID,
          options: index.sets.flatMap((s) => (typeof s.values[SETTING_ID] === "string" ? [{ value: String(s.values[SETTING_ID]), available: true }] : [])),
        }, ...unrecorded],
        fixedRules: index.fixed_rules,
        templates: index.templates,
      };
    },

    async availability(values: ValuesPatch): Promise<Availability> {
      guard();
      const scenarioId = scenarioFor(values, await getIndex());
      if (scenarioId !== null) return { ok: true, scenarioId, blocked: [] };
      return { ok: false, scenarioId: null, blocked: [{ settingId: SETTING_ID, option: String(values[SETTING_ID]), reason: "no_recording" }] };
    },

    async start(config: RunConfig): Promise<RunHandle> {
      guard();
      const index = await getIndex();
      guard();
      const setId = scenarioFor(config.values, index);
      if (setId === null || !index.seeds.some((s) => s.index === config.seedIndex) || config.durationWeeks > index.weeks) throw new SimUnsupported("config");
      const recipe: RunRecipe = { setId, seedIndex: config.seedIndex, changes: [], name: config.name, cityNames: config.cityNames };
      const values = index.sets.find((s) => s.id === setId)?.values ?? {};
      const run = await build(recipe, index, values, "ready", runs.get(encodeRunId(recipe)));
      return handle(run);
    },

    async open(runId: string): Promise<RunHandle | null> {
      guard();
      const rid = resolve(runId);
      const live = runs.get(rid);
      if (live && live.state.status !== "failed") return handle(live);
      let index: RecordingIndex;
      try {
        index = await getIndex();
      } catch {
        return null;
      }
      guard();
      const recipe = parseRunId(rid, index);
      if (recipe === null) return null;
      const again = runs.get(rid);
      if (again && again.state.status !== "failed") return handle(again);
      const values = index.sets.find((s) => s.id === recipe.setId)?.values ?? {};
      return handle(await build(recipe, index, values, "paused", again));
    },

    subscribe(runId, listener) {
      if (disposed) return () => {};
      const run = runs.get(resolve(runId));
      if (!run) {
        listener({ type: "error", messageKey: "hata.kosu_bulunamadi" });
        return () => {};
      }
      listener({ type: "state", state: run.state });
      for (let w = 1; w <= run.state.week; w++) listener({ type: "week", packet: run.packets[w - 1]! });
      for (const ve of run.versionEvents) if (ve.shown) listener({ type: "world_event", event: ve.event });
      run.listeners.add(listener);
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        run.listeners.delete(listener);
        if (run.listeners.size === 0 && run.state.status === "running") {
          stopTimer(run);
          run.state = { ...run.state, status: "paused" };
        }
      };
    },

    async control(runId, cmd): Promise<RunState> {
      guard();
      const run = lookup(runId);
      const st = run.state.status;
      if (st === "ended" || st === "failed" || run.state.computing) return run.state;
      if (cmd.speed !== undefined && cmd.speed !== 1 && cmd.speed !== 4 && cmd.speed !== 16) throw new SimUnsupported("speed");
      if (cmd.speed !== undefined && cmd.speed !== run.state.speed) setState(run, { speed: cmd.speed as Speed });
      if (cmd.action === "play") {
        if (st !== "running") {
          setState(run, { status: "running" });
          schedule(run);
        }
      } else if (cmd.action === "pause") {
        stopTimer(run);
        if (st === "running") setState(run, { status: "paused" });
      } else if (st !== "running") {
        if (st === "ready") setState(run, { status: "paused" });
        advance(run);
      }
      return run.state;
    },

    async applyChange(runId, change): Promise<ChangeResult> {
      guard();
      const run = lookup(runId);
      const blocked = (): ChangeResult | null => {
        if (run.state.status === "ended") return { accepted: false, fields: [{ id: "*", reason: "ended" }] };
        if (run.state.computing) return { accepted: false, fields: [{ id: "*", reason: "busy" }] };
        if (run.state.status === "failed") return { accepted: false, fields: [{ id: "*", reason: "invalid" }] };
        return null;
      };
      const early = blocked();
      if (early) return early;
      const index = indexSync ?? (await getIndex());
      guard();
      const late = blocked();
      if (late) return late;
      const setId = scenarioFor({ ...run.state.values, ...change.patch }, index);
      if (setId === null) return { accepted: false, fields: [{ id: SETTING_ID, reason: "no_recording" }] };
      const seam = run.state.week;
      if (setId === run.state.scenarioId) {
        return { accepted: true, runId: run.id, mode: "exact", scenarioId: setId, seamWeek: seam, version: run.state.version };
      }
      const oldId = run.id;
      // Yeni karar, kendinden sonraki (>= hafta) kayıtlı dikişlerin yerini alır.
      const keep = seam === 0 ? 0 : run.recipe.changes.filter((c) => c.week < seam).length;
      const changes = seam === 0 ? [] : [...run.recipe.changes.slice(0, keep), { week: seam, setId }];
      const recipe: RunRecipe = { ...run.recipe, setId: seam === 0 ? setId : run.recipe.setId, changes };
      const newId = encodeRunId(recipe);
      const version = seam === 0 ? 1 : keep + 2;
      const prevStatus = run.state.status;
      stopTimer(run);
      setState(run, { status: "paused", computing: true });
      let cancel: (e: Error) => void = () => {};
      const wait = new Promise<void>((done, fail) => {
        const id = timer.setTimeout(() => { computeWaits.delete(cancel); done(); }, computeMs);
        cancel = (e) => { timer.clearTimeout(id); fail(e); };
        computeWaits.add(cancel);
      });
      wait.catch(() => {});
      let next: WeekPacket[];
      try {
        next = toPackets(await loader.loadRun(setId, run.recipe.seedIndex), newId);
      } catch {
        guard();
        computeWaits.delete(cancel);
        setState(run, { computing: false, status: prevStatus });
        if (prevStatus === "running") schedule(run);
        emit(run, { type: "error", messageKey: "hata.degisiklik_basarisiz" });
        return { accepted: false, fields: [{ id: "*", reason: "invalid" }] };
      }
      await wait;
      guard();
      const mode = prefixEqual(run.packets, next, seam) ? "exact" : "nearest";
      const packets = stitch(run.packets, next, seam, version);
      annotate(packets, seam);
      const set = { values: index.sets.find((x) => x.id === setId)?.values ?? {}, scenarioId: setId };
      run.packets = packets;
      run.recipe = recipe;
      const fresh = { event: versionEvent(version, seam, setId, mode, surumDegisimi(run.state.values, set.values)), shown: true };
      run.versionEvents = seam === 0 ? [] : [...run.versionEvents.slice(0, keep), fresh];
      run.versionSets = seam === 0 ? [set] : [...run.versionSets.slice(0, keep + 1), set];
      if (newId !== oldId) {
        runs.delete(oldId);
        for (const [k, v] of aliases) if (v === oldId) aliases.set(k, newId);
        aliases.delete(newId);
        aliases.set(oldId, newId);
        run.id = newId;
        runs.set(newId, run);
      }
      const note = change.note?.trim();
      if (seam === 0) run.notes.clear();
      else if (note) run.notes.set(version, note);
      else run.notes.delete(version);
      setState(run, { runId: newId, status: "paused", computing: false, version, ...set, versions: versionsOf(run) });
      if (seam > 0) emit(run, { type: "world_event", event: fresh.event });
      return { accepted: true, runId: newId, mode, scenarioId: setId, seamWeek: seam, version };
    },

    async weeks(runId, from, to): Promise<WeekPacket[]> {
      guard();
      const run = lookup(runId);
      return run.packets.slice(Math.max(from, 1) - 1, Math.min(to, run.state.week));
    },

    async startJob(spec: JobSpec): Promise<string> {
      guard();
      // Kayıt gerçek koşu yapamaz: önizleme ve A/B yok; yalnız kayıtlı altı dünyada aynı şart.
      if (spec.kind !== "seeds") throw new SimUnsupported("invalid_job");
      const index = await getIndex();
      guard();
      const cfg = spec.recipe.config;
      const duration = cfg.durationWeeks;
      const setId = scenarioFor(cfg.values, index);
      if (!Number.isInteger(duration) || duration < 1 || duration > index.weeks || setId === null) throw new SimUnsupported("invalid_job");
      const changes: RunRecipe["changes"] = [];
      let values: ValuesPatch = { ...cfg.values };
      let last = setId;
      for (const e of [...spec.recipe.schedule].sort((a, b) => a.week - b.week)) {
        values = { ...values, ...e.patch };
        const next = scenarioFor(values, index);
        if (next === null || e.week < 1 || e.week >= index.weeks) throw new SimUnsupported("invalid_job");
        if (next === last) continue;
        const prior = changes[changes.length - 1];
        if (prior && prior.week === e.week) prior.setId = next;
        else changes.push({ week: e.week, setId: next });
        last = next;
      }
      const id = `job-${(++jobSeq).toString(16).padStart(8, "0")}`;
      const members: JobMember[] = index.seeds.map((sd) => ({ label: `seed-${sd.index}`, status: "queued", seedIndex: sd.index, weeks: 0, series: emptySeries() }));
      const entry: { job: Job; cancelled: boolean } = { job: { jobId: id, kind: "seeds", status: "running", progress: { done: 0, total: members.length }, members }, cancelled: false };
      jobs.set(id, entry);
      void (async () => {
        for (const [i, sd] of index.seeds.entries()) {
          if (entry.cancelled || disposed) return;
          const mark = (m: Partial<JobMember>, done: boolean): void => {
            const list = entry.job.members.map((x, j) => (j === i ? { ...x, ...m } : x));
            entry.job = { ...entry.job, members: list, progress: { done: entry.job.progress.done + (done ? 1 : 0), total: list.length } };
          };
          mark({ status: "running" }, false);
          try {
            const { packets } = await assemble({ setId, seedIndex: sd.index, changes, name: cfg.name, cityNames: cfg.cityNames }, id);
            if (entry.cancelled || disposed) return;
            const shown = packets.slice(0, duration);
            const series = emptySeries();
            for (const k of JOB_SERIES) series[k] = shown.map((p) => p.world[k] ?? null);
            mark({ status: "done", weeks: shown.length, series }, true);
          } catch {
            if (entry.cancelled || disposed) return;
            mark({ status: "failed", error: "recording_missing" }, false);
          }
        }
        if (!entry.cancelled) entry.job = { ...entry.job, status: entry.job.members.every((m) => m.status === "failed") ? "failed" : "done" };
      })();
      return id;
    },

    async job(id: string): Promise<Job> {
      guard();
      const entry = jobs.get(id);
      if (!entry) throw new SimUnsupported("unknown_job");
      return entry.job;
    },

    async cancelJob(id: string): Promise<Job> {
      guard();
      const entry = jobs.get(id);
      if (!entry) throw new SimUnsupported("unknown_job");
      if (entry.job.status === "running" || entry.job.status === "queued") {
        entry.cancelled = true;
        entry.job = { ...entry.job, status: "cancelled", members: entry.job.members.map((m) => (m.status === "done" ? m : { ...m, status: "cancelled" })) };
      }
      return entry.job;
    },

    dispose(): void {
      disposed = true;
      jobs.clear();
      for (const c of [...computeWaits]) c(new SimUnsupported("disposed"));
      computeWaits.clear();
      for (const run of runs.values()) {
        stopTimer(run);
        run.listeners.clear();
      }
      runs.clear();
      aliases.clear();
    },
  };
}
