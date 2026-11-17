import { t, type CopyKey } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { goster, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

const akce = (x: number) => t("canli.gosterge.akce", { n: sayi(x) });

/**
 * Oyuncu servet dilimleri (nakit + mevduat): en zengin yüzde 10 ve geri kalan yüzde 90, yanında yerleşik halk hanelerinin nakdi ve mevduatı.
 * Ekonomi bloğu ya da `para` yoksa bölüm gizlidir; oyuncu yokken dilimler "ölçülmüyor" (0 uydurulmaz).
 */
export function OyuncuDilimleri({ cur }: { cur: WeekPacket | null }) {
  const para = cur?.ekonomi?.para ?? null;
  if (para === null) return null;
  const oyuncuVar = sonlu(para.oyuncu_n) && para.oyuncu_n > 0;
  const ust = oyuncuVar ? para.oyuncu_ust10 : null;
  const alt = oyuncuVar ? para.oyuncu_alt90 : null;
  const toplam = sonlu(ust) && sonlu(alt) ? ust + alt : null;
  const pay = (v: number | null): string => (toplam !== null && toplam > 0 && v !== null ? ` · ${t("dilim.pay", { oran: oran1(v / toplam) })}` : "");
  const olcu = (id: string, etiket: CopyKey, v: number | null, ek = "") => (
    <div key={id} className={styles.olcu} data-dilim={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{goster(v, akce)}{ek}</dd>
    </div>
  );
  return (
    <section aria-label={t("dilim.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("dilim.baslik")}</h2>
      <p className={styles.kucuk}>{t("dilim.alt")}</p>
      <dl className={styles.serit}>
        {olcu("ust10", "dilim.ust10", ust, pay(ust))}
        {olcu("alt90", "dilim.alt90", alt, pay(alt))}
        {olcu("npc_nakit", "dilim.npc_nakit", para.npc_hane_nakit)}
        {olcu("npc_mevduat", "dilim.npc_mevduat", para.npc_hane_mevduat)}
      </dl>
      {oyuncuVar ? <p className={styles.kucuk} data-dilim="n">{t("dilim.n", { n: sayi(para.oyuncu_n as number) })}</p> : null}
      {oyuncuVar ? null : <p className={styles.kucuk}>{t("dilim.olculmuyor")}</p>}
      <p className={styles.kucuk}>{t("dilim.not")}</p>
    </section>
  );
}
