"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CopyKey } from "@/oyun/copy/t";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Job, JobSpec } from "@/oyun/sim/types";

export type IsTuru = "seeds" | "ab";
/** `imza`: sonucun hangi girdiye (ör. seçili B koşusu) ait olduğu; girdi değişince eski sonuç gösterilmez. */
export type IsDurum =
  | { tur: "bosta" }
  | { tur: "basliyor" }
  | { tur: "calisiyor"; jobId: string; job: Job | null; imza: string; /** Yapılan yoklama sayısı: yoklamayı sürdüren sayaçtır (kaynak aynı `Job` nesnesini döndürse de). */ n: number }
  | { tur: "bitti"; job: Job; imza: string }
  | { tur: "iptal" }
  | { tur: "hata"; anahtar: CopyKey };

export type Isler = {
  durum: Record<IsTuru, IsDurum>;
  /** Sunucuda aynı anda tek iş çalışır: biri sürerken ötekinin başlatması kapalıdır. */
  mesgul: boolean;
  baslat(tur: IsTuru, spec: JobSpec, imza: string): void;
  iptal(tur: IsTuru): void;
};

/** İlk yoklama hemen, sonrakiler bu aralıkla. */
export const YOKLAMA_MS = 1000;
const BOSTA: IsDurum = { tur: "bosta" };

/**
 * Sonuç ekranının arka plan işleri (6 dünya, A/B). İşin bittiği sayaçtan değil `status`'tan okunur (`progress.done` bitişte
 * `total`'in altında kalabilir). Ekrandan ayrılırken süren iş iptal edilir; yetim iş sunucuyu meşgul bırakmasın.
 */
export function useIsler(): Isler {
  const source = useSimSource();
  const [durum, setDurum] = useState<Record<IsTuru, IsDurum>>({ seeds: BOSTA, ab: BOSTA });
  /** İptal ya da yeni başlatma uçuştaki yoklamayı geçersiz kılar. */
  const donem = useRef(0);
  const bagli = useRef(true);
  const aktifId = useRef<string | null>(null);

  const aktif = (["seeds", "ab"] as const).find((k) => durum[k].tur === "calisiyor" || durum[k].tur === "basliyor") ?? null;
  const calisan = aktif !== null && durum[aktif].tur === "calisiyor" ? (durum[aktif] as Extract<IsDurum, { tur: "calisiyor" }>) : null;
  const jobId = calisan?.jobId ?? null;
  const calisanImza = calisan?.imza ?? "";
  const yoklama = calisan?.n ?? 0;

  const koy = useCallback((tur: IsTuru, d: IsDurum) => setDurum((o) => ({ ...o, [tur]: d })), []);

  useEffect(() => {
    if (jobId === null || aktif === null || !source.job) return;
    let canli = true;
    const benim = donem.current;
    const tur = aktif;
    const gecerli = (): boolean => canli && benim === donem.current;
    const timer = setTimeout(async () => {
      try {
        const job = await source.job!(jobId);
        if (!gecerli()) return;
        if (job.status === "queued" || job.status === "running") koy(tur, { tur: "calisiyor", jobId, job, imza: calisanImza, n: yoklama + 1 });
        else if (job.status === "cancelled") koy(tur, { tur: "iptal" });
        else koy(tur, { tur: "bitti", job, imza: calisanImza });
      } catch {
        if (gecerli()) koy(tur, { tur: "hata", anahtar: "sonuc.is.sunucu" });
      }
    }, yoklama === 0 ? 0 : YOKLAMA_MS);
    return () => {
      canli = false;
      clearTimeout(timer);
    };
  }, [source, jobId, aktif, calisanImza, yoklama, koy]);

  useEffect(() => {
    aktifId.current = jobId;
  }, [jobId]);
  useEffect(() => {
    bagli.current = true;
    return () => {
      bagli.current = false;
      const id = aktifId.current;
      if (id) void source.cancelJob?.(id).catch(() => undefined);
    };
  }, [source]);

  const baslat = useCallback((tur: IsTuru, spec: JobSpec, imza: string) => {
    if (!source.startJob) return;
    donem.current += 1;
    koy(tur, { tur: "basliyor" });
    source.startJob(spec).then(
      (id) => {
        if (!bagli.current) {
          void source.cancelJob?.(id).catch(() => undefined);
          return;
        }
        aktifId.current = id;
        koy(tur, { tur: "calisiyor", jobId: id, job: null, imza, n: 0 });
      },
      (e: unknown) => {
        if (!bagli.current) return;
        const kod = e instanceof SimUnsupported ? e.message : "";
        koy(tur, { tur: "hata", anahtar: kod === "job_running" ? "sonuc.is.mesgul" : kod === "invalid_job" ? "sonuc.is.gecersiz" : "sonuc.is.sunucu" });
      },
    );
  }, [source, koy]);

  const iptal = useCallback((tur: IsTuru) => {
    const id = aktifId.current;
    donem.current += 1;
    aktifId.current = null;
    koy(tur, { tur: "iptal" });
    if (id) void source.cancelJob?.(id).catch(() => undefined);
  }, [source, koy]);

  return { durum, mesgul: aktif !== null, baslat, iptal };
}
