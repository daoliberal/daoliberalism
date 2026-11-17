import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { Banner } from "@/oyun/ui/Banner";

/** Ayrıştırılamayan ya da bilinmeyen koşu tarifi. */
export function KosuYok({ go }: { go(): void }) {
  return (
    <Stack gap="12" align="start">
      <Banner tone="neutral">{t("canli.kosu_yok")}</Banner>
      <Button variant="primary" onClick={go}>
        {t("canli.yeni_kosu")}
      </Button>
    </Stack>
  );
}
