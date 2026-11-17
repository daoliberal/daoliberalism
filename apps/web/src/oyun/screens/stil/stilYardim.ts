/** `#/stil` önizleme sayfasının yardımcıları (React yok). */

/** Üretimde yalnız `?stil=1` ile (adres sorgusunda ya da `#/stil?stil=1` biçiminde) açılır; geliştirmede hep açık. */
export function stilAcik(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const hash = window.location.hash;
  const hashSorgu = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(window.location.search).get("stil") === "1" || new URLSearchParams(hashSorgu).get("stil") === "1";
}

/**
 * Sayfadaki stil sayfalarından `.kok` sınıfı kurallarında tanımlı özel özellik (takma ad) adlarını okur.
 * `kokSinifi`: CSS modülünün `kok` sınıf adı (derlemede özet eklenmiş olabilir). Okunamayan sayfalar atlanır.
 */
export function kokTakmaAdlari(sayfalar: StyleSheetList, kokSinifi: string): string[] {
  const hedef = `.${CSS_KACIS(kokSinifi)}`;
  const adlar: string[] = [];
  for (const sayfa of Array.from(sayfalar)) {
    let kurallar: CSSRuleList;
    try {
      kurallar = sayfa.cssRules;
    } catch {
      continue;
    }
    for (const kural of Array.from(kurallar)) {
      if (!(kural instanceof CSSStyleRule) || !kural.selectorText.split(",").some((s) => s.trim() === hedef)) continue;
      for (const ad of Array.from(kural.style)) if (ad.startsWith("--") && !adlar.includes(ad)) adlar.push(ad);
    }
  }
  return adlar;
}

const CSS_KACIS = (s: string): string => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s);
