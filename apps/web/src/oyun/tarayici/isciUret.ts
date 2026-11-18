/**
 * B5: gercek oyun Worker'ini uretir (yalniz tarayici kaynagi secilince ice aktarilir).
 * `new URL(..., import.meta.url)` kalibi paketleyicinin Worker'i ayri bir modul parcasi olarak derlemesi icindir.
 */
import type { WorkerBaglantisi } from "./yukleyici";

export function gercekWorkerUret(): WorkerBaglantisi {
  return new Worker(new URL("./oyunWorker.ts", import.meta.url), { type: "module", name: "oyun-pyodide" }) as unknown as WorkerBaglantisi;
}
