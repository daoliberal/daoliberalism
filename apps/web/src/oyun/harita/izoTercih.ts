/**
 * Görünüm modu kararı (saf) ve tercih okuma. Mod yalnız `useGorunumModu` içinde çözülür.
 * Varsayılan `izo`; klasik ("Sade") `?gorunum=klasik` bayrağı ya da kayıtlı tercihle seçilir (tercih `useOyunTercihleri`'nde: `oyun.gorunum`).
 */
export type GorunumModu = "izo" | "klasik";
export type GorunumGirdisi = {
  webgl: boolean;
  manifest: "yukleniyor" | "hazir" | "hata";
  /** Kullanıcının kayıtlı tercihi (yoksa null). */
  tercih: GorunumModu | null;
  /** Bir sprite/manifest hatası bildirildi: oturum boyunca klasik. */
  spriteHatasi: boolean;
  /** `?gorunum=` bağlantı bayrağı. */
  urlBayragi: GorunumModu | null;
};

/** Hangi modun istendiği: bağlantı bayrağı tercihi geçer; ikisi de yoksa varsayılan izo (K3). */
export function istenenMod(g: Pick<GorunumGirdisi, "tercih" | "urlBayragi">): GorunumModu {
  return g.urlBayragi ?? g.tercih ?? "izo";
}

/** Manifest çekilmeli mi? Yalnız izo isteniyor, WebGL var ve hata bildirilmemişken. */
export function manifestIstenir(g: Pick<GorunumGirdisi, "webgl" | "tercih" | "urlBayragi" | "spriteHatasi">): boolean {
  return g.webgl && !g.spriteHatasi && istenenMod(g) === "izo";
}

export function gorunumModu(g: GorunumGirdisi): GorunumModu | "bekle" {
  if (!g.webgl || g.spriteHatasi) return "klasik";
  if (istenenMod(g) !== "izo") return "klasik";
  if (g.manifest === "hata") return "klasik";
  return g.manifest === "hazir" ? "izo" : "bekle";
}

/** `location.search` içindeki `gorunum` değeri (yalnız "izo" | "klasik"). */
export function urlBayragiOku(arama: string): GorunumModu | null {
  const v = new URLSearchParams(arama).get("gorunum");
  return v === "izo" || v === "klasik" ? v : null;
}

export type AnimasyonGirdisi = {
  /** Sistem `prefers-reduced-motion` VEYA uygulama içi "Hareketi azalt" (çözümlenmiş: `useOyunTercihleri().etkinAzalt`). */
  etkinAzalt: boolean;
  /** Uygulama içi "Düşük performans" tercihi. */
  dusukPerformans: boolean;
  /** Sekme görünür mü (`document.visibilityState`). */
  sekmeGorunur: boolean;
};

/** Animasyon modu: yalnız hareket serbest, performans düşük değil ve sekme görünürken `tam`; aksi halde `kapali` (durumlar statik okunur). */
export function animasyonModu(g: AnimasyonGirdisi): "kapali" | "tam" {
  return g.etkinAzalt || g.dusukPerformans || !g.sekmeGorunur ? "kapali" : "tam";
}
