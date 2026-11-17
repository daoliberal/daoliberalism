import type { ReactNode } from "react";
import { Anchor } from "../primitives/Anchor";
import { BotIcon, CoinIcon, HomeIcon, TableIcon } from "../primitives/icons";
import { cx } from "../primitives/cx";
import styles from "./MobileTabBar.module.css";
import type { NavKey } from "./Nav";

/** Phone labels ("Agents", "Earnings"); the desktop nav says "My agents" / "My earnings". */
const TABS = [
  { key: "treasuries", href: "/treasuries/", label: "Treasuries", icon: <HomeIcon size="20" /> },
  { key: "daos", href: "/daos/", label: "DAOs", icon: <TableIcon size="20" /> },
  { key: "agents", href: "/agents/", label: "Agents", icon: <BotIcon size="20" /> },
  { key: "earnings", href: "/earnings/", label: "Earnings", icon: <CoinIcon size="20" /> },
] as const satisfies readonly { key: NavKey; href: string; label: string; icon: ReactNode }[];

/** C-M1-Treasuries:61 */
export function MobileTabBar({ current }: { current?: NavKey }) {
  return (
    <nav aria-label="Main" className={styles.bar}>
      {TABS.map((tab) => {
        const on = tab.key === current;
        return (
          <Anchor key={tab.key} href={tab.href} aria-current={on ? "page" : undefined} className={cx(styles.tab, on && styles.current)}>
            {tab.icon}
            {tab.label}
          </Anchor>
        );
      })}
    </nav>
  );
}
