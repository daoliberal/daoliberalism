/**
 * Python `arsiv_gerek` yanitini karsilayan yardimci (B3 sozlesmesi): pencere disi hafta istegi `{status:0, body:null, arsiv_gerek:{runId, from, to}}` doner;
 * kopru o haftalari IndexedDB'den verip istegi `arsiv=[paket,...]` ile en cok 3 kez yineler.
 */
import type { KayitDeposu } from "./depo";
import type { HaftaPaketi } from "./tel";

export const ARSIV_AZAMI_YINELEME = 3;

export interface ArsivGerek {
  runId: string;
  from: number;
  to: number;
}

export interface ArsivliYanit {
  status: number;
  body: unknown;
  arsiv_gerek?: ArsivGerek | null;
}

export class ArsivHatasi extends Error {
  readonly kod: "arsiv_eksik" | "arsiv_dongusu";
  constructor(kod: "arsiv_eksik" | "arsiv_dongusu") {
    super(kod);
    this.name = "ArsivHatasi";
    this.kod = kod;
  }
}

/** `arsiv_gerek` araligi icin depodan `arsiv=[...]` (artan hafta). Depoda olmayan haftalar atlanir. */
export async function arsivUret(depo: KayitDeposu, g: ArsivGerek): Promise<HaftaPaketi[]> {
  return depo.paketAraligi(g.runId, g.from, g.to);
}

/**
 * `istek(arsiv)` once arsivsiz cagrilir; `arsiv_gerek` donerse depodan uretilen arsivle yinelenir (en cok `ARSIV_AZAMI_YINELEME`).
 * Istenen aralik depoda tamamen yoksa (ilerleme olmaz) `arsiv_eksik`, yineleme siniri asilirsa `arsiv_dongusu` atilir.
 */
export async function arsivliIstek(depo: KayitDeposu, istek: (arsiv?: HaftaPaketi[]) => Promise<ArsivliYanit>): Promise<ArsivliYanit> {
  let y = await istek();
  for (let n = 0; n < ARSIV_AZAMI_YINELEME && y.arsiv_gerek; n++) {
    const arsiv = await arsivUret(depo, y.arsiv_gerek);
    if (arsiv.length === 0) throw new ArsivHatasi("arsiv_eksik");
    y = await istek(arsiv);
  }
  if (y.arsiv_gerek) throw new ArsivHatasi("arsiv_dongusu");
  return y;
}
