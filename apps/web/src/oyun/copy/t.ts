import { tr } from "./tr";
import { tarayiciMetinleri } from "./tarayici";

/** Derleme zamani sabiti; bu modulde yerel tanimli (bayraksiz derlemede tarayici metinleri budanir). */
const TARAYICI = process.env.NEXT_PUBLIC_OYUN_KAYNAK === "tarayici";

export type CopyKey = keyof typeof tr;

/** Metni anahtarla getirir; `{ad}` yer tutucuları `params` ile doldurulur. Tarayıcı derlemesinde "sunucu" diyen birkaç metin tarayıcı karşılığıyla değişir (`copy/tarayici.ts`). */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const raw: string = (TARAYICI ? tarayiciMetinleri[key] : undefined) ?? tr[key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}
