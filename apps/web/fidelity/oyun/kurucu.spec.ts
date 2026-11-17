import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

const ADIM_ADI = { 1: "Şablondan başla", 2: "Şartı yaz", 3: "Süre ve hedefler", 4: "Özet" } as const;

async function goStep(page: Page, n: 1 | 2 | 3 | 4): Promise<void> {
  const ad = ADIM_ADI[n];
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: new RegExp(ad) }).click();
}

/**
 * Kurucu kartları prototipin builder düzenine uyar. W3 ile adımlar ayrıdır (0 ad, 1 şablon + Geçiş desteği, 2 Şart editörü, 3 süre + Başlangıç dünyası + hedefler, 4 özet; W7);
 * her çağrı yalnız o adımdan MVP'nin sunduğu satırları denetler (`only`), sıra sayfadaki sırayla karşılaştırılır.
 * Prototipin kuralların listelendiği adımı (bStep 2) varsayılan sekmesinde Geçiş desteği kartını göstermez;
 * kart `group: 5, sel: "Geçiş desteği"` ile açılır (satır 44 başlık, 51-53 Bu ne demek / Oyunda neyi değiştirir / İpucu).
 */
test.describe("kurucu prototip sadakati", () => {
  test("builder adım 0, 1, 2 ve kilitli kartlar", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Başlat" })).toBeVisible();

    // Adım 0 ve 1 `kurucuAdim01.spec.ts` ile denetlenir; burada adım 1'deki Geçiş desteği kartı.
    await goStep(page, 1);
    await assertOyunParity(page, { screen: "builder", bStep: 2, group: 5, sel: "Geçiş desteği" }, {
      screen: "builder",
      only: [{ from: 44, to: 44 }, { from: 51, to: 53 }],
    });
    // Adım 2 (Şartı yaz) W4 ile Şart editörüdür: kural kartlarının gövdesi kayıt metnidir (K1/R1a), prototip satırı değildir;
    // adım 2'nin sadakati `sartEditoru.spec.ts` ile denetlenir.
    await goStep(page, 2);
    await expect(page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" })).toBeVisible();
    // Adım 3 ve 4 (süre, Başlangıç dünyası, hedefler, özet) `kurucuAdim34.spec.ts` ile denetlenir; burada yalnız ulaşılabilirlik ve Başlat'ın her adımda durması.
    await goStep(page, 3);
    await expect(page.getByRole("heading", { name: "Başlangıç dünyası" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Başlat" })).toBeVisible();
    await goStep(page, 4);
    await expect(page.getByRole("heading", { name: "Kurulum" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Başlat" })).toBeVisible();
  });

  test("erişilebilirlik", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("button", { name: "Başlat" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
