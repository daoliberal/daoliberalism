/**
 * B5: oyun Web Worker'i (modul worker). Pyodide YALNIZ burada yuklenir; ana is parcacigi Python'a dokunmaz.
 * Mantik `isci.ts`tedir (enjekte edilen ortamla test edilir); bu dosya yalniz gercek ortami baglar.
 * Derleme: `new Worker(new URL("./oyunWorker.ts", import.meta.url), { type: "module" })` (Next/Turbopack). `pyodide.mjs` dinamik ice aktarilir
 * (`webpackIgnore`: paketleyici onu derlemez, Worker calisma zamaninda `/pyodide/0.27.7/pyodide.mjs`i ceker).
 */
import { Isci, type IsciOrtami, type PyodideModulu } from "./isci";
import { olcumBildirSar, olcumPyodideSar } from "./olcumKancasi";
import type { AnaMesaj, IsciMesaji } from "./protokol";

interface IsciKapsami {
  onmessage: ((ev: MessageEvent<AnaMesaj>) => void) | null;
  postMessage(m: IsciMesaji, aktar?: Transferable[]): void;
}

const kapsam = self as unknown as IsciKapsami;

const ortam: IsciOrtami = {
  fetch: (girdi, init) => fetch(girdi, init),
  pyodideAc: async (url) => olcumPyodideSar((await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as PyodideModulu),
  sha256Hex: async (veri) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("subtle_yok");
    const ozet = new Uint8Array(await subtle.digest("SHA-256", veri));
    return Array.from(ozet, (b) => b.toString(16).padStart(2, "0")).join("");
  },
  simdi: () => performance.now(),
  bekle: (ms) => new Promise((coz) => setTimeout(coz, ms)),
};

const isci = new Isci(ortam, olcumBildirSar((m, aktar) => kapsam.postMessage(m, aktar ?? [])));
kapsam.onmessage = (ev) => {
  void isci.mesaj(ev.data);
};
