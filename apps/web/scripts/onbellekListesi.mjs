// Derleme sonrasi (postbuild): Service Worker on onbellek listesi, SW damgasi ve CSP basliklari.
// Kullanim: node scripts/onbellekListesi.mjs [--out DIZIN]   (varsayilan: apps/web/out; `next build` SONRASI calisir)
// Yalniz Node yerlesikleri. Uretilenler git'e girmez (out/ ignore):
//   out/oyun/oyun-onbellek.json   manifest + model paketi + Pyodide cekirdek dosyalari + oyun sayfasi kapanisi (ozet/boyutlu)
//   out/sw.js                     public/sw.js + derleme kimligi (kimlik degisince tarayici yeni SW'yi gorur)
//   out/_headers                  public/_headers + sayfa basina CSP (satir ici betiklerin sha256 ozetleriyle)
// Idempotent: kaynaklar daima public/ altindan okunur, out/ uzerine yazilir.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SURUM_ISARETI = '"__OYUN_SURUM__"';
export const CSP_BASLANGIC = "# >>> CSP (onbellekListesi.mjs uretir; elle degistirme)";
export const CSP_BITIS = "# <<< CSP";
/** Cloudflare `_headers` sinirlari: en cok 100 kural. */
export const KURAL_SINIRI = 100;
/** Bayraksiz (onizleme) derlemede sw.js yerine yazilir: onceden kaydolmus SW'yi kaldirir ve onbellekleri temizler (K9). */
export const KAPATMA_SW = `/* Oyun SW kapatma: bu derlemede tarayicida calisan model yok. Kayitli SW kendini kaldirir ve onbellekleri siler. */
self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (olay) => {
  olay.waitUntil(
    (async () => {
      for (const ad of await caches.keys()) if (ad.startsWith("oyun-")) await caches.delete(ad);
      await self.registration.unregister();
    })(),
  );
});
`;
const LISTE_SURUMU = 1;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sha256b64 = (buf) => createHash("sha256").update(buf).digest("base64");

function dosyalar(dizin) {
  const out = [];
  for (const e of readdirSync(dizin, { withFileTypes: true })) {
    const yol = path.join(dizin, e.name);
    if (e.isDirectory()) out.push(...dosyalar(yol));
    else if (e.isFile() && e.name !== ".DS_Store") out.push(yol);
  }
  return out;
}

const bayt = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function girdi(out, yol) {
  const buf = readFileSync(path.join(out, yol.slice(1)));
  return { yol, sha256: sha256(buf), boyut: buf.length };
}

/** Sayfa kapanisi: html + zincirleme `static/(chunks|media)/...` basvurulari (JS/CSS metninde dizge olarak gecer). */
export function sayfaKapanisi(out, htmlYolu) {
  const bulunan = new Set();
  const bak = [path.join(out, htmlYolu)];
  const gorulen = new Set();
  // Basvuru bicimleri: `/_next/static/chunks/x`, `static/chunks/x` (JS), `../media/x` (CSS icindeki font adresleri).
  const desen = /(?:\/_next\/static\/|\bstatic\/|\.\.\/)(chunks|media)\/([A-Za-z0-9_.~%-]+)/g;
  while (bak.length > 0) {
    const dosya = bak.pop();
    if (gorulen.has(dosya) || !existsSync(dosya)) continue;
    gorulen.add(dosya);
    const metin = readFileSync(dosya, "latin1");
    for (const m of metin.matchAll(desen)) {
      const goreli = `static/${m[1]}/${m[2]}`;
      const yol = `/_next/${goreli}`;
      const ad = m[2];
      if (/\.(map|ts|woff)$/.test(ad)) continue; // woff2 yeter (CSS'te woff2 once gelir); kaynak haritasi/ts yuklenmez
      const tam = path.join(out, "_next", goreli);
      if (!existsSync(tam) || !statSync(tam).isFile()) continue;
      bulunan.add(yol);
      if (/\.(js|css)$/.test(ad)) bak.push(tam);
    }
  }
  return [...bulunan].sort(bayt);
}

/** `out/oyun/manifest.json`'dan on onbellek listesi (kimliksiz) + kimlik. */
export function listeUret(out) {
  const manifestYolu = path.join(out, "oyun/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestYolu, "utf-8"));
  const pyodideDizini = path.join(out, "pyodide", manifest.pyodide);
  if (!existsSync(pyodideDizini)) throw new Error(`pyodide dizini yok: ${pyodideDizini}`);
  const pyodide = readdirSync(pyodideDizini)
    .sort(bayt)
    .map((ad) => girdi(out, `/pyodide/${manifest.pyodide}/${ad}`));
  const paket = girdi(out, `/oyun/${manifest.paket.ad}`);
  if (paket.sha256 !== manifest.paket.sha256) throw new Error("paket sha256 manifestle uyusmuyor");

  const sayfa = [];
  // HTML ozetsiz: barindirici/CDN ekleme yapabilir (analitik vb.); agdan once gelir, ozet dogrulanmaz.
  sayfa.push({ yol: "/oyun/", boyut: statSync(path.join(out, "oyun/index.html")).size, html: true });
  for (const yol of sayfaKapanisi(out, "oyun/index.html")) sayfa.push(girdi(out, yol));
  for (const kok of ["oyun-sprite", "oyun-harita"]) {
    const dizin = path.join(out, kok);
    if (!existsSync(dizin)) continue;
    for (const f of dosyalar(dizin).map((x) => `/${path.relative(out, x).split(path.sep).join("/")}`).sort(bayt)) sayfa.push(girdi(out, f));
  }

  const govde = {
    surum: LISTE_SURUMU,
    pyodide: manifest.pyodide,
    model_sha256: manifest.model_sha256,
    manifest: girdi(out, "/oyun/manifest.json"),
    paket,
    pyodideDosyalari: pyodide,
    sayfa,
  };
  const kimlik = sha256(JSON.stringify(govde)).slice(0, 12);
  return { kimlik, ...govde };
}

/** Bir HTML'in satir ici (src'siz) betiklerinin CSP `sha256-...` kaynaklari. */
export function satirIciOzetler(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.add(`'sha256-${sha256b64(Buffer.from(m[1], "utf-8"))}'`);
  }
  return [...out].sort();
}

/** Belge (sayfa) CSP'si. COOP/COEP yok. `unsafe-eval` yok (Pyodide Worker'da `wasm-unsafe-eval` ile calisir; e2e kanitlar). */
export function belgeCsp(ozetler) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${ozetler.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** Worker betigi (ve oradan yuklenen Pyodide) icin CSP: yalniz betik ve baglanti. */
export const ISCI_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'";

/** Sayfa basina CSP kurallari (`/` ve `/<dizin>/`). Basliklar satir basina <= 2000 karakter (Cloudflare siniri). */
export function cspBlogu(out) {
  const satirlar = [CSP_BASLANGIC];
  const rotalar = [];
  for (const f of dosyalar(out)) {
    const goreli = path.relative(out, f).split(path.sep).join("/");
    if (!goreli.endsWith("index.html") || goreli.startsWith("_not-found") || goreli.startsWith("404")) continue;
    const dizin = goreli.slice(0, -"index.html".length);
    rotalar.push([`/${dizin}`, readFileSync(f, "utf-8")]);
  }
  rotalar.sort((a, b) => bayt(a[0], b[0]));
  for (const [rota, html] of rotalar) {
    const baslik = belgeCsp(satirIciOzetler(html));
    if (baslik.length > 1900) throw new Error(`CSP basligi cok uzun (${baslik.length}): ${rota}`);
    satirlar.push(rota, `  Content-Security-Policy: ${baslik}`);
  }
  satirlar.push("/_next/static/chunks/*", `  Content-Security-Policy: ${ISCI_CSP}`, CSP_BITIS);
  return satirlar.join("\n");
}

export function basliklarUret(webDizini, out) {
  const kaynak = readFileSync(path.join(webDizini, "public/_headers"), "utf-8").replace(/\s+$/, "");
  if (kaynak.includes(CSP_BASLANGIC)) throw new Error("public/_headers uretilen CSP blogunu icermemeli");
  const metin = `${kaynak}\n\n${cspBlogu(out)}\n`;
  const kural = kuralSayisi(metin);
  if (kural > KURAL_SINIRI) throw new Error(`_headers ${kural} kural icerir; Cloudflare siniri ${KURAL_SINIRI}`);
  return metin;
}

/** Girintisiz, yorum olmayan, bos olmayan satirlar = kural (yol) basliklari. */
export function kuralSayisi(metin) {
  return metin.split("\n").filter((l) => l.trim() !== "" && !/^\s/.test(l) && !l.startsWith("#")).length;
}

export function swDamgala(webDizini, kimlik) {
  const kaynak = readFileSync(path.join(webDizini, "public/sw.js"), "utf-8");
  const parcalar = kaynak.split(SURUM_ISARETI);
  if (parcalar.length !== 2) throw new Error(`sw.js icinde ${SURUM_ISARETI} tam bir kez gecmeli`);
  return parcalar.join(JSON.stringify(kimlik));
}

/**
 * Worker adi: `src/oyun/tarayici/isciUret.ts` `new Worker(..., { name })` ile AYNI olmalidir (guard testi: `swOnbellek`/`onbellekListesi.test.ts`). Yalniz bayrakli
 * derlemede cikti parcalarinda bulunur; bayraksiz derlemede Worker koduyla birlikte budanir. Ad degisirse bayrak yanlis okunur: test kirilir.
 */
export const ISCI_ADI = "oyun-pyodide";

/**
 * Bayrak derleme CIKTISINDAN okunur (Next `.env*` dosyalarini da okur; betigin `process.env`i bunlari gormez). Bayrakli derlemede Worker kodu
 * (`oyun-pyodide` adi) cikti parcalarinda bulunur; bayraksizda budanir. Ortam degiskeni acikca "tarayici" iken cikti bayraksizsa derleme tutarsizdir: hata.
 */
export function bayrakliMi(out) {
  const dizin = path.join(out, "_next/static");
  if (!existsSync(dizin)) return false;
  return dosyalar(dizin).some((f) => f.endsWith(".js") && readFileSync(f, "latin1").includes(ISCI_ADI));
}

export function bayrakKarari(out, envDegeri) {
  const cikti = bayrakliMi(out);
  if (envDegeri === "tarayici" && !cikti) throw new Error("NEXT_PUBLIC_OYUN_KAYNAK=tarayici ama derleme ciktisinda tarayici kodu yok");
  return cikti;
}

/** `bayrakli`: tarayici kaynagi derlemesi (SW + on onbellek listesi). Degilse sw.js bir kapatma SW'sidir, liste uretilmez. */
export function calistir(webDizini, out, bayrakli = true) {
  writeFileSync(path.join(out, "_headers"), basliklarUret(webDizini, out));
  if (!bayrakli) {
    writeFileSync(path.join(out, "sw.js"), KAPATMA_SW);
    return null;
  }
  const liste = listeUret(out);
  writeFileSync(path.join(out, "oyun/oyun-onbellek.json"), `${JSON.stringify(liste)}\n`);
  writeFileSync(path.join(out, "sw.js"), swDamgala(webDizini, liste.kimlik));
  return liste;
}

/** Dizindeki (ozyinelemeli) dosyalardan `isaret` gecenler. */
function isaretGecenler(dizin, isaret, bulunan = []) {
  if (!existsSync(dizin)) return bulunan;
  for (const ad of readdirSync(dizin)) {
    const yol = path.join(dizin, ad);
    if (statSync(yol).isDirectory()) isaretGecenler(yol, isaret, bulunan);
    else if (/\.(js|mjs|html|json|txt)$/.test(ad) && readFileSync(yol, "utf-8").includes(isaret)) bulunan.push(yol);
  }
  return bulunan;
}

/** Cikti denetimi (deploy oncesi): damga, liste ve CSP yerinde mi? B9: olcum bayragi kapaliyken olcum kancasi cikti icinde olmamali. Hata atar. */
export function denetle(out, bayrakli = true, olcum = process.env.NEXT_PUBLIC_OYUN_OLCUM === "1") {
  const hatalar = [];
  if (!olcum) {
    const sizan = isaretGecenler(path.join(out, "_next"), "__oyunOlcum");
    if (sizan.length > 0) hatalar.push(`olcum kancasi (__oyunOlcum) olcum bayragi kapaliyken cikti icinde: ${sizan.map((y) => path.relative(out, y)).join(", ")}`);
  }
  const sw = existsSync(path.join(out, "sw.js")) ? readFileSync(path.join(out, "sw.js"), "utf-8") : "";
  const basliklar = existsSync(path.join(out, "_headers")) ? readFileSync(path.join(out, "_headers"), "utf-8") : "";
  if (!basliklar.includes(CSP_BASLANGIC)) hatalar.push("out/_headers CSP blogunu icermiyor (postbuild calismadi)");
  else if (basliklar.split("\n").some((l) => l.includes("Content-Security-Policy: default-src 'self'") && !l.includes("frame-ancestors 'self'"))) hatalar.push("out/_headers: sayfa CSP'lerinde frame-ancestors 'self' yok");
  else if (kuralSayisi(basliklar) > KURAL_SINIRI) hatalar.push(`out/_headers ${KURAL_SINIRI} kurali asiyor`);
  if (bayrakli) {
    const lp = path.join(out, "oyun/oyun-onbellek.json");
    if (!existsSync(lp)) hatalar.push("out/oyun/oyun-onbellek.json yok");
    else {
      const kimlik = JSON.parse(readFileSync(lp, "utf-8")).kimlik;
      if (!sw.includes(`const SURUM = ${JSON.stringify(kimlik)};`)) hatalar.push("out/sw.js damgasiz ya da liste kimligiyle uyusmuyor");
    }
  } else if (sw !== KAPATMA_SW) hatalar.push("out/sw.js kapatma SW'si degil");
  if (hatalar.length > 0) throw new Error(`cikti denetimi basarisiz:\n- ${hatalar.join("\n- ")}`);
}

/**
 * Yayin korumasi: bayraksiz cikti yayinda SESSIZ gecmemeli (SW kapatma surumune duser, oyun tarayici kipinde acilmaz).
 * Workers Builds (`WORKERS_CI=1`) ya da `--bayrakli-bekle` iken bayraksiz cikti hatadir. Hata metni ya da null doner.
 */
export function yayinKorumasi(bayrakli, env, argv) {
  if (bayrakli) return null;
  if (env.WORKERS_CI === "1") return "Workers Builds'te bayraksiz derleme: NEXT_PUBLIC_OYUN_KAYNAK=tarayici build degiskeni eksik ya da build ortaminda tanimli degil";
  if (argv.includes("--bayrakli-bekle")) return "--bayrakli-bekle: cikti bayraksiz (NEXT_PUBLIC_OYUN_KAYNAK=tarayici ile derlenmemis)";
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const burasi = path.dirname(fileURLToPath(import.meta.url));
  const web = path.resolve(burasi, "..");
  const i = process.argv.indexOf("--out");
  const out = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(web, "out");
  if (!existsSync(path.join(out, "oyun/manifest.json"))) {
    console.error(`onbellekListesi: ${out}/oyun/manifest.json yok (once next build)`);
    process.exit(1);
  }
  const bayrakli = bayrakKarari(out, process.env.NEXT_PUBLIC_OYUN_KAYNAK);
  const koruma = yayinKorumasi(bayrakli, process.env, process.argv);
  if (koruma !== null) {
    console.error(`onbellekListesi: ${koruma}`);
    process.exit(1);
  }
  if (process.argv.includes("--denetle")) {
    denetle(out, bayrakli);
    console.log("onbellekListesi: cikti denetimi tamam");
    process.exit(0);
  }
  const l = calistir(web, out, bayrakli);
  denetle(out, bayrakli);
  if (l === null) {
    console.log("onbellekListesi: bayraksiz derleme, SW kapatma surumu yazildi");
    process.exit(0);
  }
  const toplam = [l.manifest, l.paket, ...l.pyodideDosyalari, ...l.sayfa].reduce((a, x) => a + x.boyut, 0);
  console.log(`onbellekListesi: kimlik ${l.kimlik}, ${1 + 1 + l.pyodideDosyalari.length + l.sayfa.length} girdi, ${(toplam / 1048576).toFixed(1)} MB`);
}
