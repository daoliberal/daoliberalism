import { Pill } from "../primitives/Pill";
import styles from "./Nav.module.css";

export type NavKey = "treasuries" | "daos" | "agents" | "earnings";

/** Desktop labels ("My agents", "My earnings"); the phone tab bar uses shorter ones. */
const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: "treasuries", href: "/treasuries/", label: "Treasuries" },
  { key: "daos", href: "/daos/", label: "DAOs" },
  { key: "agents", href: "/agents/", label: "My agents" },
  { key: "earnings", href: "/earnings/", label: "My earnings" },
];

export function Nav({ current }: { current?: NavKey }) {
  return (
    <nav aria-label="Main" className={styles.nav}>
      {ITEMS.map((item) => (
        <Pill key={item.key} tone={item.key === current ? "navCurrent" : "nav"} href={item.href}>
          {item.label}
        </Pill>
      ))}
    </nav>
  );
}
