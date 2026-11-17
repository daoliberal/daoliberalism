import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { ayrintilarAc, gorunumUrl, kosuKur, sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat();
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

/**
 * Dünya ve Şehir artık ayrı sayfa görünümü değil, tam ekran şehir kabuğudur (T6b): `/dunya` ve `/harita` koşu şehir ekranına,
 * `/sehir-N` `/N` rotasına yönlenir. Dünya toplamı Ayrıntılar > Genel (Dünya kapsamı), şehir değerleri şehir kapsamıdır;
 * kentin kendisi harita tuvali, katmanlar harita kontrolleridir.
 */
test.describe("canlı Dünya ve Şehir (tam ekran kabuk)", () => {
  test("dünya rotası şehir ekranına yönlenir; Ayrıntılar'da dünya kapsamı ve beş şehir", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port);
    await page.goto(gorunumUrl(sunucu!.port, id, "dunya"));
    await waitForLayout(page);
    await expect(page).toHaveURL(new RegExp(`#/canli/${id}$`));
    await expect(page.getByRole("region", { name: "Şehir ekranı" })).toBeVisible();
    const pencere = await ayrintilarAc(page, "Genel");
    await expect(pencere.getByRole("region", { name: "Sağlık başlığı" })).toBeVisible();
    const kapsam = pencere.getByRole("group", { name: "Kapsam" });
    await expect(kapsam.getByRole("button")).toHaveCount(6);
    await expect(kapsam.getByRole("button", { name: "Dünya" })).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("şehir rotası: katmanlar, şehir kapsamı, erişilebilirlik, yatay kaydırma yok", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port);
    await page.goto(gorunumUrl(sunucu!.port, id, "sehir-1"));
    await waitForLayout(page);
    await expect(page).toHaveURL(new RegExp(`#/canli/${id}/1$`));
    // Eski `sehir-N` sıfırdan sayar: sehir-1 ikinci şehirdir.
    await expect(page.getByRole("heading", { level: 2, name: "Şehir 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yok", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    for (const katman of ["Talep", "İşsizlik", "Fiyat", "Yok"]) {
      await page.getByRole("button", { name: katman, exact: true }).click();
      await expect(page.getByRole("button", { name: katman, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    }
    // Şehir ayrıntısı: Ayrıntılar penceresinde şehir kapsamı.
    const pencere = await ayrintilarAc(page, "Genel");
    await pencere.getByRole("group", { name: "Kapsam" }).getByRole("button", { name: "Şehir 3" }).click();
    await expect(pencere.getByRole("group", { name: "Kapsam" }).getByRole("button", { name: "Şehir 3" })).toHaveAttribute("aria-pressed", "true");
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
