// @vitest-environment node
// B7: Service Worker (public/sw.js) yasam dongusu ve stratejiler. SW kaynagi gercek dosyadan yuklenir; ag/onbellek sahtedir.
import { describe, expect, it } from "vitest";
import { ORIGIN, SahteAg, SahteCaches, SahteSW, sha, surumYayinla, type Surum } from "./swOrtam";

const PYODIDE = { "pyodide.asm.wasm": "WASM-1", "pyodide.mjs": "MJS-1", "python_stdlib.zip": "STD-1" };

function surum(kimlik: string, model: string, ek: Partial<Surum> = {}): Surum {
  return {
    kimlik,
    model,
    zipAd: `oyun-${sha(model).slice(0, 12)}.zip`,
    zip: `ZIP-${model}`,
    pyodide: PYODIDE,
    sayfa: { "/_next/static/chunks/a.js": `A-${kimlik}`, "/_next/static/chunks/ortak.js": "ORTAK" },
    ...ek,
  };
}

/** Bir surumu yayinlayip kurar (+ istenirse etkinlestirir). Onbellekler surumler arasi paylasilir. */
async function kurEtkin(ag: SahteAg, caches: SahteCaches, s: Surum, etkin = true): Promise<SahteSW> {
  surumYayinla(ag, s);
  const sw = new SahteSW(s.kimlik, caches, ag);
  await sw.kur();
  if (etkin) await sw.etkinles();
  return sw;
}

const yeni = () => ({ ag: new SahteAg(), caches: new SahteCaches() });

describe("kurulum (on onbellek)", () => {
  it("tum listeyi indirir, ozetleri dogrular ve gen kaydi yazar", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1"), false);
    expect(caches.yollar("oyun-ortak-v1")).toEqual(
      ["/_next/static/chunks/a.js", "/_next/static/chunks/ortak.js", `/oyun/${surum("v1", "M1").zipAd}`, "/pyodide/0.27.7/pyodide.asm.wasm", "/pyodide/0.27.7/pyodide.mjs", "/pyodide/0.27.7/python_stdlib.zip"].sort(),
    );
    expect(caches.yollar("oyun-meta-v1")).toEqual(["/__oyun/gen/v1", "/__oyun/sayfa/v1"]);
    // wasm turu korunur (instantiateStreaming icin)
    const wasm = await (await caches.open("oyun-ortak-v1")).match(`${ORIGIN}/pyodide/0.27.7/pyodide.asm.wasm`);
    expect(wasm?.headers.get("content-type")).toBe("application/wasm");
  });

  it("ozeti ayni olan dosyalar yeniden indirilmez: yeni surumde yalniz degisenler iner", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.istekler.length = 0;
    await kurEtkin(ag, caches, surum("v2", "M2"), false);
    expect(ag.sayac("/pyodide/")).toBe(0);
    expect(ag.sayac("/_next/static/chunks/ortak.js")).toBe(0);
    // iner: yeni zip, yeni a.js, liste, manifest (+ html her seferinde)
    expect(ag.istekler.sort()).toEqual(["/_next/static/chunks/a.js", "/oyun/", "/oyun/manifest.json", "/oyun/oyun-onbellek.json", `/oyun/${surum("v2", "M2").zipAd}`].sort());
  });

  it("liste kimligi damgayla uyusmazsa kurulum basarisiz olur ve onbellege yazilmaz", async () => {
    const { ag, caches } = yeni();
    surumYayinla(ag, surum("v2", "M2"));
    const sw = new SahteSW("v1", caches, ag);
    await expect(sw.kur()).rejects.toThrow("kimlik_uyusmuyor");
    expect(caches.harita.size).toBe(0);
  });

  it("ozeti uyusmayan dosya kurulumu bozar (gen kaydi yazilmaz)", async () => {
    const { ag, caches } = yeni();
    const s = surum("v1", "M1");
    surumYayinla(ag, s);
    ag.koy("/pyodide/0.27.7/pyodide.asm.wasm", "BOZUK");
    const sw = new SahteSW("v1", caches, ag);
    await expect(sw.kur()).rejects.toThrow("ozet_uyusmuyor");
    expect(caches.yollar("oyun-meta-v1").filter((y) => y.includes("/gen/") || y.includes("/sayfa/"))).toEqual([]);
  });

  it("ag kesilirse kurulum basarisiz olur, onceki onbellek bozulmaz", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1"));
    const once = caches.yollar("oyun-ortak-v1");
    surumYayinla(ag, surum("v2", "M2"));
    ag.cevrimdisi = true;
    await expect(new SahteSW("v2", caches, ag).kur()).rejects.toThrow();
    expect(caches.yollar("oyun-ortak-v1")).toEqual(once);
    expect(caches.yollar("oyun-meta-v1")).toEqual(["/__oyun/durum", "/__oyun/gen/v1", "/__oyun/sayfa/v1"]);
  });

  it("kendiliginden skipWaiting yapmaz (kurulum ve etkinlesme)", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    expect(sw.skipWaitingSayisi).toBe(0);
    expect(sw.claimSayisi).toBe(1);
  });
});

describe("etkinlesme: onceki paket ve cop toplama", () => {
  const durum = async (c: SahteCaches) => {
    const r = await (await c.open("oyun-meta-v1")).match(`${ORIGIN}/__oyun/durum`);
    return r ? ((await r.json()) as { guncel: string; onceki: string | null }) : null;
  };

  it("ilk surum: onceki yok", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1"));
    expect(await durum(caches)).toEqual({ guncel: "v1", onceki: null });
  });

  it("model degisince onceki = eski surum; eski zip ve manifest tutulur", async () => {
    const { ag, caches } = yeni();
    const s1 = surum("v1", "M1");
    const s2 = surum("v2", "M2");
    await kurEtkin(ag, caches, s1);
    await kurEtkin(ag, caches, s2);
    expect(await durum(caches)).toEqual({ guncel: "v2", onceki: "v1" });
    const ortak = caches.yollar("oyun-ortak-v1");
    expect(ortak).toContain(`/oyun/${s1.zipAd}`);
    expect(ortak).toContain(`/oyun/${s2.zipAd}`);
  });

  it("yalniz arayuz degisen surum onceki sayilmaz: bir onceki MODEL tutulur", async () => {
    const { ag, caches } = yeni();
    const s1 = surum("v1", "M1");
    await kurEtkin(ag, caches, s1);
    await kurEtkin(ag, caches, surum("v2", "M2"));
    await kurEtkin(ag, caches, surum("v3", "M2")); // ayni model, yeni arayuz
    expect(await durum(caches)).toEqual({ guncel: "v3", onceki: "v1" });
    expect(caches.yollar("oyun-ortak-v1")).toContain(`/oyun/${s1.zipAd}`);
  });

  it("iki model ileri gidince daha eski paket silinir", async () => {
    const { ag, caches } = yeni();
    const s1 = surum("v1", "M1");
    const s2 = surum("v2", "M2");
    await kurEtkin(ag, caches, s1);
    await kurEtkin(ag, caches, s2);
    await kurEtkin(ag, caches, surum("v3", "M3"));
    expect(await durum(caches)).toEqual({ guncel: "v3", onceki: "v2" });
    const ortak = caches.yollar("oyun-ortak-v1");
    expect(ortak).not.toContain(`/oyun/${s1.zipAd}`);
    expect(ortak).toContain(`/oyun/${s2.zipAd}`);
    expect(caches.yollar("oyun-meta-v1")).toEqual(["/__oyun/durum", "/__oyun/gen/v2", "/__oyun/gen/v3", "/__oyun/sayfa/v2", "/__oyun/sayfa/v3"]);
  });

  it("eski calisma onbellegi ve bilinmeyen oyun- onbellekleri silinir; baskasinin onbellegine dokunulmaz", async () => {
    const { ag, caches } = yeni();
    await (await caches.open("oyun-calisma-eski")).put(`${ORIGIN}/x`, new Response("x"));
    await (await caches.open("baska-uygulama")).put(`${ORIGIN}/y`, new Response("y"));
    await kurEtkin(ag, caches, surum("v1", "M1"));
    expect([...caches.harita.keys()].sort()).toEqual(["baska-uygulama", "oyun-meta-v1", "oyun-ortak-v1"]);
  });

  it("onceki modelin Pyodide surumu farkliysa onceki tutulmaz (yukleyici o surumu bekler)", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1", { pyodideSurum: "0.28.0" }));
    await kurEtkin(ag, caches, surum("v2", "M2"));
    expect(await durum(caches)).toEqual({ guncel: "v2", onceki: null });
  });
});

describe("fetch stratejileri", () => {
  it("Pyodide, model zip'i ve _next/static onbellekten gelir (ag istegi yok)", async () => {
    const { ag, caches } = yeni();
    const s = surum("v1", "M1");
    const sw = await kurEtkin(ag, caches, s);
    ag.istekler.length = 0;
    for (const yol of ["/pyodide/0.27.7/pyodide.asm.wasm", `/oyun/${s.zipAd}`, "/_next/static/chunks/a.js"]) {
      const r = await sw.getir(yol);
      expect(r?.status, yol).toBe(200);
    }
    expect(ag.istekler).toEqual([]);
    expect(await (await sw.getir("/pyodide/0.27.7/pyodide.mjs"))?.text()).toBe("MJS-1");
  });

  it("onbellekte olmayan Pyodide/paket dosyasi aga gider ve calisma onbellegine yazilir (yanit bekletilmez)", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/pyodide/0.27.7/yeni.mjs", "YENI");
    const r = await sw.getir("/pyodide/0.27.7/yeni.mjs");
    expect(await r?.text()).toBe("YENI");
    expect(ag.sayac("/pyodide/0.27.7/yeni.mjs")).toBe(1);
    ag.cevrimdisi = true;
    expect(await (await sw.getir("/pyodide/0.27.7/yeni.mjs"))?.text()).toBe("YENI");
    expect(caches.yollar("oyun-calisma-v1")).toEqual(["/pyodide/0.27.7/yeni.mjs"]);
  });

  it("manifest: once ag (guncel); cevrimdisiysa kurulu surumun manifesti", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    const cevrimici = await sw.getir("/oyun/manifest.json");
    expect(JSON.parse((await cevrimici?.text()) ?? "{}").model_sha256).toBe("M1");
    ag.cevrimdisi = true;
    const cevrimdisi = await sw.getir("/oyun/manifest.json");
    expect(JSON.parse((await cevrimdisi?.text()) ?? "{}").model_sha256).toBe("M1");
    expect(cevrimdisi?.headers.get("x-oyun-surum")).toBe("cevrimdisi");
  });

  it("?model=: kayitli oyunun modeline uyan guncel ya da onceki manifest; bilinmeyen model icin guncel manifest", async () => {
    const { ag, caches } = yeni();
    const s1 = surum("v1", "M1");
    await kurEtkin(ag, caches, s1);
    const sw2 = await kurEtkin(ag, caches, surum("v2", "M2"));
    const eski = await sw2.getir("/oyun/manifest.json?model=M1");
    expect(eski?.headers.get("x-oyun-surum")).toBe("onceki");
    const m = JSON.parse((await eski?.text()) ?? "{}");
    expect(m.model_sha256).toBe("M1");
    expect(m.paket.ad).toBe(s1.zipAd);
    // onceki paket cevrimdisi da acilir
    ag.cevrimdisi = true;
    expect((await sw2.getir(`/oyun/${s1.zipAd}`))?.status).toBe(200);
    ag.cevrimdisi = false;
    const gu = await sw2.getir("/oyun/manifest.json?model=M2");
    expect(gu?.headers.get("x-oyun-surum")).toBe("guncel");
    const yok = await sw2.getir("/oyun/manifest.json?model=BILINMEYEN");
    expect(JSON.parse((await yok?.text()) ?? "{}").model_sha256).toBe("M2"); // govde istenenle uyusmaz: yukleyici/devam akisi uyumsuz yoluna duser
  });

  it("agda yeni surum varken (bekleyen) eski SW ?model= ile kendi manifestini sunar", async () => {
    const { ag, caches } = yeni();
    const sw1 = await kurEtkin(ag, caches, surum("v1", "M1"));
    surumYayinla(ag, surum("v2", "M2")); // sunucuda yeni, SW v1 aktif
    const duz = JSON.parse((await (await sw1.getir("/oyun/manifest.json"))?.text()) ?? "{}");
    expect(duz.model_sha256).toBe("M2");
    const eski = JSON.parse((await (await sw1.getir("/oyun/manifest.json?model=M1"))?.text()) ?? "{}");
    expect(eski.model_sha256).toBe("M1");
  });

  it("gezinme /oyun/: once ag; ag yoksa BU SURUMUN kurulumda saklanan sayfasi (agdan gelen yeni sayfa saklanmaz)", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/oyun/", "<html>YENI</html>", "text/html");
    expect(await (await sw.getir("/oyun/", { mode: "navigate" }))?.text()).toBe("<html>YENI</html>");
    ag.cevrimdisi = true;
    expect(await (await sw.getir("/oyun/", { mode: "navigate" }))?.text()).toBe("<html>v1</html>");
  });

  it("gezinme: sunucu 5xx verirse onbellekteki sayfa", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.durumlar.set("/oyun/", 503);
    expect(await (await sw.getir("/oyun/", { mode: "navigate" }))?.text()).toBe("<html>v1</html>");
  });

  it("gezinme: oyun disi sayfalara karismaz; /oyun (egik cizgisiz) cevrimdisi /oyun/'a yonlenir", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    expect(await sw.getir("/", { mode: "navigate" })).toBeNull();
    expect(await sw.getir("/dao/", { mode: "navigate" })).toBeNull();
    ag.cevrimdisi = true;
    const r = await sw.getir("/oyun", { mode: "navigate" });
    expect(r?.status).toBe(307);
    expect(r?.headers.get("location")).toBe(`${ORIGIN}/oyun/`);
  });

  it("gezinme: ag cok yavassa (zaman asimi) onbellekteki sayfa verilir", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    let ac!: () => void;
    ag.bekleyen = new Promise<void>((c) => (ac = c));
    const t0 = Date.now();
    const r = await sw.getir("/oyun/", { mode: "navigate" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3900);
    expect(await r?.text()).toBe("<html>v1</html>");
    ac();
  }, 10_000);

  it("SW'ye ait olmayanlar gecirilir: farkli kaynak, POST, Range, sw.js, onbellek listesi, diger yollar", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    expect(await sw.getir("/pyodide/0.27.7/pyodide.mjs", { origin: "http://baska.test" })).toBeNull();
    expect(await sw.getir("/oyun/manifest.json", { method: "POST" })).toBeNull();
    expect(await sw.getir("/pyodide/0.27.7/pyodide.asm.wasm", { headers: { range: "bytes=0-9" } })).toBeNull();
    for (const yol of ["/sw.js", "/oyun/oyun-onbellek.json", "/api/runs", "/dao/data.json"]) expect(await sw.getir(yol), yol).toBeNull();
  });

  it("/oyun-kayit/: onbellekten, arkada yenilenir", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/oyun-kayit/a.json", "ILK", "application/json");
    expect(await (await sw.getir("/oyun-kayit/a.json"))?.text()).toBe("ILK");
    ag.koy("/oyun-kayit/a.json", "IKINCI", "application/json");
    expect(await (await sw.getir("/oyun-kayit/a.json"))?.text()).toBe("ILK");
    expect(await (await sw.getir("/oyun-kayit/a.json"))?.text()).toBe("IKINCI");
  });
});

describe("mesajlar", () => {
  it("'atla' yalniz mesajla skipWaiting cagirir; 'kimlik' kimligi yanitlar", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    sw.mesaj({ t: "atla" });
    expect(sw.skipWaitingSayisi).toBe(1);
    const alinan: unknown[] = [];
    sw.mesaj({ t: "kimlik" }, { postMessage: (m) => alinan.push(m) });
    expect(alinan).toEqual([{ t: "kimlik", kimlik: "v1" }]);
    sw.mesaj({ t: "baska" });
    sw.mesaj("metin");
    expect(sw.skipWaitingSayisi).toBe(1);
  });
});

describe("B7 duzeltme turu 1", () => {
  const CSP = { "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff" };

  it("O1: yarida kesilen kurulumdan sonra eski surum cevrimdisi eski sayfayi ve parcalarini eksiksiz verir", async () => {
    const { ag, caches } = yeni();
    const s1 = surum("v1", "M1", { sayfa: { "/_next/static/chunks/a.js": "A-v1", "/oyun-sprite/x.png": "SPRITE-v1" } });
    const sw1 = await kurEtkin(ag, caches, s1);
    const s2 = surum("v2", "M2", { sayfa: { "/_next/static/chunks/b.js": "B-v2", "/oyun-sprite/x.png": "SPRITE-v2" }, html: "<html>SAYFA-v2</html>" });
    surumYayinla(ag, s2);
    ag.kopmaSiniri = 4; // liste + birkac dosyadan sonra ag kopar
    await expect(new SahteSW("v2", caches, ag).kur()).rejects.toThrow();
    ag.kopmaSiniri = null;
    ag.cevrimdisi = true;
    // eski surum: sayfa v1, parcalar v1, AYNI ADLI sprite v1 (v2 ile ezilmedi)
    expect(await (await sw1.getir("/oyun/", { mode: "navigate" }))?.text()).toBe("<html>v1</html>");
    expect(await (await sw1.getir("/_next/static/chunks/a.js"))?.text()).toBe("A-v1");
    expect(await (await sw1.getir("/oyun-sprite/x.png"))?.text()).toBe("SPRITE-v1");
    expect(await (await sw1.getir("/pyodide/0.27.7/pyodide.asm.wasm"))?.text()).toBe("WASM-1");
    expect((await sw1.getir(`/oyun/${s1.zipAd}`))?.status).toBe(200);
  });

  it("O1: basarili kurulumda ayni adli degisen dosya etkinlesmeye kadar eskisi kalir, etkinlesince yenisi gelir", async () => {
    const { ag, caches } = yeni();
    const sw1 = await kurEtkin(ag, caches, surum("v1", "M1", { sayfa: { "/oyun-sprite/x.png": "SPRITE-v1" } }));
    const sw2 = await kurEtkin(ag, caches, surum("v2", "M2", { sayfa: { "/oyun-sprite/x.png": "SPRITE-v2" } }), false);
    expect(await (await sw1.getir("/oyun-sprite/x.png"))?.text()).toBe("SPRITE-v1");
    await sw2.etkinles();
    expect(await (await sw2.getir("/oyun-sprite/x.png"))?.text()).toBe("SPRITE-v2");
    expect([...caches.harita.keys()].some((k) => k.startsWith("oyun-yeni-"))).toBe(false);
  });

  it("Y4: onbellekten verilen yanitlar ag basliklarini (CSP, nosniff) korur: sayfa, Worker betigi, wasm; content-encoding tasinmaz", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1", { basliklar: { ...CSP, "content-encoding": "gzip" } }));
    ag.cevrimdisi = true;
    for (const yol of ["/_next/static/chunks/a.js", "/pyodide/0.27.7/pyodide.asm.wasm"]) {
      const r = await sw.getir(yol);
      expect(r?.headers.get("content-security-policy"), yol).toBe("default-src 'self'");
      expect(r?.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r?.headers.get("content-encoding")).toBeNull();
    }
    const sayfa = await sw.getir("/oyun/", { mode: "navigate" });
    expect(sayfa?.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(sayfa?.headers.get("content-type")).toBe("text/html");
    expect((await sw.getir("/pyodide/0.27.7/pyodide.asm.wasm"))?.headers.get("content-type")).toBe("application/wasm");
  });

  it("K1: etkinlesen surum, bu surumden DAHA YENI kurulmus bekleyen surumun dosyalarini ve kaydini silmez", async () => {
    const { ag, caches } = yeni();
    await kurEtkin(ag, caches, surum("v1", "M1"));
    const sw2 = await kurEtkin(ag, caches, surum("v2", "M2"), false);
    await new Promise((c) => setTimeout(c, 5));
    const s3 = surum("v3", "M3", { sayfa: { "/_next/static/chunks/c.js": "C-v3" } });
    await kurEtkin(ag, caches, s3, false); // v3 kuruldu, bekliyor
    await sw2.etkinles(); // v2 etkinlesirken v3 dosyalari silinmemeli
    expect(caches.yollar("oyun-ortak-v1")).toContain("/_next/static/chunks/c.js");
    expect(caches.yollar("oyun-meta-v1")).toContain("/__oyun/gen/v3");
    expect(caches.yollar("oyun-meta-v1")).toContain("/__oyun/sayfa/v3");
  });

  it("K2: listede olmayan _next/static ve sprite istekleri calisma onbellegine YAZILMAZ", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/_next/static/chunks/baska-sayfa.js", "X");
    expect(await (await sw.getir("/_next/static/chunks/baska-sayfa.js"))?.text()).toBe("X");
    expect(caches.yollar("oyun-calisma-v1")).toEqual([]);
  });

  it("K3: onbellekte olmayan buyuk dosyanin yaniti yazim beklenmeden doner; yazim arkada (waitUntil) biter", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/pyodide/0.27.7/buyuk.wasm", "B".repeat(1000), "application/wasm");
    let yazimBasladi = false;
    const calisma = await caches.open("oyun-calisma-v1");
    const put = calisma.put.bind(calisma);
    calisma.put = async (a, r) => {
      yazimBasladi = true;
      await new Promise((c) => setTimeout(c, 30));
      return put(a, r);
    };
    const istek = new Request("http://oyun.test/pyodide/0.27.7/buyuk.wasm");
    let yanit: Promise<Response> | null = null;
    const bekleyen: Promise<unknown>[] = [];
    for (const f of sw.dinleyiciler.fetch) f({ request: istek, respondWith: (p) => void (yanit = Promise.resolve(p)), waitUntil: (p) => void bekleyen.push(p) });
    const r = await (yanit as unknown as Promise<Response>);
    expect(r.status).toBe(200);
    expect(bekleyen.length).toBe(1);
    await Promise.all(bekleyen);
    expect(yazimBasladi).toBe(true);
    expect(caches.yollar("oyun-calisma-v1")).toEqual(["/pyodide/0.27.7/buyuk.wasm"]);
  });

  it("K-d: terk edilen kurulumlarin oyun-yeni-* onbellekleri silinir; kaydi korunan ya da kurulumu suren surumunki kalir", async () => {
    const { ag, caches } = yeni();
    const sw1 = await kurEtkin(ag, caches, surum("v1", "M1"), false);
    const meta = await caches.open("oyun-meta-v1");
    const simdi = Date.now();
    const isaret = (k: string, zaman: number) => meta.put(`${ORIGIN}/__oyun/kurulum/${k}`, new Response(JSON.stringify({ zaman, urller: [] })));
    for (const k of ["terk", "suren", "eskiIsaret", "bekleyen"]) await (await caches.open(`oyun-yeni-${k}`)).put(`${ORIGIN}/x`, new Response(k));
    await isaret("suren", simdi);
    await isaret("eskiIsaret", simdi - 2 * 60 * 60 * 1000);
    // v1'den DAHA YENI kurulmus ve kaydi olan (bekleyen) surum
    await meta.put(`${ORIGIN}/__oyun/gen/bekleyen`, new Response(JSON.stringify({ kimlik: "bekleyen", kurulum: simdi + 1000, model_sha256: "M9", pyodide: "0.27.7", manifestMetni: "{}", paketYolu: "/oyun/x.zip", urller: [] })));
    await sw1.etkinles();
    const adlar = [...caches.harita.keys()].filter((a) => a.startsWith("oyun-yeni-")).sort();
    expect(adlar).toEqual(["oyun-yeni-bekleyen", "oyun-yeni-suren"]);
  });
});

describe("Ö1: onbellek hatasinda aga dusme", () => {
  const bozuk = (caches: SahteCaches): void => {
    caches.open = async () => {
      throw new Error("depolama_bozuk");
    };
  };

  it("caches.open reddedilince statik dosya aga duser (yanit reddedilmez)", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    ag.koy("/_next/static/chunks/yeni.js", "AGDAN");
    bozuk(caches);
    const r = await sw.getir("/_next/static/chunks/yeni.js");
    expect(r?.status).toBe(200);
    expect(await r?.text()).toBe("AGDAN");
  });

  it("caches.open reddedilince manifest aga duser (?model= ile de)", async () => {
    const { ag, caches } = yeni();
    const sw = await kurEtkin(ag, caches, surum("v1", "M1"));
    bozuk(caches);
    const duz = await sw.getir("/oyun/manifest.json");
    expect(JSON.parse((await duz?.text()) ?? "{}").model_sha256).toBe("M1");
    const modelli = await sw.getir("/oyun/manifest.json?model=M1");
    expect(JSON.parse((await modelli?.text()) ?? "{}").model_sha256).toBe("M1");
  });
});
