import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";
import { ayrintilarAc } from "./canliSunucu";
import { assertOyunParity } from "./oyun-parity";

/**
 * Şart okuyucusu prototipin `readOpen` kaplamasına uyar: başlık (83), Kapat (84), Sürüm: (86), v1 (87), "İlk sürüm (fark yok)" (88).
 * Senaryo bandı (85) ve "Zincir kayıtları" (89) istisnadır (exceptions/reader.ts); grup ve satırlar (90+) kayıt kartlarına bağlıdır, birim testindedir.
 */
test.describe("şart okuyucusu prototip sadakati", () => {
  async function ac(page: import("@playwright/test").Page): Promise<void> {
    await gotoApp(page, "/oyun/#/kurucu");
    await page.getByLabel("Dünya adı").fill("Deneme");
    await page.getByRole("button", { name: "Başlat" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    // Şart okuyucusu Ayrıntılar > Koşu ve kararlar'dan açılır (T6b).
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şart", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Ekonomi Şartı/ })).toBeVisible();
  }

  test("okuyucu üst bölümü", async ({ page }) => {
    await ac(page);
    await assertOyunParity(page, { screen: "live", readOpen: true, readerDraft: true, worldName: "Deneme" }, {
      screen: "reader",
      root: page.getByRole("dialog"),
      only: [{ from: 83, to: 89 }],
    });
  });

  test("erişilebilirlik", async ({ page }) => {
    await ac(page);
    await expectNoA11yViolations(page);
  });
});
