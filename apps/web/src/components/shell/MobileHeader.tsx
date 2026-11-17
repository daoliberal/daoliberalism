"use client";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/providers/WalletPort";
import { Anchor } from "../primitives/Anchor";
import { Badge } from "../primitives/Badge";
import { BackIcon, WalletIcon } from "../primitives/icons";
import { Logo } from "./Logo";
import styles from "./MobileHeader.module.css";

type Props = { variant: "root" | "detail"; backHref?: string; backLabel?: string; title?: string };

/**
 * Phone header. root (C-M1-Treasuries:14): logo, Testnet, 44px wallet button.
 * detail (C-M2-Treasury:14): 44px back link, title, Testnet.
 */
export function MobileHeader({ variant, backHref, backLabel, title }: Props) {
  const { address, connect } = useWallet();
  if (variant === "detail") {
    return (
      <header className={styles.detail}>
        <Anchor href={backHref ?? "/"} aria-label={backLabel} className={styles.back}>
          <BackIcon size="20" />
        </Anchor>
        <span className={styles.title}>{title}</span>
        <Badge tone="warn" dot compact>
          Testnet
        </Badge>
      </header>
    );
  }
  return (
    <header className={styles.root}>
      <Logo compact />
      <Badge tone="warn" dot compact>
        Testnet
      </Badge>
      {/* Disconnected: the same icon button connects (the prototype only shows the connected state). */}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={address ? `Wallet ${shortAddress(address)}` : "Connect wallet"}
        onClick={address ? undefined : connect}
      >
        <WalletIcon size="18" />
      </button>
    </header>
  );
}
