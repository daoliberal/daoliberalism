import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";

/**
 * Sahip onaylı sapma (üç oyunlu Başlangıç, K-222): ekran artık prototipin `start` ekranıyla satır satır eşleşmez;
 * prototip karşılaştırması kaldırıldı. Tam ekran giriş kabuğunda (T7) üç kart, düğmeler ve erişilebilirlik burada;
 * kart içeriği birim testiyle denetlenir.
 */
test.describe("başlangıç prototip sadakati", () => {
  test("start ekranı", async ({ page }) => {
    await gotoApp(page, "/oyun/");
    await expect(page.getByRole("heading", { level: 1, name: "daoliberalism" })).toBeVisible();
    await expect(page.getByText("Bir ekonomi kur ya da birinin kurduğu ekonomide yaşa.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Koyu|Açık) tema$/ })).toBeVisible();
    for (const ad of ["Kurucu", "DAO", "Evren"]) await expect(page.getByRole("heading", { level: 2, name: ad })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yakında" })).toBeDisabled();
  });

  test("düğmeler gezdirir", async ({ page }) => {
    await gotoApp(page, "/oyun/");
    await page.getByRole("button", { name: "Kurucu olarak başla →" }).click();
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await expect(page).toHaveURL(/#\/kurucu$/);
    await page.getByRole("button", { name: "← Geri" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await page.getByRole("button", { name: "DAO olarak başla →" }).click();
    await expect(page).toHaveURL(/#\/dao$/);
  });

  test("erişilebilirlik", async ({ page }) => {
    await gotoApp(page, "/oyun/");
    await expect(page.getByRole("button", { name: "Kurucu olarak başla →" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
