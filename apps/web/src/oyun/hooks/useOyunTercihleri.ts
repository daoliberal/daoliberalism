"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { NARROW_QUERY } from "@/components/shell/useIsNarrow";
import { spriteHatasiYaz, urlBayraginiTemizle } from "@/oyun/harita/gorunumDurumu";
import type { GorunumModu } from "@/oyun/harita/izoTercih";
import { manifestHatasiniSifirla } from "@/oyun/harita/useSpriteManifest";

export type Tema = "light" | "dark";

const KEY_TEMA = "oyun.tema";
const KEY_HAREKET = "oyun.hareket";
const KEY_DUSUK = "oyun.dusukPerformans";
const KEY_GORUNUM = "oyun.gorunum";
const REDUCE_QUERY = "(prefers-reduced-motion:reduce)";

function oku(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function yaz(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // depolama kapalı ya da dolu: tercih yalnız bu oturumda geçerli kalır
    return false;
  }
}

const dinleyiciler = new Set<() => void>();
const bildir = (): void => {
  for (const l of [...dinleyiciler]) l();
};
/** Oturum içi yedek: depolama yazılamıyorsa düğme yine de çalışır. */
let oturumAzalt: boolean | null = null;
let oturumDusuk: boolean | null = null;
let oturumGorunum: GorunumModu | null | undefined;

const media = (q: string): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null;

function subscribeTema(onChange: () => void): () => void {
  dinleyiciler.add(onChange);
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    dinleyiciler.delete(onChange);
    obs.disconnect();
  };
}
const temaAl = (): Tema => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function subscribeAzalt(onChange: () => void): () => void {
  dinleyiciler.add(onChange);
  return () => void dinleyiciler.delete(onChange);
}
const azaltAl = (): boolean => oturumAzalt ?? oku(KEY_HAREKET) === "azalt";

/** Kayıtlı görünüm tercihi (`oyun.gorunum`): "izo" | "klasik"; belirtilmemiş ya da geçersiz = null (varsayılanı `istenenMod` belirler). */
export function gorunumTercihiOku(): GorunumModu | null {
  if (oturumGorunum !== undefined) return oturumGorunum;
  const v = oku(KEY_GORUNUM);
  return v === "izo" || v === "klasik" ? v : null;
}

/** Yalnız okuma: görünüm tercihi (`useOyunTercihleri` ile aynı depo; değişince abone yeniden çizilir). */
export function useGorunumTercihi(): GorunumModu | null {
  return useSyncExternalStore(subscribeAzalt, gorunumTercihiOku, () => null);
}

const dusukAl = (): boolean => oturumDusuk ?? oku(KEY_DUSUK) === "1";

function subscribeSistem(onChange: () => void): () => void {
  const m = media(REDUCE_QUERY);
  m?.addEventListener("change", onChange);
  return () => m?.removeEventListener("change", onChange);
}
const sistemAl = (): boolean => media(REDUCE_QUERY)?.matches ?? false;

/**
 * Yalnız okuma: animasyon kararı için hareket ve performans tercihleri (`useOyunTercihleri` ile aynı depolar; efekt/dinleyici kurmaz).
 * `etkinAzalt`: sistem `prefers-reduced-motion` VEYA uygulama içi "Hareketi azalt".
 */
export function useAnimasyonTercihi(): { etkinAzalt: boolean; dusukPerformans: boolean } {
  const azalt = useSyncExternalStore(subscribeAzalt, azaltAl, () => false);
  const sistem = useSyncExternalStore(subscribeSistem, sistemAl, () => false);
  const dusukPerformans = useSyncExternalStore(subscribeAzalt, dusukAl, () => false);
  return { etkinAzalt: azalt || sistem, dusukPerformans };
}

/** Kayıtlı tema tercihi varsa `<html data-theme>`'e yazar. */
function temaUygula(): void {
  const p = oku(KEY_TEMA);
  if (p === "light" || p === "dark") document.documentElement.dataset.theme = p;
}

/**
 * Tema ve "Hareketi azalt" tercihleri (DK-16). Tema sitenin `data-theme` özniteliğine yazılır (site dosyası değişmez) ve
 * `localStorage`'da tutulur; `useIsNarrow` eşik geçişinde kendi temasını yazınca tercih, ondan sonra kaydolan bu dinleyiciyle yeniden uygulanır
 * (bu kanca `useIsNarrow`'dan SONRA çağrılmalıdır). Hareket azaltma `prefers-reduced-motion` ya da yerel tercihle etkindir.
 */
export function useOyunTercihleri(): {
  tema: Tema;
  toggleTema(): void;
  /** Kullanıcının düğme tercihi. */
  azalt: boolean;
  /** Düğme ya da sistem tercihi: kökteki `data-hareket="azalt"` buna bağlıdır. */
  etkinAzalt: boolean;
  toggleAzalt(): void;
  /** "Düşük performans": harita animasyonları (duman, geçişler) kapanır. */
  dusukPerformans: boolean;
  toggleDusukPerformans(): void;
  /** Görünüm tercihi: "izo" (Şehir, yeni), "klasik" (Sade, eski) ya da belirtilmemiş (null). */
  gorunum: GorunumModu | null;
  setGorunum(g: GorunumModu): void;
} {
  const tema = useSyncExternalStore(subscribeTema, temaAl, () => "light" as Tema);
  const azalt = useSyncExternalStore(subscribeAzalt, azaltAl, () => false);
  const sistem = useSyncExternalStore(subscribeSistem, sistemAl, () => false);
  const dusukPerformans = useSyncExternalStore(subscribeAzalt, dusukAl, () => false);
  const gorunum = useGorunumTercihi();

  useEffect(() => {
    temaUygula();
    const m = media(NARROW_QUERY);
    m?.addEventListener("change", temaUygula);
    return () => m?.removeEventListener("change", temaUygula);
  }, []);

  const toggleTema = useCallback(() => {
    const next: Tema = temaAl() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    yaz(KEY_TEMA, next);
    bildir();
  }, []);
  const toggleAzalt = useCallback(() => {
    const next = !azaltAl();
    oturumAzalt = next;
    yaz(KEY_HAREKET, next ? "azalt" : "tam");
    bildir();
  }, []);

  const toggleDusukPerformans = useCallback(() => {
    const next = !dusukAl();
    oturumDusuk = next;
    yaz(KEY_DUSUK, next ? "1" : "0");
    bildir();
  }, []);

  const setGorunum = useCallback((g: GorunumModu) => {
    // Açık seçim bağlantı bayrağını geçersiz kılar; "Şehir" seçimi önceki sprite/manifest hatasını sıfırlayıp yeniden dener.
    urlBayraginiTemizle();
    if (g === "izo") {
      spriteHatasiYaz(false);
      manifestHatasiniSifirla();
    }
    oturumGorunum = yaz(KEY_GORUNUM, g) ? undefined : g;      // oturum değeri yalnız depolama yazılamazken esastır
    bildir();
  }, []);

  return { tema, toggleTema, azalt, etkinAzalt: azalt || sistem, toggleAzalt, dusukPerformans, toggleDusukPerformans, gorunum, setGorunum };
}
