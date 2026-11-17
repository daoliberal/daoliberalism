import type { OyunException } from "../exceptions";
import { forScreens } from "./liveShared";

/** Zincir görünümü: prototipin 16 örnek düğümü yerine sunucunun sektör kümesi, basamaklara dizili SVG (kenarlar tarif kenarları, kenar miktarı yalnız çekmecede). */
export const LIVE_CHAIN_EXCEPTIONS: readonly OyunException[] = forScreens(["live-chain"], [
  { kind: "omit", line: /^HammaddeAra malTüketim$/, reason: "Sütun başlıkları girdi yolu uzunluğundan türeyen basamaklardır (yalnız sütun konumu); metinli başlık yok." },
  {
    kind: "omit", line: /^[A-ZÇĞİÖŞÜa-zçğıöşü]+ (kıt|normal|kadrosuz|girdisiz)$/,
    reason: "Prototipin örnek düğümleri; gerçek zincirde sektör kümesi sunucudan gelir ve durum 'kıt', 'normal' ya da 'ölçülmüyor'dur (kıt = en kıt 5 listesinde).",
  },
  { kind: "omit", line: /^Normal akış/, reason: "Lejant cümlesi yeniden yazıldı: kesikli çizgi kıt halkadan çıkan akış (çizgi biçimi, renk tek başına değil)." },
]);
