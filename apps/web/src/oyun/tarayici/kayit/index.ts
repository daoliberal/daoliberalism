/**
 * B4b kayit katmani giris noktasi. B5 (Worker koprusu) `kayitKatmaniAc` ile gercek cekirdegi baglar; B8 sonuclari gosterir.
 */
import type { KayitCekirdegi } from "./cekirdek";
import { KayitDeposu, type Goc } from "./depo";
import { DevamAkisi } from "./akis";
import { KotaYoneticisi, type DepolamaArayuzu } from "./kota";
import { KosuYazici, type HatirlatmaOlayi } from "./yazici";

export interface KayitKatmani {
  depo: KayitDeposu;
  yazici: KosuYazici;
  akis: DevamAkisi;
  kota: KotaYoneticisi;
}

export async function kayitKatmaniAc(o: {
  idb: IDBFactory;
  cekirdek: KayitCekirdegi;
  storage?: DepolamaArayuzu | null;
  hatirlatma?: (olay: HatirlatmaOlayi) => void;
  ad?: string;
  gocler?: readonly Goc[];
  zaman?: () => number;
  esik?: number;
  guncelModel?: () => Promise<string | null>;
}): Promise<KayitKatmani> {
  const depo = await KayitDeposu.ac(o.idb, { ad: o.ad, gocler: o.gocler, zaman: o.zaman });
  const kota = new KotaYoneticisi({ depo, storage: o.storage, esik: o.esik, zaman: o.zaman });
  const yazici = new KosuYazici({ depo, cekirdek: o.cekirdek, kota, hatirlatma: o.hatirlatma, zaman: o.zaman });
  const akis = new DevamAkisi({ depo, cekirdek: o.cekirdek, yazici, zaman: o.zaman, guncelModel: o.guncelModel });
  return { depo, yazici, akis, kota };
}

export * from "./tel";
export * from "./cekirdek";
export * from "./depo";
export * from "./siniflandirma";
export * from "./kota";
export * from "./yazici";
export * from "./akis";
export * from "./disaAktar";
export * from "./arsiv";
export { semaHatalari, semayaUyar } from "./sema";
