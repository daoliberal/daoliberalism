import type { CopyKey } from "@/oyun/copy/t";
import { COKUS_ESIK, COKUS_ILK_HAFTA } from "@/oyun/sim/eventRules";
import type { JobRecipe, Registry, RegistryCard, RunConfig, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { degerMetni } from "@/oyun/screens/sart/sartMantik";


/** Seri üzerinden çöküş haftası (iş üyeleri için: yalnız özet seriler gelir, olay yoktur); yoksa `null`. */
export function seriCokusu(served: (number | null)[]): number | null {
  for (let i = 0; i < served.length; i += 1) {
    const v = served[i];
    if (i + 1 > COKUS_ILK_HAFTA && typeof v === "number" && v < COKUS_ESIK) return i + 1;
  }
  return null;
}

/** En çok bir ondalık, Türkçe ayraçla ("56,5"); tam sayıda ondalık yok. */
export const ondalik = (x: number): string => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1, useGrouping: false }).format(x);

/** İki ondalığa AŞAĞI yuvarlar ("1,96"): eşik karşılaştırmasıyla gösterim çelişmesin (1,96 "2" görünüp "tutturulamadı" demesin). */
export const ondalikAsagi = (x: number): string => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, useGrouping: false }).format(Math.floor(x * 100 + 1e-9) / 100);

const medyan = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 === 1 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};

/** Altı dünya özeti: çöken dünya sayısı, medyan ve en erken çöküş haftası. */
export function dunyaOzeti(lines: { served: (number | null)[] }[]): { n: number; c: number; medyan: number | null; enErken: number | null; hafta: number } {
  const cokusler = lines.map((l) => seriCokusu(l.served)).filter((x): x is number => x !== null);
  return {
    n: lines.length, c: cokusler.length,
    medyan: cokusler.length > 0 ? medyan(cokusler) : null,
    enErken: cokusler.length > 0 ? Math.min(...cokusler) : null,
    hafta: lines.length > 0 ? Math.min(...lines.map((l) => l.served.length)) : 0,
  };
}

/** Başlangıç dünyasının adı: kayıttaki `dunya_tohumu` seçeneği, yoksa "Dünya N". */
export function dunyaAdi(registry: Registry | null, index: number, yedek: (n: number) => string): string {
  const card = registry?.cards.find((c) => c.id === "dunya_tohumu");
  const o = card?.control.type === "options" ? card.control.options.find((x) => x.value === index) : undefined;
  return o?.label ?? yedek(index + 1);
}

/** Tarif (`tarifOf` çıktısı) iş gövdesine: takvim yapılandırmadan ayrılır, `fastForwardTo` iş için anlamsızdır. */
export function isTarifi(cfg: RunConfig): JobRecipe {
  const { schedule, fastForwardTo, ...config } = cfg;
  void fastForwardTo;
  return { config, schedule: schedule ?? [] };
}

/** Üye hatasının neden kodu oyuncu diline çevrilir; bilinmeyen kod ham gösterilmez. */
const NEDEN: Record<string, CopyKey> = {
  model_error: "sonuc.hata.model_error", worker_crashed: "sonuc.hata.worker_crashed", stuck: "sonuc.hata.stuck",
};
export const nedenMetni = (kod: string | null): CopyKey => (kod !== null ? NEDEN[kod] : undefined) ?? "sonuc.hata.diger";

/** Anahtar sırasından bağımsız karşılaştırma için kanonik metin. */
function canon(v: UIValue | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify(v);
}

export type FarkSatiri = { id: string; ad: string; a: string; b: string };

/**
 * İki koşunun şart farkı: yalnız değeri farklı olan kartlar, kayıt sırasıyla. Eksik değer kartın varsayılanıdır.
 * Başlangıç dünyası listelenmez (A/B işi iki tarafı da A'nın dünyasında koşar).
 */
export function farkSatirlari(registry: Registry, a: ValuesPatch, b: ValuesPatch): FarkSatiri[] {
  const deger = (c: RegistryCard, v: ValuesPatch): UIValue => v[c.id] ?? c.default;
  return registry.cards
    .filter((c) => c.id !== "dunya_tohumu" && (c.id in a || c.id in b))
    .filter((c) => canon(deger(c, a)) !== canon(deger(c, b)))
    .map((c) => ({ id: c.id, ad: c.title, a: degerMetni(registry, c, deger(c, a)), b: degerMetni(registry, c, deger(c, b)) }));
}
