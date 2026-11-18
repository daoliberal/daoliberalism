import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";
import { expectNoA11yViolations, expectNoHorizontalScroll, isProject, waitForLayout } from "../../fidelity/helpers";

/**
 * Dilim 2 uçtan uca (E1): Başlangıç'tan Koşular'a bütün oyun, gerçek Python sunucusu alt süreçte. Varsayılan `FakeHost` (hızlı, belirlenimli);
 * `E2E_CANLI_MODEL=1` gerçek modeli koşar (yavaş: 6 dünya işi iptal edilir). Her proje kendi boş kapısında kendi sunucusunu açar.
 * Beş canlı ayar yayımlanan kayıttan çalışma anında seçilir (adlar sabit yazılmaz); beşten az canlı kart varsa test düşer (atlanmaz).
 */
const REPO = path.resolve(import.meta.dirname, "../../../..");
const SERVER_ROOT = path.join(REPO, "simulasyon", "arayuz", "server");
const REGISTRY = path.join(REPO, "apps", "web", "public", "oyun-kayit", "registry.json");
const OUT = path.resolve(import.meta.dirname, "../../out");
const MODEL = process.env.E2E_CANLI_MODEL === "1";
const PYTHON = process.env.E2E_PYTHON ?? "python3";
const ADDR = /http:\/\/127\.0\.0\.1:(\d+)\/oyun\//;
const HAFTA = /Hafta (\d+) \/ 200/;
const SN = (n: number): number => (MODEL ? n * 6 : n); // gerçek modelde hafta hedefleri büyür (koşu gerçekten çökebilir: sonuç başlığı üç hâli de kabul eder)

test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });

let port = 0;
let proc: ChildProcess | null = null;
let logDir = "";

function startServer(): Promise<{ child: ChildProcess; port: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: SERVER_ROOT, OYUN_LOG_DIR: logDir, OYUN_RUNS_DIR: path.join(logDir, "kosular"), OYUN_FAKE_STEP_MS: "30" };
  const child = spawn(PYTHON, ["-P", "-m", "oyun_server", "--host-kind", MODEL ? "model" : "fake", "--port", "0", "--web", OUT], { cwd: SERVER_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`sunucu başlamadı: ${out}`)), 60_000);
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
      const m = ADDR.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]) });
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`sunucu çıktı (${code}): ${out}`));
    });
  });
}

test.beforeAll(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "oyun-e2e-d2-"));
  const s = await startServer();
  proc = s.child;
  port = s.port;
});
test.afterAll(async () => {
  const c = proc;
  proc = null;
  if (c && c.exitCode === null && c.signalCode === null) await new Promise<void>((r) => { c.once("exit", () => r()); c.kill("SIGKILL"); });
  fs.rmSync(logDir, { recursive: true, force: true });
});

type Kart = { id: string; title: string; kind: string; layer: string; apply: string; editable: boolean; status: string; default: unknown; group: string; control: { min?: number; max?: number; step?: number; integer?: boolean } };
const kayit = (): Kart[] => (JSON.parse(fs.readFileSync(REGISTRY, "utf8")) as { cards: Kart[] }).cards;
const sayiKarti = (c: Kart): boolean => c.layer === "P" && c.kind === "number" && c.editable && c.status === "active";
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const virgul = (n: number): string => String(Math.round(n * 1e6) / 1e6).replace(".", ",");

/** Kurucu'da dokunulan kartlar: beş canlı ayar bunların dışından seçilir ("başlangıçta değiştirilmemiş"). */
const KURUCUDA_DEGISEN = ["ucret_stopaji"];
type Secim = { kart: Kart; deger: string };
/** Kayıtta `live`/`live_sync` olan, Kurucu'da değiştirilmemiş ilk beş sayı kartı ve her biri için varsayılandan farklı geçerli değer. */
function besCanliAyar(): Secim[] {
  const adaylar = kayit().filter((c) => sayiKarti(c) && (c.apply === "live" || c.apply === "live_sync") && !KURUCUDA_DEGISEN.includes(c.id));
  if (adaylar.length < 5) throw new Error(`BLOCKED: kayıtta beş canlı sayı kartı yok (${adaylar.length})`);
  return adaylar.slice(0, 5).map((kart) => {
    const d = Number(kart.default);
    const { min = 0, max = Number.POSITIVE_INFINITY, step = 1 } = kart.control;
    const yukari = d + 5 * step;
    const deger = yukari <= max ? yukari : Math.max(min, d - 5 * step);
    if (deger === d) throw new Error(`${kart.id}: varsayılandan farklı değer üretilemedi`);
    return { kart, deger: virgul(deger) };
  });
}
function kilitliKart(): Kart {
  const c = kayit().find((x) => sayiKarti(x) && x.apply === "start_only");
  if (!c) throw new Error("BLOCKED: kayıtta start_only sayı kartı yok");
  return c;
}

const url = (hash = ""): string => `http://127.0.0.1:${port}/oyun/?kaynak=canli${hash}`;
const apiBasliklari = (): Record<string, string> => ({ "X-Oyun-Istek": "1", Origin: `http://127.0.0.1:${port}` });
const saat = (page: Page) => page.getByRole("region", { name: "Oynatma denetimi" });
/** Kurucu şehir ekranında ayrı üst çubuk yok: ana menü ("Menü" düğmesi) açılır, kapalıysa açılıp grubu döner. */
async function menuAc(page: Page) {
  const grup = page.getByRole("group", { name: "Ana menü" });
  if (!(await grup.isVisible())) await page.getByRole("button", { name: "Menü", exact: true }).click();
  await expect(grup).toBeVisible();
  return grup;
}
const runOf = (u: string): string => /#\/canli\/([^/]+)/.exec(new URL(u).hash)?.[1] ?? /#\/(?:sonuc|canli)\/([^/]+)/.exec(new URL(u).hash)?.[1] ?? "";

async function hafta(page: Page): Promise<number> {
  const text = (await saat(page).getByText(HAFTA).first().textContent()) ?? "";
  return Number(HAFTA.exec(text)?.[1] ?? NaN);
}
async function ilerle(page: Page, hedef: number, hiz: "1×" | "4×" | "16×" = "16×"): Promise<void> {
  await page.getByRole("button", { name: hiz }).click();
  await page.getByRole("button", { name: "Oynat" }).click();
  await expect.poll(() => hafta(page), { timeout: MODEL ? 240_000 : 30_000 }).toBeGreaterThanOrEqual(hedef);
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible();
  // duraklatılmış koşu ilerlemez: ekran oturunca iki okuma arası hafta sabit
  await expect.poll(async () => { const a = await hafta(page); await new Promise((r) => setTimeout(r, 700)); return (await hafta(page)) === a; }, { timeout: 15_000 }).toBe(true);
}
type Izleme = {
  kotu: string[];
  /** Konsolda 404 olarak görünüp süzülen iletiler (yalnız `/api/runs/canli-<id>`). */
  suzulen: number;
  /** Ağdaki 404 yanıtları: tarayıcı konsolu yöntemi söylemez, bu yüzden yanıtlar ayrıca izlenir (yöntem ve adres). */
  yok404: { method: string; url: string }[];
  /** `POST /api/jobs` gövdeleri (6 dünya ve A/B tarifi takvimle gitti mi). */
  isler: { kind: string; recipe?: { schedule?: { week: number; patch: Record<string, unknown> }[] }; a?: { schedule?: unknown[] }; b?: { schedule?: unknown[] } }[];
};
function konsolIzle(page: Page): Izleme {
  const iz: Izleme = { kotu: [], suzulen: 0, yok404: [], isler: [] };
  page.on("console", (m) => {
    // Başsız Chromium'da yazılım GL (swiftshader) Pixi tuvali için kendi performans uyarısını yazar; uygulama hatası değildir.
    if (m.type() === "warning" && /GL Driver Message \(OpenGL, Performance/.test(m.text())) return;
    if (m.type() === "warning" && /^The resource \S+ was preloaded using link preload but not used within a few seconds/.test(m.text())) return;
    // Kapatılmış koşuyu "Aç" önce sunucuda arar: beklenen 404 (sonra tarifle yeniden kurar); tarayıcı bunu konsola yazar. Süzme yalnız bu adresle sınırlıdır;
    // yöntemin GET olduğu ve sayısı sonda ağ yanıtlarından denetlenir.
    if (m.type() === "error" && /status of 404/.test(m.text()) && /\/api\/runs\/canli-[0-9a-f]+$/.test(m.location().url)) {
      iz.suzulen += 1;
      return;
    }
    if (m.type() === "error" || m.type() === "warning") iz.kotu.push(`${m.type()}: ${m.text()} @ ${m.location().url}`);
  });
  page.on("pageerror", (e) => iz.kotu.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() === 404) iz.yok404.push({ method: r.request().method(), url: new URL(r.url()).pathname });
  });
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/jobs") iz.isler.push(r.postDataJSON() as Izleme["isler"][number]);
  });
  return iz;
}
/** Ekran denetimi: axe (iki tema) ve yatay kaydırma yok; proje genişliğine göre 1280 ya da 390. */
async function temiz(page: Page, info: TestInfo): Promise<void> {
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page, isProject(info, "mobile-dark") ? 390 : 1280);
}
const duzenleyici = (page: Page) => page.getByRole("region", { name: "Ekonomi Şartı düzenleyici" });

/** Arama kutusundan karta gider; kart, aramayı yapan kapsayıcıda (Kurucu düzenleyicisi ya da Şartı değiştir paneli) görünür. */
async function kartaGit(kap: ReturnType<typeof duzenleyici>, baslik: string) {
  await kap.getByRole("searchbox", { name: "Ara" }).fill(baslik);
  await kap.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: new RegExp(`^${esc(baslik)}`) }).first().click();
  const kart = kap.getByRole("article", { name: baslik, exact: true });
  await expect(kart).toBeVisible();
  return kart;
}

test("Başlangıç'tan Koşular'a: Kurucu, canlı koşu, şartı değiştir, dallanma, sonuç, koşular, yenile", async ({ page }, info) => {
  test.setTimeout(MODEL ? 3_000_000 : 360_000);
  const konsol = konsolIzle(page);
  let kapatilan = 0;                                  // Koşular'da sunucuda kapatılan açık koşu sayısı (404 üst sınırı)
  const secimler = besCanliAyar();
  const kilitli = kilitliKart();

  // ── Başlangıç → Ekonomi Kurucu
  await page.goto(url());
  await waitForLayout(page);
  await expect(page.getByRole("heading", { level: 1, name: "daoliberalism" })).toBeVisible();
  await temiz(page, info);
  await page.getByRole("button", { name: "Kurucu olarak başla →" }).click();
  await expect(page.getByRole("heading", { name: "Ekonomi Kurucu" })).toBeVisible();

  // ── Adım 1: rastgele isim iki kez (değişir), bir şehir adı elle
  const adlar = async (): Promise<string> => [await page.getByLabel("Dünya adı").inputValue(), ...(await Promise.all([1, 2, 3, 4, 5].map((n) => page.getByLabel(`Şehir ${n} adı`).inputValue())))].join("|");
  await page.getByRole("button", { name: "Rastgele isim" }).click();
  const ilkAd = await adlar();
  let ikinciAd = ilkAd;
  for (let i = 0; i < 6 && ikinciAd === ilkAd; i += 1) {
    await page.getByRole("button", { name: "Rastgele isim" }).click();
    ikinciAd = await adlar();
  }
  expect(ikinciAd).not.toBe(ilkAd);
  await page.getByLabel("Şehir 2 adı").fill("Gümüşkent");
  await expect(page.getByLabel("Şehir 2 adı")).toHaveValue("Gümüşkent");
  const dunyaAdi = await page.getByLabel("Dünya adı").inputValue();
  await temiz(page, info);

  // ── Adım 2: şablon "Dayanıklı taban"
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await temiz(page, info);
  await page.getByRole("button", { name: "Devam: Şartı yaz" }).click();
  const ed = duzenleyici(page);
  await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 0$/)).toBeVisible();

  // ── Adım 3: şartı yaz. Arama ile "ücret" → Ücret stopajı 12,5
  await ed.getByRole("searchbox", { name: "Ara" }).fill("ücret");
  await ed.getByRole("list", { name: "Arama sonuçları" }).getByRole("button", { name: /^Ücret stopajı/ }).click();
  const ucret = ed.getByRole("article", { name: "Ücret stopajı", exact: true });
  await ucret.getByRole("textbox").fill("12,5");
  await ucret.getByRole("textbox").blur();
  await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 1$/)).toBeVisible();
  // Kredi türleri: köprü kredisi kapalı
  const kopru = await kartaGit(ed, "Yerleşik firmalara köprü kredisi");
  await kopru.getByRole("group", { name: "Köprü kredisi" }).getByRole("button", { name: "kapalı", exact: true }).click();
  await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 2$/)).toBeVisible();
  // Bütçe sırası: ilk kalem iznin yarısına iner
  const butce = await kartaGit(ed, "Basım izninden tam pay alan giderler");
  await butce.getByRole("button", { name: /: iznin yarısına indir$/ }).first().click();
  await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 3$/)).toBeVisible();
  // Şehir kasası kuralı açık
  const kasa = await kartaGit(ed, "Şehir kasası kuralı");
  await kasa.getByRole("button", { name: "açık", exact: true }).click();
  await expect(ed.getByText(/^Kurallar: \d+ · değiştirdiğin: 4$/)).toBeVisible();
  await expect(ed.getByRole("list", { name: "Değiştirdiğin kurallar" }).getByRole("button", { name: /Ücret stopajı: %10 → %12,5/ })).toBeVisible();
  await temiz(page, info);

  // ── B katmanı: senaryo Özel, faize duyarlı davranışı aç
  await ed.getByRole("tab", { name: /B\. Dünyanın insanları/ }).click();
  await ed.getByRole("button", { name: "Bu dünyayı değiştir (dünya senaryosu)" }).click();
  await page.getByRole("dialog", { name: "Dünya senaryosu" }).getByRole("button", { name: /^Özel/ }).click();
  await expect(ed.getByText("Dünya senaryosu: Özel").first()).toBeVisible();
  await ed.getByRole("tab", { name: "Haneler" }).click();
  const faizDavranis = ed.getByRole("tabpanel", { name: "Haneler" }).getByRole("article", { name: "Faize duyarlı davranış" });
  await faizDavranis.getByRole("group", { name: "Hane harcaması faize duyarlı" }).getByRole("button", { name: "açık", exact: true }).click();
  await expect(faizDavranis.getByRole("group", { name: "Hane harcaması faize duyarlı" }).getByRole("button", { name: "açık", exact: true })).toHaveAttribute("aria-pressed", "true");
  await temiz(page, info);

  // ── C katmanı: başlangıç piyasası
  await ed.getByRole("tab", { name: /C\. Piyasa/ }).click();
  await expect(ed.getByRole("table", { name: "Piyasa göstergeleri" })).toBeVisible();
  await expect(ed.getByRole("table", { name: "Piyasa göstergeleri" }).getByText("Koşu başlayınca görünür").first()).toBeVisible();
  await temiz(page, info);

  // ── Adım 4: süre 200, başlangıç dünyası 3, hedefler
  await page.getByRole("button", { name: "Devam: Süre ve hedefler" }).click();
  await page.getByRole("button", { name: "200 hafta" }).click();
  await page.getByRole("button", { name: "Dünya 3" }).click();
  await expect(page.getByRole("button", { name: "Dünya 3" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("checkbox", { name: "200 hafta ayakta kal" }).check();
  await page.getByRole("checkbox", { name: "Şehir kasası tabana inmesin" }).check();
  await temiz(page, info);
  await page.getByRole("button", { name: "Devam: Özet" }).click();
  const ozet = page.getByRole("region", { name: "Kurulum" });
  await expect(ozet.getByText("Özel (Şart'a girmez)")).toBeVisible();
  await expect(ozet.getByText("Dünya 3")).toBeVisible();
  await temiz(page, info);

  // ── Başlat: 1× ve 16×
  await page.getByRole("button", { name: "Başlat", exact: true }).click();
  await expect(saat(page).getByText("Hafta 0 / 200")).toBeVisible();
  const kosu1 = runOf(page.url());
  expect(kosu1).toMatch(/^canli-/);
  await expect(page.getByText("canlı modelden")).toBeAttached(); // dar ekranda kaynak etiketi saat kartında gizlenir
  await expect(saat(page).getByText(dunyaAdi)).toBeAttached();
  await expect(page.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Oynat" }).click();
  await expect.poll(() => hafta(page), { timeout: MODEL ? 240_000 : 30_000 }).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect.poll(async () => { const a = await hafta(page); await new Promise((r) => setTimeout(r, 700)); return (await hafta(page)) === a; }, { timeout: 15_000 }).toBe(true);
  const w1x = await hafta(page);
  await ilerle(page, w1x + SN(6), "16×");
  const w16 = await hafta(page);
  expect(w16).toBeGreaterThan(w1x);
  await temiz(page, info);

  // ── Şartı değiştir: beş canlı ayar tek yamada
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: /Şartı değiştir · v1 → v2/ })).toBeVisible();
  const pe = panel as unknown as ReturnType<typeof duzenleyici>;
  for (const { kart, deger } of secimler) {
    const k = await kartaGit(pe, kart.title);
    await k.getByRole("textbox").fill(deger);
    await k.getByRole("textbox").blur();
  }
  await expect(panel.getByRole("list", { name: "Değiştirdiğin kurallar" }).getByRole("button")).toHaveCount(5);
  // kilitli kart: start_only, nedenli; "Yeni koşu olarak başlat" önerilir
  const kk = await kartaGit(pe, kilitli.title);
  await expect(kk.getByRole("textbox")).toBeDisabled();
  await expect(kk.getByRole("textbox")).toHaveAccessibleDescription(/Bu ayar yalnız yeni koşuda seçilebilir/);
  await expect(panel.getByRole("button", { name: "Yeni koşu olarak başlat" })).toBeVisible();
  await temiz(page, info);
  await page.getByRole("button", { name: /^Uygula \(en erken \d+\. hafta\)$/ }).click();
  const dikis = page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/);
  await expect(dikis).toBeVisible({ timeout: MODEL ? 180_000 : 30_000 });
  const seam = Number(/(\d+)\. haftadan sonrası/.exec((await dikis.textContent()) ?? "")?.[1]);
  expect(seam).toBeGreaterThanOrEqual(w16);
  const kosuP = runOf(page.url());

  // ilerle: yama iki sürüm olarak işler; olay akışında beş satır
  await ilerle(page, Math.max(seam + SN(3), SN(12)), "16×");
  const akis = (await ayrintilarAc(page, "Olaylar")).getByRole("region", { name: "Olay akışı" });
  for (const { kart } of secimler) await expect(akis.getByText(new RegExp(`^${esc(kart.title)}: .+ → .+$`))).toBeVisible();
  await expect((await ayrintilarAc(page, "Zaman çizgisi")).getByText(/^v2 · hafta/)).toBeVisible();
  await page.keyboard.press("Escape");

  // ── Şart okuyucusu: v1 / v2 farkı
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şart", exact: true }).click();
  const okuyucu = page.getByRole("dialog", { name: /Ekonomi Şartı/ });
  await okuyucu.getByRole("button", { name: "v2", exact: true }).click();
  await okuyucu.getByRole("button", { name: /^v1 → v2 farkı$/ }).click();
  await expect(okuyucu.getByRole("heading", { name: /^v1 → v2 farkı \(yürürlük hf \d+\)$/ })).toBeVisible();
  for (const { kart } of secimler) await expect(okuyucu.getByRole("listitem").filter({ hasText: kart.title }).first()).toBeVisible();
  await temiz(page, info);
  await page.keyboard.press("Escape");
  await expect(okuyucu).toHaveCount(0);

  // ── Dünya kapsamı / Şehir 2 / Zincir sekmesi, çekmece aç/kapat (tam ekran şehir kabuğu: Görünüm seçici yok)
  const genel = await ayrintilarAc(page, "Genel");
  await expect(genel.getByRole("group", { name: "Kapsam" }).getByRole("button", { name: "Dünya" })).toHaveAttribute("aria-pressed", "true");
  await temiz(page, info);
  // Şehir 2'ye geç (şehir seçici), harita katmanını aç; şehrin çekmecesi Genel'deki "en kötü şehir" bağlantısındandır.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Şehir", exact: true }).click();
  await page.getByRole("option", { name: /^Gümüşkent/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Gümüşkent" })).toBeVisible();
  await page.getByRole("button", { name: "Talep", exact: true }).click();
  await expect(page.getByRole("button", { name: "Talep", exact: true })).toHaveAttribute("aria-pressed", "true");
  await (await ayrintilarAc(page, "Genel")).getByRole("region", { name: "Sağlık başlığı" }).getByRole("button", { name: /^En kötü şehir/ }).click();
  const cekmece = page.getByRole("dialog");
  await expect(cekmece).toBeVisible();
  await temiz(page, info);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await temiz(page, info);
  const zincir = await ayrintilarAc(page, "Zincir");
  await expect(zincir.locator("[data-dugum]").first()).toBeVisible();
  await zincir.getByRole("list", { name: "En kıt halkalar" }).getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await temiz(page, info);
  await expect((await ayrintilarAc(page, "Olaylar")).getByRole("region", { name: "Ne olmuyor" })).toBeVisible();

  // ── Zaman çizgisinden hafta 10'dan dallan
  const zaman = (await ayrintilarAc(page, "Zaman çizgisi")).getByRole("region", { name: "Zaman çizgisi" });
  await zaman.getByLabel("Geçmiş hafta").fill("10");
  await zaman.getByRole("button", { name: "Bu haftadan dallan" }).click();
  await expect.poll(() => runOf(page.url()), { timeout: 60_000 }).not.toBe(kosuP);
  const kosuDal = runOf(page.url());
  await expect(page.getByRole("dialog", { name: "Simülasyon hesaplanıyor" })).toHaveCount(0, { timeout: MODEL ? 240_000 : 60_000 });
  await expect.poll(() => hafta(page), { timeout: 60_000 }).toBe(10);
  const liste0 = await page.request.get(`http://127.0.0.1:${port}/api/runs`, { headers: apiBasliklari() });
  const idler = ((await liste0.json()) as { runId: string }[]).map((x) => x.runId);
  expect(idler).toEqual(expect.arrayContaining([kosuP, kosuDal])); // dal yeni koşu açar, üst koşu kalır
  await ilerle(page, 10 + SN(3), "16×");
  expect(await hafta(page)).toBeGreaterThanOrEqual(10 + SN(3));
  await temiz(page, info);

  // ── Sonuç (üst koşu: sürüm takvimi var): karne, 6 dünya, A/B, paylaşım
  await page.goto(url(`#/sonuc/${kosuP}`));
  await waitForLayout(page);
  // Başlık koşu durumundan türetilir: üst koşu 200 haftaya varmadan duraklatıldı, bu yüzden "Çökmedi" olamaz; çöküş olayı varsa "Çöküş", yoksa "Ara durum".
  const kosuDurum = ((await (await page.request.get(`http://127.0.0.1:${port}/api/runs/${kosuP}`, { headers: apiBasliklari() })).json()) as { state: { week: number } }).state;
  const paketler = (await (await page.request.get(`http://127.0.0.1:${port}/api/runs/${kosuP}/weeks?from=1&to=${kosuDurum.week}`, { headers: apiBasliklari() })).json()) as { events: { id: string }[] }[];
  const cokus = paketler.some((p) => p.events.some((e) => e.id.startsWith("cokus:")));
  expect(kosuDurum.week).toBeLessThan(200);
  await expect(page.getByRole("heading", { name: cokus ? /^Çöküş: hafta \d+$/ : new RegExp(`^Ara durum: hafta ${kosuDurum.week} / 200$`) })).toBeVisible();
  const karne = page.getByRole("list", { name: "Hedefler" });
  await expect(page.getByRole("heading", { name: "Şart hedefleri karnesi" })).toBeVisible();
  await expect(karne.getByText(/200 hafta ayakta kal/)).toBeVisible();
  await expect(karne.getByText(/Şehir kasası tabana inmesin/)).toBeVisible();
  await temiz(page, info);
  const kod = page.getByRole("textbox", { name: "Şart kodu" });
  await expect(kod).toHaveValue(/^DAO1-[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const yuk = JSON.parse(Buffer.from(((await kod.inputValue()).split(".")[0] ?? "").slice("DAO1-".length), "base64url").toString("utf-8")) as { schedule?: { week: number; patch: Record<string, unknown> }[] };
  expect(yuk.schedule).toHaveLength(1);
  for (const { kart } of secimler) expect(yuk.schedule![0]!.patch, kart.id).toHaveProperty(kart.id);
  const dunya6 = page.getByRole("region", { name: "Aynı şartı 6 dünyada koş" });
  await page.getByRole("button", { name: "6 dünyada koş" }).click();
  // İş gövdesi koşunun takvimini taşır (yalnız çalışması yetmez): tek sürüm yaması, beş ayarın hepsi içinde
  await expect.poll(() => konsol.isler.find((j) => j.kind === "seeds") !== undefined).toBe(true);
  const dunyaIsi = konsol.isler.find((j) => j.kind === "seeds")!;
  expect(dunyaIsi.recipe?.schedule).toHaveLength(1);
  for (const { kart } of secimler) expect(dunyaIsi.recipe!.schedule![0]!.patch, kart.id).toHaveProperty(kart.id);
  if (MODEL) {
    await expect(dunya6.getByRole("progressbar", { name: "Altı dünyada koşunun ilerlemesi" })).toBeVisible({ timeout: 120_000 });
    await dunya6.getByRole("button", { name: "İptal et" }).click();
    await expect(page.getByRole("button", { name: "6 dünyada koş" })).toBeEnabled({ timeout: 120_000 });
  } else {
    await expect(dunya6.locator("[data-seri]")).toHaveCount(6, { timeout: 180_000 });
    await expect(dunya6.getByText(/dünyanın .* tanesi .* haftaya kadar çöktü|dünyanın hiçbiri .* haftaya kadar çökmedi/)).toBeVisible();
    await temiz(page, info);
  }
  const ab = page.getByRole("region", { name: "A/B karşılaştırma" });
  await ab.getByRole("group", { name: "B koşusu" }).getByRole("button").first().click();
  const abBekle = async (): Promise<void> => {
    await expect.poll(() => konsol.isler.find((j) => j.kind === "ab") !== undefined).toBe(true);
    const abIsi = konsol.isler.find((j) => j.kind === "ab")!;
    expect(abIsi.a?.schedule).toHaveLength(1);                          // A = bu koşu: sürüm takvimi taşınır
    expect(Array.isArray(abIsi.b?.schedule)).toBe(true);                // B de takvimli tarif olarak gider (dalın takvimi üst koşunun dallanma haftasına kadar kısmıdır)
  };
  if (MODEL) {
    await ab.getByRole("button", { name: "Karşılaştır" }).click();
    await abBekle();
    await expect(ab.getByRole("progressbar", { name: "Karşılaştırmanın ilerlemesi" })).toBeVisible({ timeout: 120_000 });
    await ab.getByRole("button", { name: "İptal et" }).click();
  } else {
    await ab.getByRole("button", { name: "Karşılaştır" }).click();
    await abBekle();
    await expect(ab.locator("[data-seri]")).toHaveCount(2, { timeout: 180_000 });
    await temiz(page, info);
  }

  // ── Sıfırdan başlat: aynı şartla yeni koşu, sürüm takvimi taşınır (v2)
  await page.goto(url(`#/canli/${kosuP}`));
  await waitForLayout(page);
  await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Sıfırdan başlat" }).click();
  await page.getByRole("dialog", { name: "Sıfırdan başlat" }).getByRole("button", { name: "Aynı şartla 0. haftadan" }).click();
  await expect.poll(() => runOf(page.url()), { timeout: 60_000 }).not.toBe(kosuP);
  const kosuYeni = runOf(page.url());
  const r = await page.request.get(`http://127.0.0.1:${port}/api/runs/${kosuYeni}`, { headers: apiBasliklari() });
  const durum = ((await r.json()) as { state: { versions?: { fromWeek: number; values: Record<string, unknown> }[] } }).state;
  expect(durum.versions?.length).toBe(2);
  expect(durum.versions?.[1]?.fromWeek).toBeGreaterThan(0);
  for (const { kart } of secimler) expect(durum.versions?.[1]?.values[kart.id], `v2 ${kart.id}`).not.toEqual(durum.versions?.[0]?.values[kart.id]);   // boş yamalı sürüm geçmez: beş ayarın hepsi v2'de farklı
  expect(secimler).toHaveLength(5);

  // ── Koşular: iki koşu kaydı, ağaç, dışa/içe aktar, takvimle yeniden kurma
  await (await menuAc(page)).getByRole("button", { name: "Koşular", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Koşular", exact: true })).toBeVisible();
  const acik = page.getByRole("region", { name: "Açık koşular" });
  // Kayıt kendiliğinden: açık her koşu (üst koşu, dal koşusu ve yeniden kurulan aynı adı taşır) kütüphanede kendi girdisiyle durur; Kaydet düğmesi yoktur.
  await expect(acik.getByRole("button", { name: /^Kaydet: / })).toHaveCount(0);
  expect(await acik.getByRole("button", { name: new RegExp(`^Kapat: ${esc(dunyaAdi)}`) }).count()).toBeGreaterThanOrEqual(2);
  const liste = page.getByRole("list", { name: "Kayıtlı koşular" });
  await expect(liste.getByRole("listitem").first()).toBeVisible();
  expect(await liste.getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  const agac = page.getByRole("list", { name: "Çatallanma ağacı" });
  await expect(agac.getByRole("listitem").filter({ hasText: /10\. haftada dallandı/ }).last()).toBeVisible(); // iç içe liste: dal, üst koşunun altında
  await liste.getByRole("listitem").first().getByRole("button", { name: /^Dışa aktar: / }).click();
  const disa = page.getByLabel("Dışa aktarılan koşu (JSON)");
  const json = (JSON.parse(await disa.inputValue()) as { runs: { id: string; name: string; recipe: { schedule?: unknown[] } }[] }).runs[0]!;
  expect(json.id).toMatch(/^canli-/);
  // çakışan kimlik içe aktarmada yeni kimlik alır
  await page.getByLabel("İçe aktar: koşu JSON'unu yapıştır").fill(JSON.stringify({ ...json, name: "İçe aktarılan koşu" }));
  await page.getByRole("button", { name: "İçe aktar", exact: true }).click();
  await expect(page.getByText("Koşu eklendi.")).toBeVisible();
  await expect(liste.getByRole("heading", { name: "İçe aktarılan koşu" })).toBeVisible();
  await temiz(page, info);

  // Açık koşuların hepsini sunucuda kapat; Aç kayıtlı tarifle (takvimli) yeniden kurar ve v2 olarak açılır
  const kapatDugmeleri = acik.getByRole("button", { name: /^Kapat: / });
  while ((await kapatDugmeleri.count()) > 0) {
    const kalan = await kapatDugmeleri.count();
    await kapatDugmeleri.first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Kapat", exact: true }).click();
    await expect(kapatDugmeleri).toHaveCount(kalan - 1);
    kapatilan += 1;
  }
  const ustKart = liste.getByRole("listitem").filter({ hasText: "2 şart sürümü" }).filter({ hasNotText: "İçe aktarılan koşu" }).last(); // en eski kart: oynanmış üst koşu (kayıtlı haftası şart değişikliğini aşar); "Sıfırdan başlat" koşusu 0. haftada kaldı
  await expect(ustKart).toBeVisible();
  await ustKart.getByRole("button", { name: /^Aç: / }).click();
  await expect(page).toHaveURL(/#\/canli\/canli-[0-9a-f]+/, { timeout: MODEL ? 240_000 : 60_000 });
  // yeniden kurma sürerken "Simülasyon hesaplanıyor" diyaloğu açıktır (gerçek modelde yarım dakika); bitince koşu kayıtlı haftada durur
  await expect(page.getByRole("dialog", { name: "Simülasyon hesaplanıyor" })).toHaveCount(0, { timeout: MODEL ? 300_000 : 60_000 });
  await expect(saat(page).getByText(HAFTA)).toBeVisible({ timeout: 60_000 });
  const kosuAc = runOf(page.url());
  const r2 = await page.request.get(`http://127.0.0.1:${port}/api/runs/${kosuAc}`, { headers: apiBasliklari() });
  const acDurum = ((await r2.json()) as { state: { versions?: { values: Record<string, unknown> }[] } }).state;
  expect(acDurum.versions?.length).toBe(2);
  for (const { kart } of secimler) expect(acDurum.versions?.[1]?.values[kart.id], `Aç v2 ${kart.id}`).not.toEqual(acDurum.versions?.[0]?.values[kart.id]);

  // ── Tema ve hareket düğmeleri (şehir ekranında ana menüde)
  const once = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
  await (await menuAc(page)).getByRole("button", { name: /^(Koyu|Açık) tema$/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "")).not.toBe(once);
  await temiz(page, info);
  await (await menuAc(page)).getByRole("button", { name: /^(Hareketi azalt|Hareket: azaltılmış)$/ }).click();
  await expect((await menuAc(page)).getByRole("button", { name: "Hareket: azaltılmış" })).toBeVisible();
  await (await menuAc(page)).getByRole("button", { name: /^(Koyu|Açık) tema$/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "")).toBe(once);
  await page.keyboard.press("Escape");

  // ── Yenile: koşu kaldığı haftadan sürer
  const hash = new URL(page.url()).hash;
  const wOnce = await hafta(page);
  await page.reload();
  await waitForLayout(page);
  await expect(page).toHaveURL(new RegExp(`${esc(hash)}$`));
  await expect.poll(() => hafta(page), { timeout: 60_000 }).toBe(wOnce);
  await expect((await ayrintilarAc(page, "Zaman çizgisi")).getByText(/^v2 · hafta/)).toBeVisible();
  await temiz(page, info);
  expect(konsol.kotu).toEqual([]);
  // Süzülen 404'ler: yalnız kapatılmış koşuyu "Aç"ın GET isteği; en az biri görüldü, kapatılan koşu sayısını aşmadı, DELETE ya da başka adres yok
  expect(konsol.yok404.length).toBeGreaterThanOrEqual(1);
  expect(konsol.yok404.length).toBeLessThanOrEqual(kapatilan);
  expect(konsol.yok404.every((x) => x.method === "GET" && /^\/api\/runs\/canli-[0-9a-f]+$/.test(x.url)), JSON.stringify(konsol.yok404)).toBe(true);
  expect(konsol.suzulen).toBeLessThanOrEqual(konsol.yok404.length);
});
