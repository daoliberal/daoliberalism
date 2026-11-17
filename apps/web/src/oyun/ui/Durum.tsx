import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";

export function Yukleniyor() {
  return <p role="status">{t("durum.yukleniyor")}</p>;
}

export function Hata({ retry, messageKey = "durum.hata", retryKey = "durum.yeniden" }: { retry(): void; messageKey?: CopyKey; retryKey?: CopyKey }) {
  return (
    <Stack gap="10" align="start">
      <p>{t(messageKey)}</p>
      <Button variant="secondary" onClick={() => retry()}>
        {t(retryKey)}
      </Button>
    </Stack>
  );
}

export function Bos({ messageKey }: { messageKey: CopyKey }) {
  return <p>{t(messageKey)}</p>;
}
