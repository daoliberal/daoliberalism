"use client";
import { createContext, useContext } from "react";

/** B8: "Kayit ve depolama" panelini acan baglam. Yalniz tarayici kipinde saglanir (`null` = sunucu/onizleme derlemesi: ekranlar dugme ve satir cizmez). */
export type KayitBaglamiDegeri = { paneliAc(): void };

const Baglam = createContext<KayitBaglamiDegeri | null>(null);

export const KayitBaglamiSaglayici = Baglam.Provider;

export function useKayitBaglami(): KayitBaglamiDegeri | null {
  return useContext(Baglam);
}
