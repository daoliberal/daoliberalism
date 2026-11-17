"use client";
import { useEffect } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { RunState } from "@/oyun/sim/types";
import { odakBekliyor, useDegistirAcik } from "./degistirDurumu";
import { DEGISTIR_ID } from "./SaatCubugu";

/** Koşu eylemlerinin tek tanımı: menü, Şart paneli ve Ayrıntılar > Koşu aynı bileşeni (aynı ad, aynı kapı) farklı alt kümelerle çizer. */
export type KosuEylemi = "degistir" | "sart" | "sifirla" | "sonuc" | "gunluk";

export type KosuEylemleriProps = {
  /** Çizilecek eylemler, bu sırayla. */
  eylemler: readonly KosuEylemi[];
  state: RunState;
  /** Koşu sürerken Şartı değiştir panelini açar; bittiyse/çöktüyse `undefined` (düğme çizilmez). */
  onDegistir?: () => void;
  onSart: () => void;
  onSifirla: () => void;
  onSonuc: () => void;
  onGunluk: () => void;
  /** "Şartı değiştir" diyaloğu kapanınca odağı bu örnekteki düğmeye ver (yalnız ekranda tek örnek bunu ister). */
  odakDonusu?: boolean;
};

/**
 * Koşu eylemleri: Şartı değiştir, Şart (okuyucu), Sıfırdan başlat, Sonuç / Ara durum, Karar günlüğü.
 * Aynı görünür yüzeyde iki örnek çizilmez (kabuk, Ayrıntılar açıkken dışarıdaki örnekleri çizmez).
 */
export function KosuEylemleri({ eylemler, state, onDegistir, onSart, onSifirla, onSonuc, onGunluk, odakDonusu = false }: KosuEylemleriProps) {
  const degistirAcik = useDegistirAcik();
  useEffect(() => {
    // Diyalog kapanınca odak bu düğmeye döner (düğme sonradan kurulduysa çizilince).
    if (!odakDonusu || degistirAcik || !odakBekliyor()) return;
    const el = document.getElementById(DEGISTIR_ID);
    if (el && !el.hasAttribute("disabled") && document.activeElement !== el) el.focus();
  });
  const bitti = state.status === "ended" || state.status === "failed";
  const dugme = (e: KosuEylemi) => {
    switch (e) {
      case "degistir":
        return onDegistir ? (
          <Button key={e} {...(odakDonusu ? { id: DEGISTIR_ID } : {})} variant="primary" size="sm" disabled={state.computing} onClick={() => onDegistir()}>
            {t("degistir.dugme")}
          </Button>
        ) : null;
      case "sart":
        return (
          <Button key={e} variant="secondary" size="sm" onClick={onSart}>
            {t("ustcubuk.sart_dugme")}
          </Button>
        );
      case "sifirla":
        return (
          <Button key={e} variant="secondary" size="sm" onClick={onSifirla}>
            {t("canli.sifirla.baslik")}
          </Button>
        );
      case "sonuc":
        return (
          <Button key={e} variant="secondary" size="sm" onClick={onSonuc}>
            {bitti ? t("ustcubuk.sonuc") : t("ustcubuk.ara_durum")}
          </Button>
        );
      case "gunluk":
        return (
          <Button key={e} variant="secondary" size="sm" onClick={onGunluk}>
            {t("ustcubuk.gunluk")}
          </Button>
        );
    }
  };
  return <>{eylemler.map(dugme)}</>;
}
