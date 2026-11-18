"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { Banner } from "./Banner";
import { BantEylemleri } from "./BantEylemleri";
import { CIHAZ_ANAHTARI, cihazUyarisiKapali, kapaliYaz } from "./cihaz";

/** Telefon/tablet uyarisi: oyunu engellemez, kapatilabilir, kapatma tercihi hatirlanir. `gorunur` = cihaz algilamasi (cagiran verir). */
export function CihazUyarisi({ gorunur }: { gorunur: boolean }) {
  const [kapali, setKapali] = useState(() => cihazUyarisiKapali(CIHAZ_ANAHTARI));
  if (!gorunur || kapali) return null;
  return (
    <Banner tone="warn">
      {t("cihaz.uyari")}
      <BantEylemleri>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            kapaliYaz(CIHAZ_ANAHTARI);
            setKapali(true);
          }}
        >
          {t("cihaz.kapat")}
        </Button>
      </BantEylemleri>
    </Banner>
  );
}
