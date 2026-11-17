import { t, type CopyKey } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { goster, ondalik, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; isLive: boolean };

/** İşgücü akışları (D10): NPC firmalarında haftalık işe alım ve ayrılma, iş bulma oranı, tahmini işsizlik süresi, işgücü dışına çıkanlar, belediyedeki NPC (dünya değerleri). */
export function IsgucuAkislariPaneli({ weeks, cur, isLive }: Props) {
  const w = cur?.world ?? null;
  const olculuyor = weeks.some((p) => sonlu(p.world.hires) || sonlu(p.world.job_finding_rate) || sonlu(p.world.npc_discouraged));
  const satir = (id: string, etiket: CopyKey, deger: string, not?: CopyKey) => (
    <div key={id} className={styles.olcu} data-akis={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>
        {deger}
        {not && sonlu(w?.unemployment_duration) ? <span className={styles.kucuk}> {t(not)}</span> : null}
      </dd>
    </div>
  );
  return (
    <section aria-label={t("canli.akis.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.akis.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.akis.alt")}</p>
      <dl className={styles.serit}>
        {satir("alim", "canli.akis.alim", goster(w?.hires, sayi))}
        {satir("ayrilma", "canli.akis.ayrilma", goster(w?.separations, sayi))}
        {satir("kendiliginden", "canli.akis.kendiliginden", goster(w?.quits_npc, sayi))}
        {satir("bulma", "canli.akis.bulma", goster(w?.job_finding_rate, oran1))}
        {satir("sure", "canli.akis.sure", goster(w?.unemployment_duration, ondalik(1)), "canli.akis.sure.not")}
        {satir("disarida", "canli.akis.disarida", goster(w?.npc_discouraged, sayi))}
        {satir("kamu", "canli.akis.kamu", goster(w?.muni_npc, sayi))}
      </dl>
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "canli.akis.olculmuyor.live" : "canli.akis.olculmuyor")}</p> : null}
    </section>
  );
}
