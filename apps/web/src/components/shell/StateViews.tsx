import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Stack } from "../primitives/Stack";
import styles from "./StateViews.module.css";

/**
 * Minimal states that the prototype does not draw (plan Technical decisions T9; copy is subject to owner approval).
 * Drawn only from existing primitives.
 */
export function Loading() {
  return (
    <p role="status" className={styles.message}>
      Loading…
    </p>
  );
}

export function ErrorState({ retry }: { retry(): void }) {
  return (
    <Card padding="md">
      <Stack gap="12" align="start">
        <p role="alert" className={styles.message}>
          Couldn&apos;t load this page. Try again.
        </p>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </Stack>
    </Card>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className={styles.message}>{message}</p>;
}
