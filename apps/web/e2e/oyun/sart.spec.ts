import { expect, test } from "@playwright/test";
import { gotoApp } from "../../fidelity/helpers";

type Kart = { id: string; title: string; kind: string; layer: string; apply: string; editable: boolean; status: string };

/** Yayımlanan kayıttan çalışma anında seçilir: kart adı ve sınıf sayıları R2 ölçümüyle değişse de test kararlı kalır. */
async function kayittanKart(request: import("@playwright/test").APIRequestContext, apply: "live" | "start_only"): Promise<Kart> {
  const res = await request.get("/oyun-kayit/registry.json");
  const { cards } = (await res.json()) as { cards: Kart[] };
  const kart = cards.find((c) => c.layer === "P" && c.kind === "number" && c.editable && c.status === "active" && c.apply === apply && c.id !== "gecis_destegi");
  if (!kart) throw new Error(`kayıtta ${apply} sayı kartı yok`);
  return kart;
}

/** W4: Şart editörü Kurucu'da; kayıt kaynağında yalnız Geçiş desteği değişir, öbür kurallar nedenle kilitlidir. unknown yolu birim testinde (sartEditoru.test.tsx). */
test.describe("oyun Şart editörü uçtan uca", () => {
  test("ara, değiştir, şeritte gör, başlat", async ({ page }) => {
    await gotoApp(page, "/oyun/#/kurucu");
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await page.getByLabel("Dünya adı").fill("Deneme");
    for (const [i, ad] of ["Akçe", "Bora", "Ceren", "Derya", "Elif"].entries()) await page.getByLabel(`Şehir ${i + 1} adı`).fill(ad);
    await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
    await page.getByRole("button", { name: "Dayanıklı taban" }).click();
    await page.getByRole("button", { name: "Devam: Şartı yaz" }).click();

    const editor = page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" });
    await expect(editor.getByText(/^Kurallar: \d+ · değiştirdiğin: 0$/)).toBeVisible();
    await expect(editor.getByText("Henüz değişiklik yok.")).toBeVisible();

    // kayıtta olmayan kural (gerçek bir live ve gerçek bir start_only kart) kilitli ve nedeni klavyeyle okunur
    for (const apply of ["live", "start_only"] as const) {
      const secilen = await kayittanKart(page.request, apply);
      await editor.getByRole("searchbox", { name: "Ara" }).fill(secilen.title);
      await editor.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: new RegExp(secilen.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
      const kilitli = editor.getByRole("article", { name: secilen.title, exact: true });
      await expect(kilitli.getByRole("textbox")).toBeDisabled();
      await expect(kilitli.getByRole("textbox")).toHaveAccessibleDescription(/Bu ayar kayıtlarda yok/);
    }

    await editor.getByRole("searchbox", { name: "Ara" }).fill("geçiş");
    await editor.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: /Geçiş desteği/ }).click();
    const kart = editor.getByRole("article", { name: "Geçiş desteği" });
    await kart.getByRole("button", { name: "kısa süreli" }).click();
    await expect(editor.getByText(/^Kurallar: \d+ · değiştirdiğin: 1$/)).toBeVisible();
    await expect(editor.getByRole("list", { name: "Değiştirdiğin kurallar" }).getByRole("button", { name: /Geçiş desteği: kapalı → kısa süreli/ })).toBeVisible();

    await page.getByRole("button", { name: "Başlat", exact: true }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(/Hafta 0 \/ 200/)).toBeVisible();
  });
});
