import type { WorldEvent } from "./types";

/** Sürüm olayının numarası: `params.surum`; yoksa kimliğin `version:<n>:…` biçiminden. Sürüm olayı değilse `null`. */
export function surumNo(e: WorldEvent): number | null {
  if (e.textKey !== "event.version") return null;
  const p = e.params.surum;
  const n = typeof p === "number" ? p : Number(e.id.split(":")[1]);
  return Number.isFinite(n) ? n : null;
}
