import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import path from "node:path";
import { waitForLayout } from "../../fidelity/helpers";
import { derle, gecici, manifestOku, outGeriYukle, outYedekle, Sunucu, yeniModelSurumu, type ModelSurumu } from "./swSunucu";

/**
 * B7 uctan uca (Chromium, `wrangler dev` uzerinde): Service Worker on onbellegi, cevrimdisi acilis, yalniz-paket guncellemesi, kullanici onayli surum gecisi,
 * onceki model paketi, tek kayit kapsami ve CSP. Yalniz `playwright.sw.config.ts` ile kosar (`pnpm e2e:sw`); normal `pnpm e2e` calistirmasinda atlanir.
 * Sunucu istekleri `wrangler dev` gunlugunden sayilir: "agdan istenmiyor" sunucuya hic GET gelmemesidir.
 */
test.skip(process.env.E2E_SW !== "1", "yavas Service Worker testi: pnpm e2e:sw");
test.describe.configure({ mode: "serial" });

const PORT = Number(process.env.E2E_SW_PORT ?? 3111);
const DENETIM = (p: Page) => p.getByRole("region", { name: "Oynatma denetimi" });
const HAFTA = /Hafta (\d+) \/ 200/;
const GL_UYARISI = /GL Driver Message \(OpenGL, Performance/;

let tmp = "";
let s1 = "";
let s2 = "";
let onizleme = "";
let m1: ModelSurumu;
let m2: ModelSurumu;
let sunucu: Sunucu | null = null;
let outYedekVar = false;

async function sunucuAc(dizin: string): Promise<Sunucu> {
  if (sunucu) await sunucu.durdur();
  sunucu = await Sunucu.baslat(dizin, PORT, tmp);
  return sunucu;
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  tmp = gecici();
  outYedekVar = outYedekle(tmp);
  s1 = path.join(tmp, "s1");
  s2 = path.join(tmp, "s2");
  onizleme = path.join(tmp, "onizleme");
  derle(true, s1);
  m1 = manifestOku(s1);
  m2 = yeniModelSurumu(s1, s2, tmp);
  derle(false, onizleme);
  expect(m2.model).not.toBe(m1.model);
});

test.afterAll(async () => {
  await sunucu?.durdur();
  sunucu = null;
  if (tmp) {
    outGeriYukle(tmp, outYedekVar); // paylasilan apps/web/out test oncesi haline doner
    rmSync(tmp, { recursive: true, force: true });
  }
});

const CSP_DINLE = `window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));`;

async function yeniBaglam(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(CSP_DINLE);
  return ctx;
}

function konsolDinle(page: Page): string[] {
  const kotu: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" && GL_UYARISI.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") kotu.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => kotu.push(`pageerror: ${e.message}`));
  return kotu;
}

const cspIhlalleri = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

async function hafta(page: Page): Promise<number> {
  const metin = (await DENETIM(page).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(metin)?.[1] ?? NaN);
}

async function oyunKur(page: Page): Promise<string> {
  await page.getByLabel("Dünya adı").fill("SW deneme");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 60_000 });
  return new URL(page.url()).hash.slice("#/canli/".length);
}

async function haftaIlerlet(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const once = await hafta(page);
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${once + 1} /`))).toBeVisible({ timeout: 90_000 });
  }
}

/** SW kurulmus, etkin ve sayfayi denetliyor (`clients.claim`). */
async function swHazir(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 }).toBe(true);
}

/** Denetleyen (etkin) SW'nin derleme kimligi. */
async function etkinKimlik(page: Page): Promise<string> {
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
async function bekleyenKimlik(page: Page): Promise<string> {
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update().then(() => undefined)));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.waiting != null)), { timeout: 90_000 }).toBe(true);
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

/** IndexedDB `kosular`: kimlik -> model_sha256. */
async function kosuModelleri(page: Page): Promise<Record<string, string>> {
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

/** HTTP onbellegi bosaltilir (Cache Storage'a dokunmaz): sonraki "agdan istenmedi" sonucu SW onbelleginin kanitidir. */
async function httpOnbellekTemizle(ctx: BrowserContext, page: Page): Promise<void> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
}

/** Baglam duzeyinde `fromServiceWorker` yanitlari (Worker istekleri dahil): url -> yanit. */
function swYanitlari(ctx: BrowserContext): { url: string; basliklar: Record<string, string> }[] {
  const l: { url: string; basliklar: Record<string, string> }[] = [];
  ctx.on("response", (r) => {
    if (r.fromServiceWorker()) l.push({ url: new URL(r.url()).pathname, basliklar: r.headers() });
  });
  return l;
}

async function kurucuAc(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/oyun/#/kurucu`);
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
}

test("ikinci_acilista_Pyodide_ve_paket_agdan_istenmez_cevrimdisi_acilis_kayittan_devam_eder_CSP_ihlali_yok", async ({ browser }) => {
  test.setTimeout(600_000);
  const sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const konsol = konsolDinle(page);

  const ilkBas = sv.isaret();
  await kurucuAc(page, sv.url);
  await swHazir(page);
  expect(await cspIhlalleri(page)).toEqual([]);
  const ilkAcilis = sv.istekler(ilkBas);
  console.log("OLCUM_SW ilk acilis istek sayilari", JSON.stringify({ toplam: ilkAcilis.length, pyodide: ilkAcilis.filter((i) => /^\/pyodide\//.test(i.yol)).length, paket: ilkAcilis.filter((i) => /^\/oyun\/oyun-.*\.zip/.test(i.yol)).length }));
  const kosuId = await oyunKur(page);
  await haftaIlerlet(page, 3);
  const haftaOnce = await hafta(page);
  await page.close(); // oyun kilidi birakilir

  // --- ikinci acilis: ayni baglam, SW denetliyor ---
  const isaret = sv.isaret();
  const p2 = await ctx.newPage();
  await httpOnbellekTemizle(ctx, p2); // HTTP onbellegi bos: sunucuya gitmemesi YALNIZ SW onbellegiyle aciklanir
  const swYan = swYanitlari(ctx);
  konsolDinle(p2).forEach((k) => konsol.push(k));
  await p2.goto(`${sv.url}/oyun/#/canli/${kosuId}`);
  await waitForLayout(p2);
  await expect(DENETIM(p2).getByText(HAFTA).first()).toBeVisible({ timeout: 180_000 });
  expect(await hafta(p2)).toBe(haftaOnce);
  const ikinci = sv.istekler(isaret);
  console.log("OLCUM_SW ikinci acilis sunucu istekleri", JSON.stringify(ikinci));
  expect(ikinci.filter((i) => /^\/pyodide\//.test(i.yol))).toEqual([]);
  expect(ikinci.filter((i) => /^\/oyun\/oyun-[0-9a-f]{12}\.zip/.test(i.yol))).toEqual([]);
  expect(ikinci.filter((i) => /^\/_next\/static\//.test(i.yol))).toEqual([]);
  const swYollar = swYan.map((y) => y.url);
  for (const dosya of ["pyodide.asm.wasm", "pyodide.asm.js", "pyodide.mjs", "python_stdlib.zip", "pyodide-lock.json"]) expect(swYollar, dosya).toContain(`/pyodide/0.27.7/${dosya}`);
  expect(swYollar.some((y) => /^\/oyun\/oyun-[0-9a-f]{12}\.zip$/.test(y))).toBe(true);
  expect(swYollar.some((y) => /turbopack-worker-/.test(y))).toBe(true);
  console.log("OLCUM_SW ikinci acilis fromServiceWorker yanit sayisi", swYan.length);
  expect(await cspIhlalleri(p2)).toEqual([]);
  await p2.close();

  // --- cevrimdisi: sunucu kapali + tarayici cevrimdisi ---
  await sv.durdur();
  await ctx.setOffline(true);
  const p3 = await ctx.newPage();
  const cevrimdisiYan = swYanitlari(ctx);
  konsolDinle(p3).forEach((k) => konsol.push(k));
  await p3.goto(`${sv.url}/oyun/#/canli/${kosuId}`);
  await waitForLayout(p3);
  await expect(DENETIM(p3).getByText(HAFTA).first()).toBeVisible({ timeout: 180_000 });
  expect(await hafta(p3)).toBe(haftaOnce);
  await haftaIlerlet(p3, 1); // cevrimdisi de oynanir
  // Y4: SW'den verilen yanitlar guvenlik basliklarini korur (belge CSP'si, Worker betigi CSP'si, wasm turu)
  const belge = cevrimdisiYan.find((y) => y.url === "/oyun/");
  const isciBetigi = cevrimdisiYan.find((y) => /turbopack-worker-/.test(y.url));
  const wasm = cevrimdisiYan.find((y) => y.url.endsWith("pyodide.asm.wasm"));
  expect(belge?.basliklar["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(isciBetigi?.basliklar["content-security-policy"]).toContain("default-src 'none'");
  expect(isciBetigi?.basliklar["x-content-type-options"]).toBe("nosniff");
  expect(wasm?.basliklar["content-type"]).toBe("application/wasm");
  expect(await cspIhlalleri(p3)).toEqual([]);
  await ctx.setOffline(false);
  await ctx.close();
  expect(konsol).toEqual([]);
  sunucu = null;
});

test("yalniz_model_paketi_degisince_yalniz_paket_iner_Pyodide_istegi_yok", async ({ browser }) => {
  test.setTimeout(300_000);
  let sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  await kurucuAc(page, sv.url);
  await swHazir(page);
  const eski = await etkinKimlik(page);
  await httpOnbellekTemizle(ctx, page); // atlama (ayni ozet) HTTP onbellegiyle degil SW'nin ortak onbellegiyle aciklanmali

  sv = await sunucuAc(s2); // yeni surum yayinda: yeni gunluk, sifirdan sayilir
  const yeni = await bekleyenKimlik(page);
  expect(yeni).not.toBe(eski);
  const istekler = sv.istekler();
  console.log("OLCUM_SW yeni surum kurulum istekleri", JSON.stringify(istekler));
  expect(istekler.filter((i) => /^\/pyodide\//.test(i.yol))).toEqual([]);
  expect(istekler.filter((i) => /^\/_next\/static\//.test(i.yol))).toEqual([]);
  expect(istekler.filter((i) => /^\/oyun-(sprite|harita)\//.test(i.yol))).toEqual([]);
  expect(istekler.filter((i) => i.yol === `/oyun/${m2.zipAd}`)).toHaveLength(1);
  expect(istekler.filter((i) => i.yol === `/oyun/${m1.zipAd}`)).toEqual([]);
  // yeni surum bekliyor: etkin SW degismedi
  expect(await etkinKimlik(page)).toBe(eski);
  await ctx.close();
});

test("acik_oyun_varken_surum_kendiliginden_uygulanmaz_onayla_kayit_tamamlanip_uygulanir_onceki_paketle_devam_yeni_oyun_yeni_paketle", async ({ browser }) => {
  test.setTimeout(900_000);
  let sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const konsol = konsolDinle(page);
  await kurucuAc(page, sv.url);
  await swHazir(page);
  const eski = await etkinKimlik(page);
  const kosuId = await oyunKur(page);
  await haftaIlerlet(page, 2);
  const haftaOnce = await hafta(page);

  sv = await sunucuAc(s2);
  await page.evaluate(() => ((window as unknown as { __isaret: number }).__isaret = 7));
  const bekleyen = await bekleyenKimlik(page);
  expect(bekleyen).not.toBe(eski);
  const bant = page.getByText("Oyunun yeni bir sürümü hazır", { exact: false });
  await expect(bant).toBeVisible({ timeout: 30_000 });
  // kendiliginden uygulanmaz: birkac saniye sonra hala eski SW, ayni sayfa, bant duruyor
  await page.waitForTimeout(4000);
  expect(await etkinKimlik(page)).toBe(eski);
  expect(await page.evaluate(() => (window as unknown as { __isaret?: number }).__isaret)).toBe(7);
  await expect(bant).toBeVisible();
  expect(await hafta(page)).toBe(haftaOnce);

  // onay: kayit tamamlanir, SW atlar, sayfa yenilenir, oyun kayittan devam eder
  await Promise.all([page.waitForEvent("load", { timeout: 90_000 }), page.getByRole("button", { name: "Şimdi yenile" }).click({ timeout: 15_000 })]);
  expect(await page.evaluate(() => (window as unknown as { __isaret?: number }).__isaret)).toBeUndefined(); // sayfa gercekten yenilendi
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: 240_000 });
  expect(await hafta(page)).toBe(haftaOnce);
  expect(await etkinKimlik(page)).toBe(bekleyen);
  // kayit M1 ile yazilmisti; sunucuda yalniz M2 var: devam, SW'nin tuttugu ONCEKI paketle (uyumsuz ekrani cikmadi)
  expect(await kosuModelleri(page)).toEqual({ [kosuId]: m1.model });
  await expect(page.getByRole("heading", { name: "Kayıttan devam edilemedi" })).toHaveCount(0);
  const eskiPaketIstegi = sv.istekler().filter((i) => i.yol === `/oyun/${m1.zipAd}`);
  expect(eskiPaketIstegi).toEqual([]); // eski paket sunucuda yok/istenmedi: SW onbelleginden
  await haftaIlerlet(page, 1);

  // N1: kayda bagli DAO rotasi (`#/dao/<id>`) da kaydin (onceki) paketini secer; runId'li DAO rotasi sayfayi YENIDEN YUKLEMEZ
  await page.close();
  const dao = await ctx.newPage();
  const manifestYan = dao.waitForResponse((r) => r.url().includes("/oyun/manifest.json?model="), { timeout: 60_000 });
  await dao.goto(`${sv.url}/oyun/#/dao/${kosuId}`);
  const my = await manifestYan;
  expect(my.url()).toContain(`model=${m1.model}`);
  expect(await my.headerValue("x-oyun-surum")).toBe("onceki");
  await dao.evaluate(() => ((window as unknown as { __isaret: number }).__isaret = 9));
  await dao.waitForTimeout(6000);
  expect(await dao.evaluate(() => (window as unknown as { __isaret?: number }).__isaret)).toBe(9); // gereksiz yeniden yukleme yok
  await expect(dao.getByRole("heading", { name: "Kayıttan devam edilemedi" })).toHaveCount(0);
  // Y3: eski paketle acilmis oturumda yeni oyun yoluna (Kurucu) gidilince sayfa GUNCEL paketle yeniden yuklenir; yeni oyun yeni paketle yazilir
  await Promise.all([dao.waitForEvent("load", { timeout: 60_000 }), dao.evaluate(() => (window.location.hash = "#/kurucu"))]);
  await expect(dao.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  const yeniId = await oyunKur(dao);
  expect(await kosuModelleri(dao)).toEqual({ [kosuId]: m1.model, [yeniId]: m2.model });
  expect(await cspIhlalleri(dao)).toEqual([]);
  await ctx.close();
  expect(konsol).toEqual([]);
});

test("tanitim_sayfasi_SW_kaydetmez_ve_14_MB_indirmez_CSP_ihlali_yok", async ({ browser }) => {
  test.setTimeout(120_000);
  const sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const konsol = konsolDinle(page);
  const isaret = sv.isaret();
  for (const yol of ["/", "/dao/", "/treasuries/"]) {
    await page.goto(`${sv.url}${yol}`);
    await waitForLayout(page).catch(() => undefined);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
    expect(await cspIhlalleri(page)).toEqual([]);
  }
  const istekler = sv.istekler(isaret);
  // Next baglanti onyuklemesi (`/oyun/__next*.txt`, birkac KB) serbest; 14 MB'lik dosyalar ve SW istenmez.
  expect(istekler.filter((i) => /^\/(pyodide\/|sw\.js|oyun\/(manifest|oyun-))/.test(i.yol))).toEqual([]);
  expect(konsol).toEqual([]);
  await ctx.close();
});

test("K2: SW'si kurulu kullanici tanitim sayfasini acar: bozulma yok, gezinmeleri SW yanitlamaz, gereksiz onbellek yazimi yok, /oyun 307", async ({ browser }) => {
  test.setTimeout(240_000);
  const sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const oyun = await ctx.newPage();
  await kurucuAc(oyun, sv.url);
  await swHazir(oyun);
  await oyun.close();
  const swYan = swYanitlari(ctx);
  const page = await ctx.newPage();
  const konsol = konsolDinle(page);
  for (const yol of ["/", "/dao/", "/treasuries/"]) {
    const yanit = await page.goto(`${sv.url}${yol}`);
    expect(yanit?.status()).toBe(200);
    expect(yanit?.fromServiceWorker()).toBe(false);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main, h1").first()).toBeVisible();
    expect(await cspIhlalleri(page)).toEqual([]);
  }
  await page.goto(`${sv.url}/oyun`);
  expect(new URL(page.url()).pathname).toBe("/oyun/");
  await expect(page.getByLabel("Dünya adı").or(page.getByRole("heading").first())).toBeVisible({ timeout: 120_000 });
  await page.goto(`${sv.url}/`);
  // gereksiz onbellek yazimi yok: calisma onbellegi bos; tanitim gezinmeleri SW yaniti degil
  const calisma = await page.evaluate(async () => {
    const adlar = (await caches.keys()).filter((a) => a.startsWith("oyun-calisma-"));
    let n = 0;
    for (const a of adlar) n += (await (await caches.open(a)).keys()).length;
    return n;
  });
  expect(calisma).toBe(0);
  expect(swYan.filter((y) => y.url === "/" || y.url === "/dao/" || y.url === "/treasuries/")).toEqual([]);
  expect(konsol).toEqual([]);
  await ctx.close();
});

test("K9: bayrakli derlemeden bayraksiza donuluste kayitli SW kendini kaldirir ve oyun- onbelleklerini siler", async ({ browser }) => {
  test.setTimeout(240_000);
  let sv = await sunucuAc(s1);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  await kurucuAc(page, sv.url);
  await swHazir(page);
  expect(await page.evaluate(() => caches.keys().then((k) => k.filter((a) => a.startsWith("oyun-")).length))).toBeGreaterThan(0);
  sv = await sunucuAc(onizleme);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update().then(() => undefined)));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), { timeout: 60_000 }).toBe(0);
  await expect.poll(() => page.evaluate(() => caches.keys().then((k) => k.filter((a) => a.startsWith("oyun-")).length)), { timeout: 30_000 }).toBe(0);
  await ctx.close();
});

test("bayraksiz_onizleme_derlemesi_SW_kaydetmez_sayfalar_CSP_ile_calisir", async ({ browser }) => {
  test.setTimeout(120_000);
  const sv = await sunucuAc(onizleme);
  const ctx = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const konsol = konsolDinle(page);
  const isaret = sv.isaret();
  for (const yol of ["/", "/oyun/", "/oyun/?kaynak=kayit", "/dao/"]) {
    await page.goto(`${sv.url}${yol}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main, h1").first()).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
    expect(await cspIhlalleri(page)).toEqual([]);
  }
  const istekler = sv.istekler(isaret);
  expect(istekler.filter((i) => /^\/(pyodide\/|sw\.js|oyun\/(manifest|oyun-))/.test(i.yol))).toEqual([]);
  expect(konsol).toEqual([]);
  await ctx.close();
});
