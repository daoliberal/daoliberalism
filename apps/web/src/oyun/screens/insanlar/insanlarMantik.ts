import { same } from "@/oyun/sim/hints";
import type { CopyKey } from "@/oyun/copy/t";
import type { Registry, RegistryCard, RegistryScenario, UIValue, ValuesPatch } from "@/oyun/sim/types";

/** B katmanı: dünyanın insanları (V). */
export const INSAN_KATMANI = "V";
/** Dünya kuralları: Y katmanı (salt okunur). */
export const DUNYA_KURALI_KATMANI = "Y";
export const OZEL_SENARYO = "ozel";
export const GERCEKCI_SENARYO = "gercekci";
export const DIGER_AKTOR = "_diger";

/** Prototipteki aktör sırası. Listede olmayan aktör "Diğer" sekmesine düşer: hiçbir V kartı ekrandan düşmez. */
export const AKTOR_SIRASI = ["hane", "girisimci", "isci", "yatirimci", "yerlesik", "dunya"] as const;

export const aktorBasligi = (id: string): CopyKey => (id === DIGER_AKTOR || !(AKTOR_SIRASI as readonly string[]).includes(id) ? "insanlar.aktor.diger" : (`insanlar.aktor.${id}` as CopyKey));

export type AktorGrubu = { id: string; cards: RegistryCard[] };

export const insanKartlari = (registry: Registry): RegistryCard[] => registry.cards.filter((c) => c.layer === INSAN_KATMANI);

/** Aktöre göre gruplar (boş aktör çıkmaz); bilinmeyen ya da boş aktör son sekmede toplanır. */
export function aktorGruplari(registry: Registry): AktorGrubu[] {
  const cards = insanKartlari(registry);
  const bilinen = new Set<string>(AKTOR_SIRASI);
  const out: AktorGrubu[] = AKTOR_SIRASI.map((id) => ({ id, cards: cards.filter((c) => c.actor === id) }));
  const diger = cards.filter((c) => c.actor === null || !bilinen.has(c.actor));
  if (diger.length > 0) out.push({ id: DIGER_AKTOR, cards: diger });
  return out.filter((g) => g.cards.length > 0);
}

export const senaryoOf = (registry: Registry, id: string | null): RegistryScenario | undefined => registry.scenarios.find((s) => s.id === (id ?? GERCEKCI_SENARYO));

/** Şu an gösterilen/uygulanan varsayım: Özel'de kullanıcının yamasından, hazır senaryoda senaryonun değerinden, yoksa modelin varsayılanından. Nesne değerler varsayılanla tamamlanır. */
export function guncelDeger(registry: Registry, card: RegistryCard, scenarioId: string | null, ozelDegerler: ValuesPatch): UIValue {
  const id = scenarioId ?? GERCEKCI_SENARYO;
  const kaynak = id === OZEL_SENARYO ? ozelDegerler : (senaryoOf(registry, id)?.values ?? {});
  const v = kaynak[card.id];
  if (v === undefined) return card.default;
  if (typeof v === "object" && !Array.isArray(v) && typeof card.default === "object" && !Array.isArray(card.default)) return { ...card.default, ...v };
  return v;
}

/** Özel senaryoda kilidi açılan kart: `scenario_editable` ve canlılığı doğrulanmış (`unknown` her yerde kilitli, DK-17) ve pasif değil. */
export const ozelAcikMi = (card: RegistryCard): boolean => card.scenario_editable && card.editable && card.apply !== "unknown" && card.apply !== "passive" && card.status !== "passive";

/** Özel senaryo yaması: modelin varsayılanına eşit değer yamada tutulmaz. */
export function ozelYama(card: RegistryCard, yama: ValuesPatch, v: UIValue): ValuesPatch {
  const kalan = Object.fromEntries(Object.entries(yama).filter(([id]) => id !== card.id));
  return same(card.kind, v, card.default) ? kalan : { ...kalan, [card.id]: v };
}

/** Başlat'a giden Özel yaması: yalnız şu an açık kartlar ve varsayılandan farklı değerler. */
export function ozelGonderilecek(registry: Registry, yama: ValuesPatch): ValuesPatch {
  const out: ValuesPatch = {};
  for (const [id, v] of Object.entries(yama)) {
    const c = registry.cards.find((x) => x.id === id);
    if (c && c.layer === INSAN_KATMANI && ozelAcikMi(c) && !same(c.kind, v, c.default)) out[id] = v;
  }
  return out;
}

/** Kartın etkisiz olduğu koşul (`effective_when`): koşuldaki kural kartlarından değeri tutmayanlar; hepsi tutuyorsa boş. */
export function etkisizKosullari(registry: Registry, card: RegistryCard, sart: ValuesPatch): { kart: RegistryCard; deger: UIValue }[] {
  const out: { kart: RegistryCard; deger: UIValue }[] = [];
  for (const [id, beklenen] of Object.entries(card.effective_when ?? {})) {
    const p = registry.cards.find((c) => c.id === id);
    if (!p) continue;
    const su = id in sart ? sart[id]! : p.default;
    if (!same(p.kind, su, beklenen)) out.push({ kart: p, deger: beklenen });
  }
  return out;
}

/** Senaryonun değiştirdiği satırların başlıkları (kayıt sırasıyla). */
export function senaryoSatirlari(registry: Registry, s: RegistryScenario): string[] {
  return Object.keys(s.values).map((id) => registry.cards.find((c) => c.id === id)?.title ?? id);
}
