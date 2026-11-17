"use client";
import { useEffect, useState } from "react";
import { loadRegistry } from "./registry";
import { useSimSource } from "./SimSourceContext";
import type { Registry } from "./types";

export type RegistryState = { registry: Registry | null; error: boolean };

/** Kaynağın kayıt (kart) listesini yükler; kaynak başına tek yükleme `loadRegistry` önbelleğindedir. */
export function useRegistry(): RegistryState {
  const source = useSimSource();
  const [s, setS] = useState<{ source: unknown; registry: Registry | null; error: boolean }>({ source: null, registry: null, error: false });
  useEffect(() => {
    let live = true;
    loadRegistry(source).then(
      (registry) => live && setS({ source, registry, error: false }),
      () => live && setS({ source, registry: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [source]);
  const cur = s.source === source;
  return { registry: cur ? s.registry : null, error: cur && s.error };
}
