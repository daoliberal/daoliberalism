import { t } from "@/oyun/copy/t";
import { Button } from "@/components/primitives/Button";
import type { Diagnostic } from "@/oyun/sim/types";
import { Bos } from "@/oyun/ui/Durum";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";

/**
 * "Ne olmuyor": sunucunun hesapladığı tanılar (beklenen ama olmayan). Metin olguyu söyler, nedeni iddia etmez.
 * `tanilar` yoksa kayıt tanı taşımıyordur; boş listede o hafta beklenip de olmayan bir şey yoktur.
 */
export function NeOlmuyor({ tanilar, canli, onDegistir }: { tanilar: Diagnostic[] | undefined; /** Canlı kaynak: "kayıt" sözcüğü kullanılmaz. */ canli: boolean; onDegistir?: () => void }) {
  return (
    <section aria-labelledby="ne-olmuyor" className={styles.bolum}>
      <div className={styles.baslikSatir}>
        <h2 id="ne-olmuyor" className={styles.baslik}>{t("canli.neden.olmuyor_baslik")}</h2>
        <span className={styles.kucuk}>{t("canli.neden.olmuyor_alt")}</span>
      </div>
      {tanilar === undefined ? (
        <Bos messageKey={canli ? "canli.neden.tani_yok.live" : "canli.neden.tani_yok"} />
      ) : tanilar.length === 0 ? (
        <Bos messageKey="canli.neden.tani_bos" />
      ) : (
        <ul className={akis.tanilar}>
          {tanilar.map((d) => (
            <li key={d.id} className={akis.tani} data-tani={d.id}>
              <span>{t(d.textKey, d.params)}</span>
              <span className={styles.kucuk}>{t("canli.neden.tani_hafta", { n: d.since_week })}</span>
              {onDegistir ? (
                <Button variant="secondary" size="sm" onClick={onDegistir}>
                  {t("canli.neden.kurali_degistir")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
