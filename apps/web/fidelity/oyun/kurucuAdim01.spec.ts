import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

async function git(page: Page, ad: string): Promise<void> {
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: new RegExp(ad) }).click();
}

/**
 * Kurucu adım 0 (Dünyanı adlandır, 62 satır) ve adım 1 (Şablondan başla, 38 satır) prototipe uyar; modelde olmayan satırlar
 * `exceptions/builder01.ts` içinde gerekçeyle ayrılır. Sıra sayfadaki sırayla karşılaştırılır.
 */
test.describe("kurucu adım 0-1 prototip sadakati", () => {
  test("adım 0", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await expect(page.getByText("Dünyana ve beş şehrine ad ver. Kurallar dünya genelidir, sen beş şehrin hepsini yönetirsin.")).toBeVisible();
    await assertOyunParity(page, { screen: "builder", bStep: 0 }, { screen: "builder", only: [{ from: 12, to: 999 }] });
  });

  test("adım 1", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await git(page, "Şablondan başla");
    // Kurucunun ilk şablonu Geçiş desteği (736a00a; sahip kararı), prototipte ise Dayanıklı taban önce gelir. Sıra denetimi iki geçişte yapılır:
    // her şablon kartı kendi içinde ve kartların dışındaki satırlarla sırayla beklenir, iki kartın birbirine göre sırası beklenmez (21-24 Dayanıklı taban, 25-27 Geçiş desteği).
    await assertOyunParity(page, { screen: "builder", bStep: 1 }, { screen: "builder", only: [{ from: 12, to: 20 }, { from: 25, to: 999 }] });
    await assertOyunParity(page, { screen: "builder", bStep: 1 }, { screen: "builder", only: [{ from: 12, to: 24 }, { from: 28, to: 999 }] });
  });

  test("Rastgele isim ve adımlar", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await page.getByRole("button", { name: "Rastgele isim" }).click();
    const ad = await page.getByLabel("Dünya adı").inputValue();
    expect(ad).not.toBe("");
    for (let n = 1; n <= 5; n++) expect(await page.getByLabel(`Şehir ${n} adı`).inputValue()).not.toBe("");
    await expect(page.getByText(`Adlar dolduruldu: ${ad}`)).toBeVisible();
    await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
    await page.getByRole("button", { name: "Geri", exact: true }).click();
    expect(await page.getByLabel("Dünya adı").inputValue()).toBe(ad);
  });

  test("erişilebilirlik ve yatay kaydırma", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("button", { name: "Rastgele isim" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await git(page, "Şablondan başla");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await git(page, "Şartı yaz");
    await expectNoA11yViolations(page);
  });
});
