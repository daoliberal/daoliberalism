"use client";
import { useEffect, useState } from "react";
import { t } from "@/oyun/copy/t";
import styles from "./OnizlemeSeridi.module.css";

const ANAHTAR = "daoliberalism.onizleme.kapali";

function kapaliMi(): boolean {
  try {
    return window.sessionStorage.getItem(ANAHTAR) === "1";
  } catch {
    return false;
  }
}

/** Önizleme rozeti: yalnız `NEXT_PUBLIC_ONIZLEME=1` ile derlenen yayında görünür; bayraksız derleme hiçbir şey çizmez.
 *  Sabit küçük hap: düzene yer tutmaz, tam ekran kaplamaların üstündedir; × ile oturum boyunca kapanır. */
export function OnizlemeSeridi() {
  const acik = process.env.NEXT_PUBLIC_ONIZLEME === "1";
  const [kapali, setKapali] = useState(false);
  useEffect(() => {
    if (kapaliMi()) setKapali(true);
  }, []);
  if (!acik || kapali) return null;
  const kapat = () => {
    setKapali(true);
    try {
      window.sessionStorage.setItem(ANAHTAR, "1");
    } catch {
      /* depolama yoksa yalnız bu açılışta kapanır */
    }
  };
  return (
    <div role="status" className={styles.rozet} title={t("onizleme.serit")}>
      <span aria-hidden="true" className={styles.kisa}>
        {t("onizleme.kisa")}
      </span>
      <span className={styles.gizli}>{t("onizleme.serit")}</span>
      <button type="button" className={styles.kapat} aria-label={t("onizleme.kapat")} onClick={kapat}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
