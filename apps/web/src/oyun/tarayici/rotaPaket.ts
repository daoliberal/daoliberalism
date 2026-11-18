/**
 * B7: rota -> model paketi karari (TEK saf islev). Kayda bagli her rota (`#/canli/<id>`, `#/sonuc/<id>`, `#/dao/<id>[/<n>]`) o kaydin modelAnahtari'na gore
 * paket secer; yeni oyun kuran rotalar (runId'siz Kurucu ve DAO) her zaman guncel paketle calisir.
 *
 *   kosu       rota bir kayitli kosuyu gosterir: paket o kosunun modelinden (Service Worker onceki paketi tutuyorsa)
 *   ev         Baslangic/Kosular: son kayit icin "devam mi, yeni mi" sorulur; devam = kaydin modeli, yeni = guncel
 *   yeni_oyun  yeni oyun kurulan rota: GUNCEL paket (eski paketli oturumda sayfa yeniden yuklenir)
 *   yok        paketle ilgisiz (paylasilan DAO dunyasi, stil)
 */
import { parseHash } from "@/oyun/hooks/useHashRoute";

export type PaketKarari = { tur: "kosu"; kosuId: string } | { tur: "ev" } | { tur: "yeni_oyun" } | { tur: "yok" };

export function rotaPaketKarari(hash: string): PaketKarari {
  if (hash === "" || hash === "#" || hash === "#/" || hash === "#/kosular") return { tur: "ev" };
  const r = parseHash(hash);
  switch (r.name) {
    case "canli":
    case "sonuc":
      return { tur: "kosu", kosuId: r.runId };
    case "dao":
      if (r.runId !== undefined) return { tur: "kosu", kosuId: r.runId };
      return r.dunya !== undefined ? { tur: "yok" } : { tur: "yeni_oyun" };
    case "kurucu":
      return { tur: "yeni_oyun" };
    default:
      return { tur: "yok" };
  }
}
