import { t, type CopyKey } from "@/oyun/copy/t";

/** Kaynak bilgisinde etiketi olmayan sektör kimlikleri (kamu ve hizmet sektörleri); adları `copy/tr.ts` (`sektor.ek.*`). */
const EK_KIMLIKLER: readonly string[] = ["universite", "ilac", "okul", "market", "medya"];

/** Kimlik için okunur ad: bilinen ek ad, yoksa kimlik (alt çizgi boşluk, ilk harf büyük). */
export function sektorOkunurAd(kimlik: string): string {
  if (EK_KIMLIKLER.includes(kimlik)) return t(`sektor.ek.${kimlik}` as CopyKey);
  const duz = kimlik.replace(/_/g, " ").trim();
  return duz === "" ? kimlik : duz.charAt(0).toLocaleUpperCase("tr") + duz.slice(1);
}
