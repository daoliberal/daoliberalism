import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";
import { ayrintilarAc } from "./canliSunucu";

async function baslat(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await page.getByLabel("Dünya adı").fill("Deneme");
  await page.getByRole("button", { name: "Başlat" }).click();
}

const saat = (page: Page) => page.getByRole("region", { name: "Oynatma denetimi" });

/**
 * Canlı koşu tam ekran şehir kabuğundadır (T6b): prototipin `live` ekranı sayfa olarak yoktur, satır satır karşılaştırma kalktı.
 * Eski sayfa yüzeylerinin yeni yeri `src/oyun/screens/canli/ayrintilarEslemesi.ts` tablosudur (vitest her satırı sınar);
 * burada tarayıcıda gerçek kabuk: saat çubuğu (kabukta), olay boş durumu ve göstergeler (Ayrıntılar), zaman çizgisi (Ayrıntılar).
 */
test.describe("canlı koşu tam ekran kabuğu", () => {
  test("kabuk: saat çubuğu kabukta, boş durum ve göstergeler Ayrıntılar'da", async ({ page }) => {
    await baslat(page);
    await expect(saat(page).getByText("Hafta 0 / 200")).toBeVisible();
    await expect(page.getByRole("region", { name: "Şehir ekranı" })).toBeVisible();
    // Olay akışı Ayrıntılar > Olaylar'da; koşu yeni olduğundan boş durum.
    const olaylar = await ayrintilarAc(page, "Olaylar");
    await expect(olaylar.getByRole("region", { name: "Olay akışı" })).toBeVisible();
    await expect(olaylar.getByText("Henüz olay yok. Oynat'a bas.")).toBeVisible();
    // Genel: sağlık başlığı ve göstergeler.
    const genel = await ayrintilarAc(page, "Genel");
    await expect(genel.getByRole("region", { name: "Sağlık başlığı" })).toBeVisible();
    await expect(genel.getByRole("region", { name: "Göstergeler" })).toBeVisible();
    // Zaman çizgisi ve sürüm satırı.
    const zaman = await ayrintilarAc(page, "Zaman çizgisi");
    await expect(zaman.getByRole("region", { name: "Zaman çizgisi" })).toBeVisible();
    await expect(zaman.getByText(/^v1 · hafta 0/)).toBeVisible();
  });

  test("erişilebilirlik: kabuk ve Ayrıntılar penceresi", async ({ page }) => {
    await baslat(page);
    await expect(saat(page).getByText("Hafta 0 / 200")).toBeVisible();
    await expectNoA11yViolations(page);
    await ayrintilarAc(page, "Genel");
    await expectNoA11yViolations(page);
  });

  test("oynat: hafta ilerler", async ({ page }) => {
    await baslat(page);
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(saat(page).getByText("Hafta 1 / 200")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
