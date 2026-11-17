import type { CopyKey } from "@/oyun/copy/t";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { contractRegistry } from "./registryFixtures";
import type {
  Availability, Capabilities, ChangeResult, DrawerData, WorldInfo, Registry, RunConfig, RunHandle, RunState, SimEvent, SimSource, SourceInfo, ValuesPatch, WeekPacket, World, WorldEvent,
} from "@/oyun/sim/types";

/** Gerçek sözleşme fikstüründen (`registry_contract.json`); eski adı korunur. */
export const draftRegistry = (): Registry => contractRegistry();

export type FakeOpts = {
  runId?: string; aliases?: Record<string, string>; unknownKey?: CopyKey; kind?: "replay" | "live";
  /** Bildirilen yetenekler (`info().capabilities`); verilmezse hiç bildirilmez. */
  caps?: Partial<Capabilities>;
  /** `info().world` (şehir ve zincir statik bilgisi). */
  world?: WorldInfo;
  /** Çekmece çağrısı; verilmezse kaynakta `drawer` yoktur. */
  drawer?: (runId: string, kind: string, ref: string, week: number) => Promise<DrawerData>;
  /** Dallanma ve koşu atma (W9b); verilmezse kaynakta yoktur. */
  branch?: SimSource["branch"];
  discard?: SimSource["discard"];
  /** Arka plan işleri ve koşu listesi (W10); verilmezse kaynakta yoktur. */
  startJob?: SimSource["startJob"];
  job?: SimSource["job"];
  cancelJob?: SimSource["cancelJob"];
  listRuns?: SimSource["listRuns"];
  /** Açılış kapasite hesabı (D8); verilmezse kaynakta yoktur. */
  worldPlan?: SimSource["worldPlan"];
};
export type FakeSource = SimSource & {
  emit(runId: string, e: SimEvent): void;
  readonly subscribeCalls: number;
  readonly activeSubscriptions: number;
  readonly opens: number;
  readonly disposed: number;
};

const baseState = (runId: string): RunState => ({
  runId, status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1,
  seedIndex: 0, values: {}, scenarioId: "fake", name: "Ada", cityNames: ["a", "b", "c", "d", "e"],
});

/** Betikteki olayları abone olunca eşzamanlı verir; `emit` canlı olay yollar. */
export function createFakeSource(script: SimEvent[], opts: FakeOpts = {}): FakeSource {
  const id = opts.runId ?? "r";
  const aliases = opts.aliases ?? {};
  const listeners = new Map<string, Set<(e: SimEvent) => void>>();
  const resolve = (r: string): string | null => (r === id ? id : (aliases[r] ?? null));
  let subscribeCalls = 0;
  let active = 0;
  let opens = 0;
  let disposed = 0;

  const info: SourceInfo = { kind: opts.kind ?? "replay", modelNote: "", seeds: [], durationWeeks: 200, settings: [], fixedRules: [], templates: [], registry: draftRegistry(),
    ...(opts.caps ? { capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false, ...opts.caps } } : {}),
    ...(opts.world ? { world: opts.world } : {}) };
  const avail: Availability = { ok: true, scenarioId: null, blocked: [] };

  const guard = (): void => {
    if (disposed > 0) throw new SimUnsupported("disposed");
  };

  return {
    kind: opts.kind ?? "replay",
    capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => (guard(), info),
    availability: async () => (guard(), avail),
    start: async (config: RunConfig): Promise<RunHandle> => (guard(), { runId: id, state: { ...baseState(id), seedIndex: config.seedIndex, values: config.values } }),
    open: async (r: string): Promise<RunHandle | null> => {
      guard();
      opens += 1;
      const cur = resolve(r);
      return cur === null ? null : { runId: cur, state: baseState(cur) };
    },
    subscribe(r, listener) {
      guard();
      subscribeCalls += 1;
      const cur = resolve(r);
      if (cur === null) {
        listener({ type: "error", messageKey: opts.unknownKey ?? "hata.kosu_bulunamadi" });
        return () => {};
      }
      active += 1;
      let set = listeners.get(cur);
      if (!set) listeners.set(cur, (set = new Set()));
      set.add(listener);
      for (const e of script) listener(e);
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        active -= 1;
        set.delete(listener);
      };
    },
    control: async (r) => (guard(), baseState(resolve(r) ?? r)),
    applyChange: async (): Promise<ChangeResult> => (guard(), { accepted: false, fields: [] }),
    weeks: async (r, from, to): Promise<WeekPacket[]> => {
      guard();
      if (resolve(r) === null) throw new SimUnsupported();
      return script.flatMap((e) => (e.type === "week" && e.packet.week >= from && e.packet.week <= to ? [e.packet] : []));
    },
    ...(opts.drawer ? { drawer: opts.drawer } : {}),
    ...(opts.branch ? { branch: opts.branch } : {}),
    ...(opts.discard ? { discard: opts.discard } : {}),
    ...(opts.startJob ? { startJob: opts.startJob } : {}),
    ...(opts.worldPlan ? { worldPlan: opts.worldPlan } : {}),
    ...(opts.job ? { job: opts.job } : {}),
    ...(opts.cancelJob ? { cancelJob: opts.cancelJob } : {}),
    ...(opts.listRuns ? { listRuns: opts.listRuns } : {}),
    dispose() { disposed += 1; },
    emit(r, e) {
      const cur = resolve(r);
      if (cur !== null) for (const l of [...(listeners.get(cur) ?? [])]) l(e);
    },
    get subscribeCalls() { return subscribeCalls; },
    get activeSubscriptions() { return active; },
    get opens() { return opens; },
    get disposed() { return disposed; },
  };
}

const NULL_WORLD: World = {
  served: null, unemployed: null, employed: null, npc_firms: null, player_firms: null, failed_cum: null,
  city_cash_total: null, city_cash_weeks: null, gini: null, price_index: null, inflation_yoy: null,
  unemployment_rate: null, policy_rate: null, minted_year: null, mint_cap: null, loans_applied: null,
  loans_rejected: null, loans_granted: null, loan_rate_avg: null, support_weekly: null, survival_52: null,
  wage_index: null, rent_pct: null, occupancy: null, house_index: null, deposit_rate: null, bond_rate: null,
  lonca_fee_avg: null, royalty_avg: null, money_total: null, velocity: null, privatized_firms: null,
  no_founder: null, reject_pool: null, reject_reputation: null, no_buyer_cum: null, support_denied: null, policy_unemployment: null, city_spend_cut: null, tenants_per_house: null, house_resale_ratio: null, policy_inflation: null, minted_total: null,
};
export type ContractFake = SimSource & { advance(): void };

/**
 * Durumlu sahte kaynak: `ReplaySource` ile aynı davranış sözleşmesini (types.ts JSDoc) uygular.
 * Kimlik sabit `"r"`, `open` taze (hafta 0) koşu açar; `applyChange` `advance()` çağrılana dek `computing` kalır.
 */
export function createContractFake(opts: { weeks?: number } = {}): ContractFake {
  const duration = opts.weeks ?? 6;
  const ID = "r";
  const SETTING = "gecis_destegi";
  const OPTIONS = ["kapali", "kisa_sureli", "kurtarma_fonuyla"];
  type Run = { state: RunState; packets: WeekPacket[]; versionEvents: { event: WorldEvent; shown: boolean }[]; listeners: Set<(e: SimEvent) => void> };
  let run: Run | null = null;
  let disposed = false;
  const releases: (() => void)[] = [];

  const guard = (): void => {
    if (disposed) throw new SimUnsupported("disposed");
  };
  const emit = (r: Run, e: SimEvent): void => {
    for (const l of [...r.listeners]) l(e);
  };
  const setState = (r: Run, patch: Partial<RunState>): void => {
    r.state = { ...r.state, ...patch };
    emit(r, { type: "state", state: r.state });
  };
  const fresh = (status: RunState["status"], values: ValuesPatch): Run => ({
    state: {
      runId: ID, status, week: 0, durationWeeks: duration, speed: 1, computing: false, version: 1,
      seedIndex: 0, values, scenarioId: String(values[SETTING] ?? "kapali"), name: "Ada", cityNames: ["a", "b", "c", "d", "e"],
    },
    packets: [], versionEvents: [], listeners: new Set(),
  });
  const lookup = (id: string): Run => {
    if (id !== ID || !run) throw new SimUnsupported("run");
    return run;
  };
  const advanceWeek = (r: Run): void => {
    const week = r.state.week + 1;
    const packet: WeekPacket = { v: 1, run_id: ID, week, version: r.state.version, world: NULL_WORLD, events: [] };
    r.packets.push(packet);
    emit(r, { type: "week", packet });
    if (week >= r.state.durationWeeks) {
      setState(r, { week, status: "ended", endedReason: "duration" });
      emit(r, { type: "ended", reason: "duration", week });
    } else {
      setState(r, { week });
    }
  };

  const info: SourceInfo = {
    kind: "replay", modelNote: "", seeds: [{ index: 0 }], durationWeeks: duration,
    settings: [{ id: SETTING, options: OPTIONS.map((value) => ({ value, available: true })) }], fixedRules: [], templates: [],
    registry: draftRegistry(),
  };

  return {
    kind: "replay",
    capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => (guard(), info),
    availability: async () => (guard(), { ok: true, scenarioId: null, blocked: [] }),
    start: async (config: RunConfig): Promise<RunHandle> => {
      guard();
      run = fresh("ready", config.values);
      return { runId: ID, state: run.state };
    },
    open: async (id: string): Promise<RunHandle | null> => {
      guard();
      if (id !== ID) return null;
      run ??= fresh("paused", { [SETTING]: "kapali" });
      return { runId: ID, state: run.state };
    },
    subscribe(id, listener) {
      if (disposed) return () => {};
      if (id !== ID || !run) {
        listener({ type: "error", messageKey: "hata.kosu_bulunamadi" });
        return () => {};
      }
      const r = run;
      listener({ type: "state", state: r.state });
      for (const p of r.packets) listener({ type: "week", packet: p });
      for (const ve of r.versionEvents) if (ve.shown) listener({ type: "world_event", event: ve.event });
      r.listeners.add(listener);
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        r.listeners.delete(listener);
      };
    },
    control: async (id, cmd): Promise<RunState> => {
      guard();
      const r = lookup(id);
      const st = r.state.status;
      if (st === "ended" || st === "failed" || r.state.computing) return r.state;
      if (cmd.speed !== undefined && cmd.speed !== r.state.speed) setState(r, { speed: cmd.speed });
      if (cmd.action === "play") {
        if (st !== "running") setState(r, { status: "running" });
      } else if (cmd.action === "pause") {
        if (st === "running") setState(r, { status: "paused" });
      } else if (st !== "running") {
        if (st === "ready") setState(r, { status: "paused" });
        advanceWeek(r);
      }
      return r.state;
    },
    applyChange: async (id, change): Promise<ChangeResult> => {
      guard();
      const r = lookup(id);
      if (r.state.status === "ended") return { accepted: false, fields: [{ id: "*", reason: "ended" }] };
      if (r.state.computing) return { accepted: false, fields: [{ id: "*", reason: "busy" }] };
      const next = change.patch[SETTING];
      if (typeof next !== "string" || !OPTIONS.includes(next)) return { accepted: false, fields: [{ id: SETTING, reason: "invalid" }] };
      const seam = r.state.week;
      const prev = r.state.status;
      setState(r, { status: "paused", computing: true });
      await new Promise<void>((done) => releases.push(done));
      guard();
      const version = seam === 0 ? 1 : r.state.version + 1;
      const ve: WorldEvent = {
        id: `version:${version}:${seam}:${next}`, week: seam, kind: "neutral", textKey: "event.version",
        params: { hafta: seam, mod: "exact", surum: version }, critical: false, sector: null, rule_ids: [SETTING],
      };
      if (seam > 0) r.versionEvents.push({ event: ve, shown: true });
      setState(r, { status: prev === "ready" ? "ready" : "paused", computing: false, version, values: { ...r.state.values, ...change.patch }, scenarioId: next });
      if (seam > 0) emit(r, { type: "world_event", event: ve });
      return { accepted: true, runId: ID, mode: "exact", scenarioId: next, seamWeek: seam, version };
    },
    weeks: async (id, from, to): Promise<WeekPacket[]> => {
      guard();
      return lookup(id).packets.filter((p) => p.week >= from && p.week <= to);
    },
    dispose() {
      disposed = true;
      for (const r of releases.splice(0)) r();
      if (run) run.listeners.clear();
    },
    advance() {
      for (const r of releases.splice(0)) r();
    },
  };
}
