import type { SektorGrubu } from "./tipler";

/**
 * Modelin firma türü (`firms[f]["kind"]`) -> harita grubu. Ekran metni burada tutulmaz (metinler `tr.ts`'de).
 * Tür listesi sunucudaki `labels.SECTOR_LABELS` ile birebir aynıdır; grup, modelin
 * `CAP_KIND_GROUP` tablosundan gelir (hammadde = raw, imalat = make, lojistik = log,
 * listede olmayanlar hizmet). Yeni bir tür eklenince burası da eklenmelidir:
 * `sektorGrubu` bilinmeyen türde atar (sessizce bir gruba düşmez).
 */
const TABLO: Readonly<Record<string, SektorGrubu>> = {
  ahir: "hammadde",
  arge: "hizmet",
  belediye: "hizmet",
  bilgisayar: "hizmet",
  cam: "imalat",
  deterjan: "imalat",
  eczane: "hizmet",
  eglence: "hizmet",
  elektronik: "hizmet",
  firin: "imalat",
  giyim: "imalat",
  guvenlik: "hizmet",
  hastane: "hizmet",
  ilac: "hizmet",
  insaat: "hizmet",
  kereste: "hammadde",
  kola: "imalat",
  kuyumcu: "hizmet",
  lojistik: "lojistik",
  maden_altin: "hammadde",
  maden_aluminyum: "hammadde",
  maden_kimyasal: "hammadde",
  maden_komur: "hammadde",
  maden_silika: "hammadde",
  market: "hizmet",
  medya: "hizmet",
  moda: "hizmet",
  mobilya: "imalat",
  okul: "hizmet",
  otel: "hizmet",
  petrol: "hammadde",
  plastik: "imalat",
  restoran: "hizmet",
  santral: "imalat",
  sise_sut: "imalat",
  tarla_bugday: "hammadde",
  tarla_pamuk: "hammadde",
  tarla_seker: "hammadde",
  tekstil: "imalat",
  ulasim: "hizmet",
  un: "imalat",
  universite: "hizmet",
  yazilim: "hizmet",
};

/** Bilinen tüm firma türleri. */
export const SEKTOR_TURLERI: readonly string[] = Object.keys(TABLO);

export function sektorBilinir(tur: string): boolean {
  return Object.hasOwn(TABLO, tur);
}

export function sektorGrubu(tur: string): SektorGrubu {
  if (!sektorBilinir(tur)) throw new Error(`sektorGrubu:${tur}`);
  return TABLO[tur];
}
