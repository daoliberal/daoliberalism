import type { ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import stil from "./IkonDugmesi.module.css";

/**
 * Yalnız ikonlu düğme. `etiket` hem erişilebilir ad (`aria-label`) hem fareyle gelince ya da klavyeyle odaklanınca beliren ipucudur;
 * ipucu kutusu görsel kopyadır (`aria-hidden`), ekran okuyucu etiketi okur. `hiza="son"`: ipucu düğmenin sağ kenarına hizalanır (sağ üst köşedeki düğmeler).
 */
export function IkonDugmesi({
  etiket,
  ikon,
  variant,
  hiza,
  yukari = false,
  ...rest
}: {
  etiket: string;
  ikon: ReactNode;
  variant: "primary" | "secondary" | "toggle";
  hiza?: "son";
  /** İpucu düğmenin ÜSTÜNDE açılır (ekranın altındaki denetimler: aşağıda yer yok). */
  yukari?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <span className={[stil.ikonKap, hiza === "son" ? stil.ikonSonda : "", yukari ? stil.ikonYukari : ""].filter(Boolean).join(" ")}>
      <Button {...rest} variant={variant} size="sm" aria-label={etiket}>
        {ikon}
      </Button>
      <span aria-hidden="true" className={stil.ikonIpucu}>{etiket}</span>
    </span>
  );
}
