import { useId, useMemo, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t } from "@/oyun/copy/t";
import { tarifKapaliNedeni, tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { encodeRecipe } from "@/oyun/sim/recipe";
import type { RunState } from "@/oyun/sim/types";
import styles from "./Sonuc.module.css";

/** Şartı paylaş: koşunun tarifi (başlangıç değerleri + sürüm takvimi) kopyalanabilir bir kod olur. Panoya erişim yoksa kod seçilir. */
export function SartiPaylas({ state }: { state: RunState }) {
  const uid = useId();
  const kodId = `${uid}-kod`;
  const [durum, setDurum] = useState<"bosta" | "kopyalandi" | "elle">("bosta");
  const kapali = tarifKapaliNedeni(state);
  const kod = useMemo(() => encodeRecipe(tarifOf(state)), [state]);
  const sec = (): void => {
    const el = document.getElementById(kodId) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  const kopyala = async (): Promise<void> => {
    if (!kod.ok) return;
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("pano yok");
      await navigator.clipboard.writeText(kod.code);
      setDurum("kopyalandi");
    } catch {
      sec();
      setDurum("elle");
    }
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.altBaslik}>{t("sonuc.paylas.baslik")}</h3>
      <p className={styles.kucuk}>{t("sonuc.paylas.bilgi")}</p>
      {kapali !== null ? (
        <p className={styles.kucuk}>{t(kapali === "ozel" ? "sonuc.paylas.kapali_ozel" : "sonuc.paylas.kapali_surum")}</p>
      ) : kod.ok ? (
        <div className={styles.kodSatiri}>
          <div className={styles.kodAlani}>
            <Field kind="input" id={kodId} label={t("sonuc.paylas.etiket")} mono readOnly value={kod.code} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => void kopyala()}>
            {t(durum === "kopyalandi" ? "sonuc.paylas.kopyalandi" : "sonuc.paylas.kopyala")}
          </Button>
        </div>
      ) : (
        <p className={styles.kucuk}>{t("sonuc.paylas.buyuk")}</p>
      )}
      <div role="status" aria-live="polite">
        {durum === "elle" ? <p className={styles.kucuk}>{t("sonuc.paylas.elle")}</p> : null}
      </div>
    </section>
  );
}
