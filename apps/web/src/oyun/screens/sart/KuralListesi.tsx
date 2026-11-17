"use client";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { Grid } from "@/components/primitives/Grid";
import { t } from "@/oyun/copy/t";
import { same } from "@/oyun/sim/hints";
import type { Availability, Registry, RegistryCard, SettingAvail, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { GecisDestegiKarti, isGecisSecenegi } from "@/oyun/screens/ortak/GecisDestegiKarti";
import { RuleCard } from "@/oyun/ui/RuleCard";
import { degisebilir, kartDurumu, type KartDurumu, type SartGrubu, type SartKipi } from "./sartMantik";
import styles from "./Sart.module.css";

export const kartKimligi = (uid: string, id: string): string => `${uid}-kart-${id}`;

/** Kartın standart gövdesine özel eklentiler (özel bölümler): üst eylem satırı ve denetimin yerine geçen bileşen. */
export type KartEki = {
  eylemler?: ReactNode;
  kontrol?: (p: { disabled: boolean; labelledBy: string; describedBy?: string }) => ReactNode;
  /** Kartın altında canlı hesap satırı (ör. nüfus toplamları). */
  alt?: ReactNode;
};

type KartProps = {
  uid: string;
  card: RegistryCard;
  registry: Registry;
  base: ValuesPatch;
  draft: ValuesPatch;
  mode: SartKipi;
  settings: SettingAvail[];
  durationWeeks: number;
  seciliId: string | null;
  onChange(id: string, v: UIValue): void;
  onReset(id: string): void;
  /** Geçiş desteği kartı Adım 1 ile aynı bileşenle (kullanılabilirlik engeli ve eski ölçüm notu dahil) çizilir. */
  gecis?: { availability: Availability };
  ek?: KartEki;
};

/** Tek kural kartı: "Değişti" şeridi, (varsa) özel eylemler ve kartın gövdesi. */
export function KartGosterimi({ uid, card, registry, base, draft, mode, settings, durationWeeks, seciliId, onChange, onReset, gecis, ek }: KartProps) {
  const durum = kartDurumu(card, mode, settings.find((s) => s.id === card.id));
  const value = card.id in draft ? draft[card.id]! : card.default;
  const baseValue = card.id in base ? base[card.id]! : card.default;
  const changed = degisebilir(durum, card) && !same(card.kind, value, baseValue);
  return (
    <div id={kartKimligi(uid, card.id)} className={styles.kart} data-secili={seciliId === card.id ? "true" : undefined}>
      {changed || ek?.eylemler ? (
        <div className={styles.kartUst}>
          {changed ? (
            <>
              <span className={styles.degisti}>{t("sart.degisti")}</span>
              <Button variant="secondary" size="sm" onClick={() => onReset(card.id)}>
                {t("sart.sifirla")}
              </Button>
            </>
          ) : null}
          {ek?.eylemler}
        </div>
      ) : null}
      {card.id === "gecis_destegi" && gecis && durum.state === "active" && isGecisSecenegi(value) ? (
        <GecisDestegiKarti value={value} availability={gecis.availability} headingLevel={4} onChange={(v) => onChange(card.id, v)} />
      ) : (
        <RuleCard
          card={card} registry={registry} value={value} draft={draft} durationWeeks={durationWeeks} headingLevel={4}
          state={durum.state} {...(durum.lockReason ? { lockReason: durum.lockReason } : {})} {...(ek?.kontrol ? { kontrol: ek.kontrol } : {})}
          onChange={(v) => onChange(card.id, v)}
        />
      )}
      {ek?.alt}
    </div>
  );
}

type Props = Omit<KartProps, "card" | "ek"> & {
  group: SartGrubu;
  uzmanAcik: boolean;
  onUzman(): void;
  /** Özel bölümlerin kart eklentisi (kimliğe göre). */
  ek?: (card: RegistryCard, durum: KartDurumu, value: UIValue) => KartEki | undefined;
};

/** Seçili grubun kartları: ana ayarlar her zaman, uzman ayarları düğmeyle açılana kadar yok (DOM'da da yok). */
export function KuralListesi({ group, uzmanAcik, onUzman, ek, ...rest }: Props) {
  const listId = useId();
  const ana = group.cards.filter((c) => c.level !== "U");
  const uzman = group.cards.filter((c) => c.level === "U");
  const goster = (card: RegistryCard): ReactNode => {
    const durum = kartDurumu(card, rest.mode, rest.settings.find((s) => s.id === card.id));
    const value = card.id in rest.draft ? rest.draft[card.id]! : card.default;
    const eki = ek?.(card, durum, value);
    return <KartGosterimi key={card.id} card={card} {...rest} {...(eki ? { ek: eki } : {})} />;
  };
  return (
    <div className={styles.liste}>
      {group.hint ? <p className={styles.bilgi}>{group.hint}</p> : null}
      {ana.length === 0 && uzman.length === 0 ? <p className={styles.bilgi}>{t("sart.grup_bos")}</p> : null}
      {ana.length > 0 ? <Grid minItem="320" gap="16">{ana.map(goster)}</Grid> : null}
      {uzman.length > 0 ? (
        <>
          <div className={styles.uzmanSatiri}>
            <span id={`${listId}-baslik`} className={styles.uzmanBaslik}>
              {t("sart.uzman_baslik")}
            </span>
            <Button variant="secondary" size="sm" aria-expanded={uzmanAcik} aria-controls={listId} aria-describedby={`${listId}-baslik`} onClick={onUzman}>
              {t(uzmanAcik ? "sart.uzman_gizle" : "sart.uzman_goster", { n: uzman.length })}
            </Button>
          </div>
          <div id={listId}>{uzmanAcik ? <Grid minItem="320" gap="16">{uzman.map(goster)}</Grid> : null}</div>
        </>
      ) : null}
    </div>
  );
}
