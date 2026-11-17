import { same } from "./hints";
import { formatValue } from "./formatValue";
import type { Registry, ValuesPatch } from "./types";

/** Koşuyu "yeni ölçüm" yapabilen kartlar: kapsam sunucudan gelir (kayıttaki `new_measurement`, tek tanım `plan.DECISIONS`: D7, D9, D10, D11 kartları; D9'un etkin hane geliri kartları dahil). */
export const kurulumKartlari = (registry: Registry) => registry.cards.filter((c) => c.new_measurement === true);

/** Varsayılandan farklı seçilen kurulum kartları ve değer metinleri (Sonuç ekranı). Değerler koşunun şartından (yoksa kart varsayılanı) okunur. */
export function kurulumDegerleri(registry: Registry, values: ValuesPatch): { id: string; ad: string; deger: string }[] {
  const out: { id: string; ad: string; deger: string }[] = [];
  for (const c of kurulumKartlari(registry)) {
    if (!(c.id in values)) continue;
    const v = values[c.id]!;
    if (same(c.kind, v, c.default)) continue;
    out.push({ id: c.id, ad: c.title, deger: formatValue(c.control, v, registry.units) });
  }
  return out;
}

/** Eski iki para kartı (şehir kasası kuralı, kâr firmada kalır) açıkken Paranın devri kartı bugünkü seçimde kalmışsa gösterim çelişir (D11 I2): not gerekir. */
export function paraDevriCelisiyor(values: ValuesPatch): boolean {
  const acik = (id: string) => {
    const v = values[id];
    return typeof v === "object" && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).acik === true;
  };
  const devir = values.para_devresi;
  return (devir === undefined || devir === "kasa_biriktirir") && (acik("sehir_kasasi_kurali") || acik("kar_firmada_kalir"));
}
