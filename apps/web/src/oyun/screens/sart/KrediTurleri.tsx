"use client";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import type { RegistryCard, UIValue } from "@/oyun/sim/types";
import { KartGosterimi, type KartEki } from "./KuralListesi";
import { KrediMenusu } from "./KrediMenusu";
import { degisebilir, kartDurumu } from "./sartMantik";
import { krediBolumleri } from "./ozelMantik";
import styles from "./SartOzel.module.css";

/** Kendi kredi varyantı taslağı: modelde karşılığı yok, yalnız arayüzde durur ve koşuya gönderilmez. */
export type KrediVaryanti = { id: string; kaynak: string; ad: string };

type Ortak = Omit<Parameters<typeof KartGosterimi>[0], "card" | "ek">;

type Props = Ortak & {
  cards: RegistryCard[];
  varyantlar: KrediVaryanti[];
  onVaryantEkle(kaynakId: string): void;
  onVaryantAd(id: string, ad: string): void;
  onVaryantSil(id: string): void;
  /** Uzman kartları: `cards` yalnız görünenleri taşır; düğme gizli olanları açar. */
  uzmanSayisi: number;
  uzmanAcik: boolean;
  onUzman(): void;
  /** Bölümün üstüne (kredi türlerinden önce) giren içerik: ör. kuruluş fonu uyarısı. */
  ust?: ReactNode;
};

/**
 * Kredi grubu: önce ortak kredi kuralları, sonra A-D türleri (her tür bir `AlanlarKarti` kartı) ve her türün menüsü
 * ("Varsayılana döndür", "Kendi varyantına kopyala"). Varyant pasiftir: kopya taslak olarak görünür, "Modelde henüz yok" yazar, koşuya gönderilmez.
 */
export function KrediTurleri({ cards, varyantlar, onVaryantEkle, onVaryantAd, onVaryantSil, uzmanSayisi, uzmanAcik, onUzman, ust, ...ortak }: Props) {
  const uid = useId();
  const b = krediBolumleri(cards);
  const ekle = (card: RegistryCard): KartEki | undefined => {
    if (!card.credit_type) return undefined;
    const durum = kartDurumu(card, ortak.mode, ortak.settings.find((s) => s.id === card.id));
    const donulebilir = degisebilir(durum, card);
    return {
      eylemler: (
        <KrediMenusu
          ad={card.title} varsayilanaDonulebilir={donulebilir}
          onSifirla={() => ortak.onChange(card.id, card.default as UIValue)} onKopyala={() => onVaryantEkle(card.id)}
        />
      ),
    };
  };
  const goster = (card: RegistryCard): ReactNode => {
    const eki = ekle(card);
    return <KartGosterimi key={card.id} card={card} {...ortak} {...(eki ? { ek: eki } : {})} />;
  };
  const adOf = (id: string): string => cards.find((c) => c.id === id)?.title ?? id;
  return (
    <Stack gap="16">
      <p className={styles.kucuk}>{t("sart.kredi.giris")}</p>
      {ust}
      {b.ortak ? goster(b.ortak) : null}
      {b.gruplar.map((g) => (
        <section key={g.id} className={styles.altGrup} aria-labelledby={`${uid}-${g.id}`}>
          <p id={`${uid}-${g.id}`} className={styles.altBaslik}>{t(`sart.kredi.grup.${g.id}` as CopyKey)}</p>
          <Grid minItem="320" gap="16">{g.cards.map(goster)}</Grid>
          {g.id === "C" ? <p className={styles.kucuk}>{t("sart.kredi.not_c")}</p> : null}
        </section>
      ))}
      {b.diger.length > 0 ? (
        <section className={styles.altGrup} aria-labelledby={`${uid}-diger`}>
          <p id={`${uid}-diger`} className={styles.altBaslik}>{t("sart.kredi.grup.diger")}</p>
          <Grid minItem="320" gap="16">{b.diger.map(goster)}</Grid>
        </section>
      ) : null}
      {b.varyant ? goster(b.varyant) : null}
      {uzmanSayisi > 0 ? (
        <div className={styles.eylemSatiri}>
          <span id={`${uid}-uzman`} className={styles.altBaslik}>{t("sart.uzman_baslik")}</span>
          <Button variant="secondary" size="sm" aria-expanded={uzmanAcik} aria-describedby={`${uid}-uzman`} onClick={onUzman}>
            {t(uzmanAcik ? "sart.uzman_gizle" : "sart.uzman_goster", { n: uzmanSayisi })}
          </Button>
        </div>
      ) : null}
      {varyantlar.length > 0 ? (
        <section className={styles.altGrup} aria-labelledby={`${uid}-varyantlar`}>
          <p id={`${uid}-varyantlar`} className={styles.altBaslik}>{t("sart.kredi.varyant_baslik")}</p>
          <p className={styles.kucuk}>{t("sart.kredi.varyant_bilgi")}</p>
          {varyantlar.map((v) => (
            <div key={v.id} className={styles.varyant}>
              <Stack gap="8" direction="row" wrap align="center">
                <span className={styles.etiket}>{t("sart.kredi.varyant_modelde_yok")}</span>
                <span className={styles.etiket}>{t("sart.kredi.varyant_taslak")}</span>
              </Stack>
              <Field kind="input" id={`${uid}-ad-${v.id}`} label={t("sart.kredi.varyant_ad")} type="text" autoComplete="off" maxLength={60} value={v.ad} onChange={(e) => onVaryantAd(v.id, e.target.value)} />
              <p className={styles.kucuk}>{t("sart.kredi.varyant_kaynak", { tur: adOf(v.kaynak) })}</p>
              <Button variant="secondary" size="sm" onClick={() => onVaryantSil(v.id)}>
                {t("sart.kredi.varyant_sil")}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
    </Stack>
  );
}
