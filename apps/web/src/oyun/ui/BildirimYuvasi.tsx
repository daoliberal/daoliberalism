"use client";
import { createContext, useContext, type ReactNode } from "react";
import stil from "./bildirimYuvasi.module.css";

/**
 * B10 (Y-5): tam ekran oyunda alt bilgilendirme bantlari (Safari, yeni surum, kayit...) sabit konumlu ayri bir katman degil, oyun ekraninin alt-sol
 * sutununda ipucunun USTUNDE akar: yapisal olarak ipucu/olay seridiyle kesisemez. `OyunApp` yuvanin ogesini ister (`setYuva`); yuva yoksa (giris, sonuc, form
 * ekranlari) bantlar eski sabit sutunda kalir. Baglam yalniz tarayici kipinde saglanir: bayraksiz (onizleme) derlemede `null`, hicbir oge cizilmez.
 */
const Baglam = createContext<((oge: HTMLElement | null) => void) | null>(null);

export const BildirimYuvaSaglayici = Baglam.Provider;

export function BildirimYuvasi(): ReactNode {
  const yuvaAyarla = useContext(Baglam);
  return yuvaAyarla === null ? null : <div ref={yuvaAyarla} className={stil.yuva} data-bildirim-yuvasi="" />;
}

/** Yuva baglami var mi (yalniz tarayici kipi): yan panel yukseklik basamagi yalniz o zaman uygulanir; bayraksiz derlemede ekran DOM'u ve yerlesimi ayni kalir. */
export function useBildirimYuvasiVarMi(): boolean {
  return useContext(Baglam) !== null;
}
