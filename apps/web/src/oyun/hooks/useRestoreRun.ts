"use client";
import { useCallback, useEffect, useState } from "react";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunHandle } from "@/oyun/sim/types";

export type RestoreStatus = "idle" | "loading" | "ready" | "missing";
type Res = { forId: string | null; status: RestoreStatus; handle: RunHandle | null };
const IDLE: Res = { forId: null, status: "idle", handle: null };

/**
 * Hash'teki koşu kimliğinden koşuyu kurar. Uygulamanın kendi ürettiği kimlikler
 * (`start`/`open` dönüşü, `state` olaylarındaki yeni tarif) `open` çağırtmaz;
 * yalnız dışarıdan gelen kimlik (yenileme, elle hash değişimi) `open` çağırır.
 */
export function useRestoreRun(runId: string | null): {
  status: RestoreStatus;
  handle: RunHandle | null;
  /** `start()` dönüşünü bildirir; ardından hash'e yazılan kimlik için `open` çağrılmaz. */
  adopt(handle: RunHandle): void;
} {
  const source = useSimSource();
  const [own] = useState(() => new Set<string>());
  const [res, setRes] = useState<Res>(IDLE);

  const adopt = useCallback(
    (handle: RunHandle) => {
      own.add(handle.runId);
      setRes({ forId: handle.runId, status: "ready", handle });
    },
    [own],
  );

  useEffect(() => {
    if (runId === null) return;
    if (own.has(runId)) return;
    own.clear(); // dışarıdan gelen kimlik: yeni bir koşu soyu başlar
    let live = true;
    source.open(runId).then(
      (h) => {
        if (!live) return;
        if (h === null) {
          setRes({ forId: runId, status: "missing", handle: null });
          return;
        }
        own.add(runId);
        own.add(h.runId);
        setRes({ forId: runId, status: "ready", handle: h });
      },
      () => {
        if (live) setRes({ forId: runId, status: "missing", handle: null });
      },
    );
    return () => {
      live = false;
    };
  }, [source, runId, own]);

  // Yalnız rota bu koşuya aitken dinle: Kurucu'da ya da yabancı hash yüklenirken abonelik kalmaz,
  // böylece kaynak son abonelik kapanınca koşuyu duraklatır (arka planda oynama sızıntısı olmaz).
  const subId = runId !== null && (res.forId === runId || own.has(runId)) ? (res.handle?.runId ?? null) : null;
  useEffect(() => {
    if (subId === null) return;
    return source.subscribe(subId, (e) => {
      if (e.type === "state") own.add(e.state.runId);
    });
  }, [source, subId, own]);

  if (runId === null) return { status: "idle", handle: null, adopt };
  if (res.forId !== runId) {
    if (own.has(runId) && res.handle) return { status: "ready", handle: res.handle, adopt };
    return { status: "loading", handle: null, adopt };
  }
  return { status: res.status, handle: res.handle, adopt };
}
