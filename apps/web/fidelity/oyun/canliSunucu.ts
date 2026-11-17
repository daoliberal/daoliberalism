import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { waitForLayout } from "../helpers";

/**
 * Canlı görünüm spec'leri için gerçek Python sunucusu (`--host-kind fake`: belirlenimli, hızlı), derlenmiş `out/` ile aynı kökenden.
 * Kapı `--port 0` ile işletim sisteminden gelir (kapı yarışı yok). `e2e/oyun/canli.spec.ts` ile aynı başlatma deseni.
 */
const REPO = path.resolve(import.meta.dirname, "../../../..");
const SERVER_ROOT = path.join(REPO, "simulasyon", "arayuz", "server");
const OUT = process.env.E2E_OUT ?? path.resolve(import.meta.dirname, "../../out");   // E2E_OUT: derlenmiş çıktı başka bir klasördeyse (çalışan sunucunun çıktısına dokunmadan)
const PYTHON = process.env.E2E_PYTHON ?? "python3";
const ADDR = /http:\/\/127\.0\.0\.1:(\d+)\/oyun\//;

export type CanliSunucu = { child: ChildProcess; port: number; logDir: string };

/** `port`: verilmezse işletim sisteminden (0; paralel koşularda çakışma olmaz). `kosuDizini`: verilmezse geçici günlük dizininde. */
export type SunucuSecenek = { port?: number; kosuDizini?: string; gercek?: boolean };

export function sunucuBaslat(secenek: SunucuSecenek = {}): Promise<CanliSunucu> {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "oyun-fid-"));
  const kosular = secenek.kosuDizini ?? path.join(logDir, "kosular");
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: SERVER_ROOT, OYUN_LOG_DIR: logDir, OYUN_RUNS_DIR: kosular, OYUN_FAKE_STEP_MS: "30" };
  // `gercek`: sahte sunucu yerine gerçek ekonomi modeli (OYUN_MODEL_ROOT depodaki modülerleştirme dizini; dışarıdan verilmişse o).
  if (secenek.gercek) env.OYUN_MODEL_ROOT = process.env.OYUN_MODEL_ROOT ?? path.join(REPO, "simulasyon", "kagit-ustu", "modulerlestirme");
  const child = spawn(PYTHON, ["-P", "-m", "oyun_server", "--host-kind", secenek.gercek ? "model" : (process.env.E2E_HOST ?? "fake"), "--port", String(secenek.port ?? 0), "--runs-dir", kosular, "--web", OUT], { cwd: SERVER_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL"); // süreç kapıyı tutmasın
      reject(new Error(`sunucu başlamadı: ${out}`));
    }, 60_000);
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
      const m = ADDR.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]), logDir });
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`sunucu çıktı (${code}): ${out}`));
    });
  });
}

export function sunucuDurdur(s: CanliSunucu | null): Promise<void> {
  return new Promise((resolve) => {
    if (!s || s.child.exitCode !== null || s.child.signalCode !== null) {
      if (s) fs.rmSync(s.logDir, { recursive: true, force: true });
      return resolve();
    }
    s.child.once("exit", () => {
      fs.rmSync(s.logDir, { recursive: true, force: true });
      resolve();
    });
    s.child.kill("SIGKILL");
  });
}

const HAFTA = /Hafta (\d+) \/ 200/;

/** Kurucu'dan canlı koşu başlatır, birkaç hafta oynatıp duraklatır; koşu kimliği hash'inden döner. */
export async function kosuKur(page: Page, port: number, hafta = 4): Promise<string> {
  await page.goto(`http://127.0.0.1:${port}/oyun/?kaynak=canli#/kurucu`);
  await waitForLayout(page);
  await page.getByLabel("Dünya adı").fill("Canlı Deneme");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  const saat = page.getByRole("region", { name: "Oynatma denetimi" });
  await expect(saat.getByText("Hafta 0 / 200")).toBeVisible();
  await page.getByRole("button", { name: "16×" }).click();
  await page.getByRole("button", { name: "Oynat" }).click();
  await expect.poll(async () => Number(HAFTA.exec((await saat.getByText(HAFTA).first().textContent()) ?? "")?.[1] ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(hafta);
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
  const m = /^#\/canli\/([^/]+)/.exec(new URL(page.url()).hash);
  if (!m) throw new Error("koşu kimliği yok");
  return m[1]!;
}

/**
 * Ekran görüntüsü için tema: boyut değişince `useIsNarrow` (dar=koyu) ve kayıtlı tercih `data-theme`'i kendileri yazar; bu yazımlar
 * bitene kadar istenen tema yeniden uygulanır ve art arda iki karede değişmediği doğrulanır (sabit bekleme yok). Pixi sahnesi
 * `data-theme` değişimini gözleyip yeniden çizer; son kare de beklenir.
 */
export async function temaUygula(page: Page, tema: "light" | "dark"): Promise<void> {
  await expect(async () => {
    await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, tema);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await expect(page.locator("html")).toHaveAttribute("data-theme", tema, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/**
 * Görüntü alma: `fullPage` ve öğe görüntüleri Chromium'da görünümü geçici olarak yeniden boyutlandırır; bu, `useIsNarrow`'u tetikleyip
 * `data-theme`'i tasarım temasına geri yazıyor (koyu görüntüler açık çıkıyordu). Bu yüzden görünüm yüksekliği sayfa boyuna çıkarılır
 * (genişlik aynı: ortam sorgusu değişmez), tema yeniden doğrulanır ve düz sayfa görüntüsü (gerekirse `clip` ile öğe) alınır.
 * Görünüm yüksekliği çağırandan sonra eski değerine döner.
 */
export async function goruntuAl(page: Page, dosya: string, tema: "light" | "dark", hedef?: Locator, hazir?: () => Promise<void>): Promise<void> {
  const vp = page.viewportSize()!;
  const olc = async (): Promise<{ x: number; y: number; width: number; height: number }> =>
    hedef!.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
  if (hedef && (await olc()).height <= vp.height - 8) {
    // Öğe görünüme sığıyor: yeniden boyutlandırma gerekmez (harita kutusu görünüm yüksekliğine bağlı olabilir).
    await hedef.scrollIntoViewIfNeeded();
    await temaUygula(page, tema);
    await hazir?.();
    await page.screenshot({ path: dosya, clip: await olc() });
    return;
  }
  const boy = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(boy, vp.height), 9000) });
  await temaUygula(page, tema);
  await hazir?.(); // yeniden boyutlanan içerik (ör. harita sığdırma) yerleşsin
  if (hedef) await page.screenshot({ path: dosya, clip: await olc() });
  else await page.screenshot({ path: dosya });
  await page.setViewportSize(vp);
}

/** Ayrıntılar penceresini açar ve verilen sekmeye (şerit adının bir kısmı) geçer; pencere zaten açıksa yalnız sekmeyi değiştirir. */
export async function ayrintilarAc(page: Page, sekme: string): Promise<Locator> {
  const pencere = page.getByRole("dialog", { name: "Ayrıntılar" });
  if (!(await pencere.isVisible())) await page.getByRole("button", { name: "Ayrıntılar", exact: true }).click();
  await expect(pencere).toBeVisible();
  await pencere.getByRole("tab", { name: sekme }).click();
  await expect(pencere.getByRole("tab", { name: sekme })).toHaveAttribute("aria-selected", "true");
  return pencere;
}

export const gorunumUrl = (port: number, id: string, gorunum: string): string => `http://127.0.0.1:${port}/oyun/?kaynak=canli#/canli/${id}/${gorunum}`;
