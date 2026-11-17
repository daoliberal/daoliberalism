"use client";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { RegistryControl } from "@/oyun/sim/types";
import styles from "./SartOzel.module.css";

type ListControl = Extract<RegistryControl, { type: "order" | "multi" }>;

/**
 * Gider öncelik sırası: modelde SIRA yoktur, üyelik kümesi vardır. Listedeki kalem şehrin yıllık basım izninin tamamını,
 * listede olmayan yarısını kullanır; listedekilerin kendi aralarındaki sıra sonucu değiştirmez. Bu yüzden kalemler iki gruba ayrılır
 * ("tamamını" ve "yarısını"), her kalem düğmeyle öbür gruba geçer; yukarı/aşağı taşıma yoktur.
 * Kartın türü `order` ise (boş liste geçersiz) son kalem çıkarılamaz; `multi` ise boş liste geçerlidir.
 */
export function ButceSirasi({ kind, control, value, disabled, labelledBy, describedBy, onChange }: {
  kind: "order" | "multi" | string;
  control: ListControl;
  value: string[];
  disabled: boolean;
  labelledBy: string;
  describedBy?: string;
  onChange(v: string[]): void;
}) {
  const uyeler = control.items.filter((i) => value.includes(i.value));
  const disarida = control.items.filter((i) => !value.includes(i.value));
  const sonKalem = kind === "order" && uyeler.length <= 1;
  // `order` türünde mevcut sıra korunur (yeni kalem sona); `multi`de kartın öğe sırası.
  const al = (v: string): void => onChange(kind === "order" ? [...value, v] : control.items.filter((i) => i.value === v || value.includes(i.value)).map((i) => i.value));
  const cikar = (v: string): void => onChange(value.filter((x) => x !== v));
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className={styles.altGrup}>
      <section className={styles.altGrup} aria-label={t("sart.butce.tam")}>
        <p className={styles.altBaslik}>{t("sart.butce.tam")}</p>
        {uyeler.length === 0 ? <p className={styles.kucuk}>{t("sart.butce.bos")}</p> : null}
        <ul className={styles.liste}>
          {uyeler.map((i) => (
            <li key={i.value} className={styles.oge}>
              <span className={styles.ogeAd}>{i.label}</span>
              <Button variant="secondary" size="sm" disabled={disabled || sonKalem} aria-label={t("sart.butce.yarima_indir", { ad: i.label })} onClick={() => cikar(i.value)}>
                {t("sart.butce.dugme_yarima")}
              </Button>
            </li>
          ))}
        </ul>
        {sonKalem && !disabled && uyeler.length === 1 ? <p className={styles.kucuk}>{t("sart.butce.son_kalem")}</p> : null}
      </section>
      <section className={styles.altGrup} aria-label={t("sart.butce.yarim")}>
        <p className={styles.altBaslik}>{t("sart.butce.yarim")}</p>
        {disarida.length === 0 ? <p className={styles.kucuk}>{t("sart.butce.bos")}</p> : null}
        <ul className={styles.liste}>
          {disarida.map((i) => (
            <li key={i.value} className={styles.oge}>
              <span className={styles.ogeAd}>{i.label}</span>
              <Button variant="secondary" size="sm" disabled={disabled} aria-label={t("sart.butce.tama_al", { ad: i.label })} onClick={() => al(i.value)}>
                {t("sart.butce.dugme_tama")}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <p className={styles.kucuk}>{t("sart.butce.sira_yok")}</p>
      <p className={styles.kucuk}>{t("sart.butce.hic")}</p>
    </div>
  );
}
