import type { CopyKey } from "@/oyun/copy/t";
import type { Registry, RegistryCard } from "@/oyun/sim/types";
import { isInfoCard } from "@/oyun/ui/RuleCard";

export type TurKatman = "kurallar" | "insanlar" | "piyasa";

/** Tur adımı: ya bir katmanı tanıtan giriş ya da bir kural kartı (kart metni kayıttan gelir, `textKey` yalnız çerçeve cümlesidir). */
export type TurAdimi =
  | { tur: "giris"; katman: TurKatman; baslikKey: CopyKey; textKey: CopyKey }
  | { tur: "kart"; cardId: string; textKey: CopyKey };

const KART_CERCEVE: CopyKey = "rehber.tur.kural_giris";

/** Tanıtılacak kartlar (veri): oyuncuya en çok dokunan, varsayılanı açık kurallar. Sıra `turAdimlari`'nda canlı değişebilenler öne alınarak korunur. */
const KART_KIMLIKLERI = [
  "gecis_destegi", "ucret_stopaji", "kurumlar_vergisi", "destek_tavani", "mevduat_nakit_rezervi", "itibar_sarti", "patent_suresi",
  "basim_tavani", "satis_vergisi", "issizlik_odenegi",
] as const;

const GIRISLER: { katman: TurKatman; baslikKey: CopyKey; textKey: CopyKey; var: (r: Registry) => boolean }[] = [
  { katman: "kurallar", baslikKey: "sart.katman_kurallar", textKey: "rehber.tur.giris.kurallar", var: () => true },
  { katman: "insanlar", baslikKey: "sart.katman_insanlar", textKey: "rehber.tur.giris.insanlar", var: (r) => r.cards.some((c) => c.layer === "V") },
  { katman: "piyasa", baslikKey: "sart.katman_piyasa", textKey: "rehber.tur.giris.piyasa", var: (r) => r.cards.some((c) => c.layer === "S") },
];

/** Turda gösterilebilir kart: kayıtta var, kural katmanında, düzenlenebilir, etkin, doğrulanmış (bilinmeyen ve pasif kart anlatılmaz). */
const gosterilebilir = (c: RegistryCard | undefined): c is RegistryCard =>
  c !== undefined && c.layer === "P" && c.editable && c.status === "active" && c.level !== "U" && c.apply !== "unknown" && c.apply !== "passive" && !isInfoCard(c);

const canliDegisir = (c: RegistryCard): boolean => c.apply === "live" || c.apply === "live_sync";

/**
 * Kayıttan doğrulanmış tur adımları: katman girişleri, sonra kartlar. Kayıtta olmayan ya da anlatılamayacak kartın adımı atlanır.
 * Oyun akarken değiştirilebilen (canlı) kartlar öne, yalnız yeni koşuda değişenler (`start_only`) sonra gelir.
 */
export function turAdimlari(registry: Registry): TurAdimi[] {
  const girisler = GIRISLER.filter((g) => g.var(registry)).map((g): TurAdimi => ({ tur: "giris", katman: g.katman, baslikKey: g.baslikKey, textKey: g.textKey }));
  const kartlar = KART_KIMLIKLERI.flatMap((id) => {
    const c = registry.cards.find((x) => x.id === id);
    return gosterilebilir(c) ? [c] : [];
  });
  const sirali = [...kartlar.filter(canliDegisir), ...kartlar.filter((c) => !canliDegisir(c))];
  return [...girisler, ...sirali.map((c): TurAdimi => ({ tur: "kart", cardId: c.id, textKey: KART_CERCEVE }))];
}

/**
 * "Bu kuralı değiştir" hedefi: yalnız olayın kural kimliklerinden kayıtta kural kartı olan ilki (kart `start_only` ise editör kilit nedenini gösterir).
 * Çözülmüyorsa `null`: yedek kart seçilmez, editör hedefsiz açılır. Bugün kritik olaylar olay kuralı kimliği (`cokus` vb.) taşır, kart kimliği değil.
 */
export function degistirHedefi(registry: Registry | null, ruleIds: readonly string[]): RegistryCard | null {
  if (registry === null) return null;
  for (const id of ruleIds) {
    const c = registry.cards.find((x) => x.id === id);
    if (c !== undefined && c.layer === "P" && c.editable && c.status === "active" && c.apply !== "unknown" && c.apply !== "passive") return c;
  }
  return null;
}
