import type { Registry, SimSource } from "./types";

const cache = new WeakMap<SimSource, Promise<Registry>>();

/** Kaynağın kayıt (kart) listesi; kaynak başına bir kez yüklenir, başarısızlık önbelleğe alınmaz. */
export function loadRegistry(source: SimSource): Promise<Registry> {
  const hit = cache.get(source);
  if (hit) return hit;
  const p = (async (): Promise<Registry> => {
    if (source.registry) return source.registry();
    const reg = (await source.info()).registry;
    if (!reg) throw new Error("registry_missing");
    return reg;
  })();
  cache.set(source, p);
  p.catch(() => {
    if (cache.get(source) === p) cache.delete(source);
  });
  return p;
}
