import { expect, test, type Page } from "@playwright/test";
import { waitForLayout } from "../../fidelity/helpers";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";

/**
 * B5 uctan uca (Chromium): model oyuncunun tarayicisinda (Web Worker + Pyodide 0.27.7). Yalniz `playwright.tarayici.config.ts` ile kosar
 * (`NEXT_PUBLIC_OYUN_KAYNAK=tarayici` derlemesi + wrangler dev); normal `pnpm e2e` calistirmasinda atlanir.
 * Akis: yukle, Kurucu ile oyun kur, 5 hafta ilerle, bir cekmece (kurum) ac, sayfayi yenile -> kayittan devam, haftalar kaybolmaz ve
 * yeniden oynatma bayt bayt ayni paketleri uretir (belirlenimlilik), konsolda hata yok.
 */
test.skip(process.env.E2E_TARAYICI !== "1", "yavas tarayici-model testi: pnpm e2e:tarayici");

const DENETIM = (p: Page) => p.getByRole("region", { name: "Oynatma denetimi" });
const HAFTA = /Hafta (\d+) \/ 200/;

function konsolDinle(page: Page): string[] {
  const kotu: string[] = [];
  page.on("console", (m) => {
    // Basliksiz Chromium'da yazilim GL (swiftshader) Pixi tuvali icin kendi performans uyarisini yazar; uygulama hatasi degildir.
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") kotu.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => kotu.push(`pageerror: ${e.message}`));
  return kotu;
}

async function hafta(page: Page): Promise<number> {
  const metin = (await DENETIM(page).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(metin)?.[1] ?? NaN);
}

/** IndexedDB (`daoliberal-kayit`) -> `haftalar` kayitlari (kosu icin, artan hafta). */
async function depodakiHaftalar(page: Page, kosuId: string): Promise<{ hafta: number; paket: string }[]> {
  return page.evaluate(
    (id) =>
      new Promise((coz, reddet) => {
        const acma = indexedDB.open("daoliberal-kayit");
        acma.onerror = () => reddet(acma.error);
        acma.onsuccess = () => {
          const db = acma.result;
          const istek = db.transaction("haftalar", "readonly").objectStore("haftalar").getAll();
          istek.onerror = () => reddet(istek.error);
          istek.onsuccess = () => {
            db.close();
            const hepsi = istek.result as { kosuId: string; hafta: number; paket: unknown }[];
            coz(hepsi.filter((k) => k.kosuId === id).sort((a, b) => a.hafta - b.hafta).map((k) => ({ hafta: k.hafta, paket: JSON.stringify(k.paket) })));
          };
        };
      }),
    kosuId,
  );
}

/** IndexedDB `goruntuler` kayit sayisi (kosu icin). */
async function goruntuSayisi(page: Page, kosuId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((coz, reddet) => {
        const acma = indexedDB.open("daoliberal-kayit");
        acma.onerror = () => reddet(acma.error);
        acma.onsuccess = () => {
          const db = acma.result;
          const istek = db.transaction("goruntuler", "readonly").objectStore("goruntuler").getAll();
          istek.onsuccess = () => {
            db.close();
            coz((istek.result as { kosuId: string }[]).filter((k) => k.kosuId === id).length);
          };
          istek.onerror = () => reddet(istek.error);
        };
      }),
    kosuId,
  );
}

async function oyunKur(page: Page): Promise<string> {
  await page.getByLabel("Dünya adı").fill("Tarayıcı model");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 60_000 });
  const hash = new URL(page.url()).hash;
  expect(hash).toMatch(/^#\/canli\/canli-/);
  return hash.slice("#/canli/".length);
}

test("tek_sekme: ikinci sekme 'baska sekmede acik' gorur, devralinca ilk sekme durur", async ({ context }) => {
  test.setTimeout(180_000);
  const bir = await context.newPage();
  await bir.goto("/oyun/#/kurucu");
  await expect(bir.getByLabel("Dünya adı")).toBeVisible({ timeout: 120_000 });
  const iki = await context.newPage();
  const worker2: string[] = [];
  iki.on("worker", (w) => worker2.push(w.url()));
  await iki.goto("/oyun/#/kurucu");
  await expect(iki.getByRole("heading", { name: "Oyun başka sekmede açık" })).toBeVisible({ timeout: 30_000 });
  expect(worker2).toEqual([]);                                       // Worker/Pyodide baslatilmadi
  await iki.getByRole("button", { name: "Bu sekmede devam et" }).click();
  await expect(iki.getByLabel("Dünya adı")).toBeVisible({ timeout: 120_000 });
  await expect(bir.getByRole("heading", { name: "Oyun başka sekmede açıldı" })).toBeVisible({ timeout: 30_000 });
});

test("tarayicida_model 14 hf @yavas: ilk goruntu 13. haftada alinir, yenileme goruntuden devam eder", async ({ page }) => {
  test.setTimeout(600_000);
  const konsol = konsolDinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 120_000 });
  const kosuId = await oyunKur(page);
  for (let i = 1; i <= 14; i += 1) {
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 90_000 });
  }
  await expect.poll(() => goruntuSayisi(page, kosuId), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const once = await depodakiHaftalar(page, kosuId);

  const y0 = Date.now();
  await page.reload();
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: 240_000 });
  const devamMs = Date.now() - y0;
  expect(await hafta(page)).toBe(14);
  // Tarifle bastan oynatma 14 hf x ~3,6 sn ~ 50 sn surerdi; goruntuden devam yalniz yukleme + <= 1 hafta
  expect(devamMs).toBeLessThan(40_000);
  const sonra = await depodakiHaftalar(page, kosuId);
  for (const k of once.filter((x) => x.hafta >= 10 && x.hafta <= 14)) expect(sonra.find((x) => x.hafta === k.hafta)?.paket, `hafta ${k.hafta}`).toBe(k.paket);
  console.log("OLCUM14", JSON.stringify({ yenileDevamMs: devamMs }));
  expect(konsol).toEqual([]);
});

/** IndexedDB `gunluk` kayit sayisi (kosu icin). */
async function gunlukSayisi(page: Page, kosuId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((coz, reddet) => {
        const acma = indexedDB.open("daoliberal-kayit");
        acma.onerror = () => reddet(acma.error);
        acma.onsuccess = () => {
          const db = acma.result;
          const istek = db.transaction("gunluk", "readonly").objectStore("gunluk").getAll();
          istek.onsuccess = () => {
            db.close();
            coz((istek.result as { kosuId: string }[]).filter((k) => k.kosuId === id).length);
          };
          istek.onerror = () => reddet(istek.error);
        };
      }),
    kosuId,
  );
}

test("kural_degisikligi (/changes, Kurucu): gunluge yazilir, yenileme gunlukten dogru devam eder", async ({ page }) => {
  test.setTimeout(420_000);
  const konsol = konsolDinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 120_000 });
  const kosuId = await oyunKur(page);
  for (let i = 1; i <= 2; i += 1) {
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 90_000 });
  }
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
  await expect(page.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "kurtarma fonuyla" }).click();
  await page.getByRole("button", { name: /^Uygula \(en erken \d+\. hafta\)$/ }).click();
  const dikis = page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/);
  await expect(dikis).toBeVisible({ timeout: 90_000 });
  const seam = Number(/(\d+)\. haftadan sonrası/.exec((await dikis.textContent()) ?? "")?.[1]);
  // dikis asilana dek hafta hafta
  for (;;) {
    const w = await hafta(page);
    if (w >= seam + 1) break;
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${w + 1} /`))).toBeVisible({ timeout: 90_000 });
  }
  const w1 = await hafta(page);
  await expect.poll(() => gunlukSayisi(page, kosuId), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const gunlukOnce = await gunlukSayisi(page, kosuId);
  await page.keyboard.press("Escape");

  await page.reload();
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: 240_000 });
  expect(await hafta(page)).toBe(w1);
  await expect((await ayrintilarAc(page, "Zaman çizgisi")).getByText(/^v2 · hafta/)).toBeVisible();     // sart gunlukten yeniden oynatildi
  expect(await gunlukSayisi(page, kosuId)).toBe(gunlukOnce);                                           // gunluk cift yazilmadi/kaybolmadi
  expect(konsol).toEqual([]);
});

test("tarayicida_model: yukle, 5 hafta, cekmece, yenile -> kayittan devam, haftalar kaybolmaz", async ({ page }, info) => {
  test.setTimeout(420_000);
  const konsol = konsolDinle(page);
  const olcum: Record<string, number | Record<string, number>> = {};

  // 1) Yukleme: Worker + Pyodide + paket (Kurucu formu gorunene dek)
  const t0 = Date.now();
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 120_000 });
  olcum.yuklemeMs = Date.now() - t0;
  olcum.asamaMs = (await page.evaluate(() => (performance.getEntriesByName("oyun-tarayici-hazir")[0] as PerformanceMark | undefined)?.detail ?? {})) as Record<string, number>;
  expect(Object.keys(olcum.asamaMs as Record<string, number>)).toEqual(expect.arrayContaining(["indirme", "dogrulama", "derleme", "paket", "kurulum"]));

  // 2) Oyun kur
  await page.getByLabel("Dünya adı").fill("Tarayıcı model");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 60_000 });
  const hash = new URL(page.url()).hash;
  expect(hash).toMatch(/^#\/canli\/canli-/);
  const kosuId = hash.slice("#/canli/".length);

  // 3) 5 hafta (her tek hafta bir hafta adimidir: lookahead dahil ~3 sn)
  const sureler: number[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const b = Date.now();
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 90_000 });
    sureler.push(Date.now() - b);
  }
  olcum.haftaBasinaMs = Math.round(sureler.reduce((a, b) => a + b, 0) / sureler.length);
  olcum.haftaMsDizisi = Object.fromEntries(sureler.map((s, i) => [`h${i + 1}`, s]));
  expect(await hafta(page)).toBe(5);

  // 4) Cekmece: kurum tablosundan Liman (cekirdege `/drawer` istegi gider)
  const ozet = page.locator("summary", { hasText: "Şehir haritası (tablo)" });
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1, { timeout: 30_000 });
  await ozet.focus();
  if (!(await page.locator("details", { has: ozet }).evaluate((d) => (d as HTMLDetailsElement).open))) await page.keyboard.press("Enter");
  await page.locator('[data-kurum="liman"] button').click();
  await expect(page.getByRole("complementary").filter({ hasText: /Liman/ }).first()).toBeVisible();

  // 5) IndexedDB: 1..5 haftalarin hepsi kayitli
  const once = await depodakiHaftalar(page, kosuId);
  expect(once.map((k) => k.hafta).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);

  // 6) Yenile: kayittan devam (ilk 13 haftada goruntu yok: tarif + gunlukten bastan oynatilir)
  const y0 = Date.now();
  await page.reload();
  await waitForLayout(page);
  await expect(page).toHaveURL(new RegExp(`${hash.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: 180_000 });
  olcum.yenileDevamMs = Date.now() - y0;
  expect(await hafta(page)).toBe(5);

  // 7) Haftalar kaybolmadi ve yeniden oynatma ayni paketleri uretti (belirlenimlilik: son 4 hafta devamda yeniden yazilir)
  const sonra = await depodakiHaftalar(page, kosuId);
  expect(sonra.length).toBeGreaterThanOrEqual(5);
  for (const k of once.slice(0, 5)) expect(sonra.find((x) => x.hafta === k.hafta)?.paket, `hafta ${k.hafta} paketi`).toBe(k.paket);

  // 8) Devam eden oyun ilerler
  await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
  await expect(DENETIM(page).getByText(/Hafta 6 \//)).toBeVisible({ timeout: 90_000 });
  expect((await depodakiHaftalar(page, kosuId)).map((k) => k.hafta)).toContain(6);

  info.annotations.push({ type: "olcum", description: JSON.stringify(olcum) });
  console.log("OLCUM", JSON.stringify(olcum));
  expect(konsol).toEqual([]);
});
