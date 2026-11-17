"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { oyuncuKimligi } from "@/oyun/lib/oyuncuKimligi";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { DunyaOzet } from "@/oyun/sim/types";
import { Yukleniyor } from "@/oyun/ui/Durum";
import styles from "./DaoEkrani.module.css";

/** DAO girişinin "Benim dünyalarım" sekmesi: bu tarayıcının oyuncu kimliğiyle yayınlanan dünyalar. */
export function Dunyalarim() {
  const source = useSimSource();
  const { go } = useHashRoute();
  const [durum, setDurum] = useState<{ liste: DunyaOzet[] } | "hata" | null>(null);
  useEffect(() => {
    if (!source.dunyalarim) return;
    let live = true;
    source.dunyalarim(oyuncuKimligi()).then(
      (liste) => live && setDurum({ liste }),
      () => live && setDurum("hata"),
    );
    return () => {
      live = false;
    };
  }, [source]);
  let govde;
  if (durum === null) govde = <Yukleniyor />;
  else if (durum === "hata") govde = <p role="alert" className={styles.hata}>{t("dunyalarim.hata")}</p>;
  else if (durum.liste.length === 0) govde = <p className={styles.kucuk}>{t("dunyalarim.yok")}</p>;
  else {
    govde = (
      <ul className={styles.olaylar}>
        {durum.liste.map((d) => (
          <li key={d.kod} className={styles.panel}>
            <h3 className={styles.altBaslik}>{d.ad}</h3>
            {d.aciklama !== "" ? <p className={styles.kucuk}>{d.aciklama}</p> : null}
            <p className={styles.kucuk}>{t("dunya.oynanma", { n: d.oynanma })}</p>
            <div className={styles.dugmeler}>
              <Button variant="secondary" size="sm" onClick={() => go({ name: "dao", dunya: d.kod })}>
                {t("dunyalarim.ac")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return <div className={styles.bolum}>{govde}</div>;
}
