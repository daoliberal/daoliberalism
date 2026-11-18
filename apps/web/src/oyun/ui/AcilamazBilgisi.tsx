"use client";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";

/** Bu surumde acilamayan baglanti (kayit/onizleme kaynagi, paylasilan dunya) icin anlasilir bilgi ve tek eylem. */
export function AcilamazBilgisi({ metin, eylem, onEylem }: { metin: CopyKey; eylem: CopyKey; onEylem(): void }) {
  return (
    <section aria-labelledby="acilamaz-baslik">
      <Stack gap="10" align="start">
        <h2 id="acilamaz-baslik">{t("tarayici.acilamaz.baslik")}</h2>
        <p>{t(metin)}</p>
        <Button variant="primary" onClick={onEylem}>
          {t(eylem)}
        </Button>
      </Stack>
    </section>
  );
}
