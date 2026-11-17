import type { CopyKey } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { HARITA_DURUMLARI, type HaritaDurumu, type HaritaFarki, type HaritaFirmaSatiri, type HaritaVerisi } from "@/oyun/harita/tipler";
import { DAO_DURUMLAR, DAO_EKSIKLER, DAO_LONCA_KUR_YOLLARI, DAO_UNVANLAR, KASA_GUCLERI, type DaoGozlem, type DaoOlay } from "../dao";
import type {
  Availability, Capabilities, IsletmeCekmecesi, Holdings, ChainNode, ChainPacket, ChainScarce, ChainSector, ChangeResult, CityRow, ConsistencyRule, Diagnostic, DrawerData, DunyaDetay, DunyaOzet, DunyaSkorSatiri, GoalId, Job, JobKind, JobMember, JobSeriesKey, JobStatus, Registry, RegistryCard, RegistryControl, RunHandle, RunState, RunStatus, SettingAvail,
  KurumSatiri, EkonomiBlogu, MakroBlogu, EkonomiSehir, UcretBlogu, UcretSatiri, EksikUrun, HaneTuketim, Hareket, NpcHaneTuketim, TuketimSehir, SourceInfo, Speed, UIValue, ValuesPatch, WeekPacket, World, WorldEvent, WorldInfo, WorldPlan,
} from "../types";

/** Sunucudan gelen gövde beklenen biçimde değil. `path` hatalı alanın yolu (geliştirici bilgisi, arayüze girmez). */
export class WireError extends Error {
  readonly path: string;
  constructor(path: string, why: string) {
    super(`${path}: ${why}`);
    this.name = "WireError";
    this.path = path;
  }
}

export type LiveHello = { serverVersion: string; modelVersion: string; defaultsHash: string; secPerWeekP50: number | null };

const WORLD_KEYS = [
  "served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini",
  "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected",
  "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index",
  "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder",
  "reject_pool", "reject_reputation", "no_buyer_cum", "support_denied", "policy_unemployment", "city_spend_cut",
  "tenants_per_house", "house_resale_ratio", "policy_inflation", "minted_total",
] as const satisfies readonly (keyof World)[];
/** D5: eski sunucuda bulunmayabilen alanlar (DK-15 hoşgörü): alan yoksa pakette de yoktur, `null` = ölçülmedi; bozuk tür yine `WireError`. */
const WORLD_KEYS_OPT = [
  "npc_pool", "npc_employed", "npc_broke", "npc_pool_cash_avg", "players_seeking", "players_in_ahir", "players_students", "unemployment_rate_all",
  "benefit_paid", "benefit_paid_npc", "muni_wages", "bursary_paid", "benefit_cut",
  "players_total", "players_new", "players_new_total", "ahir_capacity", "ahir_fill", "npc_firm_npc", "npc_firm_players",
  "hired_player", "hired_npc", "fired_player", "fired_npc", "ahir_moves", "ahir_backfilled", "inflow_blocked",
  "staff_fill", "kinds_full", "house_stock", "opening_staff", "firms_total", "npc_dependents", "npc_lfp",
  "npc_discouraged", "muni_npc", "hires", "separations", "quits_npc", "job_finding_rate", "unemployment_duration",
  "money_households", "money_npc_firms", "money_player_firms", "money_city", "money_lonca", "money_other",
  "city_in_tax", "city_in_profit", "city_in_rent", "city_in_mint", "city_in_other",
  "city_out_households", "city_out_wages", "city_out_services", "city_out_firms", "city_out_other", "ghost_firms", "ghost_closed",
  "wealth_top10", "wealth_top1", "wealth_median", "income_gini", "income_top10", "liquid_b50", "liquid_m40", "liquid_t10",
  "founders_applied", "founders_rejected", "failed_player_cum", "failed_dao_cum", "failed_npc_default_cum", "failed_total_cum",
  "vacancies", "staffless_npc", "wage_fail", "unemp_long_share", "hires_stable4",
] as const satisfies readonly (keyof World)[];
// World'e eklenen her alan buraya da eklenmeli (aksi halde bu satır derlenmez).
const _worldComplete: Exclude<keyof World, (typeof WORLD_KEYS)[number] | (typeof WORLD_KEYS_OPT)[number]> extends never ? true : never = true;
void _worldComplete;

const STATUSES: readonly RunStatus[] = ["ready", "running", "paused", "ended", "failed"];
const KINDS: readonly WorldEvent["kind"][] = ["good", "warn", "bad", "neutral"];
const REASONS = ["no_recording", "locked", "busy", "ended", "invalid", "start_only", "passive"] as const;
const GOALS: readonly GoalId[] = ["alive", "serve", "kasa", "gini"];
const CARD_STATUSES = ["active", "passive", "experimental"] as const;
const CARD_KINDS = ["options", "toggle", "number", "fields", "order", "multi"] as const;
const APPLIES = ["live", "live_sync", "start_only", "passive", "unknown"] as const;
const SETTING_REASONS = ["locked", "no_recording", "start_only", "passive", "unverified"] as const;
const SETTING_LOCK_REASONS = ["no_cash_floor"] as const;
const BLOCK_REASONS = ["no_recording", "locked", "start_only", "unverified"] as const;
const CAPABILITY_KEYS = ["branch", "seeds", "compare", "library", "city", "chain", "jobs", "rebuild", "harita"] as const;
const MODES = ["exact", "nearest", "live"] as const;

type Obj = Record<string, unknown>;

function obj(x: unknown, path: string): Obj {
  if (typeof x !== "object" || x === null || Array.isArray(x)) throw new WireError(path, "expected_object");
  return x as Obj;
}
function arr(x: unknown, path: string): unknown[] {
  if (!Array.isArray(x)) throw new WireError(path, "expected_array");
  return x;
}
function str(x: unknown, path: string): string {
  if (typeof x !== "string") throw new WireError(path, "expected_string");
  return x;
}
function bool(x: unknown, path: string): boolean {
  if (typeof x !== "boolean") throw new WireError(path, "expected_boolean");
  return x;
}
function fin(x: unknown, path: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new WireError(path, "expected_finite_number");
  return x;
}
function int(x: unknown, path: string): number {
  const n = fin(x, path);
  if (!Number.isInteger(n)) throw new WireError(path, "expected_integer");
  return n;
}
function finOrNull(x: unknown, path: string): number | null {
  return x === null ? null : fin(x, path);
}
/** Bilinen kodlardan biri; tanınmayan DİZGE `bilinmiyor` olur (sunucu yeni kod ekleyebilir, paket düşmez). Dizge olmayan değer WireError. */
function oneOfOrUnknown<T extends string>(x: unknown, set: readonly T[], path: string): T | "bilinmiyor" {
  const s = str(x, path);
  return (set as readonly string[]).includes(s) ? (s as T) : "bilinmiyor";
}
function oneOf<T extends string>(x: unknown, set: readonly T[], path: string): T {
  const s = str(x, path);
  if (!(set as readonly string[]).includes(s)) throw new WireError(path, `unexpected_value:${s}`);
  return s as T;
}
/** `tr.ts`'te tanımlı bir anahtar mı (tolerans: bilinmeyen anahtarlı olay/tanı düşürülür). */
function isCopyKey(x: unknown): x is CopyKey {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(tr, x);
}
/** Bilinmeyen anahtar için yedek metin: sunucu yeni hata anahtarı ekleyince durum ayrıştırması düşmez. */
function knownCopyKey(x: unknown, fallback: CopyKey): CopyKey {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(tr, x) ? (x as CopyKey) : fallback;
}

function copyKey(x: unknown, path: string): CopyKey {
  const s = str(x, path);
  if (!Object.prototype.hasOwnProperty.call(tr, s)) throw new WireError(path, `unknown_copy_key:${s}`);
  return s as CopyKey;
}
function scalar(x: unknown, path: string): number | string | boolean {
  if (typeof x === "number") return fin(x, path);
  if (typeof x === "string" || typeof x === "boolean") return x;
  throw new WireError(path, "expected_ui_value");
}
function uiValue(x: unknown, path: string): UIValue {
  if (Array.isArray(x)) return strings(x, path);
  if (typeof x === "object" && x !== null) {
    const out: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(x as Obj)) out[k] = scalar(v, `${path}.${k}`);
    return out;
  }
  return scalar(x, path);
}
/** Alan yok ya da `null` ise `undefined`; aksi halde `f`. */
function opt<T>(x: unknown, f: (v: unknown) => T): T | undefined {
  return x === undefined || x === null ? undefined : f(x);
}
function values(x: unknown, path: string): ValuesPatch {
  const o = obj(x, path);
  const out: ValuesPatch = {};
  for (const [k, v] of Object.entries(o)) out[k] = uiValue(v, `${path}.${k}`);
  return out;
}
function strings(x: unknown, path: string): string[] {
  return arr(x, path).map((v, i) => str(v, `${path}[${i}]`));
}

export function parseState(x: unknown): RunState {
  const o = obj(x, "state");
  const speed = fin(o.speed, "state.speed");
  if (speed !== 1 && speed !== 4 && speed !== 16) throw new WireError("state.speed", "expected_speed");
  const state: RunState = {
    runId: str(o.runId, "state.runId"),
    status: oneOf(o.status, STATUSES, "state.status"),
    week: int(o.week, "state.week"),
    durationWeeks: int(o.durationWeeks, "state.durationWeeks"),
    speed: speed as Speed,
    computing: bool(o.computing, "state.computing"),
    version: int(o.version, "state.version"),
    seedIndex: int(o.seedIndex, "state.seedIndex"),
    values: values(o.values, "state.values"),
    scenarioId: str(o.scenarioId, "state.scenarioId"),
    name: str(o.name, "state.name"),
    cityNames: strings(o.cityNames, "state.cityNames"),
  };
  if (o.endedReason !== undefined && o.endedReason !== null) {
    if (o.endedReason !== "duration") throw new WireError("state.endedReason", "unexpected_value");
    state.endedReason = "duration";
  }
  if (o.error !== undefined && o.error !== null) {
    const e = obj(o.error, "state.error");
    state.error = { messageKey: knownCopyKey(str(e.messageKey, "state.error.messageKey"), "hata.model_coktu"), week: int(e.week, "state.error.week") };
  }
  if (o.buffering !== undefined && o.buffering !== null) state.buffering = bool(o.buffering, "state.buffering");
  if (o.modelWeeksPerSec !== undefined && o.modelWeeksPerSec !== null) state.modelWeeksPerSec = fin(o.modelWeeksPerSec, "state.modelWeeksPerSec");
  const preparing = opt(o.preparing, (v) => {
    const e = obj(v, "state.preparing");
    const done = int(e.done, "state.preparing.done");
    const total = int(e.total, "state.preparing.total");
    if (done < 0 || total < 0 || done > total) throw new WireError("state.preparing", "unexpected_value");
    return { done, total };
  });
  if (preparing) state.preparing = preparing;
  const world = opt(o.worldScenarioId, (v) => str(v, "state.worldScenarioId"));
  if (world !== undefined) state.worldScenarioId = world;
  const worldValues = opt(o.worldScenarioValues, (v) => values(v, "state.worldScenarioValues"));
  if (worldValues !== undefined) state.worldScenarioValues = worldValues;
  const goals = opt(o.goals, (v) => arr(v, "state.goals").map((g, i) => oneOf(g, GOALS, `state.goals[${i}]`)));
  if (goals) state.goals = goals;
  if (o.mode === "dao") state.mode = "dao";
  const dunyaKodu = opt(o.dunyaKodu, (v) => str(v, "state.dunyaKodu"));
  if (dunyaKodu !== undefined) state.dunyaKodu = dunyaKodu;
  // DAO: hafta 0 harita anlık görüntüsü (ilk paket gelmeden şehir çizilsin); bozuksa alan düşer, durum düşmez.
  if (o.harita0 !== undefined && o.harita0 !== null) {
    try { state.harita0 = parseHarita(o.harita0, "state.harita0"); } catch { /* bozuk alan yok sayılır */ }
  }
  const dao0 = parseDaoOrNull(o.dao0);                                  // DAO: hafta 0 gözlemi; bozuksa alan düşer, durum düşmez
  if (dao0 !== undefined) state.dao0 = dao0;
  const parent = opt(o.parentRunId, (v) => str(v, "state.parentRunId"));
  if (parent !== undefined) state.parentRunId = parent;
  const fork = opt(o.forkWeek, (v) => int(v, "state.forkWeek"));
  if (fork !== undefined) state.forkWeek = fork;
  const versions = opt(o.versions, (v) =>
    arr(v, "state.versions").map((x, i) => {
      const e = obj(x, `state.versions[${i}]`);
      const row: NonNullable<RunState["versions"]>[number] = {
        version: int(e.version, `state.versions[${i}].version`), fromWeek: int(e.fromWeek, `state.versions[${i}].fromWeek`),
        values: values(e.values, `state.versions[${i}].values`),
      };
      const note = opt(e.note, (n) => str(n, `state.versions[${i}].note`));
      return note === undefined ? row : { ...row, note };
    }));
  if (versions) state.versions = versions;
  const locks = opt(o.settingLocks, (v) =>
    arr(v, "state.settingLocks").flatMap((x, i) => {
      const e = obj(x, `state.settingLocks[${i}]`);
      const reason = str(e.reason, `state.settingLocks[${i}].reason`);
      // Tolerans (DK-15): bilinmeyen neden kilidi düşer; sunucu yine `start_only` ile reddeder.
      return (SETTING_LOCK_REASONS as readonly string[]).includes(reason) ? [{ id: str(e.id, `state.settingLocks[${i}].id`), reason: reason as (typeof SETTING_LOCK_REASONS)[number] }] : [];
    }));
  if (locks) state.settingLocks = locks;
  return state;
}

function paramsOf(x: unknown, path: string): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(obj(x, path))) {
    if (typeof v === "number") params[k] = fin(v, `${path}.${k}`);
    else if (typeof v === "string") params[k] = v;
    else throw new WireError(`${path}.${k}`, "expected_number_or_string");
  }
  return params;
}

/** Katı olay ayrıştırma: bilinmeyen `textKey` `WireError` verir. Tolerans gereken yerlerde `parseEventOrNull`. */
export function parseEvent(x: unknown, path = "event"): WorldEvent {
  const o = obj(x, path);
  const params = paramsOf(o.params, `${path}.params`);
  const sector = o.sector === null ? null : str(o.sector, `${path}.sector`);
  const changes = opt(o.changes, (v) =>
    arr(v, `${path}.changes`).map((c, i) => {
      const e = obj(c, `${path}.changes[${i}]`);
      return {
        id: str(e.id, `${path}.changes[${i}].id`),
        from: e.from === null ? null : uiValue(e.from, `${path}.changes[${i}].from`),
        to: uiValue(e.to, `${path}.changes[${i}].to`),
      };
    }));
  // Zincir adımı bilinmeyen `textKey` taşırsa yalnız o adım düşer.
  const chain = opt(o.chain, (v) =>
    arr(v, `${path}.chain`).flatMap((c, i) => {
      const e = obj(c, `${path}.chain[${i}]`);
      if (typeof e.textKey !== "string") throw new WireError(`${path}.chain[${i}].textKey`, "expected_string");
      if (!isCopyKey(e.textKey)) return [];
      return [{ step: str(e.step, `${path}.chain[${i}].step`), textKey: e.textKey, params: paramsOf(e.params, `${path}.chain[${i}].params`) }];
    }));
  const base: WorldEvent = {
    id: str(o.id, `${path}.id`),
    week: int(o.week, `${path}.week`),
    kind: oneOf(o.kind, KINDS, `${path}.kind`),
    textKey: copyKey(o.textKey, `${path}.textKey`),
    params,
    critical: bool(o.critical, `${path}.critical`),
    sector,
    rule_ids: strings(o.rule_ids, `${path}.rule_ids`),
  };
  return { ...base, ...(changes ? { changes } : {}), ...(chain ? { chain } : {}) };
}

/** Tolerans (DK-15): `textKey` bu istemcide tanımlı değilse `null` (olay düşürülür); öteki bozukluklar `WireError`. */
export function parseEventOrNull(x: unknown, path = "event"): WorldEvent | null {
  const o = obj(x, path);
  if (typeof o.textKey === "string" && !isCopyKey(o.textKey)) return null;
  return parseEvent(o, path);
}

/** Tolerans (DK-15): bilinmeyen `textKey`'li tanı `null`; bilinen alanın türü bozuksa `WireError`. */
export function parseDiagnostic(x: unknown, path = "diagnostic"): Diagnostic | null {
  const o = obj(x, path);
  if (typeof o.textKey === "string" && !(o.textKey.startsWith("neolmuyor.") && isCopyKey(o.textKey))) return null;
  return {
    id: str(o.id, `${path}.id`),
    textKey: copyKey(o.textKey, `${path}.textKey`),
    params: paramsOf(o.params, `${path}.params`),
    rule_ids: strings(o.rule_ids, `${path}.rule_ids`),
    since_week: int(o.since_week, `${path}.since_week`),
  };
}

/** S5 satırları: bozuk tür WireError; alan eksikse sayı alanları için hata, `?` olanlar için `null`. */
function rowFin(o: Obj, k: string, path: string): number { return fin(o[k], `${path}.${k}`); }
function rowFinNull(o: Obj, k: string, path: string): number | null { return finOrNull(o[k] === undefined ? null : o[k], `${path}.${k}`); }

export function parseCityRows(x: unknown, path = "packet.cities"): CityRow[] {
  return arr(x, path).map((r, i) => {
    const p = `${path}[${i}]`;
    const o = obj(r, p);
    return {
      index: int(o.index, `${p}.index`), served: rowFinNull(o, "served", p), employed: rowFin(o, "employed", p), unemployed: rowFin(o, "unemployed", p),
      cash: rowFinNull(o, "cash", p), firms_npc: rowFin(o, "firms_npc", p), firms_player: rowFin(o, "firms_player", p),
      rent_pct: rowFinNull(o, "rent_pct", p), occupancy: rowFinNull(o, "occupancy", p), tenants_per_house: rowFinNull(o, "tenants_per_house", p),
      migration_in: rowFin(o, "migration_in", p), migration_out: rowFin(o, "migration_out", p),
      ...(o.cash_weeks === undefined ? {} : { cash_weeks: rowFinNull(o, "cash_weeks", p) }),      // eski sunucuda alan yok (DK-15)
      ...(o.firms_total === undefined ? {} : { firms_total: rowFin(o, "firms_total", p) }),      // D8: eski sunucuda yok
      ...(o.npc_pool === undefined ? {} : { npc_pool: rowFin(o, "npc_pool", p) }),                  // D5: eski sunucuda yok
      ...(o.npc_broke === undefined ? {} : { npc_broke: rowFin(o, "npc_broke", p) }),
      ...(o.players_seeking === undefined ? {} : { players_seeking: rowFin(o, "players_seeking", p) }),
      ...(o.population === undefined ? {} : { population: rowFin(o, "population", p) }),               // eski sunucuda yok
      ...(o.players_in_ahir === undefined ? {} : { players_in_ahir: rowFin(o, "players_in_ahir", p) }),
    };
  });
}

/** Şehir kurumları (yardımcı blok; harita satırlarıyla aynı kalıp): bozuk satır atlanır, blok dizi değilse atlanır (`parsePacket` paketi düşürmez). Hacimler sonlu ve >= 0, pay 0-1 aralığında; boş ürün listesi geçerli (ithalat yok). */
export function parseKurumlar(x: unknown, path = "packet.kurumlar"): KurumSatiri[] {
  const oran = (v: unknown, p: string): number => {
    const n = fin(v, p);
    if (n < 0 || n > 1) throw new WireError(p, "expected_0_1");
    return n;
  };
  const hacim = (v: unknown, p: string): number => {
    const n = fin(v, p);
    if (n < 0) throw new WireError(p, "expected_nonneg");
    return n;
  };
  return arr(x, path).flatMap((r, i): KurumSatiri[] => {
   try {
    const p = `${path}[${i}]`;
    const o = obj(r, p);
    return [{
      sehir: int(o.sehir, `${p}.sehir`), ithalat_hacim: hacim(o.ithalat_hacim, `${p}.ithalat_hacim`), ihracat_hacim: hacim(o.ihracat_hacim, `${p}.ihracat_hacim`),
      ithalat_urunler: arr(o.ithalat_urunler, `${p}.ithalat_urunler`).map((u, j) => {
        const q = `${p}.ithalat_urunler[${j}]`;
        const e = obj(u, q);
        return { urun: str(e.urun, `${q}.urun`), pay: oran(e.pay, `${q}.pay`) };
      }),
    }];
   } catch {
    return [];
   }
  });
}

/** Çekmece türleri (sunucu `enums.drawerKinds`): `urun` ekonomi panosundaki ürün ayrıntısıdır. */
export const CEKMECE_TURLERI = ["city", "sector", "firm", "lonca", "urun"] as const;

/** Ekonomi bloğu (yardımcı blok; kurumlar kalıbı): blok nesne değilse `undefined`; sonlu olmayan ya da negatif sayı `null`; bozuk satır atlanır. Hiçbir sayı 0'a çevrilmez. */
export function parseEkonomi(x: unknown): EkonomiBlogu | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Obj;
  const rec = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
  const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const tamsayi = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  const dizi = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const hane = (v: unknown): HaneTuketim => {
    const h = rec(v) ?? {};
    return { n: sayi(h.n), karsilanma: sayi(h.karsilanma), sepet: sayi(h.sepet) };
  };
  const npcHane = (v: unknown): NpcHaneTuketim | null => {
    const h = rec(v);
    return h === null ? null : { ise: hane(h.ise), issiz: hane(h.issiz), dis: hane(h.dis) };
  };
  const hareket = (v: unknown): Hareket | null => {
    const h = rec(v);
    if (h === null) return null;
    const [kurulan, buyuyen, kuculen, batan] = [sayi(h.kurulan), sayi(h.buyuyen), sayi(h.kuculen), sayi(h.batan)];
    return kurulan === null || buyuyen === null || kuculen === null || batan === null ? null : { kurulan, buyuyen, kuculen, batan };
  };
  const t = rec(o.tuketim) ?? {};
  const th = rec(t.hane) ?? {};
  const tsehir: TuketimSehir[] = dizi(th.sehir).flatMap((r): TuketimSehir[] => {
    const e = rec(r);
    const sehir = e === null ? null : tamsayi(e.sehir);
    if (e === null || sehir === null) return [];
    const h = rec(e.harcama);
    return [{ sehir, ise: hane(e.ise), issiz: hane(e.issiz), npc: npcHane(e.npc), npc_issiz_parasiz: sayi(e.npc_issiz_parasiz),
      harcama: h === null ? null : { oyuncu: sayi(h.oyuncu), npc: sayi(h.npc) } }];
  });
  const hc = rec(t.harcama);
  /** Ücret satırı `[ücret endeksi, fiyat endeksi, net haftalık ücret, oran]`; yanlış uzunlukta ya da dizi olmayan satır tümüyle null. */
  const ucretSatiri = (v: unknown): UcretSatiri => {
    const a = Array.isArray(v) && v.length === 4 ? v.map(sayi) : [null, null, null, null];
    return { ucret: a[0]!, fiyat: a[1]!, net: a[2]!, oran: a[3]! };
  };
  const uc = rec(t.ucret);
  const ucret: UcretBlogu | null = uc === null ? null : { dunya: ucretSatiri(uc.dunya), sehir: dizi(uc.sehir).map(ucretSatiri) };
  const urunler: EksikUrun[] | null = Array.isArray(t.urunler)
    ? t.urunler.flatMap((r): EksikUrun[] => {
        const e = rec(r);
        if (e === null || typeof e.urun !== "string") return [];
        const [istek, karsilanmayan, uretim, stok] = [sayi(e.istek), sayi(e.karsilanmayan), sayi(e.uretim), sayi(e.stok)];
        return istek === null || karsilanmayan === null || uretim === null || stok === null ? [] : [{ urun: e.urun, istek, karsilanmayan, uretim, stok }];
      })
    : null;
  const i = rec(o.isletme) ?? {};
  const ist = rec(i.istihdam) ?? {};
  const sektor = dizi(i.sektor).flatMap((r) => {
    const e = rec(r);
    if (e === null || typeof e.tur !== "string") return [];
    const [calisan, firma] = [sayi(e.calisan), sayi(e.firma)];
    return calisan === null || firma === null ? [] : [{ tur: e.tur, calisan, firma }];
  });
  const sd = rec(i.sektor_diger);
  const sdc = sd === null ? null : sayi(sd.calisan);
  const sdf = sd === null ? null : sayi(sd.firma);
  const isehir: EkonomiSehir[] = dizi(i.sehir).flatMap((r): EkonomiSehir[] => {
    const e = rec(r);
    const sehir = e === null ? null : tamsayi(e.sehir);
    if (e === null || sehir === null) return [];
    const b = e.boy;
    if (!Array.isArray(b) || b.length !== 4) return [];
    const boy = b.map(sayi);
    if (boy.some((v) => v === null)) return [];
    return [{ sehir, ozel_calisan: sayi(e.ozel_calisan), kamu_calisan: sayi(e.kamu_calisan), calisan_oyuncu: sayi(e.calisan_oyuncu), calisan_npc: sayi(e.calisan_npc),
      isgucu_disi: sayi(e.isgucu_disi), boy: boy as [number, number, number, number], hareket: hareket(e.hareket) }];
  });
  const pr = rec(o.para);
  return {
    tuketim: {
      hane: { ise: hane(th.ise), issiz: hane(th.issiz), npc: npcHane(th.npc), npc_issiz_parasiz: sayi(th.npc_issiz_parasiz), sehir: tsehir },
      harcama: hc === null ? null : { npc: sayi(hc.npc), oyuncu: sayi(hc.oyuncu), toplam: sayi(hc.toplam) },
      urunler,
      ucret,
    },
    isletme: {
      istihdam: { oyuncu: sayi(ist.oyuncu), npc: sayi(ist.npc), ozel: sayi(ist.ozel), kamu: sayi(ist.kamu) },
      hareket: hareket(i.hareket), sektor,
      sektor_diger: sdc === null || sdf === null ? null : { calisan: sdc, firma: sdf },
      sehir: isehir,
    },
    para: pr === null ? null : { oyuncu_n: sayi(pr.oyuncu_n), oyuncu_ust10: sayi(pr.oyuncu_ust10), oyuncu_alt90: sayi(pr.oyuncu_alt90),
      npc_hane_nakit: sayi(pr.npc_hane_nakit), npc_hane_mevduat: sayi(pr.npc_hane_mevduat) },
  };
}

/** Makro bloğu (yardımcı blok): nesne değilse `undefined`; sonlu olmayan sayı `null` (negatif GEÇERLİDİR: enflasyon, büyüme, gerçek faiz, marj); eksik grup tümüyle `null` alanlı. Hiçbir sayı 0'a çevrilmez. */
export function parseMakro(x: unknown): MakroBlogu | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Obj;
  const rec = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
  const s = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const g = (v: unknown) => rec(v) ?? {};
  const f = g(o.fiyat), u = g(o.uretim), p = g(o.para), z = g(o.faiz), m = g(o.marj), d = g(o.dagilim), k = g(o.kredi);
  const kn = rec(o.konut);
  return {
    fiyat: { tuk: s(f.tuk), enf: s(f.enf), uretici: s(f.uretici), ucret: s(f.ucret), gercek_ucret: s(f.gercek_ucret) },
    uretim: { nominal: s(u.nominal), gercek: s(u.gercek), buyume: s(u.buyume), verimlilik: s(u.verimlilik) },
    para: { stok: s(p.stok), korunum: s(p.korunum), mali: s(p.mali), kredi_net: s(p.kredi_net), acilis: s(p.acilis), hiz: s(p.hiz) },
    faiz: { politika: s(z.politika), mevduat: s(z.mevduat), kredi: s(z.kredi), gercek: s(z.gercek) },
    marj: { npc: s(m.npc), oyuncu: s(m.oyuncu) },
    konut: kn === null ? null : { kira: s(kn.kira), kira_gelir: s(kn.kira_gelir) },
    dagilim: { gini_nakit: s(d.gini_nakit), gini_gelir: s(d.gini_gelir), gini_servet: s(d.gini_servet), yoksul: s(d.yoksul), medyan_sepet: s(d.medyan_sepet) },
    kredi: { stok: s(k.stok), buyume: s(k.buyume), temerrut: s(k.temerrut) },
  };
}

export function parseChain(x: unknown, path = "packet.chain"): ChainPacket {
  const o = obj(x, path);
  const sectors: ChainSector[] = arr(o.sectors, `${path}.sectors`).map((r, i) => {
    const p = `${path}.sectors[${i}]`;
    const e = obj(r, p);
    return {
      sector: str(e.sector, `${p}.sector`), product: e.product === null || e.product === undefined ? null : str(e.product, `${p}.product`),
      firms: rowFin(e, "firms", p), healthy: rowFinNull(e, "healthy", p), shortage: rowFinNull(e, "shortage", p), persist: rowFinNull(e, "persist", p),
      cover_days: rowFinNull(e, "cover_days", p), price_trend: rowFinNull(e, "price_trend", p), price: rowFinNull(e, "price", p),
    };
  });
  const nodes: ChainNode[] = arr(o.nodes, `${path}.nodes`).map((r, i) => {
    const p = `${path}.nodes[${i}]`;
    const e = obj(r, p);
    return {
      sector: str(e.sector, `${p}.sector`), city: int(e.city, `${p}.city`), shortage: rowFinNull(e, "shortage", p), price: rowFinNull(e, "price", p),
      firms: rowFin(e, "firms", p), healthy: rowFinNull(e, "healthy", p), demand: rowFinNull(e, "demand", p), output: rowFinNull(e, "output", p), stock: rowFinNull(e, "stock", p),
    };
  });
  const scarce: ChainScarce[] | null = o.scarce === null || o.scarce === undefined ? null : arr(o.scarce, `${path}.scarce`).map((r, i) => {
    const p = `${path}.scarce[${i}]`;
    const e = obj(r, p);
    return { sector: str(e.sector, `${p}.sector`), product: str(e.product, `${p}.product`), persist: rowFinNull(e, "persist", p), shortage: rowFinNull(e, "shortage", p), firms: rowFin(e, "firms", p), healthy: rowFinNull(e, "healthy", p) };
  });
  const edges = opt(o.edges, (v) => arr(v, `${path}.edges`).map((e, i): [string, string, string] => {
    const t = arr(e, `${path}.edges[${i}]`);
    if (t.length !== 3) throw new WireError(`${path}.edges[${i}]`, "expected_triple");
    return [str(t[0], `${path}.edges[${i}][0]`), str(t[1], `${path}.edges[${i}][1]`), str(t[2], `${path}.edges[${i}][2]`)];
  }));
  return { board: bool(o.board, `${path}.board`), edges_rev: int(o.edges_rev, `${path}.edges_rev`), ...(edges ? { edges } : {}), sectors, nodes, scarce };
}

export function parseWorldInfo(x: unknown): WorldInfo {
  const o = obj(x, "info.world");
  const cities = arr(o.cities, "info.world.cities").map((r, i) => {
    const p = `info.world.cities[${i}]`;
    const e = obj(r, p);
    return {
      index: int(e.index, `${p}.index`), coal: bool(e.coal, `${p}.coal`), gold: bool(e.gold, `${p}.gold`), population_share: fin(e.population_share, `${p}.population_share`),
      resources: arr(e.resources, `${p}.resources`).map((q, j) => { const r2 = obj(q, `${p}.resources[${j}]`); return { id: str(r2.id, `${p}.resources[${j}].id`), label: str(r2.label, `${p}.resources[${j}].label`) }; }),
      specialties: arr(e.specialties, `${p}.specialties`).map((q, j) => { const r2 = obj(q, `${p}.specialties[${j}]`); return { sector: str(r2.sector, `${p}.specialties[${j}].sector`), label: str(r2.label, `${p}.specialties[${j}].label`) }; }),
    };
  });
  const chain = opt(o.chain, (v) => {
    const c = obj(v, "info.world.chain");
    return {
      sectors: arr(c.sectors, "info.world.chain.sectors").map((r, i) => { const p = `info.world.chain.sectors[${i}]`; const e = obj(r, p); return { sector: str(e.sector, `${p}.sector`), label: str(e.label, `${p}.label`), product: e.product === null || e.product === undefined ? null : str(e.product, `${p}.product`) }; }),
      edges: arr(c.edges, "info.world.chain.edges").map((r, i) => { const p = `info.world.chain.edges[${i}]`; const e = obj(r, p); return { from: str(e.from, `${p}.from`), to: str(e.to, `${p}.to`), product: str(e.product, `${p}.product`) }; }),
    };
  });
  return { basis: str(o.basis, "info.world.basis"), cities, ...(chain ? { chain } : {}) };
}

export function parseDrawer(x: unknown): DrawerData {
  const o = obj(x, "drawer");
  const fields = obj(o.fields, "drawer.fields");
  // Sektör çekmecesinde not anahtarı `fields.note_key` içinde gelir (S5); üst düzey `note_key` de kabul edilir. Bilinmeyen anahtar notu düşürür.
  const raw = o.note_key ?? fields.note_key;
  const note = typeof raw === "string" && isCopyKey(raw) ? raw : undefined;
  return {
    kind: str(o.kind, "drawer.kind"), ref: str(o.ref, "drawer.ref"), week: int(o.week, "drawer.week"), stale: bool(o.stale, "drawer.stale"),
    title: str(o.title, "drawer.title"), fields, ...(note ? { note_key: note } : {}),
  };
}

/**
 * İşletme çekmecesinin işletme penceresi alanları (`fields` içinden). Tolerans: eksik/bozuk alan `null`, `profit_hist` yoksa boş dizi;
 * sayı olmayan geçmiş elemanı düşer ve en çok 12 eleman (son 12 hafta) tutulur.
 */
export function parseIsletmeCekmecesi(fields: Record<string, unknown>): IsletmeCekmecesi {
  const hist = Array.isArray(fields.profit_hist) ? fields.profit_hist.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).slice(-12) : [];
  return {
    product: typeof fields.product === "string" ? fields.product : null, price: numOrNull(fields.price), wage_avg: numOrNull(fields.wage_avg),
    sold_week: numOrNull(fields.sold_week), profit_hist: hist,
  };
}

const MONEY_KEYS = ["deposits_players", "deposits_insurance", "found_fund", "insurance_reserve", "lonca_cash_net", "credit_out", "fund_credit_out", "bonds_out", "lonca_equity"] as const;
const WEALTH_KEYS = ["b50", "m40", "t10", "t1", "median", "gini", "n"] as const;
const FIRMS_KEYS = ["player_count", "owners", "multi_owners", "cash_top10_share"] as const;
const LONCA_OWNERS = ["player", "none", "closed"] as const;

/** Sayı olmayan ya da eksik değer `null` (tolerans); nesne olmayan bölüm boş nesne sayılır. */
const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const objOrEmpty = (x: unknown): Obj => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : {});
function numbers<K extends string>(x: unknown, keys: readonly K[]): Record<K, number | null> {
  const o = objOrEmpty(x);
  return Object.fromEntries(keys.map((k) => [k, numOrNull(o[k])])) as Record<K, number | null>;
}

/**
 * Tolerans (DK-15): blok yoksa ya da nesne değilse `undefined`; içindeki sayı olmayan değer `null`; bozuk satır düşer.
 * Bilinmeyen grup anahtarları tutulur (arayüz yalnız bilinenleri okur); bilinmeyen lonca sahibi `null`, bilinmeyen bölüm yok sayılır. Kişi kimliği alanları hiç okunmaz (K1).
 */
export function parseHoldings(x: unknown): Holdings | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const o = x as Obj;
  const groups = objOrEmpty(o.groups);
  const player: Holdings["groups"]["player"] = {};
  for (const [k, v] of Object.entries(objOrEmpty(groups.player))) player[k] = numbers(v, ["n", "cash", "deposits"] as const);
  const npc: Holdings["groups"]["npc"] = {};
  for (const [k, v] of Object.entries(objOrEmpty(groups.npc))) {
    const t = Array.isArray(v) ? v : [];
    npc[k] = { n: numOrNull(t[0]), cash: numOrNull(t[1]) };
  }
  const byGroup: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(objOrEmpty(objOrEmpty(o.deposits).by_group))) byGroup[k] = numOrNull(v);
  const loncas: Holdings["loncas"] = [];
  if (Array.isArray(o.loncas)) {
    for (const r of o.loncas) {
      const e = objOrEmpty(r);
      if (typeof e.ref !== "string") continue;
      const owner = (LONCA_OWNERS as readonly unknown[]).includes(e.owner) ? (e.owner as (typeof LONCA_OWNERS)[number]) : null;
      loncas.push({ ref: e.ref, owner, ...numbers(e, ["members", "fee", "capital", "deposits", "credit_out", "equity"] as const) });
    }
  }
  let flows: Holdings["flows"] = null;
  if (Array.isArray(o.flows)) {
    flows = [];
    for (const r of o.flows) {
      if (!Array.isArray(r) || r.length !== 3 || typeof r[0] !== "string" || typeof r[1] !== "string") continue;
      const amount = numOrNull(r[2]);
      if (amount !== null) flows.push({ from: r[0], to: r[1], amount });
    }
  }
  return {
    money: numbers(o.money, MONEY_KEYS), groups: { player, npc }, deposits: { by_group: byGroup }, loncas,
    firms: numbers(o.firms, FIRMS_KEYS), wealth: numbers(o.wealth, WEALTH_KEYS), flows,
  };
}

const HARITA_SAHIPLERI = ["npc", "oyuncu", "dao"] as const;

/**
 * Paketin `harita` alanı. İki tel biçimi okunur ve ikisi de aynı TS nesnesine çevrilir:
 * - sıkıştırılmış (sunucu): `{hafta, alanlar, turler, loncalar, sahipler, firmalar}`; satır `[id|n, turIdx, sehir, calisan, loncaIdx|-1, sahipIdx, dogum|null, durum]`,
 *   `id` sayıysa kimlik `s<şehir>_<tür><n>` olarak kurulur;
 * - eski (kayıtlar): satır `[id, tur, sehir, calisan, lonca|null, sahip]` dizgeli.
 * Satır 6 (eski: `dogum: null`, `durum: "uretim"`) ya da 8 eleman (yeni) olabilir; başka uzunluk ya da bilinmeyen durum satırı atlanır.
 * Bozuk satır tüm paketi düşürmez, atlanır (harita ek bir görünümdür); alanın kendisi bozuksa hata.
 */
export function parseHarita(x: unknown, path = "packet.harita"): HaritaVerisi {
  const o = obj(x, path);
  const sikisik = Array.isArray(o.turler);
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : []);
  const turler = sikisik ? strs(o.turler) : [];
  const loncalar = sikisik ? strs(o.loncalar) : [];
  const sahipler = sikisik && Array.isArray(o.sahipler) ? strs(o.sahipler) : [...HARITA_SAHIPLERI];
  const firmalar: HaritaFirmaSatiri[] = [];
  for (const r of arr(o.firmalar, `${path}.firmalar`)) {
    if (!Array.isArray(r) || (r.length !== 6 && r.length !== 8)) continue;
    const [id0, tur0, sehir, calisan, lonca0, sahip0] = r as unknown[];
    // 8 elemanlı yeni biçim: doğum (tam sayı >= 0 | null) ve durum; 6 elemanlı eski biçim: null / uretim.
    const dogum: unknown = r.length === 8 ? r[6] : null;
    const durum: unknown = r.length === 8 ? r[7] : "uretim";
    if (dogum !== null && !(typeof dogum === "number" && Number.isInteger(dogum) && dogum >= 0)) continue;
    if (!(HARITA_DURUMLARI as readonly unknown[]).includes(durum)) continue;
    if (typeof sehir !== "number" || !Number.isInteger(sehir) || sehir < 0) continue;
    if (typeof calisan !== "number" || !Number.isFinite(calisan) || calisan < 0) continue;
    let id: unknown = id0; let tur: unknown = tur0; let lonca: unknown = lonca0; let sahip: unknown = sahip0;
    if (sikisik) {
      tur = typeof tur0 === "number" ? turler[tur0] : undefined;
      lonca = lonca0 === -1 ? null : typeof lonca0 === "number" ? loncalar[lonca0] : undefined;
      sahip = typeof sahip0 === "number" ? sahipler[sahip0] : undefined;
      if (typeof id0 === "number") {
        if (!Number.isSafeInteger(id0) || id0 < 0 || typeof tur !== "string") continue;
        id = `s${sehir}_${tur}${id0}`;
      }
    }
    if (typeof id !== "string" || typeof tur !== "string") continue;
    if (lonca !== null && typeof lonca !== "string") continue;
    if (!HARITA_SAHIPLERI.includes(sahip as (typeof HARITA_SAHIPLERI)[number])) continue;
    firmalar.push([id, tur, sehir, calisan, lonca as string | null, sahip as (typeof HARITA_SAHIPLERI)[number], dogum as number | null, durum as HaritaDurumu]);
  }
  return { hafta: int(o.hafta, `${path}.hafta`), firmalar };
}

/**
 * Paketin `haritaFark` alanı: `{hafta, taban, degisen: [id, durumIndeksi, calisan][], yeni: <dizgeli tam satır>[], kapanan: id[]}`.
 * `degisen`/`yeni`/`kapanan` bozuk satırı atlanır (harita ek bir görünümdür); alanın kendisi bozuksa (hafta/taban/diziler) hata.
 */
export function parseHaritaFark(x: unknown, path = "packet.haritaFark"): HaritaFarki {
  const o = obj(x, path);
  const kimlik = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null);
  const degisen: HaritaFarki["degisen"] = [];
  for (const r of arr(o.degisen, `${path}.degisen`)) {
    if (!Array.isArray(r) || r.length !== 3) continue;
    const id = kimlik(r[0]);
    const durum = typeof r[1] === "number" && Number.isInteger(r[1]) ? HARITA_DURUMLARI[r[1]] : undefined;
    const calisan = r[2];
    if (id === null || durum === undefined || typeof calisan !== "number" || !Number.isFinite(calisan) || calisan < 0) continue;
    degisen.push([id, durum, calisan]);
  }
  const kapanan = arr(o.kapanan, `${path}.kapanan`).flatMap((v) => { const id = kimlik(v); return id === null ? [] : [id]; });
  // `yeni`: tam satır, dizgeli (tablosuz) biçim; satır doğrulaması `parseHarita` ile ortak (bozuk satır atlanır).
  const yeni = parseHarita({ hafta: 0, firmalar: arr(o.yeni, `${path}.yeni`) }, `${path}.yeni`).firmalar;
  return { hafta: int(o.hafta, `${path}.hafta`), taban: int(o.taban, `${path}.taban`), degisen, yeni, kapanan };
}

export function parsePacket(x: unknown): WeekPacket {
  const o = obj(x, "packet");
  if (o.v !== 1) throw new WireError("packet.v", "expected_v1");
  const w = obj(o.world, "packet.world");
  const world = {} as Record<string, number | null>;
  for (const k of WORLD_KEYS) world[k] = finOrNull(w[k], `packet.world.${k}`);
  for (const k of WORLD_KEYS_OPT) if (w[k] !== undefined) world[k] = finOrNull(w[k], `packet.world.${k}`);
  const cities = opt(o.cities, (v) => parseCityRows(v));
  const chain = opt(o.chain, (v) => parseChain(v));
  const kurumlar = opt(o.kurumlar, (v) => {
    try {
      return parseKurumlar(v);
    } catch {
      return undefined;
    }
  });
  const ekonomi = parseEkonomi(o.ekonomi);
  const makro = parseMakro(o.makro);
  const holdings = parseHoldings(o.holdings);
  const harita = opt(o.harita, (v) => parseHarita(v));
  const haritaFark = opt(o.haritaFark, (v) => parseHaritaFark(v));
  const dao = parseDaoOrNull(o.dao);
  const diagnostics = opt(o.diagnostics, (v) =>
    arr(v, "packet.diagnostics").flatMap((d, i) => {
      const dg = parseDiagnostic(d, `packet.diagnostics[${i}]`);
      return dg ? [dg] : [];
    }));
  return {
    v: 1,
    run_id: str(o.run_id, "packet.run_id"),
    week: int(o.week, "packet.week"),
    version: int(o.version, "packet.version"),
    world: world as World,
    events: arr(o.events, "packet.events").flatMap((e, i) => {
      const ev = parseEventOrNull(e, `packet.events[${i}]`);
      return ev ? [ev] : [];
    }),
    ...(diagnostics ? { diagnostics } : {}),
    ...(cities ? { cities } : {}),
    ...(chain ? { chain } : {}),
    ...(kurumlar ? { kurumlar } : {}),
    ...(ekonomi ? { ekonomi } : {}),
    ...(makro ? { makro } : {}),
    ...(holdings ? { holdings } : {}),
    ...(harita ? { harita } : {}),
    ...(haritaFark ? { haritaFark } : {}),
    ...(dao ? { dao } : {}),
  };
}

export function parsePackets(x: unknown): WeekPacket[] {
  return arr(x, "weeks").map((p) => parsePacket(p));
}

export function parseHandle(x: unknown): RunHandle {
  const o = obj(x, "handle");
  return { runId: str(o.runId, "handle.runId"), state: parseState(o.state) };
}

/** `GET /api/runs` yanıtı: etkin koşuların listesi. */
export function parseHandles(x: unknown): RunHandle[] {
  return arr(x, "runs").map((h) => parseHandle(h));
}

export function parseHello(x: unknown): LiveHello {
  const o = obj(x, "hello");
  if (o.ok !== true || o.live !== true) throw new WireError("hello", "not_live");
  return {
    serverVersion: str(o.server_version, "hello.server_version"),
    modelVersion: str(o.model_version, "hello.model_version"),
    defaultsHash: str(o.defaults_hash, "hello.defaults_hash"),
    secPerWeekP50: o.sec_per_week_p50 === undefined ? null : finOrNull(o.sec_per_week_p50, "hello.sec_per_week_p50"),
  };
}

function reasonOf(x: unknown, path: string): (typeof REASONS)[number] {
  return oneOf(x, REASONS, path);
}

const nums = (x: unknown, path: string): number[] => arr(x, path).map((v, i) => fin(v, `${path}[${i}]`));

/** D8: `POST /api/world/plan` yanıtı (D7 sözleşmesi); eksik ya da bozuk alan `WireError`. */
export function parseWorldPlan(x: unknown): WorldPlan {
  const o = obj(x, "plan");
  const pop = obj(o.population, "plan.population");
  const firms = obj(o.firms, "plan.firms");
  const open = obj(o.openingStaff, "plan.openingStaff");
  const scale = obj(o.scale, "plan.scale");
  const h = o.housing === null || o.housing === undefined ? null : obj(o.housing, "plan.housing");
  return {
    population: {
      playersPerCity: fin(pop.playersPerCity, "plan.population.playersPerCity"), cities: int(pop.cities, "plan.population.cities"),
      players: fin(pop.players, "plan.population.players"), npc: fin(pop.npc, "plan.population.npc"), total: fin(pop.total, "plan.population.total"),
    },
    firms: { total: fin(firms.total, "plan.firms.total"), perCity: nums(firms.perCity, "plan.firms.perCity"), per1000: fin(firms.per1000, "plan.firms.per1000") },
    openingStaff: { total: fin(open.total, "plan.openingStaff.total"), perCity: nums(open.perCity, "plan.openingStaff.perCity"), npcRate: fin(open.npcRate, "plan.openingStaff.npcRate") },
    kinds: arr(o.kinds, "plan.kinds").map((r, i) => {
      const p = `plan.kinds[${i}]`;
      const k = obj(r, p);
      return {
        kind: str(k.kind, `${p}.kind`), label: str(k.label, `${p}.label`), group: oneOf(k.group, PLAN_GROUPS, `${p}.group`),
        firms: fin(k.firms, `${p}.firms`), capacity: fin(k.capacity, `${p}.capacity`), maxPeople: fin(k.maxPeople, `${p}.maxPeople`), target: fin(k.target, `${p}.target`),
        planned: fin(k.planned, `${p}.planned`), blocked: bool(k.blocked, `${p}.blocked`), shortfall: fin(k.shortfall, `${p}.shortfall`), growthCeiling: fin(k.growthCeiling, `${p}.growthCeiling`),
      };
    }),
    blockedKinds: arr(o.blockedKinds, "plan.blockedKinds").map((v, i) => str(v, `plan.blockedKinds[${i}]`)),
    housing: h === null ? null : { stock: nums(h.stock, "plan.housing.stock"), total: fin(h.total, "plan.housing.total"), tenants: nums(h.tenants, "plan.housing.tenants") },
    scale: { employment: fin(scale.employment, "plan.scale.employment"), population: fin(scale.population, "plan.scale.population") },
    capMode: oneOf(o.capMode, ["sabit", "otomatik", "elle"] as const, "plan.capMode"),
    capGrowth: oneOf(o.capGrowth, ["sabit_taban", "acilis_kapasitesi", "yok"] as const, "plan.capGrowth"),
    ...(o.laborForce === undefined ? {} : { laborForce: parseLaborForce(o.laborForce) }),               // D9: eski sunucuda yok
  };
}

function parseLaborForce(x: unknown): NonNullable<WorldPlan["laborForce"]> {
  const l = obj(x, "plan.laborForce");
  return {
    mode: oneOf(l.mode, ["tek_kisi", "hane"] as const, "plan.laborForce.mode"), players: fin(l.players, "plan.laborForce.players"), npc: fin(l.npc, "plan.laborForce.npc"),
    dependents: fin(l.dependents, "plan.laborForce.dependents"), participation: fin(l.participation, "plan.laborForce.participation"), total: fin(l.total, "plan.laborForce.total"),
  };
}
const PLAN_GROUPS = ["hammadde", "imalat", "hizmet", "lojistik"] as const;

export function parseAvailability(x: unknown): Availability {
  const o = obj(x, "availability");
  return {
    ok: bool(o.ok, "availability.ok"),
    scenarioId: o.scenarioId === null || o.scenarioId === undefined ? null : str(o.scenarioId, "availability.scenarioId"),
    blocked: arr(o.blocked, "availability.blocked").map((b, i) => {
      const e = obj(b, `availability.blocked[${i}]`);
      const known = typeof e.reason === "string" && (BLOCK_REASONS as readonly string[]).includes(e.reason);
      const reason = known ? oneOf(e.reason, BLOCK_REASONS, `availability.blocked[${i}].reason`) : "locked"; // bilinmeyen neden güvenli tarafa: kilitli
      return { settingId: str(e.settingId, `availability.blocked[${i}].settingId`), option: str(e.option, `availability.blocked[${i}].option`), reason };
    }),
  };
}

export function parseInfo(x: unknown): SourceInfo {
  const o = obj(x, "info");
  const kind = oneOf(o.kind, ["replay", "live"] as const, "info.kind");
  const settings: SettingAvail[] = arr(o.settings, "info.settings").map((s, i) => {
    const e = obj(s, `info.settings[${i}]`);
    const changeable = opt(e.changeable, (v) => bool(v, `info.settings[${i}].changeable`));
    const sr = opt(e.reason, (v) => (typeof v === "string" && (SETTING_REASONS as readonly string[]).includes(v) ? (v as (typeof SETTING_REASONS)[number]) : "locked"));
    return {
      id: str(e.id, `info.settings[${i}].id`),
      ...(changeable === undefined ? {} : { changeable }),
      ...(sr === undefined ? {} : { reason: sr }),
      options: arr(e.options, `info.settings[${i}].options`).map((op, j) => {
        const p = obj(op, `info.settings[${i}].options[${j}]`);
        const base = { value: str(p.value, `info.settings[${i}].options[${j}].value`), available: bool(p.available, `info.settings[${i}].options[${j}].available`) };
        if (p.reason === undefined || p.reason === null) return base;
        const r = str(p.reason, `info.settings[${i}].options[${j}].reason`);
        return { ...base, reason: r === "no_recording" ? ("no_recording" as const) : ("locked" as const) }; // bilinmeyen neden güvenli tarafa: kilitli
      }),
    };
  });
  const registry = opt(o.registry, parseRegistry);
  const durations = opt(o.durations, (v) => arr(v, "info.durations").map((d, i) => int(d, `info.durations[${i}]`)));
  const capabilities = o.capabilities === undefined || o.capabilities === null ? undefined : parseCapabilities(o.capabilities);
  const world = opt(o.world, parseWorldInfo);
  return {
    ...(world ? { world } : {}),
    ...(registry ? { registry } : {}),
    ...(durations ? { durations } : {}),
    ...(capabilities ? { capabilities } : {}),
    kind,
    ...(typeof o.dunyalarKalici === "boolean" ? { dunyalarKalici: o.dunyalarKalici } : {}),
    modelNote: str(o.modelNote, "info.modelNote"),
    seeds: arr(o.seeds, "info.seeds").map((s, i) => {
      const e = obj(s, `info.seeds[${i}]`);
      return { index: int(e.index, `info.seeds[${i}].index`) };
    }),
    durationWeeks: int(o.durationWeeks, "info.durationWeeks"),
    settings,
    // Kayıt büyür (DK-15): metin anahtarı bilinmeyen kural, sunucunun `valueText`'i varsa onunla kalır, yoksa düşer; ekran hataya düşmez.
    fixedRules: arr(o.fixedRules, "info.fixedRules").flatMap((r, i) => {
      const e = obj(r, `info.fixedRules[${i}]`);
      const settingId = str(e.settingId, `info.fixedRules[${i}].settingId`);
      const key = str(e.valueKey, `info.fixedRules[${i}].valueKey`);
      const text = e.valueText === undefined || e.valueText === null ? undefined : str(e.valueText, `info.fixedRules[${i}].valueText`);
      if (Object.prototype.hasOwnProperty.call(tr, key)) return [text === undefined ? { settingId, valueKey: key as CopyKey } : { settingId, valueKey: key as CopyKey, valueText: text }];
      return text === undefined ? [] : [{ settingId, valueKey: "lock.sabit" as CopyKey, valueText: text }];
    }),
    templates: arr(o.templates, "info.templates").map((t, i) => {
      const e = obj(t, `info.templates[${i}]`);
      return { id: str(e.id, `info.templates[${i}].id`), values: values(e.values, `info.templates[${i}].values`) };
    }),
  };
}

/** `ChangeResult` gövdesi ya da `{error:{fields}}` hata gövdesi (reddedilmiş sayılır). */
export function parseChange(x: unknown): ChangeResult {
  const o = obj(x, "change");
  if (o.accepted === true) {
    return {
      accepted: true,
      runId: str(o.runId, "change.runId"),
      mode: oneOf(o.mode, MODES, "change.mode"),
      scenarioId: str(o.scenarioId, "change.scenarioId"),
      seamWeek: int(o.seamWeek, "change.seamWeek"),
      version: int(o.version, "change.version"),
    };
  }
  if (o.accepted === false) return { accepted: false, fields: fieldsOf(o.fields, "change.fields") };
  if (o.error !== undefined) return { accepted: false, fields: fieldsOf(obj(o.error, "change.error").fields, "change.error.fields") };
  throw new WireError("change", "no_accepted_flag");
}

function fieldsOf(x: unknown, path: string): { id: string; reason: (typeof REASONS)[number] }[] {
  return arr(x ?? [], path).map((f, i) => {
    const e = obj(f, `${path}[${i}]`);
    const known = typeof e.reason === "string" && (REASONS as readonly string[]).includes(e.reason);
    return { id: str(e.id, `${path}[${i}].id`), reason: known ? reasonOf(e.reason, `${path}[${i}].reason`) : "invalid" };
  });
}

/** Eksik ya da bozuk yetenek alanı `false` sayılır (yeni sunucu özellikleri eski istemciyi açmaz). */
export function parseCapabilities(x: unknown): Capabilities {
  const o = typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : {};
  const out = {} as Record<(typeof CAPABILITY_KEYS)[number], boolean>;
  for (const k of CAPABILITY_KEYS) out[k] = o[k] === true;
  return out;
}

function control(x: unknown, path: string): RegistryControl {
  const o = obj(x, path);
  switch (o.type) {
    case "options":
      return {
        type: "options",
        options: arr(o.options, `${path}.options`).map((op, i) => {
          const e = obj(op, `${path}.options[${i}]`);
          return { value: scalar(e.value, `${path}.options[${i}].value`), label: str(e.label, `${path}.options[${i}].label`) };
        }),
      };
    case "number":
      return {
        type: "number", min: fin(o.min, `${path}.min`), max: fin(o.max, `${path}.max`), step: fin(o.step, `${path}.step`),
        unit: o.unit === undefined || o.unit === null ? null : str(o.unit, `${path}.unit`),
        integer: o.integer === undefined || o.integer === null ? false : bool(o.integer, `${path}.integer`),
      };
    case "fields":
      return {
        type: "fields",
        fields: arr(o.fields, `${path}.fields`).map((f, i) => {
          const e = obj(f, `${path}.fields[${i}]`);
          const hint = opt(e.hint, (h) => str(h, `${path}.fields[${i}].hint`));
          return {
            key: str(e.key, `${path}.fields[${i}].key`), label: str(e.label, `${path}.fields[${i}].label`),
            ...(hint === undefined ? {} : { hint }), control: control(e.control, `${path}.fields[${i}].control`),
          };
        }),
      };
    case "order":
    case "multi":
      return {
        type: o.type,
        items: arr(o.items, `${path}.items`).map((it, i) => {
          const e = obj(it, `${path}.items[${i}]`);
          return { value: str(e.value, `${path}.items[${i}].value`), label: str(e.label, `${path}.items[${i}].label`) };
        }),
      };
    default:
      throw new WireError(`${path}.type`, "unexpected_control_type");
  }
}

function card(x: unknown, path: string): RegistryCard {
  const o = obj(x, path);
  const applyRaw = o.apply;
  const apply = typeof applyRaw === "string" && (APPLIES as readonly string[]).includes(applyRaw) ? (applyRaw as RegistryCard["apply"]) : "unknown";
  const s = (k: string): string | null => opt(o[k], (v) => str(v, `${path}.${k}`)) ?? null;
  const hint = opt(o.hint, (v) => str(v, `${path}.hint`));
  const warning = opt(o.warning, (v) => str(v, `${path}.warning`));
  const basis = opt(o.basis, (v) => {
    const b = obj(v, `${path}.basis`);
    const note = opt(b.note, (n) => str(n, `${path}.basis.note`));
    return { label: str(b.label, `${path}.basis.label`), ...(note === undefined ? {} : { note }) };
  });
  const aliases = opt(o.aliases, (v) => strings(v, `${path}.aliases`));
  const shows = opt(o.shows, (v) =>
    arr(v, `${path}.shows`).map((row, i) => {
      const r = obj(row, `${path}.shows[${i}]`);
      const label = opt(r.label, (l) => str(l, `${path}.shows[${i}].label`));
      const value = r.value;
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") throw new WireError(`${path}.shows[${i}].value`, "expected_scalar");
      return { ...(label === undefined ? {} : { label }), value, text: str(r.text, `${path}.shows[${i}].text`) };
    }),
  );
  const measuredValues = opt(o.measured_values, (v) => arr(v, `${path}.measured_values`).map((m, i) => uiValue(m, `${path}.measured_values[${i}]`)));
  const effectiveWhen = opt(o.effective_when, (v) => values(v, `${path}.effective_when`));
  const measuredWith = opt(o.measured_with, (v) => values(v, `${path}.measured_with`));
  return {
    id: str(o.id, `${path}.id`),
    layer: str(o.layer, `${path}.layer`),
    group: str(o.group, `${path}.group`),
    actor: s("actor"),
    level: str(o.level, `${path}.level`),
    editable: bool(o.editable, `${path}.editable`),
    status: oneOf(o.status, CARD_STATUSES, `${path}.status`),
    kind: oneOf(o.kind, CARD_KINDS, `${path}.kind`),
    params: strings(o.params, `${path}.params`),
    requires: strings(o.requires ?? [], `${path}.requires`),
    title: str(o.title, `${path}.title`),
    what: str(o.what, `${path}.what`),
    changes: str(o.changes, `${path}.changes`),
    ...(hint === undefined ? {} : { hint }),
    ...(basis === undefined ? {} : { basis }),
    ...(warning === undefined ? {} : { warning }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(shows === undefined ? {} : { shows }),
    control: control(o.control, `${path}.control`),
    default: uiValue(o.default, `${path}.default`),
    apply,
    measured_values: measuredValues ?? null,
    measured_with: measuredWith ?? null,
    measured_weeks: opt(o.measured_weeks, (v) => int(v, `${path}.measured_weeks`)) ?? null,
    hint_source: s("hint_source"),
    credit_type: s("credit_type"),
    scenario_editable: o.scenario_editable === undefined || o.scenario_editable === null ? false : bool(o.scenario_editable, `${path}.scenario_editable`),
    source_world_field: s("source_world_field"),
    ...(o.new_measurement === true ? { new_measurement: true } : {}),
    ...(effectiveWhen === undefined ? {} : { effective_when: effectiveWhen }),
  };
}

/** Yayımlanan kayıt (`GET /api/registry` ya da `info.registry`); bilinmeyen alanlar yok sayılır. */
export function parseRegistry(x: unknown): Registry {
  const o = obj(x, "registry");
  const list = <T>(k: string, f: (e: Obj, p: string) => T): T[] => arr(o[k], `registry.${k}`).map((v, i) => f(obj(v, `registry.${k}[${i}]`), `registry.${k}[${i}]`));
  const text = (e: Obj, k: string, p: string): string | undefined => opt(e[k], (v) => str(v, `${p}.${k}`));
  const named = (e: Obj, p: string) => {
    const what = text(e, "what", p);
    return { id: str(e.id, `${p}.id`), title: str(e.title, `${p}.title`), ...(what === undefined ? {} : { what }), values: values(e.values, `${p}.values`) };
  };
  return {
    cards: arr(o.cards, "registry.cards").map((c, i) => card(c, `registry.cards[${i}]`)),
    groups: list("groups", (e, p) => {
      const hint = text(e, "hint", p);
      return { id: str(e.id, `${p}.id`), order: int(e.order, `${p}.order`), title: str(e.title, `${p}.title`), ...(hint === undefined ? {} : { hint }) };
    }),
    templates: list("templates", (e, p) => {
      const base = named(e, p);
      const startable = opt(e.startable, (v) => {
        if (typeof v !== "boolean") throw new WireError(`${p}.startable`, "expected_boolean");
        return v;
      });
      const strs = (k: string) => opt(e[k], (v) => arr(v, `${p}.${k}`).map((s, i) => str(s, `${p}.${k}[${i}]`)));
      const blocked = strs("blocked_by");
      const behavior = strs("behavior_changes");
      const world = opt(e.world_values, (v) => values(v, `${p}.world_values`));
      return {
        ...base,
        ...(startable === undefined ? {} : { startable }),
        ...(blocked === undefined ? {} : { blocked_by: blocked }),
        ...(behavior === undefined ? {} : { behavior_changes: behavior }),
        ...(world === undefined ? {} : { world_values: world }),
      };
    }),
    scenarios: list("scenarios", (e, p) => {
      const base = named(e, p);
      const startable = opt(e.startable, (v) => bool(v, `${p}.startable`));
      const measured = opt(e.measured, (v) => bool(v, `${p}.measured`));
      const blocked = opt(e.blocked_by, (v) => arr(v, `${p}.blocked_by`).map((b, i) => str(b, `${p}.blocked_by[${i}]`)));
      return {
        ...base,
        ...(startable === undefined ? {} : { startable }),
        ...(measured === undefined ? {} : { measured }),
        ...(blocked === undefined ? {} : { blocked_by: blocked }),
      };
    }),
    ...(o.consistency === undefined || o.consistency === null ? {} : {
      consistency: arr(o.consistency, "registry.consistency").map((v, i): ConsistencyRule => {
        const p = `registry.consistency[${i}]`;
        const e = obj(v, p);
        const when = opt(e.when, (w) => values(w, `${p}.when`));
        const artan = opt(e.artan, (a) => {
          const ao = obj(a, `${p}.artan`);
          return { kart: str(ao.kart, `${p}.artan.kart`), alanlar: arr(ao.alanlar, `${p}.artan.alanlar`).map((s, j) => str(s, `${p}.artan.alanlar[${j}]`)) };
        });
        if (when === undefined && artan === undefined) throw new WireError(p, "rule_without_condition");
        return { id: str(e.id, `${p}.id`), text: str(e.text, `${p}.text`), ...(when === undefined ? {} : { when }), ...(artan === undefined ? {} : { artan }) };
      }),
    }),
    units: o.units === undefined || o.units === null ? {} : Object.fromEntries(Object.entries(obj(o.units, "registry.units")).map(([k, v]) => [k, str(v, `registry.units.${k}`)])),
  };
}

export function parseEnded(x: unknown): { reason: "duration"; week: number } {
  const o = obj(x, "ended");
  if (o.reason !== "duration") throw new WireError("ended.reason", "unexpected_value");
  return { reason: "duration", week: int(o.week, "ended.week") };
}

/** Sunucu `error` olayı: bilinen bir `hata.*` anahtarı (`message_key`/`messageKey`) taşıyorsa o, yoksa model çöktü. */
export function parseServerError(x: unknown): CopyKey {
  if (typeof x === "object" && x !== null) {
    const o = x as Obj;
    const k = o.messageKey ?? o.message_key;
    if (typeof k === "string" && k.startsWith("hata.") && Object.prototype.hasOwnProperty.call(tr, k)) return k as CopyKey;
  }
  return "hata.model_coktu";
}

/** Her istekte gönderilen başlıklar (sunucu `X-Oyun-Istek` ister; JSON ile birlikte ön uçuşu zorlar). */
export const REQUEST_HEADERS: Record<string, string> = { "X-Oyun-Istek": "1", Accept: "application/json" };

/** `baseUrl` (köken ya da boş: aynı köken) + `/api` + yol. */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api${path}`;
}

const JOB_KINDS: readonly JobKind[] = ["seeds", "ab", "preview"];
const JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "done", "failed", "cancelled"];
const SERIES_KEYS = ["served", "failed_cum", "city_cash_total", "gini", "unemployment_rate"] as const;
const SERIES_KEYS_YENI = ["failed_total_cum", "unemployment_rate_all"] as const;      // eski sunucuda yok: alan yoksa seri de yok

/** `POST /api/jobs` yanıtı: `{jobId}`. */
export function parseJobId(x: unknown): string {
  return str(obj(x, "job_start").jobId, "job_start.jobId");
}

/** `GET`/`DELETE /api/jobs/{id}` yanıtı (S3 sözleşmesi). */
export function parseJob(x: unknown): Job {
  const o = obj(x, "job");
  const members = arr(o.members, "job.members").map((m, i): JobMember => {
    const p = `job.members[${i}]`;
    const e = obj(m, p);
    const s = obj(e.series, `${p}.series`);
    const series = {} as JobMember["series"];
    for (const k of SERIES_KEYS) series[k] = arr(s[k], `${p}.series.${k}`).map((v, j) => finOrNull(v, `${p}.series.${k}[${j}]`));
    for (const k of SERIES_KEYS_YENI) if (s[k] !== undefined) series[k] = arr(s[k], `${p}.series.${k}`).map((v, j) => finOrNull(v, `${p}.series.${k}[${j}]`));
    const error = opt(e.error, (v) => str(v, `${p}.error`));
    return { label: str(e.label, `${p}.label`), status: oneOf(e.status, JOB_STATUSES, `${p}.status`), seedIndex: int(e.seedIndex, `${p}.seedIndex`), weeks: int(e.weeks, `${p}.weeks`), series, ...(error === undefined ? {} : { error }) };
  });
  const pr = obj(o.progress, "job.progress");
  return {
    jobId: str(o.jobId, "job.jobId"), kind: oneOf(o.kind, JOB_KINDS, "job.kind"), status: oneOf(o.status, JOB_STATUSES, "job.status"),
    progress: { done: int(pr.done, "job.progress.done"), total: int(pr.total, "job.progress.total") }, members,
  };
}

// --- DAO oyunu (tek oyunculu) ---

function daoOlay(x: unknown, path: string): DaoOlay {
  const o = obj(x, path);
  switch (o.tur) {
    case "kuruldu": return { tur: "kuruldu", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), sektor: str(o.sektor, `${path}.sektor`) };
    case "kurulamadi": return { tur: "kurulamadi", hafta: int(o.hafta, `${path}.hafta`), sektor: str(o.sektor, `${path}.sektor`), neden: oneOf(o.neden, ["sart", "kredi", "bekleme"] as const, `${path}.neden`) };
    case "ayrildi": return { tur: "ayrildi", hafta: int(o.hafta, `${path}.hafta`) };
    case "isten_cikarildi": return { tur: "isten_cikarildi", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), neden: typeof o.neden === "string" ? o.neden : null };
    case "firma_batti": return { tur: "firma_batti", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), ...(typeof o.neden === "string" ? { neden: o.neden } : {}), ...(Number.isSafeInteger(o.yas) ? { yas: o.yas as number } : {}) };
    case "is_degistirdi": return { tur: "is_degistirdi", hafta: int(o.hafta, `${path}.hafta`), eski: str(o.eski, `${path}.eski`), yeni: str(o.yeni, `${path}.yeni`) };
    case "ise_girdi":
    case "basvuru_kabul": return { tur: o.tur, hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`) };
    case "basvuru_red": return { tur: "basvuru_red", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), neden: str(o.neden, `${path}.neden`) };
    case "goc_etti": return { tur: "goc_etti", hafta: int(o.hafta, `${path}.hafta`), sehir: int(o.sehir, `${path}.sehir`) };
    case "lonca_kapali": return { tur: "lonca_kapali", hafta: int(o.hafta, `${path}.hafta`), lonca: str(o.lonca, `${path}.lonca`) };
    case "mevduat_yatirilmadi": return { tur: "mevduat_yatirilmadi", hafta: int(o.hafta, `${path}.hafta`) };
    case "cekildi": return { tur: "cekildi", hafta: int(o.hafta, `${path}.hafta`), miktar: fin(o.miktar, `${path}.miktar`) };
    case "cekilemedi": return { tur: "cekilemedi", hafta: int(o.hafta, `${path}.hafta`) };
    case "sermaye_eklendi": return { tur: "sermaye_eklendi", hafta: int(o.hafta, `${path}.hafta`), miktar: fin(o.miktar, `${path}.miktar`), firma: str(o.firma, `${path}.firma`) };
    case "sermaye_eklenemedi": return { tur: "sermaye_eklenemedi", hafta: int(o.hafta, `${path}.hafta`), ...(typeof o.neden === "string" ? { neden: o.neden } : {}) };
    case "lonca_kuruldu": return { tur: "lonca_kuruldu", hafta: int(o.hafta, `${path}.hafta`), lonca: str(o.lonca, `${path}.lonca`) };
    case "lonca_kurulamadi": return { tur: "lonca_kurulamadi", hafta: int(o.hafta, `${path}.hafta`), yol: str(o.yol, `${path}.yol`), neden: arr(o.neden, `${path}.neden`).map((v, i) => str(v, `${path}.neden[${i}]`)) };
    case "loncam_kapandi": return { tur: "loncam_kapandi", hafta: int(o.hafta, `${path}.hafta`), lonca: str(o.lonca, `${path}.lonca`), neden: str(o.neden, `${path}.neden`), kayip: fin(o.kayip, `${path}.kayip`),
      ...(o.mevduat_tasindi === undefined ? {} : { mevduat_tasindi: opt(o.mevduat_tasindi, (v) => { const m = obj(v, `${path}.mevduat_tasindi`); return { lonca: str(m.lonca, `${path}.mevduat_tasindi.lonca`), tutar: fin(m.tutar, `${path}.mevduat_tasindi.tutar`) }; }) ?? null }),
      ...(o.mevduat_odendi === undefined ? {} : { mevduat_odendi: fin(o.mevduat_odendi, `${path}.mevduat_odendi`) }) };
    case "lonca_degisti": return { tur: "lonca_degisti", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), eski: str(o.eski, `${path}.eski`), lonca: str(o.lonca, `${path}.lonca`), ...(typeof o.kaynak === "string" ? { kaynak: o.kaynak } : {}) };
    case "lonca_kapandi_yeniden_atandi": return { tur: o.tur, hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), eski: str(o.eski, `${path}.eski`), lonca: str(o.lonca, `${path}.lonca`) };
    case "firmam_kuculdu": return { tur: "firmam_kuculdu", hafta: int(o.hafta, `${path}.hafta`), firma: str(o.firma, `${path}.firma`), neden: typeof o.neden === "string" ? o.neden : "" };
    case "kurabilir_oldu": return { tur: "kurabilir_oldu", hafta: int(o.hafta, `${path}.hafta`) };
    case "ahirdan_cikti": return { tur: "ahirdan_cikti", hafta: int(o.hafta, `${path}.hafta`) };
    case "karar_uygulanamadi": return { tur: "karar_uygulanamadi", hafta: int(o.hafta, `${path}.hafta`), karar: str(o.karar, `${path}.karar`), neden: typeof o.neden === "string" ? o.neden : null };
    // Bu istemcinin tanımadığı olay türü sessizce düşmez: genel metinle görünür (hafta eksik/bozuksa 0).
    default: return { tur: "genel", hafta: Number.isSafeInteger(o.hafta) ? (o.hafta as number) : 0, kaynak: typeof o.tur === "string" ? o.tur : "" };
  }
}

const strOrNull = (x: unknown, path: string): string | null => (x === null || x === undefined ? null : str(x, path));

/** `GET /runs/{id}/dao` gövdesi ve paketin `dao` alanı: oyuncunun gözlemi. Bilinmeyen olay türü `genel` olayı olur (düşmez); bozuk alan `WireError`. */
export function parseDaoGozlem(x: unknown): DaoGozlem {
  const o = obj(x, "dao");
  const b = obj(o.ben, "dao.ben");
  const mev = obj(b.mevduat, "dao.ben.mevduat");
  const is = obj(b.is, "dao.ben.is");
  const slice = int(b.servet_dilimi, "dao.ben.servet_dilimi");
  if (slice < 1 || slice > 5) throw new WireError("dao.ben.servet_dilimi", "unexpected_value");
  const k = obj(o.kurabilir, "dao.kurabilir");
  const sehir = obj(o.sehir, "dao.sehir");
  const tercih = obj(o.tercih, "dao.tercih");
  const gecmis = obj(o.gecmis, "dao.gecmis");
  return {
    hafta: int(o.hafta, "dao.hafta"),
    ben: {
      sehir: int(b.sehir, "dao.ben.sehir"),
      nakit: fin(b.nakit, "dao.ben.nakit"),
      mevduat: { lonca: strOrNull(mev.lonca, "dao.ben.mevduat.lonca"), tutar: fin(mev.tutar, "dao.ben.mevduat.tutar") },
      is: { firma: strOrNull(is.firma, "dao.ben.is.firma"), sektor: strOrNull(is.sektor, "dao.ben.is.sektor"), ucret: fin(is.ucret, "dao.ben.is.ucret") },
      durum: oneOfOrUnknown(b.durum, DAO_DURUMLAR, "dao.ben.durum"),
      calisilan_hafta: int(b.calisilan_hafta, "dao.ben.calisilan_hafta"),
      ...(typeof b.tecrube_hafta === "number" && Number.isFinite(b.tecrube_hafta) && b.tecrube_hafta >= 0 ? { tecrube_hafta: b.tecrube_hafta } : {}),
      ...(b.terfi_esik === undefined || b.terfi_esik === null ? {} : (() => {
        const te = obj(b.terfi_esik, "dao.ben.terfi_esik");
        const tk = obj(te.kalfa, "dao.ben.terfi_esik.kalfa");
        const tu = obj(te.usta, "dao.ben.terfi_esik.usta");
        return { terfi_esik: {
          kalfa: { hafta: fin(tk.hafta, "dao.ben.terfi_esik.kalfa.hafta"), itibar: fin(tk.itibar, "dao.ben.terfi_esik.kalfa.itibar") },
          usta: { hafta: fin(tu.hafta, "dao.ben.terfi_esik.usta.hafta"), itibar: fin(tu.itibar, "dao.ben.terfi_esik.usta.itibar") },
        } };
      })()),
      itibar: fin(b.itibar, "dao.ben.itibar"),
      servet_dilimi: slice,
      unvan: oneOfOrUnknown(b.unvan, DAO_UNVANLAR, "dao.ben.unvan"),
      ...(b.loncam === undefined ? {} : { loncam: opt(b.loncam, (v) => {
        const l = obj(v, "dao.ben.loncam");
        return { ad: str(l.ad, "dao.ben.loncam.ad"), sermaye: fin(l.sermaye, "dao.ben.loncam.sermaye"), ...(l.odenen_sermaye === undefined ? {} : { odenen_sermaye: fin(l.odenen_sermaye, "dao.ben.loncam.odenen_sermaye") }), uye_sayisi: int(l.uye_sayisi, "dao.ben.loncam.uye_sayisi"), kasa: fin(l.kasa, "dao.ben.loncam.kasa"), durum: str(l.durum, "dao.ben.loncam.durum") };
      }) ?? null }),
    },
    firmam: opt(o.firmam, (v) => {
      const f = obj(v, "dao.firmam");
      return { ad: str(f.ad, "dao.firmam.ad"), sektor: str(f.sektor, "dao.firmam.sektor"), nakit: fin(f.nakit, "dao.firmam.nakit"), isci: int(f.isci, "dao.firmam.isci"), kar: fin(f.kar, "dao.firmam.kar"), yas: int(f.yas, "dao.firmam.yas"),
        kasa_degisim: finOrNull(f.kasa_degisim ?? null, "dao.firmam.kasa_degisim"), kasa_hafta: finOrNull(f.kasa_hafta ?? null, "dao.firmam.kasa_hafta"),
        ...(typeof f.lonca === "string" ? { lonca: f.lonca } : {}), ...(typeof f.lonca_degisebilir === "boolean" ? { lonca_degisebilir: f.lonca_degisebilir } : {}), ...(f.lonca_erken_hafta === undefined ? {} : { lonca_erken_hafta: finOrNull(f.lonca_erken_hafta, "dao.firmam.lonca_erken_hafta") }),
        ...(Array.isArray(f.uyari) ? { uyari: f.uyari.filter((x): x is string => typeof x === "string") } : {}),
        ...(f.kasa_pisti_hafta === undefined ? {} : { kasa_pisti_hafta: finOrNull(f.kasa_pisti_hafta, "dao.firmam.kasa_pisti_hafta") }) };      // F4: uyarı kodları (tanınmayan kod ekranda genel uyarı olur)
    }) ?? null,
    kurabilir: {
      evet: bool(k.evet, "dao.kurabilir.evet"),
      eksikler: arr(k.eksikler, "dao.kurabilir.eksikler").map((e, i) => oneOfOrUnknown(e, DAO_EKSIKLER, `dao.kurabilir.eksikler[${i}]`)),
      harc: fin(k.harc, "dao.kurabilir.harc"),
      gereken_hafta: int(k.gereken_hafta, "dao.kurabilir.gereken_hafta"),
      ...(k.bekleyen === undefined ? {} : { bekleyen: arr(k.bekleyen, "dao.kurabilir.bekleyen").map((e, i) => str(e, `dao.kurabilir.bekleyen[${i}]`)) }),
    },
    sektorler: arr(o.sektorler, "dao.sektorler").map((v, i) => {
      const s = obj(v, `dao.sektorler[${i}]`);
      return { sektor: str(s.sektor, `dao.sektorler[${i}].sektor`), urun: str(s.urun, `dao.sektorler[${i}].urun`), fiyat: fin(s.fiyat, `dao.sektorler[${i}].fiyat`), firma: int(s.firma, `dao.sektorler[${i}].firma`), eksik: fin(s.eksik, `dao.sektorler[${i}].eksik`), disaridan: finOrNull(s.disaridan ?? null, `dao.sektorler[${i}].disaridan`), ...(s.bekleme === undefined ? {} : { bekleme: int(s.bekleme, `dao.sektorler[${i}].bekleme`) }),
        ...(s.kasa_egilim === undefined ? {} : { kasa_egilim: finOrNull(s.kasa_egilim, `dao.sektorler[${i}].kasa_egilim`) }), ...(s.firma_sayisi_13hf === undefined ? {} : { firma_sayisi_13hf: s.firma_sayisi_13hf === null ? null : int(s.firma_sayisi_13hf, `dao.sektorler[${i}].firma_sayisi_13hf`) }) };
    }),
    loncalar: arr(o.loncalar, "dao.loncalar").map((v, i) => {
      const l = obj(v, `dao.loncalar[${i}]`);
      return { ad: str(l.ad, `dao.loncalar[${i}].ad`), mevduat_faizi: fin(l.mevduat_faizi, `dao.loncalar[${i}].mevduat_faizi`), kapali: bool(l.kapali, `dao.loncalar[${i}].kapali`), mevduat: fin(l.mevduat, `dao.loncalar[${i}].mevduat`),
        ...(l.pay_orani === undefined ? {} : { pay_orani: finOrNull(l.pay_orani, `dao.loncalar[${i}].pay_orani`) }), ...(typeof l.kredi_verebilir === "boolean" ? { kredi_verebilir: l.kredi_verebilir } : {}),
        ...(l.skor === undefined ? {} : { skor: finOrNull(l.skor, `dao.loncalar[${i}].skor`) }) };
    }),
    ...(o.lonca_kur === undefined || o.lonca_kur === null ? {} : (() => {
      const lk = obj(o.lonca_kur, "dao.lonca_kur");
      return { lonca_kur: Object.fromEntries(DAO_LONCA_KUR_YOLLARI.map((y) => [y, arr(lk[y], `dao.lonca_kur.${y}`).map((v, i) => str(v, `dao.lonca_kur.${y}[${i}]`))])) as NonNullable<DaoGozlem["lonca_kur"]> };
    })()),
    ...(o.lonca_kur_ayrinti === undefined || o.lonca_kur_ayrinti === null ? {} : (() => {
      const la = obj(o.lonca_kur_ayrinti, "dao.lonca_kur_ayrinti");
      return { lonca_kur_ayrinti: Object.fromEntries(DAO_LONCA_KUR_YOLLARI.map((y) => [y, arr(la[y], `dao.lonca_kur_ayrinti.${y}`).map((v, i) => {
        const e = obj(v, `dao.lonca_kur_ayrinti.${y}[${i}]`);
        return { id: str(e.id, `dao.lonca_kur_ayrinti.${y}[${i}].id`), ...(e.gerek === undefined ? {} : { gerek: fin(e.gerek, `dao.lonca_kur_ayrinti.${y}[${i}].gerek`) }), ...(e.var === undefined ? {} : { var: fin(e.var, `dao.lonca_kur_ayrinti.${y}[${i}].var`) }), ...(e.kalan === undefined ? {} : { kalan: fin(e.kalan, `dao.lonca_kur_ayrinti.${y}[${i}].kalan`) }) };
      })])) as NonNullable<DaoGozlem["lonca_kur_ayrinti"]> };
    })()),
    sehir: { talep_karsilama: finOrNull(sehir.talep_karsilama ?? null, "dao.sehir.talep_karsilama"), is_arayan: int(sehir.is_arayan, "dao.sehir.is_arayan") },
    tercih: {
      mevduat: opt(tercih.mevduat, (v) => {
        const m = obj(v, "dao.tercih.mevduat");
        return { lonca: strOrNull(m.lonca, "dao.tercih.mevduat.lonca"), oran: fin(m.oran, "dao.tercih.mevduat.oran") };
      }) ?? null,
    },
    gecmis: {
      dilim0: int(gecmis.dilim0, "dao.gecmis.dilim0"),
      firmalar: arr(gecmis.firmalar, "dao.gecmis.firmalar").map((v, i) => {
        const f = obj(v, `dao.gecmis.firmalar[${i}]`);
        return { ad: str(f.ad, `dao.gecmis.firmalar[${i}].ad`), sektor: str(f.sektor, `dao.gecmis.firmalar[${i}].sektor`), yas: int(f.yas, `dao.gecmis.firmalar[${i}].yas`), ayakta: bool(f.ayakta, `dao.gecmis.firmalar[${i}].ayakta`), ...(typeof f.neden === "string" ? { neden: f.neden } : {}), ...(Number.isSafeInteger(f.olum_haftasi) ? { olum_haftasi: f.olum_haftasi as number } : {}),
          ...(typeof f.neden_ayrinti === "string" ? { neden_ayrinti: f.neden_ayrinti } : {}), ...(typeof f.yakin_neden === "string" ? { yakin_neden: f.yakin_neden } : {}), ...(typeof f.kok_neden === "string" ? { kok_neden: f.kok_neden } : {}),      // F4: yaşam kaydı ölüm kodu ve son 8 hafta
          ...(typeof f.son8_kasa_farki === "number" && Number.isFinite(f.son8_kasa_farki) ? { son8_kasa_farki: f.son8_kasa_farki } : {}), ...(typeof f.son8_ciro === "number" && Number.isFinite(f.son8_ciro) ? { son8_ciro: f.son8_ciro } : {}), ...(typeof f.son8_ucret === "number" && Number.isFinite(f.son8_ucret) ? { son8_ucret: f.son8_ucret } : {}) };
      }),
    },
    ilanlar: o.ilanlar === undefined || o.ilanlar === null ? [] : arr(o.ilanlar, "dao.ilanlar").map((v, i) => {
      const l = obj(v, `dao.ilanlar[${i}]`);
      return { firma: str(l.firma, `dao.ilanlar[${i}].firma`), ad: str(l.ad, `dao.ilanlar[${i}].ad`), sektor: str(l.sektor, `dao.ilanlar[${i}].sektor`), acik: int(l.acik, `dao.ilanlar[${i}].acik`), ucret: fin(l.ucret, `dao.ilanlar[${i}].ucret`), maas_odeyemedi: l.maas_odeyemedi === undefined || l.maas_odeyemedi === null ? false : bool(l.maas_odeyemedi, `dao.ilanlar[${i}].maas_odeyemedi`), kasa_gucu: l.kasa_gucu === undefined || l.kasa_gucu === null ? "bilinmiyor" : oneOfOrUnknown(l.kasa_gucu, KASA_GUCLERI, `dao.ilanlar[${i}].kasa_gucu`) };
    }),
    olaylar: arr(o.olaylar, "dao.olaylar").map((e, i) => daoOlay(e, `dao.olaylar[${i}]`)),
  };
}

/** Paketin `dao` alanı: bozuksa alan düşer, hafta paketi düşmez (DAO paneli gerekirse `GET /dao` ile yeniler). */
function parseDaoOrNull(x: unknown): DaoGozlem | undefined {
  if (x === undefined || x === null) return undefined;
  try {
    return parseDaoGozlem(x);
  } catch (e) {
    if (e instanceof WireError) return undefined;
    throw e;
  }
}

/** `GET /runs/{id}/dao` yanıtı: gözlem; bitmiş koşuda sunucu son gözlemi `daoSonuc` altında da verebilir (ikisi de kabul edilir). */
export function parseDaoYaniti(x: unknown): DaoGozlem {
  const o = obj(x, "dao");
  return parseDaoGozlem(o.daoSonuc !== undefined && o.daoSonuc !== null && o.ben === undefined ? o.daoSonuc : x);
}

export function parseDunyaOzetler(x: unknown): DunyaOzet[] {
  return arr(x, "dunyalar").map((d, i) => {
    const e = obj(d, `dunyalar[${i}]`);
    return { kod: str(e.kod, "kod"), ad: str(e.ad, "ad"), aciklama: str(e.aciklama, "aciklama"), oynanma: int(e.oynanma, "oynanma"), olusturma: fin(e.olusturma, "olusturma"), baglanti: str(e.baglanti, "baglanti") };
  });
}

export function parseDunyaDetay(x: unknown): DunyaDetay {
  const e = obj(x, "dunya");
  return {
    kod: str(e.kod, "dunya.kod"), ad: str(e.ad, "dunya.ad"), aciklama: str(e.aciklama, "dunya.aciklama"), tarif: obj(e.tarif, "dunya.tarif"),
    modelSurumu: str(e.modelSurumu, "dunya.modelSurumu"), guncelSurum: str(e.guncelSurum, "dunya.guncelSurum"), oynanma: int(e.oynanma, "dunya.oynanma"),
  };
}

export function parseDunyaSkor(x: unknown): DunyaSkorSatiri[] {
  return arr(x, "skor").map((d, i) => {
    const e = obj(d, `skor[${i}]`);
    return { ad: e.ad === null || e.ad === undefined ? null : str(e.ad, "skor.ad"), dilim: int(e.dilim, "skor.dilim"), unvan: str(e.unvan, "skor.unvan"), isletme: int(e.isletme, "skor.isletme"), servet: fin(e.servet, "skor.servet") };
  });
}

export function parseDunyaYayin(x: unknown): { kod: string; baglanti: string } {
  const e = obj(x, "yayin");
  return { kod: str(e.kod, "yayin.kod"), baglanti: str(e.baglanti, "yayin.baglanti") };
}
