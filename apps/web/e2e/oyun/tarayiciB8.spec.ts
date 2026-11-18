import fs from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { waitForLayout } from "../../fidelity/helpers";

/**
 * B8 uctan uca (Chromium, tarayici derlemesi): arayuz uyarlamalari. Yalniz `playwright.tarayici.config.ts` ile kosar.
 * Kapsam: kayit baglantisi yonlendirmesi, gizlenen ekranlar, acilis hesabi, mobil uyari, disa aktar -> yeni profil -> ice aktar -> tariften oynatma,
 * acilis secim ekranlari (uzun goruntusuz kayit, uyumsuz goruntu), konsol ve CSP temiz.
 */
test.skip(process.env.E2E_TARAYICI !== "1", "yavas tarayici-model testi: pnpm e2e:tarayici");

const DENETIM = (p: Page) => p.getByRole("region", { name: "Oynatma denetimi" });
const HAFTA = /Hafta (\d+) \/ 200/;
const EKRAN = process.env.B8_EKRAN ?? "";

function dinle(page: Page): { konsol: string[]; csp: () => Promise<string[]> } {
  const konsol: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") konsol.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => konsol.push(`pageerror: ${e.message}`));
  void page.addInitScript(() => {
    const w = window as unknown as { __cspIhlal: string[] };
    w.__cspIhlal = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__cspIhlal.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { konsol, csp: () => page.evaluate(() => (window as unknown as { __cspIhlal?: string[] }).__cspIhlal ?? []) };
}

async function ekranGoruntusu(page: Page, ad: string): Promise<void> {
  if (EKRAN !== "") await page.screenshot({ path: `${EKRAN}/${ad}.png` });
}

async function hafta(page: Page): Promise<number> {
  const metin = (await DENETIM(page).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(metin)?.[1] ?? NaN);
}

async function oyunKur(page: Page, ad = "B8 oyun"): Promise<string> {
  await page.getByLabel("Dünya adı").fill(ad);
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 60_000 });
  return new URL(page.url()).hash.slice("#/canli/".length);
}

async function haftaOyna(page: Page, n: number): Promise<void> {
  for (let i = 1; i <= n; i += 1) {
    await page.getByRole("button", { name: "Tek hafta" }).click();
    await expect(DENETIM(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 90_000 });
  }
}

/** IndexedDB `daoliberal-kayit` icinde bir depodaki butun kayitlari degistirir (deney: anahtar/hafta bozma). */
async function depoDegistir(page: Page, depo: string, degistir: "yayimlanan40" | "goruntuAnahtar"): Promise<void> {
  await page.evaluate(
    ({ depo, degistir }) =>
      new Promise<void>((coz, reddet) => {
        const acma = indexedDB.open("daoliberal-kayit");
        acma.onerror = () => reddet(acma.error);
        acma.onsuccess = () => {
          const db = acma.result;
          const tx = db.transaction(depo, "readwrite");
          const st = tx.objectStore(depo);
          const f = (k: Record<string, unknown>): unknown => (degistir === "yayimlanan40" ? { ...k, yayimlanan: 40 } : { ...k, anahtar: { ...(k.anahtar as object), model_sha256: "f".repeat(64) } });   // CSP: Function/eval yok
          const hepsi = st.openCursor();
          hepsi.onsuccess = () => {
            const c = hepsi.result;
            if (!c) return;
            c.update(f(c.value as Record<string, unknown>));
            c.continue();
          };
          tx.oncomplete = () => {
            db.close();
            coz();
          };
          tx.onerror = () => reddet(tx.error);
        };
      }),
    { depo, degistir },
  );
}

test("kayit_baglantisi: ?kaynak=kayit ve canli- oneksiz kimlik Baslangica yonlenir, bilgi gosterilir, acik kod satiri var", async ({ page }) => {
  test.setTimeout(240_000);
  const { konsol, csp } = dinle(page);
  await page.goto("/oyun/?kaynak=kayit#/canli/kayit-abc");
  await waitForLayout(page);
  await expect(page.getByText("Önceden kaydedilmiş koşu ve önizleme bağlantıları bu sürümde açılamıyor", { exact: false })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "Kurucu" }).or(page.getByText("Kurucu").first())).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("#/");
  await expect(page.getByText("Oyun tamamen tarayıcınızda çalışır; kodu açıktır.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Açık kod deposu" })).toHaveAttribute("href", "https://github.com/daoliberal/daoliberalism");
  await ekranGoruntusu(page, "b8-baslangic-kayit-baglantisi");
  // Paylasilan dunya rotasi: anlasilir bilgi, Baslangic'a donus
  await page.evaluate(() => (window.location.hash = "#/dao/d/ABCDEF"));
  await expect(page.getByRole("heading", { name: "Bu bağlantı bu sürümde açılamaz" })).toBeVisible();
  await page.getByRole("button", { name: "Başlangıç ekranına git" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/");
  expect(await csp()).toEqual([]);
  expect(konsol).toEqual([]);
});

test("gizlenenler: Sonuc ekraninda 6 dunya, A/B, yayinla yok; Kurucu'da etki onizlemesi yok; Acilis hesabi calisir", async ({ page }) => {
  test.setTimeout(300_000);
  const { konsol, csp } = dinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  const kosuId = await oyunKur(page);
  await haftaOyna(page, 2);
  await page.evaluate((id) => (window.location.hash = `#/sonuc/${id}`), kosuId);
  await expect(page.getByRole("button", { name: "Canlı Dünya'ya dön" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Aynı şartı 6 dünyada koş" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A/B karşılaştırma" })).toHaveCount(0);
  await expect(page.getByText("Dünyayı yayınla")).toHaveCount(0);
  await expect(page.getByText("Bu sunucu arka plan işlerini desteklemiyor.")).toHaveCount(0);
  await ekranGoruntusu(page, "b8-sonuc-tarayici");
  // Kurucu: "Etki onizlemesi" yok; "Acilis hesabi" tarayicida Worker icinde hesaplanir
  await page.evaluate(() => (window.location.hash = "#/kurucu"));
  await expect(page.getByLabel("Dünya adı")).toBeVisible();
  await page.getByLabel("Dünya adı").fill("Hesap");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("navigation", { name: "Kurulum adımları" }).getByRole("button", { name: /Şartı yaz/ }).click();
  await page.getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /^\d+\. Dünya$/ }).click();
  await expect(page.getByRole("heading", { name: "Açılış hesabı" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Nüfus: toplam [\d.]+ kişi/)).toBeVisible({ timeout: 120_000 });   // /api/world/plan Worker icinde calisti
  await expect(page.getByText("Açılış hesabı alınamadı", { exact: false })).toHaveCount(0);
  await ekranGoruntusu(page, "b8-kurucu-acilis-hesabi");
  await expect(page.getByText("Etki önizlemesi")).toHaveCount(0);
  expect(await csp()).toEqual([]);
  expect(konsol).toEqual([]);
});

test("mobil: uyari cikar oyun engellenmez kapatinca hatirlanir", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await ctx.newPage();
  const { konsol, csp } = dinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  const uyari = page.getByText("Telefonda ve tablette uzun oyun desteklenmiyor; tarayıcı kapanabilir. Masaüstü önerilir.");
  await expect(uyari).toBeVisible({ timeout: 180_000 });
  await expect(page.getByLabel("Dünya adı")).toBeVisible();          // oyun engellenmedi
  await ekranGoruntusu(page, "b8-mobil-uyari");
  await page.getByRole("button", { name: "Uyarıyı kapat" }).click();
  await expect(uyari).toHaveCount(0);
  await page.reload();
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  await expect(uyari).toHaveCount(0);                                // tercih hatirlandi
  expect(await csp()).toEqual([]);
  expect(konsol).toEqual([]);
  await ctx.close();
});

test("disa aktar -> yeni profil -> ice aktar -> tariften oynatma ile ayni hafta", async ({ page, browser }, info) => {
  test.setTimeout(420_000);
  const a = dinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  await oyunKur(page, "Yedek oyun");
  await haftaOyna(page, 4);
  await page.evaluate(() => (window.location.hash = "#/"));
  await page.getByRole("button", { name: "Kayıt ve depolama" }).click();
  const panel = page.getByRole("dialog", { name: "Kayıt ve depolama" });
  await expect(panel.getByText("Kullanılan alan", { exact: false }).or(panel.getByText("depolama kullanımını bildirmiyor", { exact: false }))).toBeVisible();
  await expect(panel.getByText(/Kalıcı depolama (verildi|verilmedi)|kalıcı depolama/i).first()).toBeVisible();
  await expect(panel.getByText("Safari (WebKit) 7 gün", { exact: false })).toBeVisible();
  await ekranGoruntusu(page, "b8-kayit-paneli");
  const [indirme] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Dışa aktar: Yedek oyun" }).click()]);
  const dosya = info.outputPath("kayit.json");
  await indirme.saveAs(dosya);
  const icerik = JSON.parse(fs.readFileSync(dosya, "utf8")) as { bicim: string; kosu: { yayimlanan: number } };
  expect(icerik.bicim).toBe("daoliberal-kayit");
  expect(JSON.stringify(icerik)).not.toContain('"goruntu"');
  const beklenenHafta = icerik.kosu.yayimlanan;
  expect(beklenenHafta).toBeGreaterThanOrEqual(4);
  expect(await a.csp()).toEqual([]);
  expect(a.konsol).toEqual([]);

  // Yeni profil: bos IndexedDB / depolama
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const b = dinle(p2);
  await p2.goto("/oyun/#/");
  await waitForLayout(p2);
  await p2.getByRole("button", { name: "Kayıt ve depolama" }).click({ timeout: 180_000 });
  const panel2 = p2.getByRole("dialog", { name: "Kayıt ve depolama" });
  await expect(panel2.getByText("Bu tarayıcıda kayıtlı oyun yok.")).toBeVisible();
  await panel2.locator('input[type="file"]').setInputFiles(dosya);
  await panel2.getByRole("button", { name: "İçe aktar" }).click();
  await expect(panel2.getByText(`Kayıt içe aktarıldı: ${beklenenHafta}. hafta`, { exact: false })).toBeVisible();
  await panel2.getByRole("button", { name: "Aç ve oynat", exact: true }).click();
  await waitForLayout(p2);
  await expect(DENETIM(p2).getByText(HAFTA).first()).toBeVisible({ timeout: 300_000 });
  expect(await hafta(p2)).toBe(beklenenHafta);
  expect(new URL(p2.url()).hash).toMatch(/^#\/canli\/canli-/);
  expect(await b.csp()).toEqual([]);
  expect(b.konsol).toEqual([]);
  await ctx2.close();
});

test("acilis secimi: uzun goruntusuz kayit sormadan baslamaz, secim ekrani tahminle acilir; iptal kaydi silmez", async ({ page }) => {
  test.setTimeout(420_000);
  const { konsol, csp } = dinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  const kosuId = await oyunKur(page, "Uzun kayit");
  await haftaOyna(page, 2);
  await page.evaluate(() => (window.location.hash = "#/"));
  await expect(page.getByRole("button", { name: "Kayıt ve depolama" })).toBeVisible();
  // Kaydi 40. haftada sayiyoruz (goruntu yok): tahmini en cok 240 sn > otomatik sinir -> secim ekrani
  await depoDegistir(page, "kosular", "yayimlanan40");
  await page.evaluate((id) => (window.location.hash = `#/canli/${id}`), kosuId);
  await page.reload();
  await waitForLayout(page);
  await expect(page.getByRole("heading", { name: "Kayıt baştan oynatılmalı" })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText("40 hafta oynatılacak", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Baştan oynat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kaydı dışa aktar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kaydı sil" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeni oyun başlat" })).toBeVisible();
  await ekranGoruntusu(page, "b8-secim-tariften-gerek");
  // Baştan oynat: ilerleme (hafta x / y) ve iptal
  await page.getByRole("button", { name: "Baştan oynat" }).click();
  await expect(page.getByText(/\d+\. hafta hesaplandı, hedef 40\. hafta/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Kayıt baştan oynatılıyor; birkaç dakika sürebilir.", { exact: false })).toBeVisible();
  await ekranGoruntusu(page, "b8-tariften-ilerleme");
  await page.getByRole("button", { name: "İptal et" }).click();
  await waitForLayout(page);
  await expect(page.getByText("Kayıtlı oyunun var")).toBeVisible({ timeout: 240_000 });   // acilis secimine donuldu
  await page.getByRole("button", { name: "Yeni oyun başlat" }).click();
  await page.getByRole("button", { name: "Kayıt ve depolama" }).click();
  await expect(page.getByRole("dialog", { name: "Kayıt ve depolama" }).getByText("Uzun kayit, 40. hafta")).toBeVisible();   // kayit silinmedi
  expect(await csp()).toEqual([]);
  expect(konsol).toEqual([]);
});

test("acilis secimi: uyumsuz goruntu (anahtari degistirilmis IndexedDB girdisi) 'bu model surumuyle acilamadi' ekranina duser, Bastan oynat kurtarir @yavas", async ({ page }) => {
  test.setTimeout(900_000);
  const { konsol, csp } = dinle(page);
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  const kosuId = await oyunKur(page, "Uyumsuz");
  await haftaOyna(page, 14);
  await expect.poll(
    () => page.evaluate(() => new Promise<number>((c) => {
      const a = indexedDB.open("daoliberal-kayit");
      a.onsuccess = () => {
        const r = a.result.transaction("goruntuler").objectStore("goruntuler").count();
        r.onsuccess = () => { a.result.close(); c(r.result); };
      };
    })),
    { timeout: 90_000 },
  ).toBeGreaterThanOrEqual(1);
  // Goruntunun model anahtari bozulur (surum uyumsuzlugu); kayit kaydi dokunulmaz
  await depoDegistir(page, "goruntuler", "goruntuAnahtar");
  await page.reload();
  await waitForLayout(page);
  await expect(page.getByRole("heading", { name: "Kayıt bu model sürümüyle açılamadı" })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText("Tahmini süre", { exact: false })).toBeVisible();
  await ekranGoruntusu(page, "b8-secim-uyumsuz");
  await page.getByRole("button", { name: "Baştan oynat" }).click();
  await expect(DENETIM(page).getByText(HAFTA).first()).toBeVisible({ timeout: 480_000 });
  expect(await hafta(page)).toBe(14);
  expect(new URL(page.url()).hash).toBe(`#/canli/${kosuId}`);
  expect(await csp()).toEqual([]);
  expect(konsol).toEqual([]);
});
