import { useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/primitives/icons";
import { t } from "../copy/t";
import { IkonDugmesi } from "../ui/IkonDugmesi";
import { useAcikKatman } from "./useAcikKatman";
import stil from "./AltSayfa.module.css";

/**
 * Telefonda (≤720 px) panellerin yerine geçen TAM EKRAN sayfa (merkezi mobil katman): haritanın üstünde sabit (fixed), başlıkta başlık + ✕,
 * gövde kendi içinde kayar. `role="dialog"` + `aria-modal`; Esc ve ✕ kapatır; odak yalnız AÇILIŞTA sayfaya alınır, kapanınca açan düğmeye döner (`useAcikKatman`). Dışarı kaçan odağı geri ÇEKMEZ: üstte açılan bir Diyalog (kendi odak tuzağı var) ile odak döngüsüne girmesin diye.
 * (`kapatIkon` eski çağrılarla uyum için kabul edilir; kapat her zaman ✕ ikonudur.)
 */
export function AltSayfa({ id, baslik, onKapat, children }: { id?: string; baslik: string; onKapat: () => void; kapatIkon?: boolean; children: ReactNode }) {
  const baslikId = useId();
  const kok = useRef<HTMLElement>(null);
  useAcikKatman(kok, onKapat);
  return (
    <section ref={kok} id={id} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={baslikId} className={stil.sayfa}>
      <div className={stil.baslik}>
        <h2 id={baslikId}>{baslik}</h2>
        <IkonDugmesi variant="secondary" hiza="son" etiket={t("ekran.panel_kapat")} ikon={<CloseIcon size="18" />} onClick={onKapat} />
      </div>
      <div className={stil.govde} tabIndex={0}>{children}</div>
    </section>
  );
}
