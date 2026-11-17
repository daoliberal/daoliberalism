import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, waitForLayout } from "../helpers";
import { compareLines, expectedLines, type LineRange } from "./oyun-parity";
import { OYUN_EXCEPTIONS } from "./exceptions";
import { LIVE_FLOW_EXCEPTIONS } from "./exceptions/liveFlow";
import { ayrintilarAc, gorunumUrl, kosuKur, sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat();
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

/** Prototip satırları (W9b istisnalarıyla) sayfa metninde sırayla bulunmalı. `ekran` istisna ekranı adıdır. */
async function akisParity(page: Page, state: Record<string, unknown>, ekran: string, only: LineRange[], root = page.locator("body")): Promise<void> {
  const beklenen = expectedLines(state, ekran, only, [...OYUN_EXCEPTIONS.filter((e) => e.screen !== "live"), ...LIVE_FLOW_EXCEPTIONS]);
  expect(beklenen.length, `${ekran}: prototip satırı seçilmedi`).toBeGreaterThan(0);
  const { missing, orderBreak } = compareLines(beklenen, await root.innerText());
  expect(missing, `${ekran}: prototip satırları sayfada yok`).toEqual([]);
  expect(orderBreak, `${ekran}: sıra bozuk`).toBeNull();
}

/**
 * Gerçek sunucunun (FakeHost) üretmediği olay ve tanıyı akışa ekler: yalnız tarayıcıda, `week` iletisini ayrıştırmadan önce.
 * Biçim wire sözleşmesidir (`textKey` + `params`, `chain` adımları, `since_week`); sunucu ve istemci kodu değişmez.
 */
function olayVeTaniEnjekte(): void {
  type Ekle = (this: EventSource, type: string, fn: EventListenerOrEventListenerObject, opt?: boolean | AddEventListenerOptions) => void;
  type Dinleyen = EventSource & { __olayDinleyicileri?: EventListener[] };
  const asil = EventSource.prototype.addEventListener as unknown as Ekle;
  const cagir = (self: EventSource, fn: EventListenerOrEventListenerObject, ev: Event): void => {
    if (typeof fn === "function") fn.call(self, ev);
    else fn.handleEvent(ev);
  };
  const olay = {
    id: "cokus:3", week: 3, kind: "bad", textKey: "event.cokus", params: { hafta: 3 }, critical: true, sector: null, rule_ids: ["gecis_destegi"],
    chain: [
      { step: "a", textKey: "event.destek_basladi", params: { hafta: 2 } },
      { step: "b", textKey: "event.kasa25", params: { hafta: 3 } },
      { step: "c", textKey: "event.kredi_ret", params: { hafta: 3, sayi: 4 } },
      { step: "d", textKey: "event.batis10", params: { hafta: 3, sayi: 11 } },
      { step: "e", textKey: "event.ozellestirme", params: { hafta: 3 } },
    ],
  };
  const yeniEkle: Ekle = function (type, fn, opt) {
    if (type === "world_event") {
      const d = this as Dinleyen;
      (d.__olayDinleyicileri ??= []).push((e) => cagir(this, fn, e));
    }
    if (type !== "week") return asil.call(this, type, fn, opt);
    const sar = (ev: Event): void => {
      const m = ev as MessageEvent<string>;
      const p = JSON.parse(m.data) as { week: number; diagnostics?: unknown[] };
      if (p.week >= 3) p.diagnostics = [{ id: "faiz", textKey: "neolmuyor.faiz_dusmuyor", params: { hafta: 3 }, rule_ids: ["faiz_kurali"], since_week: 3 }];
      cagir(this, fn, new MessageEvent("week", { data: JSON.stringify(p), lastEventId: m.lastEventId }));
      // Olaylar istemcide hafta paketlerinden çıkarılır; sunucu olayı `world_event` iletisiyle gelir.
      if (p.week === 3) for (const l of (this as Dinleyen).__olayDinleyicileri ?? []) l(new MessageEvent("world_event", { data: JSON.stringify(olay) }));
    };
    return asil.call(this, type, sar, opt);
  };
  EventSource.prototype.addEventListener = yeniEkle as unknown as typeof EventSource.prototype.addEventListener;
}

/**
 * Olay akışı, Neden-sonuç, Ne olmuyor ve Zaman çizgisi artık Ayrıntılar penceresindedir (Olaylar ve Zaman çizgisi sekmeleri);
 * Sıfırdan başlat Koşu sekmesindeki düğmeyle, bitiş özeti kabuk diyaloğuyla (Koşu sekmesindeki "Bitiş özetini aç" ile yeniden) açılır.
 * Prototip satırları pencerenin ilgili sekme gövdesinde aranır.
 */
test.describe("canlı akış: süzgeç, zincir, Ne olmuyor, zaman çizgisi", () => {
  test("Olaylar ve Zaman çizgisi sekmeleri prototip satırlarını taşır, geçmiş hafta kutusu açılır", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port, 6);
    await page.goto(gorunumUrl(sunucu!.port, id, "dunya"));
    await waitForLayout(page);
    const pencere = await ayrintilarAc(page, "Olaylar");
    const akis = pencere.getByRole("region", { name: "Olay akışı" });
    await expect(akis.getByRole("group", { name: "Süzgeç" })).toBeVisible();
    await expect(pencere.getByRole("region", { name: "Ne olmuyor" })).toBeVisible();
    await expect(pencere.getByRole("region", { name: "Neden-sonuç zinciri" })).toBeVisible();
    // 30-32: Olay akışı + süzgeç; 34-35: zincir paneli ve boş durumu; 70-72: Ne olmuyor.
    await akisParity(page, { screen: "live" }, "live-flow", [{ from: 30, to: 32 }, { from: 34, to: 35 }, { from: 70, to: 72 }], pencere.getByRole("tabpanel"));
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);

    await akis.getByRole("button", { name: "Tümü" }).click();
    await expect(akis.getByRole("button", { name: "Tümü" })).toHaveAttribute("aria-pressed", "true");

    await ayrintilarAc(page, "Zaman çizgisi");
    const zaman = pencere.getByRole("region", { name: "Zaman çizgisi" });
    // 73-75: Zaman çizgisi (sürüm satırı, Geçmiş hafta).
    await akisParity(page, { screen: "live" }, "live-flow", [{ from: 73, to: 75 }], pencere.getByRole("tabpanel"));
    await zaman.getByLabel("Geçmiş hafta").fill("3");
    await expect(zaman.getByText(/^3\. hafta · karşılama/)).toBeVisible();
    await expect(zaman.getByRole("button", { name: "Bu haftadan dallan" })).toBeEnabled();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await zaman.getByRole("button", { name: "Bu haftanın olayları" }).click();
    // Olay süzgeci o haftaya daralır; Olay akışı Olaylar sekmesindedir.
    await ayrintilarAc(page, "Olaylar");
    await expect(akis.getByText("3. hafta olayları")).toBeVisible();
    await akis.getByRole("button", { name: "Tümünü göster" }).click();
    await expect(akis.getByText("3. hafta olayları")).toHaveCount(0);
  });

  test("sıfırdan başlat diyaloğu prototipi izler", async ({ page }) => {
    const id = await kosuKur(page, sunucu!.port, 3);
    await page.goto(gorunumUrl(sunucu!.port, id, "dunya"));
    await waitForLayout(page);
    const pencere = await ayrintilarAc(page, "Koşu ve kararlar");
    await pencere.getByRole("button", { name: "Sıfırdan başlat" }).click();
    const d = page.getByRole("dialog", { name: "Sıfırdan başlat" });
    await expect(d).toBeVisible();
    await akisParity(page, { screen: "live", confirmReset: true }, "live-reset", [{ from: 78, to: 82 }], d);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  });

  test("bitiş diyaloğu prototipi izler", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`http://127.0.0.1:${sunucu!.port}/oyun/?kaynak=canli#/kurucu`);
    await waitForLayout(page);
    await page.getByLabel("Dünya adı").fill("Bitiş");
    await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
    await page.getByRole("button", { name: "Dayanıklı taban" }).click();
    await page.getByRole("button", { name: "Başlat" }).click();
    await page.getByRole("button", { name: "16×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    const d = page.getByRole("dialog", { name: "200 hafta tamamlandı" });
    await expect(d).toBeVisible({ timeout: 200_000 });
    await akisParity(page, { screen: "live", endShow: true }, "live-end", [{ from: 78, to: 82 }], d);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    await d.getByRole("button", { name: "Kapat" }).click();
    await expect(d).toHaveCount(0);
    // Bitiş özeti pencereden yeniden açılır (Koşu ve kararlar > Bitiş kartı).
    const pencere = await ayrintilarAc(page, "Koşu ve kararlar");
    await expect(pencere.getByRole("region", { name: "200 hafta tamamlandı" })).toBeVisible();
  });

  test("dolu zincir, Ne olmuyor kartı ve Simülasyon hesaplanıyor diyaloğu prototipi izler", async ({ page }) => {
    await page.addInitScript(olayVeTaniEnjekte);
    await kosuKur(page, sunucu!.port, 5);
    await waitForLayout(page);
    const pencere = await ayrintilarAc(page, "Olaylar");
    const tani = pencere.getByRole("region", { name: "Ne olmuyor" });
    await expect(tani.getByText(/^Faiz düşmüyor/)).toBeVisible();
    // Prototip (hafta 40) 67-71: başlık, alt başlık, kart ("Neden:" satırı ve dünya varsayımı bağlantısı istisna), "Bu kuralı değiştir".
    await akisParity(page, { screen: "live", week: 40 }, "live-diag", [{ from: 67, to: 71 }], tani);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);

    const akis = pencere.getByRole("region", { name: "Olay akışı" });
    await akis.getByRole("button", { name: /talep karşılama %50 düzeyinin altına indi/ }).click();
    const zincir = pencere.getByRole("region", { name: "Neden-sonuç zinciri" });
    await expect(zincir.getByRole("list", { name: "Zincir adımları" }).getByRole("listitem")).toHaveCount(5);
    // Prototip (hafta 100, olay 0) 41-53: başlık, olay başlığı, adımlar ve oklar, ipucu, "Bu kuralı değiştir".
    await akisParity(page, { screen: "live", week: 100, selEvent: 0, chainStep: -1 }, "live-chain-full", [{ from: 41, to: 53 }], zincir);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);

    // Simülasyon hesaplanıyor: aynı koşu (sunucudaki açık koşu sınırı yüzünden yeni koşu kurulmaz). Dal isteği yanıtsız tutulur: diyalog "istek gitti" hâlinde görünür kalır.
    let birak!: () => void;
    const tutulan = new Promise<void>((r) => { birak = r; });
    await page.route("**/branch", async (route) => {
      await tutulan;
      await route.continue();
    });
    await ayrintilarAc(page, "Zaman çizgisi");
    const zaman = pencere.getByRole("region", { name: "Zaman çizgisi" });
    await zaman.getByLabel("Geçmiş hafta").fill("2");
    await zaman.getByRole("button", { name: "Bu haftadan dallan" }).click();
    const d = page.getByRole("dialog", { name: "Simülasyon hesaplanıyor" });
    await expect(d).toBeVisible();
    // Prototip (computing) 78-79: başlık beklenir; "Saat durdu..." satırı şart değişikliğinin metnidir, dal diyaloğu "Dal koşusu başlatılıyor." yazar.
    await akisParity(page, { screen: "live", computing: true }, "live-computing", [{ from: 78, to: 78 }], d);
    await expect(d.getByText("Dal koşusu başlatılıyor.")).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page, page.viewportSize()!.width);
    birak();
  });
});
