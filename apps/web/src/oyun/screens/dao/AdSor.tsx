"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { kodNoktasinaKes } from "@/oyun/lib/names";
import { oyuncuKimligi } from "@/oyun/lib/oyuncuKimligi";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import styles from "./DaoEkrani.module.css";

const AD_EN_COK = 30;
/** Sonuç kancası bitişten kısa süre sonra yazar: `sonuc_yok` (409) gelirse birkaç kez daha denenir. */
const DENEME_BEKLEME_MS = [300, 600, 1200, 2400] as const;
const bekle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function adHatasi(e: unknown): CopyKey {
  if (e instanceof SimUnsupported) {
    if (e.message === "ad_var") return "dao.ad_var";
    if (e.message === "karar_gecersiz") return "yayinla.hata_gecersiz";
    if (e.message === "oyuncu_uyusmuyor") return "dao.ad_baskasi";
    if (e.message === "sonuc_yok") return "dao.ad_sonuc_yok";
  }
  return "dao.ad_hata";
}

/** Dünyaya bağlı koşunun sonunda, skor tablosunda görünecek isteğe bağlı ad. Koşu başına bir kez yazılır. */
export function AdSor({ runId }: { runId: string }) {
  const source = useSimSource();
  const uid = useId();
  const [ad, setAd] = useState("");
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<CopyKey | null>(null);
  const [tamam, setTamam] = useState(false);
  const busy = useRef(false);
  const iptal = useRef(false);
  useEffect(() => {
    iptal.current = false;
    return () => {
      iptal.current = true;
    };
  }, []);
  if (typeof source.daoAd !== "function") return null;
  const yaz = source.daoAd.bind(source);

  const gonder = async (): Promise<void> => {
    if (busy.current || ad.trim() === "") return;
    busy.current = true;
    setMesgul(true);
    setHata(null);
    try {
      for (let i = 0; ; i++) {
        try {
          await yaz(runId, ad.trim(), oyuncuKimligi());
          setTamam(true);
          return;
        } catch (e) {
          const bekleme = DENEME_BEKLEME_MS[i];
          if (e instanceof SimUnsupported && e.message === "sonuc_yok" && bekleme !== undefined) {
            await bekle(bekleme);
            if (iptal.current) return;
            continue;
          }
          setHata(adHatasi(e));
          return;
        }
      }
    } finally {
      busy.current = false;
      setMesgul(false);
    }
  };

  return (
    <div className={styles.panel}>
      {tamam ? (
        <p className={styles.kucuk} role="status">{t("dao.ad_kaydedildi")}</p>
      ) : (
        <Stack gap="10" align="start">
          <Field kind="input" id={`${uid}-ad`} label={t("dao.ad_sor")} value={ad} onChange={(e) => setAd(kodNoktasinaKes(e.currentTarget.value, AD_EN_COK))} />
          <Button variant="secondary" disabled={mesgul || ad.trim() === ""} onClick={() => void gonder()}>
            {t("dao.ad_gonder")}
          </Button>
        </Stack>
      )}
      {hata !== null ? <p role="alert" className={styles.hata}>{t(hata)}</p> : null}
    </div>
  );
}
