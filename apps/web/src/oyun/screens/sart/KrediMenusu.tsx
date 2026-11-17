"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import styles from "./SartOzel.module.css";

/**
 * Kredi türü menüsü: "Varsayılana döndür" ve "Kendi varyantına kopyala". Açılır eylem satırı (menü rolü yok: iki düğme);
 * eylemden ve Escape'ten sonra odak menü düğmesine döner.
 */
export function KrediMenusu({ ad, varsayilanaDonulebilir, onSifirla, onKopyala }: {
  ad: string;
  /** Kart kilitli, pasif ya da salt okunursa değeri değişmez. */
  varsayilanaDonulebilir: boolean;
  onSifirla(): void;
  onKopyala(): void;
}) {
  const id = useId();
  const [acik, setAcik] = useState(false);
  const dugmeId = `${id}-dugme`;
  const kapat = (): void => {
    setAcik(false);
    document.getElementById(dugmeId)?.focus();
  };
  return (
    <div className={styles.eylem} onKeyDown={(e) => { if (e.key === "Escape" && acik) { e.stopPropagation(); kapat(); } }}>
      <Button id={dugmeId} variant="secondary" size="sm" aria-expanded={acik} aria-controls={id} aria-label={t("sart.kredi.eylemler_ad", { ad })} onClick={() => setAcik((a) => !a)}>
        {t("sart.kredi.eylemler")}
      </Button>
      {acik ? (
        <div id={id} className={styles.eylemSatiri}>
          <Button variant="secondary" size="sm" disabled={!varsayilanaDonulebilir} onClick={() => { onSifirla(); kapat(); }}>
            {t("sart.kredi.varsayilana")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { onKopyala(); kapat(); }}>
            {t("sart.kredi.kopyala")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
