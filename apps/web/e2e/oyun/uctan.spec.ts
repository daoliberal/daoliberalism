import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import path from "node:path";
import { waitForLayout } from "../../fidelity/helpers";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";
import { manifestOku, Sunucu, gecici, type ModelSurumu } from "./swSunucu";
import {
  ACILIS_MS,
  bekleyenKimlik,
  EK_PAYI_MS,
  OLMAZ_PENCERESI_MS,
  TIKLA_MS,
  DEVAM_MS,
  cspKaydi,
  DENETIM,
  depodakiHaftalar,
  dinle,
  etkinKimlik,
  hafta,
  HAFTA,
  HAFTA_MS,
  haftaIlerlet,
  kosuModelleri,
  kurucuAc,
  oyunKur,
  swHazir,
  type Motor,
} from "./uctanYardimci";

/**
 * B10 uctan uca (UC motor: Chromium, Firefox, WebKit; `wrangler dev` uzerinde, deploy YOK). Yalniz `playwright.uctan.config.ts` ile kosar (`pnpm e2e:uctan`);
 * normal `pnpm e2e` calistirmasinda atlanir. Senaryolar (Faz 2 kabul ozeti):
 *   1. ana akis: yeni oyun, 10 hafta, "Sarti degistir" kabulu, yenile -> ayni haftadan devam (hafta, karar gunlugu, gosterge ayni), cevrimdisi yenile + devam;
 *      DAO (insanli) kosusunda ahirdan cikis karari, yenile -> ayni haftadan devam.
 *   2. surum degisimi: eski paketle baslamis oyun, yeni surum yayininda "yeni surum hazir", kendiliginden uygulanmaz, onayla uygulanir, eski oyun onceki
 *      paketle devam eder, yeni oyun yeni paketle acilir.
 *   3. Worker cokusu: "Oyun motoru durdu" ekrani, yeniden yukle -> kayittan ayni haftadan devam.
 *   5. bildirim bandi (Safari/yeni surum...) ile ipucu kutusu kesismez (Y-5; Chromium/Firefox'ta Safari kimligi taklidiyle).
 *   4. her senaryoda konsolda hata ve CSP ihlali yok (motorun bilinen zararsiz uyarilari `uctanYardimci.IZIN_VERILEN_UYARILAR`'da gerekceli).
 */
test.skip(process.env.E2E_UCTAN !== "1", "yavas uc motor testi: pnpm e2e:uctan");

const PORT = Number(process.env.E2E_UCTAN_PORT ?? 3112);
let sunucu: Sunucu | null = null;
let tmp = "";
let s1 = "";
let s2 = "";
let m1: ModelSurumu;
let m2: ModelSurumu;

test.beforeAll(() => {
  const dizin = process.env.E2E_UCTAN_DIZIN;
  if (!dizin) throw new Error("E2E_UCTAN_DIZIN yok (globalSetup calismadi)");
  s1 = path.join(dizin, "s1");
  s2 = path.join(dizin, "s2");
  m1 = manifestOku(s1);
  m2 = manifestOku(s2);
  expect(m2.model).not.toBe(m1.model);
  tmp = gecici(); // wrangler calisma dizinleri (yapilandirma dosyalari)
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test.afterEach(async () => {
  await sunucu?.durdur();
  sunucu = null;
});

async function sunucuAc(dizin: string): Promise<Sunucu> {
  if (sunucu) await sunucu.durdur();
  sunucu = await Sunucu.baslat(dizin, PORT, tmp);
  return sunucu;
}

/** Yeni baglam + KALICI CSP ihlal kaydi (`csp` dizisi; gezinme/yenilemeden etkilenmez). `ua` verilirse tarayici kimligi taklit edilir. */
async function yeniBaglam(browser: import("@playwright/test").Browser, ua?: string): Promise<{ ctx: BrowserContext; csp: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(ua !== undefined ? { userAgent: ua } : {}) });
  return { ctx, csp: await cspKaydi(ctx) };
}

const motorAdi = (info: { project: { name: string } }): Motor => info.project.name as Motor;

/** Kurucu ana sayfa gostergelerinden ikisi (metin): yenileme oncesi/sonrasi ayni olmali. */
async function gosterge(page: Page): Promise<{ talep: string; kasa: string }> {
  const metin = await page.locator("body").innerText();
  return { talep: /Talep karşılama\s*\n\s*([^\n]+)/.exec(metin)?.[1] ?? "", kasa: /Şehir kasası\s*\n\s*([^\n]+)/.exec(metin)?.[1] ?? "" };
}

async function kararGunlugu(page: Page): Promise<string> {
  const p = await ayrintilarAc(page, "Koşu ve kararlar");
  const metin = await p.innerText();
  await page.keyboard.press("Escape");
  return metin.slice(metin.indexOf("Karar günlüğü"));
}

/** Test zaman asimlari B9 tabanli sabitlerden turetilir (`uctanYardimci.ts`). */
const SURE_1A = 20 * HAFTA_MS + 4 * ACILIS_MS + 3 * DEVAM_MS;
const SURE_1B = 12 * HAFTA_MS + 4 * ACILIS_MS + 2 * DEVAM_MS;
const SURE_2 = 6 * HAFTA_MS + 8 * ACILIS_MS + 4 * DEVAM_MS;
const SURE_3 = 8 * HAFTA_MS + 4 * ACILIS_MS + 2 * DEVAM_MS;
const SURE_5 = 3 * ACILIS_MS + EK_PAYI_MS;

const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

test("1a ana_akis (Kurucu): 10 hafta, Sarti degistir kabul, yenile -> ayni haftadan devam, cevrimdisi yenile -> devam @yavas", async ({ browser }, info) => {
  test.setTimeout(SURE_1A);
  const sv = await sunucuAc(s1);
  const { ctx, csp } = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const d = dinle(page, motorAdi(info));
  await kurucuAc(page, sv.url);
  await swHazir(page);
  const kosuId = await oyunKur(page);
  await haftaIlerlet(page, 10);

  // "Sarti degistir": kabul (uygula), dikis asilana dek ilerle
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
  await expect(page.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "kurtarma fonuyla" }).click();
  await page.getByRole("button", { name: /^Uygula \(en erken \d+\. hafta\)$/ }).click();
  const dikis = page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/);
  await expect(dikis).toBeVisible({ timeout: 3 * HAFTA_MS });
  const seam = Number(/(\d+)\. haftadan sonrası/.exec((await dikis.textContent()) ?? "")?.[1]);
  expect(Number.isFinite(seam), "dikis haftasi okunamadi").toBe(true);
  for (let w = await hafta(page); w < seam + 1; w = await hafta(page)) {
    expect(w, "dikis asilmadi").toBeLessThanOrEqual(seam + 2);
    await haftaIlerlet(page, 1);
  }
  await page.keyboard.press("Escape");
  const w1 = await hafta(page);
  expect(w1).toBeGreaterThanOrEqual(11);
  await expect.poll(() => depodakiHaftalar(page, kosuId).then((h) => h.includes(w1)), { timeout: ACILIS_MS }).toBe(true);
  const ger1 = await gosterge(page);
  expect(ger1.kasa).not.toBe("");
  expect(ger1.talep).not.toBe("");
  const gunluk1 = await kararGunlugu(page);
  expect(gunluk1).toMatch(/Şart v2 · \d+\. haftadan[\s\S]*Başlangıç şartı · v1/);
  await page.close();

  // yenile (yeni sayfa: kilit birakilmis): ayni haftadan devam, gosterge ve gunluk ayni
  const p2 = await ctx.newPage();
  const d2 = dinle(p2, motorAdi(info), d.kotu);
  await p2.goto(`${sv.url}/oyun/#/canli/${kosuId}`);
  await waitForLayout(p2);
  await expect(DENETIM(p2).getByText(HAFTA).first()).toBeVisible({ timeout: DEVAM_MS });
  expect(await hafta(p2)).toBe(w1);
  await expect.poll(() => gosterge(p2), { timeout: ACILIS_MS }).toEqual(ger1);
  expect(await kararGunlugu(p2)).toBe(gunluk1);
  await swHazir(p2);

  // cevrimdisi: sunucu kapali + tarayici cevrimdisi; sayfa yenilenir, oyun acilir ve oynanir
  await sunucu?.durdur();
  sunucu = null;
  await ctx.setOffline(true);
  d.cevrimdisi(true);
  d2.cevrimdisi(true);
  await p2.reload();
  await waitForLayout(p2);
  expect(await p2.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true); // sayfayi SW denetliyor
  await expect(DENETIM(p2).getByText(HAFTA).first()).toBeVisible({ timeout: DEVAM_MS });
  expect(await hafta(p2)).toBe(w1);
  await haftaIlerlet(p2, 1, DEVAM_MS); // yeniden acilistan sonra ilk hafta devam yukunu tasir
  expect(await hafta(p2)).toBe(w1 + 1);
  expect(d2.sorunlar()).toEqual([]);
  await ctx.setOffline(false);
  await ctx.close();
  expect(d.sorunlar()).toEqual([]);
  expect(csp).toEqual([]);
});

test("1b ana_akis (DAO, insanli): ahirdan cikis karari uygulanir, 10 hafta, yenile -> ayni haftadan devam @yavas", async ({ browser }, info) => {
  test.setTimeout(SURE_1B);
  const sv = await sunucuAc(s1);
  const { ctx, csp } = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const d = dinle(page, motorAdi(info));
  await page.goto(`${sv.url}/oyun/#/dao`);
  await waitForLayout(page);
  const basla = page.getByRole("button", { name: "Başla", exact: true });
  await expect(basla).toBeEnabled({ timeout: ACILIS_MS });
  await basla.click();
  const H = (n?: number) => page.getByText(n === undefined ? /Hafta (\d+) \/ 520/ : new RegExp(`Hafta ${n} / 520`)).first();
  await expect(H(0)).toBeVisible({ timeout: ACILIS_MS });
  const kosuId = decodeURIComponent(/^#\/dao\/([^/]+)/.exec(new URL(page.url()).hash)?.[1] ?? "");
  expect(kosuId).not.toBe("");
  await page.getByRole("button", { name: "Tamam" }).click(); // WebKit'te Safari bandi artik ipucunu ortmez (Y-5)
  // Karar: Ahir ekranindan "Ahirdan cik, is ara" (tablo yolu: harita tuvali gerektirmez)
  const ozet = page.locator("summary", { hasText: "Şehir haritası (tablo)" });
  await ozet.focus(); // tuval tam ekran: tablo klavye (erisilebilir) yoluyla acilir
  if (!(await page.locator("details", { has: ozet }).evaluate((x) => (x as HTMLDetailsElement).open))) await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Ahır/ }).focus();
  await page.keyboard.press("Enter");
  const ahir = page.getByRole("complementary", { name: "Ahır" });
  await expect(ahir).toBeVisible();
  await ahir.getByRole("button", { name: "Ahırdan çık, iş ara" }).click();
  await expect(H(0)).toBeVisible();
  for (let i = 1; i <= 10; i += 1) {
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(H(i)).toBeVisible({ timeout: HAFTA_MS });
  }
  const olay = page.getByText("Ahırdan çıktın; artık iş arıyorsun.").first();
  await expect(olay).toBeVisible();
  const durumOku = async (p: Page): Promise<string> => (await p.locator("body").innerText()).match(/Durum\s*\n\s*([^\n]+)/)?.[1] ?? "";
  const durum = await durumOku(page);
  expect(durum, "Durum etiketi okunamadi").not.toBe("");
  expect(durum).not.toMatch(/Ahırda/);
  await expect.poll(() => depodakiHaftalar(page, kosuId).then((h) => h.includes(10)), { timeout: ACILIS_MS }).toBe(true);
  await page.close();

  const p2 = await ctx.newPage();
  const d2 = dinle(p2, motorAdi(info), d.kotu);
  await p2.goto(`${sv.url}/oyun/#/dao/${encodeURIComponent(kosuId)}`);
  await waitForLayout(p2);
  await expect(p2.getByText(/Hafta 10 \/ 520/).first()).toBeVisible({ timeout: DEVAM_MS });
  // Hafta etiketi gorunur gorunmez (BEKLEMEDEN): hafta 0 degerleri ("Ahirda", "Ahirdan cik", ilk hafta ipucu) guncel diye GOSTERILMEZ (Y-yeni-1)
  expect(await durumOku(p2)).not.toMatch(/Ahırda/);
  await expect(p2.getByText("Ahırda başlıyorsun", { exact: false })).toHaveCount(0);
  await expect(p2.getByRole("button", { name: "Ahırdan çık, iş ara" })).toHaveCount(0);
  // deger geldiginde yenileme oncesiyle ayni
  await expect.poll(() => durumOku(p2), { timeout: DEVAM_MS, message: "karar kayittan geri gelmedi" }).toBe(durum);
  expect(d2.sorunlar()).toEqual([]);
  await ctx.close();
  expect(d.sorunlar()).toEqual([]);
  expect(csp).toEqual([]);
});

test("2 surum_degisimi: yeni surum hazir bildirimi, kendiliginden uygulanmaz, onayla kayit tamamlanip uygulanir, eski oyun onceki paketle, yeni oyun yeni paketle @yavas", async ({ browser }, info) => {
  test.setTimeout(SURE_2);
  let sv = await sunucuAc(s1);
  const { ctx, csp } = await yeniBaglam(browser);
  const page = await ctx.newPage();
  const d = dinle(page, motorAdi(info));
  await kurucuAc(page, sv.url);
  await swHazir(page);
  const eski = await etkinKimlik(page);
  const kosuId = await oyunKur(page);
  await haftaIlerlet(page, 2);
  const haftaOnce = await hafta(page);
  await page.evaluate(() => {
    const w = window as unknown as { __isaret: number; __kontrolDegisti: number };
    w.__isaret = 7;
    w.__kontrolDegisti = 0;
    navigator.serviceWorker.addEventListener("controllerchange", () => (w.__kontrolDegisti += 1));
  });

  sv = await sunucuAc(s2); // yeni surum yayinda (yeni sunucu gunlugu: sifirdan sayilir)
  const bekleyen = await bekleyenKimlik(page);
  expect(bekleyen).not.toBe(eski);
  // Yalniz degisen dosyalar iner: yeni model paketi (1), Pyodide ve uygulama dosyalari yok (Ö-6: kabul 5, uc motorda)
  await expect.poll(() => sv.istekler().filter((i) => i.yol === `/oyun/${m2.zipAd}`).length, { timeout: ACILIS_MS, message: "yeni paket inmedi" }).toBe(1); // wrangler gunlugu gecikebilir
  const kurulum = sv.istekler();
  expect(kurulum.filter((i) => /^\/pyodide\//.test(i.yol))).toEqual([]);
  expect(kurulum.filter((i) => /^\/_next\/static\//.test(i.yol))).toEqual([]);
  expect(kurulum.filter((i) => i.yol === `/oyun/${m1.zipAd}`)).toEqual([]);
  const bant = page.getByText("Oyunun yeni bir sürümü hazır", { exact: false });
  await expect(bant).toBeVisible({ timeout: ACILIS_MS });
  // kendiliginden uygulanmaz: pencere boyunca hic denetleyici degismedi, hala eski SW, ayni sayfa, bant duruyor
  await page.waitForTimeout(OLMAZ_PENCERESI_MS);
  expect(await page.evaluate(() => (window as unknown as { __kontrolDegisti: number }).__kontrolDegisti)).toBe(0);
  expect(await etkinKimlik(page)).toBe(eski);
  expect(await page.evaluate(() => (window as unknown as { __isaret?: number }).__isaret)).toBe(7);
  await expect(bant).toBeVisible();
  expect(await hafta(page)).toBe(haftaOnce);

  // onay: kayit tamamlanir, SW atlar, sayfa yenilenir, oyun kayittan devam eder
  await Promise.all([page.waitForEvent("load", { timeout: ACILIS_MS }), page.getByRole("button", { name: "Şimdi yenile" }).click({ timeout: TIKLA_MS })]);
  expect(await page.evaluate(() => (window as unknown as { __isaret?: number }).__isaret)).toBeUndefined(); // sayfa gercekten yenilendi
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: DEVAM_MS });
  expect(await hafta(page)).toBe(haftaOnce);
  expect(await etkinKimlik(page)).toBe(bekleyen);
  // kayit M1 ile yazilmisti; sunucuda yalniz M2 var: devam, SW'nin tuttugu ONCEKI paketle (uyumsuz ekrani cikmadi)
  expect(await kosuModelleri(page)).toEqual({ [kosuId]: m1.model });
  await expect(page.getByRole("heading", { name: "Kayıttan devam edilemedi" })).toHaveCount(0);
  expect(sv.istekler().filter((i) => i.yol === `/oyun/${m1.zipAd}`)).toEqual([]); // eski paket sunucuda yok/istenmedi: SW onbelleginden
  await haftaIlerlet(page, 1, DEVAM_MS);

  // eski oyun yeni sayfada da ONCEKI paketle acilir (manifest `?model=<m1>` -> "onceki"), sonra yeni oyun YENI paketle (Kurucu'ya gidince guncel paketle yeniden yuklenir)
  await page.close();
  const p2 = await ctx.newPage();
  const d2 = dinle(p2, motorAdi(info), d.kotu);
  const manifestYan = p2.waitForResponse((r) => r.url().includes("/oyun/manifest.json?model="), { timeout: ACILIS_MS });
  await p2.goto(`${sv.url}/oyun/#/canli/${kosuId}`);
  const my = await manifestYan;
  expect(my.url()).toContain(`model=${m1.model}`);
  expect(await my.headerValue("x-oyun-surum")).toBe("onceki");
  await waitForLayout(p2);
  await expect(DENETIM(p2).getByText(HAFTA).first()).toBeVisible({ timeout: DEVAM_MS }); // oyun gercekten acildi
  expect(await hafta(p2)).toBe(haftaOnce + 1);
  await expect(p2.getByRole("heading", { name: "Kayıttan devam edilemedi" })).toHaveCount(0);
  await Promise.all([p2.waitForEvent("load", { timeout: ACILIS_MS }), p2.evaluate(() => (window.location.hash = "#/kurucu"))]);
  await expect(p2.getByLabel("Dünya adı")).toBeVisible({ timeout: ACILIS_MS });
  const yeniId = await oyunKur(p2);
  expect(await kosuModelleri(p2)).toEqual({ [kosuId]: m1.model, [yeniId]: m2.model });
  // olumlu kanit: yeni oyun icin yeni paket SW onbelleginden (kurulumda inmisti) ya da sunucudan alindi; sunucuda Pyodide istegi yok
  expect(sv.istekler().filter((i) => /^\/pyodide\//.test(i.yol))).toEqual([]);
  expect(sv.istekler().filter((i) => i.yol === "/oyun/manifest.json").length, "manifest istegi gunlukte yok").toBeGreaterThan(0);
  expect(d2.sorunlar()).toEqual([]);
  await ctx.close();
  expect(d.sorunlar()).toEqual([]);
  expect(csp).toEqual([]);
});

/**
 * Worker cokusu test duzeni (URETIM KODUNA DOKUNMAZ): `Worker` kurucusu sayfa baslamadan sarilir ve olusturulan Worker'lar `window.__isciler`e yazilir;
 * cokus Worker uzerinde `error` olayi + `terminate()` (bagin `onerror`'unun tuttugu gercek yol: kopru `coktu` -> `dustu` -> "Oyun motoru durdu").
 */
const ISCI_YAKALA = `(() => { const Orj = window.Worker; window.__isciler = []; window.Worker = class extends Orj { constructor(...a) { super(...a); window.__isciler.push(this); } }; })();`;

test("3 worker_cokusu: oyun surerken Worker olur -> 'Oyun motoru durdu', yeniden yukle -> kayittan ayni haftadan devam, hafta kaybi yok @yavas", async ({ browser }, info) => {
  test.setTimeout(SURE_3);
  const sv = await sunucuAc(s1);
  const { ctx, csp } = await yeniBaglam(browser);
  await ctx.addInitScript(ISCI_YAKALA);
  const page = await ctx.newPage();
  const d = dinle(page, motorAdi(info));
  await kurucuAc(page, sv.url);
  const kosuId = await oyunKur(page);
  await haftaIlerlet(page, 2);
  // oyun SURERKEN: oynat (1x) ve en az iki hafta daha gecmesini bekle
  const once = await hafta(page);
  await page.getByRole("button", { name: "Oynat" }).click();
  await expect.poll(() => hafta(page), { timeout: 4 * HAFTA_MS }).toBeGreaterThanOrEqual(once + 2);
  const goruldu = await hafta(page);
  const olduruldu = await page.evaluate(() => {
    const w = (window as unknown as { __isciler: (Worker & EventTarget)[] }).__isciler;
    for (const x of w) {
      x.dispatchEvent(new ErrorEvent("error", { message: "b10-test-cokusu" }));
      x.terminate();
    }
    return w.length;
  });
  expect(olduruldu).toBe(1); // tek Worker (Pyodide)
  await expect(page.getByRole("heading", { name: "Oyun motoru durdu" })).toBeVisible({ timeout: ACILIS_MS });
  await expect(page.getByText("Kaydın güvende", { exact: false })).toBeVisible();
  // kayit guvende: gorulen hafta IndexedDB'de (yanit bariyeri); en son kayitli hafta
  const kayitli = await depodakiHaftalar(page, kosuId);
  const son = kayitli[kayitli.length - 1] ?? -1;
  expect(son).toBeGreaterThanOrEqual(goruldu);
  expect(kayitli).toEqual(Array.from({ length: kayitli.length }, (_, i) => kayitli[0]! + i)); // bosluk yok

  await page.getByRole("button", { name: "Yeniden yükle" }).click();
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: DEVAM_MS });
  expect(await hafta(page)).toBe(son); // hafta kaybi yok: kayitli son haftadan devam
  expect(await hafta(page)).toBeGreaterThanOrEqual(goruldu);
  await haftaIlerlet(page, 1, DEVAM_MS);
  await ctx.close();
  // Beklenen tek konsol satiri: uygulamanin kendi "dustu" uyarisi (cokusun kaydi); baska hata/uyari yok.
  const sorunlar = d.sorunlar();
  const dustu = sorunlar.filter((k) => /^warning: oyun-tarayici dustu/.test(k));
  expect(dustu.length).toBeGreaterThanOrEqual(1);
  expect(sorunlar.filter((k) => !dustu.includes(k))).toEqual([]);
  expect(csp).toEqual([]);
});

test("5 bildirim_ipucu_kesismez: Safari bandi aciksa ipucu kutusuyla kesismez, ipucu tiklanabilir @yavas", async ({ browser }, info) => {
  test.setTimeout(SURE_5);
  const sv = await sunucuAc(s1);
  // WebKit'te gercek kimlik; Chromium/Firefox'ta Safari kimligi taklit edilir (bant `webkitMi(userAgent)` ile cikar)
  const { ctx, csp } = await yeniBaglam(browser, motorAdi(info) === "webkit" ? undefined : SAFARI_UA);
  const page = await ctx.newPage();
  const d = dinle(page, motorAdi(info));
  await page.goto(`${sv.url}/oyun/#/dao`);
  await waitForLayout(page);
  const basla = page.getByRole("button", { name: "Başla", exact: true });
  await expect(basla).toBeEnabled({ timeout: ACILIS_MS });
  await basla.click();
  await expect(page.getByText(/Hafta 0 \/ 520/).first()).toBeVisible({ timeout: ACILIS_MS });
  const bant = page.getByRole("status").filter({ hasText: "Safari 7 gün" });
  const ipucu = page.getByRole("status").filter({ hasText: "Ahırda başlıyorsun" });
  await expect(bant).toBeVisible({ timeout: ACILIS_MS });
  await expect(ipucu).toBeVisible();
  // bant oyun ekraninin alt-sol sutunundaki yuvada (sabit ust katmanda degil)
  await expect(page.locator("[data-bildirim-yuvasi]").getByRole("status").filter({ hasText: "Safari 7 gün" })).toHaveCount(1);
  const b = (await bant.boundingBox())!;
  const i = (await ipucu.boundingBox())!;
  const kesisir = b.x < i.x + i.width && i.x < b.x + b.width && b.y < i.y + i.height && i.y < b.y + b.height;
  expect(kesisir, `bant ${JSON.stringify(b)} ipucu ${JSON.stringify(i)}`).toBe(false);
  // Ö-yeni-2: 1440x900'de sol panel acik; bant + ipucu + olay seridi sutunu sol panelle kesismez (pay olcumu: `data-pay` kutulari)
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForLayout(page, "wide");
  const kutu = async (sec: string) => (await page.locator(sec).first().boundingBox())!;
  const sol = await kutu('[data-pay="sol"]');
  const altSutun = await kutu('[data-pay="alt"]');
  const yuvaKutu = await kutu("[data-bildirim-yuvasi]");
  const kes = (a: { x: number; y: number; width: number; height: number }, c: { x: number; y: number; width: number; height: number }) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  expect(kes(altSutun, sol), `alt-sol sutun ${JSON.stringify(altSutun)} sol panel ${JSON.stringify(sol)}`).toBe(false);
  expect(kes(yuvaKutu, sol)).toBe(false);
  await page.getByRole("button", { name: "Tamam" }).click({ timeout: TIKLA_MS }); // bant AÇIKKEN tiklanir (kapatma yok)
  await expect(ipucu).toHaveCount(0);
  expect(d.sorunlar()).toEqual([]);
  expect(csp).toEqual([]);
  await ctx.close();
});
