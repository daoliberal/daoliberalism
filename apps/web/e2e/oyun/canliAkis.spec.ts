import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, waitForLayout } from "../../fidelity/helpers";
import { ayrintilarAc, gorunumUrl, kosuKur, sunucuBaslat, sunucuDurdur, type CanliSunucu } from "../../fidelity/oyun/canliSunucu";

/**
 * Canlı akış uçtan uca (W9b): gerçek Python sunucusu (FakeHost). Dallanma yeni koşu açar ve üst koşu kalır;
 * Sıfırdan başlat aynı şartla 0. haftadan yeni koşu açar.
 */
test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat();
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const HAFTA = /Hafta (\d+) \/ 200/;
const runOf = (url: string): string => /#\/canli\/([^/]+)/.exec(new URL(url).hash)?.[1] ?? "";
/** Sunucudaki (en çok 3) koşuları atar: önceki testlerin sayfaları kapanınca abonelikler gecikmeyle düşer, sınır beklemeyi bozmasın. */
async function kosulariAt(page: Page, port: number): Promise<void> {
  const h = { "X-Oyun-Istek": "1", Origin: `http://127.0.0.1:${port}` };
  const r = await page.request.get(`http://127.0.0.1:${port}/api/runs`, { headers: h });
  for (const x of (await r.json()) as { runId: string }[]) await page.request.delete(`http://127.0.0.1:${port}/api/runs/${x.runId}`, { headers: h });
}
async function hafta(page: Page): Promise<number> {
  const text = (await page.getByRole("region", { name: "Oynatma denetimi" }).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(text)?.[1] ?? NaN);
}

test.describe("canlı dallanma ve sıfırdan başlat", () => {
  test("geçmiş haftadan dallan: yeni koşu o haftada açılır, üst koşu kalır", async ({ page }) => {
    test.setTimeout(120_000);
    await kosulariAt(page, sunucu!.port);
    const ust = await kosuKur(page, sunucu!.port, 6);
    await page.goto(gorunumUrl(sunucu!.port, ust, "dunya"));
    await waitForLayout(page);
    const w0 = await hafta(page);
    expect(w0).toBeGreaterThanOrEqual(6);
    const zaman = (await ayrintilarAc(page, "Zaman çizgisi")).getByRole("region", { name: "Zaman çizgisi" });
    await zaman.getByLabel("Geçmiş hafta").fill("3");
    await zaman.getByRole("button", { name: "Bu haftadan dallan" }).click();
    await expect.poll(() => runOf(page.url()), { timeout: 30_000 }).not.toBe(ust);
    await expect(page.getByRole("dialog", { name: "Simülasyon hesaplanıyor" })).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => hafta(page), { timeout: 30_000 }).toBe(3);
    await expect((await ayrintilarAc(page, "Olaylar")).getByRole("region", { name: "Ne olmuyor" })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    // Üst koşu değişmedi
    await page.goto(gorunumUrl(sunucu!.port, ust, "dunya"));
    await waitForLayout(page);
    await expect.poll(() => hafta(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(w0);
  });

  test("sıfırdan başlat: aynı şartla yeni koşu 0. haftadan", async ({ page }) => {
    test.setTimeout(120_000);
    await kosulariAt(page, sunucu!.port);
    const ilk = await kosuKur(page, sunucu!.port, 3);
    await page.goto(gorunumUrl(sunucu!.port, ilk, "dunya"));
    await waitForLayout(page);
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Sıfırdan başlat" }).click();
    await page.getByRole("dialog", { name: "Sıfırdan başlat" }).getByRole("button", { name: "Aynı şartla 0. haftadan" }).click();
    await expect.poll(() => runOf(page.url()), { timeout: 30_000 }).not.toBe(ilk);
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    await expect(page.getByText("canlı modelden")).toBeAttached(); // dar ekranda kaynak etiketi saat kartında gizlenir
  });

  // W11 düzeltme: sunucu takvimi gövdenin üst düzeyinde okur; şartı değiştirilmiş koşuda "aynı şartla" yeni koşu sürüm takvimini taşımalı.
  test("sıfırdan başlat: şartı değiştirilmiş koşunun sürüm takvimi yeni koşuya geçer", async ({ page }) => {
    test.setTimeout(120_000);
    await kosulariAt(page, sunucu!.port);
    await kosuKur(page, sunucu!.port, 3);
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await panel.getByRole("button", { name: "kurtarma fonuyla" }).click();
    await page.getByRole("button", { name: /^Uygula \(en erken/ }).click();
    await expect(page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/)).toBeVisible({ timeout: 30_000 });
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Sıfırdan başlat" }).click();
    const onceki = runOf(page.url());
    await page.getByRole("dialog", { name: "Sıfırdan başlat" }).getByRole("button", { name: "Aynı şartla 0. haftadan" }).click();
    await expect.poll(() => runOf(page.url()), { timeout: 30_000 }).not.toBe(onceki);
    const h = { "X-Oyun-Istek": "1", Origin: `http://127.0.0.1:${sunucu!.port}` };
    const r = await page.request.get(`http://127.0.0.1:${sunucu!.port}/api/runs/${runOf(page.url())}`, { headers: h });
    const state = ((await r.json()) as { state: { versions?: { fromWeek: number }[] } }).state;
    expect(state.versions?.length).toBe(2);
    expect(state.versions?.[1]?.fromWeek).toBeGreaterThan(0);
  });
});
