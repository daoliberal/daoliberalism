import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, isProject, waitForLayout } from "../../fidelity/helpers";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";

/**
 * Canlı uçtan uca (L4): gerçek Python sunucusu alt süreçte. Varsayılan `FakeHost` (hızlı, belirlenimli);
 * `E2E_CANLI_MODEL=1` gerçek modeli koşar (yavaş, varsayılan atlanır). Her işçi (proje) kendi boş kapısında kendi sunucusunu
 * açar (P-19); sunucu öldür-yeniden başlat adımı yalnız `desktop-light` projesinde.
 */
const REPO = path.resolve(import.meta.dirname, "../../../..");
const SERVER_ROOT = path.join(REPO, "simulasyon", "arayuz", "server");
const OUT = path.resolve(import.meta.dirname, "../../out");
const MODEL = process.env.E2E_CANLI_MODEL === "1";
const PYTHON = process.env.E2E_PYTHON ?? "python3";
const WEEK = /Hafta (\d+) \/ 200/;

test.describe.configure({ mode: "serial" });

let port = 0;
let proc: ChildProcess | null = null;
let logDir = "";

const ADDR = /http:\/\/127\.0\.0\.1:(\d+)\/oyun\//;

/** `--port 0`: işletim sistemi boş kapıyı verir, gerçek kapı sunucunun yazdığı adresten okunur (bırak-sonra-bağla yarışı yok).
 * Yeniden başlatmada aynı adres için önceki kapı verilir. */
function startServer(want: number): Promise<{ child: ChildProcess; port: number }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: SERVER_ROOT,
    OYUN_LOG_DIR: logDir,
    OYUN_RUNS_DIR: path.join(logDir, "kosular"), // koşular gerçek kosular/ dizinine değil geçici dizine yazılır
    OYUN_FAKE_STEP_MS: "30",
  };
  const child: ChildProcess = spawn(
    PYTHON,
    ["-P", "-m", "oyun_server", "--host-kind", MODEL ? "model" : "fake", "--port", String(want), "--web", OUT],
    { cwd: SERVER_ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`sunucu başlamadı: ${out}`)), 60_000);
    const onData = (b: Buffer) => {
      out += b.toString();
      const m = ADDR.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]) });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("exit", (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`sunucu çıktı (${code}): ${out}`));
    });
  });
}

function stopServer(child: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

test.beforeAll(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "oyun-e2e-"));
  const s = await startServer(0);
  proc = s.child;
  port = s.port;
});

test.afterAll(async () => {
  await stopServer(proc);
  proc = null;
  fs.rmSync(logDir, { recursive: true, force: true });
});

const url = (): string => `http://127.0.0.1:${port}/oyun/?kaynak=canli`;
async function open(page: Page, hash = ""): Promise<void> {
  await page.goto(`${url()}${hash}`);
  await waitForLayout(page);
}

async function week(page: Page): Promise<number> {
  const text = (await page.getByRole("region", { name: "Oynatma denetimi" }).getByText(WEEK).first().textContent()) ?? "";
  return Number(WEEK.exec(text)?.[1] ?? NaN);
}

/** İki okuma arası 700 ms hafta değişmediyse true (zamanlayıcı yalnız örnekleme aralığı; sonuç koşula bağlıdır). */
async function steady(page: Page): Promise<boolean> {
  const a = await week(page);
  await new Promise((r) => setTimeout(r, 700));
  return (await week(page)) === a;
}

async function kur(page: Page): Promise<void> {
  await open(page, "#/kurucu");
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  await page.getByLabel("Dünya adı").fill("Canlı Deneme");
  for (const [i, ad] of ["Akçe", "Bora", "Ceren", "Derya", "Elif"].entries()) {
    await page.getByLabel(`Şehir ${i + 1} adı`).fill(ad);
  }
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
}

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => {
    // Başsız Chromium'da yazılım GL (swiftshader) Pixi tuvali için kendi performans uyarısını yazar; uygulama hatası değildir.
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "warning" && /^The resource \S+ was preloaded using link preload but not used within a few seconds/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") bad.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
}

test.describe("canlı koşu uçtan uca", () => {
  test("kurucu, 16x oynat, şartı değiştir, devam, yenile, sunucu kopması", async ({ page }, testInfo) => {
    test.setTimeout(MODEL ? 600_000 : 120_000);
    const konsol = watchConsole(page);
    await kur(page);

    if (isProject(testInfo, "mobile-dark")) {
      await expectNoHorizontalScroll(page, 390);
      await page.getByRole("button", { name: "Başlat" }).click();
      await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText(WEEK)).toBeVisible();
      await expectNoHorizontalScroll(page, 390);
      expect(konsol).toEqual([]);
      return;
    }

    await page.getByRole("button", { name: "Başlat" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    expect(new URL(page.url()).hash).toMatch(/^#\/canli\/canli-/);
    await expect(page.getByText("canlı modelden")).toBeAttached(); // dar ekranda kaynak etiketi saat kartında gizlenir

    // 16x oynat (model hız sınırında "buffering" notu görünebilir), birkaç hafta sonra duraklat
    await page.getByRole("button", { name: "16×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    await expect.poll(() => week(page), { timeout: MODEL ? 180_000 : 30_000 }).toBeGreaterThanOrEqual(MODEL ? 6 : 8);
    await page.getByRole("button", { name: "Duraklat" }).click();
    await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
    // Duraklatılmış koşu ilerlemez: ekran (100 ms kare sınırı) oturunca iki okuma arası 700 ms hafta sabit kalır.
    await expect.poll(() => steady(page), { timeout: 15_000 }).toBe(true);
    const w0 = await week(page);
    expect(w0).toBeGreaterThanOrEqual(1);

    // Şartı değiştir (geçiş desteği): canlı dikiş bandı "N. haftadan sonrası"
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    await expect(page.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
    await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "kurtarma fonuyla" }).click();
    // Çok ayarlı tek yama: Vergiler grubunda ücret stopajı da değişir.
    await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Vergiler/ }).click();
    await page.getByRole("dialog").getByRole("article", { name: "Ücret stopajı" }).getByRole("textbox").fill("12,5");
    await page.getByRole("button", { name: /^Uygula \(en erken \d+\. hafta\)$/ }).click();
    await expect(page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/)).toBeVisible({ timeout: MODEL ? 120_000 : 30_000 });
    const seam = Number(/(\d+)\. haftadan sonrası/.exec((await page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/).textContent()) ?? "")?.[1]);
    expect(seam).toBeGreaterThanOrEqual(w0);

    // Devam: birkaç hafta daha. Sahte sunucu 16×'da ~33 hafta/sn koşar (200 hafta ~6 sn): yüklü makinede yoklama + tıklama arasında koşu bitip
    // Duraklat kilitlenir (bayat zamanlama varsayımı); bu yüzden devam 4×'da (~2 hafta/sn) oynatılır, duraklatma payı bol kalır.
    await page.getByRole("button", { name: "4×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    await expect.poll(() => week(page), { timeout: MODEL ? 180_000 : 30_000 }).toBeGreaterThanOrEqual(seam + 3);
    await page.getByRole("button", { name: "Duraklat" }).click();
    await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
    // Sürüm olayı iki ayarı da alt satır olarak sayar.
    // Olay akışı ve sürüm satırı Ayrıntılar penceresindedir (Olaylar ve Zaman çizgisi sekmeleri).
    const olaylar = await ayrintilarAc(page, "Olaylar");
    await expect(olaylar.getByRole("region", { name: "Olay akışı" }).getByText(/^Geçiş desteği: .* → kurtarma fonuyla$/)).toBeVisible();
    await expect(olaylar.getByRole("region", { name: "Olay akışı" }).getByText(/^Ücret stopajı: %10 → %12,5$/)).toBeVisible();
    const w1 = await week(page);
    await expect((await ayrintilarAc(page, "Zaman çizgisi")).getByText(/^v2 · hafta/)).toBeVisible(); // sürüm, dikiş haftasına gelince görünür
    expect(konsol).toEqual([]);

    // Yenile: koşu kaldığı haftadan sürer (kayıt kaynağındaki gibi 0'dan değil; K-L), sürüm 2
    const hash = new URL(page.url()).hash;
    await page.reload();
    await waitForLayout(page);
    await expect(page).toHaveURL(new RegExp(`${hash.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`));
    await expect.poll(() => week(page)).toBe(w1);
    expect(w1).toBeGreaterThan(0);
    await expect((await ayrintilarAc(page, "Zaman çizgisi")).getByText(/^v2 · hafta/)).toBeVisible();
    await page.keyboard.press("Escape");

    // Sunucu öldürülür: bağlantı koptu bandı; yeniden başlatılınca eski koşu kurulamaz (Review Focus 1)
    await stopServer(proc);
    await expect(page.getByText("Model sunucusuna ulaşılamıyor")).toBeVisible({ timeout: 30_000 });
    proc = (await startServer(port)).child; // aynı kapı: sayfa yenilenmeden kendiliğinden toparlanır
    await expect(page.getByText("Bu koşu kurulamadı")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Yeni koşu kur" })).toBeVisible();
    await page.getByRole("button", { name: "Yeni koşu kur" }).click();
    await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();
  });

  test("koşu sonunda bitiş kartı (state ardından ended)", async ({ page }, testInfo) => {
    test.skip(!isProject(testInfo, "desktop-light"));
    test.setTimeout(MODEL ? 1_200_000 : 180_000); // gerçek model: 200 hafta dakikalar sürer
    await kur(page);
    await page.getByRole("button", { name: "Başlat" }).click();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 0 / 200")).toBeVisible();
    await page.getByRole("button", { name: "16×" }).click();
    await page.getByRole("button", { name: "Oynat" }).click();
    await expect(page.getByRole("heading", { name: "200 hafta tamamlandı" })).toBeVisible({ timeout: MODEL ? 1_100_000 : 120_000 });
    // W9b: bitiş bir diyalogdur (Sonucu gör, Bu haftadan dallan, Sıfırdan başlat, Kapat); üst çubukta da "Sıfırdan başlat" vardır.
    await expect(page.getByRole("dialog", { name: "200 hafta tamamlandı" }).getByRole("button", { name: "Sıfırdan başlat" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Oynatma denetimi" }).getByText("Hafta 200 / 200")).toBeVisible();
  });
});
