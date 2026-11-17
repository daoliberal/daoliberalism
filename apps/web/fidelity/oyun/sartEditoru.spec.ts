import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { BUILDER2_EXCEPTIONS, BUILDER2_GRUP_FARKLARI } from "./exceptions/builder2";
import { assertOyunParity, oyunPrototypeText } from "./oyun-parity";

async function adim2(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: /Şartı yaz/ }).click();
  await expect(page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" })).toBeVisible();
}

const grup = (page: Page, no: number) => page.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: new RegExp(`^${no}\\. `) });

/**
 * Kurucu adım 2 (prototip bStep 2, 107 satır) A katmanı çekirdeği: katman sekmesi (satır 12), kural/değiştirdiğin şeridi (15), Ara (18),
 * grup sekmeleri (19-28) ve seçili grubun başlığı (29) ile ilk grubun ana kart başlıkları (41, 49, 58) prototipe uyar.
 * Satırlar 1-11 (marka ve adım şeridi) W2/W3'te denetlenir; 13-14 (B, C katmanı) ve 16-17 W6/W12'de; 30-83 satırlarındaki kart gövde metni
 * kayıt metnidir (R1a, kendi sözcükleriyle yazıldı; gövde etiketleri ayrı testte) ve 86 sonrası (Canlı özet vb.) W5'tedir; 84-85 W4'ün kendi uzman düğmesidir ve denetlenir. Modelde olmayan gruplar `exceptions/builder2.ts` içinde ayrılır.
 */
test.describe("kurucu adım 2 prototip sadakati", () => {
  test("katman, şerit, arama, grup sekmeleri ve ilk grup kartları", async ({ page }) => {
    await adim2(page);
    await expect(page.getByRole("tab", { name: /A\. Kurallar/ })).toContainText("Senin Ekonomi Şartın: kontrata işlenir");
    await assertOyunParity(page, { screen: "builder", bStep: 2 }, {
      screen: "builder",
      only: [{ from: 12, to: 12 }, { from: 15, to: 15 }, { from: 18, to: 29 }, { from: 41, to: 41 }, { from: 49, to: 49 }, { from: 58, to: 58 }, { from: 84, to: 85 }],
    });
  });

  test("grup 0..3 başlıkları", async ({ page }) => {
    await adim2(page);
    for (const i of [0, 1, 2, 3]) {
      await grup(page, i + 1).click();
      await expect(grup(page, i + 1)).toHaveAttribute("aria-current", "page");
      await assertOyunParity(page, { screen: "builder", bStep: 2, group: i }, { screen: "builder", only: [{ from: 29, to: 29 }] });
    }
  });

  test("bütün gruplar açılır, uzman ayarları düğmeyle gelir, yatay kaydırma yok", async ({ page }) => {
    await adim2(page);
    const n = await page.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button").count();
    expect(n).toBeGreaterThanOrEqual(5);
    for (let i = 1; i <= n; i++) {
      await grup(page, i).click();
      await expect(page.getByRole("heading", { level: 3, name: new RegExp(`^${i}\\. `) })).toBeVisible();
      const articles = page.getByRole("article");
      expect(await articles.count()).toBeGreaterThan(0);
      const uzman = page.getByRole("button", { name: /^Göster \(\d+\)$/ });
      if (await uzman.count()) {
        const before = await articles.count();
        await uzman.click();
        expect(await articles.count()).toBeGreaterThan(before);
      }
      await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    }
  });

  test("arama sonucu satırı (q durumu)", async ({ page }) => {
    await adim2(page);
    await page.getByRole("searchbox", { name: "Ara" }).fill("Ücretten gelir vergisi");
    await expect(page.getByRole("list", { name: "Arama sonuçları" })).toBeVisible();
    await assertOyunParity(page, { screen: "builder", bStep: 2, q: "Ücretten gelir vergisi" }, { screen: "builder", only: [{ from: 18, to: 19 }] });
  });

  test("kart gövdesi etiketleri (prototip satır 50-52 etiketleri)", async ({ page }) => {
    await adim2(page);
    await grup(page, 4).click();
    const kart = page.getByRole("article", { name: "Ücret stopajı" });
    for (const etiket of ["Bu ne demek", "Oyunda neyi değiştirir", "İpucu"]) await expect(kart.getByText(etiket, { exact: true })).toBeVisible();
    // prototipte aynı etiketler bu kartın gövdesinde satır başıdır
    const proto = oyunPrototypeText({ screen: "builder", bStep: 2, group: 3, sel: "Ücret stopajı" });
    for (const etiket of ["Bu ne demek: ", "Oyunda neyi değiştirir: ", "İpucu: "]) expect(proto).toContain(etiket);
  });

  test("grup adı istisnaları hâlâ gerekli (kayıtta prototip adı belirirse kaldır)", async ({ page }) => {
    await adim2(page);
    const proto = oyunPrototypeText({ screen: "builder", bStep: 2 });
    const sekmeler = (await page.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button").allInnerTexts()).map((x) => x.replace(/^\d+\. /, "").replace(/\s*\d+$/, ""));
    for (const g of BUILDER2_GRUP_FARKLARI) {
      expect(proto, `prototipte "${g.proto}" yok: istisna gereksiz`).toMatch(new RegExp(`^\\d+\\. ${g.proto}$`, "m"));
      expect(sekmeler, `kayıtta artık "${g.proto}" var: builder2.ts istisnasını kaldır`).not.toContain(g.proto);
      expect(sekmeler, `kayıtta "${g.kayit}" yok: ad farkı gerekçesi eskidi`).toContain(g.kayit);
    }
    for (const e of BUILDER2_EXCEPTIONS) expect(e.reason.length).toBeGreaterThan(20);
  });

  test("arama karta götürür ve kilitli kart klavyeyle okunur", async ({ page }) => {
    await adim2(page);
    await page.getByRole("searchbox", { name: "Ara" }).fill("ÜCRETTEN GELİR");
    await page.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: /Ücret stopajı/ }).click();
    const kart = page.getByRole("article", { name: "Ücret stopajı" });
    await expect(kart).toBeVisible();
    const baslik = kart.getByRole("heading", { name: "Ücret stopajı" });
    await baslik.focus();
    await expect(baslik).toBeFocused();
    await expect(baslik).toHaveAccessibleDescription(/Bu ayar kayıtlarda yok/);
  });

  test("erişilebilirlik ve yatay kaydırma", async ({ page }) => {
    await adim2(page);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await grup(page, 4).click();
    await page.getByRole("button", { name: /^Göster \(\d+\)$/ }).click();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });
});
