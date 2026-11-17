import type { RecordingIndex } from "./loader";

export type RunRecipe = { setId: string; seedIndex: number; changes: { week: number; setId: string }[]; name: string; cityNames: string[] };

export function encodeRunId(r: RunRecipe): string {
  const head = [r.setId, String(r.seedIndex), ...r.changes.map((c) => `${c.week}_${c.setId}`)].join(".");
  return `${head}~${encodeURIComponent(JSON.stringify({ name: r.name, cityNames: r.cityNames }))}`;
}

export function parseRunId(id: string, index: Pick<RecordingIndex, "seeds" | "sets" | "weeks">): RunRecipe | null {
  const cut = id.indexOf("~");
  if (cut < 0) return null;
  const parts = id.slice(0, cut).split(".");
  const known = (s: string): boolean => index.sets.some((x) => x.id === s);
  const [setId, seed, ...rest] = parts;
  if (setId === undefined || seed === undefined || !known(setId) || !/^\d+$/.test(seed)) return null;
  const seedIndex = Number(seed);
  if (!index.seeds.some((s) => s.index === seedIndex)) return null;
  const changes: RunRecipe["changes"] = [];
  let last = 0;
  for (const part of rest) {
    const m = /^(\d+)_([^_.]+)$/.exec(part);
    if (!m) return null;
    const week = Number(m[1]);
    if (week <= last || week >= index.weeks || !known(m[2]!)) return null;
    last = week;
    changes.push({ week, setId: m[2]! });
  }
  let body: unknown;
  try {
    body = JSON.parse(decodeURIComponent(id.slice(cut + 1)));
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { name, cityNames } = body as { name?: unknown; cityNames?: unknown };
  if (typeof name !== "string" || !Array.isArray(cityNames) || !cityNames.every((c) => typeof c === "string")) return null;
  const recipe: RunRecipe = { setId, seedIndex, changes, name, cityNames: cityNames as string[] };
  return encodeRunId(recipe) === id ? recipe : null;
}
