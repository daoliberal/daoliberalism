/**
 * B7: `public/sw.js` icin sahte ServiceWorker ortami (Node). SW kaynagi gercekten `new Function` ile yuklenir; `caches`, `fetch`, `self` sahtedir.
 * Sahte sunucu: yol -> {govde, tur}; istek sayaclari ve cevrimdisi anahtari.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORIGIN = "http://oyun.test";
const SW_KAYNAK = readFileSync(path.resolve(import.meta.dirname, "../../../../public/sw.js"), "utf-8");

export const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

interface Kayit {
  status: number;
  headers: [string, string][];
  govde: Uint8Array;
}

export class SahteCache {
  readonly kayitlar = new Map<string, Kayit>();
  private anahtar(a: string | Request): string {
    return typeof a === "string" ? a : a.url;
  }
  async match(a: string | Request): Promise<Response | undefined> {
    const k = this.kayitlar.get(this.anahtar(a));
    return k ? new Response(k.govde.slice(), { status: k.status, headers: k.headers }) : undefined;
  }
  async put(a: string | Request, r: Response): Promise<void> {
    const govde = new Uint8Array(await r.arrayBuffer());
    this.kayitlar.set(this.anahtar(a), { status: r.status, headers: [...r.headers.entries()], govde });
  }
  async delete(a: string | Request): Promise<boolean> {
    return this.kayitlar.delete(this.anahtar(a));
  }
  async keys(): Promise<Request[]> {
    return [...this.kayitlar.keys()].map((u) => new Request(u));
  }
}

export class SahteCaches {
  readonly harita = new Map<string, SahteCache>();
  async open(ad: string): Promise<SahteCache> {
    let c = this.harita.get(ad);
    if (!c) this.harita.set(ad, (c = new SahteCache()));
    return c;
  }
  async keys(): Promise<string[]> {
    return [...this.harita.keys()];
  }
  async delete(ad: string): Promise<boolean> {
    return this.harita.delete(ad);
  }
  yollar(ad: string): string[] {
    return [...(this.harita.get(ad)?.kayitlar.keys() ?? [])].map((u) => new URL(u).pathname).sort();
  }
}

export interface SunucuDosyasi {
  govde: string | Buffer;
  tur?: string;
  basliklar?: Record<string, string>;
}

/** Cevrimici/cevrimdisi sahte ag. `bozuk`: yola gelen govde yerine bu bozuk icerik doner (ozet uyusmazligi). */
export class SahteAg {
  readonly dosyalar = new Map<string, SunucuDosyasi>();
  readonly istekler: string[] = [];
  cevrimdisi = false;
  bekleyen: Promise<void> | null = null;
  /** Yol -> zorlanan durum kodu (ornegin 503). */
  readonly durumlar = new Map<string, number>();
  /** Ilk N istekten sonra ag kopar (yarim kalan kurulum). */
  kopmaSiniri: number | null = null;

  koy(yol: string, govde: string | Buffer, tur = "application/octet-stream", basliklar?: Record<string, string>): void {
    this.dosyalar.set(yol, { govde, tur, basliklar });
  }
  sayac(onek: string): number {
    return this.istekler.filter((y) => y.startsWith(onek)).length;
  }
  fetch = async (girdi: string | Request): Promise<Response> => {
    const url = new URL(typeof girdi === "string" ? girdi : girdi.url);
    if (this.bekleyen) await this.bekleyen;
    if (this.cevrimdisi) throw new TypeError("Failed to fetch");
    if (this.kopmaSiniri !== null && this.istekler.length >= this.kopmaSiniri) throw new TypeError("Failed to fetch");
    this.istekler.push(url.pathname);
    const zorla = this.durumlar.get(url.pathname);
    if (zorla !== undefined) return new Response("hata", { status: zorla });
    const d = this.dosyalar.get(url.pathname);
    if (!d) return new Response("yok", { status: 404 });
    const b = typeof d.govde === "string" ? Buffer.from(d.govde) : d.govde;
    return new Response(new Uint8Array(b), { status: 200, headers: { "content-type": d.tur ?? "application/octet-stream", "content-length": String(b.length), ...d.basliklar } });
  };
}

export interface FetchOlayi {
  request: Request;
  respondWith(p: Response | Promise<Response>): void;
  waitUntil(p: Promise<unknown>): void;
}

export interface Dinleyiciler {
  install: ((o: { waitUntil(p: Promise<unknown>): void }) => void)[];
  activate: ((o: { waitUntil(p: Promise<unknown>): void }) => void)[];
  fetch: ((o: FetchOlayi) => void)[];
  message: ((o: { data: unknown; source?: { postMessage(m: unknown): void } }) => void)[];
}

export class SahteSW {
  readonly dinleyiciler: Dinleyiciler = { install: [], activate: [], fetch: [], message: [] };
  skipWaitingSayisi = 0;
  claimSayisi = 0;

  constructor(
    readonly kimlik: string,
    readonly caches: SahteCaches,
    readonly ag: SahteAg,
  ) {
    const kaynak = SW_KAYNAK.replace('"__OYUN_SURUM__"', JSON.stringify(kimlik));
    if (kaynak === SW_KAYNAK) throw new Error("surum isareti yok");
    const self = {
      location: { origin: ORIGIN },
      addEventListener: (tur: keyof Dinleyiciler, f: never) => (this.dinleyiciler[tur] as unknown[]).push(f),
      clients: { claim: async () => void (this.claimSayisi += 1) },
      skipWaiting: async () => void (this.skipWaitingSayisi += 1),
    };
    new Function("self", "caches", "fetch", kaynak)(self, caches, ag.fetch);
  }

  /** `install` olayi: waitUntil ile verilen sozu bekler. */
  async kur(): Promise<void> {
    const sozler: Promise<unknown>[] = [];
    for (const f of this.dinleyiciler.install) f({ waitUntil: (p) => void sozler.push(p) });
    await Promise.all(sozler);
  }

  async etkinles(): Promise<void> {
    const sozler: Promise<unknown>[] = [];
    for (const f of this.dinleyiciler.activate) f({ waitUntil: (p) => void sozler.push(p) });
    await Promise.all(sozler);
  }

  /** `fetch` olayi: respondWith cagrilmadiysa `null` (gecis: tarayici aga gider). */
  async getir(yol: string, o: { mode?: RequestMode; method?: string; headers?: Record<string, string>; origin?: string } = {}): Promise<Response | null> {
    const url = (o.origin ?? ORIGIN) + yol;
    const init: RequestInit = { method: o.method ?? "GET", headers: o.headers };
    const istek = new Request(url, init);
    if (o.mode === "navigate") Object.defineProperty(istek, "mode", { value: "navigate" });
    let yanit: Promise<Response> | null = null;
    const bekleyenler: Promise<unknown>[] = [];
    for (const f of this.dinleyiciler.fetch) f({ request: istek, respondWith: (p) => void (yanit = Promise.resolve(p)), waitUntil: (p) => void bekleyenler.push(p) });
    const r = yanit ? await (yanit as Promise<Response>) : null;
    await Promise.all(bekleyenler);
    return r;
  }

  mesaj(veri: unknown, kaynak?: { postMessage(m: unknown): void }): void {
    for (const f of this.dinleyiciler.message) f({ data: veri, source: kaynak });
  }
}

export interface Surum {
  kimlik: string;
  model: string;
  zipAd: string;
  zip: string;
  pyodide: Record<string, string>;
  sayfa: Record<string, string>;
  html?: string;
  pyodideSurum?: string;
  /** Her dosyaya eklenen ag basliklari (ornegin CSP). */
  basliklar?: Record<string, string>;
}

/** Bir "derleme"yi sahte aga koyar ve `oyun-onbellek.json` + manifest'i uretir. */
export function surumYayinla(ag: SahteAg, s: Surum): void {
  const psurum = s.pyodideSurum ?? "0.27.7";
  const girdi = (yol: string, govde: string) => ({ yol, sha256: sha(govde), boyut: Buffer.byteLength(govde) });
  const manifestMetni = JSON.stringify({ surum: 1, pyodide: psurum, goruntu_sema: 2, host_sema: 1, model_sha256: s.model, paket: { ad: s.zipAd, sha256: sha(s.zip), boyut: s.zip.length }, dosyalar: [] });
  for (const [ad, g] of Object.entries(s.pyodide)) ag.koy(`/pyodide/${psurum}/${ad}`, g, ad.endsWith(".wasm") ? "application/wasm" : "application/javascript", s.basliklar);
  for (const [yol, g] of Object.entries(s.sayfa)) ag.koy(yol, g, "text/javascript", s.basliklar);
  ag.koy(`/oyun/${s.zipAd}`, s.zip, "application/zip", s.basliklar);
  ag.koy("/oyun/manifest.json", manifestMetni, "application/json");
  ag.koy("/oyun/", s.html ?? `<html>${s.kimlik}</html>`, "text/html", s.basliklar);
  const liste = {
    surum: 1,
    kimlik: s.kimlik,
    pyodide: psurum,
    model_sha256: s.model,
    manifest: girdi("/oyun/manifest.json", manifestMetni),
    paket: girdi(`/oyun/${s.zipAd}`, s.zip),
    pyodideDosyalari: Object.entries(s.pyodide).map(([ad, g]) => girdi(`/pyodide/${psurum}/${ad}`, g)),
    sayfa: [{ yol: "/oyun/", boyut: 1, html: true }, ...Object.entries(s.sayfa).map(([yol, g]) => girdi(yol, g))],
  };
  ag.koy("/oyun/oyun-onbellek.json", JSON.stringify(liste), "application/json");
}
