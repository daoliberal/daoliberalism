import { formatValue } from "./formatValue";
import type { Registry, UIValue, ValuesPatch } from "./types";

/** Arayüz oyunu tek dünyada beş şehirle kurulur (sunucu `nufus.CITIES` ile aynı). */
export const SEHIR_SAYISI = 5;
export const OYUNCU_KARTI = "sehir_basina_oyuncu";
export const NPC_KARTI = "npc_nufusu";
export const KASA_KARTI = "baslangic_sehir_kasasi";
/**
 * Hız tahmini: sunucunun varsayılan dünyadaki hafta başına süre ölçümü (`/api/hello` `sec_per_week_p50`) oyuncu oranıyla ölçeklenir.
 * Gerçek model ölçümü (D4): 1.500 oyuncu 0,5 sn, 4.000 oyuncu 1,1 sn, 5.000 oyuncu 1,3-1,4 sn; NPC havuzu toplulaştırıldığı için süre
 * NPC sayısına neredeyse bağlı değildir. Üs 0,8 bu üç noktaya uyar; sonuç kabadır.
 */
export const VARSAYILAN_OYUNCU = 1500;
export const HIZ_USSU = 0.8;

export type Nufus = { sehirBasinaOyuncu: number; oyuncu: number; npc: number; toplam: number; kasa: number };

const sayi = (v: UIValue | undefined, yedek: number): number => (typeof v === "number" && Number.isFinite(v) ? v : yedek);

/** Taslak (yoksa kart varsayılanı) değerlerinden nüfus; kayıtta kartlar yoksa (eski kayıt) `null`. */
export function nufusHesabi(registry: Registry, values: ValuesPatch): Nufus | null {
  const o = registry.cards.find((c) => c.id === OYUNCU_KARTI);
  const n = registry.cards.find((c) => c.id === NPC_KARTI);
  const k = registry.cards.find((c) => c.id === KASA_KARTI);
  if (!o || !n || !k) return null;
  const al = (c: { id: string; default: UIValue }): UIValue => (c.id in values ? values[c.id]! : c.default);
  const ppc = sayi(al(o), 0);
  const npcV = al(n);
  const alan = (anahtar: string): number => (typeof npcV === "object" && !Array.isArray(npcV) ? sayi(npcV[anahtar], 0) : 0);
  const oyuncu = Math.trunc(ppc * SEHIR_SAYISI);
  const npc = Math.trunc(alan("taban") + alan("oyuncu_basina") * ppc * SEHIR_SAYISI);
  return { sehirBasinaOyuncu: ppc, oyuncu, npc, toplam: oyuncu + npc, kasa: sayi(al(k), 0) };
}

/** Tahmini hafta başına saniye; ölçüm yoksa `null`. */
export function tahminiSaniye(secPerWeekP50: number | null, oyuncu: number): number | null {
  if (secPerWeekP50 === null || !Number.isFinite(secPerWeekP50) || secPerWeekP50 <= 0 || oyuncu <= 0) return null;
  return secPerWeekP50 * Math.pow(oyuncu / VARSAYILAN_OYUNCU, HIZ_USSU);
}

/** Akçe tutarı kayıttaki birim şablonuyla ("500.000 Akçe"). */
export const akceMetni = (registry: Registry, x: number): string =>
  formatValue({ type: "number", min: 0, max: Math.max(x, 1), step: 1, unit: "akce", integer: true }, x, registry.units);
