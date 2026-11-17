"use client";
import { useWallet } from "@/providers/WalletPort";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Stack } from "../primitives/Stack";
import styles from "./ConnectPrompt.module.css";

/** Shown instead of a page that needs a connected wallet (My agents, My earnings, …). Copy per plan T9, subject to owner approval. */
export function ConnectPrompt({ title }: { title?: string }) {
  const { connect } = useWallet();
  return (
    <main className={styles.main}>
      {title && <h1 className={styles.title}>{title}</h1>}
      <Card padding="md">
        <Stack gap="16" align="start">
          <p className={styles.message}>Connect your wallet to continue.</p>
          <Button variant="primary" onClick={connect}>
            Connect wallet
          </Button>
        </Stack>
      </Card>
    </main>
  );
}
