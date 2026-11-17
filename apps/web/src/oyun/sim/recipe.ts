import type { GoalId, RunConfig, UIValue, ValuesPatch } from "./types";

/**
 * Şartı paylaş: koşunun tarifi (DK-11: başlangıç değerleri + sürüm takvimi) tek satırlık koda çevrilir.
 * Kod: `DAO1-` + base64url(JSON) + `.` + sağlama (8 onaltılı hane). Ad ve şehir adları kişiseldir, koda girmez.
 */
export const RECIPE_PREFIX = "DAO1-";
export const RECIPE_MAX_BYTES = 8192;
export const RECIPE_VERSION = 1;

/** Koddan çıkan tarif: Kurucu'ya aktarılabilecek her şey, ad ve şehir adları hariç. */
export type SharedRecipe = {
  v: 1;
  templateId: string;
  durationWeeks: number;
  seedIndex: number;
  values: ValuesPatch;
  worldScenarioId?: string;
  /** Özel dünya senaryosunun değerleri (V kartları); yoksa senaryo kimliği tek başına yeter. */
  worldScenarioValues?: ValuesPatch;
  goals?: GoalId[];
  schedule?: { week: number; patch: ValuesPatch }[];
};

export type EncodeResult = { ok: true; code: string } | { ok: false; reason: "size" };
export type DecodeResult = { ok: true; recipe: SharedRecipe } | { ok: false; reason: "prefix" | "size" | "format" | "checksum" | "json" | "version" | "shape" };

const GOALS: readonly string[] = ["alive", "serve", "kasa", "gini"];
const KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const TEMPLATE = /^[A-Za-z0-9_.-]{1,64}$/;
const B64URL = /^[A-Za-z0-9_-]*$/;
const CHECK = /^[0-9a-f]{8}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_VALUES = 400;
const MAX_SCHEDULE = 500;
const MAX_WEEKS = 1000;
const MAX_SEED = 99;

/** FNV-1a 32 bit, 8 onaltılı hane: kazara bozulmayı yakalar (güvenlik amacı yok). */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function toB64Url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(b64: string): string | null {
  if (!B64URL.test(b64) || b64.length % 4 === 1) return null;
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Yükü (JSON metni) koda sarar; sınama için dışa açık. */
export function sealPayload(json: string): string {
  return `${RECIPE_PREFIX}${toB64Url(json)}.${checksum(json)}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function isScalar(x: unknown): x is number | string | boolean {
  return typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x));
}

function isUIValue(x: unknown): x is UIValue {
  if (isScalar(x)) return true;
  if (Array.isArray(x)) return x.every((e) => typeof e === "string");
  return isObj(x) && Object.entries(x).every(([k, v]) => KEY.test(k) && !FORBIDDEN_KEYS.has(k) && isScalar(v));
}

function isPatch(x: unknown): x is ValuesPatch {
  if (!isObj(x)) return false;
  const e = Object.entries(x);
  return e.length <= MAX_VALUES && e.every(([k, v]) => KEY.test(k) && !FORBIDDEN_KEYS.has(k) && isUIValue(v));
}

const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;

const byKey = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Anahtar sırası kararlı olsun: aynı tarif her zaman aynı kodu versin. */
function sortedPatch(p: ValuesPatch): ValuesPatch {
  return Object.fromEntries(Object.entries(byKey(p)).map(([k, v]) => [k, isObj(v) ? byKey(v as Record<string, number | string | boolean>) : v]));
}

/** Tarifi koda çevirir. Üst sınırı (8 KB) aşan tarif `size` ile reddedilir. */
export function encodeRecipe(config: RunConfig): EncodeResult {
  const body: SharedRecipe = {
    v: RECIPE_VERSION, templateId: config.templateId, durationWeeks: config.durationWeeks, seedIndex: config.seedIndex, values: sortedPatch(config.values),
    ...(config.worldScenarioId !== undefined ? { worldScenarioId: config.worldScenarioId } : {}),
    ...(config.worldScenarioValues !== undefined ? { worldScenarioValues: sortedPatch(config.worldScenarioValues) } : {}),
    ...(config.goals !== undefined ? { goals: [...config.goals] } : {}),
    ...(config.schedule !== undefined && config.schedule.length > 0 ? { schedule: config.schedule.map((s) => ({ week: s.week, patch: sortedPatch(s.patch) })) } : {}),
  };
  const code = sealPayload(JSON.stringify(body));
  return code.length > RECIPE_MAX_BYTES ? { ok: false, reason: "size" } : { ok: true, code };
}

/** Kodu doğrulayıp çözer; her hata bir neden kodu verir (metin arayüzde). Güvenilmeyen girdi: yalnız bilinen alanlar alınır. */
export function decodeRecipe(input: string): DecodeResult {
  const code = input.trim();
  if (!code.startsWith(RECIPE_PREFIX)) return { ok: false, reason: "prefix" };
  if (code.length > RECIPE_MAX_BYTES) return { ok: false, reason: "size" };
  const dot = code.lastIndexOf(".");
  if (dot < RECIPE_PREFIX.length) return { ok: false, reason: "format" };
  const check = code.slice(dot + 1);
  const json = fromB64Url(code.slice(RECIPE_PREFIX.length, dot));
  if (json === null || !CHECK.test(check)) return { ok: false, reason: "format" };
  if (checksum(json) !== check) return { ok: false, reason: "checksum" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "json" };
  }
  if (!isObj(raw)) return { ok: false, reason: "shape" };
  if (raw.v !== RECIPE_VERSION) return { ok: false, reason: raw.v === undefined ? "shape" : "version" };
  const { templateId, durationWeeks, seedIndex, values, worldScenarioId, worldScenarioValues, goals, schedule } = raw;
  if (typeof templateId !== "string" || !TEMPLATE.test(templateId) || !isInt(durationWeeks, 1, MAX_WEEKS) || !isInt(seedIndex, 0, MAX_SEED) || !isPatch(values)) return { ok: false, reason: "shape" };
  if (worldScenarioId !== undefined && (typeof worldScenarioId !== "string" || !TEMPLATE.test(worldScenarioId))) return { ok: false, reason: "shape" };
  if (worldScenarioValues !== undefined && !isPatch(worldScenarioValues)) return { ok: false, reason: "shape" };
  if (goals !== undefined && !(Array.isArray(goals) && goals.length <= GOALS.length && goals.every((g) => typeof g === "string" && GOALS.includes(g)))) return { ok: false, reason: "shape" };
  let plan: SharedRecipe["schedule"];
  if (schedule !== undefined) {
    if (!Array.isArray(schedule) || schedule.length > MAX_SCHEDULE) return { ok: false, reason: "shape" };
    const out: { week: number; patch: ValuesPatch }[] = [];
    for (const s of schedule) {
      if (!isObj(s) || !isInt(s.week, 1, MAX_WEEKS) || !isPatch(s.patch) || Object.keys(s.patch).length === 0) return { ok: false, reason: "shape" };
      out.push({ week: s.week, patch: s.patch });
    }
    plan = out;
  }
  return {
    ok: true,
    recipe: {
      v: RECIPE_VERSION, templateId, durationWeeks, seedIndex, values,
      ...(worldScenarioId !== undefined ? { worldScenarioId } : {}),
      ...(worldScenarioValues !== undefined ? { worldScenarioValues } : {}),
      ...(goals !== undefined ? { goals: goals as GoalId[] } : {}),
      ...(plan !== undefined ? { schedule: plan } : {}),
    },
  };
}

/** Çözülen tarifi koşu yapılandırmasına çevirir (ad ve şehir adlarını çağıran verir). */
export function recipeToConfig(r: SharedRecipe, name: string, cityNames: string[]): RunConfig {
  return {
    name, cityNames, templateId: r.templateId, durationWeeks: r.durationWeeks, seedIndex: r.seedIndex, values: r.values,
    ...(r.worldScenarioId !== undefined ? { worldScenarioId: r.worldScenarioId } : {}),
    ...(r.worldScenarioValues !== undefined ? { worldScenarioValues: r.worldScenarioValues } : {}),
    ...(r.goals !== undefined ? { goals: r.goals } : {}),
    ...(r.schedule !== undefined ? { schedule: r.schedule } : {}),
  };
}
