import { useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/primitives/icons";
import { t } from "../copy/t";
import { IkonDugmesi } from "../ui/IkonDugmesi";
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
  /** Kapat düğmesi metin yerine ✕ ikonu olur (ipucu ve `aria-label` aynı metin). */
  kapatIkon?: boolean;
  /** Panelin kök kimliği (açan düğmenin `aria-controls` hedefi). */
  id?: string;
  className?: string;
};

/** Haritanın üstünde yüzen cam panel. Harita türünü bilmez; içerik dışarıdan gelir. */
export function YuzenPanel({ baslik, children, acik = true, onAcikDegis, onKapat, kapatIkon = false, id: kokId, className }: YuzenPanelProps) {
  const id = useId();
  const baslikId = `${id}-baslik`;
  const govdeId = `${id}-govde`;
  const kok = useRef<HTMLElement>(null);
  useAcikKatman(kok, onKapat);
  return (
    <aside ref={kok} id={kokId} tabIndex={-1} aria-labelledby={baslikId} className={`${stil.panel} ${acik ? "" : stil.daralmis} ${className ?? ""}`}>
      <div className={stil.baslik}>
        <h2 id={baslikId}>{baslik}</h2>
        {onAcikDegis ? (
          <button type="button" className={stil.dugme} aria-expanded={acik} aria-controls={govdeId} onClick={() => onAcikDegis(!acik)}>
            {t(acik ? "ekran.panel_daralt" : "ekran.panel_ac")}
          </button>
        ) : null}
        {onKapat && kapatIkon ? (
          <IkonDugmesi variant="secondary" hiza="son" etiket={t("ekran.panel_kapat")} ikon={<CloseIcon size="18" />} onClick={onKapat} />
        ) : onKapat ? (
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
