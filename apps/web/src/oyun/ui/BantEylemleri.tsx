import type { ReactNode } from "react";
import stil from "./bantEylemleri.module.css";

/** Banner metninin yanindaki eylem dugmeleri: bosluk bicimlendirmeyle (metin degil) verilir. */
export function BantEylemleri({ children }: { children: ReactNode }) {
  return <span className={stil.eylemler}>{children}</span>;
}
