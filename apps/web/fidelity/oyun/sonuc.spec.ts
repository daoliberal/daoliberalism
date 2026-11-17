import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { assertOyunParity } from "./oyun-parity";
import { ayrintilarAc, kosuKur, sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat();
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const sonucUrl = (port: number, id: string): string => `http://127.0.0.1:${port}/oyun/?kaynak=canli#/sonuc/${id}`;

/** Sunucunun açık koşu sınırı küçüktür (3): testler aynı koşuyu paylaşır, yalnız A/B ve önizleme ikinci koşuyu açar. */
let ilkKosu: string | null = null;

async function sonucAc(page: Page): Promise<string> {
  const id = ilkKosu ?? (await kosuKur(page, sunucu!.port));
  ilkKosu = id;
  await page.goto(sonucUrl(sunucu!.port, id));
  await waitForLayout(page);
  await expect(page.getByRole("heading", { name: /Ara durum: hafta \d+ \/ 200/ })).toBeVisible();
  return id;
}

/**
 * Sonuç ekranı (W10), gerçek sunucu (`--host-kind fake`) ile. Prototipin `result` ekranı (koşu başlatılmış durumda: `readerDraft` yaması
 * koşuyu kurar) 12-29. satırlardır; üst çubuk (1-10) kabuğa aittir. Başlık, hedef karnesi, 6 dünya, A/B ve paylaşım satırları.
 */
test.describe("sonuç ekranı", () => {
  test("prototip sadakati, erişilebilirlik ve yatay kaydırma yok", async ({ page }) => {
    await sonucAc(page);
    await assertOyunParity(page, { screen: "result", week: 4, readerDraft: true, runName: "Canlı Deneme", worldName: "Canlı Deneme" }, {
      screen: "result",
      only: [{ from: 12, to: 29 }],
    });
    // Özet satırı (prototip 14): sayaç yerleşik işletme batışlarını sayar (istisna gerekçesi exceptions/result.ts); satırın kendisi burada sınanır.
    await expect(page.getByText(/^Hafta \d+ itibarıyla talep karşılama %\d+, kümülatif \d+ yerleşik işletme batışı, kasa .+\. Koşu sürüyor\.$/)).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("aynı şartı 6 dünyada koş: ilerleme, altı çizgi, erişilebilirlik", async ({ page }) => {
    await sonucAc(page);
    await page.getByRole("button", { name: "6 dünyada koş" }).click();
    const bolum = page.getByRole("region", { name: "Aynı şartı 6 dünyada koş" });
    await expect(bolum.locator("[data-seri]")).toHaveCount(6, { timeout: 120_000 });
    await expect(bolum.getByText(/dünyanın .* tanesi .* haftaya kadar çöktü|dünyanın hiçbiri .* haftaya kadar çökmedi/)).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("A/B karşılaştırma: ikinci koşu seçilir, iki çizgi çizilir", async ({ page }) => {
    const id = await sonucAc(page);
    // İkinci bir koşu aç; ilk koşunun sonucuna dön.
    await kosuKur(page, sunucu!.port);
    await page.goto(sonucUrl(sunucu!.port, id));
    await waitForLayout(page);
    const ab = page.getByRole("region", { name: "A/B karşılaştırma" });
    await ab.getByRole("group", { name: "B koşusu" }).getByRole("button").first().click();
    await ab.getByRole("button", { name: "Karşılaştır" }).click();
    await expect(ab.locator("[data-seri]")).toHaveCount(2, { timeout: 120_000 });
    // İki koşu aynı şartla kuruldu: fark tablosu yok, bunu söyler.
    await expect(ab.getByText(/İki koşunun şartı aynı/)).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("şartı paylaş: kod görünür ve kopyala sonuç bildirir", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await sonucAc(page);
    const kod = page.getByRole("textbox", { name: "Şart kodu" });
    await expect(kod).toHaveValue(/^DAO1-[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    await page.getByRole("button", { name: "Kopyala" }).click();
    // Pano izni ortama bağlıdır: ya kopyalanır ya kod seçili hâlde elle kopyalama yönergesi çıkar; ikisi de açık bir sonuçtur.
    await expect(page.getByRole("button", { name: "Kopyalandı" }).or(page.getByText(/Panoya erişilemedi/))).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("etki önizlemesi: şartı değiştir panelinde iki gerçek koşu iki çizgi çizer", async ({ page }) => {
    await kosuKur(page, sunucu!.port);
    // Şartı değiştir Ayrıntılar > Koşu ve kararlar'dadır (masaüstünde sol Şart panelinde de; telefonda panel kabukta daralır).
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await panel.getByRole("group", { name: "Geçiş desteği" }).getByRole("button", { name: "kurtarma fonuyla" }).click();
    await panel.getByRole("button", { name: "Etki önizlemesini çalıştır" }).click();
    const sekil = panel.getByRole("figure").filter({ hasText: "52 haftalık önizleme" });
    await expect(sekil).toBeVisible({ timeout: 120_000 });
    await expect(sekil.locator("[data-seri]")).toHaveCount(2);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    // Aynı panelden şart uygulanır: sunucu sürüm takvimini (`versions`) yayımlar, paylaşım kodu takvimi taşır (W10 düzeltme 1, I1).
    await page.getByRole("button", { name: /^Uygula \(en erken/ }).click();
    await expect(page).toHaveURL(/#\/canli\//);
    // Ara durum / Sonuç artık Menü'dedir.
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("button", { name: /^(Ara durum|Sonuç)$/ }).click();
    const kod = page.getByRole("textbox", { name: "Şart kodu" });
    await expect(kod).toBeVisible();
    const yuk = JSON.parse(Buffer.from(((await kod.inputValue()).split(".")[0] ?? "").slice("DAO1-".length), "base64url").toString("utf-8")) as { schedule?: { week: number; patch: Record<string, unknown> }[] };
    expect(yuk.schedule).toHaveLength(1);
    expect(yuk.schedule![0]!.patch).toHaveProperty("gecis_destegi", "kurtarma_fonuyla");
    // Altı dünya düğmesi açıktır (şart değişmiş koşuda da tarif kurulabilir).
    await expect(page.getByRole("button", { name: "6 dünyada koş" })).toBeEnabled();
  });
});
