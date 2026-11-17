import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { assertOyunParity } from "./oyun-parity";
import { kosuKur, sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat();
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const kosularUrl = (port: number): string => `http://127.0.0.1:${port}/oyun/?kaynak=canli#/kosular`;

async function kosularAc(page: Page): Promise<void> {
  await page.goto(kosularUrl(sunucu!.port));
  await waitForLayout(page);
  await expect(page.getByRole("heading", { name: "Koşular", exact: true })).toBeVisible();
}

/**
 * Koşular ekranı (W11), gerçek sunucu (`--host-kind fake`) ile. Prototipin `runs` ekranı boş kütüphanede (6-12. satırlar; 1-5 üst çubuk, kabuğa ait): başlık, boş durum,
 * Çatallanma ağacı ve Dışa / içe aktar. Kayıtlı koşu kartları gerçek bir koşu kaydedilerek denetlenir.
 */
test.describe("koşular ekranı", () => {
  test("prototip sadakati (boş kütüphane), erişilebilirlik ve yatay kaydırma yok", async ({ page }) => {
    await kosularAc(page);
    await assertOyunParity(page, { screen: "runs" }, { screen: "runs", only: [{ from: 6, to: 12 }] });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("açık koşu kendiliğinden kaydedilir, kart eylemleri görünür, ağaç ve dışa aktarma çalışır", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port);
    // Şehir kabuğunda üst çubuk yok: Koşular ana menüdedir.
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("group", { name: "Ana menü" }).getByRole("button", { name: "Koşular", exact: true }).click();
    const acik = page.getByRole("region", { name: "Açık koşular" });
    await expect(acik.getByRole("button", { name: /^Kaydet: / })).toHaveCount(0); // kayıt kendiliğinden: Kaydet düğmesi yok
    const kart = page.getByRole("list", { name: "Kayıtlı koşular" }).getByRole("listitem");
    await expect(kart.getByRole("heading", { name: "Canlı Deneme" })).toBeVisible();
    for (const ad of ["Aç", "Yeniden adlandır", "Karşılaştır", "Şartı kopyala", "Dışa aktar", "Sil"]) {
      await expect(kart.getByRole("button", { name: new RegExp(`^${ad}: Canlı Deneme$`) })).toBeVisible();
    }
    await kart.getByRole("button", { name: /^Dışa aktar: / }).click();
    await expect(page.getByLabel("Dışa aktarılan koşu (JSON)")).toHaveValue(new RegExp(`"id": "${id}"`));
    await expect(page.getByRole("list", { name: "Çatallanma ağacı" }).getByText("Canlı Deneme")).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("içe aktarma alan hatasını Türkçe söyler", async ({ page }) => {
    await kosularAc(page);
    await page.getByLabel("İçe aktar: koşu JSON'unu yapıştır").fill('{"id":"x","recipe":{}}');
    await page.getByRole("button", { name: "İçe aktar", exact: true }).click();
    await expect(page.getByRole("alert").getByText(/1\. koşuda ad alanı eksik ya da geçersiz\./)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("Aç: sunucuda olmayan koşu tarifle yeniden kurulur ve Canlı Dünya'ya gider", async ({ page }) => {
    const tarif = { v: 1, templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 0, values: {}, schedule: [{ week: 10, patch: { gecis_destegi: "kurtarma_fonuyla" } }] };
    await page.addInitScript((r) => {
      if (!window.localStorage.getItem("oyun.kosular.v1")) {
        window.localStorage.setItem("oyun.kosular.v1", JSON.stringify({ schema: 1, runs: [{ id: "canli-silinmis", name: "Silinmiş koşu", recipe: r, savedAt: "2026-10-29T10:00:00.000Z", source: "live" }] }));
      }
    }, tarif);
    await kosularAc(page);
    await page.getByRole("button", { name: /^Aç: Silinmiş koşu$/ }).click();
    await expect(page).toHaveURL(/#\/canli\/canli-[0-9a-f]+/);
    // Takvimli tarif sunucuda pacer'sız 10. haftaya kadar hesaplanır; hazır olunca koşu o haftada durur (ileri sarma gövdenin üst düzeyindeki `fastForwardTo` ile gelir).
    const saat = page.getByRole("region", { name: "Oynatma denetimi" });
    await expect(saat.getByText("Hafta 10 / 100")).toBeVisible({ timeout: 60_000 });
    await expectNoA11yViolations(page);
  });
});
