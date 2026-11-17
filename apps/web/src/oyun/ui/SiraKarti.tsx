import { useEffect, useRef } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import styles from "./SiraKarti.module.css";

type Item = { value: string; label: string };

/** Öncelik sırası: liste + "Yukarı taşı / Aşağı taşı" düğmeleri (sürükleme yok). Taşımadan sonra odak aynı öğede kalır. */
export function SiraKarti({ items, value, disabled, labelledBy, describedBy, onChange }: {
  items: Item[];
  value: string[];
  disabled: boolean;
  labelledBy: string;
  describedBy?: string;
  onChange(v: string[]): void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const pending = useRef<{ key: string; dir: "up" | "down" } | null>(null);
  const label = (v: string): string => items.find((i) => i.value === v)?.label ?? v;

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const find = (dir: string): HTMLButtonElement | undefined =>
      [...(list.current?.querySelectorAll<HTMLButtonElement>("button[data-oge]") ?? [])].find((b) => b.dataset.oge === p.key && b.dataset.yon === dir);
    const same = find(p.dir);
    const other = find(p.dir === "up" ? "down" : "up");
    (same && !same.disabled ? same : other)?.focus();
  }, [value]);

  const move = (i: number, dir: "up" | "down"): void => {
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    pending.current = { key: value[i]!, dir };
    onChange(next);
  };
  if (value.length === 0) return <p>{t("kart.sira_bos")}</p>;
  return (
    <ol ref={list} className={styles.liste} aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {value.map((v, i) => (
        <li key={v} className={styles.oge}>
          <span className={styles.sira} aria-hidden="true">{i + 1}.</span>
          <span className={styles.ad}>{label(v)}</span>
          <Button data-oge={v} data-yon="up" variant="secondary" size="sm" disabled={disabled || i === 0} aria-label={t("kart.yukari", { ad: label(v) })} onClick={() => move(i, "up")}>
            <span aria-hidden="true">▲</span>
          </Button>
          <Button data-oge={v} data-yon="down" variant="secondary" size="sm" disabled={disabled || i === value.length - 1} aria-label={t("kart.asagi", { ad: label(v) })} onClick={() => move(i, "down")}>
            <span aria-hidden="true">▼</span>
          </Button>
        </li>
      ))}
    </ol>
  );
}
