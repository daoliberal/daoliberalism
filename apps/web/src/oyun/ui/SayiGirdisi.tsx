import { useState, type KeyboardEvent } from "react";
import { Field } from "@/components/primitives/Field";
import { t } from "@/oyun/copy/t";
import { formatValue, numberText, unitSuffix } from "@/oyun/sim/formatValue";
import type { RegistryControl } from "@/oyun/sim/types";

export type NumberControl = Extract<RegistryControl, { type: "number" }>;

const round = (x: number): number => Math.round(x * 1e9) / 1e9;

const DECIMAL = /^-?\d+(?:[.,]\d+)?$/;
/** Girilen metni sayıya çevirir; ondalık ayracı virgül ya da nokta olabilir. Geçersizse `NaN`. */
export function parseNumber(text: string): number {
  const trimmed = text.trim();
  return DECIMAL.test(trimmed) ? Number(trimmed.replace(",", ".")) : Number.NaN;
}
/** Sayının giriş kutusundaki Türkçe gösterimi (ondalık virgül, binlik ayracı yok). */
const display = (n: number): string => String(n).replace(".", ",");

/** Geçersizse Türkçe hata metni, geçerliyse `null` (Python `decode` ile aynı kurallar). */
export function numberError(c: NumberControl, text: string): string | null {
  const n = parseNumber(text);
  if (!Number.isFinite(n)) return t("kart.sayi_gecersiz");
  if (c.integer && !Number.isInteger(n)) return t("kart.tamsayi");
  if (n < c.min || n > c.max) return t("kart.aralik", { min: numberText(c.min), max: numberText(c.max) });
  if (c.step > 0) {
    const q = (n - c.min) / c.step;
    if (Math.abs(q - Math.round(q)) > 1e-6) return t("kart.adim", { min: numberText(c.min), adim: numberText(c.step) });
  }
  return null;
}

/**
 * Sayı girişi: birim son ek, biçimlenmiş okunuş ve (varsa) kilit nedeni ipucunda. Geçersiz değerde `error` gösterilir ve `onChange` çağrılmaz.
 * Yukarı/aşağı ok tuşları `step` kadar değiştirir (aralığa kırpılır).
 */
export function SayiGirdisi({ id, label, control, value, words, disabled, lockText, extraHint, onChange }: {
  id: string;
  label: string;
  control: NumberControl;
  value: number;
  words: Record<string, string>;
  disabled: boolean;
  lockText?: string;
  extraHint?: string;
  onChange(v: number): void;
}) {
  const [text, setText] = useState(display(value));
  const [prev, setPrev] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (value !== prev) {
    setPrev(value);
    if (parseNumber(text) !== value) {
      setText(display(value));
      setError(null);
    }
  }

  const commit = (next: string): void => {
    setText(next);
    const err = numberError(control, next);
    setError(err);
    if (err === null) onChange(parseNumber(next));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (disabled) return;
    const parsed = parseNumber(text);
    const base = Number.isFinite(parsed) ? parsed : value;
    const next = Math.min(control.max, Math.max(control.min, round(base + (e.key === "ArrowUp" ? control.step : -control.step))));
    commit(display(next));
  };

  const reading = t("kart.okunus", { deger: formatValue(control, value, words) });
  const suffix = unitSuffix(control.unit, words);
  return (
    <Field
      kind="input" id={id} label={label} type="text" inputMode="decimal" autoComplete="off"
      value={text} disabled={disabled} suffix={suffix || undefined} error={error ?? undefined}
      hint={[reading, extraHint, lockText].filter(Boolean).join(" · ")}
      onChange={(e) => commit(e.target.value)} onKeyDown={onKeyDown}
    />
  );
}
