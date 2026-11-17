import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

/** Şart editörü C katmanı (W6): Kurucu'da "başlangıç piyasası"; koşu olmadığı için değerler "Koşu başlayınca görünür". */
test.describe("Piyasa", () => {
  test("Kurucu: başlangıç piyasası, göstergeler ve erişilebilirlik", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: /Şartı yaz/ }).click();
    await page.getByRole("tab", { name: /C\. Piyasa/ }).click();
    await assertOyunParity(page, { screen: "builder", bStep: 2, layer2: "market" }, {
      screen: "builder",
      only: [{ from: 12, to: 16 }, { from: 19, to: 20 }],
    });
    const tablo = page.getByRole("table", { name: "Piyasa göstergeleri" });
    await expect(tablo).toBeVisible();
    expect(await tablo.getByRole("row").count()).toBeGreaterThan(1);
    await expect(tablo.getByText("Koşu başlayınca görünür").first()).toBeVisible();
    await expect(tablo.getByRole("columnheader", { name: "Bu hafta (dünya)" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });
});
