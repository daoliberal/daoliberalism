"use client";

import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext<number | null>(null);

/** Sunucunun varsayılan dünyadaki hafta başına süre ölçümü (`/api/hello`); kayıt kaynağında ve ölçüm yoksa `null`. */
export function HizBilgisiProvider({ secPerWeekP50, children }: { secPerWeekP50: number | null; children: ReactNode }) {
  return <Ctx.Provider value={secPerWeekP50}>{children}</Ctx.Provider>;
}

export function useSecPerWeekP50(): number | null {
  return useContext(Ctx);
}
