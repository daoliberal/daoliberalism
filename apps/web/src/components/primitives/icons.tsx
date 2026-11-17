import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./icons.module.css";

export type IconSize = "11" | "12" | "16" | "18" | "20" | "22" | "24" | "28";
type IconProps = { size: IconSize };

type Stroke = "s15" | "s16" | "s18" | "s20" | "s24";

/** Rounded rectangle as path data (svg `rect` width/height attributes are raw values the design rules forbid). */
function box(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

function Svg({ size, viewBox, stroke, children }: IconProps & { viewBox: string; stroke: Stroke; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} aria-hidden="true" focusable="false" className={cx(styles.icon, styles[`size${size}`], styles[stroke])}>
      {children}
    </svg>
  );
}

export function LockIcon({ size }: IconProps) {
  if (size === "11" || size === "12") {
    // small padlock, 12-unit viewBox (C-03-Treasury:41, C-M2-Treasury:28)
    return (
      <Svg size={size} viewBox="0 0 12 12" stroke="s15">
        <path d={box(2, 5.5, 8, 5.5, 1)} />
        <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
      </Svg>
    );
  }
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d={box(4, 10.5, 16, 10.5, 2)} />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s24">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CloseIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 18 18" stroke="s18">
      <path d="M3 3l12 12M15 3 3 15" />
    </Svg>
  );
}

export function BackIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s20">
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function ArrowDownIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 16 20" stroke="s16">
      <path d="M8 0v18M2 12l6 6 6-6" />
    </Svg>
  );
}

export function WalletIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d={box(3, 6, 18, 13, 2)} />
      <path d="M3 10h18M16 14.5h2" />
    </Svg>
  );
}

export function HomeIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5" />
    </Svg>
  );
}

export function CoinIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H8" />
    </Svg>
  );
}

export function TableIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d={box(4, 4, 16, 16, 2)} />
      <path d="M4 10h16M10 10v10" />
    </Svg>
  );
}

export function BotIcon({ size }: IconProps) {
  return (
    <Svg size={size} viewBox="0 0 24 24" stroke="s18">
      <path d={box(5, 7, 14, 12, 3)} />
      <path d="M12 3v4M9 12h.01M15 12h.01" />
    </Svg>
  );
}
