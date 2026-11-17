export type Timer = { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

/** Gerçek saat; yalnız bu dosya genel zamanlayıcıyı doğrudan çağırır. */
export const realTimer: Timer = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id as unknown as ReturnType<typeof globalThis.setTimeout>),
};
