import { t } from "@/oyun/copy/t";
import { DUNYA_ADLARI, SEHIR_ADLARI } from "@/oyun/copy/isimler";
import { MAX_AD_UZUNLUK } from "@/oyun/lib/sinirlar";

/** Ad alanları: baştaki/sondaki boşluk kırpılır, art arda boşluklar teke iner. Uzunluk kod noktasıyla sayılır. */
/** Sunucunun koşu adı sınırıyla (`lib/sinirlar.ts`) aynı: daha uzun ad sunucuda reddedilir. */
export const MAX_WORLD_NAME = MAX_AD_UZUNLUK;
export const MAX_CITY_NAME = 40;

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function codePoints(s: string): number {
  return [...s].length;
}

/** En çok `n` kod noktası bırakır (sunucu uzunluğu kod noktasıyla sayar; `maxLength` UTF-16 birimi saydığı için emojili adlarda ayrışır). */
export function kodNoktasinaKes(s: string, n: number): string {
  const cp = [...s];
  return cp.length <= n ? s : cp.slice(0, n).join("");
}

/** Şehir adını gösterim için verir: boş ya da yalnız boşluksa "Şehir N" (index 0 tabanlı). Tüm ekranlar bunu kullanır. */
export function cityDisplayName(name: string, index: number): string {
  const clean = normalizeName(name);
  return clean === "" ? t("kurucu.sehir_adi", { n: index + 1 }) : clean;
}

export type Rng = () => number;

/** Rastgele dünya adı ve 5 farklı şehir adı. `previous` verilirse dünya adı ondan farklı olur ve şehir kümesi aynı çıkmaz. */
export function randomNames(
  rng: Rng = Math.random,
  previous?: { world: string; cities: string[] },
): { world: string; cities: string[] } {
  const pick = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
  const worlds = DUNYA_ADLARI.filter((w) => w !== previous?.world);
  const world = worlds[pick(worlds.length)];
  const prevKey = previous ? [...previous.cities].sort().join("|") : null;
  for (let attempt = 0; ; attempt++) {
    const pool = [...SEHIR_ADLARI];
    const cities: string[] = [];
    for (let i = 0; i < 5; i++) cities.push(pool.splice(pick(pool.length), 1)[0]);
    // Kümenin önceki ile aynı çıkması pratikte imkânsız; yine de sınırlı yeniden deneme.
    if (prevKey === null || [...cities].sort().join("|") !== prevKey) return { world, cities };
    if (attempt >= 20) {
      // Bozuk/sabit rng: kümeyi garanti farklı kılmak için son şehri kullanılmayan birine çevir.
      cities[4] = SEHIR_ADLARI.find((c) => !cities.includes(c)) as string;
      return { world, cities };
    }
  }
}
