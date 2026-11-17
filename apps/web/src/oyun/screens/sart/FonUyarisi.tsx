"use client";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { Banner } from "@/oyun/ui/Banner";

/** Kuruluş fonu kapalıyken kredi bölümünün üstünde çıkan uyarı bandı; düğme fon kartına kaydırır ve odaklar. */
export function FonUyarisi({ onGit }: { onGit(): void }) {
  return (
    <Stack gap="8" align="start">
      <Banner tone="warn" asItem>
        {t("sart.fon.uyari")}
      </Banner>
      <Button variant="secondary" size="sm" onClick={onGit}>
        {t("sart.fon.git")}
      </Button>
    </Stack>
  );
}
