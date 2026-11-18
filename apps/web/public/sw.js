/* Oyun Service Worker (el yazimi, bagimliliksiz). Yalniz /oyun/ sayfasindan kaydedilir (swKayit.ts), bayrakli derlemede; kapsam "/" (Worker
 * alt isteklerinin denetlenmesi icin gerekli) ama yalniz oyun yollarini yanitlar, tanitim sayfalarina karismaz.
 *
 * Amac: Pyodide cekirdegi + model paketi kalici onbellege alinir; ikinci ve cevrimdisi acilis aga ihtiyac duymaz; yeni surum KULLANICI ONAYIYLA
 * uygulanir (kendiliginden skipWaiting yok); bir onceki model paketi tutulur (acik oyun eski paketle bitirilebilir).
 *
 * Derleme kimligi: scripts/onbellekListesi.mjs bu dosyadaki SURUM sabitini out/sw.js icinde damgalar (oyun-onbellek.json kimligi). Kimlik
 * degisince sw.js baytlari degisir, tarayici yeni worker'i kurar. public/sw.js (damgasiz) yalniz kaynaktir; hicbir yerden kaydedilmez.
 *
 * Onbellekler:
 *   oyun-ortak-v1        degismeyen, adresi ozetli/surumlu dosyalar (URL anahtar): Pyodide, model zip'leri, _next/static, sprite. Surumler arasi PAYLASILIR:
 *                        kurulumda ozeti ayni olan dosya yeniden indirilmez (yalniz degisenler iner).
 *   oyun-meta-v1         /__oyun/durum {guncel, onceki} ve /__oyun/gen/<kimlik> (her kurulu surumun manifest metni + dosya listesi).
 *   oyun-calisma-<kimlik> listede olmayan, calisma sirasinda dolan girdiler; yeni surum etkinlesince atilir.
 *   oyun-yeni-<kimlik>   kurulmakta olan surumun, ortakta AYNI adla baska icerikle duran dosyalari (ornegin ozeti degisen sprite). Etkinlesmede ortaga tasinir:
 *                        kurulum bitmeden/yarida kesilirse etkin surumun dosyalari ezilmez.
 * Sayfa (HTML) surum basina META'da saklanir (/__oyun/sayfa/<kimlik>): cevrimdisi yedek yalniz KENDI surumunun sayfasidir (parcalariyla tutarli).
 * Onceki paket: etkinlesme sirasinda "ayri bir modelle" en yakin onceki surum tutulur (guncel + bir onceki model); daha eskisi silinir.
 */
"use strict";

const SURUM = "__OYUN_SURUM__";
const ORTAK = "oyun-ortak-v1";
const META = "oyun-meta-v1";
const CALISMA = "oyun-calisma-" + SURUM;
const ONBELLEK_YOLU = "/oyun/oyun-onbellek.json";
const MANIFEST_YOLU = "/oyun/manifest.json";
const SAYFA_YOLU = "/oyun/";
const DURUM = "/__oyun/durum";
const GEN_ONEKI = "/__oyun/gen/";
const SAYFA_ONEKI = "/__oyun/sayfa/";
const KURULUM_ONEKI = "/__oyun/kurulum/";
const KURULUM_OMRU_MS = 60 * 60 * 1000;
const YENI = "oyun-yeni-" + SURUM;
const CALISMAYA_YAZILAN = /^\/(?:pyodide\/|oyun\/oyun-)/;
const NAV_ZAMAN_ASIMI_MS = 4000;
const EZ_ESZAMANLI = 4;
const SABIT_YOL = /^\/(?:pyodide\/[^/]+\/|oyun\/oyun-[0-9a-f]{12}\.zip$|_next\/static\/|oyun-sprite\/|oyun-harita\/)/;
const ESKI_YENILE_YOL = /^\/oyun-kayit\//;

const adres = (yol) => self.location.origin + yol;
const gen = (kimlik) => GEN_ONEKI + kimlik;
const sayfa = (kimlik) => SAYFA_ONEKI + kimlik;

async function jsonOku(cache, yol) {
  const r = await cache.match(adres(yol));
  return r ? r.json() : null;
}

async function jsonYaz(cache, yol, deger) {
  await cache.put(adres(yol), new Response(JSON.stringify(deger), { headers: { "content-type": "application/json" } }));
}

async function ozetHex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Saklanacak basliklar: ag yanitinin tumu (CSP dahil); gövde cözüldügü icin content-encoding/length yeniden yazilir. */
function saklanacakBasliklar(r, g, boyut) {
  const h = new Headers();
  r.headers.forEach((v, k) => {
    if (!/^(content-encoding|content-length|transfer-encoding|set-cookie|x-oyun-)/i.test(k)) h.set(k, v);
  });
  h.set("content-length", String(boyut));
  h.set("x-oyun-sha256", g.sha256 ?? "");
  return h;
}

/** Dosyayi indirir; ozet varsa dogrular (bir kez `reload` ile yeniden dener). */
async function indirDogrula(g) {
  let hata = null;
  for (const secenek of [undefined, { cache: "reload" }]) {
    const r = await fetch(adres(g.yol), secenek);
    if (!r.ok) throw new Error("indirilemedi:" + g.yol + ":" + r.status);
    const buf = await r.arrayBuffer();
    if (g.sha256 === undefined || (await ozetHex(buf)) === g.sha256) return { buf, basliklar: saklanacakBasliklar(r, g, buf.byteLength) };
    hata = new Error("ozet_uyusmuyor:" + g.yol);
  }
  throw hata;
}

/**
 * Bir dosyayi koyar. Ozeti ayni olan kayit varsa dokunmaz. Ortakta AYNI adla FARKLI icerik varsa (etkin surumun dosyasi) yeni onbellege yazilir;
 * ortak onbellege yalniz yeni adlar girer (yarim kalan kurulum etkin surumu bozmaz).
 */
async function koy(ortak, yeni, g) {
  const var_ = await ortak.match(adres(g.yol));
  if (var_ && var_.headers.get("x-oyun-sha256") === g.sha256) return;
  const hedef = var_ ? yeni : ortak;
  if (hedef === yeni) {
    const y = await yeni.match(adres(g.yol));
    if (y && y.headers.get("x-oyun-sha256") === g.sha256) return;
  }
  const { buf, basliklar } = await indirDogrula(g);
  await hedef.put(adres(g.yol), new Response(buf, { status: 200, headers: basliklar }));
}

async function sinirli(isler, n) {
  let i = 0;
  const kos = async () => {
    for (;;) {
      const s = i++;
      if (s >= isler.length) return;
      await isler[s]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, isler.length) }, kos));
}

async function kur() {
  const r = await fetch(adres(ONBELLEK_YOLU), { cache: "no-store" });
  if (!r.ok) throw new Error("liste_okunamadi:" + r.status);
  const liste = await r.json();
  if (liste.kimlik !== SURUM) throw new Error("kimlik_uyusmuyor");
  const ortak = await caches.open(ORTAK);
  const yeni = await caches.open(YENI);
  const meta = await caches.open(META);
  const dosyalar = [liste.paket, ...liste.pyodideDosyalari, ...liste.sayfa.filter((g) => !g.html)];
  const htmlGirdisi = liste.sayfa.find((g) => g.html);
  const kurulum = Date.now();
  // Kurulum isareti: aktif olan baska bir surumun cop toplamasi, bu kurulumun yeni koydugu dosyalari silmesin.
  await jsonYaz(meta, KURULUM_ONEKI + SURUM, { zaman: kurulum, urller: dosyalar.map((g) => g.yol) });
  await sinirli(dosyalar.map((g) => () => koy(ortak, yeni, g)), EZ_ESZAMANLI);
  const m = await indirDogrula(liste.manifest);
  const html = htmlGirdisi ? await indirDogrula({ yol: htmlGirdisi.yol }) : null;
  // Kayit en sonda: yarim kalan kurulum gen/sayfa kaydi birakmaz (worker kurulamaz, etkin surum aynen calisir).
  if (html) await meta.put(adres(sayfa(SURUM)), new Response(html.buf, { status: 200, headers: html.basliklar }));
  await jsonYaz(meta, gen(SURUM), {
    kimlik: SURUM,
    kurulum,
    model_sha256: liste.model_sha256,
    pyodide: liste.pyodide,
    manifestMetni: new TextDecoder().decode(m.buf),
    paketYolu: liste.paket.yol,
    urller: dosyalar.map((g) => g.yol),
  });
  await meta.delete(adres(KURULUM_ONEKI + SURUM));
}

async function etkinles() {
  const meta = await caches.open(META);
  const ortak = await caches.open(ORTAK);
  const bu = await jsonOku(meta, gen(SURUM));
  if (!bu) throw new Error("gen_yok");
  // Ortakta ayni adla duran, bu surumde degisen dosyalar simdi (etkinlesirken) yerine gecer.
  if ((await caches.keys()).includes(YENI)) {
    const yeni = await caches.open(YENI);
    for (const istek of await yeni.keys()) {
      const y = await yeni.match(istek);
      if (y) await ortak.put(istek, y);
    }
    await caches.delete(YENI);
  }
  const eski = await jsonOku(meta, DURUM);
  // Onceki paket: guncelden FARKLI modele sahip en yakin surum (yalniz arayuz degisen surumler onceki sayilmaz).
  let onceki = null;
  for (const k of [eski && eski.guncel, eski && eski.onceki]) {
    if (!k || k === SURUM) continue;
    const g = await jsonOku(meta, gen(k));
    if (g && g.model_sha256 !== bu.model_sha256 && g.pyodide === bu.pyodide) {
      onceki = g;
      break;
    }
  }
  await jsonYaz(meta, DURUM, { guncel: SURUM, onceki: onceki ? onceki.kimlik : null });
  // Cop toplama. Bu surumden DAHA YENI kurulmus (bekleyen/kurulmakta) surumlerin kayitlari ve dosyalari korunur.
  const tutulan = new Set(bu.urller.map(adres));
  if (onceki) tutulan.add(adres(onceki.paketYolu));
  const simdi = Date.now();
  const kalanGen = new Set([SURUM]);
  if (onceki) kalanGen.add(onceki.kimlik);
  const suren = new Set(); // kurulumu suren (isareti taze) surumler: yeni-onbellekleri korunur
  for (const istek of await meta.keys()) {
    const yol = new URL(istek.url).pathname;
    if (yol.startsWith(GEN_ONEKI)) {
      const k = yol.slice(GEN_ONEKI.length);
      if (kalanGen.has(k)) continue;
      const g = await jsonOku(meta, yol);
      if (g && g.kurulum > bu.kurulum) {
        kalanGen.add(k);
        g.urller.forEach((u) => tutulan.add(adres(u)));
      } else await meta.delete(istek);
    } else if (yol.startsWith(KURULUM_ONEKI)) {
      const k = await jsonOku(meta, yol);
      if (k && simdi - k.zaman < KURULUM_OMRU_MS && yol !== KURULUM_ONEKI + SURUM) {
        k.urller.forEach((u) => tutulan.add(adres(u)));
        suren.add(yol.slice(KURULUM_ONEKI.length));
      } else await meta.delete(istek);
    }
  }
  for (const istek of await meta.keys()) {
    const yol = new URL(istek.url).pathname;
    if (yol.startsWith(SAYFA_ONEKI) && !kalanGen.has(yol.slice(SAYFA_ONEKI.length))) await meta.delete(istek);
  }
  for (const istek of await ortak.keys()) if (!tutulan.has(istek.url)) await ortak.delete(istek);
  for (const ad of await caches.keys()) {
    if (ad.startsWith("oyun-yeni-")) {
      // Terk edilen kurulumlarin yeni-onbellekleri silinir; yalniz kaydi korunan (daha yeni, bekleyen) ya da kurulumu suren surumunki kalir.
      const k = ad.slice("oyun-yeni-".length);
      if (!kalanGen.has(k) && !suren.has(k)) await caches.delete(ad);
    } else if (ad.startsWith("oyun-") && ad !== ORTAK && ad !== META && ad !== CALISMA) await caches.delete(ad);
  }
  await self.clients.claim();
}

async function eslestir(yol) {
  const o = await caches.open(ORTAK);
  const b = await o.match(adres(yol));
  if (b) return b;
  const c = await caches.open(CALISMA);
  return c.match(adres(yol));
}

async function calismayaKoy(yol, yanit) {
  if (yanit.status !== 200) return;
  const c = await caches.open(CALISMA);
  await c.put(adres(yol), yanit);
}

/** Onbellekte varsa verir; yoksa ag. Yalniz oyunun kendi buyuk dosyalari (Pyodide, model zip'i) calisma onbellegine yazilir; yazim yaniti BEKLETMEZ. */
async function onbellekOnce(olay, istek, yol) {
  // Onbellek okuma hatasi (bozuk/tahliye edilmis depolama) yanitin reddedilmesine yol acmaz: aga dusulur.
  let b = null;
  try {
    b = await eslestir(yol);
  } catch {
    b = null;
  }
  if (b) return b;
  const r = await fetch(istek);
  if (r.ok && CALISMAYA_YAZILAN.test(yol)) olay.waitUntil(calismayaKoy(yol, r.clone()));
  return r;
}

async function eskiyiVerYenile(olay, istek, yol) {
  const c = await caches.open(CALISMA);
  const b = await c.match(adres(yol));
  const ag = fetch(istek).then(async (r) => {
    if (r.ok) await calismayaKoy(yol, r.clone());
    return r;
  });
  if (b) {
    olay.waitUntil(ag.catch(() => undefined));
    return b;
  }
  return ag;
}

function manifestYaniti(metin, etiket) {
  return new Response(metin, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-oyun-surum": etiket } });
}

/** `?model=<sha>`: kayitli oyunun modeline uyan manifest (guncel ya da onceki). Aksi halde ag, ag yoksa kurulu surumun manifesti. */
async function manifestIs(url) {
  let meta = null;
  try {
    meta = await caches.open(META);
    const hedef = url.searchParams.get("model");
    if (hedef) {
      const durum = await jsonOku(meta, DURUM);
      for (const [etiket, kimlik] of [["guncel", SURUM], ["onceki", durum && durum.onceki]]) {
        if (!kimlik) continue;
        const g = await jsonOku(meta, gen(kimlik));
        if (g && g.model_sha256 === hedef) return manifestYaniti(g.manifestMetni, etiket);
      }
    }
  } catch {
    meta = null; // onbellek hatasi: aga dusulur
  }
  try {
    const r = await fetch(adres(MANIFEST_YOLU), { cache: "no-cache" });
    if (r.ok) return r;
  } catch {
    // cevrimdisi: kurulu surumun manifesti
  }
  try {
    const g = meta ? await jsonOku(meta, gen(SURUM)) : null;
    if (g) return manifestYaniti(g.manifestMetni, "cevrimdisi");
  } catch {
    // onbellek okunamadi
  }
  return Response.error();
}

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

/** Sayfa gezinmesi: once ag (zaman asimi, 5xx ve cevrimdisi icin yedek). Yedek YALNIZ bu surumun kurulumda saklanan sayfasidir; ag yaniti saklanmaz. */
async function gezinme(istek, yol) {
  const meta = await caches.open(META);
  const yedekVer = async () => {
    const y = await meta.match(adres(sayfa(SURUM)));
    if (!y) return null;
    return yol === SAYFA_YOLU ? y : Response.redirect(adres(SAYFA_YOLU), 307);
  };
  const ag = fetch(istek);
  const hizli = await Promise.race([ag.catch(() => null), bekle(NAV_ZAMAN_ASIMI_MS).then(() => null)]);
  if (hizli && hizli.status < 500) return hizli;
  const yedek = await yedekVer();
  if (yedek) {
    ag.catch(() => undefined);
    return yedek;
  }
  return hizli ?? ag;
}

self.addEventListener("install", (olay) => {
  olay.waitUntil(kur());
});

self.addEventListener("activate", (olay) => {
  olay.waitUntil(etkinles());
});

self.addEventListener("fetch", (olay) => {
  const istek = olay.request;
  if (istek.method !== "GET") return;
  const url = new URL(istek.url);
  if (url.origin !== self.location.origin) return;
  const yol = url.pathname;
  if (istek.mode === "navigate") {
    if (yol === "/oyun/" || yol === "/oyun") olay.respondWith(gezinme(istek, yol));
    return;
  }
  if (istek.headers.has("range")) return;
  if (yol === MANIFEST_YOLU) olay.respondWith(manifestIs(url));
  else if (SABIT_YOL.test(yol)) olay.respondWith(onbellekOnce(olay, istek, yol));
  else if (ESKI_YENILE_YOL.test(yol)) olay.respondWith(eskiyiVerYenile(olay, istek, yol));
});

self.addEventListener("message", (olay) => {
  const d = olay.data;
  if (!d || typeof d !== "object") return;
  // Yalniz kullanici onayiyla ve kayit tamamlaninca gonderilir (swKayit.ts `uygula`); kendiliginden skipWaiting yoktur.
  if (d.t === "atla") void self.skipWaiting();
  else if (d.t === "kimlik" && olay.source) olay.source.postMessage({ t: "kimlik", kimlik: SURUM });
});
