import { useId } from "react";
import { cx } from "@/components/primitives/cx";
import { t, type CopyKey } from "@/oyun/copy/t";
import styles from "./LineChart.module.css";

/** Seri adı bir metin anahtarıdır; adı çalışma zamanında belli olan seriler (dünya adı gibi) `label` ile hazır metin verir. */
export type ChartSeries = { id: string; labelKey: CopyKey; label?: string; values: (number | null)[]; styleIndex: 0 | 1 | 2 | 3 | 4 | 5 };
export type ChartMarker = { week: number; kind: "event" | "version" | "seam" | "collapse" | "recovery"; labelKey: CopyKey };

/** styleIndex -> [renk 0..3, çizgi biçimi 0..2]; altı kombinasyon ayrıktır. */
const STYLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 0],
  [0, 1],
  [1, 2],
];

const W = 600;
const H = 240;
const PAD = 12;
const GRID = [0, 1, 2, 3];

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const f2 = (x: number) => x.toFixed(2);

/** `values[i]` = hafta `i + 1`. Çizgi null/sonlu olmayan noktalarda kopar. */
export function LineChart({ series, markers, yDomain, referans, titleKey, titleParams }: { series: ChartSeries[]; markers?: ChartMarker[]; yDomain?: [number, number]; referans?: number; titleKey: CopyKey; titleParams?: Record<string, string | number> }) {
  const capId = useId();
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values.filter(fin));
  const kapsam = referans !== undefined && fin(referans) && all.length > 0 ? [...all, referans] : all;
  let lo = yDomain ? yDomain[0] : kapsam.length ? Math.min(...kapsam) : 0;
  let hi = yDomain ? yDomain[1] : kapsam.length ? Math.max(...kapsam) : 1;
  if (!(hi > lo)) {
    lo -= 1;
    hi = lo + 2;
  }
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 2 * PAD);

  const pathOf = (values: (number | null)[]) => {
    let d = "";
    let open = false;
    values.forEach((v, i) => {
      if (!fin(v)) {
        open = false;
        return;
      }
      d += `${open ? "L" : d ? " M" : "M"}${f2(x(i))} ${f2(y(v))} `;
      open = true;
    });
    return d.trim();
  };

  const drawn = series.map((s) => ({ s, d: pathOf(s.values), style: STYLE[s.styleIndex] }));
  const pins = (markers ?? []).map((m) => ({ m, x: x(Math.min(n - 1, Math.max(0, m.week - 1))) }));

  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={capId} className={styles.svg}>
        {GRID.map((g) => (
          <line key={g} className={styles.izgara} x1={PAD} x2={W - PAD} y1={f2(PAD + (g / 3) * (H - 2 * PAD))} y2={f2(PAD + (g / 3) * (H - 2 * PAD))} />
        ))}
        {referans !== undefined && fin(referans) && all.length > 0 ? (
          <line data-referans={referans} className={styles.referans} x1={PAD} x2={W - PAD} y1={f2(y(referans))} y2={f2(y(referans))} />
        ) : null}
        {pins.map(({ m, x: px }, i) => (
          <line key={i} data-isaret={m.kind} className={cx(styles.isaret, styles[`m-${m.kind}`])} x1={f2(px)} x2={f2(px)} y1={PAD} y2={H - PAD} />
        ))}
        {drawn.map(({ s, d, style }) =>
          d ? <path key={s.id} data-seri={s.id} d={d} className={cx(styles.cizgi, styles[`c${style[0]}`], styles[`b${style[1]}`])} /> : null,
        )}
      </svg>
      <figcaption id={capId} className={styles.baslik}>
        {t(titleKey, titleParams)}
      </figcaption>
      {all.length === 0 ? <p className={styles.bos}>{t("chart.bos")}</p> : null}
      <ul className={styles.gosterge}>
        {drawn.map(({ s, style }) => (
          <li key={s.id} className={styles.oge}>
            <svg viewBox="0 0 24 8" className={styles.ornek} aria-hidden="true" focusable="false">
              <path d="M0 4 H24" className={cx(styles.cizgi, styles[`c${style[0]}`], styles[`b${style[1]}`])} />
            </svg>
            {t("chart.gosterge", { ad: s.label ?? t(s.labelKey), cizgi: t(`chart.cizgi.${style[1]}` as CopyKey) })}
          </li>
        ))}
        {pins.map(({ m }, i) => (
          <li key={`m${i}`} className={styles.oge}>
            {t("chart.isaret", { hafta: m.week, ad: t(m.labelKey) })}
          </li>
        ))}
      </ul>
    </figure>
  );
}
