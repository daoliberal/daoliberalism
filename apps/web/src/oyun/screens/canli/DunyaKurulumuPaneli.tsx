import { t, type CopyKey } from "@/oyun/copy/t";
import { isletmeSayisi } from "@/oyun/sim/result";
import type { WeekPacket } from "@/oyun/sim/types";
import { goster, oran0, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; isLive: boolean };

/** Dünya kurulumu: işletme sayısı, kadro doluluğu, kapasitesi dolan tür sayısı, konut stoku ve açılış kadrosu (dünya değerleri). */
export function DunyaKurulumuPaneli({ weeks, cur, isLive }: Props) {
  const w = cur?.world ?? null;
  const olculuyor = weeks.some((p) => sonlu(p.world.staff_fill) || sonlu(p.world.opening_staff) || sonlu(p.world.npc_lfp) || isletmeSayisi(p.world) !== null);
  const satir = (id: string, etiket: CopyKey, deger: string) => (
    <div key={id} className={styles.olcu} data-kurulum={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
    </div>
  );
  return (
    <section aria-label={t("canli.kurulum.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.kurulum.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.kurulum.alt")}</p>
      <dl className={styles.serit}>
        {satir("isletme", "canli.kurulum.isletme", goster(w ? isletmeSayisi(w) : null, sayi))}
        {satir("doluluk", "canli.kurulum.doluluk", goster(w?.staff_fill, oran0))}
        {satir("dolan", "canli.kurulum.dolan", goster(w?.kinds_full, sayi))}
        {satir("konut", "canli.kurulum.konut", goster(w?.house_stock, sayi))}
        {satir("acilis", "canli.kurulum.acilis", goster(w?.opening_staff, sayi))}
        {satir("katilim", "canli.kurulum.katilim", goster(w?.npc_lfp, oran0))}
        {satir("bagimli", "canli.kurulum.bagimli", goster(w?.npc_dependents, sayi))}
      </dl>
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "canli.kurulum.olculmuyor.live" : "canli.kurulum.olculmuyor")}</p> : null}
    </section>
  );
}
