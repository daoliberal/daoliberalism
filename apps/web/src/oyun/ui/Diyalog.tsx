"use client";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { cx } from "@/components/primitives/cx";
import { useModalFocus } from "@/components/shell/useModalFocus";
import { t } from "@/oyun/copy/t";
import styles from "./Diyalog.module.css";

/** Açık (sayılan) iletişim kutusu sayısı: iki modal üst üste açılmasın diye bekletilen kutular okur. */
let acikSayi = 0;
const dinleyiciler = new Set<() => void>();
function diyalogKaydet(): () => void {
  acikSayi += 1;
  for (const d of [...dinleyiciler]) d();
  return () => {
    acikSayi -= 1;
    for (const d of [...dinleyiciler]) d();
  };
}
const abone = (d: () => void): (() => void) => {
  dinleyiciler.add(d);
  return () => {
    dinleyiciler.delete(d);
  };
};
export const useDiyalogAcik = (): boolean => useSyncExternalStore(abone, () => acikSayi > 0, () => false);

/**
 * Kalıcı iletişim kutusu: `role="dialog"` + `aria-modal`, başlığa bağlı ad, Tab içeride döner, Esc ve "Kapat" kapatır,
 * kapanınca odak açan öğeye döner (`useModalFocus`).
 */
export function Diyalog({ baslik, onKapat, kapatMetni, disabled = false, kapatSonda = false, odakAnahtari = "diyalog", sayilir = true, yuzen = false, children }: { baslik: string; onKapat(): void; /** Kapat düğmesinin metni (varsayılan "Kapat"). */ kapatMetni?: string; /** Kapat düğmesi içeriğin sonunda (eylem düğmelerinden sonra) durur; başlıkta değil. */ kapatSonda?: boolean; /** Kapat düğmesi kapalı (ör. bir işlem sürerken). */ disabled?: boolean; /** İçerik değişince (ör. tur adımı) odak yeniden kutuya alınır ve yeni başlıkla duyurulur; değişmedikçe odak yerinde kalır. */ odakAnahtari?: string; /** Açık iletişim kutusu sayısına katılır (`useDiyalogAcik`); rehber kutusu kendini saymaz. */ sayilir?: boolean; /** Opak tam ekran kaplama yerine şehrin üstünde yüzen büyük panel (kenarlarda şehir görünür; telefonda alt sayfa). Üst katman `ekran` takma adlarını (`.kok`) sağlamalıdır. */ yuzen?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useModalFocus(ref, true, onKapat, odakAnahtari);
  useEffect(() => (sayilir ? diyalogKaydet() : undefined), [sayilir]);
  return (
    <div className={cx(styles.kaplama, yuzen && styles.yuzenKaplama)}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx(styles.diyalog, yuzen && styles.yuzenDiyalog)}>
        <div className={styles.ust}>
          <h2 id={titleId} className={styles.baslik}>
            {baslik}
          </h2>
          {kapatSonda ? null : (
            <Button variant="secondary" size="sm" disabled={disabled} onClick={onKapat}>
              {kapatMetni ?? t("diyalog.kapat")}
            </Button>
          )}
        </div>
        {children}
        {kapatSonda ? (
          <div className={styles.alt}>
            <Button variant="secondary" size="sm" disabled={disabled} onClick={onKapat}>
              {kapatMetni ?? t("diyalog.kapat")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
