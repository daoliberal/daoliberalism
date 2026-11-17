"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CopyKey } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";

export type Dallan = {
  /** Kaynak dallanmayı destekliyor ve bildiriyor mu. */
  izinli: boolean;
  /** Kapalıyken görünen neden (kayıt kaynağında "kayıttan oynatılan", canlıda "bu sunucuda"). */
  neden: CopyKey;
  /** İstek sunucuya gitti, yanıt bekleniyor. */
  bekliyor: boolean;
  hata: CopyKey | null;
  /** `hafta`'dan dallanır (`0 <= W < süre`); koşu açılınca yeni koşunun rotasına geçer. */
  baslat(hafta: number): void;
};

const HATALAR: Record<string, CopyKey> = {
  too_many_runs: "canli.dallan.hata.too_many_runs",
  busy_preparing: "canli.dallan.hata.busy_preparing",
  invalid_branch: "canli.dallan.hata.invalid_branch",
};

/** Dallanma isteği: bir seferde tek istek; hata nedeni anahtar olarak tutulur. */
export function useDallan(runId: string, durationWeeks: number, yetenek: boolean): Dallan {
  const source = useSimSource();
  const { go } = useHashRoute();
  const izinli = yetenek && typeof source.branch === "function";
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<CopyKey | null>(null);
  const busy = useRef(false);
  /** Yanıt geldiğinde kullanıcı hâlâ bu koşuda mı: ekrandan ayrılmış ya da başka koşuya geçmişse yeni koşuya taşınmaz. */
  const bu = useRef({ acik: true, runId });
  useEffect(() => {
    bu.current.runId = runId;
  }, [runId]);
  useEffect(() => {
    const durum = bu.current;
    durum.acik = true;
    return () => {
      durum.acik = false;
    };
  }, []);

  const baslat = useCallback(
    (hafta: number) => {
      if (!izinli || busy.current || !source.branch) return;
      busy.current = true;
      setBekliyor(true);
      setHata(null);
      const w = Math.max(0, Math.min(hafta, durationWeeks - 1));
      source.branch(runId, w).then(
        (h) => {
          if (bu.current.acik && bu.current.runId === runId) go({ name: "canli", runId: h.runId });
          else void source.discard?.(h.runId).catch(() => {}); // yetim dal koşusu açık koşu sınırını tutmasın; 404 sessiz
        },
        (e: unknown) => setHata((e instanceof SimUnsupported ? HATALAR[e.message] : undefined) ?? "canli.dallan.hata.genel"),
      ).finally(() => {
        busy.current = false;
        setBekliyor(false);
      });
    },
    [izinli, source, runId, durationWeeks, go],
  );
  return { izinli, neden: source.kind === "live" ? "canli.dallan.kapali_canli" : "canli.dallan.kapali_kayit", bekliyor, hata, baslat };
}
