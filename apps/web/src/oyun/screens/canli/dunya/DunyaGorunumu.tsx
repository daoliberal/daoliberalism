import { t } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { SehirDugumu } from "./SehirDugumu";
import styles from "./Dunya.module.css";

type Props = { cur: WeekPacket | null; sehirAdlari: string[]; ac?(kind: string, ref: string): void };

/** Dünya görünümü: beş şehir düğümü sabit dizilimde (üstte üç, altta iki). */
export function DunyaGorunumu({ cur, sehirAdlari, ac }: Props) {
  const satirlar = cur?.cities ?? [];
  return (
    <section aria-label={t("canli.dunya.harita")} className={styles.alan}>
      <h2 className={styles.baslik}>{t("canli.dunya.baslik")}</h2>
      {satirlar.length === 0 ? (
        <p className={styles.not}>{t("canli.dunya.bekleniyor")}</p>
      ) : (
        <div className={styles.izgara}>
          {satirlar.map((c) => (
            <div key={c.index} className={styles.yer} data-yer={c.index}>
              <SehirDugumu satir={c} ad={sehirAdlari[c.index] ?? ""} hafta={cur?.week ?? 0} {...(ac ? { ac: () => ac("city", String(c.index)) } : {})} />
            </div>
          ))}
        </div>
      )}
      {ac ? <p className={styles.not}>{t("canli.dunya.aciklama")}</p> : null}
    </section>
  );
}
