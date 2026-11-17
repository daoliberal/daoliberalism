"use client";

import { useEffect, useState } from "react";
import { useSimSource } from "./SimSourceContext";
import type { Capabilities, SimSource, SourceInfo } from "./types";

export const NO_CAPABILITIES: Capabilities = {
  branch: false, seeds: false, compare: false, library: false, city: false, chain: false, jobs: false, rebuild: false,
};

export type SourceInfoState = {
  info: SourceInfo | null;
  /** Kaynağın bildirdiği yetenekler (`info().capabilities`); bildirilmemişse hepsi `false`. Ekranlar `source.capabilities` yerine bunu okur. */
  capabilities: Capabilities;
  loading: boolean;
  error: boolean;
  /** Yükleme hatasından sonra yeniden dener. */
  retry(): void;
};

const shared = new WeakMap<SimSource, Promise<SourceInfo>>();
/** Kaynak başına tek `info()` çağrısı (bileşenler ve StrictMode arasında paylaşılır); hata önbelleğe alınmaz. */
function infoOnce(source: SimSource): Promise<SourceInfo> {
  const hit = shared.get(source);
  if (hit) return hit;
  const p = source.info();
  shared.set(source, p);
  p.catch(() => {
    if (shared.get(source) === p) shared.delete(source);
  });
  return p;
}

/** Kaynak bilgisini (tohumlar, ayarlar, kayıt, yetenekler) bir kez yükler. */
export function useSourceInfo(): SourceInfoState {
  const source = useSimSource();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ source: unknown; info: SourceInfo | null; error: boolean }>({ source: null, info: null, error: false });
  useEffect(() => {
    let live = true;
    infoOnce(source).then(
      (info) => live && setState({ source, info, error: false }),
      () => live && setState({ source, info: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [source, tick]);
  const current = state.source === source;
  const info = current ? state.info : null;
  return {
    info,
    capabilities: { ...NO_CAPABILITIES, ...(info?.capabilities ?? {}) },
    loading: !current,
    error: current && state.error,
    retry: () => {
      setState({ source: null, info: null, error: false });
      setTick((n) => n + 1);
    },
  };
}
