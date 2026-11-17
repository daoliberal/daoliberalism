"use client";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "@/components/primitives/cx";
import styles from "./Sekmeler.module.css";

export type Sekme = { id: string; baslik: ReactNode; alt?: ReactNode };

export const sekmeKimligi = (onek: string, id: string): string => `${onek}-sekme-${id}`;
export const sekmePaneliKimligi = (onek: string): string => `${onek}-panel`;

/**
 * Sekme şeridi (ARIA tabs, elle etkinleştirme değil: ok tuşu hem odağı hem seçimi taşır). Panel çağıranda çizilir:
 * `role="tabpanel"`, `id={sekmePaneliKimligi(onek)}`, `aria-labelledby={sekmeKimligi(onek, secili)}`.
 */
export function Sekmeler({ etiket, onek, sekmeler, secili, onSec, buyuk }: { etiket: string; onek: string; sekmeler: Sekme[]; secili: string; onSec(id: string): void; buyuk?: boolean }) {
  const tus = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = sekmeler.length;
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % n;
    else if (e.key === "ArrowLeft") to = (i - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    const hedef = sekmeler[to];
    if (!hedef) return;
    onSec(hedef.id);
    document.getElementById(sekmeKimligi(onek, hedef.id))?.focus();
  };
  return (
    <div role="tablist" aria-label={etiket} className={styles.serit}>
      {sekmeler.map((s, i) => (
        <button
          key={s.id} type="button" role="tab" id={sekmeKimligi(onek, s.id)} aria-selected={s.id === secili} aria-controls={sekmePaneliKimligi(onek)}
          tabIndex={s.id === secili ? 0 : -1} className={cx(styles.sekme, buyuk && styles.buyuk, s.id === secili && styles.acik)}
          onClick={() => onSec(s.id)} onKeyDown={(e) => tus(e, i)}
        >
          <strong>{s.baslik}</strong>
          {s.alt ? <span className={styles.alt}>{s.alt}</span> : null}
        </button>
      ))}
    </div>
  );
}
