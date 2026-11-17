import { t } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { fark, OLCULER } from "./olcu";
import styles from "./Canli.module.css";

const GLIF = { up: "▲", down: "▼", flat: "=", none: "" } as const;
const ADI = { up: "seri.artis", down: "seri.dusus", flat: "seri.sabit", none: "seri.fark_yok" } as const;

/** Bu haftanın değerleri ve önceki haftaya fark: glif + işaretli sayı + metin (renk tek başına değil). */
export function BuHaftaSeridi({ cur, prev }: { cur: WeekPacket | null; prev: WeekPacket | null }) {
  return (
    <section aria-labelledby="bu-hafta" className={styles.bolum}>
      <h2 id="bu-hafta" className={styles.baslik}>
        {t("canli.bu_hafta")}
      </h2>
      <dl className={styles.serit}>
        {OLCULER.map((o) => {
          const v = cur ? o.deger(cur.world) : null;
          const f = fark(o, v, prev ? o.deger(prev.world) : null);
          return (
            <div key={o.id} className={styles.olcu} data-olcu={o.id} title={(cur && o.ipucu?.(cur.world)) || undefined}>
              <dt className={styles.etiket}>{t(o.etiket)}</dt>
              <dd className={styles.deger}>{cur ? o.goster(v) : t("seri.fark_yok")}</dd>
              <dd className={styles.fark} data-yon={f.yon}>
                {f.yon === "none" ? null : <span aria-hidden="true">{GLIF[f.yon]} </span>}
                {f.metin}
                {f.yon === "none" ? null : <span> {t(ADI[f.yon])}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
