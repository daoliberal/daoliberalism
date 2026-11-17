/**
 * Kalıcı yerleşim ve oyuncu parseli kayıtları için localStorage yazımı: koşu başına zaman damgası tutulur, en eski koşular budanır
 * (en çok `KOSU_SINIRI`); kota hatasında daha sıkı budayıp bir kez daha denenir; yine olmazsa konsola tek uyarı (sessiz yutma yok).
 */
export const KOSU_SINIRI = 20;
const KOSU_SINIRI_DAR = 5;
const INDEKS = "daoliberal.kosular";
const ONEKLER = ["daoliberal.yerlesim.", "daoliberal.oyuncuparsel."] as const;
let uyarildi = false;

const depo = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

function indeksOku(d: Storage): Record<string, number> {
  try {
    const o: unknown = JSON.parse(d.getItem(INDEKS) ?? "{}");
    if (o === null || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Koşu kayıtlarını siler (yerleşim tabloları ve oyuncu parseli). */
function kosuSil(d: Storage, id: string): void {
  const sil: string[] = [];
  for (let i = 0; i < d.length; i++) {
    const k = d.key(i);
    if (k !== null && ONEKLER.some((o) => k === o + id || k.startsWith(`${o}${id}.`))) sil.push(k);
  }
  for (const k of sil) d.removeItem(k);
}

function buda(d: Storage, tut: number, koru: string): void {
  const idx = indeksOku(d);
  const siralı = Object.entries(idx).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const kalacak = new Set([koru, ...siralı.filter((id) => id !== koru)].slice(0, tut));
  for (const id of siralı) {
    if (kalacak.has(id)) continue;
    kosuSil(d, id);
    delete idx[id];
  }
  d.setItem(INDEKS, JSON.stringify(idx));
}

/** Güvenli yazım: zaman damgası + budama; kota hatasında sıkı budayıp bir kez daha dener. */
export function depolamaYaz(kosuId: string, anahtar: string, deger: string): void {
  const d = depo();
  if (d === null) return;
  const yaz = (tut: number): void => {
    const idx = indeksOku(d);
    idx[kosuId] = Date.now();
    d.setItem(INDEKS, JSON.stringify(idx));
    buda(d, tut, kosuId);
    d.setItem(anahtar, deger);
  };
  try {
    yaz(KOSU_SINIRI);
  } catch {
    try {
      yaz(KOSU_SINIRI_DAR);
    } catch (e) {
      if (!uyarildi) {
        uyarildi = true;
        console.warn("harita:depolama-dolu", e); // yerleşim kaydı yazılamadı: düzen yenilemede korunmayabilir
      }
    }
  }
}
