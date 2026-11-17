import { expect, test, type Page } from "@playwright/test";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp, isProject } from "../../fidelity/helpers";

const WEEK = /Hafta (\d+) \/ 200/;

async function week(page: Page): Promise<number> {
  const text = (await page.getByRole("region", { name: "Oynatma denetimi" }).getByText(WEEK).first().textContent()) ?? "";
  return Number(WEEK.exec(text)?.[1] ?? NaN);
}

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => {
    // Tarayıcının "link preload kullanılmadı" uyarısı Next'in çıktı CSS'iyle sitenin her sayfasında, yalnız sayfa birkaç saniye açık kalınca çıkar; oyunla ilgisi yoktur.
    // Başsız Chromium'da yazılım GL (swiftshader) Pixi tuvali için kendi performans uyarısını yazar; uygulama hatası değildir.
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "warning" && /^The resource \S+ was preloaded using link preload but not used within a few seconds/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") bad.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
}

async function kur(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu");
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  await page.getByLabel("Dünya adı").fill("Deneme Dünyası");
  for (const [i, ad] of ["Akçe", "Bora", "Ceren", "Derya", "Elif"].entries()) {
    await page.getByLabel(`Şehir ${i + 1} adı`).fill(ad);
  }
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Devam: Şartı yaz" }).click();
  // W7: Başlangıç dünyası Şartı yaz'dan Süre ve hedefler adımına taşındı.
  await page.getByRole("button", { name: "Devam: Süre ve hedefler" }).click();
  await page.getByRole("button", { name: "Dünya 6" }).click();
  await expect(page.getByRole("button", { name: "Dünya 6" })).toHaveAttribute("aria-pressed", "true");
}

test.describe("oyun MVP uçtan uca", () => {
  test("kurucu, canlı akış, şart değişikliği, yenileme", async ({ page }, testInfo) => {
    const konsol = watchConsole(page);
    await page.clock.install();
    await kur(page);

    if (isProject(testInfo, "mobile-dark")) {
      await expectNoHorizontalScroll(page, 390);
      await page.getByRole("button", { name: "Başlat" }).click();
      await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
      await expectNoHorizontalScroll(page, 390);
      expect(konsol).toEqual([]);
      return;
    }

    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, 1280);
    await page.getByRole("button", { name: "Başlat" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    await expect(page.getByText("v1", { exact: true }).first()).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, 1280);
    const hash = new URL(page.url()).hash;
    expect(hash).toMatch(/^#\/canli\//);

    // 8 kez "Tek hafta"
    for (let i = 1; i <= 8; i += 1) {
      await page.getByRole("button", { name: "Tek hafta" }).click();
      await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(`Hafta ${i} / 200`)).toBeVisible();
    }

    // Şartı değiştir tam hafta 8'de: kurtarma kaydının yüklenmesi tutulur, "yükleniyor" bandı belirlenimli görünür.
    let birak: () => void = () => {};
    const tutulan = new Promise<void>((r) => {
      birak = r;
    });
    await page.route("**/oyun-kayit/kurtarma/**", async (route) => {
      await tutulan;
      await route.continue();
    });
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    await expect(page.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
    await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "kurtarma fonuyla" }).click();
    await page.getByRole("button", { name: /Gelecek haftadan uygula/ }).click();
    await expect(page.getByText("En yakın kayıtlı senaryo yükleniyor")).toBeVisible();
    birak();
    await expect(page.getByText("En yakın kayıtlı senaryo yükleniyor")).toHaveCount(0);
    const dikisYazi = "8. haftadan sonrası seçilen kuralla kayıtlıdır";
    await expect(page.getByText(dikisYazi)).toBeVisible();
    await expect(page.getByText("v2", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 8 / 200")).toBeVisible();
    await expectNoA11yViolations(page);
    await expect.poll(() => new URL(page.url()).hash).not.toBe(hash);
    const yeniHash = new URL(page.url()).hash;
    expect(yeniHash).toMatch(/^#\/canli\//);

    // Hız yalnız hızı ayarlar: duraklatıkken oynatmaz.
    await page.getByRole("button", { name: "4×" }).click();
    await expect(page.getByRole("button", { name: "4×" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 8 / 200")).toBeVisible();
    await page.getByRole("button", { name: "1×" }).click();

    // Oynat (1x) -> sayaç artar -> Duraklat -> sayaç sabit (sahte saatle beş hafta süresi geçirilip ikinci okuma)
    await page.getByRole("button", { name: "Oynat" }).click();
    await expect(page.getByRole("button", { name: "Duraklat" })).toBeVisible();
    await expect.poll(() => week(page)).toBeGreaterThan(8);
    await page.getByRole("button", { name: "Duraklat" }).click();
    await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
    const a = await week(page);
    // Sahte saat: duraklatılmış koşuda 1× hızda beş hafta süresi (600 ms/hafta) geçirilir; sayaç değişmemeli.
    await page.clock.runFor(3000);
    expect(await week(page)).toBe(a);

    // Devam: 4x, dikiş + 5
    await page.getByRole("button", { name: "4×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    await expect.poll(() => week(page)).toBeGreaterThanOrEqual(13);
    await page.getByRole("button", { name: "Duraklat" }).click();
    const olaylar = await ayrintilarAc(page, "Olaylar");
    await expect(olaylar.getByText("Henüz olay yok. Oynat'a bas.")).toHaveCount(0);
    await expect(olaylar.getByRole("heading", { name: "Olay akışı" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Yenileme: aynı hash, hafta 0, duraklatılmış, v1; dikişe varılınca v2 ve dikiş bandı yeniden üretilir
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${yeniHash.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
    await expect(page.getByText("v1", { exact: true }).first()).toBeVisible();
    for (let i = 1; i <= 8; i += 1) {
      await page.getByRole("button", { name: "Tek hafta" }).click();
      await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(`Hafta ${i} / 200`)).toBeVisible();
    }
    await expect(page.getByText(dikisYazi)).toHaveCount(0);
    await page.getByRole("button", { name: "Tek hafta" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 9 / 200")).toBeVisible();
    await expect(page.getByText(dikisYazi)).toBeVisible();
    await expect(page.getByText("v2", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Şart değişti, 8. haftadan sonrası yeni kuralla")).toBeVisible();
    const zaman = await ayrintilarAc(page, "Zaman çizgisi");
    await expect(zaman.getByText("v1 · hafta 0–8")).toBeVisible();
    await expect(zaman.getByText("v2 · hafta 8–9")).toBeVisible();
    await page.keyboard.press("Escape");

    // bozuk hash
    await page.goto("/oyun/#/canli/çöp");
    await expect(page.getByText("Bu koşu kurulamadı")).toBeVisible();

    expect(konsol).toEqual([]);
  });
});
