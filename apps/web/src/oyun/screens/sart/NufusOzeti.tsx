"use client";
import { useId } from "react";
import { t } from "@/oyun/copy/t";
import { numberText } from "@/oyun/sim/formatValue";
import { useSecPerWeekP50 } from "@/oyun/sim/hizBilgisi";
import { SEHIR_SAYISI, akceMetni, nufusHesabi, tahminiSaniye } from "@/oyun/sim/nufus";
import type { Registry, ValuesPatch } from "@/oyun/sim/types";
import styles from "./SartOzel.module.css";

/** Hafta başına bu süreyi aşan tahmin "belirgin biçimde yavaş" sayılır (varsayılan dünya yaklaşık 0,5-0,7 sn). */
const YAVAS_SN = 1.2;

const sureMetni = (sn: number): string => {
  if (sn < 90) return t("sart.nufus.sure.saniye", { n: Math.max(1, Math.round(sn)) });
  if (sn < 5400) return t("sart.nufus.sure.dakika", { n: Math.round(sn / 60) });
  return t("sart.nufus.sure.saat", { n: numberText(Math.round(sn / 360) / 10) });
};

/** Dünya grubunun altında: toplam nüfus, başlangıç kasası ve açıkça "tahmini" etiketli hız. Simülasyonu etkilemez. */
export function NufusOzeti({ registry, draft, durationWeeks }: { registry: Registry; draft: ValuesPatch; durationWeeks: number }) {
  const uid = useId();
  const p50 = useSecPerWeekP50();
  const n = nufusHesabi(registry, draft);
  if (n === null) return null;
  const sn = tahminiSaniye(p50, n.oyuncu);
  const akce = (x: number): string => akceMetni(registry, x);
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      <h4 id={`${uid}-baslik`} className={styles.bolumBaslik}>{t("sart.nufus.baslik")}</h4>
      <p className={styles.metin} role="status">
        {t("sart.nufus.nufus", { toplam: numberText(n.toplam), oyuncu: numberText(n.oyuncu), npc: numberText(n.npc) })}
      </p>
      {n.kasa > 0 ? <p className={styles.metin}>{t("sart.nufus.kasa", { kasa: akce(n.kasa), toplam: akce(n.kasa * SEHIR_SAYISI) })}</p> : null}
      <p className={styles.metin} role="status">
        {sn === null ? t("sart.nufus.hiz_yok") : t("sart.nufus.hiz", { sn: numberText(Math.round(sn * 10) / 10), hafta: durationWeeks, sure: sureMetni(sn * durationWeeks) })}
      </p>
      {sn !== null && sn >= YAVAS_SN ? <p className={styles.kucuk}>{t("sart.nufus.yavas")}</p> : null}
      <p className={styles.kucuk}>{t("sart.nufus.hiz_not")}</p>
    </section>
  );
}
