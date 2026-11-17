import { useId, useRef, type ReactNode } from "react";
import { t } from "../copy/t";
import { useAcikKatman } from "./useAcikKatman";
import stil from "./AltSayfa.module.css";

/** Telefonda (≤720 px) panellerin yerine geçen alt sayfa. Modal değildir: harita arkada kullanılabilir kalır. */
export function AltSayfa({ id, baslik, onKapat, children }: { id?: string; baslik: string; onKapat: () => void; children: ReactNode }) {
  const baslikId = useId();
  const kok = useRef<HTMLElement>(null);
  useAcikKatman(kok, onKapat);
  return (
    <section ref={kok} data-pay="alt" id={id} tabIndex={-1} aria-labelledby={baslikId} className={stil.sayfa}>
      <div className={stil.tutac} aria-hidden="true" />
      <div className={stil.baslik}>
        <h2 id={baslikId}>{baslik}</h2>
        <button type="button" className={stil.kapat} onClick={onKapat}>
          {t("ekran.alt_sayfa_kapat")}
        </button>
      </div>
      <div className={stil.govde} tabIndex={0}>{children}</div>
    </section>
  );
}
