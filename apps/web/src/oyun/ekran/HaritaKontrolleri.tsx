import type { ReactNode } from "react";
import { t } from "../copy/t";
import stil from "./HaritaKontrolleri.module.css";

export type HaritaKontrolleriProps = {
  onYaklas: () => void;
  onUzaklas: () => void;
  onSigdir: () => void;
  /** Harita türüne özgü ek düğmeler (ör. katman seçici). */
  ekler?: ReactNode;
};

/** Yaklaştır, uzaklaştır, sığdır. Harita türünü bilmez; eylemleri dışarıdan alır. */
export function HaritaKontrolleri({ onYaklas, onUzaklas, onSigdir, ekler }: HaritaKontrolleriProps) {
  return (
    <div role="group" aria-label={t("ekran.kontrol")} className={stil.grup}>
      <button type="button" className={stil.dugme} aria-label={t("ekran.yaklas")} onClick={onYaklas}>
        +
      </button>
      <button type="button" className={stil.dugme} aria-label={t("ekran.uzaklas")} onClick={onUzaklas}>
        −
      </button>
      <button type="button" className={stil.dugme} onClick={onSigdir}>
        {t("harita.sigdir")}
      </button>
      {ekler}
    </div>
  );
}
