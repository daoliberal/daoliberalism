/**
 * B10 uctan uca yardimcilari (uc motor): konsol/CSP dinleme (motor bazli gerekceli izin listesi), oyun kurma, hafta ilerletme, IndexedDB okuma,
 * Service Worker kimlikleri. Sunucu/derleme yardimcilari `swSunucu.ts` icindedir (B7).
 */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { waitForLayout } from "../../fidelity/helpers";

export const DENETIM = (p: Page) => p.getByRole("region", { name: "Oynatma denetimi" });
export const HAFTA = /Hafta (\d+) \/ 200/;

export type Motor = "chromium" | "firefox" | "webkit";

/**
 * Zaman asimlari: B9 olcumlerinin EN KOTUSU x 3, ortam oynakligi icin gerekceli tabanla (hafta >= 30 sn, yeniden acilis >= 60 sn).
 * B9 kaynaklari: hafta en kotu 8,9 sn (Chromium; Firefox 8,1; WebKit 5,1) -> x3 = 26,7 sn -> taban 30 sn. Ilk acilis (soguk) 3,0 sn x3 = 9 sn ve
 * goruntuden devam <= 11 sn x3 = 33 sn -> 60 sn; goruntusuz tariften devam 43 sn x3 = 129 sn (`DEVAM_MS`). Burada tek yerde adlandirilir; testlerde baska sayi yazilmaz.
 */
export const HAFTA_MS = Math.max(3 * 8_900, 30_000);
export const ACILIS_MS = Math.max(3 * 11_000, 60_000);
/** Goruntusuz (13 hafta alti) kaydin tariften devami: B9 12-13 hf 37-43 sn (Chromium) x3 = 129 sn (Firefox daha yavas, ayni sinir). */
export const DEVAM_MS = Math.max(3 * 43_000, 60_000);

/** Kisa, adlandirilmis beklemeler (B9 olcumu degil, arayuz eylemleri): bir tiklama/gorunurluk icin ve "kendiliginden OLMAZ" gozlem penceresi. */
export const TIKLA_MS = 15_000;
export const OLMAZ_PENCERESI_MS = 4_000;
export const EK_PAYI_MS = 60_000;

/**
 * Konsolda sayilmayan, motorun kendi (uygulama hatasi OLMAYAN) bilinen uyarilari. Her biri gerekcelidir; baska hicbir uyari/hata gecmez.
 *  - chromium: basliksiz Chromium'da yazilim GL (swiftshader) Pixi tuvali icin kendi performans uyarisini yazar.
 *  - firefox:  Pyodide'in wasm'i Firefox'ta "exception handling 'try' deprecated" uyarisini her derlemede yazar (motor uyarisi, Pyodide 0.27.7 derlemesi).
 *  - firefox:  Firefox'un yazilim WebGL'i Pixi tuvali icin YALNIZ su iki uyariyi yazar (gozlenen): "Tex image TEXTURE_2D level 0 is incurring lazy initialization"
 *              ve "Alpha-premult and y-flip are deprecated for non-DOM-Element uploads". Baska her "WebGL warning" kotu sayilir.
 *  - firefox:  127.0.0.1 icin "bounce tracker" bildirimi (Firefox'un yerel adres izleme sinifi; yalniz test sunucusu adresinde).
 *  "WebGL context was lost" (Firefox): harita sahnesi yeniden kurulurken (Pixi `destroy`, `HaritaSahnesi.tsx`) motor yazar; sayfa basina EN FAZLA 3 kez izinlidir
 *  (gozlenen 1-2), fazlasi (tekrarlayan baglam kaybi) kotu sayilir. Oyunun ilerlemesi/haritanin cizilmesi testlerin kendi assertion'lariyla ayrica denetlenir.
 */
export const IZIN_VERILEN_UYARILAR: Record<Motor, RegExp[]> = {
  chromium: [/GL Driver Message \(OpenGL, Performance/],
  firefox: [
    /WebAssembly exception handling 'try' instruction is deprecated/,
    /has been classified as a bounce tracker/,
    /^\[JavaScript Warning: "WebGL warning: [^"]*(is incurring lazy initialization|Alpha-premult and y-flip are deprecated for non-DOM-Element uploads)\./,
  ],
  webkit: [],
};

const BAGLAM_KAYBI = /^\[JavaScript Warning: "WebGL context was lost\./;
const BAGLAM_KAYBI_EN_FAZLA = 3;

export interface Dinleyici {
  /** Izin listesi disindaki konsol hata/uyarilari ve sayfa hatalari. */
  kotu: string[];
  /** Cevrimdisi asamayi baslatir/bitirir (bkz. `sorunlar`). */
  cevrimdisi: (acik: boolean) => void;
  /**
   * Tum sorunlar: `kotu` + cevrimdisi asamada basarisiz her ag istegi. Tek istisna (yalniz WebKit, yalniz cevrimdisi, sunucu kapali): Next'in
   * `<link rel="preconnect" href="/">` satirinin tarayici on baglanti denemesi. Bu, iki konsol hatasi ("Failed to preconnect to <kok>" ve genel
   * "Failed to load resource: WebKit encountered an internal error") ve kok adrese (`<kok>/`) bir `requestfailed` olarak gorunur; uygulamanin
   * kendi istegi degildir. Kok disindaki her basarisiz istek ve kok istegiyle aciklanamayan her genel WebKit iletisi sorun sayilir.
   */
  sorunlar: () => string[];
}

/** Baglam duzeyinde KALICI CSP ihlal kaydi: ihlaller Node tarafinda toplanir, gezinme/yenileme/kapanistan etkilenmez. */
export async function cspKaydi(ctx: BrowserContext): Promise<string[]> {
  const ihlaller: string[] = [];
  await ctx.exposeBinding("__cspBildir", (_kaynak, ihlal: string) => void ihlaller.push(ihlal));
  await ctx.addInitScript(`document.addEventListener("securitypolicyviolation", (e) => window.__cspBildir(e.violatedDirective + " " + e.blockedURI));`);
  return ihlaller;
}

export function dinle(page: Page, motor: Motor, hedef?: string[]): Dinleyici {
  const kotu = hedef ?? [];
  const izin = IZIN_VERILEN_UYARILAR[motor];
  let cevrimdisi = false;
  let baglamKaybi = 0;
  const cevrimdisiBasarisiz: string[] = [];
  const genelWebkit: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (m.type() === "warning" && izin.some((r) => r.test(m.text()))) return;
    if (m.type() === "warning" && motor === "firefox" && BAGLAM_KAYBI.test(m.text()) && ++baglamKaybi <= BAGLAM_KAYBI_EN_FAZLA) return;
    if (cevrimdisi && motor === "webkit" && m.type() === "error") {
      if (/^Failed to preconnect to http:\/\/127\.0\.0\.1:\d+\/\. Error: WebKit encountered an internal error$/.test(m.text())) return;
      if (m.text() === "Failed to load resource: WebKit encountered an internal error") return void genelWebkit.push(m.text());
    }
    kotu.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => kotu.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => cevrimdisi && cevrimdisiBasarisiz.push(r.url()));
  return {
    kotu,
    cevrimdisi: (a) => void (cevrimdisi = a),
    sorunlar: () => {
      const kok = new URL(page.url()).origin + "/";
      const kokDisi = cevrimdisiBasarisiz.filter((u) => !(motor === "webkit" && u === kok));
      const aciklanan = motor === "webkit" ? cevrimdisiBasarisiz.filter((u) => u === kok).length : 0;
      const aciklanamayan = genelWebkit.slice(aciklanan);
      return [...kotu, ...kokDisi.map((u) => `cevrimdisi basarisiz istek: ${u}`), ...aciklanamayan.map((g) => `aciklanamayan: ${g}`)];
    },
  };
}

export async function hafta(page: Page): Promise<number> {
  const metin = (await DENETIM(page).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(metin)?.[1] ?? NaN);
}

export async function kurucuAc(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/oyun/#/kurucu`);
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: ACILIS_MS });
}

export async function oyunKur(page: Page, ad = "Uctan uca"): Promise<string> {
  await page.getByLabel("Dünya adı").fill(ad);
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: ACILIS_MS });
  const hash = new URL(page.url()).hash;
  expect(hash).toMatch(/^#\/canli\/canli-/);
  return hash.slice("#/canli/".length);
}

/** `ilkSure`: ilk haftanin suresi (yeniden acilistan sonra ilk hafta yeniden oynatma/devam yukunu tasir: cagiranlar `DEVAM_MS` verir). */
export async function haftaIlerlet(page: Page, n: number, ilkSure = HAFTA_MS): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const once = await hafta(page);
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${once + 1} /`))).toBeVisible({ timeout: i === 0 ? ilkSure : HAFTA_MS });
  }
}

/** IndexedDB `haftalar` depodaki (kosu icin) hafta numaralari, artan. */
export async function depodakiHaftalar(page: Page, kosuId: string): Promise<number[]> {
  return page.evaluate(
    (id) =>
      new Promise<number[]>((coz, reddet) => {
        const a = indexedDB.open("daoliberal-kayit");
        a.onerror = () => reddet(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const r = db.transaction("haftalar", "readonly").objectStore("haftalar").getAll();
          r.onerror = () => reddet(r.error);
          r.onsuccess = () => {
            db.close();
            coz((r.result as { kosuId: string; hafta: number }[]).filter((k) => k.kosuId === id).map((k) => k.hafta).sort((x, y) => x - y));
          };
        };
      }),
    kosuId,
  );
}

/** IndexedDB `kosular`: kimlik -> model_sha256. */
export async function kosuModelleri(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, string>>((coz, red) => {
        const a = indexedDB.open("daoliberal-kayit");
        a.onerror = () => red(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const r = db.transaction("kosular", "readonly").objectStore("kosular").getAll();
          r.onsuccess = () => {
            db.close();
            coz(Object.fromEntries((r.result as { kosuId: string; modelAnahtari: { model_sha256: string } }[]).map((k) => [k.kosuId, k.modelAnahtari.model_sha256])));
          };
          r.onerror = () => red(r.error);
        };
      }),
  );
}

/** SW kurulmus, etkin ve sayfayi denetliyor (`clients.claim`). */
export async function swHazir(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: ACILIS_MS }).toBe(true);
}

/** Denetleyen (etkin) SW'nin derleme kimligi. */
export async function etkinKimlik(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((coz, red) => {
        const c = navigator.serviceWorker.controller;
        if (!c) return red(new Error("denetleyen_yok"));
        navigator.serviceWorker.addEventListener("message", (e: MessageEvent<{ kimlik: string }>) => coz(e.data.kimlik), { once: true });
        c.postMessage({ t: "kimlik" });
      }),
  );
}

/** `registration.update()` sonrasi bekleyen worker'in kimligi. */
export async function bekleyenKimlik(page: Page): Promise<string> {
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update().then(() => undefined)));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.waiting != null)), { timeout: ACILIS_MS }).toBe(true);
  return page.evaluate(
    () =>
      new Promise<string>((coz) => {
        void navigator.serviceWorker.getRegistration().then((r) => {
          navigator.serviceWorker.addEventListener("message", (e: MessageEvent<{ kimlik: string }>) => coz(e.data.kimlik), { once: true });
          r?.waiting?.postMessage({ t: "kimlik" });
        });
      }),
  );
}
