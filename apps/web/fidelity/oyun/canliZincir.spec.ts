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

/** Zincir artık Ayrıntılar penceresinin Zincir sekmesidir; `/zincir` rotası pencereyi o sekmede açar (T6b). */
test.describe("canlı Zincir sekmesi", () => {
  test("zincir: rota pencereyi açar, kıt halkalar, çekmece, erişilebilirlik, yatay kaydırma yok", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port);
    await page.goto(gorunumUrl(sunucu!.port, id, "zincir"));
    // Eski bağlantı yeni sayfa yüklemesinde (ilk çizimde) pencereyi Zincir sekmesinde açar; aynı sayfadaki hash değişimi yeterli değildir.
    await page.reload();
    await waitForLayout(page);
    const pencere = page.getByRole("dialog", { name: "Ayrıntılar" });
    await expect(pencere).toBeVisible();
    await expect(pencere.getByRole("tab", { name: "Zincir" })).toHaveAttribute("aria-selected", "true");
    await expect(pencere.getByRole("region", { name: "Üretim zinciri" })).toBeVisible();
    await expect(pencere.locator("[data-dugum]").first()).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    const kit = pencere.getByRole("list", { name: "En kıt halkalar" }).getByRole("button").first();
    await kit.click();
    // Halka çekmecesi: Ayrıntılar kapanır, çekmece (diyalog) açılır.
    const cekmece = page.getByRole("dialog");
    await expect(cekmece).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ayrıntılar" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("geç katılan istemci: sayfa yenilenince kenarlar 1. haftadan yeniden kurulur", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port);
    await page.goto(gorunumUrl(sunucu!.port, id, "zincir"));
    await waitForLayout(page);
    const pencere = await ayrintilarAc(page, "Zincir");
    const once = await pencere.locator("[data-kenar]").count();
    expect(once).toBeGreaterThan(0);
    await page.reload();
    await waitForLayout(page);
    const yeni = await ayrintilarAc(page, "Zincir");
    await expect(yeni.locator("[data-kenar]")).toHaveCount(once);
  });
});
