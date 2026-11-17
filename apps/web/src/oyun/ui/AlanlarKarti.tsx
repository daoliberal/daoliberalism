import { useId } from "react";
import { Stack } from "@/components/primitives/Stack";
import type { RegistryControl, UIValue } from "@/oyun/sim/types";
import styles from "./AlanlarKarti.module.css";
import { SayiGirdisi } from "./SayiGirdisi";
import { SecenekGrubu } from "./SecenekGrubu";

type FieldsControl = Extract<RegistryControl, { type: "fields" }>;
type Obj = Record<string, number | string | boolean>;

/**
 * Bileşik değer (`fields`): alt alanlar bir `fieldset` içinde. Bir alan değişince alanların TAMAMI yeni nesne olarak iletilir.
 */
export function AlanlarKarti({ legend, control, value, fallback, words, disabled, describedBy, onChange }: {
  legend: string;
  control: FieldsControl;
  value: UIValue;
  words: Record<string, string>;
  /** Kartın varsayılan nesnesi: eksik alt alan buradan dolar. */
  fallback?: UIValue;
  disabled: boolean;
  describedBy?: string;
  onChange(v: Obj): void;
}) {
  const uid = useId();
  const given: Obj = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
  const def: Obj = typeof fallback === "object" && fallback !== null && !Array.isArray(fallback) ? (fallback as Obj) : {};
  // eksik alt alan kartın varsayılan nesnesindeki değerle (yoksa ilk seçenek / en küçük değer) dolar; böylece iletilen nesne her zaman tamdır
  const cur: Obj = Object.fromEntries(
    control.fields.flatMap((f): [string, number | string | boolean][] => {
      const v = given[f.key];
      if (v !== undefined) return [[f.key, v]];
      if (def[f.key] !== undefined) return [[f.key, def[f.key]!]];
      if (f.control.type === "number") return [[f.key, f.control.min]];
      if (f.control.type === "options" && f.control.options[0]) return [[f.key, f.control.options[0].value]];
      return [];
    }),
  );
  const set = (key: string, v: number | string | boolean): void => onChange({ ...cur, [key]: v });
  return (
    <fieldset className={styles.alanlar} disabled={disabled} aria-describedby={describedBy}>
      <legend className={styles.baslik}>{legend}</legend>
      <Stack gap="12">
        {control.fields.map((f) => {
          const id = `${uid}-${f.key}`;
          const v = cur[f.key];
          if (f.control.type === "number") {
            return (
              <SayiGirdisi
                key={f.key} id={id} label={f.label} control={f.control} value={typeof v === "number" ? v : f.control.min} words={words}
                disabled={disabled} extraHint={f.hint} onChange={(n) => set(f.key, n)}
              />
            );
          }
          if (f.control.type === "options") {
            return (
              <div key={f.key} className={styles.alan}>
                <span id={`${id}-etiket`} className={styles.etiket}>{f.label}</span>
                <SecenekGrubu options={f.control.options} value={v as UIValue} disabled={disabled} labelledBy={`${id}-etiket`} onChange={(n) => set(f.key, n)} />
              </div>
            );
          }
          return null;
        })}
      </Stack>
    </fieldset>
  );
}
