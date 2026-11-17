"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SimSource } from "./types";

const Ctx = createContext<SimSource | null>(null);

export function SimSourceProvider({ source, children }: { source: SimSource; children: ReactNode }) {
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useSimSource(): SimSource {
  const s = useContext(Ctx);
  if (!s) throw new Error("no_source");
  return s;
}
