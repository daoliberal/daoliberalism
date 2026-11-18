"use client";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { useKayitBaglami } from "./KayitBaglami";

/** "Kayit ve depolama" paneli dugmesi; baglam yoksa (sunucu ve onizleme derlemesi) hicbir sey cizmez. `onAc`: ust menunun kapanmasi gibi yan etkiler. */
export function KayitDugmesi({ onAc }: { onAc?: () => void }) {
  const b = useKayitBaglami();
  if (b === null) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        onAc?.();
        b.paneliAc();
      }}
    >
      {t("kayit.dugme")}
    </Button>
  );
}
