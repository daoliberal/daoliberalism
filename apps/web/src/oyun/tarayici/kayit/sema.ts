/** tel_b4.json tur dizgelerini yorumlayan kucuk dogrulayici (ek bagimlilik yok). Hata yollari `a.b[3]` bicimindedir; deger icerigi hata metnine konmaz. */

export type SemaTuru = string | readonly [SemaTuru] | { readonly [anahtar: string]: SemaTuru };

export interface SemaSecenek {
  /** true: sema disi anahtar hatadir (varsayilan). false: yok sayilir (icerik duzenleyen kopyalar bu kipi kullanir). */
  siki?: boolean;
}

const AZAMI_DERINLIK = 64;

function sade(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function temel(tur: string, x: unknown): boolean {
  switch (tur) {
    case "int":
      return typeof x === "number" && Number.isInteger(x);
    case "num":
      return typeof x === "number" && Number.isFinite(x);
    case "str":
      return typeof x === "string";
    case "bool":
      return typeof x === "boolean";
    case "null":
      return x === null;
    case "dict":
      return sade(x);
    case "list":
      return Array.isArray(x);
    default:
      return false;
  }
}

function dolas(sema: SemaTuru, x: unknown, yol: string, siki: boolean, hatalar: string[], derinlik: number): void {
  if (derinlik > AZAMI_DERINLIK) {
    hatalar.push(yol + ":derin");
    return;
  }
  if (typeof sema === "string") {
    if (!sema.split("|").some((t) => temel(t, x))) hatalar.push(yol + ":tur");
    return;
  }
  if (Array.isArray(sema)) {
    if (!Array.isArray(x)) {
      hatalar.push(yol + ":liste");
      return;
    }
    const oge = sema[0] as SemaTuru;
    x.forEach((v, i) => dolas(oge, v, yol + "[" + i + "]", siki, hatalar, derinlik + 1));
    return;
  }
  if (!sade(x)) {
    hatalar.push(yol + ":nesne");
    return;
  }
  const s = sema as { readonly [anahtar: string]: SemaTuru };
  const bilinen = new Set<string>();
  for (const ham of Object.keys(s)) {
    const istege = ham.endsWith("?");
    const ad = istege ? ham.slice(0, -1) : ham;
    bilinen.add(ad);
    if (!Object.prototype.hasOwnProperty.call(x, ad)) {
      if (!istege) hatalar.push(yol + "." + ad + ":yok");
      continue;
    }
    dolas(s[ham] as SemaTuru, x[ad], yol + "." + ad, siki, hatalar, derinlik + 1);
  }
  if (siki) for (const ad of Object.keys(x)) if (!bilinen.has(ad)) hatalar.push(yol + "." + ad + ":fazla");
}

/** Hata yollarini dondurur; bos liste = uygun. */
export function semaHatalari(sema: SemaTuru, deger: unknown, secenek: SemaSecenek = {}): string[] {
  const hatalar: string[] = [];
  dolas(sema, deger, "$", secenek.siki !== false, hatalar, 0);
  return hatalar;
}

export function semayaUyar(sema: SemaTuru, deger: unknown, secenek: SemaSecenek = {}): boolean {
  return semaHatalari(sema, deger, secenek).length === 0;
}
