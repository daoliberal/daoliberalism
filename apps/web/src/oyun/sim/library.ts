import { MAX_AD_UZUNLUK } from "@/oyun/lib/sinirlar";
import { decodeRecipe, sealPayload, type SharedRecipe } from "./recipe";

/** Koşu kütüphanesi (W11): tarif + ad, tarayıcıda `localStorage`; sunucuya yazılmaz. Tarif doğrulaması recipe.ts'dedir (tek kaynak). */
export const LIBRARY_KEY = "oyun.kosular.v1";
export const LIBRARY_SCHEMA = 1;
/** İçe aktarılacak metnin üst sınırı (karakter): kütüphane elle yapıştırılan metinle şişirilemez. */
export const IMPORT_MAX_CHARS = 1_000_000;

export type SavedRun = {
  /** Kayıt kaynağında koşu kimliği (tarif kimliği), canlıda sunucu koşu kimliği; sunucu yeniden başlarsa eski kimlik kalır, tarif yeniden kurar. */
  id: string;
  name: string;
  recipe: SharedRecipe;
  parentId?: string;
  forkWeek?: number;
  savedAt: string;
  source: "live" | "replay";
  /** Kaydedildiği andaki hafta: "Aç" koşuyu bu haftaya kadar hızlı kurar. Eski kayıtlarda yoktur. */
  week?: number;
  /** Koşunun şehir adları (tarif ad taşımaz): yeniden kurmada geri verilir. Eski kayıtlarda yoktur. */
  cityNames?: string[];
};

/** Her alan hatası bir alan adı ve neden kodu taşır; metin arayüzdedir (`kosular.ice.*`). `index` 1 tabanlıdır. */
export type ImportError =
  | { reason: "json" }
  | { reason: "shape" }
  | { reason: "size" }
  | { reason: "field" | "recipe" | "long"; index: number; field: string };
export type ImportResult = { ok: true; runs: SavedRun[] } | { ok: false; errors: ImportError[] };

const ID = /^[A-Za-z0-9_.~%-]{1,300}$/;
/** Sunucunun koşu adı sınırı (`MAX_NAME_LEN`): daha uzun ad sunucuda reddedilir, bu yüzden kütüphane de kabul etmez. */
export const KOSU_AD_UZUNLUK = MAX_AD_UZUNLUK;
const MAX_CITIES = 5;
const SOURCES: readonly string[] = ["live", "replay"];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Tek girdiyi doğrular: ilk bozuk alanın adı döner. Tarif recipe.ts doğrulamasından geçer (8 KB sınırı, sürüm, anahtar denetimi). */
export function parseEntry(raw: unknown, izinUzunAd = false): { ok: true; run: SavedRun } | { ok: false; field: string; reason: "field" | "recipe" | "long" } {
  if (!isObj(raw)) return { ok: false, field: "id", reason: "field" };
  const { id, name, recipe, savedAt, source, parentId, forkWeek, week, cityNames } = raw;
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, field: "id", reason: "field" };
  if (typeof name !== "string" || name.trim() === "") return { ok: false, field: "name", reason: "field" };
  if (!izinUzunAd && name.length > KOSU_AD_UZUNLUK) return { ok: false, field: "name", reason: "long" };
  if (recipe === undefined || recipe === null || typeof recipe !== "object") return { ok: false, field: "recipe", reason: "field" };
  const dec = decodeRecipe(sealPayload(JSON.stringify(recipe)));
  if (!dec.ok) return { ok: false, field: "recipe", reason: "recipe" };
  if (typeof savedAt !== "string" || savedAt.length > 40 || !Number.isFinite(Date.parse(savedAt))) return { ok: false, field: "savedAt", reason: "field" };
  if (typeof source !== "string" || !SOURCES.includes(source)) return { ok: false, field: "source", reason: "field" };
  if (parentId !== undefined && (typeof parentId !== "string" || !ID.test(parentId))) return { ok: false, field: "parentId", reason: "field" };
  if (forkWeek !== undefined && !(typeof forkWeek === "number" && Number.isInteger(forkWeek) && forkWeek >= 0 && forkWeek <= 1000)) return { ok: false, field: "forkWeek", reason: "field" };
  if (week !== undefined && !(typeof week === "number" && Number.isInteger(week) && week >= 0 && week <= 1000)) return { ok: false, field: "week", reason: "field" };
  if (cityNames !== undefined && !(Array.isArray(cityNames) && cityNames.length <= MAX_CITIES && cityNames.every((c) => typeof c === "string" && c.length <= KOSU_AD_UZUNLUK))) return { ok: false, field: "cityNames", reason: "field" };
  return {
    ok: true,
    run: {
      id, name, recipe: dec.recipe, savedAt, source: source as SavedRun["source"],
      ...(week !== undefined ? { week } : {}), ...(cityNames !== undefined ? { cityNames: cityNames as string[] } : {}),
      ...(parentId !== undefined ? { parentId } : {}), ...(forkWeek !== undefined ? { forkWeek } : {}),
    },
  };
}

/** Depolama erişilemezken (özel pencere, kota) otomatik kaydedilen koşular yalnız bu sayfa açıkken burada kalır. */
let bellek: SavedRun[] = [];
/** Son yazma sorunu: `depolama` (yazılamadı), `buyuk` (bir koşunun tarifi 8 KB'ı aştı, o koşu yazılmadı); `null` = sorun yok. Koşular ekranı nötr bilgi gösterir. */
export type KayitSorunu = "depolama" | "buyuk" | null;
let sorun: KayitSorunu = null;
export const kayitSorunuOku = (): KayitSorunu => sorun;
export const kayitSorunuYaz = (s: KayitSorunu): void => {
  sorun = s;
};

/** Kütüphaneyi okur. Erişim yoksa (özel pencere, engelli depolama) `available: false` ve yalnız oturum belleğindeki liste; bozuk girdiler ve yinelenen kimlikler atlanır. */
export function loadLibrary(): { runs: SavedRun[]; available: boolean } {
  let text: string | null;
  try {
    text = window.localStorage.getItem(LIBRARY_KEY);
  } catch {
    return { runs: bellek, available: false };
  }
  const ham = parseLibrary(text);
  // Yazma başarısızsa (kota) belleğe alınan girdiler depolamadakilerin üstüne biner; yazma düzelince bellek atılır.
  if (sorun !== "depolama" || bellek.length === 0) {
    bellek = [];
    return { runs: ham, available: true };
  }
  const ids = new Set(bellek.map((r) => r.id));
  return { runs: [...ham.filter((r) => !ids.has(r.id)), ...bellek], available: true };
}

function parseLibrary(text: string | null): SavedRun[] {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObj(raw) || raw.schema !== LIBRARY_SCHEMA || !Array.isArray(raw.runs)) return [];
  const seen = new Set<string>();
  const runs: SavedRun[] = [];
  for (const e of raw.runs) {
    // Eski (64 karakterden uzun adlı) kayıtlar atlanmaz: listelenir, ekran uyarır ve açmayı kapatır.
    const p = parseEntry(e, true);
    if (!p.ok || seen.has(p.run.id)) continue;
    seen.add(p.run.id);
    runs.push(p.run);
  }
  return runs;
}

/** Kütüphaneyi yazar; depolama kapalıysa `false` (liste bellekte kalır). */
export function saveLibrary(runs: SavedRun[]): boolean {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: LIBRARY_SCHEMA, runs }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Kütüphaneye TEK yazma yolu: en güncel listeyi depolamadan okur, `f` uygular, yazar (Koşular ekranı ve otomatik kayıt aynı yoldan geçer;
 * ekran açıkken eski bir liste üzerine yazılmaz). Depolama kapalıysa liste oturum belleğinde kalır ve `available: false` döner.
 */
export function degistirKutuphane(f: (runs: SavedRun[]) => SavedRun[]): { runs: SavedRun[]; available: boolean } {
  const cur = loadLibrary();
  const next = f(cur.runs);
  if (next === cur.runs) return cur;
  const ok = saveLibrary(next);
  if (!ok) {
    bellek = next;
    sorun = "depolama";
  } else if (sorun === "depolama") {
    sorun = null;
    bellek = [];
  }
  return { runs: next, available: ok };
}

/** Dışa aktarma: kütüphane biçiminde JSON (tek koşu da `runs` listesi içinde). */
export function exportRuns(runs: SavedRun[]): string {
  return JSON.stringify({ schema: LIBRARY_SCHEMA, runs }, null, 2);
}

/** Rastgele kimlik: çakışan içe aktarılan koşuya yeni kimlik verir. */
export function newRunId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `ice-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * İçe aktarma: kütüphane/dışa aktarma JSON'u, koşu listesi ya da tek koşu. Her girdi `parseEntry` ile doğrulanır; bozuk girdi varsa
 * hiçbiri eklenmez ve her bozuk girdi için alan hatası döner. Kimliği mevcutla çakışan girdiye yeni kimlik verilir (`parentId` korunur).
 */
export function importRuns(text: string, existing: SavedRun[], makeId: () => string = newRunId): ImportResult {
  if (text.length > IMPORT_MAX_CHARS) return { ok: false, errors: [{ reason: "size" }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ reason: "json" }] };
  }
  const list: unknown[] | null = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.runs) ? raw.runs : isObj(raw) ? [raw] : null;
  if (list === null || list.length === 0) return { ok: false, errors: [{ reason: "shape" }] };
  const errors: ImportError[] = [];
  const parsed: SavedRun[] = [];
  list.forEach((e, i) => {
    const p = parseEntry(e);
    if (p.ok) parsed.push(p.run);
    else errors.push({ reason: p.reason, index: i + 1, field: p.field });
  });
  if (errors.length > 0) return { ok: false, errors };
  const used = new Set(existing.map((r) => r.id));
  const out = parsed.map((r) => {
    let id = r.id;
    while (used.has(id)) id = makeId();
    used.add(id);
    return id === r.id ? r : { ...r, id };
  });
  return { ok: true, runs: out };
}

export type ForkNode = { run: SavedRun; children: ForkNode[] };

/**
 * Çatallanma ağacı (`parentId`, iç içe). Ebeveyni kütüphanede olmayan (silinmiş) koşu kök olur; kendine ya da döngüye bağlı kayıt çökertmez
 * (döngüdeki ilk kayıt kök sayılır). Kardeşler kütüphane sırasındadır.
 */
export function forkTree(runs: SavedRun[]): ForkNode[] {
  const ids = new Set(runs.map((r) => r.id));
  const hasParent = (r: SavedRun): boolean => r.parentId !== undefined && r.parentId !== r.id && ids.has(r.parentId);
  const kids = new Map<string, SavedRun[]>();
  for (const r of runs) if (hasParent(r)) kids.set(r.parentId!, [...(kids.get(r.parentId!) ?? []), r]);
  const seen = new Set<string>();
  const walk = (r: SavedRun): ForkNode => {
    seen.add(r.id);
    return { run: r, children: (kids.get(r.id) ?? []).filter((k) => !seen.has(k.id)).map(walk) };
  };
  const roots = runs.filter((r) => !hasParent(r)).map(walk);
  for (const r of runs) if (!seen.has(r.id)) roots.push(walk(r));
  return roots;
}
