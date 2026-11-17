import { Badge } from "../primitives/Badge";
import styles from "./Header.module.css";
import { Logo } from "./Logo";
import { Nav, type NavKey } from "./Nav";
import { WalletChip } from "./WalletChip";

/**
 * Desktop header (C-02-Treasuries:19). "app": logo, the four section links, Testnet, wallet.
 * "landing" (C-01-Landing:19): logo, Testnet, "Connect wallet".
 */
export function Header({ variant, current }: { variant: "landing" | "app"; current?: NavKey }) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Logo grow={variant === "landing"} />
        {variant === "app" && <Nav current={current} />}
        <Badge tone="warn" dot>
          Testnet
        </Badge>
        <WalletChip connectHref={variant === "landing" ? "/treasuries/" : undefined} />
      </div>
    </header>
  );
}
