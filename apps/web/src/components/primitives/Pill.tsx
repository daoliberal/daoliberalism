import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Anchor } from "./Anchor";
import { cx } from "./cx";
import styles from "./Pill.module.css";

/** chip/chipOn: desktop filter chips (C-02-Treasuries:58); mChip/mChipOn: mobile chips (C-M1-Treasuries). */
type Tone = "nav" | "navCurrent" | "chip" | "chipOn" | "mChip" | "mChipOn" | "step" | "stepCurrent" | "stepDone";

const TONE_CLASS: Record<Tone, string> = {
  nav: styles.nav,
  navCurrent: styles.navCurrent,
  chip: styles.chip,
  chipOn: styles.chipOn,
  mChip: styles.mChip,
  mChipOn: styles.mChipOn,
  step: styles.step,
  stepCurrent: styles.stepCurrent,
  stepDone: styles.stepDone,
};

type Shared = { tone: Tone; children?: ReactNode };
type AsButton = Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> & { href?: undefined };
/** `href` must be an internal route or the output of `safeHref`, never a raw untrusted URL. */
type AsLink = Shared & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style"> & { href: string };

export function Pill(props: AsButton | AsLink) {
  const { tone, children, ...rest } = props;
  const className = cx(styles.pill, TONE_CLASS[tone]);
  if (props.href !== undefined) {
    const anchor = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <Anchor {...anchor} href={props.href} className={className} aria-current={anchor["aria-current"] ?? (tone === "navCurrent" ? "page" : undefined)}>
        {children}
      </Anchor>
    );
  }
  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...button} type={type} className={className}>
      {children}
    </button>
  );
}
