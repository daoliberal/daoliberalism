"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t, type CopyKey } from "@/oyun/copy/t";
import { KOSU_AD_UZUNLUK, type SavedRun } from "@/oyun/sim/library";
import { YETENEKLER } from "@/oyun/yetenekler";
import styles from "./Kosular.module.css";

/** Başlangıç zamanı (gün ve saat): aynı adlı iki koşu kartta ayırt edilir. */
const tarih = (iso: string): string => new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Tek koşu kartı: Aç, Yeniden adlandır, Karşılaştır, Şartı kopyala, Dışa aktar, Sil. Karşılaştır kapalıysa nedeni görünür. */
export function KosuKarti({ run, aktif, bekliyor, karsilastirNeden, onAc, onAd, onKarsilastir, onKopya, onDisa, onSil }: {
  run: SavedRun;
  /** Koşu şu an kaynakta açık. */
  aktif: boolean;
  /** Başka bir koşu açılıyor: düğmeler bekler. */
  bekliyor: boolean;
  karsilastirNeden: CopyKey | null;
  onAc(): void;
  onAd(ad: string): void;
  onKarsilastir(): void;
  onKopya(): void;
  onDisa(): void;
  onSil(): void;
}) {
  const uid = useId();
  const [adlandir, setAdlandir] = useState<string | null>(null);
  const eylem = (k: CopyKey): string => t("kosular.eylem", { eylem: t(k), ad: run.name });
  const uzun = run.name.length > KOSU_AD_UZUNLUK;
  const surum = (run.recipe.schedule?.length ?? 0) + 1;
  const kaydet = (): void => {
    const ad = (adlandir ?? "").trim();
    if (ad !== "") onAd(ad);
    setAdlandir(null);
  };
  return (
    <li className={`${styles.kart} ${aktif ? styles.kartAktif : ""}`}>
      <div className={styles.kartBaslik}>
        <h3 className={styles.kartAd}>{run.name}</h3>
        {aktif ? <span className={styles.etiket}>{t("kosular.kart.acik")}</span> : null}
      </div>
      <p className={styles.kucuk}>
        {t("kosular.kart.meta", { kaynak: t(run.source === "live" ? "kosular.kaynak.live" : "kosular.kaynak.replay"), sure: run.recipe.durationWeeks, surum, tarih: tarih(run.savedAt) })}
      </p>
      {uzun ? <p id={`${uid}-uzun`} className={styles.hata}>{t("kosular.kart.ad_uzun")}</p> : null}
      {adlandir !== null ? (
        <div className={styles.adSatiri}>
          <div className={styles.adAlani}>
            <Field kind="input" id={`${uid}-ad`} label={t("kosular.yeni_ad")} labelSize="14" value={adlandir} maxLength={KOSU_AD_UZUNLUK} onChange={(e) => setAdlandir(e.target.value)} />
          </div>
          <Button variant="primary" size="sm" onClick={kaydet}>{t("kosular.kaydet")}</Button>
          <Button variant="secondary" size="sm" onClick={() => setAdlandir(null)}>{t("kosular.vazgec")}</Button>
        </div>
      ) : null}
      <div className={styles.dugmeler}>
        <Button variant="primary" size="sm" disabled={bekliyor || uzun} aria-describedby={uzun ? `${uid}-uzun` : undefined} aria-label={eylem("kosular.ac")} onClick={onAc}>{t("kosular.ac")}</Button>
        <Button variant="secondary" size="sm" aria-label={eylem("kosular.yeniden_adlandir")} onClick={() => setAdlandir(run.name.slice(0, KOSU_AD_UZUNLUK))}>{t("kosular.yeniden_adlandir")}</Button>
        {YETENEKLER.isEkranlari ? <Button variant="secondary" size="sm" disabled={bekliyor || uzun || karsilastirNeden !== null} aria-label={eylem("kosular.karsilastir")} aria-describedby={karsilastirNeden !== null ? `${uid}-neden` : undefined} onClick={onKarsilastir}>{t("kosular.karsilastir")}</Button> : null}
        <Button variant="secondary" size="sm" aria-label={eylem("kosular.sarti_kopyala")} onClick={onKopya}>{t("kosular.sarti_kopyala")}</Button>
        <Button variant="secondary" size="sm" aria-label={eylem("kosular.disa_aktar")} onClick={onDisa}>{t("kosular.disa_aktar")}</Button>
        <Button variant="secondary" size="sm" aria-label={eylem("kosular.sil")} onClick={onSil}>{t("kosular.sil")}</Button>
      </div>
      {YETENEKLER.isEkranlari && karsilastirNeden !== null ? <p id={`${uid}-neden`} className={styles.kucuk}>{t(karsilastirNeden)}</p> : null}
    </li>
  );
}
