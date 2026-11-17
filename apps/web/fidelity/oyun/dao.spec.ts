import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { sunucuBaslat, sunucuDurdur, goruntuAl, temaUygula, type CanliSunucu } from "./canliSunucu";

/**
 * DAO oyunu, gerçek sunucuyla (T7 hizalama): girişten başlatma, bir hafta, karar, `olay`, erişilebilirlik, telefon genişliği, Harita paneli.
 * Sunucu `E2E_SUNUCU_PORT` (yoksa boş kapı) kapısında, koşular `E2E_KOSU_DIZINI` (varsayılan geçici) altında; web aynı kökenden sunulur.
 * `EKRAN_DIZINI` verilirse ekran görüntüleri oraya yazılır (açık/koyu x masaüstü/telefon).
 */
/** Varsayılan: işletim sisteminden boş kapı (paralel koşu güvenli); `E2E_SUNUCU_PORT` yalnız açıkça verilirse. */
const PORT = process.env.E2E_SUNUCU_PORT ? Number(process.env.E2E_SUNUCU_PORT) : undefined;
const EKRAN = process.env.EKRAN_DIZINI ?? "";

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat({ ...(PORT !== undefined ? { port: PORT } : {}), ...(process.env.E2E_KOSU_DIZINI ? { kosuDizini: process.env.E2E_KOSU_DIZINI } : {}) });
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const url = (hash: string): string => `http://127.0.0.1:${sunucu!.port}/oyun/?kaynak=canli#${hash}`;
/** Ekran görüntüsü: iki boyut x iki tema (EKRAN_DIZINI verilmişse). */
async function cek(page: Page, ad: string, hedef?: ReturnType<Page["locator"]>): Promise<void> {
  if (EKRAN === "") return;
  fs.mkdirSync(EKRAN, { recursive: true });
  const asil = page.viewportSize()!;
  for (const [boyut, vp] of [["masaustu", { width: 1280, height: 900 }], ["telefon", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(vp);
    await waitForLayout(page, boyut === "telefon" ? "narrow" : "wide");
    for (const tema of ["light", "dark"] as const) {
      await temaUygula(page, tema);
      const dosya = path.join(EKRAN, `${ad}-${boyut}-${tema === "light" ? "acik" : "koyu"}.png`);
      await goruntuAl(page, dosya, tema, hedef);
    }
  }
  await page.setViewportSize(asil);
  await waitForLayout(page);
}

test.describe("DAO oyunu (gerçek sunucu)", () => {
  test("giriş: erişilebilir, yatay kaydırma yok", async ({ page }) => {
    await page.goto(url("/dao"));
    await waitForLayout(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAO oyunu");
    await expect(page.getByRole("button", { name: "Başla", exact: true })).toBeEnabled();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await cek(page, "dao-giris");
  });
  // Oyun akışı (ahırdan çık, ilan, başvur) ve paneller: `sehir.spec.ts` (tam ekran şehir, gerçek model sunucusu).
});
