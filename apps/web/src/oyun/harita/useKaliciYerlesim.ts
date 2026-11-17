"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tabloOku, tabloYaz, type YerlesimTablosu } from "./yerlesimTablosu";
import { depoOku, depoYaz, isletmeBagla, sabitlemeler, type GorunumTuru, type OyuncuParselDeposu } from "./oyuncuParseli";

export type KaliciYerlesim = {
  /** Anahtar (koşu, görünüm, şehir): değişince sahne yeniden kurulmalı. */
  anahtar: string;
  /** Commit edilmiş (yoksa kayıtlı, o da yoksa null) önceki tablo; sahne kurulumunda `ctx.yerlesim` olarak verilir. */
  onceki(): YerlesimTablosu | null;
  /** Sahnenin döndürdüğü ilerlemiş tabloyu commit eder (`useEffect` içinde çağrılır) ve saklar. */
  kaydet(tablo: YerlesimTablosu | undefined): void;
};

/**
 * Kalıcı yerleşim tablosu (K9). Render saftır: `onceki()` ref'teki commit edilmiş durumu (yoksa localStorage'ı) okur; tablo yalnız `kaydet` ile (effect) ilerler.
 * Sahne kurulumu aynı tabloyla tekrarlanırsa (katman, seçim) çıktı aynıdır (idempotent), bu yüzden atılan render hiçbir şeyi kaydırmaz.
 */
export function useKaliciYerlesim(tohum: string, mod: GorunumTuru, sehir: number): KaliciYerlesim {
  const anahtar = `${tohum}.${mod}.${sehir}`;
  const ref = useRef<{ anahtar: string; tablo: YerlesimTablosu | null } | null>(null);
  const onceki = useCallback((): YerlesimTablosu | null => {
    const r = ref.current;
    if (r !== null && r.anahtar === anahtar) return r.tablo;
    return tabloOku(anahtar);
  }, [anahtar]);
  const kaydet = useCallback((tablo: YerlesimTablosu | undefined): void => {
    if (tablo === undefined) return;
    const r = ref.current;
    if (r !== null && r.anahtar === anahtar && r.tablo === tablo) return;
    ref.current = { anahtar, tablo };
    tabloYaz(anahtar, tablo, tohum);
  }, [anahtar, tohum]);
  return { anahtar, onceki, kaydet };
}

export type OyuncuParseli = {
  /** Görünüm başına {firma -> parsel} (izo ve klasik ayrı yerleşimdir). */
  sabitlemeler: Readonly<Record<GorunumTuru, ReadonlyMap<string, string>>>;
  /** "İşletme kur" kabul edilince seçilen parseli bekletir. */
  kurIstendi(parsel: string, mod: GorunumTuru, sektor: string): void;
};

/**
 * Not (belgelenmiş davranış): ilk render'daki bağlama (render sırasında `setDepo`) ilk effect'te yazılmaz (`saklanan` ilk değeri atlar); bekleyen kayıt depoda durduğundan
 * bir sonraki yüklemede aynı bağlama yeniden üretilir, bu yüzden zararsızdır. Sabitleme yalnız kurulduğu görünüme (izo ya da klasik) uygulanır: kimlik uzayları
 * farklı ve tablolar ayrıdır (K9), öbür görünümde oyuncu işletmesi normal yerleşimle oturur.
 */
/** K8: kur kabulünde bekletilen parsel, kurucu gözleminin firması (`ben.is.firma`: harita kimliği; olaydaki ad değil) görününce o firmaya bağlanır. */
export function useOyuncuParseli(runId: string, kurucuFirma: string | null): OyuncuParseli {
  const [depo, setDepo] = useState<{ runId: string; d: OyuncuParselDeposu }>(() => ({ runId, d: depoOku(runId) }));
  const firmalar = kurucuFirma !== null ? [kurucuFirma] : [];
  const eski = depo.runId === runId ? depo.d : depoOku(runId);
  const yeni = isletmeBagla(eski, firmalar);
  // Durumu render sırasında düzeltme (React'in önerdiği örüntü): bağlama bir kez olur, sonra `yeni === eski` olur.
  if (yeni !== eski || depo.runId !== runId) setDepo({ runId, d: yeni });
  const saklanan = useRef<OyuncuParselDeposu | null>(null);
  useEffect(() => {
    if (saklanan.current === depo.d) return;
    if (saklanan.current !== null) depoYaz(depo.runId, depo.d);
    saklanan.current = depo.d;
  }, [depo]);
  const kurIstendi = useCallback((parsel: string, m: GorunumTuru, sektor: string): void => {
    setDepo((o) => {
      const e = o.runId === runId ? o.d : depoOku(runId);
      return { runId, d: { ...e, bekleyen: { parsel, mod: m, sektor } } };
    });
  }, [runId]);
  const d = yeni;
  const sabit = useMemo(() => ({ izo: sabitlemeler(d, "izo"), klasik: sabitlemeler(d, "klasik") }), [d]);
  return { sabitlemeler: sabit, kurIstendi };
}
