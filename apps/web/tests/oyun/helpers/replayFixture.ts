import type { RecordingIndex } from "@/oyun/sim/replay/loader";
import type { World } from "@/oyun/sim/types";

export const WEEKS = 200;
const KEYS = ["served", "failed_cum", "loans_rejected", "city_cash_total", "player_firms", "privatized_firms", "support_weekly", "gini"] as const;
export type Series = (w: number) => Partial<World>;

export function makeIndex(): RecordingIndex {
  const mk = (id: string, v: string) => ({
    id,
    values: { gecis_destegi: v },
    files: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [String(i), `${id}/pm${i}.json`])),
  });
  return {
    schema: "oyun-kayit/1",
    model_note: "not",
    weeks: WEEKS,
    seeds: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, label: 0.078 + i * 0.002 })),
    sets: [mk("kapali", "kapali"), mk("kisa", "kisa_sureli"), mk("kurtarma", "kurtarma_fonuyla")],
    derived: [],
    fixed_rules: [{ settingId: "ucret_stopaji", valueKey: "lock.sabit" }],
    templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali" } }],
  };
}

const BASE: Partial<World> = { served: 1, failed_cum: 0, loans_rejected: 0, city_cash_total: 100000, player_firms: 0, privatized_firms: 0, support_weekly: 0, gini: 0.3 };

export function runJson(setId: string, seed: number, series: Series = () => ({}), len = WEEKS): string {
  const cols: Record<string, (number | null)[]> = {};
  for (const k of KEYS) cols[k] = [];
  for (let w = 1; w <= len; w++) {
    const row = { ...BASE, ...series(w) } as Record<string, number | null>;
    for (const k of KEYS) cols[k]!.push(row[k] ?? null);
  }
  return JSON.stringify({ set: setId, pm_index: seed, weeks: len, cols });
}

export type Files = Record<string, string>;
export function allFiles(series: Series = () => ({}), len = WEEKS): Files {
  const files: Files = { "/k/index.json": JSON.stringify(makeIndex()) };
  for (const s of ["kapali", "kisa", "kurtarma"]) for (let i = 0; i < 6; i++) files[`/k/${s}/pm${i}.json`] = runJson(s, i, series, len);
  return files;
}

export function makeFetch(files: Files): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const body = files[url];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

export type FakeTimer = { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void; advance(ms: number): void; readonly pending: number };
export function fakeTimer(): FakeTimer {
  let now = 0;
  let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { q.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best: [number, { at: number; fn: () => void }] | null = null;
        for (const e of q) if (e[1].at <= end && (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0]))) best = e;
        if (!best) break;
        q.delete(best[0]);
        now = Math.max(now, best[1].at);
        best[1].fn();
      }
      now = end;
    },
    get pending() { return q.size; },
  };
}
