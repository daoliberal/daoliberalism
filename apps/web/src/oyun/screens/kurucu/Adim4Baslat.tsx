"use client";
import { useId } from "react";
import { Banner } from "@/oyun/ui/Banner";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { Grid } from "@/components/primitives/Grid";
import { t } from "@/oyun/copy/t";
import { KilitliKart } from "@/oyun/screens/ortak/KilitliKart";
import type { SettingId } from "@/oyun/ui/SettingCard";
import type { CopyKey } from "@/oyun/copy/t";
import styles from "./Kurucu.module.css";

type Props = {
  /** Şablondan farklı kurallar (kart adı ve biçimlenmiş değer). */
  kurallar: { id: string; ad: string; deger: string }[];
  sablon: string;
  /** Dünya senaryosunun adı; Şart'a girmez. */
  senaryo: string;
  sure: number;
  dunya: string;
  hedefler: string[];
  /** Kayıtta olmayan ya da düzenlenemeyen ve Başlat'ta gönderilmeyecek değer sayısı. */
  suzulen: number;
  /** Kayıt kartı yokken (kayıt kaynağı) sabit kalan kurallar. */
  sabitKurallar: { settingId: string; valueKey: CopyKey; valueText?: string }[];
  canli: boolean;
};

/** Adım 4 (Özet): Başlat'tan önce seçimlerin dökümü. Kontrat önizlemesi ve zincire işleme yoktur (DK-1). */
export function Adim4Baslat({ kurallar, sablon, senaryo, sure, dunya, hedefler, suzulen, sabitKurallar, canli }: Props) {
  const uid = useId();
  return (
    <>
      <p className={styles.metin}>{t("kurucu.adim4.giris")}</p>
      <section className={styles.bolum} aria-labelledby={`${uid}-kurulum`}>
        <h3 id={`${uid}-kurulum`} className={styles.baslik}>
          {t("kurucu.adim4.kurulum_baslik")}
        </h3>
        <DefinitionList
          items={[
            { term: t("kurucu.adim4.sablon"), detail: sablon },
            { term: t("kurucu.adim4.senaryo"), detail: t("kurucu.adim4.senaryo_deger", { ad: senaryo }) },
            { term: t("kurucu.adim4.sure"), detail: t("kurucu.adim3.sure_hafta", { n: sure }) },
            { term: t("kurucu.adim4.dunya"), detail: dunya },
            { term: t("kurucu.adim4.hedefler"), detail: hedefler.length > 0 ? hedefler.join("; ") : t("kurucu.adim4.hedef_yok") },
          ]}
        />
      </section>

      <section className={styles.bolum} aria-labelledby={`${uid}-kurallar`}>
        <h3 id={`${uid}-kurallar`} className={styles.baslik}>
          {t("kurucu.adim4.kurallar_baslik")}
        </h3>
        {kurallar.length > 0 ? (
          <>
            <p className={styles.kucuk}>{t("kurucu.adim4.kural_degisti", { n: kurallar.length })}</p>
            <DefinitionList items={kurallar.map((k) => ({ term: k.ad, detail: k.deger }))} />
          </>
        ) : (
          <p className={styles.metin}>{t("kurucu.adim4.kural_yok")}</p>
        )}
        {suzulen > 0 ? <Banner tone="warn">{t("kurucu.adim4.suzulen", { n: suzulen })}</Banner> : null}
      </section>

      {sabitKurallar.length > 0 ? (
        <section className={styles.bolum} aria-labelledby={`${uid}-sabit`}>
          <h3 id={`${uid}-sabit`} className={styles.baslik}>
            {t(canli ? "kurucu.sabit_baslik.live" : "kurucu.sabit_baslik")}
          </h3>
          <Grid minItem="320" gap="16">
            {sabitKurallar.map((r) => (
              <KilitliKart key={r.settingId} settingId={r.settingId as SettingId} valueKey={r.valueKey} valueText={r.valueText} />
            ))}
          </Grid>
        </section>
      ) : null}
    </>
  );
}
