import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

async function katman(page: Page, ad: RegExp): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: /Şartı yaz/ }).click();
  await page.getByRole("tab", { name: ad }).click();
}

/**
 * Şart editörü B katmanı (W6): aktör sekmeleri, salt okunur kartlar, Dünya senaryosu düğmesi. Kayıt kaynağında senaryo seçilemez (nedenli).
 * Prototip karşılaştırması yapı satırlarıyla sınırlıdır (`exceptions/insanlar.ts`); kart metinleri kayıttan geldiği için ayrıca denetlenir.
 */
test.describe("Dünyanın insanları", () => {
  test("yapı: katman sekmeleri, giriş, senaryo satırı ve düğmesi", async ({ page }) => {
    await katman(page, /B\. Dünyanın insanları/);
    await assertOyunParity(page, { screen: "builder", bStep: 2, layer2: "people", actor: 0 }, {
      screen: "builder",
      only: [{ from: 12, to: 16 }, { from: 26, to: 27 }, { from: 74, to: 74 }],
    });
    await expect(page.getByRole("tab", { name: /B\. Dünyanın insanları/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: /A\. Kurallar/ })).toContainText("Senin Ekonomi Şartın: kontrata işlenir");
    await expect(page.getByRole("tab", { name: /B\. Dünyanın insanları/ })).toContainText("Simüle edilen davranışlar: kural değil, varsayım");
    await expect(page.getByRole("tab", { name: /C\. Piyasa/ })).toContainText("Kendiliğinden oluşan değerler: ayar değil");
    const dugme = page.getByRole("button", { name: "Bu dünyayı değiştir (dünya senaryosu)" });
    await expect(dugme).toBeDisabled();
    await expect(page.getByText("Kayıtlarda yalnız gerçekçi dünya var: dünya senaryosu seçilemez.")).toBeVisible();
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("her aktör sekmesinde kartlar var ve kontrol yok; Y bölümü salt okunur", async ({ page }) => {
    await katman(page, /B\. Dünyanın insanları/);
    const sekmeler = page.getByRole("tablist", { name: "Aktörler" }).getByRole("tab");
    const n = await sekmeler.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await sekmeler.nth(i).click();
      const panel = page.getByRole("tabpanel").last();
      expect(await panel.getByRole("article").count()).toBeGreaterThan(0);
      for (const rol of ["textbox", "radio", "checkbox", "slider", "combobox"] as const) expect(await panel.getByRole(rol).count(), rol).toBe(0);
      expect(await panel.getByRole("button").count()).toBe(0);
    }
    await expect(page.getByRole("region", { name: "Dünya kuralları" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Dünya kuralları" }).getByRole("button")).toHaveCount(0);
  });

  test("erişilebilirlik ve yatay kaydırma yok", async ({ page }) => {
    await katman(page, /B\. Dünyanın insanları/);
    await expectNoA11yViolations(page);
    await page.getByRole("tablist", { name: "Aktörler" }).getByRole("tab").last().click();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });
});
