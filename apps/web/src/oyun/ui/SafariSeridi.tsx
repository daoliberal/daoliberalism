"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { Banner } from "./Banner";
import { BantEylemleri } from "./BantEylemleri";
import { SAFARI_ANAHTARI, cihazUyarisiKapali, kapaliYaz } from "./cihaz";

/** WebKit (Safari, iOS tarayicilari): 7 gun etkilesim olmayan sitenin verisi silinebilir; belirgin serit, kapatilabilir, tercih hatirlanir. Diger tarayicilarda bilgi yalniz panelde. */
export function SafariSeridi({ webkit }: { webkit: boolean }) {
  const [kapali, setKapali] = useState(() => cihazUyarisiKapali(SAFARI_ANAHTARI));
  if (!webkit || kapali) return null;
  return (
    <Banner tone="neutral">
      {t("kayit.safari_serit")}
      <BantEylemleri>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            kapaliYaz(SAFARI_ANAHTARI);
            setKapali(true);
          }}
        >
          {t("kayit.safari_serit_kapat")}
        </Button>
      </BantEylemleri>
    </Banner>
  );
}
