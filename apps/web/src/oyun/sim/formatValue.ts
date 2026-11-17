import type { RegistryControl, UIValue } from "./types";

const YEARLY_FACTOR = 52;

/** Türkçe sayı biçimi: binlik nokta, ondalık virgül, en çok 6 ondalık, sondaki sıfırlar yok (Python `_num_text` ile aynı). */
export function numberText(x: number): string {
  let s = x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  const neg = s.startsWith("-");
  const [head = "0", frac] = (neg ? s.slice(1) : s).split(".");
  const grouped = head.replace(/\B(?=(\d{3})+$)/g, ".");
  return (neg ? "-" : "") + grouped + (frac ? `,${frac}` : "");
}

/** Birim şablonundan alan sonekini çıkarır: "%{n}" -> "%", "{n} Akçe" -> "Akçe", "%{n}/hafta (≈ …)" -> "%/hafta"; yalnız "{n}" -> "". */
export function unitSuffix(unit: string | null, words: Record<string, string>): string {
  const tpl = words[unit ?? "sayi"];
  if (tpl === undefined) return "";
  return tpl.replace(/\s*\(.*$/, "").replace("{n}", "").replace("{yillik}", "").trim();
}

/** Ayar değerini ekranda gösterilecek metne çevirir; Python `format_value` ile birebir (`registry_format_cases.json`). */
export function formatValue(control: RegistryControl, value: UIValue, words: Record<string, string>): string {
  switch (control.type) {
    case "options": {
      const hit = control.options.find((o) => o.value === value);
      return hit ? hit.label : String(value);
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      const tpl = words[control.unit ?? "sayi"] ?? "{n}";
      return tpl.replace("{n}", numberText(n)).replace("{yillik}", numberText(n * YEARLY_FACTOR));
    }
    case "fields": {
      const obj = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
      return control.fields.map((f) => `${f.label}: ${formatValue(f.control, (obj as Record<string, UIValue>)[f.key] as UIValue, words)}`).join("; ");
    }
    case "order":
    case "multi": {
      const list = Array.isArray(value) ? value : [];
      if (list.length === 0) return words.yok ?? "yok";
      return list.map((v) => control.items.find((i) => i.value === v)?.label ?? v).join(", ");
    }
  }
}
