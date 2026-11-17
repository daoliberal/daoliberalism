"use client";
import { useId, useState } from "react";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { faizParametreleri, hedefFaiz } from "@/oyun/sim/faizKurali";
import { formatValue, numberText } from "@/oyun/sim/formatValue";
import type { Registry, ValuesPatch } from "@/oyun/sim/types";
import { LineChart } from "@/oyun/ui/LineChart";
import { SayiGirdisi, type NumberControl } from "@/oyun/ui/SayiGirdisi";
import styles from "./SartOzel.module.css";

const HAFTALIK: NumberControl = { type: "number", min: 0, max: 100, step: 0.0001, unit: "yuzde_hafta", integer: false };
const YUZDE = (max: number, step: number): NumberControl => ({ type: "number", min: 0, max, step, unit: "yuzde", integer: false });
const ORAN: NumberControl = { type: "number", min: 0, max: 1.5, step: 0.05, unit: "oran", integer: false };
const EPS = 1e-12;
/** Eğrinin yatay ekseni: yıllık enflasyon yüzde 0..20. */
const EGRI_ENFLASYON = Array.from({ length: 21 }, (_, i) => i);

type Girdi = { infl: number; unemp: number; cd: number; idle: number };
const BASLANGIC: Girdi = { infl: 0, unemp: 25, cd: 0.7, idle: 50 };

/**
 * Faiz kuralı hesaplayıcısı. Simülasyonu etkilemez: taslaktaki faiz kuralı kartlarının değerleriyle, denenen girdilerde politika faizinin
 * hedefini gösterir (`faizKurali`, modelin `pol_step` formülü). Kural kapalıyken politika faizi yoktur, hesap gösterilmez.
 */
export function FaizHesaplayici({ registry, draft }: { registry: Registry; draft: ValuesPatch }) {
  const uid = useId();
  const [g, setG] = useState<Girdi>(BASLANGIC);
  const p = faizParametreleri(registry, draft);
  const baslik = (
    <>
      <h4 id={`${uid}-baslik`} className={styles.bolumBaslik}>{t("sart.faiz.baslik")}</h4>
      <span className={styles.etiket}>{t("sart.faiz.etiket")}</span>
    </>
  );
  if (p === null) {
    return (
      <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
        {baslik}
        <p className={styles.metin}>{t("sart.faiz.eksik")}</p>
      </section>
    );
  }
  if (!p.on) {
    return (
      <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
        {baslik}
        <p className={styles.metin}>{t("sart.faiz.kapali")}</p>
      </section>
    );
  }
  const girdi = { infl: g.infl / 100, unemp: g.unemp / 100, cd: g.cd, idle: g.idle / 100 };
  const hedef = hedefFaiz(p, girdi) ?? p.neut;
  const haftalik = (x: number): string => formatValue(HAFTALIK, x * 100, registry.units);
  const yuzde = (x: number): string => formatValue(YUZDE(100, 1), x, registry.units);
  const seri = EGRI_ENFLASYON.map((i) => (hedefFaiz(p, { ...girdi, infl: i / 100 }) ?? p.neut) * 100);
  const girdiAlani = (anahtar: keyof Girdi, control: NumberControl) => (
    <SayiGirdisi
      id={`${uid}-${anahtar}`} label={t(`sart.faiz.girdi.${anahtar}`)} control={control} value={g[anahtar]} words={registry.units}
      disabled={false} onChange={(v) => setG((o) => ({ ...o, [anahtar]: v }))}
    />
  );
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      {baslik}
      <p className={styles.metin}>{t(p.cd ? "sart.faiz.formul.cd" : "sart.faiz.formul.bosta")}</p>
      <p className={styles.kucuk}>{t("sart.faiz.yalniz_deneme")}</p>
      <div className={styles.girdiler}>
        {girdiAlani("infl", YUZDE(20, 0.5))}
        {girdiAlani("unemp", YUZDE(50, 1))}
        {p.cd ? girdiAlani("cd", ORAN) : girdiAlani("idle", YUZDE(100, 5))}
      </div>
      <Stack gap="8">
        <p className={styles.sonuc} role="status">
          {t("sart.faiz.sonuc", { infl: yuzde(g.infl), unemp: yuzde(g.unemp), faiz: haftalik(hedef) })}
        </p>
        {hedef >= p.max - EPS ? <p className={styles.kucuk}>{t("sart.faiz.kirpildi_tavan")}</p> : null}
        {hedef <= p.min + EPS ? <p className={styles.kucuk}>{t("sart.faiz.kirpildi_taban")}</p> : null}
        <p className={styles.metin}>{t("sart.faiz.adim", { n: numberText(p.step * 100) })}</p>
      </Stack>
      <LineChart series={[{ id: "faiz", labelKey: "sart.faiz.seri", values: seri, styleIndex: 0 }]} yDomain={[p.min * 100, p.max * 100]} titleKey="sart.faiz.grafik" />
      <p className={styles.kucuk}>{t("sart.faiz.grafik_not")}</p>
    </section>
  );
}
