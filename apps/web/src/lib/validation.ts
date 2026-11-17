import { isAddress, parseEther } from "viem";

export type Parsed<T> = { ok: true; value: T } | { ok: false };

const fail = { ok: false } as const;

export function parseEthInput(s: string): Parsed<bigint> {
  const t = s.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return fail;
  const frac = t.split(".")[1] ?? "";
  if (frac.length > 18) return fail;
  try {
    return { ok: true, value: parseEther(t.endsWith(".") ? t.slice(0, -1) : t) };
  } catch {
    return fail;
  }
}

export function parsePercentToBps(s: string): Parsed<number> {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return fail;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? { ok: true, value: bps } : fail;
}

export function parseDaysToSeconds(s: string): Parsed<number> {
  const t = s.trim();
  if (!/^\d{1,10}$/.test(t)) return fail;
  const seconds = Number(t) * 86400;
  return seconds <= 4_294_967_295 ? { ok: true, value: seconds } : fail;
}

export function parsePositiveInt(s: string, max: number): Parsed<number> {
  const t = s.trim();
  if (!/^\d{1,15}$/.test(t)) return fail;
  const n = Number(t);
  return n >= 1 && n <= max ? { ok: true, value: n } : fail;
}

export function isAddressInput(s: string): boolean {
  return isAddress(s, { strict: false });
}

/** Only https:// and ipfs:// addresses are accepted (plain http and every other scheme are not); empty is not an error. */
export function metadataUrlError(v: string): string | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  if (/^ipfs:\/\/\S+$/i.test(t)) return undefined;
  if (/^https:\/\/\S+$/i.test(t)) {
    try {
      new URL(t);
      return undefined;
    } catch {
      /* falls through to the message */
    }
  }
  return "Use an https:// or ipfs:// address.";
}
