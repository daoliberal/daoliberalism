"use client";
import { useId } from "react";
import { Card } from "@/components/primitives/Card";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { formatValue } from "@/oyun/sim/formatValue";
import type { Registry, RegistryCard, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { Rozet } from "@/oyun/ui/Rozet";
import { RuleCard } from "@/oyun/ui/RuleCard";
import { etkisizKosullari, guncelDeger, ozelAcikMi, ozelYama, OZEL_SENARYO } from "./insanlarMantik";
import styles from "./Insanlar.module.css";

type Props = {
  registry: Registry;
  cards: RegistryCard[];
  scenarioId: string | null;
  /** Özel senaryonun yaması (kart -> değer). */
  ozelDegerler: ValuesPatch;
  /** Şart taslağı: `effective_when` koşulları buna göre değerlendirilir; ölçüm ipucu geçerliliği de. */
  sart: ValuesPatch;
  durationWeeks: number;
  onOzel(next: ValuesPatch): void;
  /** Kartın sayfadaki kimliği (aramadan gidiş için). */
  kimlik(id: string): string;
};

/** Salt okunur dünya varsayımı kartı: kontrol yok; değer "şu anki varsayım" olarak yazılır. */
function VKarti({ registry, card, deger, sart }: { registry: Registry; card: RegistryCard; deger: UIValue; sart: ValuesPatch }) {
  const uid = useId();
  const baslikId = `${uid}-baslik`;
  const etkisiz = etkisizKosullari(registry, card, sart);
  const gercek = card.shows ?? [];
  return (
    <Card as="article" gap="14" aria-labelledby={baslikId}>
      <Stack gap="8" direction="row" wrap align="center">
        <h4 id={baslikId} className={styles.kartBaslik} tabIndex={-1}>{card.title}</h4>
        {card.status === "experimental" ? <Rozet kind="experimental" /> : null}
        {card.status === "passive" || card.apply === "passive" ? <Rozet kind="passive" /> : null}
      </Stack>
      <dl className={styles.dl}>
        {card.shows === undefined || card.shows.length === 0 ? (
          <div className={styles.dlSatir}>
            <dt className={styles.dt}>{t("insanlar.simdiki")}</dt>
            <dd className={styles.dd}><strong className={styles.degerMetni}>{formatValue(card.control, deger, registry.units)}</strong></dd>
          </div>
        ) : null}
        <div className={styles.dlSatir}>
          <dt className={styles.dt}>{t("card.what")}</dt>
          <dd className={styles.dd}>{card.what}</dd>
        </div>
        <div className={styles.dlSatir}>
          <dt className={styles.dt}>{t("card.changes")}</dt>
          <dd className={styles.dd}>{card.changes}</dd>
        </div>
        {card.hint !== undefined || gercek.length > 0 ? (
          <div className={styles.dlSatir}>
            <dt className={styles.dt}>{t("insanlar.gercek")}</dt>
            <dd className={styles.dd}>
              {card.hint !== undefined ? <span>{card.hint}</span> : null}
              {gercek.map((row, i) => (
                <span key={i}>{row.label ? <span className={styles.not}>{row.label}</span> : null} <strong>{row.text}</strong></span>
              ))}
            </dd>
          </div>
        ) : null}
        {card.basis ? (
          <div className={styles.dlSatir}>
            <dt className={styles.dt}>{t("kart.dayanak")}</dt>
            <dd className={styles.dd}>
              {card.basis.label}
              {card.basis.note ? <span className={styles.not}>{card.basis.note}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {card.warning ? <Banner tone="warn" asItem>{card.warning}</Banner> : null}
      {etkisiz.length > 0 ? (
        <p className={styles.etkisiz}>
          {t("insanlar.etkisiz", { kosul: etkisiz.map((e) => t("insanlar.etkisiz_kosul", { ad: e.kart.title, deger: formatValue(e.kart.control, e.deger, registry.units) })).join("; ") })}
        </p>
      ) : null}
    </Card>
  );
}

/** Bir aktörün kartları. Özel senaryoda `scenario_editable` ve doğrulanmış kartlar `RuleCard` ile açılır (etiket "Senaryo"); ötekiler salt okunur kalır. */
export function Aktor({ registry, cards, scenarioId, ozelDegerler, sart, durationWeeks, onOzel, kimlik }: Props) {
  const ozel = scenarioId === OZEL_SENARYO;
  return (
    <Grid minItem="320" gap="16">
      {cards.map((card) => {
        const deger = guncelDeger(registry, card, scenarioId, ozelDegerler);
        if (ozel && card.scenario_editable) {
          // `apply: unknown` kart da RuleCard ile çizilir ama kilitli ve nedenli (DK-17); denetim yalnız açık olanda etkindir.
          const acik = ozelAcikMi(card);
          return (
            <div key={card.id} id={kimlik(card.id)} className={styles.sarmal}>
              <span className={styles.senaryoEtiketi}>{t("insanlar.senaryo_etiketi")}</span>
              <RuleCard
                card={card} registry={registry} value={deger} draft={sart} durationWeeks={durationWeeks} headingLevel={4}
                state={acik ? "active" : "locked"} {...(acik ? {} : { lockReason: card.apply === "unknown" ? ("unverified" as const) : ("fixed" as const) })}
                onChange={(v) => onOzel(ozelYama(card, ozelDegerler, v))}
              />
            </div>
          );
        }
        return <div key={card.id} id={kimlik(card.id)}><VKarti registry={registry} card={card} deger={deger} sart={sart} /></div>;
      })}
    </Grid>
  );
}
