import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { Anchor } from "./Anchor";
import { cx } from "./cx";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "brand" | "inverse" | "panelLight" | "toggle";
/**
 * sm 44px/18 (C-02-Treasuries:93), md 48px/22 (default), wide 48px/24 (wizard Next), lg 52px/24/17px (C-01 hero),
 * dialog 52px/24 at the body text size (Cancel in the signing dialog, C-09-Approval:56).
 */
type Size = "sm" | "md" | "wide" | "lg" | "dialog";

/** `fill`: the button grows to the width of the flex row it sits in (the signing dialog's Cancel and CTA slots). */
type Shared = { variant: Variant; size?: Size; pressed?: boolean; fill?: boolean; disabled?: boolean; children?: ReactNode };
type AsButton = Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "disabled"> & { href?: undefined };
type AsLink = Shared & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style"> & { href: string };

/** `href` must be an internal route or the output of `safeHref` (never a raw untrusted URL). */
export type ButtonProps = AsButton | AsLink;

/** `<button>` (native `disabled`) or, with `href`, an `<a>` (`aria-disabled`, click blocked). */
export function Button(props: ButtonProps) {
  const { variant, size, pressed, fill, disabled, children, ...rest } = props;
  const className = cx(styles.button, styles[variant], size && styles[`sz-${size}`], fill && styles.fill);
  const aria = variant === "toggle" && pressed !== undefined ? pressed : undefined;

  if (props.href !== undefined) {
    const { onClick, ...anchor } = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    };
    return (
      <Anchor {...anchor} href={props.href} className={className} aria-disabled={disabled ? true : undefined} aria-pressed={aria} onClick={handleClick}>
        {children}
      </Anchor>
    );
  }

  const { type = "button", ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...button} type={type} className={className} disabled={disabled} aria-pressed={aria}>
      {children}
    </button>
  );
}
