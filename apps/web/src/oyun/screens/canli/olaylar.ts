import { surumNo } from "@/oyun/sim/surum";
import type { WeekPacket, WorldEvent } from "@/oyun/sim/types";

/** Olayın haftası: `params.hafta` ya da kimliğin `kural:<hafta>` sonu. */
export function eventWeek(e: WorldEvent): number {
  const h = e.params.hafta;
  if (typeof h === "number" && Number.isFinite(h)) return h;
  const n = Number(e.id.split(":")[1]);
  return Number.isFinite(n) ? n : e.week;
}

const ofRule = (events: WorldEvent[], rule: string): number | null => {
  const e = events.find((x) => x.id.startsWith(`${rule}:`));
  return e ? eventWeek(e) : null;
};

/** Çöküş ve toparlanma haftaları `events` listesinden türetilir. */
export function collapseRecovery(events: WorldEvent[]): { cokus: number | null; toparlanma: number | null } {
  return { cokus: ofRule(events, "cokus"), toparlanma: ofRule(events, "toparlanma") };
}

export type SurumSatiri = { n: number; a: number; b: number };

/** `event.version` olaylarından sürüm listesi: `version:<n>:<hafta>:<küme>`. Son sürüm şu anki haftaya kadar sürer. */
export function surumler(events: WorldEvent[], currentWeek: number, currentVersion: number): SurumSatiri[] {
  const byN = new Map<number, { n: number; week: number }>();
  for (const e of events) {
    const n = surumNo(e);
    if (n !== null) byN.set(n, { n, week: eventWeek(e) }); // aynı numara: sonuncusu kalır
  }
  const seams = [...byN.values()].sort((x, y) => x.n - y.n);
  const out: SurumSatiri[] = [];
  let from = 0;
  let n = 1;
  for (const s of seams) {
    out.push({ n, a: from, b: s.week });
    n = s.n;
    from = s.week;
  }
  out.push({ n: Math.max(n, currentVersion), a: from, b: Math.max(from, currentWeek) });
  return out;
}

export const lastTwo = (weeks: WeekPacket[]): { cur: WeekPacket | null; prev: WeekPacket | null } => ({
  cur: weeks[weeks.length - 1] ?? null,
  prev: weeks[weeks.length - 2] ?? null,
});

/** "Yalnız önemli olaylar" süzgeci: kritik, iyi ya da kötü olaylar ile şart sürümleri. */
export const onemliOlay = (e: WorldEvent): boolean => e.critical || e.kind === "good" || e.kind === "bad" || e.textKey === "event.version";
