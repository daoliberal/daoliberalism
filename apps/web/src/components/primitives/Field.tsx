import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./Field.module.css";

type Base = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
  /** Monospace control. The suffix stays in the body font (C-04:56-59: %, days, seats); opt in with `suffixMono`. */
  mono?: boolean;
  /** Monospace suffix (ETH: C-02-Treasuries:45, C-M1-Treasuries:31, C-M2-Treasury:36). */
  suffixMono?: boolean;
  /** Control font size in px; omitted = 16 (inherit). Prototype uses 14 15 16 17 18 20 22. */
  fontSize?: "14" | "15" | "16" | "17" | "18" | "20" | "22";
  /** Label font size in px; omitted = 16 (C-02, C-04, C-06, C-07 register, C-M1, C-M2). "14" = C-03-Treasury:137, C-05-DAOs:44, C-07-Agents:74. */
  labelSize?: "14";
  /** Horizontal padding inside the box in px; omitted = 14 (12 for selects). "12" = C-03-Treasury:137 spend inputs. */
  inset?: "12";
  /** Label-to-control gap 4 instead of 6 (C-03-Treasury:137, C-05-DAOs:44). */
  tight?: true;
  /** Control content width 100px (C-02-Treasuries:44); the inset is added, so the box total equals the prototype's. */
  width?: "100";
  /** Label-to-box gap 10 (C-02-Treasuries:38). Default 6 (4 with `tight`). */
  gap?: "10";
  /** "inline" puts the hint beside the box (C-02-Treasuries:46: ink-3, 14px), wrapping below on narrow rows. Default below. */
  hintPlacement?: "below" | "inline";
  /** "inline" puts the label left of the box, right-aligned in its row (C-02-Treasuries:60 Sort: 14px normal ink-3). Default above. */
  labelPlacement?: "above" | "inline";
};

/** `phone` (C-M1-Treasuries:26-28 = C-M2-Treasury:34-36: a row, bold label left, transparent 44px box hugging its content on the right, 2px ink border, inset 10, 56px control, suffix 13px), `large` (C-02-Treasuries:43: --size-control-lg, 2px ink border, gap 8) and `compact` (44px, C-02-Treasuries:61) exclude each other. */
type Size = { large?: true; compact?: never; phone?: never } | { compact?: true; large?: never; phone?: never } | { phone?: true; large?: never; compact?: never };

type Omitted = "id" | "className" | "style" | "aria-invalid" | "aria-describedby";
type InputProps = Base & Size & { kind: "input" } & Omit<InputHTMLAttributes<HTMLInputElement>, Omitted>;
type TextareaProps = Base & Size & { kind: "textarea" } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, Omitted>;
type SelectProps = Base & Size & { kind: "select" } & Omit<SelectHTMLAttributes<HTMLSelectElement>, Omitted>;

export type FieldProps = InputProps | TextareaProps | SelectProps;

export function Field(props: FieldProps) {
  const { id, label, hint, error, suffix, mono, suffixMono, large, compact, phone, fontSize, labelSize, inset, tight, gap, width, hintPlacement, labelPlacement, kind, ...rest } = props;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": describedBy,
    className: cx(styles.control, mono && styles.mono, fontSize && styles[`fs${fontSize}`], width && styles[`w${width}`]),
  };

  let control;
  if (kind === "textarea") {
    control = <textarea {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} {...common} className={cx(common.className, styles.area)} />;
  } else if (kind === "select") {
    control = <select {...(rest as SelectHTMLAttributes<HTMLSelectElement>)} {...common} />;
  } else {
    control = <input {...(rest as InputHTMLAttributes<HTMLInputElement>)} {...common} />;
  }

  const inlineHint = hintPlacement === "inline";
  const hintEl = hint && (
    <span id={hintId} className={cx(styles.hint, inlineHint && styles.hintInline)}>
      {hint}
    </span>
  );
  const box = (
    <div
      className={cx(
        styles.box,
        large && styles.large,
        compact && styles.compact,
        phone && styles.phone,
        width && !inlineHint && styles.hug,
        inset && styles[`inset${inset}`],
        suffix && styles.hasSuffix,
        error && styles.invalid,
        kind === "textarea" && styles.boxArea,
        kind === "select" && styles.boxSelect,
      )}
    >
      {control}
      {suffix && <span className={cx(styles.suffix, suffixMono && styles.mono)}>{suffix}</span>}
    </div>
  );

  return (
    <div className={cx(styles.field, tight && styles.tight, gap && styles[`gap${gap}`], phone && styles.phoneField, labelPlacement === "inline" && styles.labelInlineField)}>
      <label htmlFor={id} className={cx(styles.label, labelSize && styles[`label${labelSize}`], labelPlacement === "inline" && styles.labelInline)}>
        {label}
      </label>
      {inlineHint ? (
        <div className={styles.inlineRow}>
          {box}
          {hintEl}
        </div>
      ) : (
        <>
          {box}
          {hintEl}
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
