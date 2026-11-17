"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { Grid } from "@/components/primitives/Grid";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName, codePoints, MAX_CITY_NAME, MAX_WORLD_NAME, normalizeName, randomNames, type Rng } from "@/oyun/lib/names";
import type { WorldInfo } from "@/oyun/sim/types";
import { CITY_COUNT, type KurucuTaslak } from "./useKurucuTaslak";
import styles from "./Kurucu.module.css";

type Props = {
  taslak: KurucuTaslak;
  guncelle(patch: Partial<KurucuTaslak>): void;
  /** Test kancası: rastgele sayı kaynağı; verilmezse `Math.random`. */
  randomSource?: Rng;
  /** Şehir profili (S5): kaynak ve uzman sektörler; kayıt kaynağında yoktur. */
  world?: WorldInfo;
  /** Canlı kaynakta kayıt dili kullanılmaz. */
  canli?: boolean;
};

/** Adım 0: dünya adı, beş şehir adı ve "Rastgele isim". */
export function Adim0Adlandir({ taslak, guncelle, randomSource, world, canli }: Props) {
  const uid = useId();
  const [duyuru, setDuyuru] = useState("");
  const aciklamaId = `${uid}-rastgele`;
  const nameTooLong = codePoints(normalizeName(taslak.name)) > MAX_WORLD_NAME;

  /** Elle düzenleme duyuruyu bayatlatır: temizlenir. */
  const duzenle = (patch: Partial<KurucuTaslak>) => {
    setDuyuru("");
    guncelle(patch);
  };

  const doldur = () => {
    const secim = randomNames(randomSource, { world: taslak.name, cities: taslak.cities });
    guncelle({ name: secim.world, cities: secim.cities });
    setDuyuru(t("kurucu.rastgele.duyuru", { dunya: secim.world }));
  };

  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.baslik}>
        {t("kurucu.adim0.ad")}
      </h3>
      <p className={styles.metin}>{t("kurucu.adim0.giris")}</p>
      <div className={styles.rastgele}>
        <Button variant="secondary" aria-describedby={aciklamaId} onClick={doldur}>
          {t("kurucu.rastgele_isim")}
        </Button>
        <p id={aciklamaId} className={styles.kucuk}>
          {t("kurucu.rastgele_aciklama")}
        </p>
        <p aria-live="polite" className={styles.kucuk}>
          {duyuru}
        </p>
      </div>
      <Field
        kind="input"
        id={`${uid}-ad`}
        label={t("kurucu.ad_etiket")}
        value={taslak.name}
        error={nameTooLong ? t("kurucu.ad_hata") : undefined}
        onChange={(e) => duzenle({ name: e.target.value })}
      />
      <Grid minItem="220" gap="16">
        {taslak.cities.map((value, i) => {
          const profil = world?.cities.find((c) => c.index === i);
          // Canlıda boş liste "şehrin özel kaynağı yok" demektir; kayıt kaynağında (`world` yok) bilgi kayıtlarda bulunmaz.
          const liste = (xs: string[], bos: CopyKey): string => (xs.length > 0 ? xs.join(", ") : t(world ? bos : canli ? "kurucu.sehir.bilgi_yok" : "kurucu.sehir.yok"));
          // Nüfus payı modelde eşittir (şehir başına aynı sayıda oyuncu): profil yoksa da beş şehre eşit bölünür.
          const pay = Math.round((profil?.population_share ?? 1 / CITY_COUNT) * 100);
          return (
            <div key={i} className={styles.sehir}>
              <Field
                kind="input"
                id={`${uid}-sehir-${i}`}
                label={t("kurucu.sehir_etiket", { n: i + 1 })}
                value={value}
                placeholder={cityDisplayName("", i)}
                error={codePoints(normalizeName(value)) > MAX_CITY_NAME ? t("kurucu.sehir_hata") : undefined}
                onChange={(e) => duzenle({ cities: taslak.cities.map((c, j) => (j === i ? e.target.value : c)) })}
              />
              <DefinitionList
                items={[
                  { term: t("kurucu.sehir.kaynak"), detail: liste(profil?.resources.map((r) => r.label) ?? [], "kurucu.sehir.kaynak_yok") },
                  { term: t("kurucu.sehir.uzmanlasma"), detail: liste(profil?.specialties.map((x) => x.label) ?? [], "kurucu.sehir.uzman_yok") },
                  { term: t("kurucu.sehir.nufus"), detail: t("kurucu.sehir.pay", { n: pay }) },
                ]}
              />
              <p className={styles.kucuk}>{t("kurucu.sehir.kilit")}</p>
            </div>
          );
        })}
      </Grid>
    </section>
  );
}
