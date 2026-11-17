"use client";
import { useSyncExternalStore } from "react";

/**
 * "Şartı değiştir" diyaloğunun açık/kapalı durumu. Düğme üst çubukta (`UstCubuk`), diyalog Canlı Dünya'dadır;
 * ikisi de aynı belge içinde olduğundan paylaşılan küçük bir dış durumdur (bağlam sağlayıcısı gerektirmez).
 */
let acik = false;
const dinleyiciler = new Set<() => void>();
const duyur = (): void => {
  for (const d of [...dinleyiciler]) d();
};

/** Açılışta odaklanılacak kural kartı (rehberli oyunun "Bu kuralı değiştir" eylemi); yoksa `null`. */
let hedefKart: string | null = null;

/**
 * Paneli açar. `kart` verilirse editör o kartı açar ve odaklar; panel zaten açıksa yalnız hedef güncellenir.
 * Düğmelerin `onClick`'ine doğrudan bağlandığından dize olmayan bağımsız değişken (olay nesnesi) yok sayılır.
 */
export function degistirAc(kart?: unknown): void {
  const hedef = typeof kart === "string" ? kart : null;
  if (acik) {
    if (hedef !== null && hedef !== hedefKart) {
      hedefKart = hedef;
      duyur();
    }
    return;
  }
  acik = true;
  hedefKart = hedef;
  duyur();
}

export function degistirKapat(): void {
  if (!acik) return;
  acik = false;
  hedefKart = null;
  odak = true;
  if (typeof window !== "undefined") {
    // Kullanıcı bir şeye bastığı ya da tıkladığı anda odak isteği biter (düğme sonradan kurulsa da odak geri verilir, kullanıcıdan alınmaz).
    const bitir = (): void => {
      odak = false;
      window.removeEventListener("keydown", bitir, true);
      window.removeEventListener("pointerdown", bitir, true);
    };
    window.addEventListener("keydown", bitir, true);
    window.addEventListener("pointerdown", bitir, true);
  }
  duyur();
}

/** Diyalog kapanınca odak "Şartı değiştir" düğmesine döner; düğme yeniden kurulduysa (yeni koşu kimliği) çizilince verilir. */
let odak = false;
export const odakBekliyor = (): boolean => odak;


const abone = (d: () => void): (() => void) => {
  dinleyiciler.add(d);
  return () => {
    dinleyiciler.delete(d);
  };
};

export function useDegistirAcik(): boolean {
  return useSyncExternalStore(abone, () => acik, () => false);
}

export function useDegistirHedef(): string | null {
  return useSyncExternalStore(abone, () => hedefKart, () => null);
}
