"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CopyKey } from "@/oyun/copy/t";
import { ilkKritikOlay } from "@/oyun/sim/eventRules";
import type { RunState, SimSource, WorldEvent } from "@/oyun/sim/types";
import { useDiyalogAcik } from "@/oyun/ui/Diyalog";
import { acikDurduOlayi, duraklatildiMi, duraklatildiYaz, durduAboneOl, durduAc, durduKapat, ipucuGorulduMu, ipucuGorulduYaz, rehberKosuMu } from "./rehberDurumu";

/** Rehberli koşuda ipuçları yalnız ilk bu kadar haftada çıkar. */
const IPUCU_SON_HAFTA = 20;

type IpucuKimligi = "a" | "b" | "c";
const IPUCULARI: { id: IpucuKimligi; metin: CopyKey; hazir: (hafta: number, tani: boolean) => boolean }[] = [
  { id: "a", metin: "rehber.ipucu.a", hazir: (h) => h >= 2 },
  { id: "b", metin: "rehber.ipucu.b", hazir: (h) => h >= 5 },
  { id: "c", metin: "rehber.ipucu.c", hazir: (_h, tani) => tani },
];

export type RehberKosu = {
  rehberli: boolean;
  /** Dünyayı durduran ilk kritik olay (kutu açıkken); yoksa `null`. */
  durdu: WorldEvent | null;
  kapat(): void;
  devam(): void;
  /** Gösterilecek ipucu (yoksa `null`) ve kapatma. */
  ipucu: { id: IpucuKimligi; metin: CopyKey } | null;
  ipucuTamam(): void;
};

/**
 * Rehberli koşunun davranışı: ilk kritik olayda (`eventRules`) dünyayı bir kez durdurur ve kutuyu açar; ilk haftalarda ipuçlarını sırayla gösterir.
 * Koşu rehberli değilse hiçbir şey yapmaz. `engelli`: başka bir iletişim kutusu açıkken ipucu çıkmaz.
 */
export function useRehber(source: SimSource, runId: string, state: RunState | null, events: WorldEvent[], tanilarVar: boolean, engelli: boolean): RehberKosu {
  const rehberli = rehberKosuMu(runId);
  const kritik = useMemo(() => ilkKritikOlay(events), [events]);
  const acikOlayKimligi = useSyncExternalStore(durduAboneOl, () => acikDurduOlayi(runId), () => null);
  const [, yenile] = useState(0);
  const baskaDiyalog = useDiyalogAcik();
  const status = state?.status;

  useEffect(() => {
    if (!rehberli || kritik === null || status === undefined || status === "ended" || status === "failed") return;
    if (duraklatildiMi(runId)) return;
    duraklatildiYaz(runId);
    durduAc(runId, kritik.id);
    if (status === "running") source.control(runId, { action: "pause" }).catch(() => {});
  }, [rehberli, kritik, status, runId, source]);

  // Ekrandan ayrılınca ya da koşu değişince açık kutu kapanır (bir kez durma işareti kalıcıdır, kutu yeniden açılmaz).
  useEffect(() => () => durduKapat(runId), [runId]);
  const kapat = useCallback(() => durduKapat(runId), [runId]);
  const speed = state?.speed ?? 1;
  const devam = useCallback(() => {
    durduKapat(runId);
    source.control(runId, { action: "play", speed }).catch(() => {});
  }, [source, runId, speed]);

  const hafta = state?.week ?? 0;
  // Dünya hemen durur ama kutu, açık başka bir iletişim kutusu kapanana kadar bekler (iki modal üst üste binmez).
  const acikDurdu = acikOlayKimligi === null || baskaDiyalog ? null : (events.find((e) => e.id === acikOlayKimligi) ?? null);
  const sira = rehberli && !engelli && !baskaDiyalog && acikDurdu === null && hafta <= IPUCU_SON_HAFTA ? IPUCULARI.find((x) => !ipucuGorulduMu(x.id) && x.hazir(hafta, tanilarVar)) : undefined;
  const ipucuTamam = useCallback(() => {
    if (sira) ipucuGorulduYaz(sira.id);
    yenile((n) => n + 1);
  }, [sira]);

  return { rehberli, durdu: acikDurdu, kapat, devam, ipucu: sira ? { id: sira.id, metin: sira.metin } : null, ipucuTamam };
}
