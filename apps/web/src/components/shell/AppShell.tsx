"use client";
import type { ReactNode } from "react";
import { Header } from "./Header";
import styles from "./AppShell.module.css";
import { MobileHeader } from "./MobileHeader";
import { MobileTabBar } from "./MobileTabBar";
import type { NavKey } from "./Nav";
import { useIsNarrow } from "./useIsNarrow";

type MobileHeaderProps = Parameters<typeof MobileHeader>[0];

/**
 * Page frame. Screens render only their own `<main>`; the route table (RouteShell) decides which frame wraps it.
 * - landing: logo, Testnet, "Connect wallet" (also on a phone: no mobile prototype for it).
 * - app, wide: logo, Nav (aria-current on `current`), Testnet, WalletChip.
 * - app, narrow (<= 720px): MobileHeader (`mobile`, root by default) above, MobileTabBar below.
 * Only one of the two layouts is ever in the DOM.
 */
export function AppShell({
  variant = "app",
  current,
  mobile = { variant: "root" },
  children,
}: {
  variant?: "landing" | "app";
  current?: NavKey;
  mobile?: MobileHeaderProps;
  children: ReactNode;
}) {
  const narrow = useIsNarrow();
  if (variant === "app" && narrow) {
    return (
      <div className={styles.frame}>
        <MobileHeader {...mobile} />
        <div className={styles.content}>{children}</div>
        <MobileTabBar current={current} />
      </div>
    );
  }
  return (
    <div className={styles.frame}>
      <Header variant={variant} current={current} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
