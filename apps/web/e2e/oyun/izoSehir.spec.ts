import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../../fidelity/helpers";
import { sunucuBaslat, sunucuDurdur, type CanliSunucu } from "../../fidelity/oyun/canliSunucu";

/**
 * İzometrik şehir duman testi (`?gorunum=izo`), GERÇEK model sunucusuyla (`gercek: true`): DAO ve Kurucu, birkaç hafta,
 * sprite istekleri, kademeli yedekler, hareket azaltma, mobil dokunma ve axe. Sunucu bu dosyanın kendisidir: boş bir kapıda
 * (8795-8799) başlar, iş bitince kapanır; sahibin oynadığı sunucuya dokunulmaz. Pixi için Chromium swiftshader ile başlar.
 */
const KAPILAR = [8795, 8796, 8797, 8798, 8799];

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  let son: unknown = null;
  for (const port of KAPILAR) {
    try {
      sunucu = await sunucuBaslat({ gercek: true, port });
      return;
    } catch (e) {
      son = e; // kapı dolu (başka paralel koşu): sıradakini dene
    }
  }
  throw new Error(`boş kapı yok (${KAPILAR.join(", ")}): ${String(son)}`);
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

/** Her test kendi koşusunu açar; sunucunun açık koşu sınırı dolmasın diye test bitince bu sunucudaki koşular silinir. */
test.afterEach(async ({ request }) => {
  const taban = `http://127.0.0.1:${sunucu!.port}`;
  const liste = await request.get(`${taban}/api/runs`).then((r) => r.json()).catch(() => []);
  for (const k of Array.isArray(liste) ? liste : []) {
    const id = (k as { runId?: string }).runId;
    if (typeof id === "string") await request.delete(`${taban}/api/runs/${id}`, { headers: { Origin: taban, "X-Oyun-Istek": "1" } }).catch(() => undefined);
  }
});

const MENU_ADI = "Menü";
const kok = (bayrak = "izo"): string => `http://127.0.0.1:${sunucu!.port}/oyun/?kaynak=canli&gorunum=${bayrak}`;

/** Sayfanın konsol hatalarını ve yakalanmamış istisnaları toplar (bilinçli 404 testleri `izin` ile süzer). */
function hataDinle(page: Page, izin: RegExp | null = null): () => string[] {
  const hatalar: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !(izin && izin.test(m.text()))) hatalar.push(m.text());
  });
  page.on("pageerror", (e) => hatalar.push(String(e)));
  return () => hatalar;
}

/** Sprite isteklerini (yanıt kodlarıyla) toplar. */
function spriteDinle(page: Page): () => { url: string; durum: number }[] {
  const liste: { url: string; durum: number }[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/oyun-sprite/")) liste.push({ url: r.url(), durum: r.status() });
  });
  return () => liste;
}

const tur = async (page: Page, dugme: string, kontrol: string, onEk: string, n: number): Promise<void> => {
  const bolge = page.getByRole("region", { name: kontrol });
  const once = Number(new RegExp(`${onEk} (\\d+)`).exec((await bolge.textContent()) ?? "")?.[1] ?? -1);
  await page.getByRole("button", { name: dugme }).click();
  await expect(bolge.getByText(new RegExp(`${onEk} ${once + n} /`))).toBeVisible({ timeout: 30_000 });
};

async function kurucuBaslat(page: Page, bayrak = "izo", hafta = 2): Promise<void> {
  await page.goto(`${kok(bayrak)}#/kurucu`);
  await waitForLayout(page);
  await page.getByLabel("Dünya adı").fill("İzo duman");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 90_000 });
  for (let i = 1; i <= hafta; i++) await tur(page, "Tek hafta", "Oynatma denetimi", "Hafta", 1);
}

async function daoBaslat(page: Page, bayrak = "izo"): Promise<void> {
  await page.goto(`${kok(bayrak)}#/dao`);
  await waitForLayout(page);
  await page.getByRole("button", { name: "Başla", exact: true }).click();
  await expect(page.getByRole("region", { name: "Oyun kontrolü" }).getByText("Hafta 0 / 520")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Tamam" }).click();
}

/** Tuvalin (sayfa görüntüsünden) arka plan renginden farklı piksel oranı; arka plan = en sık görülen renk. Yazılım GL'de WebGL okuması güvenilmez, bu yüzden görüntüden. */
async function farkliOran(page: Page): Promise<number> {
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const sayac = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      const k = ((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3);
      sayac.set(k, (sayac.get(k) ?? 0) + 1);
    }
    let enCok = 0;
    for (const v of sayac.values()) enCok = Math.max(enCok, v);
    return 1 - enCok / (d.length / 4);
  }, png.toString("base64"));
}

async function tuvalCizili(page: Page): Promise<void> {
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    expect(await farkliOran(page), "tuval arka plandan farklı piksel oranı").toBeGreaterThan(0.05);
  }).toPass({ timeout: 30_000 });
}

/** İzo modun gerçekten açıldığı: kurum satırı tabloda vardır (klasikte de, 682db95) ve düşme notu yoktur. */
async function izoAcik(page: Page): Promise<void> {
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText("Şehir görünümü yüklenemedi")).toHaveCount(0);
}

/** Tablo, oyun kabuğunda tuvalin üstünde yüzen bir panel olarak klavye odağıyla açılır (fare tıklaması tuvale gider). */
async function tabloAc(page: Page): Promise<void> {
  const ozet = page.locator("summary", { hasText: "Şehir haritası (tablo)" });
  await ozet.focus();
  const acik = await page.locator("details", { has: ozet }).evaluate((d) => (d as HTMLDetailsElement).open);
  if (!acik) await page.keyboard.press("Enter");
  await expect(page.locator("details", { has: ozet })).toHaveJSProperty("open", true);
}

const tuvalPng = (page: Page): Promise<Buffer> => page.locator("canvas").first().screenshot();

test("izo_tuvali_cizilir (Kurucu: birkaç hafta, konsol temiz)", async ({ page }) => {
  test.setTimeout(240_000);
  const hatalar = hataDinle(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await kurucuBaslat(page);
  await izoAcik(page);
  await tuvalCizili(page);
  await expectNoHorizontalScroll(page, 1280);
  expect(hatalar(), "konsol hataları").toEqual([]);
});

test("varsayilan_izo_bayraksiz_ve_sade_menuden_secilir (K3)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await kurucuBaslat(page, "", 1);                       // `?gorunum=` boş: bayrak yok, tercih yok
  await izoAcik(page);                                   // izo sahne: kurum satırları var
  await tuvalCizili(page);
  const menu = page.getByRole("button", { name: MENU_ADI, exact: true });
  await menu.click();
  await page.getByRole("button", { name: "Görünüm: Şehir (yeni)" }).click();   // belirtilmemiş tercih = Şehir
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1, { timeout: 30_000 });   // Sade: klasik sahne (kurum satırı klasikte de listelenir, 682db95)
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await expect(page.getByRole("button", { name: "Görünüm: Sade (eski)" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("gorunum_klasik_bayragi_kalici_klasik", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await kurucuBaslat(page, "klasik", 1);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1);
});

test("sprite_istekleri_200_404_yok", async ({ page }) => {
  test.setTimeout(240_000);
  // Hafta 0'da DAO gözlemi yoktur: sunucu `/dao` için bilerek 409 `hazirlaniyor` döner (tarayıcı bunu konsola yazar); yalnız bu kabul edilir.
  const hatalar = hataDinle(page, /status of 409/);
  const sprite = spriteDinle(page);
  const diger: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/oyun-sprite/") && !(r.status() === 409 && r.url().endsWith("/dao"))) diger.push(`${r.status()} ${r.url()}`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoBaslat(page);
  await izoAcik(page);
  await tuvalCizili(page);
  await tur(page, "1 hafta", "Oyun kontrolü", "Hafta", 1);
  await tur(page, "1 hafta", "Oyun kontrolü", "Hafta", 1);
  await tuvalCizili(page);
  expect(diger, "beklenmeyen hata yanıtları").toEqual([]);
  const l = sprite();
  expect(l.some((x) => x.url.endsWith("/oyun-sprite/manifest.json")), "manifest istendi").toBe(true);
  expect(l.filter((x) => x.url.endsWith(".png")).length, "sprite PNG istendi").toBeGreaterThan(5);
  expect(l.filter((x) => x.durum >= 400), "hata kodlu sprite istekleri").toEqual([]);
  expect(hatalar(), "konsol hataları").toEqual([]);
});

/** Tuvalde ızgara taraması: tıklama sonrası `bulundu` doğru dönene dek gezer (tuval hit-testi gerçekten sınanır). */
async function tuvaldeTara(page: Page, bulundu: () => Promise<boolean>): Promise<boolean> {
  await page.getByRole("button", { name: "Sığdır" }).click();
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  for (let y = kutu.y + 120; y < kutu.y + kutu.height - 120; y += 34) {
    for (let x = kutu.x + 380; x < kutu.x + kutu.width - 380; x += 34) {
      await page.mouse.click(x, y);
      if (await bulundu()) return true;
    }
  }
  return false;
}

const binaBasligi = async (page: Page): Promise<string | undefined> => {
  const hepsi = await page.getByRole("complementary").evaluateAll((e) => e.map((a) => a.querySelector("h2")?.textContent?.trim() ?? ""));
  return hepsi.find((h) => h !== "" && h !== "Şart" && h !== "Ben" && !/^Şehir \d$/.test(h));
};

test("bina_tiklaninca_cekmece_acilir (tuval hit-testi)", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await kurucuBaslat(page, "izo", 3);
  await izoAcik(page);
  await tuvalCizili(page);
  const bulundu = await tuvaldeTara(page, async () => (await binaBasligi(page)) !== undefined);
  info.annotations.push({ type: "yol", description: bulundu ? "tuval" : "tuval-basarisiz" });
  expect(bulundu, "tuvalde hiçbir binaya tıklanamadı (hit-test)").toBe(true);
  const ad = (await binaBasligi(page))!;
  await expect(page.getByRole("complementary").last().getByRole("heading", { level: 2, name: ad })).toBeVisible();
});

test("tablo_dugmesiyle_bina_secimi_yedegi", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await kurucuBaslat(page, "izo", 2);
  await izoAcik(page);
  await tabloAc(page);
  await page.locator('[data-kurum="liman"] button').click();
  await expect(page.getByRole("complementary").filter({ hasText: /Liman/ }).first()).toBeVisible();
});

test("bos_parsele_tiklayip_isletme_kur_hedefi_secilir (DAO, tuval hit-testi)", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await daoBaslat(page);
  await izoAcik(page);
  await tuvalCizili(page);
  const not = page.getByText(/işletmeni buraya kurabilirsin/).first();
  const bulundu = await tuvaldeTara(page, () => not.isVisible());
  info.annotations.push({ type: "yol", description: bulundu ? "tuval" : "tuval-basarisiz" });
  expect(bulundu, "tuvalde boş parsele tıklanamadı (hit-test)").toBe(true);
});

test("tablodaki_kur_hedefi_grubuyla_parsel_secimi_yedegi (DAO)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await daoBaslat(page);
  await izoAcik(page);
  await tabloAc(page);
  await page.locator("[data-bos-parsel] button").first().click();
  await expect(page.getByText(/işletmeni buraya kurabilirsin/).first()).toBeVisible();
});

test("tekerlek_yakinlastirir_surukleyince_kayar", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoBaslat(page);
  await izoAcik(page);
  await tuvalCizili(page);
  await page.getByRole("button", { name: "Sığdır" }).click();
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  const mx = kutu.x + kutu.width / 2;
  const my = kutu.y + kutu.height / 2;
  const once = await tuvalPng(page);
  await page.mouse.move(mx, my);
  await page.mouse.wheel(0, -400); // yakınlaştır
  await expect(async () => {
    expect((await tuvalPng(page)).equals(once), "tekerlek sonrası görüntü değişmeli").toBe(false);
  }).toPass({ timeout: 10_000 });
  const yakin = await tuvalPng(page);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx + 120, my + 80, { steps: 8 });
  await page.mouse.up();
  await expect(async () => {
    expect((await tuvalPng(page)).equals(yakin), "sürükleme sonrası görüntü değişmeli").toBe(false);
  }).toPass({ timeout: 10_000 });
  expect(await farkliOran(page)).toBeGreaterThan(0.05);
});

test("sprite_404_yedege_duser (klasik, tablo hep erişilebilir)", async ({ page }) => {
  test.setTimeout(240_000);
  const hatalar = hataDinle(page, /oyun-sprite|ERR_FAILED|Failed to load resource/); // bilinçli iptal: konsola yalnız yükleme hatası düşer
  await page.route("**/oyun-sprite/*.png", (r) => r.abort());
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoBaslat(page);
  await expect(page.getByText("Şehir görünümü yüklenemedi; sade görünüm gösteriliyor.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1); // kurum satırı klasikte de listelenir (K10, 682db95)
  await expect(page.locator("canvas").first()).toBeVisible();
  await tabloAc(page);
  await page.locator("[data-meydan] button").click();
  await expect(page.getByRole("complementary").last()).toBeVisible(); // tablodan seçim paneli açar
  expect(hatalar(), "beklenmeyen konsol hataları / istisnalar").toEqual([]);
});

test("manifest_404_yedege_duser", async ({ page }) => {
  test.setTimeout(240_000);
  const hatalar = hataDinle(page, /oyun-sprite|manifest|Failed to load resource/);
  await page.route("**/oyun-sprite/manifest.json", (r) => r.fulfill({ status: 404, body: "yok" }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoBaslat(page);
  await expect(page.getByText("Şehir görünümü yüklenemedi; sade görünüm gösteriliyor.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-kurum="liman"]')).toHaveCount(1);
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(hatalar(), "beklenmeyen konsol hataları / istisnalar").toEqual([]);
});

/** İki ekran görüntüsü arasında animasyon farkı yok: tuval ~1,5 sn arayla bayt bayt aynı (oyun duraklatılmış). */
async function tuvalDurgun(page: Page): Promise<void> {
  const bir = await tuvalPng(page);
  await page.waitForTimeout(1500);
  const iki = await tuvalPng(page);
  expect(iki.equals(bir), "azaltılmış harekette tuval değişmemeli").toBe(true);
}

test("azaltilmis_hareket_sistem_ve_uygulama_ici_dugme", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  // 1) Sistem tercihi.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daoBaslat(page);
  await izoAcik(page);
  await tuvalCizili(page);
  await tuvalDurgun(page);
  // Karşıt kontrol: hareket serbestken (sistem de uygulama da) aynı tuval zamanla DEĞİŞİR; yoksa durgunluk testi anlamsızdır.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(async () => {
    const bir = await tuvalPng(page);
    await page.waitForTimeout(700);
    expect((await tuvalPng(page)).equals(bir), "hareket açıkken tuval değişmeli").toBe(false);
  }).toPass({ timeout: 20_000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // 2) Uygulama içi düğme: sistem tercihi kapalıyken "Hareketi azalt".
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Menü" }).click();
  await page.getByRole("button", { name: "Hareketi azalt" }).click();
  await expect(page.locator('[data-hareket="azalt"]').first()).toBeAttached();
  await page.keyboard.press("Escape");
  await tuvalCizili(page);
  await tuvalDurgun(page);
});

test.describe("mobil", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: "dark" });

  test("mobilde_yatay_kaydirma_yok_ve_tek_parmak_surukleme", async ({ page }) => {
    test.setTimeout(240_000);
    await daoBaslat(page);
    await izoAcik(page);
    await tuvalCizili(page);
    await expectNoHorizontalScroll(page, 390);
    const kutu = (await page.locator("canvas").first().boundingBox())!;
    const cx = kutu.x + kutu.width / 2;
    const cy = kutu.y + kutu.height / 2;
    const once = await tuvalPng(page);
    const cdp = await page.context().newCDPSession(page);
    const nokta = (x: number, y: number) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: nokta(cx, cy) });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: nokta(cx + i * 8, cy + i * 6) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(async () => {
      expect((await tuvalPng(page)).equals(once), "tek parmak sürükleme görüntüyü kaydırmalı").toBe(false);
    }).toPass({ timeout: 10_000 });
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]); // sayfa kaymaz, harita kayar
    await expectNoHorizontalScroll(page, 390);
  });
});

test("axe_taramasi_tooltip_ile", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await kurucuBaslat(page, "izo", 2);
  await izoAcik(page);
  await tuvalCizili(page);
  await page.getByRole("button", { name: "Sığdır" }).click();
  // Fareyle tuvalde gezerek ipucunu (tooltip) aç; açılmasa da tarama yapılır (klavye odağı yolu ayrıca sınanır).
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  for (let y = kutu.y + 140; y < kutu.y + kutu.height - 140; y += 90) {
    for (let x = kutu.x + 400; x < kutu.x + kutu.width - 400; x += 90) await page.mouse.move(x, y);
  }
  await expectNoA11yViolations(page);
});

test("performans_olcumu", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await kurucuBaslat(page, "izo", 3);
  await izoAcik(page);
  await tuvalCizili(page);
  await page.getByRole("button", { name: "Sığdır" }).click();
  const kutu = (await page.locator("canvas").first().boundingBox())!;
  const mx = kutu.x + kutu.width / 2;
  const my = kutu.y + kutu.height / 2;
  await page.evaluate(() => {
    const w = window as unknown as { __kareler: number[]; __dur: boolean };
    w.__kareler = [];
    w.__dur = false;
    let son = performance.now();
    const f = (t: number): void => {
      w.__kareler.push(t - son);
      son = t;
      if (!w.__dur) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.mouse.move(mx, my);
  await page.mouse.down();
  const bitis = Date.now() + 2000; // 2 sn kaydırma
  for (let i = 0; Date.now() < bitis; i++) await page.mouse.move(mx + Math.sin(i / 4) * 150, my + Math.cos(i / 4) * 100);
  await page.mouse.up();
  const kareler = await page.evaluate(() => {
    const w = window as unknown as { __kareler: number[]; __dur: boolean };
    w.__dur = true;
    return w.__kareler.slice(1);
  });
  const ort = kareler.reduce((a, b) => a + b, 0) / Math.max(1, kareler.length);
  const not = `kaydırma: ${kareler.length} kare, ortalama kare süresi ${ort.toFixed(1)} ms (swiftshader, yazılım GL; sert eşik yok)`;
  info.annotations.push({ type: "performans", description: not });
  console.log(`[performans_olcumu] ${not}`);
  expect(kareler.length).toBeGreaterThan(0);
  expect(Number.isFinite(ort)).toBe(true);
});
