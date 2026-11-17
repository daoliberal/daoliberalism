import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { goruntuAl, sunucuBaslat, sunucuDurdur, temaUygula, type CanliSunucu } from "./canliSunucu";

/**
 * Tam ekran şehir: iki uçtan uca akış, GERÇEK model sunucusuyla (`gercek: true`).
 *  - DAO: ana sayfa -> DAO -> Başla -> hafta 0'da binalar -> ahırdan çık -> 1 hafta -> ilan -> başvur -> 1 hafta -> sonuç.
 *  - Kurucu: kur -> şehir -> şehir değiştir -> binaya tıkla -> işletme penceresi -> Ayrıntılar.
 * Her ana adımda dört görünüm (masaüstü 1440x900 / telefon 390x844 x açık / koyu): axe temiz, yatay kaydırma yok, tuval gerçekten çizilir.
 * `EKRAN_DIZINI` verilirse ekran görüntüleri `<ad>-<masaustu|telefon>-<acik|koyu>.png` olarak oraya yazılır.
 * Pixi için Chromium swiftshader ile başlar (playwright.config.ts).
 */
const EKRAN = process.env.EKRAN_DIZINI ?? "";
const MASAUSTU = { width: 1440, height: 900 };
const TELEFON = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-light", "görünümleri kendi içinde döner (masaüstü/telefon x açık/koyu)");
});

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat({ gercek: true });
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

/** Bu spec klasik (Sade) görünümü kapsar: `gorunum=klasik` bayrağı kalıcı sabit. İzo (varsayılan) kapsamı e2e/oyun/izoSehir.spec.ts (tuval hit-test, axe, varsayılan). */
const kok = (): string => `http://127.0.0.1:${sunucu!.port}/oyun/?kaynak=canli&gorunum=klasik`;

/** Tuval görünür ve gerçekten çizilmiş (tablo yedeği değil): tuvalin görüntüsü düz renk değil, yüzlerce KB'a yakın ayrıntı içerir. */
async function tuvalCizili(page: Page): Promise<void> {
  const tuval = page.locator("canvas").first();
  await expect(tuval).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    const png = await tuval.screenshot();
    expect(png.length, "tuval düz renk (çizilmemiş)").toBeGreaterThan(15_000);
  }).toPass({ timeout: 20_000 });
}

/** Dört görünümde (boyut x tema) denetim ve isteğe bağlı görüntü; çıkışta masaüstü + açık tema geri yüklenir. */
async function dortGorunum(page: Page, ad: string): Promise<void> {
  for (const [boyut, vp] of [["masaustu", MASAUSTU], ["telefon", TELEFON]] as const) {
    await page.setViewportSize(vp);
    await waitForLayout(page, boyut === "telefon" ? "narrow" : "wide");
    for (const tema of ["light", "dark"] as const) {
      await temaUygula(page, tema);
      await tuvalCizili(page);
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page, vp.width);
      if (EKRAN !== "") {
        fs.mkdirSync(EKRAN, { recursive: true });
        await goruntuAl(page, path.join(EKRAN, `${ad}-${boyut}-${tema === "light" ? "acik" : "koyu"}.png`), tema);
      }
    }
  }
  await page.setViewportSize(MASAUSTU);
  await waitForLayout(page, "wide");
  await temaUygula(page, "light");
}

/** Ana sayfa: giriş kabuğu (soluk zemin), axe ve yatay kaydırma; dört görünümde görüntü. */
async function tuvalYokAnaSayfa(page: Page): Promise<void> {
  for (const [boyut, vp] of [["masaustu", MASAUSTU], ["telefon", TELEFON]] as const) {
    await page.setViewportSize(vp);
    await waitForLayout(page, boyut === "telefon" ? "narrow" : "wide");
    for (const tema of ["light", "dark"] as const) {
      await temaUygula(page, tema);
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page, vp.width);
      if (EKRAN !== "") {
        fs.mkdirSync(EKRAN, { recursive: true });
        await goruntuAl(page, path.join(EKRAN, `ana-sayfa-${boyut}-${tema === "light" ? "acik" : "koyu"}.png`), tema);
      }
    }
  }
  await page.setViewportSize(MASAUSTU);
  await waitForLayout(page, "wide");
  await temaUygula(page, "light");
}

const tur = async (page: Page, n: number): Promise<void> => {
  const kontrol = page.getByRole("region", { name: "Oyun kontrolü" });
  const once = Number(/Hafta (\d+)/.exec((await kontrol.textContent()) ?? "")?.[1] ?? -1);
  await page.getByRole("button", { name: "1 hafta" }).click();
  await expect(kontrol.getByText(`Hafta ${once + n} / 520`)).toBeVisible({ timeout: 30_000 });
};

/** Ekonomi penceresi (DAO): Kurucu'nun Ayrıntılar'ı salt okunur. Pencere açıkken axe temiz, yatay kaydırma yok, koşu kontrolleri yok; görüntü `dao-ekonomi-*`. */
async function ekonomiPenceresi(page: Page): Promise<void> {
  const dugme = page.getByRole("button", { name: "Ekonomi", exact: true });
  await expect(dugme).toBeVisible();
  await dugme.click();
  const pencere = page.getByRole("dialog");
  await expect(pencere.getByRole("heading", { name: "Ekonomi" })).toBeVisible();
  await expect(pencere.getByRole("region", { name: "Göstergeler" })).toBeVisible();
  await expect(pencere.getByRole("tab", { name: "Koşu ve kararlar" })).toHaveCount(0);
  await expect(pencere.getByRole("button", { name: "Şartı değiştir" })).toHaveCount(0);
  const kaydet = async (ad: string, boyut: "masaustu" | "telefon", tema: "light" | "dark"): Promise<void> => {
    if (EKRAN === "") return;
    fs.mkdirSync(EKRAN, { recursive: true });
    await goruntuAl(page, path.join(EKRAN, `dao-ekonomi-${ad}-${boyut}-${tema === "light" ? "acik" : "koyu"}.png`), tema);
  };
  for (const [boyut, vp] of [["masaustu", MASAUSTU], ["telefon", TELEFON]] as const) {
    await page.setViewportSize(vp);
    await waitForLayout(page, boyut === "telefon" ? "narrow" : "wide");
    for (const tema of ["light", "dark"] as const) {
      await temaUygula(page, tema);
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page, vp.width);
      await kaydet("genel", boyut, tema);
    }
  }
  await page.setViewportSize(MASAUSTU);
  await waitForLayout(page, "wide");
  await temaUygula(page, "light");
  await pencere.getByRole("tab", { name: "Nüfus ve para" }).click();
  await expect(pencere.getByRole("region", { name: "Nüfus ve dağılım" })).toBeVisible();
  await kaydet("nufus", "masaustu", "light");
  await page.keyboard.press("Escape");
  await expect(pencere).toHaveCount(0);
}

/** Haritada, ızgara üzerinde tıklayıp ilk açılan bina/işletme panelini bulur (yerleşim koşuya göre değişir). */
async function binayaTikla(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Sığdır" }).click();
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  for (let y = kutu.y + 120; y < kutu.y + kutu.height - 120; y += 22) {
    for (let x = kutu.x + 380; x < kutu.x + kutu.width - 380; x += 22) {
      await page.mouse.click(x, y);
      const basliklar = await page.getByRole("complementary").evaluateAll((e) => e.map((a) => a.querySelector("h2")?.textContent?.trim() ?? ""));
      // Şart paneli her zaman açıktır; meydan açılırsa başlığı şehir adıdır; bina/işletme ise başka bir başlık gelir.
      const bina = basliklar.find((h) => h !== "" && h !== "Şart" && h !== "Ben" && !/^Şehir \d$/.test(h));
      if (bina !== undefined) return bina;
    }
  }
  throw new Error("hiçbir binaya tıklanamadı");
}

/** Ekonomi penceresi hafta 0'da: veri yokken "İlk hafta oynanınca dolar" notu görünür; axe temiz, görüntü `w2-dao-ekonomi-hafta0`. */
async function ekonomiHafta0(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Ekonomi", exact: true }).click();
  const pencere = page.getByRole("dialog");
  await expect(pencere.getByText("İlk hafta oynanınca dolar")).toBeVisible();
  await expectNoA11yViolations(page);
  if (EKRAN !== "") {
    fs.mkdirSync(EKRAN, { recursive: true });
    await goruntuAl(page, path.join(EKRAN, "w2-dao-ekonomi-hafta0-masaustu-acik.png"), "light");
  }
  await page.keyboard.press("Escape");
  await expect(pencere).toHaveCount(0);
}

/** Haritada ilan veren bir binaya tıklayıp "Başvur" düğmesi görünene dek ızgarada gezer (ilanı olan bina panelinde ilan kartı çıkar). */
async function ilanKartinaUlas(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sığdır" }).click();
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  const basvur = page.getByRole("button", { name: /^Başvur/ });
  for (let y = kutu.y + 100; y < kutu.y + kutu.height - 100 && !(await basvur.first().isVisible()); y += 30) {
    for (let x = kutu.x + 380; x < kutu.x + kutu.width - 380 && !(await basvur.first().isVisible()); x += 30) {
      await page.mouse.click(x, y);
      const sekme = page.getByRole("tab", { name: "İş ilanları" }); // şehir binası: ilanlar sekmesi
      if (await sekme.isVisible()) await sekme.click();
    }
  }
  await expect(basvur.first()).toBeVisible();
}

test("DAO: ahırdan çık, ilan, başvur, işe gir (ya da nedenli ret)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(MASAUSTU);
  await page.goto(`${kok()}#/`);
  await waitForLayout(page, "wide");
  await tuvalYokAnaSayfa(page);
  await page.getByRole("link", { name: /DAO/ }).or(page.getByRole("button", { name: /DAO/ })).first().click();
  await expect(page).toHaveURL(/#\/dao/);
  await waitForLayout(page, "wide");
  await expect(page.getByRole("heading", { name: "DAO oyunu" })).toBeVisible();
  await page.getByRole("button", { name: "Başla", exact: true }).click();

  // Hafta 0: binalar görünür (tuval çizili), Ben paneli ipucu verir.
  await expect(page.getByRole("region", { name: "Oyun kontrolü" }).getByText("Hafta 0 / 520")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Tamam" }).click();
  await tuvalCizili(page);
  await dortGorunum(page, "dao-sehir-hafta0");
  await ekonomiHafta0(page);

  // Ahıra bas, ahırdan çık.
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  const ahir = page.getByRole("complementary", { name: "Ahır" });
  for (let y = kutu.y + kutu.height * 0.35; y < kutu.y + kutu.height && !(await ahir.isVisible()); y += 40) {
    for (let x = kutu.x + kutu.width * 0.45; x < kutu.x + kutu.width * 0.95 && !(await ahir.isVisible()); x += 40) await page.mouse.click(x, y);
  }
  await expect(ahir).toBeVisible();
  await dortGorunum(page, "dao-sehir-ahir");
  await ahir.getByRole("button", { name: "Ahırdan çık, iş ara" }).click();
  await tur(page, 1);

  // İlan: Ben panelinden ilan sekmesi; kasası güçlü ilan varsa o, yoksa ilki.
  await page.getByRole("button", { name: "İş ilanlarına bak" }).click();
  const ilanlar = page.getByRole("button", { name: /^Başvur/ });
  await expect(ilanlar.first()).toBeVisible();
  await dortGorunum(page, "dao-sehir-ilan");
  const guclu = page.locator("section, div, li").filter({ hasText: /Kasa: güçlü/ }).getByRole("button", { name: /^Başvur/ });
  const hedef = (await guclu.count()) > 0 ? guclu.first() : ilanlar.first();
  await hedef.click();
  await tur(page, 1);

  // Sonuç: kabul (iş artık "işin yok" değil) ya da nedenli ret; ikisi de olay günlüğüne düşer.
  const olaylar = page.getByRole("log", { name: "Son olaylar" });
  await expect(olaylar).toContainText(/Başvurun kabul edildi|Başvurun kabul edilmedi|işten|İşten/, { timeout: 15_000 });
  await dortGorunum(page, "dao-sehir-sonuc");

  // Ben panelinde unvan ilerlemesi (çırak için kalfa şartları: tecrübe haftası ve itibar).
  await expect(page.getByRole("complementary", { name: "Ben" }).getByText(/^Kalfa olmak için( \(yaklaşık\))?: tecrübe \d+\/40 hafta, itibar [\d,]+\/4$/)).toBeVisible();
  await ekonomiPenceresi(page);

  // "Bir şey olana kadar": gerçek sunucu akışında oynatma bir olayda durur (sonsuza kadar koşmaz); durunca "1 hafta" yeniden basılabilir.
  await page.getByRole("button", { name: "Bir şey olana kadar" }).click();
  await expect(page.getByRole("button", { name: "1 hafta" })).toBeEnabled({ timeout: 90_000 });
});

/**
 * İş değiştirme: çalışan oyuncu başka bir ilana başvurur (eski işinden ayrılmadan). Sahte sunucuyla belirlenimli: gerçek modelde işe alım rekabetli
 * ve zayıf kasalı işletmeler ilk haftada işten çıkarabildiği için "çalışırken başvur" adımı gerçek koşuda güvenle kurulamaz.
 * Kart "alınırsan eski işinden ayrılıp geçersin; alınmazsan işin sürer" der; karar sıraya girince düğme "Sırada" olur; sonuç olay şeridine düşer.
 */
test("DAO: çalışırken iş değiştir (sahte sunucu): ilan metni, sırada, sonuç", async ({ page }) => {
  test.setTimeout(240_000);
  const sahte = await sunucuBaslat();
  try {
    await page.setViewportSize(MASAUSTU);
    await page.goto(`http://127.0.0.1:${sahte.port}/oyun/?kaynak=canli&gorunum=klasik#/dao`);
    await waitForLayout(page, "wide");
    await page.getByRole("button", { name: "Başla", exact: true }).click();
    await expect(page.getByRole("region", { name: "Oyun kontrolü" }).getByText("Hafta 0 / 520")).toBeVisible({ timeout: 30_000 });
    await tuvalCizili(page);
    await tur(page, 1);
    await tur(page, 1); // sahte oyuncu 2. haftada ahırdan çıkmış ve çalışıyor
    const ben = page.getByRole("complementary", { name: "Ben" });
    await expect(ben.getByText("Çalışıyor")).toBeVisible({ timeout: 15_000 });
    await expect(ben.getByText(/^Kalfa olmak için( \(yaklaşık\))?: tecrübe \d+\/40 hafta, itibar [\d,]+\/4$/)).toBeVisible();
    // Sahte oyuncu 2. haftadan beri çalışıyor ama kayıtlı bir işi yok: önce fk0'a başvurup (kabul) o işe girer, sonra başka işletmeye geçer.
    await ilanKartinaUlas(page);
    await page.locator('[data-ilan="fk0"]').getByRole("button", { name: /^Başvur/ }).click();
    await tur(page, 1);
    await ilanKartinaUlas(page);
    await expect(page.getByText("Başvurursan ve alınırsan eski işinden ayrılıp buna geçersin; alınmazsan işin sürer.").first()).toBeVisible();
    await dortGorunum(page, "w2-dao-is-degistir-ilan");
    // Kendi işvereni olmayan ilana başvur (şimdi fk0'da çalışır, fk1 başka bir işletmedir).
    await page.locator('[data-ilan="fk1"]').getByRole("button", { name: /^Başvur/ }).click();
    await expect(page.getByText(/^Başvurun sırada: \d+\. haftada\.$/).first()).toBeVisible();
    for (const b of await page.getByRole("button", { name: /^Başvur/ }).all()) await expect(b).toBeDisabled();
    await dortGorunum(page, "w2-dao-is-degistir-sirada");
    await tur(page, 1);
    await expect(page.getByRole("log", { name: "Son olaylar" })).toContainText(/İş değiştirdin/, { timeout: 15_000 });
    await dortGorunum(page, "w2-dao-is-degistir-sonuc");
  } finally {
    await sunucuDurdur(sahte);
  }
});

test("Kurucu: kur, şehir, şehir değiştir, binaya tıkla, işletme penceresi, Ayrıntılar", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(MASAUSTU);
  await page.goto(`${kok()}#/kurucu`);
  await waitForLayout(page, "wide");
  await page.getByLabel("Dünya adı").fill("Tam ekran deneme");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Tek hafta" }).click();
  await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 1 / 200")).toBeVisible({ timeout: 30_000 });
  await tuvalCizili(page);
  await dortGorunum(page, "kurucu-sehir");

  // Şehir değiştir.
  await page.getByRole("button", { name: /^Şehir: / }).click();
  await page.getByRole("option", { name: /^Şehir 2/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Şehir 2" })).toBeVisible();
  await tuvalCizili(page);
  await dortGorunum(page, "kurucu-sehir-2");

  // Binaya tıkla: işletme penceresi.
  const ad = await binayaTikla(page);
  expect(ad.length).toBeGreaterThan(0);
  await expect(page.getByRole("complementary").last().getByRole("heading", { level: 2, name: ad })).toBeVisible();
  await dortGorunum(page, "kurucu-isletme");

  // Ayrıntılar.
  await page.getByRole("button", { name: "Ayrıntılar" }).click();
  const pencere = page.getByRole("dialog");
  await expect(pencere.getByRole("heading", { name: "Ayrıntılar" })).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page, MASAUSTU.width);
  if (EKRAN !== "") {
    fs.mkdirSync(EKRAN, { recursive: true });
    await goruntuAl(page, path.join(EKRAN, "kurucu-ayrintilar-masaustu-acik.png"), "light");
  }
  await page.keyboard.press("Escape");
  await expect(pencere).toHaveCount(0);
});
