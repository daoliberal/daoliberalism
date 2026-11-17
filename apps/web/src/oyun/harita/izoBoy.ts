import { boyOf, IZO_STILI } from "./haritaStili";

type Boy = 1 | 2 | 3 | 4;

/**
 * Bir işletmenin görsel boy durumu. `gorulen` son işlenen haftadır; atlanan
 * haftaları (tarayıcı kısma, hızlı oynatma) hafta farkı olarak saymak için tutulur.
 */
export type BoyDurumu = {
  gorsel: Boy;
  aday: Boy | null;
  say: number;
  son: { eski: Boy; yeni: Boy; hafta: number } | null;
  gorulen: number;
};

export type BoyHaritasi = ReadonlyMap<string, BoyDurumu>;

/**
 * Haftalık ham boy → histerezisli görsel boy. Saf. Yeni kimlik ham boyla başlar;
 * ham boy görselden farklıysa `esik` ardışık hafta (atlananlar dahil) sonra geçer;
 * listede olmayan kimlik düşer.
 */
export function boyIlerlet(
  onceki: BoyHaritasi,
  firmalar: readonly { id: string; calisan: number }[],
  hafta: number,
  esik: number = IZO_STILI.buyume.histerezisHafta,
): BoyHaritasi {
  const yeni = new Map<string, BoyDurumu>();
  for (const { id, calisan } of firmalar) {
    const ham = boyOf(calisan);
    const d = onceki.get(id);
    if (!d) {
      yeni.set(id, { gorsel: ham, aday: null, say: 0, son: null, gorulen: hafta });
      continue;
    }
    // Atlanan haftalarda ham boy sabit varsayılır: aradaki haftalar şimdiki ham boyla sayılır.
    const fark = hafta - d.gorulen;
    if (fark <= 0) { yeni.set(id, d); continue; }
    if (ham === d.gorsel) {
      yeni.set(id, { ...d, aday: null, say: 0, gorulen: hafta });
      continue;
    }
    const say = (d.aday === ham ? d.say : 0) + fark;
    yeni.set(id, say >= esik
      ? { gorsel: ham, aday: null, say: 0, son: { eski: d.gorsel, yeni: ham, hafta }, gorulen: hafta }
      : { ...d, aday: ham, say, gorulen: hafta });
  }
  return yeni;
}

/** Yalnız geçişin olduğu hafta anlamlıdır (iskele/tahta bindirmesi için). */
export function boyGecisi(d: BoyDurumu, hafta: number): "buyudu" | "kuculdu" | null {
  if (!d.son || d.son.hafta !== hafta) return null;
  return d.son.yeni > d.son.eski ? "buyudu" : "kuculdu";
}
