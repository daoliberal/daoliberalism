const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_VALID = 253402300799n; // 9999-12-31T23:59:59Z
const DAY = 86400n;
const HOUR = 3600n;

export function isNeverRelease(release: bigint): boolean {
  return release > MAX_VALID;
}

function parts(t: bigint): { d: number; m: string; y: number } | null {
  if (t < 0n || t > MAX_VALID) return null;
  const date = new Date(Number(t) * 1000);
  return { d: date.getUTCDate(), m: MONTHS[date.getUTCMonth()] ?? "", y: date.getUTCFullYear() };
}

export function formatDate(t: bigint): string {
  const p = parts(t);
  return p ? `${p.d} ${p.m} ${p.y}` : "—";
}

export function formatShortDate(t: bigint): string {
  const p = parts(t);
  return p ? `${p.d} ${p.m}` : "—";
}

export function formatReleaseDate(release: bigint): string {
  return isNeverRelease(release) ? "never releases" : formatDate(release);
}

/** "2 d 04 h" — whole days, then zero-padded whole hours. */
export function formatDuration(seconds: bigint): string {
  const s = seconds < 0n ? 0n : seconds;
  const days = s / DAY;
  const hours = (s % DAY) / HOUR;
  return `${days} d ${hours.toString().padStart(2, "0")} h`;
}

export function formatReleaseIn(release: bigint, now: bigint): string {
  if (isNeverRelease(release)) return "never releases";
  if (release <= now) return "Available";
  return `in ${formatDuration(release - now)} · ${formatShortDate(release)}`;
}

export function holdProgressPct(creditedAt: bigint, release: bigint, now: bigint): number {
  if (release <= creditedAt) return 100;
  if (now <= creditedAt) return 0;
  if (now >= release) return 100;
  return Number(((now - creditedAt) * 100n) / (release - creditedAt));
}

/** Current time in unix seconds from the system clock. */
export function wallClockNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
