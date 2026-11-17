const DASH = "–";

/** Binlik nokta ile tam sayı; ölçülmeyen değer "–". Ayırıcı elle konur (tr-TR 4 haneli sayıda ayırıcı kullanmaz). */
export function num(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return DASH;
  return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Oran (0,0031) -> "%0,31". `digits` verilmezse en çok 2 ondalık. */
export function pct(x: number | null, digits?: number): string {
  if (x === null || !Number.isFinite(x)) return DASH;
  const f = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
    useGrouping: false,
  });
  return `%${f.format(x * 100)}`;
}
