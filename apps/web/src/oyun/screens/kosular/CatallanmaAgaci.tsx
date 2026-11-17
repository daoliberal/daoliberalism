import { t } from "@/oyun/copy/t";
import { forkTree, type ForkNode, type SavedRun } from "@/oyun/sim/library";
import styles from "./Kosular.module.css";

function Dal({ n, derinlik }: { n: ForkNode; derinlik: number }) {
  const bilgi = [n.run.forkWeek !== undefined ? t("kosular.agac.bilgi", { n: n.run.forkWeek }) : null, t("kosular.agac.sure", { n: n.run.recipe.durationWeeks })].filter((x) => x !== null).join(" · ");
  return (
    <li className={styles.dal}>
      <span className={derinlik === 0 ? styles.dalKok : styles.dalOn} aria-hidden="true" />
      <span>{n.run.name}</span> <span className={styles.kucuk}>{bilgi}</span>
      {n.children.length > 0 ? (
        <ul>
          {n.children.map((c) => (
            <Dal key={c.run.id} n={c} derinlik={derinlik + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Çatallanma ağacı: `parentId` ile iç içe liste; ebeveyni kütüphanede olmayan koşu kökte durur. */
export function CatallanmaAgaci({ runs }: { runs: SavedRun[] }) {
  const agac = forkTree(runs);
  return (
    <section className={styles.panel} aria-labelledby="kosular-agac-baslik">
      <h3 id="kosular-agac-baslik" className={styles.altBaslik}>{t("kosular.agac.baslik")}</h3>
      {agac.length === 0 ? (
        <p className={styles.kucuk}>{t("kosular.agac.yok")}</p>
      ) : (
        <ul className={styles.agac} aria-labelledby="kosular-agac-baslik">
          {agac.map((n) => (
            <Dal key={n.run.id} n={n} derinlik={0} />
          ))}
        </ul>
      )}
    </section>
  );
}
