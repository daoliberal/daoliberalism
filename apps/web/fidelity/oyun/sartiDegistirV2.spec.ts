import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, gotoApp } from "../helpers";
import { ayrintilarAc } from "./canliSunucu";
import { assertOyunParity } from "./oyun-parity";

async function ac(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await page.getByLabel("Dünya adı").fill("Deneme");
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
  await expect(page.getByRole("heading", { name: "Şartı değiştir · v1 → v2" })).toBeVisible();
  await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
}

/** Satır 3, 4, 6 (üst çubuk: Şartı değiştir, Koşular, Hareketi azalt) tam ekran kabukta Ayrıntılar > Koşu ve Menü'dedir (`ayrintilarEslemesi.ts`), panelle birlikte aranmaz. Satır 5 tema düğmesidir ("Koyu tema" yalnız açık temada yazar): tema ekranları F2 spec'indedir. Satır 52-68: prototipin "Haftalık destek tavanı" ve "Destek sürerken özelleştirme dursun" kartları (kayıtta kendi adlarıyla, öteki gruplarda; kartlar sartEditoru spec'inde). Satır 93-97: dal açma (Koşular/Sonuç görevi). Satır 84: prototipin önizleme ayar seçicisi; canlı önizleme taslağın tüm değişenlerini birlikte koşar (sart.ozet.*). Satır 72: "değişiklik yok" yerine Canlı özet "Değişen kural yok" cümlesini kendi metniyle yazar. Satır 43-48 ("Ana Oyun sunucusu" rozeti ve seçenekler): rozet kartta "Oyun sunucusunda" olarak yazılır, seçenekler sırası farklı. Satır 44-48: prototip "Etki" etiketini seçeneklerden önce yazar, kayıt kartı seçenekleri önce çizer (karşılık sartEditoru spec'inde). Satır 28-41: prototipin elle yazılmış "Zarar eden firmayı kurtarma" kartı; modelde karşılığı kayıttaki kartlardır (kartlar sartEditoru spec'inde). */
/** Satır 3, 4, 6 (üst çubuk: Şartı değiştir, Koşular, Hareketi azalt) tam ekran kabukta Ayrıntılar > Koşu ve Menü'dedir (`ayrintilarEslemesi.ts`), panelle birlikte aranmaz. Satır 5 tema düğmesidir ("Koyu tema" yalnız açık temada yazar): tema ekranları F2 spec'indedir. */
test.describe("şartı değiştir v2: editör kaplaması", () => {
  test("tüm satırlar", async ({ page }) => {
    await ac(page);
    await assertOyunParity(page, { screen: "live", editorOpen: true, editorDraft: true, group: 5, sel: "Geçiş desteği" }, { screen: "live", only: [{ from: 7, to: 27 }, { from: 42, to: 42 }, { from: 49, to: 51 }, { from: 69, to: 71 }, { from: 73, to: 83 }, { from: 85, to: 92 }] });
  });

  test("erişilebilirlik: değişiklik, not ve kapatma onayı açıkken", async ({ page }) => {
    await ac(page);
    const dlg = page.getByRole("dialog");
    // Kayıt kaynağında yalnız Geçiş desteği açıktır; öbür kartlar "Bu ayar kayıtlarda yok" ile kilitlidir.
    // Kurucunun ilk şablonu Geçiş desteği (destek açık, "kurtarma fonuyla"): değişiklik oluşması için "kapalı" seçilir.
    await dlg.getByRole("group", { name: "Geçiş desteği" }).getByRole("button", { name: "kapalı" }).click();
    await dlg.getByRole("textbox", { name: /Gerekçe/ }).fill("Vergi indirimi");
    await expect(dlg.getByText("Geçiş desteği: kurtarma fonuyla → kapalı").first()).toBeVisible();
    await expectNoA11yViolations(page);
    await dlg.getByRole("button", { name: "Değiştirmeden kapat" }).click();
    await expect(dlg.getByText("Yaptığın değişiklikler uygulanmadan atılacak.")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("kayıt kaynağında yalnız geçiş desteği açık, öbür kartlar kayıtlarda yok", async ({ page }) => {
    await ac(page);
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Vergiler/ }).click();
    const kart = dlg.getByRole("article", { name: "Ücret stopajı" });
    await expect(kart.getByRole("textbox")).toBeDisabled();
    await expect(kart.getByText("Bu ayar kayıtlarda yok").first()).toBeVisible();
  });
});
