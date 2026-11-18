/**
 * B8: cihaz algilama ve "bir kez kapat" tercihleri. Telefon/tablet uyarisi oyunu ENGELLEMEZ; yanlis pozitifte yalniz bir bilgi bandi cikar, kapatilabilir ve
 * tercih hatirlanir (`localStorage`, her erisim try/catch: erisilemezse uyari her acilista bir kez gorunur).
 */
export const CIHAZ_ANAHTARI = "daoliberalism.cihaz.uyari.kapali";
export const SAFARI_ANAHTARI = "daoliberalism.safari.serit.kapali";
export interface CihazOrtami {
  matchMedia?(sorgu: string): { matches: boolean };
  userAgentData?: { mobile?: boolean } | undefined;
  /** iPadOS Safari masaustu kimligiyle gelir (`Macintosh`) ama cok noktali dokunmatiktir. */
  maxTouchPoints?: number;
  userAgent?: string;
}

/**
 * Telefon/tablet: `userAgentData.mobile`, ya da birincil girdi dokunmatik ve ustune gelme yok (`(pointer:coarse)` ve `(hover:none)`: genislikten bagimsiz,
 * buyuk tabletler yatayda da yakalanir), ya da iPadOS masaustu kimligi (`Macintosh` + 2'den fazla dokunma noktasi).
 */
export function dokunmatikDarMi(o: CihazOrtami): boolean {
  if (o.userAgentData?.mobile === true) return true;
  if (typeof o.matchMedia === "function" && o.matchMedia("(pointer:coarse)").matches && o.matchMedia("(hover:none)").matches) return true;
  return /Macintosh/.test(o.userAgent ?? "") && (o.maxTouchPoints ?? 0) > 1;
}

export function gercekCihazOrtami(): CihazOrtami {
  return {
    matchMedia: typeof window.matchMedia === "function" ? (q) => window.matchMedia(q) : undefined,
    userAgentData: (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData,
    maxTouchPoints: navigator.maxTouchPoints,
    userAgent: navigator.userAgent,
  };
}

/** Safari ve iOS'taki butun tarayicilar WebKit kullanir (7 gunluk veri silme kurali). */
export function webkitMi(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
}

export function cihazUyarisiKapali(anahtar: string): boolean {
  try {
    return window.localStorage.getItem(anahtar) === "1";
  } catch {
    return false;
  }
}

export function kapaliYaz(anahtar: string): void {
  try {
    window.localStorage.setItem(anahtar, "1");
  } catch {
    /* depolama yoksa yalniz bu acilista kapanir */
  }
}
