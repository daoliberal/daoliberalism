import { t } from "@/oyun/copy/t";
import { normalizeName } from "@/oyun/lib/names";
import { sektorOkunurAd } from "@/oyun/lib/sektorAdlari";
import { loncaAdi } from "@/oyun/screens/canli/LoncaTablosu";
import type { Bina } from "./tipler";

/** Ekranda gösterilen adlar. Veri katmanı ham değer taşır; yerelleştirme burada `tr.ts` ile yapılır. */
export type Adlandirici = { sehir(ad: string): string; bina(b: Bina): string };

/** `sektorAdi`: sektör türünün ekran adı (kaynak bilgisinden); bilinmeyen tür okunur yedek ada çevrilir (`sektorOkunurAd`). */
export function adlandirici(sektorAdi: (tur: string) => string = sektorOkunurAd): Adlandirici {
  // Şehir adı ekranda asla boş kalmaz: sayı ise "Şehir N", boş ya da yalnız boşluksa "Şehir".
  const sehir = (ad: string): string => {
    const temiz = normalizeName(ad);
    return temiz === "" ? t("harita.sehir_adsiz") : /^\d+$/.test(temiz) ? t("harita.sehir_n", { n: temiz }) : temiz;
  };
  return {
    sehir,
    bina: (b) => {
      if (b.tur === "isletme") return sektorAdi(b.etiket);
      if (b.tur === "lonca") return /^lonca\d+$/.test(b.etiket) ? loncaAdi(b.etiket) : t("harita.lonca_n", { n: b.etiket });
      if (b.tur === "ahir") return t("harita.ahir");
      if (b.tur === "liman") return t("harita.liman");
      if (b.tur === "ihracat") return t("harita.ihracat");
      return sehir(b.etiket);
    },
  };
}
