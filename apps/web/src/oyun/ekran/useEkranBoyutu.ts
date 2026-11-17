import { useSyncExternalStore } from "react";
import { EKRAN_STILI, genislikSorgusu, type EkranBoyutu } from "./ekranStili";

const telefonSorgu = genislikSorgusu(EKRAN_STILI.kirilma.telefon);
const darSorgu = genislikSorgusu(EKRAN_STILI.kirilma.dar);

const media = (q: string): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null;

function abone(onChange: () => void): () => void {
  const listeler = [media(telefonSorgu), media(darSorgu)];
  for (const m of listeler) m?.addEventListener("change", onChange);
  return () => {
    for (const m of listeler) m?.removeEventListener("change", onChange);
  };
}

/** İki boolean tek dizgede: `useSyncExternalStore` anlık görüntüsü karşılaştırılabilir kalsın. */
const anlik = (): string => `${media(telefonSorgu)?.matches ? 1 : 0}${media(darSorgu)?.matches ? 1 : 0}`;

/** Pencere genişliği sınıfları (matchMedia yoksa masaüstü sayılır). */
export function useEkranBoyutu(): EkranBoyutu {
  const s = useSyncExternalStore(abone, anlik, () => "00");
  return { telefon: s[0] === "1", dar: s[1] === "1" };
}
