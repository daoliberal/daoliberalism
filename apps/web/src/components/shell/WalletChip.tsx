"use client";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/providers/WalletPort";
import { Button } from "../primitives/Button";
import styles from "./WalletChip.module.css";

/**
 * Connected: the short address as an inert button (a real account modal arrives with the wallet plan).
 * Disconnected: a "Connect wallet" button, or, with `connectHref`, a link that connects and then navigates (landing header).
 */
export function WalletChip({ connectHref }: { connectHref?: string }) {
  const { address, connect } = useWallet();
  if (address) {
    return (
      <button type="button" className={styles.chip}>
        {shortAddress(address)}
      </button>
    );
  }
  if (connectHref) {
    return (
      <Button variant="primary" size="sm" href={connectHref} onClick={connect}>
        Connect wallet
      </Button>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={connect}>
      Connect wallet
    </Button>
  );
}
