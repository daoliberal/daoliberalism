import { Stack } from "@/components/primitives/Stack";
import styles from "./CokluSecim.module.css";

type Item = { value: string; label: string };

/** Çoklu seçim: onay kutuları; değer, kartın öğe sırasıyla (seçim sırasıyla değil) iletilir. */
export function CokluSecim({ items, value, disabled, labelledBy, describedBy, onChange }: {
  items: Item[];
  value: string[];
  disabled: boolean;
  labelledBy: string;
  describedBy?: string;
  onChange(v: string[]): void;
}) {
  const toggle = (v: string, on: boolean): void => {
    const chosen = new Set(value);
    if (on) chosen.add(v);
    else chosen.delete(v);
    onChange(items.filter((i) => chosen.has(i.value)).map((i) => i.value));
  };
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <Stack gap="8">
        {items.map((i) => (
          <label key={i.value} className={styles.oge}>
            <input type="checkbox" className={styles.kutu} checked={value.includes(i.value)} disabled={disabled} onChange={(e) => toggle(i.value, e.target.checked)} />
            <span>{i.label}</span>
          </label>
        ))}
      </Stack>
    </div>
  );
}
