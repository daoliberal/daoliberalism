"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { RunState } from "@/oyun/sim/types";
import { TercihDugmeleri, type Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { KayitDugmesi } from "@/oyun/ui/KayitDugmesi";
import { KosuEylemleri, type KosuEylemleriProps } from "./KosuEylemleri";
import stil from "./KurucuMenu.module.css";

type Props = {
  state: RunState;
  /** Menü düğmesinin yanında duran Ayrıntılar düğmesi ve penceresi (DAO'da yok). */
  ayrintilar?: ReactNode;
  /** Tema ve hareket düğmeleri (verilmezse çizilmez). */
  tercih?: Tercih;
  /** Koşu eylemleri (Sonuç, Karar günlüğü); verilmezse menüde yoktur (DAO). */
  kosu?: Omit<KosuEylemleriProps, "eylemler" | "state">;
  /** Ayrıntılar penceresi açıkken menüdeki koşu eylemleri çizilmez (aynı yüzeyde aynı ad iki kez olmaz). */
  kosuGizli?: boolean;
  onKosular: () => void;
  /** Menünün başına eklenen ekran eylemleri; her düğme kendini seçince kapanmak için `kapat`ı alır. */
  ekler?: (kapat: () => void) => ReactNode;
};

/**
 * Sağ üstteki menü: Ayrıntılar düğmesi ve "Menü" açılır paneli (Sonuç / Ara durum, Karar günlüğü, Koşular, tema, hareket).
 * Panel Esc, dışarı tıklama ve bir eylem seçilince kapanır; kapanınca odak düğmeye döner.
 */
export function KurucuMenu({ state, ayrintilar, tercih, kosu, kosuGizli = false, onKosular, ekler }: Props) {
  const [acik, setAcik] = useState(false);
  const kok = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!acik) return;
    const disarida = (e: PointerEvent): void => {
      if (e.target instanceof Node && !kok.current?.contains(e.target)) setAcik(false);
    };
    document.addEventListener("pointerdown", disarida);
    return () => document.removeEventListener("pointerdown", disarida);
  }, [acik]);
  const kapat = (odak: boolean): void => {
    setAcik(false);
    if (odak) kok.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
  };
  /** Bir eylem seçilince panel kapanır (eylem kendi katmanını açar). */
  const sar = <A extends unknown[]>(f: ((...a: A) => void) | undefined): ((...a: A) => void) | undefined => (f ? (...a) => { setAcik(false); f(...a); } : undefined);
  const onSonuc = kosu ? sar(kosu.onSonuc) : undefined;
  const onGunluk = kosu ? sar(kosu.onGunluk) : undefined;
  return (
    <div className={stil.kok}>
      {ayrintilar}
      <div
        ref={kok}
        className={stil.menu}
        onKeyDown={(e) => {
          if (e.key === "Escape" && acik) {
            e.preventDefault(); // sağ panel Esc'i bu olayı görmez
            kapat(true);
          }
        }}
      >
        <Button variant="secondary" size="sm" aria-expanded={acik} aria-controls={acik ? panelId : undefined} onClick={() => setAcik(!acik)}>
          {t("kurucu.menu.dugme")}
        </Button>
        {acik ? (
          <div id={panelId} role="group" aria-label={t("ustcubuk.menu")} className={stil.panel}>
            {ekler ? ekler(() => setAcik(false)) : null}
            {kosuGizli || !kosu ? null : <KosuEylemleri {...kosu} state={state} eylemler={["sonuc", "gunluk"]} onSonuc={onSonuc!} onGunluk={onGunluk!} />}
            <Button variant="secondary" size="sm" onClick={() => { setAcik(false); onKosular(); }}>
              {t("ustcubuk.kosular")}
            </Button>
            <KayitDugmesi onAc={() => setAcik(false)} />
            {tercih ? <TercihDugmeleri tercih={tercih} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
