import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";

async function adim2(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: /Şartı yaz/ }).click();
  await expect(page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" })).toBeVisible();
}
const grup = (page: Page, ad: RegExp) => page.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: ad });
const uzmanAc = async (page: Page) => {
  const b = page.getByRole("button", { name: /^Göster \(\d+\)$/ });
  if (await b.count()) await b.click();
};

/**
 * Kurucu adım 2 özel bölümleri (W5): faiz hesaplayıcısı, kredi türleri A-D, bütçe ve sabit kalemler, Canlı özet ve Etki önizlemesi.
 * Prototip satırları (`only` aralıkları) `exceptions/sartOzel.ts` istisnalarıyla karşılaştırılır; her bölümün kendi metni de ayrıca denetlenir.
 * Kayıt kaynağında her kart "doğrulanmadı" olduğundan bölümler kilitli görünür; yapı ve metin yine denetlenir.
 */
test.describe("kurucu adım 2 özel bölümler", () => {
  test("Para ve faiz: hesaplayıcı, Canlı özet, Etki önizlemesi", async ({ page }) => {
    await adim2(page);
    const hes = page.getByRole("region", { name: "Faiz kuralı hesaplayıcısı" });
    await expect(hes).toBeVisible();
    await expect(hes.getByText("Simülasyonu etkilemez", { exact: true })).toBeVisible();
    await expect(hes.getByText(/hedef faiz %0,3\/hafta/)).toBeVisible();
    await expect(hes.getByText("Faiz haftada en çok %0,03 değişir.")).toBeVisible();
    await expect(hes.locator("svg path[data-seri='faiz']")).toHaveAttribute("d", /^M/);
    await assertOyunParity(page, { screen: "builder", bStep: 2, group: 0 }, {
      screen: "builder",
      only: [{ from: 34, to: 40 }, { from: 86, to: 86 }, { from: 98, to: 98 }, { from: 104, to: 105 }],
    });
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("Kredi: ortak kurallar, A-D grupları, varyant, Canlı özet", async ({ page }) => {
    await adim2(page);
    await grup(page, /Kredi/).click();
    await uzmanAc(page);
    for (const g of ["A. Girişim ve genç firma", "B. Büyüme ve yatırım", "C. Devir ve köprü", "D. Konut ve varlık"]) await expect(page.getByText(g, { exact: true })).toBeVisible();
    await assertOyunParity(page, { screen: "builder", bStep: 2, group: 1 }, {
      screen: "builder",
      only: [{ from: 40, to: 40 }, { from: 67, to: 67 }, { from: 100, to: 100 }, { from: 131, to: 131 }, { from: 154, to: 155 }, { from: 176, to: 176 }, { from: 179, to: 179 }, { from: 191, to: 191 }],
    });
    // kilitli kartın menüsü: varsayılana dönüş kapalı, kopyalama taslak üretir (koşuya gitmez)
    await page.getByRole("button", { name: "Genç firma kredisi: diğer eylemler" }).click();
    await expect(page.getByRole("button", { name: "Varsayılana döndür" })).toBeDisabled();
    await page.getByRole("button", { name: "Kendi varyantına kopyala" }).click();
    await expect(page.getByText("Modelde henüz yok", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Varyant adı")).toHaveValue("Genç firma kredisi (kopya)");
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("Şehir bütçesi: üyelik listesi; sıra yok", async ({ page }) => {
    await adim2(page);
    await grup(page, /Şehir bütçesi/).click();
    await uzmanAc(page);
    const kart = page.getByRole("article", { name: "Basım izninden tam pay alan giderler" });
    await expect(kart.getByText("İznin tamamını kullanır", { exact: true })).toBeVisible();
    await expect(kart.getByText("İznin yarısını kullanır", { exact: true })).toBeVisible();
    await expect(kart.getByRole("button", { name: /Yukarı|Aşağı/ })).toHaveCount(0);
    await assertOyunParity(page, { screen: "builder", bStep: 2, group: 4 }, { screen: "builder", only: [{ from: 34, to: 34 }, { from: 94, to: 94 }, { from: 106, to: 106 }] });
  });

  test("Sabit kalemler salt okunur", async ({ page }) => {
    await adim2(page);
    await grup(page, /Dünyanın sabit kalemleri/).click();
    const kart = page.getByRole("article", { name: "Dünyanın sabit kalemleri" });
    await expect(kart.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByText(/Salt okunur: bunlar senin vergin değil/)).toBeVisible();
    await assertOyunParity(page, { screen: "builder", bStep: 2, group: 3 }, { screen: "builder", only: [{ from: 34, to: 34 }] });
  });

  test("Canlı özet uydurma tahmin taşımaz; kayıt kaynağında önizleme nedenli kapalı", async ({ page }) => {
    await adim2(page);
    const ozet = page.getByRole("region", { name: "Canlı özet" });
    await expect(ozet.getByText(/Etkiyi tahmin etmiyoruz/)).toBeVisible();
    await expect(page.getByText(/Tahmin \(prototip kuralı/)).toHaveCount(0);
    await expect(ozet.getByRole("button", { name: "Etki önizlemesini çalıştır" })).toBeDisabled();
    await expect(ozet.getByText("Etki önizlemesi kayıt kaynağında çalışmaz: gerçek koşu için canlı model gerekir.")).toBeVisible();
  });

  test("Tutarlılık uyarıları bölümü kaydın kurallarıyla çizilir; varsayılan şartta çelişki yok", async ({ page }) => {
    await adim2(page);
    const bolum = page.getByRole("region", { name: "Tutarlılık uyarıları" });
    await expect(bolum).toBeVisible();
    await expect(bolum.getByText("Çelişen kural yok.")).toBeVisible();
    await expect(bolum.getByRole("button")).toHaveCount(0);
  });

  test("erişilebilirlik: Para ve faiz, Kredi, Şehir bütçesi", async ({ page }) => {
    await adim2(page);
    await expectNoA11yViolations(page);
    await grup(page, /Kredi/).click();
    await uzmanAc(page);
    await expectNoA11yViolations(page);
    await grup(page, /Şehir bütçesi/).click();
    await uzmanAc(page);
    await expectNoA11yViolations(page);
  });
});
