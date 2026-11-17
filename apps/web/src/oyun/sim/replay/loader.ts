import type { CopyKey } from "@/oyun/copy/t";
import { parseRegistry } from "../live/wire";
import type { Registry, ValuesPatch, WeekPacket, World } from "../types";

export type RecordingIndex = {
  schema: "oyun-kayit/1";
  model_note: string;
  weeks: number;
  seeds: { index: number; label: number }[];
  sets: { id: string; values: ValuesPatch; files: Record<string, string> }[];
  derived: string[];
  fixed_rules: { settingId: string; valueKey: CopyKey }[];
  templates: { id: string; values: ValuesPatch }[];
};
export type RecordedRun = { set: string; pm_index: number; weeks: number; cols: Record<string, (number | null)[]> };

export class RecordingError extends Error {
  readonly code: "http" | "json" | "shape" | "network";
  constructor(code: "http" | "json" | "shape" | "network") {
    super(code);
    this.name = "RecordingError";
    this.code = code;
  }
}

const WORLD_FLAGS: Record<keyof World, true> = {
  served: true, unemployed: true, employed: true, npc_firms: true, player_firms: true, failed_cum: true, city_cash_total: true,
  city_cash_weeks: true, gini: true, price_index: true, inflation_yoy: true, unemployment_rate: true, policy_rate: true,
  minted_year: true, mint_cap: true, loans_applied: true, loans_rejected: true, loans_granted: true, loan_rate_avg: true,
  support_weekly: true, survival_52: true, wage_index: true, rent_pct: true, occupancy: true, house_index: true,
  deposit_rate: true, bond_rate: true, lonca_fee_avg: true, royalty_avg: true, money_total: true, velocity: true,
  privatized_firms: true, no_founder: true, reject_pool: true, reject_reputation: true, no_buyer_cum: true,
  support_denied: true, policy_unemployment: true, city_spend_cut: true,
  tenants_per_house: true, house_resale_ratio: true, policy_inflation: true, minted_total: true,
  npc_pool: true, npc_employed: true, npc_broke: true, npc_pool_cash_avg: true, players_seeking: true, players_in_ahir: true, players_students: true,
  unemployment_rate_all: true, benefit_paid: true, benefit_paid_npc: true, muni_wages: true, bursary_paid: true, benefit_cut: true,
  players_total: true, players_new: true, players_new_total: true, ahir_capacity: true, ahir_fill: true, npc_firm_npc: true, npc_firm_players: true,
  hired_player: true, hired_npc: true, fired_player: true, fired_npc: true, ahir_moves: true, ahir_backfilled: true, inflow_blocked: true,
  staff_fill: true, kinds_full: true, house_stock: true, opening_staff: true, firms_total: true, npc_dependents: true, npc_lfp: true,
  npc_discouraged: true, muni_npc: true, hires: true, separations: true, quits_npc: true, job_finding_rate: true, unemployment_duration: true,
  money_households: true, money_npc_firms: true, money_player_firms: true, money_city: true, money_lonca: true, money_other: true,
  city_in_tax: true, city_in_profit: true, city_in_rent: true, city_in_mint: true, city_in_other: true,
  city_out_households: true, city_out_wages: true, city_out_services: true, city_out_firms: true, city_out_other: true, ghost_firms: true, ghost_closed: true,
  wealth_top10: true, wealth_top1: true, wealth_median: true, income_gini: true, income_top10: true, liquid_b50: true, liquid_m40: true, liquid_t10: true,
  founders_applied: true, founders_rejected: true, failed_player_cum: true, failed_dao_cum: true, failed_npc_default_cum: true, failed_total_cum: true,
  vacancies: true, staffless_npc: true, wage_fail: true, unemp_long_share: true, hires_stable4: true,
};
export const WORLD_KEYS = Object.keys(WORLD_FLAGS) as (keyof World)[];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    throw new RecordingError("network");
  }
  if (!res.ok) throw new RecordingError(res.status >= 500 ? "network" : "http");
  try {
    return await res.json();
  } catch {
    throw new RecordingError("json");
  }
}

function checkIndex(v: unknown): RecordingIndex {
  if (!isObj(v) || v.schema !== "oyun-kayit/1" || typeof v.weeks !== "number" || !Array.isArray(v.seeds) || !Array.isArray(v.sets)) throw new RecordingError("shape");
  const okSet = (x: unknown): boolean => isObj(x) && typeof x.id === "string" && isObj(x.values) && isObj(x.files);
  const okSeed = (x: unknown): boolean => isObj(x) && typeof x.index === "number" && typeof x.label === "number";
  if (!v.sets.every(okSet) || !v.seeds.every(okSeed)) throw new RecordingError("shape");
  return { derived: [], fixed_rules: [], templates: [], model_note: "", ...v } as unknown as RecordingIndex;
}

export type Loader = {
  loadIndex(): Promise<RecordingIndex>;
  /** Statik `registry.json` (K1 yayımı); yoksa ya da bozuksa `null`. */
  loadRegistry(): Promise<Registry | null>;
  loadRun(setId: string, seedIndex: number): Promise<RecordedRun>;
};

export function createLoader(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): Loader {
  const base = (opts.baseUrl ?? "/oyun-kayit").replace(/\/$/, "");
  const doFetch: typeof fetch = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  let indexP: Promise<RecordingIndex> | null = null;
  const runs = new Map<string, Promise<RecordedRun>>();
  let registryP: Promise<Registry | null> | null = null;
  const drop = <T>(p: Promise<T>, undo: () => void): Promise<T> => p.catch((e: unknown) => { undo(); throw e; });

  const loadIndex = (): Promise<RecordingIndex> => (indexP ??= drop(getJson(doFetch, `${base}/index.json`).then(checkIndex), () => { indexP = null; }));

  const loadRun = (setId: string, seedIndex: number): Promise<RecordedRun> => {
    const key = `${setId}/${seedIndex}`;
    const hit = runs.get(key);
    if (hit) return hit;
    const p = drop(
      (async () => {
        const index = await loadIndex();
        const file = index.sets.find((s) => s.id === setId)?.files[String(seedIndex)];
        if (file === undefined) throw new RecordingError("shape");
        const raw = await getJson(doFetch, `${base}/${file}`);
        if (!isObj(raw) || !isObj(raw.cols) || raw.weeks !== index.weeks) throw new RecordingError("shape");
        const cols: Record<string, (number | null)[]> = {};
        for (const [k, col] of Object.entries(raw.cols)) {
          if (!Array.isArray(col) || col.length !== index.weeks) throw new RecordingError("shape");
          cols[k] = col.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
        }
        return { set: setId, pm_index: seedIndex, weeks: index.weeks, cols };
      })(),
      () => runs.delete(key),
    );
    runs.set(key, p);
    return p;
  };
  const loadRegistry = (): Promise<Registry | null> =>
    (registryP ??= getJson(doFetch, `${base}/registry.json`)
      .then(parseRegistry)
      .catch((e: unknown) => {
        // yalnız kalıcı hata (yok/bozuk) önbelleğe alınır; ağ/sunucu hatasında sonraki çağrı yeniden dener
        if (e instanceof RecordingError && e.code === "network") registryP = null;
        return null;
      }));
  return { loadIndex, loadRun, loadRegistry };
}

/** Şehir başına kasa-hafta sütunları (`city_cash_weeks_c0`, `_c1`, ...): kayıt aracının model modu yazar; eski kayıtta yok. */
const SEHIR_KASA_SUTUN = /^city_cash_weeks_c(\d+)$/;

/** Sütunlu kaydı hafta paketlerine açar (olaylar boş; hafta 1..N). Eksik sütun `null`; şehir kasa-hafta sütunu yoksa pakette `cash_weeks` yok. */
export function toPackets(run: RecordedRun, runId: string): WeekPacket[] {
  const sehirler = Object.keys(run.cols)
    .map((k) => ({ k, m: SEHIR_KASA_SUTUN.exec(k) }))
    .flatMap(({ k, m }) => (m ? [{ k, i: Number(m[1]) }] : []))
    .sort((a, b) => a.i - b.i);
  return Array.from({ length: run.weeks }, (_, i) => {
    const world = Object.fromEntries(WORLD_KEYS.map((k) => [k, run.cols[k]?.[i] ?? null])) as World;
    return { v: 1, run_id: runId, week: i + 1, version: 1, world, events: [], ...(sehirler.length > 0 ? { cash_weeks: sehirler.map(({ k }) => run.cols[k]![i] ?? null) } : {}) };
  });
}
