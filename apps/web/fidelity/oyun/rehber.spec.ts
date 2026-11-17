import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, gotoApp } from "../helpers";
import { assertOyunParity } from "./oyun-parity";
import { sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

async function kur(page: Page): Promise<void> {
  await gotoApp(page, "/oyun/#/kurucu/rehberli");
  await expect(page.getByRole("heading", { name: "İlk oyun" })).toBeVisible();
  await page.getByLabel("Dünya adı").fill("İlk Dünya");
}

/**
 * Adım 1 notu (M6): 11-13. prototip satırları (şehir adı metni) karşılaştırılmaz; oyunun Adim0 metinleri (Rastgele isim, uzunluk sınırı) bilerek farklıdır ve
 * kurucuAdim01.spec.ts bu metinleri `exceptions/builder01.ts` gerekçeleriyle denetler.
 */
const adimlar = (page: Page) => page.getByRole("navigation", { name: "Kurulum adımları" });
const tur = (page: Page) => page.getByRole("dialog");

/** Turu ilk karar adımına getirir (giriş adımları "İlerle" ile geçilir). */
async function turaGir(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Devam: Kuralları tanı (tur)" }).click();
  await expect(tur(page)).toBeVisible();
}

/**
 * Rehberli ilk oyun (W12), kayıt kaynağıyla. Prototipin `guided` kipi: üç adım, "Rehberi atla", tur kutusu (`tourShow`), ilk kritik olay kutusu (`guideShow`)
 * ve ipucu (`hintShow`). Tur ve kutu metinleri modelin gerçek davranışından fazlasını söylemez; ayrışan satırlar `exceptions/guide.ts` içinde gerekçeli.
 */
test.describe("rehberli ilk oyun", () => {
  test("adım 1: şablon ve ad; üç adım, Rehberi atla; prototip sadakati, erişilebilirlik ve yatay kaydırma yok", async ({ page }) => {
    await kur(page);
    await expect(adimlar(page).getByRole("button")).toHaveText([/Şablon seç/, /Kuralları tanı \(tur\)/, /Başlat ve oynat/]);
    await expect(page.getByRole("button", { name: "Rehberi atla" })).toBeVisible();
    // Kurucunun ilk şablonu Geçiş desteği (736a00a; sahip kararı), prototipte ise Dayanıklı taban önce gelir: iki geçiş (bkz. kurucuAdim01.spec.ts; 23-26 Dayanıklı taban, 27-29 Geçiş desteği).
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 1 }, { screen: "builder", only: [{ from: 6, to: 7 }, { from: 14, to: 22 }, { from: 27, to: 40 }] });
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 1 }, { screen: "builder", only: [{ from: 6, to: 7 }, { from: 14, to: 26 }, { from: 30, to: 40 }] });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("adım 2: tur kendiliğinden açılır; giriş, karar ve son adım prototipe uyar; odak kutuda", async ({ page }) => {
    await kur(page);
    await turaGir(page);
    await expect(tur(page)).toBeFocused();
    // Giriş adımı: İlerle + Turu bitir.
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 2, tour: 0 }, { screen: "builder", only: [{ from: 104, to: 999 }], root: tur(page) });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    for (let i = 0; i < 3; i += 1) await tur(page).getByRole("button", { name: "İlerle" }).click();
    // Karar adımı: Varsayılan kalsın, Sonraki, Turu bitir; kartın kendi denetimi kutudadır.
    await expect(tur(page).getByText("Bu kural şunu ayarlar:")).toBeVisible();
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 2, tour: 3 }, { screen: "builder", only: [{ from: 104, to: 999 }], root: tur(page) });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    // Son adıma kadar ilerle: yalnız "Şimdi oyna" + "Turu bitir".
    while ((await tur(page).getByRole("button", { name: "Şimdi oyna" }).count()) === 0) await tur(page).getByRole("button", { name: "Sonraki" }).click();
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 2, tour: 12 }, { screen: "builder", only: [{ from: 104, to: 999 }], root: tur(page) });
    await expectNoA11yViolations(page);
    await tur(page).getByRole("button", { name: "Şimdi oyna" }).click();
    await expect(tur(page)).toHaveCount(0);
    await expect(page.getByText("İlk kritik olayda dünya otomatik durur.")).toBeVisible();
  });

  test("tur görüldükten sonra kendiliğinden açılmaz; Turu başlat yeniden açar", async ({ page }) => {
    await kur(page);
    await turaGir(page);
    await tur(page).getByRole("button", { name: "Turu bitir" }).click();
    await expect(tur(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Geri", exact: true }).click();
    await page.getByRole("button", { name: "Devam: Kuralları tanı (tur)" }).click();
    await expect(page.getByRole("button", { name: "Turu başlat" })).toBeVisible();
    await expect(tur(page)).toHaveCount(0);
    // Uzman ayarları rehberli kipte yok.
    await expect(page.getByRole("button", { name: /^Göster \(\d+\)$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Turu başlat" }).click();
    await expect(tur(page)).toBeVisible();
  });

  test("adım 3: Başlat ve oynat özeti prototipe uyar", async ({ page }) => {
    await kur(page);
    await adimlar(page).getByRole("button", { name: /Başlat ve oynat/ }).click();
    await expect(page.getByText("İlk kritik olayda dünya otomatik durur.")).toBeVisible();
    await assertOyunParity(page, { screen: "builder", guided: true, bStep: 4 }, { screen: "builder", only: [{ from: 6, to: 7 }, { from: 44, to: 45 }] });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
  });

  test("Rehberi atla tam Kurucu'ya döner", async ({ page }) => {
    await kur(page);
    await page.getByRole("button", { name: "Rehberi atla" }).click();
    await expect(page).toHaveURL(/#\/kurucu$/);
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
    await expect(adimlar(page).getByRole("button")).toHaveCount(5);
  });

  test("ilk kritik olayda dünya durur, kural değiştirilir, ipucu ve Uzman ayarlarını aç", async ({ page }) => {
    test.setTimeout(180_000);
    await kur(page);
    await turaGir(page);
    await tur(page).getByRole("button", { name: "Turu bitir" }).click();
    await page.getByRole("button", { name: "Devam: Başlat ve oynat" }).click();
    await page.getByRole("button", { name: "Başlat", exact: true }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(/Hafta 0 \/ 200/)).toBeVisible();
    // İlk haftalarda ipucu (en çok bir tane, "Tamam" ile kapanır).
    await page.getByRole("button", { name: "16×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    const kutu = page.getByRole("dialog", { name: "Dünya durdu" });
    await expect(kutu).toBeVisible({ timeout: 120_000 });
    await expect(kutu).toBeFocused();
    await assertOyunParity(page, { screen: "live", guided: true, guideShow: true, week: 60, selEvent: 0 }, { screen: "live", only: [{ from: 102, to: 106 }], root: kutu });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    // Bir kez durur: Devam et dünyayı sürdürür, ikinci kritik olayda yeniden durmaz.
    await kutu.getByRole("button", { name: "Şartı değiştir" }).click();
    const editor = page.getByRole("dialog").filter({ hasText: /Şartı değiştir|sürüm/i });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("heading", { level: 4 }).first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Dünya durdu" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Sonuç ekranında rehberli koşu için "Uzman ayarlarını aç" var ve uzman kartları açık Kurucu'yu getirir.
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("group", { name: "Ana menü" }).getByRole("button", { name: /^(Ara durum|Sonuç)$/ }).click();
    await expect(page.getByRole("button", { name: "Uzman ayarlarını aç" })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Uzman ayarlarını aç" }).click();
    await expect(page).toHaveURL(/#\/kurucu\/2\/uzman$/);
    await expect(page.getByRole("button", { name: /^Gizle \(\d+\)$/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  });

  test("ilk haftalarda ipucu çıkar ve Tamam ile kapanır", async ({ page }) => {
    await kur(page);
    await turaGir(page);
    await tur(page).getByRole("button", { name: "Turu bitir" }).click();
    await page.getByRole("button", { name: "Devam: Başlat ve oynat" }).click();
    await page.getByRole("button", { name: "Başlat", exact: true }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(/Hafta 0 \/ 200/)).toBeVisible();
    await page.getByRole("button", { name: "Tek hafta" }).click();
    await page.getByRole("button", { name: "Tek hafta" }).click();
    const ipucu = page.getByRole("status").filter({ hasText: "Bu hafta\" şeridi" });
    await expect(ipucu).toBeVisible();
    await assertOyunParity(page, { screen: "live", guided: true, week: 3 }, { screen: "live", only: [{ from: 78, to: 79 }], root: ipucu });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await ipucu.getByRole("button", { name: "Tamam" }).click();
    await expect(ipucu).toHaveCount(0);
  });
});

/**
 * Canlı yol: gerçek `oyun_server --host-kind fake`. Sunucunun üretmediği kritik olaylar (gerçek olay kural kimlikleri: `cokus`, `kasa25`) tarayıcıda,
 * `week` iletisi ayrıştırılmadan önce `world_event` olarak enjekte edilir (canliAkis.spec.ts deseni); sunucu ve istemci kodu değişmez.
 */
function kritikOlayEnjekte(): void {
  type Ekle = (this: EventSource, type: string, fn: EventListenerOrEventListenerObject, opt?: boolean | AddEventListenerOptions) => void;
  type Dinleyen = EventSource & { __olayDinleyicileri?: EventListener[] };
  const asil = EventSource.prototype.addEventListener as unknown as Ekle;
  const cagir = (self: EventSource, fn: EventListenerOrEventListenerObject, ev: Event): void => {
    if (typeof fn === "function") fn.call(self, ev);
    else fn.handleEvent(ev);
  };
  const olaylar: Record<number, { id: string; textKey: string }> = { 3: { id: "cokus", textKey: "event.cokus" }, 5: { id: "kasa25", textKey: "event.kasa25" } };
  const yeniEkle: Ekle = function (type, fn, opt) {
    if (type === "world_event") ((this as Dinleyen).__olayDinleyicileri ??= []).push((e) => cagir(this, fn, e));
    if (type !== "week") return asil.call(this, type, fn, opt);
    const sar = (ev: Event): void => {
      const m = ev as MessageEvent<string>;
      cagir(this, fn, ev);
      const w = (JSON.parse(m.data) as { week: number }).week;
      const o = olaylar[w];
      if (!o) return;
      const olay = { id: `${o.id}:${w}`, week: w, kind: "bad", textKey: o.textKey, params: { hafta: w }, critical: true, sector: null, rule_ids: [o.id] };
      for (const l of (this as Dinleyen).__olayDinleyicileri ?? []) l(new MessageEvent("world_event", { data: JSON.stringify(olay) }));
    };
    return asil.call(this, type, sar, opt);
  };
  EventSource.prototype.addEventListener = yeniEkle as unknown as typeof EventSource.prototype.addEventListener;
}

test.describe("rehberli ilk oyun: canlı sunucu", () => {
  test.describe.configure({ mode: "serial" });
  let sunucu: CanliSunucu | null = null;
  test.beforeAll(async () => {
    sunucu = await sunucuBaslat();
  });
  test.afterAll(async () => {
    await sunucuDurdur(sunucu);
  });

  test("ilk kritik olayda bir kez durur; kural karta çözülmediği için genel Şartı değiştir", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(kritikOlayEnjekte);
    await page.goto(`http://127.0.0.1:${sunucu!.port}/oyun/?kaynak=canli#/kurucu/rehberli`);
    await page.getByLabel("Dünya adı").fill("Canlı İlk");
    await page.getByRole("button", { name: "Devam: Kuralları tanı (tur)" }).click();
    await tur(page).getByRole("button", { name: "Turu bitir" }).click();
    await page.getByRole("button", { name: "Devam: Başlat ve oynat" }).click();
    await page.getByRole("button", { name: "Başlat", exact: true }).click();
    await page.getByRole("button", { name: "16×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    const kutu = page.getByRole("dialog", { name: "Dünya durdu" });
    await expect(kutu).toBeVisible({ timeout: 60_000 });
    await expect(kutu).toBeFocused();
    await expect(kutu.getByText(/Açılacak kural/)).toHaveCount(0);
    await expect(kutu.getByRole("button", { name: "Bu kuralı değiştir" })).toHaveCount(0);
    await expect(kutu.getByRole("button", { name: "Şartı değiştir" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await kutu.getByRole("button", { name: "Devam et" }).click();
    await expect(kutu).toHaveCount(0);
    // İkinci kritik olay (5. hafta) dünyayı yeniden durdurmaz: koşu 5. haftayı geçer, kutu çıkmaz.
    await expect.poll(async () => Number(/Hafta (\d+) \/ 200/.exec((await page.getByRole("region", { name: "Oynatma denetimi" }).getByText(/Hafta \d+ \/ 200/).first().textContent()) ?? "")?.[1] ?? 0), { timeout: 60_000 }).toBeGreaterThan(7);
    await expect(page.getByRole("dialog", { name: "Dünya durdu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Duraklat" })).toBeVisible();
  });
});
