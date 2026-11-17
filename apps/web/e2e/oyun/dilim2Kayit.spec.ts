import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp, isProject, waitForLayout } from "../../fidelity/helpers";

/**
 * Dilim 2 kayıt kaynağında (`?kaynak=kayit`, sunucusuz, varsayılan): E1 senaryosunun kayıtta mümkün olanı. Kayıtlarda yalnız geçiş desteği değişir;
 * öbür kurallar "Bu ayar kayıtlarda yok" der, dünya senaryosu ve hedefler nedenli kilitlidir, şehir ve zincir görünümleri nedenli kapalıdır.
 * MVP uçtan uca (`mvp.spec.ts`) aynen durur.
 */
const saat = (page: Page) => page.getByRole("region", { name: "Oynatma denetimi" });
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function temiz(page: Page, info: TestInfo): Promise<void> {
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page, isProject(info, "mobile-dark") ? 390 : 1280);
}
function konsolIzle(page: Page): string[] {
  const kotu: string[] = [];
  page.on("console", (m) => {
    // Başsız Chromium'da yazılım GL (swiftshader) Pixi tuvali için kendi performans uyarısını yazar; uygulama hatası değildir.
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "warning" && /^The resource \S+ was preloaded using link preload but not used within a few seconds/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") kotu.push(`${m.type()}: ${m.text()} @ ${m.location().url}`);
  });
  page.on("pageerror", (e) => kotu.push(`pageerror: ${e.message}`));
  return kotu;
}
async function kartaGit(ed: ReturnType<Page["getByRole"]>, baslik: string) {
  await ed.getByRole("searchbox", { name: "Ara" }).fill(baslik);
  await ed.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: new RegExp(`^${esc(baslik)}`) }).first().click();
  const kart = ed.getByRole("article", { name: baslik, exact: true });
  await expect(kart).toBeVisible();
  return kart;
}

test.describe("Dilim 2 kayıt kaynağı", () => {
  test("Başlangıç, Kurucu (kilitler nedenli), oynatma, geçiş desteği değişikliği, okuyucu, sonuç, koşular, yenile", async ({ page }, info) => {
    test.setTimeout(180_000);
    const konsol = konsolIzle(page);
    await gotoApp(page, "/oyun/");
    await expect(page.getByRole("heading", { level: 1, name: "daoliberalism" })).toBeVisible();
    await temiz(page, info);
    await page.getByRole("button", { name: "Kurucu olarak başla →" }).click();
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();

    // adlar: rastgele isim iki kez, bir şehir elle
    const adlar = async (): Promise<string> => [await page.getByLabel("Dünya adı").inputValue(), ...(await Promise.all([1, 2, 3, 4, 5].map((n) => page.getByLabel(`Şehir ${n} adı`).inputValue())))].join("|");
    await page.getByRole("button", { name: "Rastgele isim" }).click();
    const ilk = await adlar();
    let ikinci = ilk;
    for (let i = 0; i < 6 && ikinci === ilk; i += 1) {
      await page.getByRole("button", { name: "Rastgele isim" }).click();
      ikinci = await adlar();
    }
    expect(ikinci).not.toBe(ilk);
    await page.getByLabel("Şehir 2 adı").fill("Gümüşkent");
    const dunyaAdi = await page.getByLabel("Dünya adı").inputValue();
    await temiz(page, info);

    await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
    await page.getByRole("button", { name: "Dayanıklı taban" }).click();
    await page.getByRole("button", { name: "Devam: Şartı yaz" }).click();
    const ed = page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" });

    // Kayıtta olmayan kurallar: hepsi kilitli, nedeni klavyeyle okunur
    const ucret = await kartaGit(ed, "Ücret stopajı");
    await expect(ucret.getByRole("textbox")).toBeDisabled();
    await expect(ucret.getByRole("textbox")).toHaveAccessibleDescription(/Bu ayar kayıtlarda yok/);
    const kopru = await kartaGit(ed, "Yerleşik firmalara köprü kredisi");
    await expect(kopru.getByRole("group", { name: "Köprü kredisi" }).getByRole("button", { name: "kapalı", exact: true })).toBeDisabled();
    const butce = await kartaGit(ed, "Basım izninden tam pay alan giderler");
    for (const b of await butce.getByRole("button", { name: /: iznin (yarısına indir|tamamına al)$/ }).all()) await expect(b).toBeDisabled();
    const kasa = await kartaGit(ed, "Şehir kasası kuralı");
    await expect(kasa.getByRole("button", { name: "açık", exact: true })).toBeDisabled();
    // Geçiş desteği: kayıtta değişen tek kural
    const gecis = await kartaGit(ed, "Geçiş desteği");
    await gecis.getByRole("button", { name: "kısa süreli" }).click();
    await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 1$/)).toBeVisible();
    await temiz(page, info);

    // B: senaryo seçilemez; faize duyarlı davranış kilitli. C: başlangıç piyasası
    await ed.getByRole("tab", { name: /B\. Dünyanın insanları/ }).click();
    await expect(ed.getByRole("button", { name: "Bu dünyayı değiştir (dünya senaryosu)" })).toBeDisabled();
    await expect(ed.getByText("Kayıtlarda yalnız gerçekçi dünya var: dünya senaryosu seçilemez.")).toBeVisible();
    await temiz(page, info);
    await ed.getByRole("tab", { name: /C\. Piyasa/ }).click();
    await expect(ed.getByRole("table", { name: "Piyasa göstergeleri" }).getByText("Koşu başlayınca görünür").first()).toBeVisible();
    await temiz(page, info);

    // süre ve hedefler: kayıtta hedef izlenmez
    await page.getByRole("button", { name: "Devam: Süre ve hedefler" }).click();
    await expect(page.getByRole("button", { name: "100 hafta" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Servet Gini ≤ 0,8" })).toBeDisabled();
    await expect(page.getByText("Kayıtlarda hedef izlenmez.")).toBeVisible();
    await page.getByRole("button", { name: "Dünya 3" }).click();
    await expect(page.getByRole("button", { name: "Dünya 3" })).toHaveAttribute("aria-pressed", "true");
    await temiz(page, info);
    await page.getByRole("button", { name: "Devam: Özet" }).click();
    await expect(page.getByRole("region", { name: "Kurulum" }).getByText("Gerçekçi (Şart'a girmez)")).toBeVisible();
    await temiz(page, info);
    await page.getByRole("button", { name: "Başlat", exact: true }).click();
    await expect(saat(page).getByText("Hafta 0 / 200")).toBeVisible();
    await expect(saat(page).getByText(dunyaAdi)).toBeAttached();

    // Şehir kırılımı ve zincir bu kayıtta yok: Ayrıntılar'da şehir kapsamı seçicisi yok, bina verisi notu; Zincir sekmesi nedenli kilitli
    await expect(page.getByText("Bina verisi bu kaynakta yok.")).toBeAttached();
    await expect((await ayrintilarAc(page, "Genel")).getByRole("group", { name: "Kapsam" })).toHaveCount(0);
    const pencere = await ayrintilarAc(page, "Zincir");
    await expect(pencere.getByText("Bu kayıtta zincir bilgisi yok")).toBeVisible();
    await temiz(page, info);
    await ayrintilarAc(page, "Olaylar").then((p) => expect(p.getByRole("region", { name: "Ne olmuyor" })).toBeVisible());
    await page.keyboard.press("Escape");

    // oynatma: tek hafta ×3, şartı değiştir (geçiş desteği), dikiş
    for (let i = 1; i <= 3; i += 1) {
      await page.getByRole("button", { name: "Tek hafta" }).click();
      await expect(saat(page).getByText(`Hafta ${i} / 200`)).toBeVisible();
    }
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
    await panel.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await panel.getByRole("button", { name: "kurtarma fonuyla" }).click();
    // kayıtta olmayan canlı kural da nedenli kilitli
    await panel.getByRole("searchbox", { name: "Ara" }).fill("Ücret stopajı");
    await panel.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: /^Ücret stopajı/ }).first().click();
    await expect(panel.getByRole("article", { name: "Ücret stopajı", exact: true }).getByRole("textbox")).toBeDisabled();
    await temiz(page, info);
    await page.getByRole("button", { name: /Gelecek haftadan uygula/ }).click();
    await expect(page.getByText("3. haftadan sonrası seçilen kuralla kayıtlıdır")).toBeVisible({ timeout: 30_000 });
    await expect(saat(page).getByText("v2")).toBeAttached();

    // okuyucu: v1 → v2 farkı geçiş desteğidir
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şart", exact: true }).click();
    const okuyucu = page.getByRole("dialog", { name: /Ekonomi Şartı/ });
    await okuyucu.getByRole("button", { name: "v2", exact: true }).click();
    await okuyucu.getByRole("button", { name: /^v1 → v2 farkı$/ }).click();
    await expect(okuyucu.getByRole("listitem").filter({ hasText: "Geçiş desteği" })).toBeVisible();
    await temiz(page, info);
    await page.keyboard.press("Escape");

    // sonuç: karne, altı dünya (kayıttan), A/B yalnız canlıda, paylaşım kodu takvimi taşır
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("group", { name: "Ana menü" }).getByRole("button", { name: /^(Ara durum|Sonuç)$/ }).click();
    await expect(page.getByRole("heading", { name: /^Ara durum: hafta \d+ \/ 200$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Şart hedefleri karnesi" })).toBeVisible();
    await temiz(page, info);
    const kod = page.getByRole("textbox", { name: "Şart kodu" });
    await expect(kod).toHaveValue(/^DAO1-/);
    const yuk = JSON.parse(Buffer.from(((await kod.inputValue()).split(".")[0] ?? "").slice("DAO1-".length), "base64url").toString("utf-8")) as { schedule?: unknown[] };
    expect(yuk.schedule).toHaveLength(1);
    await expect(page.getByText("Karşılaştırma yalnız canlı modelde var; kayıttan oynatılan koşuda kapalı.")).toBeVisible();
    await page.getByRole("button", { name: "6 dünyada koş" }).click();
    const dunya6 = page.getByRole("region", { name: "Aynı şartı 6 dünyada koş" });
    await expect(dunya6.locator("[data-seri]")).toHaveCount(6, { timeout: 60_000 });
    await expect(dunya6.getByText("Kayıttan: altı dünya kayıtlı koşulardan okunur, yeniden hesaplanmaz.")).toBeVisible();
    await temiz(page, info);

    // koşular: kayıt (replay) kaynağı koşuları kütüphaneye yazılmaz (D3); Kaydet düğmesi yok, boş durum görünür
    // Sonuç sayfası kendi üst çubuğunu taşır (şehir kabuğunda çubuk yok).
    await page.getByRole("banner").getByRole("button", { name: "Koşular", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Koşular", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Açık koşular" }).getByRole("button", { name: /^Kaydet: / })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Kaydedilmiş koşular" })).toBeVisible();
    await expect(page.getByText(/^Kaydedilmiş koşu yok/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Kayıtlı koşular" })).toHaveCount(0);
    await temiz(page, info);

    // yenile: kütüphane hâlâ boş
    await page.reload();
    await waitForLayout(page);
    await expect(page.getByText(/^Kaydedilmiş koşu yok/)).toBeVisible();
    await temiz(page, info);
    expect(konsol).toEqual([]);
  });
});
