import { tr } from "./tr";

export type CopyKey = keyof typeof tr;

/** Metni anahtarla getirir; `{ad}` yer tutucuları `params` ile doldurulur. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const raw: string = tr[key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
