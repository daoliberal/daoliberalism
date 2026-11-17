import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { waitForLayout } from "../helpers";
import { sunucuBaslat, sunucuDurdur, type CanliSunucu } from "./canliSunucu";

/**
 * Paylaşılan dünya, gerçek sunucuyla (T8b): yayınla (API) -> `/d/<kod>` sayfası `#/dao/d/<kod>`'a yönlenir -> dünya ve skor tablosu -> "Bu dünyada oyna" DAO koşusunu açar.
 * Sunucu `E2E_SUNUCU_PORT` (varsayılan 0: işletim sisteminden) kapısında kalkar; web aynı kökenden sunulur.
 */
const PORT = Number(process.env.E2E_SUNUCU_PORT ?? 0);

test.describe.configure({ mode: "serial" });

let sunucu: CanliSunucu | null = null;
test.beforeAll(async () => {
  sunucu = await sunucuBaslat({ port: PORT });
});
test.afterAll(async () => {
  await sunucuDurdur(sunucu);
});

const kok = (): string => `http://127.0.0.1:${sunucu!.port}`;
const OYUNCU = "e2e-oyuncu-0001";
const TARIF = { v: 1, templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 0, values: {} };

test("yayınlanan dünyanın bağlantısı dünya sayfasını açar ve orada oynanır", async ({ page }) => {
  const yanit = await page.request.post(`${kok()}/api/dunyalar`, {
    headers: { Origin: kok(), "X-Oyun-Istek": "1" },
    data: { tarif: TARIF, ad: "Kıtlık", aciklama: "Zor dünya", oyuncu: OYUNCU },
  });
  expect(yanit.status()).toBe(201);
  const { kod, baglanti } = (await yanit.json()) as { kod: string; baglanti: string };
  expect(baglanti).toBe(`/d/${kod}`);

  await page.goto(`${kok()}${baglanti}`);
  await page.waitForURL(new RegExp(`/oyun/\\?kaynak=canli#/dao/d/${kod}$`));
  await waitForLayout(page);
  await expect(page.getByRole("heading", { name: "Kıtlık" })).toBeVisible();
  await expect(page.getByText("Zor dünya")).toBeVisible();
  await expect(page.getByText("0 kez oynandı")).toBeVisible();
  await expect(page.getByText("Henüz kimse bu dünyada bir oyun bitirmedi.")).toBeVisible();

  await page.getByRole("button", { name: "Bu dünyada oyna" }).click();
  await page.waitForURL(/#\/dao\/[^/]+$/);
  await expect(page.getByRole("region", { name: "Oyun kontrolü" }).getByText("Hafta 0 / 520")).toBeVisible();
});

test("bilinmeyen kod: dünya bulunamadı", async ({ page }) => {
  await page.goto(`${kok()}/oyun/?kaynak=canli#/dao/d/ZZZZZZZ`);
  await waitForLayout(page);
  await expect(page.getByText("Bu kodla bir dünya bulunamadı.")).toBeVisible();
});

const EKRAN = process.env.EKRAN_DIZINI ?? "";
async function foto(page: Page, ad: string, proje: string): Promise<void> {
  if (EKRAN === "") return;
  fs.mkdirSync(EKRAN, { recursive: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(EKRAN, `dunya-${ad}-${proje.startsWith("mobile") ? "telefon-koyu" : "masaustu-acik"}.png`), fullPage: true });
}

test("bitmiş Kurucu koşusundan arayüzle yayınla, dünya sayfası ve Benim dünyalarım", async ({ page }, info) => {
  const baslik = { Origin: kok(), "X-Oyun-Istek": "1" };
  const kur = await page.request.post(`${kok()}/api/runs`, {
    headers: baslik,
    data: { config: { name: "Kıtlık", cityNames: ["Ada", "Bora", "Cem", "Dil", "Efe"], templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 0, values: {} } },
  });
  expect(kur.status()).toBe(201);
  const { runId } = (await kur.json()) as { runId: string };
  await page.request.post(`${kok()}/api/runs/${runId}/control`, { headers: baslik, data: { action: "play", speed: 16 } });
  await expect.poll(async () => ((await (await page.request.get(`${kok()}/api/runs/${runId}`)).json()) as { state: { status: string } }).state.status, { timeout: 60_000 }).toBe("ended");

  await page.goto(`${kok()}/oyun/?kaynak=canli#/sonuc/${runId}`);
  await waitForLayout(page);
  const bolum = page.getByRole("region", { name: "Dünyayı yayınla" }).or(page.locator("section").filter({ has: page.getByRole("heading", { name: "Dünyayı yayınla" }) }));
  await bolum.getByRole("button", { name: "Dünyayı yayınla" }).click();
  await bolum.getByLabel("Kısa açıklama").fill("Zor dünya");
  await bolum.scrollIntoViewIfNeeded();
  await foto(page, "yayinla-form", info.project.name);
  await bolum.getByRole("button", { name: "Yayınla" }).click();
  const baglanti = bolum.getByLabel("Paylaşım bağlantısı");
  await expect(baglanti).toHaveValue(new RegExp(`^${kok()}/d/[0-9A-Z]{7}$`));
  await bolum.scrollIntoViewIfNeeded();
  await foto(page, "yayinla-baglanti", info.project.name);
  const kod = (await baglanti.inputValue()).split("/d/")[1]!;

  await page.goto(`${kok()}/d/${kod}`);
  await page.waitForURL(new RegExp(`#/dao/d/${kod}$`));
  await expect(page.getByRole("heading", { name: "Kıtlık" })).toBeVisible();
  await foto(page, "dunya", info.project.name);

  await page.goto(`${kok()}/oyun/?kaynak=canli#/dao`);
  await page.getByRole("tab", { name: "Benim dünyalarım" }).click();
  await expect(page.getByRole("heading", { name: "Kıtlık" })).toBeVisible();
  await foto(page, "dunyalarim", info.project.name);
});
