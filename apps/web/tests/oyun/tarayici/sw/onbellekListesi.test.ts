// @vitest-environment node
// B7: derleme sonrasi on onbellek listesi, SW damgasi ve CSP bloklari (scripts/onbellekListesi.mjs).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../../../..");
interface Girdi {
  yol: string;
  sha256?: string;
  boyut: number;
}
interface Modul {
  CSP_BASLANGIC: string;
  SURUM_ISARETI: string;
  listeUret(out: string): { kimlik: string; pyodide: string; manifest: Girdi; paket: Girdi; pyodideDosyalari: Girdi[]; sayfa: Girdi[] };
  calistir(web: string, out: string, bayrakli?: boolean): { kimlik: string } | null;
  denetle(out: string, bayrakli?: boolean, olcum?: boolean): void;
  satirIciOzetler(html: string): string[];
  kuralSayisi(metin: string): number;
  KAPATMA_SW: string;
  ISCI_ADI: string;
  bayrakliMi(out: string): boolean;
  bayrakKarari(out: string, env: string | undefined): boolean;
  KURAL_SINIRI: number;
  yayinKorumasi(bayrakli: boolean, env: Record<string, string | undefined>, argv: string[]): string | null;
}
const modul = (await import(/* @vite-ignore */ path.join(WEB, "scripts/onbellekListesi.mjs"))) as Modul;

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const kokler: string[] = [];
afterAll(() => kokler.forEach((k) => rmSync(k, { recursive: true, force: true })));

function yaz(out: string, yol: string, icerik: string | Buffer): void {
  const tam = path.join(out, yol);
  mkdirSync(path.dirname(tam), { recursive: true });
  writeFileSync(tam, icerik);
}

const ZIP = "oyun-0123456789ab.zip";
const INLINE = "self.__next_f.push([0])";

/** Kucuk sahte `out/`: oyun sayfasi -> chunk -> baska chunk + css -> font. */
function sahteOut(model = "M1"): string {
  const out = mkdtempSync(path.join(tmpdir(), "onbellek-"));
  kokler.push(out);
  const zip = Buffer.from(`ZIP-${model}`);
  yaz(out, "oyun/index.html", `<html><link rel="stylesheet" href="/_next/static/chunks/s.css"/><script src="/_next/static/chunks/a.js"></script><script>${INLINE}</script></html>`);
  yaz(out, "oyun/oyun-0123456789ab.zip", zip);
  yaz(out, "oyun/manifest.json", JSON.stringify({ surum: 1, pyodide: "0.27.7", model_sha256: model, paket: { ad: ZIP, sha256: sha(zip), boyut: zip.length } }));
  yaz(out, "pyodide/0.27.7/pyodide.mjs", "MJS");
  yaz(out, "pyodide/0.27.7/pyodide.asm.wasm", "WASM");
  yaz(out, "_next/static/chunks/a.js", `x("static/chunks/b.js"); y("/_next/static/media/oyunWorker.q.ts"); z("static/chunks/yok.js")`);
  yaz(out, "_next/static/chunks/b.js", "b");
  yaz(out, "_next/static/chunks/b.js.map", "map");
  yaz(out, "_next/static/chunks/baska.js", "baska sayfa"); // oyun sayfasindan erisilmez
  yaz(out, "_next/static/chunks/s.css", "@font-face{src:url(../media/f.1.woff2) format('woff2'),url(../media/f.2.woff) format('woff')}");
  yaz(out, "_next/static/media/f.1.woff2", "w2");
  yaz(out, "_next/static/media/f.2.woff", "w1");
  yaz(out, "_next/static/media/oyunWorker.q.ts", "ts");
  yaz(out, "oyun-sprite/a.png", "PNG");
  yaz(out, "index.html", `<html><script>${INLINE}</script><script>other()</script></html>`);
  yaz(out, "404.html", "<html></html>");
  return out;
}

describe("liste", () => {
  let out = "";
  beforeEach(() => {
    out = sahteOut();
  });

  it("manifest, paket, Pyodide, sayfa kapanisi ve sprite ozet/boyutla listelenir", () => {
    const l = modul.listeUret(out);
    expect(l.pyodide).toBe("0.27.7");
    expect(l.manifest.yol).toBe("/oyun/manifest.json");
    expect(l.paket).toEqual({ yol: `/oyun/${ZIP}`, sha256: sha("ZIP-M1"), boyut: 6 });
    expect(l.pyodideDosyalari.map((x: { yol: string }) => x.yol)).toEqual(["/pyodide/0.27.7/pyodide.asm.wasm", "/pyodide/0.27.7/pyodide.mjs"]);
    expect(l.pyodideDosyalari[0]).toEqual({ yol: "/pyodide/0.27.7/pyodide.asm.wasm", sha256: sha("WASM"), boyut: 4 });
    expect(l.sayfa.map((x: { yol: string }) => x.yol)).toEqual([
      "/oyun/", // HTML ozetsiz
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
      "/_next/static/chunks/s.css",
      "/_next/static/media/f.1.woff2",
      "/oyun-sprite/a.png",
    ]);
    expect(l.sayfa[0]).not.toHaveProperty("sha256");
  });

  it("kimlik belirleyicidir; manifest/paket degisince degisir", () => {
    const a = modul.listeUret(out).kimlik;
    expect(modul.listeUret(out).kimlik).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    const b = modul.listeUret(sahteOut("M2")).kimlik;
    expect(b).not.toBe(a);
  });

  it("paket ozeti manifestle uyusmazsa hata verir", () => {
    yaz(out, "oyun/oyun-0123456789ab.zip", "BOZUK");
    expect(() => modul.listeUret(out)).toThrow("sha256");
  });
});

describe("calistir: sw damgasi, liste dosyasi, basliklar", () => {
  it("out/sw.js damgalanir (isaret yok, kimlik var), liste yazilir, tekrar calisinca ayni", () => {
    const out = sahteOut();
    const l = modul.calistir(WEB, out) as { kimlik: string };
    const sw = readFileSync(path.join(out, "sw.js"), "utf-8");
    expect(sw).toContain(`const SURUM = "${l.kimlik}";`);
    expect(sw).not.toContain("__OYUN_SURUM__");
    expect(JSON.parse(readFileSync(path.join(out, "oyun/oyun-onbellek.json"), "utf-8")).kimlik).toBe(l.kimlik);
    const basliklar = readFileSync(path.join(out, "_headers"), "utf-8");
    modul.calistir(WEB, out);
    expect(readFileSync(path.join(out, "_headers"), "utf-8")).toBe(basliklar);
    expect(basliklar.split(modul.CSP_BASLANGIC).length).toBe(2);
  });

  it("model degisince sw.js baytlari degisir (tarayici yeni worker'i gorur)", () => {
    const a = sahteOut("M1");
    const b = sahteOut("M2");
    modul.calistir(WEB, a);
    modul.calistir(WEB, b);
    expect(readFileSync(path.join(a, "sw.js"), "utf-8")).not.toBe(readFileSync(path.join(b, "sw.js"), "utf-8"));
  });

  it("CSP: sayfa basina satir ici betik ozetleri; worker kurali; sablon korunur", () => {
    const out = sahteOut();
    modul.calistir(WEB, out);
    const tum = readFileSync(path.join(out, "_headers"), "utf-8");
    const h = tum.slice(tum.indexOf(modul.CSP_BASLANGIC));
    const oz = `'sha256-${createHash("sha256").update(INLINE).digest("base64")}'`;
    const oyun = h.split("\n").find((s, i, a) => a[i - 1] === "/oyun/") ?? "";
    expect(oyun).toContain("Content-Security-Policy:");
    expect(oyun).toContain(oz);
    expect(oyun).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(oyun).not.toMatch(/(?<!wasm-)unsafe-eval/);
    expect(oyun).toContain("worker-src 'self'");
    const kok = h.split("\n").find((s, i, a) => a[i - 1] === "/") ?? "";
    expect(kok).toContain(`'sha256-${createHash("sha256").update("other()").digest("base64")}'`);
    expect(h).toContain("/_next/static/chunks/*\n  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'");
    expect(tum).toContain("X-Content-Type-Options: nosniff");
    expect(tum).not.toContain("Cross-Origin-Opener-Policy");
    expect(tum).not.toContain("Cross-Origin-Embedder-Policy");
    // 404 sayfalari icin kural uretilmez
    expect(h).not.toContain("/404");
  });

  it("public/_headers uretilen blogu icermez ve sw.js isareti tam bir kez gecer", () => {
    expect(readFileSync(path.join(WEB, "public/_headers"), "utf-8")).not.toContain(modul.CSP_BASLANGIC);
    expect(readFileSync(path.join(WEB, "public/sw.js"), "utf-8").split(modul.SURUM_ISARETI).length).toBe(2);
  });
});

describe("B9 olcum kancasi sizintisi", () => {
  it("olcum bayragi kapaliyken out/ icinde __oyunOlcum gecen dosya denetimi kirar (bayrakli ve bayraksiz); bayrak aciksa gecer", () => {
    for (const bayrakli of [true, false]) {
      const out = sahteOut();
      modul.calistir(WEB, out, bayrakli);
      expect(() => modul.denetle(out, bayrakli)).not.toThrow();
      mkdirSync(path.join(out, "_next/static/chunks"), { recursive: true });
      writeFileSync(path.join(out, "_next/static/chunks/a.js"), 'globalThis.__oyunOlcum={tepe:{}}');
      expect(() => modul.denetle(out, bayrakli)).toThrow("__oyunOlcum");
      expect(() => modul.denetle(out, bayrakli, false)).toThrow("__oyunOlcum");
      expect(() => modul.denetle(out, bayrakli, true)).not.toThrow();
    }
  });

  it("next.config.ts olcum bayragini bos dizge olarak sabitler (aksi halde budama calismaz)", () => {
    expect(readFileSync(path.join(WEB, "next.config.ts"), "utf-8")).toMatch(/NEXT_PUBLIC_OYUN_OLCUM:\s*process\.env\.NEXT_PUBLIC_OYUN_OLCUM \?\? ""/);
  });
});

describe("B7 duzeltme turu 1", () => {
  it("K7: data-src gibi src ile biten nitelik satir ici betigi gizlemez; gercek src'li betik ozetlenmez", () => {
    const html = '<script data-src="x">inline1()</script><script src="/a.js"></script><script async src="/b.js"></script><script>inline2()</script>';
    const oz = modul.satirIciOzetler(html);
    expect(oz).toHaveLength(2);
    expect(oz).toContain(`'sha256-${createHash("sha256").update("inline1()").digest("base64")}'`);
  });

  it("K6: cikti denetimi damgasiz sw.js, eksik liste ve CSP'siz _headers'ta hata verir; tamam derlemede gecer", () => {
    const out = sahteOut();
    expect(() => modul.denetle(out)).toThrow("postbuild");
    modul.calistir(WEB, out);
    expect(() => modul.denetle(out)).not.toThrow();
    writeFileSync(path.join(out, "sw.js"), readFileSync(path.join(WEB, "public/sw.js"), "utf-8")); // damgasiz kaynak
    expect(() => modul.denetle(out)).toThrow("damgasiz");
    rmSync(path.join(out, "oyun/oyun-onbellek.json"));
    expect(() => modul.denetle(out)).toThrow("oyun-onbellek.json yok");
  });

  it("K6: _headers kural sayisi 100'u asarsa derleme hata verir", () => {
    const out = sahteOut();
    for (let i = 0; i < 101; i += 1) yaz(out, `s${i}/index.html`, "<html></html>");
    expect(() => modul.calistir(WEB, out)).toThrow("100");
    expect(modul.kuralSayisi("# yorum\n/a\n  X: 1\n\n/b\n  Y: 2")).toBe(2);
  });

  it("K9: bayraksiz derlemede sw.js kapatma SW'sidir (liste uretilmez); CSP yine yazilir", () => {
    const out = sahteOut();
    expect(modul.calistir(WEB, out, false)).toBeNull();
    expect(readFileSync(path.join(out, "sw.js"), "utf-8")).toBe(modul.KAPATMA_SW);
    expect(readFileSync(path.join(out, "_headers"), "utf-8")).toContain(modul.CSP_BASLANGIC);
    expect(() => modul.denetle(out, false)).not.toThrow();
    expect(() => readFileSync(path.join(out, "oyun/oyun-onbellek.json"))).toThrow();
  });

  it("K9: kapatma SW'si etkinlesince oyun- onbelleklerini siler ve kaydi kaldirir (baska onbellege dokunmaz)", async () => {
    const dinleyiciler: Record<string, ((o: { waitUntil(p: Promise<unknown>): void }) => void)[]> = {};
    const onbellekler = new Map<string, number>([["oyun-ortak-v1", 1], ["oyun-meta-v1", 1], ["baska", 1]]);
    let kaldirildi = false;
    let atlandi = false;
    const self = {
      addEventListener: (t: string, f: never) => (dinleyiciler[t] ??= []).push(f),
      skipWaiting: () => void (atlandi = true),
      registration: { unregister: async () => void (kaldirildi = true) },
    };
    const caches = { keys: async () => [...onbellekler.keys()], delete: async (a: string) => onbellekler.delete(a) };
    new Function("self", "caches", modul.KAPATMA_SW)(self, caches);
    dinleyiciler.install![0]!({ waitUntil: () => undefined });
    expect(atlandi).toBe(true);
    const sozler: Promise<unknown>[] = [];
    dinleyiciler.activate![0]!({ waitUntil: (p) => void sozler.push(p) });
    await Promise.all(sozler);
    expect([...onbellekler.keys()]).toEqual(["baska"]);
    expect(kaldirildi).toBe(true);
  });

  it("K-c: bayrak derleme CIKTISINDAN okunur (env bos olsa da, .env dosyasiyla derlenmis bayrakli cikti bayrakli sayilir); env tarayici ama cikti degilse hata", () => {
    const out = sahteOut();
    expect(modul.bayrakliMi(out)).toBe(false);
    expect(modul.bayrakKarari(out, undefined)).toBe(false);
    expect(() => modul.bayrakKarari(out, "tarayici")).toThrow("tarayici kodu yok");
    yaz(out, "_next/static/chunks/worker.js", 'new Worker(u,{type:"module",name:"oyun-pyodide"})');
    expect(modul.bayrakliMi(out)).toBe(true);
    expect(modul.bayrakKarari(out, undefined)).toBe(true); // .env.production senaryosu: env gorunmez, cikti bayrakli
    expect(modul.bayrakKarari(out, "tarayici")).toBe(true);
  });

  it("R2-3: Worker adi derleme betigi ile isciUret.ts'de AYNI (ad degisirse bayrak tespiti kirilir: bu test kirilir)", () => {
    const kaynak = readFileSync(path.join(WEB, "src/oyun/tarayici/isciUret.ts"), "utf-8");
    expect(kaynak).toContain(`name: "${modul.ISCI_ADI}"`);
    // yalniz Worker/tarayici modullerinde gecer: baska kaynak dosyalarina sizmaz (bayraksiz derlemeyi bayrakli gostermesin)
    const sizan: string[] = [];
    const yuru = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const y = path.join(d, e.name);
        if (e.isDirectory()) yuru(y);
        else if (/\.(ts|tsx)$/.test(e.name) && readFileSync(y, "utf-8").includes(modul.ISCI_ADI) && !y.endsWith("tarayici/isciUret.ts")) sizan.push(path.relative(WEB, y));
      }
    };
    yuru(path.join(WEB, "src"));
    expect(sizan).toEqual([]);
  });

  it("R2-3: bayrak tespiti alt dizinlerdeki parcalari da tarar", () => {
    const out = sahteOut();
    yaz(out, "_next/static/chunks/alt/worker.js", `name:"${modul.ISCI_ADI}"`);
    expect(modul.bayrakliMi(out)).toBe(true);
  });
});

describe("Y2: yayin korumasi (bayraksiz yayin sessiz gecmez)", () => {
  const calistirCli = (out: string, args: string[], env: Record<string, string>) => {
    const temiz = { ...process.env };
    delete temiz.WORKERS_CI;
    delete temiz.NEXT_PUBLIC_OYUN_KAYNAK;
    return spawnSync(process.execPath, [path.join(WEB, "scripts/onbellekListesi.mjs"), "--out", out, ...args], { env: { ...temiz, ...env }, encoding: "utf-8" });
  };
  const bayrakliOut = (): string => {
    const out = sahteOut();
    yaz(out, "_next/static/chunks/w.js", modul.ISCI_ADI);
    return out;
  };

  it("saf karar: WORKERS_CI=1 iken bayraksiz cikti hata; --bayrakli-bekle bayraksiz hata; bayrakli ya da yerel gecer", () => {
    expect(modul.yayinKorumasi(false, { WORKERS_CI: "1" }, [])).toContain("NEXT_PUBLIC_OYUN_KAYNAK=tarayici");
    expect(modul.yayinKorumasi(false, {}, ["--bayrakli-bekle"])).toContain("NEXT_PUBLIC_OYUN_KAYNAK=tarayici");
    expect(modul.yayinKorumasi(true, { WORKERS_CI: "1" }, ["--bayrakli-bekle"])).toBeNull();
    expect(modul.yayinKorumasi(false, {}, [])).toBeNull();
    expect(modul.yayinKorumasi(false, { WORKERS_CI: "0" }, [])).toBeNull();
  });

  it("komut satiri: WORKERS_CI=1 ile bayraksiz derleme kirilir (kapatma SW'si yazilmaz); bayrakli gecer", () => {
    const bayraksiz = sahteOut();
    const r = calistirCli(bayraksiz, [], { WORKERS_CI: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NEXT_PUBLIC_OYUN_KAYNAK=tarayici");
    expect(() => readFileSync(path.join(bayraksiz, "sw.js"))).toThrow();
    const yerel = calistirCli(sahteOut(), [], {});
    expect(yerel.status).toBe(0); // yerel bayraksiz onizleme derlemesi serbest
    const iyi = bayrakliOut();
    expect(calistirCli(iyi, [], { WORKERS_CI: "1", NEXT_PUBLIC_OYUN_KAYNAK: "tarayici" }).status).toBe(0);
  });

  it("denetle:cikti --bayrakli-bekle: bayraksiz cikti hata verir, bayrakli cikti gecer; seceneksiz bayraksiz yerelde gecer", () => {
    const bayraksiz = sahteOut();
    expect(calistirCli(bayraksiz, [], {}).status).toBe(0);
    expect(calistirCli(bayraksiz, ["--denetle"], {}).status).toBe(0);
    const r = calistirCli(bayraksiz, ["--denetle", "--bayrakli-bekle"], {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--bayrakli-bekle");
    const iyi = bayrakliOut();
    expect(calistirCli(iyi, [], { NEXT_PUBLIC_OYUN_KAYNAK: "tarayici" }).status).toBe(0);
    expect(calistirCli(iyi, ["--denetle", "--bayrakli-bekle"], { NEXT_PUBLIC_OYUN_KAYNAK: "tarayici" }).status).toBe(0);
  });
});

describe("frame-ancestors 'self'", () => {
  it("uretilen _headers her sayfa CSP'sinde frame-ancestors 'self' tasir; eksikse denetle() kirilir", () => {
    const out = sahteOut();
    modul.calistir(WEB, out);
    const yol = path.join(out, "_headers");
    const metin = readFileSync(yol, "utf-8");
    const sayfaSatirlari = metin.split("\n").filter((l) => l.includes("Content-Security-Policy: default-src 'self'"));
    expect(sayfaSatirlari.length).toBeGreaterThan(0);
    for (const l of sayfaSatirlari) expect(l).toContain("frame-ancestors 'self'");
    expect(() => modul.denetle(out)).not.toThrow();
    writeFileSync(yol, metin.replaceAll("; frame-ancestors 'self'", ""));
    expect(() => modul.denetle(out)).toThrow("frame-ancestors");
  });
});
