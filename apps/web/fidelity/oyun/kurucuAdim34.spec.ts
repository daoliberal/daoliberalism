import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

async function git(page: Page, ad: string): Promise<void> {
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: new RegExp(ad) }).click();
}

/**
 * Kurucu adım 3 (Süre ve hedefler) ve adım 4 (Kontrata işle yerine Özet) prototipe uyar; modelde ve bu sürümde olmayan satırlar
 * `exceptions/builder34.ts` içinde gerekçeyle ayrılır. Sıra sayfadaki sırayla karşılaştırılır.
 */
test.describe("kurucu adım 3-4 prototip sadakati", () => {
  test("adım 3", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await git(page, "Süre ve hedefler");
    await expect(page.getByRole("heading", { name: "Süre", exact: true })).toBeVisible();
    await assertOyunParity(page, { screen: "builder", bStep: 3 }, { screen: "builder", only: [{ from: 12, to: 999 }] });
  });

  test("adım 4", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await git(page, "Özet");
    await expect(page.getByRole("heading", { name: "Kurulum" })).toBeVisible();
    // 16-38: prototipin üç kontrat sütunu (zincirde bugün var / planlanan / oyun sunucusu); satırlar kart adı + değerdir ve DK-1 ile yoktur.
    await assertOyunParity(page, { screen: "builder", bStep: 4 }, { screen: "builder", only: [{ from: 12, to: 15 }, { from: 39, to: 999 }] });
    await expect(page.getByText("Gerçekçi (Şart'a girmez)")).toBeVisible();
  });

  test("süre, Başlangıç dünyası ve hedef metinleri", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await git(page, "Süre ve hedefler");
    for (const n of [100, 200, 500]) await expect(page.getByRole("button", { name: `${n} hafta` })).toBeVisible();
    await expect(page.getByRole("button", { name: "200 hafta" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "100 hafta" })).toBeDisabled();
    for (let n = 1; n <= 6; n++) await expect(page.getByRole("button", { name: `Dünya ${n}` })).toBeVisible();
    await expect(page.getByText(/tohum|rastlant/i)).toHaveCount(0);
    for (const g of ["200 hafta ayakta kal", "Son 30 haftada talep karşılama ≥ %80", "Şehir kasası tabana inmesin", "Servet Gini ≤ 0,8"]) await expect(page.getByRole("checkbox", { name: g })).toBeVisible();
    // Kayıt kaynağı hedefleri izlemez: kutular nedenli kilitli, Özet'te seçilmiş görünmez.
    await expect(page.getByRole("checkbox", { name: "Servet Gini ≤ 0,8" })).toBeDisabled();
    await expect(page.getByText("Kayıtlarda hedef izlenmez.")).toBeVisible();
    await git(page, "Özet");
    await expect(page.getByText("Kayıtlarda hedef izlenmez.")).toBeVisible();
    await expect(page.getByText("Zincire işle")).toHaveCount(0);
  });

  test("erişilebilirlik ve yatay kaydırma", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    for (const ad of ["Süre ve hedefler", "Özet"]) {
      await git(page, ad);
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    }
  });
});
