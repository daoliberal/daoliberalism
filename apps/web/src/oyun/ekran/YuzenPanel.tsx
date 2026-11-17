import { useId, useRef, type ReactNode } from "react";
import { t } from "../copy/t";
import { useAcikKatman } from "./useAcikKatman";
import stil from "./YuzenPanel.module.css";

export type YuzenPanelProps = {
  baslik: string;
  children: ReactNode;
  /** Verilirse panel daraltılabilir (başlıkta `aria-expanded` düğmesi). Verilmezse hep açıktır. */
  acik?: boolean;
  onAcikDegis?: (acik: boolean) => void;
  /** Verilirse başlıkta kapat düğmesi çıkar ve Escape paneli kapatır (sağ panel). */
  onKapat?: () => void;
  className?: string;
};

/** Haritanın üstünde yüzen cam panel. Harita türünü bilmez; içerik dışarıdan gelir. */
export function YuzenPanel({ baslik, children, acik = true, onAcikDegis, onKapat, className }: YuzenPanelProps) {
  const id = useId();
  const baslikId = `${id}-baslik`;
  const govdeId = `${id}-govde`;
  const kok = useRef<HTMLElement>(null);
  useAcikKatman(kok, onKapat);
  return (
    <aside ref={kok} tabIndex={-1} aria-labelledby={baslikId} className={`${stil.panel} ${acik ? "" : stil.daralmis} ${className ?? ""}`}>
      <div className={stil.baslik}>
        <h2 id={baslikId}>{baslik}</h2>
        {onAcikDegis ? (
          <button type="button" className={stil.dugme} aria-expanded={acik} aria-controls={govdeId} onClick={() => onAcikDegis(!acik)}>
            {t(acik ? "ekran.panel_daralt" : "ekran.panel_ac")}
          </button>
        ) : null}
        {onKapat ? (
          <button type="button" className={stil.dugme} onClick={onKapat}>
            {t("ekran.panel_kapat")}
          </button>
        ) : null}
      </div>
      <div id={govdeId} className={stil.govde} hidden={!acik} tabIndex={0}>
        {children}
      </div>
    </aside>
  );
}
