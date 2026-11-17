import { t } from "@/oyun/copy/t";
import { aktorBasligi, aktorGruplari, DUNYA_KURALI_KATMANI } from "@/oyun/screens/insanlar/insanlarMantik";
import { piyasaKartlari } from "@/oyun/screens/piyasa/Piyasa";
import type { Registry, RegistryCard } from "@/oyun/sim/types";
import { ARAMA_EN_AZ, ARAMA_EN_COK, katla, sartAra, type SartGrubu } from "./sartMantik";

export type AramaYeri = { id: string; baslik: string; yer: string };

const eslesir = (card: RegistryCard, q: string): boolean => [card.title, ...(card.aliases ?? [])].some((x) => katla(x).includes(q));

/**
 * Bütün katmanlarda arama: kural kartları (grup adıyla da), dünyanın insanları (aktör başlığı), piyasa göstergeleri ve dünya kuralları.
 * Kural sonuçları önce gelir; sıra katman sırasıdır.
 */
export function katmanAra(registry: Registry, gruplar: SartGrubu[], query: string): { results: AramaYeri[]; total: number } {
  const kural = sartAra(gruplar, query);
  const q = katla(query.trim());
  if ([...q].length < ARAMA_EN_AZ) return { results: [], total: 0 };
  const out: AramaYeri[] = kural.results.map(({ card, group }) => ({ id: card.id, baslik: card.title, yer: t("sart.ara_yer", { grup: group.title }) }));
  const digerleri: AramaYeri[] = [];
  for (const g of aktorGruplari(registry)) {
    for (const c of g.cards) if (eslesir(c, q)) digerleri.push({ id: c.id, baslik: c.title, yer: t("sart.ara_yer_insanlar", { aktor: t(aktorBasligi(g.id)) }) });
  }
  for (const c of registry.cards) if (c.layer === DUNYA_KURALI_KATMANI && eslesir(c, q)) digerleri.push({ id: c.id, baslik: c.title, yer: t("sart.ara_yer_dunya_kurali") });
  for (const c of piyasaKartlari(registry)) if (eslesir(c, q)) digerleri.push({ id: c.id, baslik: c.title, yer: t("sart.ara_yer_piyasa") });
  const hepsi = [...out, ...digerleri];
  return { results: hepsi.slice(0, ARAMA_EN_COK), total: kural.total + digerleri.length };
}
