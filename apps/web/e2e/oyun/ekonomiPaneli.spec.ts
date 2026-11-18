import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../../fidelity/helpers";
import { sunucuBaslat, sunucuDurdur, type CanliSunucu } from "../../fidelity/oyun/canliSunucu";

/**
 * Ekonomi paneli (M10) uçtan uca, GERÇEK model sunucusuyla (`gercek: true`), DAO koşusunda: Tüketim, İşletmeler ve iş gücü, Nüfus ve para
 * (oyuncu servet dilimleri), erişilebilirlik ve tam ekran sınırı, paket yükü. Sunucu bu dosyanın kendisidir: boş bir kapıda başlar, iş bitince kapanır
 * (8785-8787 ve 8795-8799 başka koşulara ayrılmıştır, bu yüzden 8788-8794).
 */
const KAPILAR = [8788, 8790, 8791, 8792, 8793, 8794];                 // 8789 başka koşuya ayrılmıştır: aranmaz
/** Tek haftanın `ekonomi` bloğu için sunucu yük bütçesi (test_ekonomi_blok.py BUTCE ile aynı). */
const EKONOMI_BAYT_BUTCESI = 4200;
/** Tek haftanın `makro` bloğu için sunucu yük bütçesi (test_makro.py BUTCE ile aynı). */
const MAKRO_BAYT_BUTCESI = 900;

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  let son: unknown = null;
  for (const port of KAPILAR) {
    try {
      sunucu = await sunucuBaslat({ gercek: true, port });
      return;
    } catch (e) {
      son = e; // kapı dolu: sıradakini dene
    }
  }
  throw new Error(`boş kapı yok (${KAPILAR.join(", ")}): ${String(son)}`);
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const taban = (): string => `http://127.0.0.1:${sunucu!.port}`;
const BASLIK = { Origin: "", "X-Oyun-Istek": "1" };

/** Her test kendi koşusunu açar; sunucunun açık koşu sınırı dolmasın diye bu sunucudaki koşular silinir. */
test.afterEach(async ({ request }) => {
  const liste = await request.get(`${taban()}/api/runs`).then((r) => r.json()).catch(() => []);
  for (const k of Array.isArray(liste) ? liste : []) {
    const id = (k as { runId?: string }).runId;
    if (typeof id === "string") await request.delete(`${taban()}/api/runs/${id}`, { headers: { ...BASLIK, Origin: taban() } }).catch(() => undefined);
  }
});

const kontrol = (page: Page): Locator => page.getByRole("region", { name: "Oyun kontrolü" });

async function haftaOku(page: Page): Promise<number> {
  return Number(/Hafta (\d+) \//.exec((await kontrol(page).textContent()) ?? "")?.[1] ?? -1);
}

/** DAO koşusunu kurar (kurucu iletişim kutusunu kapatır), `hafta` kez "1 hafta" oynatır. */
async function daoKur(page: Page, hafta: number): Promise<void> {
  await page.goto(`${taban()}/oyun/?kaynak=canli&gorunum=izo#/dao`);
  await waitForLayout(page);
  await page.getByRole("button", { name: "Başla", exact: true }).click();
  await expect(kontrol(page).getByText("Hafta 0 / 520")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Tamam" }).click();
  for (let i = 1; i <= hafta; i++) {
    await page.getByRole("button", { name: "Bir hafta ilerle" }).click();
    await expect(kontrol(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 60_000 });
  }
}

const ekonomiAc = async (page: Page, sekme: string): Promise<Locator> => {
  await page.getByRole("button", { name: "Ekonomi", exact: true }).click();
  const pencere = page.getByRole("dialog", { name: "Ekonomi" });
  await expect(pencere).toBeVisible();
  await pencere.getByRole("tab", { name: sekme }).click();
  return pencere;
};

/** Tablonun başlık dışı satırları (Table ilkeli div + ARIA rolleri kullanır). */
const veriSatirlari = (tablo: Locator): Locator => tablo.getByRole("row").filter({ has: tablo.page().getByRole("cell") });

const kapsamDugmesi = (pencere: Locator, ad: string | RegExp): Locator => pencere.getByRole("group", { name: "Kapsam" }).getByRole("button", { name: ad });

test("tuketim_sekmesi_gercek_modelle (karşılanma, eksik ürünler, ürün ayrıntısı, şehir kapsamı)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 3);
  const pencere = await ekonomiAc(page, "Tüketim");

  // Pencere haritada açık olan şehirle açılır; Kapsam ile dünyaya dönülür.
  const bolum = pencere.getByRole("region", { name: "Hanelerin tüketimi" });
  await expect(bolum.locator('[data-tuketim="kapsam"]')).toHaveText(/^Şehir: /);
  await kapsamDugmesi(pencere, "Dünya").click();
  // Karşılanma kartları ve parasız işsiz satırı, tüm dünya kapsamında; sayılar ölçülmüş.
  await expect(bolum.locator('[data-tuketim="kapsam"]')).toHaveText("Tüm dünya");
  for (const kart of ["karsilanma_ise", "karsilanma_issiz"]) {
    const k = bolum.locator(`[data-tuketim="${kart}"]`);
    await expect(k).toBeVisible();
    await expect(k.locator("dd").first()).toHaveText(/%\s?\d/);
  }
  await expect(bolum.locator('[data-tuketim="karsilanma_ise"] dt')).toHaveText("Çalışanlar");
  await expect(bolum.locator('[data-tuketim="karsilanma_issiz"] dt')).toHaveText("İş arayanlar");
  const parasiz = bolum.locator('[data-tuketim="parasiz"]');
  await expect(parasiz).toBeVisible();
  await expect(parasiz.locator("dt")).toHaveText("Parası olmadığı için tüketemeyen işsiz");
  await expect(parasiz.locator("dd")).toHaveText(/\d/);
  await expect(bolum.getByRole("img", { name: /Alım gücü oranı: Çalışanlar/ })).toBeVisible();
  await expect(bolum.getByRole("img", { name: /Alım gücü oranı: İş arayanlar/ })).toBeVisible();

  // Ücret ve fiyat: iki endeks, en düşük net ücret, tam sepet bedeli ve oran ölçülmüş; grafikte iki seri; iç kısaltma yok.
  await expect(bolum.getByRole("heading", { name: "Ücret ve fiyat" })).toBeVisible();
  for (const kart of ["ucret_endeksi", "fiyat_endeksi", "net_ucret", "sepet_bedeli"]) {
    await expect(bolum.locator(`[data-tuketim="${kart}"] dd`).first()).toHaveText(/\d/);
  }
  await expect(bolum.locator('[data-tuketim="ucret_orani"] dd').first()).toHaveText(/\d,\d\d katı/);
  await expect(bolum.locator('[data-tuketim="sepet_bedeli"] dt')).toHaveText("Tam sepet bedeli (haftalık)");
  await expect(bolum.locator('[data-tuketim="ucret_orani"] dt')).toHaveText("En düşük net ücret, tam sepetin");
  await expect(bolum.getByRole("img", { name: /Ücret ve fiyat endeksi/ })).toBeVisible();
  await expect(bolum).not.toContainText(/\bWI\b|\bcpi\b/i);

  // En çok eksik kalan ürünler: tablo en az bir satır; şirket içi kısaltmalar (aff, gate) ekranda yok.
  const eksik = pencere.getByRole("region", { name: "En çok eksik kalan ürünler" });
  const satirlar = veriSatirlari(eksik.getByRole("table", { name: "Ürün bazında eksik" }));
  expect(await satirlar.count()).toBeGreaterThanOrEqual(1);
  await expect(pencere).not.toContainText(/\baff\b|\bgate\b/i);

  // Ürün ayrıntısı: ilk düğmeli ürüne basınca bölüm açılır; ya şehirlere göre 5 satır ya da "yok" durumu.
  const dugme = eksik.getByRole("button").first();
  const urunAdi = ((await dugme.textContent()) ?? "").trim();
  expect(urunAdi).not.toBe("");
  await dugme.click();
  const ayrinti = pencere.getByRole("region", { name: `${urunAdi}: şehirlere göre` });
  await expect(ayrinti).toBeVisible();
  const tablo = ayrinti.getByRole("table", { name: "Şehirlere göre ürün ayrıntısı" });
  const yok = ayrinti.getByRole("status").or(ayrinti.getByRole("alert"));
  await expect(tablo.or(yok).first()).toBeVisible({ timeout: 30_000 });
  if (await tablo.isVisible()) await expect(veriSatirlari(tablo)).toHaveCount(5);
  else await expect(yok).toContainText(/ürün ayrıntısı/i);
  await dugme.click(); // ikinci basış kapatır
  await expect(ayrinti).toHaveCount(0);

  // Şehir seçimi: rozet ve değerler değişir.
  const dunyaDegerleri = await bolum.locator("dl").first().innerText();
  const sehirDugmeleri = pencere.getByRole("group", { name: "Kapsam" }).getByRole("button");
  expect(await sehirDugmeleri.count()).toBe(6); // Dünya + 5 şehir
  await sehirDugmeleri.nth(1).click();
  await expect(bolum.locator('[data-tuketim="kapsam"]')).toHaveText(/^Şehir: /);
  await expect(bolum.locator('[data-tuketim="sehir_karsilanma"]')).toContainText("şehrinde mal karşılama oranı");
  const birinci = await bolum.locator("dl").first().innerText();
  expect(birinci).not.toBe(dunyaDegerleri);
  await sehirDugmeleri.nth(2).click();
  const ikinci = await bolum.locator("dl").first().innerText();
  expect(ikinci).not.toBe(birinci);
  await kapsamDugmesi(pencere, "Dünya").click();
  await expect(bolum.locator('[data-tuketim="kapsam"]')).toHaveText("Tüm dünya");
});

test("isletmeler_ve_isgucu_gercek_modelle (iş gücü, boy çubukları, hareket, endeks, sektör tablosu)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 4);
  const pencere = await ekonomiAc(page, "İşletmeler ve iş gücü");
  const bolum = pencere.getByRole("region", { name: "İşletmeler ve iş gücü" });
  await expect(bolum).toBeVisible();
  await expect(bolum.locator('[data-isletme="kapsam"]')).toHaveText(/^Şehir: /);   // haritadaki şehirle açılır
  await kapsamDugmesi(pencere, "Dünya").click();

  // İş gücü: oyuncu ve yerleşik halk satırları (ölçülmüş sayı), iş gücü dışı açıklaması.
  for (const [id, ad] of [["oyuncu", "Çalışan oyuncular"], ["npc", "Çalışan yerleşik halk"], ["issiz_oyuncu", "İş arayan oyuncular"], ["issiz_npc", "İş arayan yerleşik halk"]] as const) {
    const k = bolum.locator(`[data-isletme="${id}"]`);
    await expect(k.locator("dt")).toHaveText(ad);
    await expect(k.locator("dd").first()).toHaveText(/\d/);
  }
  await expect(bolum.locator('[data-isletme="isgucu_disi"] dd').first()).toHaveText(/\d/);

  // İşletme büyüklüğü: dört çubuk, her biri etiketli ve sayılı; toplam satırı.
  for (let i = 1; i <= 4; i++) {
    const c = bolum.locator(`[data-isletme="boy_${i}"]`);
    await expect(c).toBeVisible();
    await expect(c.locator("progress")).toHaveAttribute("aria-label", /: \d[\d\s. ]* işletme$/);
  }
  await expect(bolum.locator('[data-isletme="boy_toplam"]')).toContainText(/Toplam \d/);

  // Haftalık işletme hareketi: 4. haftada ölçülür (4 sayı).
  for (const alan of ["kurulan", "buyuyen", "kuculen", "batan"]) {
    await expect(bolum.locator(`[data-isletme="hareket_${alan}"] dd`)).toHaveText(/^\d/);
  }

  // Şehir tüketiyor, işletmeler ne kadar büyüyor: grafik ve endeks metni (+/-%).
  await expect(bolum.getByRole("heading", { name: "Şehir tüketiyor, işletmeler ne kadar büyüyor" })).toBeVisible();
  await expect(bolum.getByRole("img", { name: /Haftalık harcama ile özel işletmelerdeki çalışan sayısı birlikte/ })).toBeVisible();
  await expect(bolum.locator('[data-isletme="endeks_harcama"]')).toHaveText(/ilk ölçülen haftaya göre [+\-−]%\s?\d/);
  await expect(bolum.locator('[data-isletme="endeks_ozel"]')).toHaveText(/ilk ölçülen haftaya göre [+\-−]%\s?\d/);

  // Sektör tablosu: başlık kolonları, en az bir sektör satırı, tüm dünya rozeti.
  const sektor = bolum.getByRole("table", { name: "Sektöre göre çalışan ve işletme sayısı" });
  await expect(sektor.getByRole("columnheader", { name: "Çalışan", exact: true })).toBeVisible();
  expect(await veriSatirlari(sektor).count()).toBeGreaterThanOrEqual(2);
  await expect(bolum.locator('[data-isletme="sektor_kapsam"]')).toHaveText("Tüm dünya");
  await expect(pencere).not.toContainText(/\baff\b|\bgate\b/i);

  // Şehir düğmesi: kapsam rozeti ve değerler değişir.
  const once = await bolum.locator("dl").first().innerText();
  await kapsamDugmesi(pencere, /^(?!Dünya$)/).first().click();
  await expect(bolum.locator('[data-isletme="kapsam"]')).toHaveText(/^Şehir: /);
  expect(await bolum.locator("dl").first().innerText()).not.toBe(once);
});

test("nufus_ve_para_oyuncu_dilimleri (üst onda bir, alt onda dokuz)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 2);
  const pencere = await ekonomiAc(page, "Nüfus ve para");
  const dilim = pencere.getByRole("region", { name: "Oyuncu servet dilimleri" });
  await expect(dilim).toBeVisible();
  for (const [id, ad] of [["ust10", "Oyuncuların en zengin onda biri"], ["alt90", "Oyuncuların geri kalan onda dokuzu"]] as const) {
    await expect(dilim.locator(`[data-dilim="${id}"] dt`)).toHaveText(ad);
    await expect(dilim.locator(`[data-dilim="${id}"] dd`)).toHaveText(/\d/);
  }
  await expect(dilim.locator('[data-dilim="npc_nakit"] dd')).toHaveText(/\d/);
  await expect(dilim.locator('[data-dilim="npc_mevduat"] dd')).toHaveText(/\d/);
  await expect(dilim).toContainText("işletme kasaları dahil değil");
});

test("makro_sekmesi_gercek_modelle (sekiz kart, açıklama, gruplu grafikler, ayrıntılı göstergeler)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 3);
  const pencere = await ekonomiAc(page, "Makro göstergeler");
  const bolum = pencere.getByRole("region", { name: "Makro göstergeler" });
  await expect(bolum).toBeVisible();
  const kartlar = ["enflasyon", "gercek_ucret", "buyume", "issizlik", "politika", "gercek_faiz", "gini", "yoksul"];
  for (const id of kartlar) {
    const kart = bolum.locator(`[data-makro="${id}"]`);
    await expect(kart).toBeVisible();
    await expect(kart.locator("dd").first()).toHaveText(/\d|ölçülmüyor/);          // sayı ya da dürüstçe "ölçülmüyor"
    await expect(kart.locator("dd").nth(1)).not.toHaveText("");                  // her kartta açıklama
  }
  // 3. haftada bu kartlar gerçekten ölçülmüş olmalı (büyüme 13 hafta dolmadan ölçülmez)
  for (const id of ["gercek_ucret", "politika", "gini", "yoksul", "issizlik"]) await expect(bolum.locator(`[data-makro="${id}"] dd`).first()).toHaveText(/\d/);
  await expect(bolum.locator('[data-makro="buyume"] dd').first()).toHaveText("ölçülmüyor");
  for (const g of ["Fiyatlar", "Üretim ve para", "Faiz", "Dağılım", "Kredi", "Firmalar ve konut"]) await expect(bolum.getByRole("heading", { name: g })).toBeVisible();
  await expect(bolum.getByRole("img", { name: "Fiyat ve ücret endeksleri (ilk hafta = 100)" })).toBeVisible();
  await expect(bolum.getByRole("img", { name: "Paranın dolaşım hızı (haftalık)" })).toBeVisible();
  await expect(bolum.locator('[data-makro-ek="para_stok"] dd').first()).toHaveText(/\d/);
  await expect(bolum).not.toContainText(/NaN|undefined/);
  await expectNoA11yViolations(page);
});

for (const [ad, en, boy] of [["masaustu", 1280, 900], ["mobil", 390, 844]] as const) {
  test(`ekonomi_paneli_erisilebilir_ve_tam_ekran_icinde (${ad})`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: en, height: boy });
    await daoKur(page, 2);
    const hafta = await haftaOku(page);
    for (const sekme of ["Tüketim", "İşletmeler ve iş gücü", "Makro göstergeler", "Nüfus ve para"]) {
      const pencere = await ekonomiAc(page, sekme);
      await expect(pencere.getByRole("tab", { name: sekme })).toHaveAttribute("aria-selected", "true");
      await expectNoA11yViolations(page);
      await expectNoHorizontalScroll(page, en);
      const kutu = (await pencere.boundingBox())!;
      expect(kutu.x, "pencere solda taşmaz").toBeGreaterThanOrEqual(-1);
      expect(kutu.x + kutu.width, "pencere sağda taşmaz").toBeLessThanOrEqual(en + 1);
      expect(kutu.y + kutu.height, "pencere altta taşmaz").toBeLessThanOrEqual(boy + 1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Ekonomi" })).toHaveCount(0);
    }
    // Panel kapanınca oyun ekranı yerinde (harita, kontrol), oyuncu adımı otomatik atılmadı (hafta sayacı aynı).
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(kontrol(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ekonomi", exact: true })).toBeVisible();
    expect(await haftaOku(page)).toBe(hafta);
  });
}

test("gercek_sunucu_paketi_ekonomi_tasir (yük bütçesi)", async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 3);
  const liste = (await (await request.get(`${taban()}/api/runs`)).json()) as { runId: string }[];
  expect(liste.length).toBeGreaterThanOrEqual(1);
  const id = liste[0]!.runId;
  const paketler = (await (await request.get(`${taban()}/api/runs/${id}/weeks?from=1&to=3`)).json()) as { week: number; ekonomi?: unknown }[];
  expect(paketler.length).toBe(3);
  for (const p of paketler) {
    expect(p.ekonomi, `hafta ${p.week} paketinde ekonomi`).toBeTruthy();
    const bayt = JSON.stringify(p.ekonomi).length;
    expect(bayt, `hafta ${p.week} ekonomi bloğu bayt`).toBeLessThanOrEqual(EKONOMI_BAYT_BUTCESI);
    expect(bayt).toBeGreaterThan(500);
  }
});

test("gercek_sunucu_paketi_makro_tasir (yük bütçesi, ayrı blok)", async ({ page, request }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await daoKur(page, 3);
  const liste = (await (await request.get(`${taban()}/api/runs`)).json()) as { runId: string }[];
  const id = liste[0]!.runId;
  const paketler = (await (await request.get(`${taban()}/api/runs/${id}/weeks?from=1&to=3`)).json()) as { week: number; makro?: { fiyat?: unknown }; ekonomi?: { makro?: unknown } }[];
  expect(paketler.length).toBe(3);
  for (const p of paketler) {
    expect(p.makro, `hafta ${p.week} paketinde makro`).toBeTruthy();
    expect(p.ekonomi?.makro, "makro, ekonomi bloğunun içinde değil ayrı blok").toBeUndefined();
    const bayt = Buffer.byteLength(JSON.stringify(p.makro));
    expect(bayt, `hafta ${p.week} makro bloğu bayt`).toBeLessThanOrEqual(MAKRO_BAYT_BUTCESI);
    expect(bayt).toBeGreaterThan(200);
  }
});
