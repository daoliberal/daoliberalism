/**
 * Rehber durumu: tur görüldü mü, hangi koşular rehberli, hangisi ilk kritik olayda durdu, hangi ipuçları kapatıldı.
 * `localStorage`'da tek anahtar; erişim her yerde try/catch. Depolama erişilemezse tur "görülmedi" sayılır (her seferinde önerilir);
 * koşu işaretleri o oturumda bellekte tutulur (aynı koşu tekrar tekrar durmasın), çökme yoktur.
 */
const KEY = "oyun.rehber";
const EN_COK = 40;
const EN_UZUN_KIMLIK = 200;

type Kayit = { tur: boolean; kosular: string[]; durakladi: string[]; ipuclari: string[] };
const bos = (): Kayit => ({ tur: false, kosular: [], durakladi: [], ipuclari: [] });

let yedek: Kayit | null = null;

const liste = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= EN_UZUN_KIMLIK).slice(-EN_COK) : []);

function coz(raw: string | null): Kayit {
  if (raw === null) return bos();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o === null || typeof o !== "object") return bos();
    return { tur: o.tur === true, kosular: liste(o.kosular), durakladi: liste(o.durakladi), ipuclari: liste(o.ipuclari) };
  } catch {
    return bos();
  }
}

function oku(): Kayit {
  try {
    return coz(window.localStorage.getItem(KEY));
  } catch {
    return yedek ?? bos();
  }
}

function yaz(k: Kayit): void {
  yedek = k;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(k));
  } catch {
    /* saklama kapalı: işaretler yalnız bellekte kalır */
  }
}

/** Tur bu tarayıcıda görüldü mü; depolama erişilemezse her zaman `false` (tur her seferinde önerilir). */
export function turGoruldu(): boolean {
  try {
    return coz(window.localStorage.getItem(KEY)).tur;
  } catch {
    return false;
  }
}

export function turGorulduYaz(): void {
  yaz({ ...oku(), tur: true });
}

const ekle = (l: string[], id: string): string[] => (l.includes(id) ? l : [...l, id].slice(-EN_COK));

/** Başlatılan koşu rehberli mi: yeni koşu için durma işareti de sıfırlanır; rehberli değilse kimlik listeden çıkar (kayıt kaynağında kimlikler tekrar kullanılabilir). */
export function rehberKosuIsaretle(runId: string, rehberli: boolean): void {
  const k = oku();
  yaz({ ...k, kosular: rehberli ? ekle(k.kosular, runId) : k.kosular.filter((x) => x !== runId), durakladi: k.durakladi.filter((x) => x !== runId) });
}

export const rehberKosuMu = (runId: string): boolean => oku().kosular.includes(runId);

/** Koşu ilk kritik olayında (bir kez) durdu mu. */
export const duraklatildiMi = (runId: string): boolean => oku().durakladi.includes(runId);
export function duraklatildiYaz(runId: string): void {
  const k = oku();
  yaz({ ...k, durakladi: ekle(k.durakladi, runId) });
}

export const ipucuGorulduMu = (id: string): boolean => oku().ipuclari.includes(id);
export function ipucuGorulduYaz(id: string): void {
  const k = oku();
  yaz({ ...k, ipuclari: ekle(k.ipuclari, id) });
}

/** Şart değişikliği koşuya yeni kimlik verir: rehberli işareti ve "bir kez durdu" bilgisi yeni kimliğe geçer. */
export function rehberKosuDevral(eski: string, yeni: string): void {
  if (eski === yeni || !rehberKosuMu(eski)) return;
  const durdu = duraklatildiMi(eski);
  rehberKosuIsaretle(yeni, true);
  if (durdu) duraklatildiYaz(yeni);
}

/**
 * Açık "Dünya durdu" kutusu (koşu kimliği -> olay kimliği): yalnız bellekte, `useSyncExternalStore` ile okunur.
 * Kalıcı olan "bir kez durdu" işareti `duraklatildiYaz`dır; bu yalnız kutunun şu an açık olup olmadığıdır.
 */
const acikDurdu = new Map<string, string>();
const dinleyiciler = new Set<() => void>();
const duyur = (): void => {
  for (const d of [...dinleyiciler]) d();
};
export function durduAc(runId: string, olayId: string): void {
  acikDurdu.set(runId, olayId);
  duyur();
}
export function durduKapat(runId: string): void {
  if (acikDurdu.delete(runId)) duyur();
}
export const durduAboneOl = (d: () => void): (() => void) => {
  dinleyiciler.add(d);
  return () => {
    dinleyiciler.delete(d);
  };
};
export const acikDurduOlayi = (runId: string): string | null => acikDurdu.get(runId) ?? null;
