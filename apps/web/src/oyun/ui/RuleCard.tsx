import { useId, type ReactNode } from "react";
import { Card } from "@/components/primitives/Card";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { hintVisible } from "@/oyun/sim/hints";
import type { Registry, RegistryCard, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { AlanlarKarti } from "./AlanlarKarti";
import { Banner } from "./Banner";
import { CokluSecim } from "./CokluSecim";
import { Rozet, type RozetKind } from "./Rozet";
import styles from "./RuleCard.module.css";
import { SayiGirdisi } from "./SayiGirdisi";
import { SecenekGrubu } from "./SecenekGrubu";
import { SiraKarti } from "./SiraKarti";

export type LockReason = "locked" | "no_recording" | "start_only" | "unverified" | "passive" | "fixed" | "no_cash_floor";
export type RuleCardState = "active" | "locked" | "passive";

export type RuleCardProps = {
  card: RegistryCard;
  /** Birim sözcükleri ve ipucu kuralı için kayıt (şablonlar, öteki kartların varsayılanı). */
  registry: Registry;
  value: UIValue;
  /** Taslağın bütün değerleri (kart kimliği -> değer); eksik kart varsayılandadır. Ölçüm ipucu geçerliliği buna bakar. */
  draft: ValuesPatch;
  durationWeeks: number;
  onChange(v: UIValue): void;
  state: RuleCardState;
  lockReason?: LockReason;
  /** Yoğun görünüm: "Bu ne demek", "Oyunda neyi değiştirir" ve dayanak satırları gizlenir. */
  compact?: boolean;
  /** Başlık düzeyi; kartlar bir grup başlığının altındaysa 4. Varsayılan 3. */
  headingLevel?: 3 | 4;
  /** Denetimin yerine geçen özel bileşen (başlık, açıklama ve kilit metni kartta kalır). `labelledBy` kart başlığıdır. */
  kontrol?: (p: { disabled: boolean; labelledBy: string; describedBy?: string }) => ReactNode;
};

/** Kilit nedeni metni; her neden kendi metnini gösterir ("kayıt yok" yalnız kayıtsız ayara aittir). */
export function lockReasonText(reason: LockReason): string {
  switch (reason) {
    case "no_recording": return t("kart.kayit_yok");
    case "unverified": return t("kart.dogrulanmadi");
    case "passive": return t("kart.pasif_kilit");
    case "fixed": return t("sart.kilit_sabit");
    case "no_cash_floor": return t("lock.kasa_tabani_yok");
    case "locked":
    case "start_only": return t("lock.yeni_kosu");
  }
}

/** Gerçek durum: canlılığı bilinmeyen (`unknown`) kart her yerde kilitli, modelde olmayan (`passive`) kart pasiftir (DK-17). */
function effective(card: RegistryCard, state: RuleCardState, lockReason?: LockReason): { state: RuleCardState; reason?: LockReason } {
  if (card.apply === "unknown") return { state: "locked", reason: lockReason ?? "unverified" };
  if (card.status === "passive" || card.apply === "passive" || state === "passive") return { state: "passive", reason: "passive" };
  if (state === "locked") return { state: "locked", reason: lockReason ?? "locked" };
  return { state: "active" };
}

/** Salt okunur bilgi kartı: etkin, düzenlenemez ve ya gösterilen satırları ya da ayar parametresi yok (pasif değildir, kilit nedeni taşımaz). */
export const isInfoCard = (card: RegistryCard): boolean => !card.editable && card.status === "active" && ((card.shows?.length ?? 0) > 0 || card.params.length === 0);

const asList = (v: UIValue): string[] => (Array.isArray(v) ? v : []);

/** Veriden üretilen genel kural kartı: kayıttaki bir kartı `kind`'ına göre çizer; yeni kart kod değişmeden görünür. */
export function RuleCard({ card, registry, value, draft, durationWeeks, onChange, state, lockReason, compact, headingLevel = 3, kontrol }: RuleCardProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const uid = useId();
  const titleId = `${uid}-baslik`;
  const lockId = `${uid}-kilit`;
  const info = isInfoCard(card);
  const eff = info ? { state: "active" as const } : effective(card, state, lockReason);
  const disabled = eff.state !== "active";
  const lockText = eff.reason ? lockReasonText(eff.reason) : undefined;
  const measured = info || hintVisible(registry, card, draft, durationWeeks);
  const c = card.control;
  const inlineLock = c.type === "number"; // sayı girişinde neden ipucunda, öteki denetimlerde ayrı paragraf
  const describedBy = lockText && !inlineLock ? lockId : undefined;
  // odaklanabilir başlık kilit nedenine bağlanır (sayıda neden giriş kutusunun ipucundadır)
  const headingDescribedBy = !lockText ? undefined : inlineLock ? `${uid}-sayi-hint` : lockId;

  const badges: RozetKind[] = [];
  if (card.status === "experimental") badges.push("experimental");
  if (eff.state === "passive") badges.push("passive");
  if (!measured) badges.push("unmeasured");

  let control = null;
  if (!info) switch (c.type) {
    case "options":
      control = <SecenekGrubu options={c.options} value={value} disabled={disabled} labelledBy={titleId} describedBy={describedBy} onChange={onChange} />;
      break;
    case "number":
      control = (
        <SayiGirdisi
          id={`${uid}-sayi`} label={card.title} control={c} value={typeof value === "number" ? value : c.min} words={registry.units}
          disabled={disabled} lockText={lockText} onChange={onChange}
        />
      );
      break;
    case "fields":
      control = <AlanlarKarti legend={card.title} control={c} value={value} fallback={card.default} words={registry.units} disabled={disabled} describedBy={describedBy} onChange={onChange} />;
      break;
    case "order":
      control = <SiraKarti items={c.items} value={asList(value)} disabled={disabled} labelledBy={titleId} describedBy={describedBy} onChange={onChange} />;
      break;
    case "multi":
      control = <CokluSecim items={c.items} value={asList(value)} disabled={disabled} labelledBy={titleId} describedBy={describedBy} onChange={onChange} />;
      break;
  }

  if (!info && kontrol) control = kontrol({ disabled, labelledBy: titleId, describedBy });

  return (
    <Card as="article" gap="14" aria-labelledby={titleId}>
      <Stack gap="8" direction="row" wrap align="center">
        <Heading id={titleId} className={styles.baslik} tabIndex={disabled ? 0 : -1} aria-describedby={headingDescribedBy}>{card.title}</Heading>
        {card.level === "U" ? <span className={styles.uzman}>{t("kart.uzman")}</span> : null}
        {info ? <span className={styles.uzman}>{t("sart.salt_okunur")}</span> : null}
        {badges.map((b) => <Rozet key={b} kind={b} />)}
      </Stack>
      <dl className={styles.satirlar}>
        {compact ? null : (
          <>
            <div className={styles.satir}>
              <dt className={styles.etiket}>{t("card.what")}</dt>
              <dd className={styles.metin}>{card.what}</dd>
            </div>
            <div className={styles.satir}>
              <dt className={styles.etiket}>{t("card.changes")}</dt>
              <dd className={styles.metin}>{card.changes}</dd>
            </div>
          </>
        )}
        {info && card.hint === undefined ? null : (
          <div className={styles.satir}>
            <dt className={styles.etiket}>{t("card.hint")}</dt>
            <dd className={styles.metin}>{measured && card.hint !== undefined ? card.hint : t("kart.olculmedi")}</dd>
          </div>
        )}
        {!compact && card.basis ? (
          <div className={styles.satir}>
            <dt className={styles.etiket}>{t("kart.dayanak")}</dt>
            <dd className={styles.metin}>
              {card.basis.label}
              {card.basis.note ? <span className={styles.not}>{card.basis.note}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {card.shows && card.shows.length > 0 ? (
        <ul className={styles.gosterilen}>
          {card.shows.map((row, i) => (
            <li key={i} className={styles.gosterilenSatir}>
              {row.label ? <span className={styles.gosterilenEtiket}>{row.label}</span> : null}
              <strong className={styles.gosterilenDeger}>{row.text}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {card.warning ? <Banner tone="warn" asItem>{card.warning}</Banner> : null}
      {lockText && !inlineLock ? <p id={lockId} className={styles.kilit}>{lockText}</p> : null}
      {control}
    </Card>
  );
}
