import type { LockReason, RuleCardState } from "@/oyun/ui/RuleCard";
import { isInfoCard } from "@/oyun/ui/RuleCard";
import { same } from "@/oyun/sim/hints";
import { formatValue } from "@/oyun/sim/formatValue";
import type { Registry, RegistryCard, RunState, SettingAvail, UIValue, ValuesPatch } from "@/oyun/sim/types";

/** Düzenleyicinin iki kipi: Kurucu (`builder`, koşu başlarken) ve koşu ortası (`live`). */
export type SartKipi = "builder" | "live";

/** A katmanı (Kurallar) kartı: oyuncunun Şartına giren kural. B (insanlar) ve C (piyasa) katmanları başka görevlerdedir. */
export const KURAL_KATMANI = "P";
export const isKural = (card: RegistryCard): boolean => card.layer === KURAL_KATMANI;

/** Şablonun doldurduğu tam taban: her kart için şablon değeri, yoksa kartın varsayılanı. */
export function sartTabani(registry: Registry, templateValues: ValuesPatch): ValuesPatch {
  const out: ValuesPatch = {};
  for (const c of registry.cards) out[c.id] = c.id in templateValues ? templateValues[c.id]! : c.default;
  return out;
}

/** Tabandan farklı kartlar (kayıt sırasıyla). */
export function sartFarki(registry: Registry, base: ValuesPatch, draft: ValuesPatch): { id: string; from: UIValue; to: UIValue }[] {
  const out: { id: string; from: UIValue; to: UIValue }[] = [];
  for (const c of registry.cards) {
    const from = c.id in base ? base[c.id]! : c.default;
    const to = c.id in draft ? draft[c.id]! : c.default;
    if (!same(c.kind, from, to)) out.push({ id: c.id, from, to });
  }
  return out;
}

/** Kurucu taslağının saklanan biçimi: yalnız tabandan farklı değerler. */
export function sartYamasi(registry: Registry, base: ValuesPatch, draft: ValuesPatch): ValuesPatch {
  const patch: ValuesPatch = {};
  for (const d of sartFarki(registry, base, draft)) patch[d.id] = d.to;
  return patch;
}

export type KartDurumu = { state: RuleCardState; lockReason?: LockReason };

/**
 * Kart durumu (DK-17). Öncelik: salt okunur bilgi kartı, `apply: "unknown"` (her yerde kilitli, doğrulanmadı), pasif,
 * modelde sabit, kaynağın bildirdiği neden (`settings[].changeable === false`), koşu ortasında `start_only`.
 * Kurucu'da `start_only` açıktır.
 */
export function kartDurumu(card: RegistryCard, mode: SartKipi, setting?: SettingAvail): KartDurumu {
  if (isInfoCard(card)) return { state: "active" };
  if (card.apply === "unknown") return { state: "locked", lockReason: "unverified" };
  if (card.status === "passive" || card.apply === "passive") return { state: "passive", lockReason: "passive" };
  if (!card.editable) return { state: "locked", lockReason: "fixed" };
  if (setting?.changeable === false) {
    switch (setting.reason) {
      case "no_recording": return { state: "locked", lockReason: "no_recording" };
      case "passive": return { state: "passive", lockReason: "passive" };
      case "unverified": return { state: "locked", lockReason: "unverified" };
      case "start_only":
        if (mode === "live") return { state: "locked", lockReason: "start_only" };
        break;
      case "no_cash_floor": return { state: "locked", lockReason: "no_cash_floor" };
      default: return { state: "locked", lockReason: "locked" };
    }
  }
  if (mode === "live" && card.apply === "start_only") return { state: "locked", lockReason: "start_only" };
  return { state: "active" };
}

/**
 * Koşu durumunun bildirdiği bağlam kilitlerini (`RunState.settingLocks`: koşunun kuruluşundan gelen, koşu ortasında kapalı kartlar) ayarlara işler:
 * var olan ayar `changeable: false` + nedenle işaretlenir (seçenekleri korunur), olmayan eklenir. Kilit yoksa aynı liste döner.
 */
export function baglamKilitleri(settings: SettingAvail[], locks: RunState["settingLocks"]): SettingAvail[] {
  if (locks === undefined || locks.length === 0) return settings;
  const kilitli = new Map(locks.map((l) => [l.id, l.reason]));
  const out = settings.map((s) => (kilitli.has(s.id) ? { ...s, changeable: false, reason: kilitli.get(s.id)! } : s));
  for (const [id, reason] of kilitli) if (!settings.some((s) => s.id === id)) out.push({ id, options: [], changeable: false, reason });
  return out;
}

/** Düzenlenebilir durumdaki kart mı (değeri taslakta değişebilir). */
export const degisebilir = (d: KartDurumu, card: RegistryCard): boolean => d.state === "active" && !isInfoCard(card);

/** Başlat'a, kullanılabilirlik denetimine ve "değiştirdiğin" şeridine giren kart: tek ortak süzgeç (kilit nedeni dahil). */
export const gonderilebilirMi = (card: RegistryCard, mode: SartKipi, setting?: SettingAvail): boolean => {
  const d = kartDurumu(card, mode, setting);
  return degisebilir(d, card);
};

/**
 * Taslak yamasını kaynağa göre süzer: kayıtta olmayan kimlik ve düzenlenemeyen (kilitli, pasif, doğrulanmamış, salt okunur) kart düşer.
 * `dropped` düşenlerin kimlikleridir (kullanıcıya bildirilir).
 */
export function taslagiSuz(registry: Registry, mode: SartKipi, settings: SettingAvail[], patch: ValuesPatch): { kept: ValuesPatch; dropped: string[] } {
  const kept: ValuesPatch = {};
  const dropped: string[] = [];
  for (const [id, v] of Object.entries(patch)) {
    const card = registry.cards.find((c) => c.id === id);
    if (card && gonderilebilirMi(card, mode, settings.find((x) => x.id === id))) kept[id] = v;
    else dropped.push(id);
  }
  return { kept, dropped };
}

export type SartGrubu = { id: string; title: string; hint?: string; cards: RegistryCard[] };
export const DIGER_GRUP = "_diger";

/** Kural kartlarının grupları: kayıttaki grup sırasıyla; grubu kayıtta olmayan kartlar "Diğer"e düşer, boş grup çıkmaz. */
export function sartGruplari(registry: Registry, digerBaslik: string): SartGrubu[] {
  const cards = registry.cards.filter(isKural);
  const known = new Set(registry.groups.map((g) => g.id));
  const out: SartGrubu[] = [...registry.groups]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ id: g.id, title: g.title, ...(g.hint === undefined ? {} : { hint: g.hint }), cards: cards.filter((c) => c.group === g.id) }));
  const diger = cards.filter((c) => !known.has(c.group));
  if (diger.length > 0) out.push({ id: DIGER_GRUP, title: digerBaslik, cards: diger });
  return out.filter((g) => g.cards.length > 0);
}

/** Aramada karşılaştırma biçimi: Türkçe küçük harf (İ/i, I/ı) ve aksansız (ç, ğ, ı, ö, ş, ü). */
export function katla(text: string): string {
  return text.toLocaleLowerCase("tr").replace(/[çğıöşüâîû]/g, (ch) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" })[ch] ?? ch);
}

export type AramaSonucu = { card: RegistryCard; group: SartGrubu };

export const ARAMA_EN_AZ = 2;
export const ARAMA_EN_COK = 12;

/** Başlık, eski ad (`aliases`) ve grup adıyla arar; başlık ve eski ad eşleşmeleri grup adı eşleşmelerinden önce gelir. */
export function sartAra(groups: SartGrubu[], query: string): { results: AramaSonucu[]; total: number } {
  const q = katla(query.trim());
  if ([...q].length < ARAMA_EN_AZ) return { results: [], total: 0 };
  const own: AramaSonucu[] = [];
  const byGroup: AramaSonucu[] = [];
  for (const g of groups) {
    const groupHit = katla(g.title).includes(q);
    for (const card of g.cards) {
      if ([card.title, ...(card.aliases ?? [])].some((x) => katla(x).includes(q))) own.push({ card, group: g });
      else if (groupHit) byGroup.push({ card, group: g });
    }
  }
  const all = [...own, ...byGroup];
  return { results: all.slice(0, ARAMA_EN_COK), total: all.length };
}

/** Taslak farkının kullanıcı metni: "eski → yeni". */
export const degerMetni = (registry: Registry, card: RegistryCard, v: UIValue): string => formatValue(card.control, v, registry.units);
