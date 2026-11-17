import type { UIValue } from "./types";

/** Skaler ayar değeri (sayı, dize, mantıksal); liste ve nesne değil. */
export function isScalar(v: unknown): v is number | string | boolean {
  return typeof v === "number" || typeof v === "string" || typeof v === "boolean";
}

/** İki ayar değeri eşit mi: skaler `===`, liste sıra duyarlı, nesne anahtar kümesi ve değerleriyle (anahtar sırası önemsiz). */
export function sameValue(a: UIValue, b: UIValue): boolean {
  if (isScalar(a) || isScalar(b)) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}
