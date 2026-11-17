import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";
import { ayrintilarAc } from "./canliSunucu";
import { assertOyunParity } from "./oyun-parity";

async function ac(page: Page, haftaAdim = 0): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await page.getByLabel("Dünya adı").fill("Deneme");
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
  for (let i = 1; i <= haftaAdim; i += 1) {
    await page.getByRole("button", { name: "Tek hafta" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(`Hafta ${i} / 200`)).toBeVisible();
  }
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
  await expect(page.getByRole("heading", { name: "Şartı değiştir · v1 → v2" })).toBeVisible();
  // Geçiş desteği "Kurtarma ve geçiş" grubunda (prototipteki `group: 5` seçimi).
  await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
  await expect(page.getByRole("dialog").getByRole("group", { name: "Geçiş desteği" })).toBeVisible();
}

/**
 * "Şartı değiştir" paneli prototipin düzenleyici kaplamasına uyar (`editorOpen` + `values`, yamalı: `editorDraft`; Geçiş desteği kartı açık).
 * Yalnız MVP'nin sunduğu satırlar denetlenir (`only`): panel başlığı (üst çubuk düğmesi 3, 4, 6 tam ekran kabukta Ayrıntılar > Koşu / Menü'dedir: yeri `ayrintilarEslemesi.ts`, düğme vitest'te sınanır),  kapat, bilgi, fark durumu (7-10),
 * Geçiş desteği kartının başlığı ve üç gövde satırı (42, 49-51), uygula düğmesi (92). Diğer kural kartları, sekmeler, ara, dal,
 * canlı özet ve etki önizlemesi (11-41, 43-48, 52-91, 93-97) Dilim 2-3'tür; panel dışındaki canlı ekran satırları F2 spec'indedir.
 */
test.describe("şartı değiştir prototip sadakati", () => {
  test("panel açık", async ({ page }) => {
    await ac(page);
    await assertOyunParity(page, { screen: "live", editorOpen: true, editorDraft: true, group: 5, sel: "Geçiş desteği" }, {
      screen: "live",
      only: [{ from: 7, to: 10 }, { from: 42, to: 42 }, { from: 49, to: 51 }, { from: 92, to: 92 }],
    });
  });

  test("erişilebilirlik", async ({ page }) => {
    await ac(page);
    await expectNoA11yViolations(page);
  });

  test("uygula: dikiş bandı ve sürüm 2", async ({ page }) => {
    await ac(page, 1);
    // Kurucunun ilk şablonu Geçiş desteği (destek açık, "kurtarma fonuyla"): değişiklik oluşması için "kapalı" seçilir.
    await page.getByRole("dialog").getByRole("group", { name: "Geçiş desteği" }).getByRole("button", { name: "kapalı" }).click();
    await page.getByRole("button", { name: /Gelecek haftadan uygula/ }).click();
    await expect(page.getByText(/1\. haftadan sonrası seçilen/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("v2")).toBeAttached();
    await expect(page).toHaveURL(/#\/canli\//);
    await expectNoA11yViolations(page);
  });
});
