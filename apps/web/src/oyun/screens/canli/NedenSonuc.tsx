import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { Registry, WorldEvent } from "@/oyun/sim/types";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";

/**
 * Seçili olayın neden-sonuç zinciri: kayıtlı `chain` adımları; yoksa olayın kural kimliklerinden "kural → olay" satırları;
 * ikisi de yoksa "zincir kaydı yok" (uydurma zincir yok).
 */
export function NedenSonuc({ olay, registry, onDegistir }: { olay: WorldEvent | null; registry: Registry | null; onDegistir?: () => void }) {
  const adimlar = olay?.chain ?? [];
  const kurallar = olay === null || adimlar.length > 0 ? [] : olay.rule_ids.map((id) => registry?.cards.find((c) => c.id === id)?.title ?? id);
  return (
    <section aria-labelledby="neden-sonuc" className={styles.bolum}>
      <h2 id="neden-sonuc" className={styles.baslik}>{t("canli.neden.baslik")}</h2>
      {olay === null ? (
        <p className={styles.kucuk}>{t("canli.neden.sec")}</p>
      ) : (
        <>
          <strong>{t(olay.textKey, olay.params)}</strong>
          {adimlar.length > 0 ? (
            <ol className={akis.adimlar} aria-label={t("canli.neden.adimlar")}>
              {adimlar.map((a, i) => (
                <li key={`${a.step}-${i}`} className={akis.adim}>
                  {t(a.textKey, a.params)}
                  {i < adimlar.length - 1 ? <span className={akis.ok} aria-hidden="true"> →</span> : null}
                </li>
              ))}
            </ol>
          ) : kurallar.length > 0 ? (
            <ul className={akis.adimlar} aria-label={t("canli.neden.kurallar")}>
              {kurallar.map((k) => (
                <li key={k} className={akis.adim}>
                  {t("canli.neden.kural_satir", { kural: k, olay: t(olay.textKey, olay.params) })}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.kucuk}>{t("canli.neden.zincir_yok")}</p>
          )}
          {onDegistir && olay.rule_ids.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={onDegistir}>
              {t("canli.neden.kurali_degistir")}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
