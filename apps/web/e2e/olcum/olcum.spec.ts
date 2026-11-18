import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { waitForLayout } from "../../fidelity/helpers";
import { ayrintilarAc } from "../../fidelity/oyun/canliSunucu";
import {
  GIRIS_BETIGI,
  anaDurum,
  ciktiYaz,
  depoDurumu,
  isciBellek,
  isciBul,
  isciGunluk,
  isciYigin,
  kopruGonder,
  medyan,
  type AnaDurum,
  type Cagri,
  type GidenKayit,
} from "./yardimci";

/**
 * B9 olcum (tek seferlik; tekrar yok). Yalniz `playwright.olcum.config.ts` ile kosar (`e2e:olcum`), normal e2e ve CI'a girmez.
 * `OLCUM_ETKINLIK`:
 *   uzun       DAO oyunu `OLCUM_HAFTA` hafta (520), en yuksek hiz (16x), bir DAO karari; her 13 haftada bir satir (Chromium 520; Firefox/WebKit 104)
 *   ilk        ilk acilis (soguk onbellek; kisitsiz ve 10 Mbit kisitli) + ikinci acilis (Service Worker'dan)
 *   devam      Kurucu kosusu: sart degisikligi, 12/52/104. haftada yenile -> devam suresi, 104'te dal (iki dunya bellek tepesi)
 *   arkaplan   DAO oyunu en yuksek hizda; sekme 3 dk gizlenir (basli Chromium: ikinci sekme one alinir)
 * Cikti: `OLCUM_CIKTI` dizininde JSON. Bayraksiz derlemede kanca yoktur: test baslarken kok kontrol edilir.
 */
test.skip(process.env.E2E_OLCUM !== "1", "tek seferlik tarayici olcumu: pnpm e2e:olcum");

const MOTOR = process.env.OLCUM_MOTOR ?? "chromium";
const HAFTA = Number(process.env.OLCUM_HAFTA ?? (MOTOR === "chromium" ? 520 : 104));
const ETKINLIK = process.env.OLCUM_ETKINLIK ?? "uzun";
const CIKTI = process.env.OLCUM_CIKTI ?? "test-results/olcum-cikti";
const ARKAPLAN_SN = Number(process.env.OLCUM_ARKAPLAN_SN ?? 180);
const KISIT_MBIT = Number(process.env.OLCUM_KISIT_MBIT ?? 10);

if (ETKINLIK === "arkaplan") test.use({ headless: false });

const DENETIM = (p: Page) => p.getByRole("region", { name: "Oynatma denetimi" });
const sn = (ms: number): number => Math.round(ms) / 1000;

function ortam(): Record<string, unknown> {
  return { motor: MOTOR, etkinlik: ETKINLIK, hedefHafta: HAFTA, zaman: new Date().toISOString() };
}

async function sayfaAc(context: BrowserContext, yol: string): Promise<Page> {
  await context.addInitScript(GIRIS_BETIGI);
  const page = await context.newPage();
  const konsol: string[] = [];
  page.on("pageerror", (e) => konsol.push(`pageerror: ${e.message}`));
  (page as unknown as { __konsol: string[] }).__konsol = konsol;
  await page.goto(yol);
  await waitForLayout(page);
  return page;
}

async function kancaVar(page: Page): Promise<void> {
  const var_ = await page.evaluate(() => typeof (window as unknown as { __oyunOlcum?: unknown }).__oyunOlcum !== "undefined");
  // Kok ilk `olcumKopru` cagrisiyla kurulur (kaynak hazir olunca); gelmediyse derleme bayraksizdir.
  if (!var_) throw new Error("olcum_kancasi_yok: derleme NEXT_PUBLIC_OYUN_OLCUM=1 ile yapilmali");
}

async function daoBaslat(page: Page): Promise<string> {
  await page.goto("/oyun/#/dao");
  await waitForLayout(page);
  const basla = page.getByRole("button", { name: "Başla", exact: true });
  await expect(basla).toBeEnabled({ timeout: 180_000 });
  await kancaVar(page);
  await basla.click();
  await expect(page.getByText(/Hafta 0 \/ 520/).first()).toBeVisible({ timeout: 120_000 });
  const m = /^#\/dao\/([^/]+)/.exec(new URL(page.url()).hash);
  if (!m) throw new Error("kosu_kimligi_yok");
  return decodeURIComponent(m[1] ?? "");
}

async function enYuksekHiz(page: Page, kosuId: string): Promise<void> {
  const r = await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/control`, { action: "play", speed: 16 });
  if (r.status !== 200) throw new Error(`control_${r.status}`);
}

async function haftayaKadar(page: Page, hafta: number, zamanAsimiMs: number): Promise<void> {
  const bas = Date.now();
  for (;;) {
    const d = await anaDurum(page);
    sonDurum.set(page, d);
    if (d.maxHafta >= hafta) return;
    if (Date.now() - bas > zamanAsimiMs) throw new Error(`hafta_zaman_asimi: ${d.maxHafta}/${hafta}`);
    await page.waitForTimeout(1000);
  }
}
const sonDurum = new WeakMap<Page, AnaDurum>();

// ---- uzun ------------------------------------------------------------------------------------------------------

interface Satir {
  hafta: number;
  etiket: number;
  zaman: number;
  bellek: { yasayan: number; arena: number; bos: number; gc_ms: number; yigin: number };
  yiginTepe: number;
  goruntu: { hafta: number; ham: number; sikisik: number } | null;
  goruntuSayisi: number;
  depolama: { usage: number | null; quota: number | null };
  haftaKaydi: number;
  jsYigin: number | null;
  yazimKuyruguTepe: number | null;
  bekciSessizTepeMs: number | null;
  enBuyukSessizlikMs: number;
}

test("uzun: DAO oyunu en yuksek hizda, her 13 haftada bir satir", async ({ context }) => {
  const sonuc: Record<string, unknown> = { ...ortam(), satirlar: [] as Satir[] };
  const satirlar = sonuc.satirlar as Satir[];
  const page = await sayfaAc(context, "/oyun/#/dao");
  let dustu: string | null = null;
  page.on("crash", () => (dustu = "sayfa_cokt"));
  try {
    const t0 = Date.now();
    const kosuId = await daoBaslat(page);
    const isci = await isciBul(page);
    sonuc.baslatMs = Date.now() - t0;
    sonuc.baslangicYigin = await isciYigin(isci);

    // Erken hafta: bir DAO karari (gunluk yolu); karar sonrasi en yuksek hizda oynat.
    const karar = await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/dao/karar`, { tur: "ahirdan_cik" });
    sonuc.daoKarar = { status: karar.status };
    await enYuksekHiz(page, kosuId);
    const oynatmaBas = Date.now();
    sonuc.oynatmaBasiZaman = oynatmaBas;

    let gunlukSon = 0;
    let tumGunluk: GidenKayit[] = [];
    let tumCagri: Cagri[] = [];
    let enBuyukSessizlik = 0;
    let sirada = 13;
    const tick: Record<number, number[]> = {};
    const topla = async (): Promise<void> => {
      const g = await isciGunluk(isci, gunlukSon);
      gunlukSon += g.length;
      tumGunluk = tumGunluk.concat(g);
      // Ayni tick'te her abone (kalicilik + arayuz) icin ayni hafta olayi gelir: hafta basina tek sure.
      for (const k of g) for (const hf of new Set((k.haftalar ?? []).map((h) => h.hafta))) if (k.tickMs !== undefined) (tick[hf] ??= []).push(k.tickMs);
    };
    const ilk = Date.now();
    for (;;) {
      const d = await anaDurum(page);
      tumCagri = tumCagri.concat(d.yeniCagrilar);
      enBuyukSessizlik = Math.max(enBuyukSessizlik, d.bosluk);
      if (dustu !== null) throw new Error(dustu);
      const hedef = Math.min(sirada + 2, HAFTA);
      if (d.maxHafta >= hedef) {
        await topla();
        const bel = await isciBellek(isci);
        const depo = await depoDurumu(page);
        const son = await anaDurum(page);
        satirlar.push({
          hafta: d.maxHafta,
          etiket: sirada,
          zaman: Date.now() - ilk,
          bellek: bel,
          yiginTepe: bel.yigin,
          goruntu: depo.son === null ? null : { hafta: depo.son.hafta, ham: depo.son.ham, sikisik: depo.son.sikisik },
          goruntuSayisi: depo.goruntuSayisi,
          depolama: depo.depolama,
          haftaKaydi: depo.haftaKaydi,
          jsYigin: son.jsYigin,
          yazimKuyruguTepe: son.tepe["yazimKuyrugu"] ?? null,
          bekciSessizTepeMs: son.tepe["bekciSessizMs"] ?? null,
          enBuyukSessizlikMs: enBuyukSessizlik,
        });
        tumCagri = tumCagri.concat(son.yeniCagrilar);
        console.log("OLCUM_SATIR", MOTOR, JSON.stringify({ hafta: d.maxHafta, yasayanMB: Math.round(bel.yasayan / 1048576), yiginMB: Math.round(bel.yigin / 1048576), gcMs: Math.round(bel.gc_ms), goruntu: depo.son, sn: sn(Date.now() - ilk) }));
        if (sirada >= HAFTA) break;
        sirada = Math.min(sirada + 13, HAFTA);
        if (sirada === HAFTA && d.maxHafta >= HAFTA) continue;
      }
      if (d.maxHafta >= HAFTA && sirada >= HAFTA) break;
      await page.waitForTimeout(1500);
    }
    await topla();
    const son = await anaDurum(page);
    tumCagri = tumCagri.concat(son.yeniCagrilar);
    sonuc.toplamMs = Date.now() - ilk;
    sonuc.tickHafta = Object.fromEntries(Object.entries(tick).map(([h, v]) => [h, v]));
    sonuc.cagrilar = ozetCagrilar(tumCagri);
    sonuc.giden = ozetGiden(tumGunluk, tumCagri);
    sonuc.bekleyenYazimSon = son.tepe;
    sonuc.konsol = (page as unknown as { __konsol: string[] }).__konsol;
  } catch (e) {
    sonuc.hata = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ciktiYaz(CIKTI, `uzun-${MOTOR}.json`, sonuc);
  }
});

function ozetCagrilar(c: Cagri[]): Record<string, { n: number; medyanMs: number | null; enBuyukMs: number }> {
  const o: Record<string, number[]> = {};
  for (const k of c) (o[k.y] ??= []).push(k.bit - k.bas);
  return Object.fromEntries(Object.entries(o).map(([y, v]) => [y, { n: v.length, medyanMs: medyan(v), enBuyukMs: Math.max(...v) }]));
}

/** K10: hafta olayi boyutu ve Worker -> ana tasima (gonderim anindan ana is parcacigi alim anina). Ayni cagri kimligi: ana `bit` - Worker `t`. */
function ozetGiden(g: GidenKayit[], c: Cagri[]): Record<string, unknown> {
  const bit = new Map(c.map((k) => [k.id, k]));
  const haftali = g.filter((k) => k.haftalar && k.haftalar.length > 0);
  const bayt = haftali.map((k) => (k.haftalar ?? []).reduce((a, h) => a + h.bayt, 0));
  const tasima = haftali.map((k) => (bit.get(k.id ?? -1)?.bit ?? NaN) - k.t).filter((x) => Number.isFinite(x));
  const post = haftali.map((k) => k.postMs);
  const paketSayisi = haftali.map((k) => (k.haftalar ?? []).length);
  return {
    haftaliTick: haftali.length,
    haftaOlayiSayisiOrt: paketSayisi.length ? paketSayisi.reduce((a, b) => a + b, 0) / paketSayisi.length : null,
    tickBaytMedyan: medyan(bayt),
    tickBaytEnBuyuk: bayt.length ? Math.max(...bayt) : null,
    postMsMedyan: medyan(post),
    postMsEnBuyuk: post.length ? Math.max(...post) : null,
    tasimaMsMedyan: medyan(tasima),
    tasimaMsEnBuyuk: tasima.length ? Math.max(...tasima) : null,
    tickMsEnBuyuk: Math.max(0, ...g.map((k) => k.tickMs ?? 0)),
  };
}

// ---- ilk -------------------------------------------------------------------------------------------------------

interface AcilisSonucu {
  formMs: number;
  asamaMs: unknown;
  indirilenBayt: number | null;
  istekSayisi: number;
}

async function acilisOlc(page: Page): Promise<AcilisSonucu> {
  let bayt = 0;
  let n = 0;
  page.on("requestfinished", (r) => {
    n++;
    void r.sizes().then((s) => (bayt += s.responseBodySize + s.responseHeadersSize), () => undefined);
  });
  const t0 = Date.now();
  await page.goto("/oyun/#/kurucu");
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 600_000 });
  const formMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const asama = await page.evaluate(() => (performance.getEntriesByName("oyun-tarayici-hazir")[0] as PerformanceMark | undefined)?.detail ?? null);
  return { formMs, asamaMs: asama, indirilenBayt: bayt, istekSayisi: n };
}

test("ilk: soguk kisitsiz, soguk kisitli, ikinci acilis (SW)", async ({ browser }) => {
  const sonuc: Record<string, unknown> = { ...ortam() };
  try {
    // 1) soguk, kisitsiz
    const c1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p1 = await c1.newPage();
    const soguk = await acilisOlc(p1);
    sonuc.sogukKisitsiz = soguk;
    // 2) ikinci acilis: SW onbellegi hazir olana dek bekle (on onbellek), sonra yeni sayfa
    await p1.waitForTimeout(15_000);
    sonuc.swDurumu = await p1.evaluate(async () => {
      const r = await navigator.serviceWorker?.getRegistration?.();
      return { var: !!r, aktif: r?.active?.state ?? null };
    });
    await p1.close();                                // tek sekme kilidi: ikinci acilis oncekini kapatmayi gerektirir
    const p1b = await c1.newPage();
    sonuc.ikinciAcilis = await acilisOlc(p1b);
    await p1b.close();
    await c1.close();
    // 3) soguk, kisitli (CDP: Chromium)
    if (MOTOR === "chromium") {
      const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p2 = await c2.newPage();
      const cdp = await c2.newCDPSession(p2);
      await cdp.send("Network.enable");
      const bps = (KISIT_MBIT * 1_000_000) / 8;
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: bps, uploadThroughput: bps / 4 });
      const kisitli = await acilisOlc(p2);
      sonuc.sogukKisitli = { ...kisitli, kisitMbit: KISIT_MBIT, gecikmeMs: 40 };
      await c2.close();
    }
  } finally {
    ciktiYaz(CIKTI, `ilk-${MOTOR}.json`, sonuc);
  }
});

// ---- devam + dal -----------------------------------------------------------------------------------------------

async function kurucuBaslat(page: Page): Promise<void> {
  await page.goto("/oyun/#/kurucu");
  await waitForLayout(page);
  await expect(page.getByLabel("Dünya adı")).toBeVisible({ timeout: 180_000 });
  await kancaVar(page);
  await page.getByLabel("Dünya adı").fill("Olcum");
  await page.getByRole("button", { name: "Devam: Şablondan başla" }).click();
  await page.getByRole("button", { name: "Dayanıklı taban" }).click();
  await page.getByRole("button", { name: "Başlat" }).click();
  await expect(DENETIM(page).getByText("Hafta 0 / 200")).toBeVisible({ timeout: 120_000 });
}

async function kurucuHafta(page: Page): Promise<number> {
  const metin = (await DENETIM(page).getByText(/Hafta (\d+) \/ 200/).first().textContent()) ?? "";
  return Number(/Hafta (\d+) \//.exec(metin)?.[1] ?? NaN);
}

async function oynatHaftayaKadar(page: Page, hafta: number): Promise<void> {
  await page.getByRole("button", { name: "16×" }).click();
  await page.getByRole("button", { name: "Oynat" }).click();
  await haftayaKadar(page, hafta, 4 * 3600_000);
  await page.getByRole("button", { name: "Duraklat" }).click();
  await expect(page.getByRole("button", { name: "Oynat" })).toBeVisible({ timeout: 60_000 });
}

async function yenileOlc(page: Page, beklenen: number): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  await page.reload();
  await waitForLayout(page);
  await expect(DENETIM(page).getByText(new RegExp(`Hafta ${beklenen} /`)).first()).toBeVisible({ timeout: 900_000 });
  const ms = Date.now() - t0;
  const d = await anaDurum(page);
  const devamCagrilari = d.yeniCagrilar.filter((c) => c.y === "devam" || c.y === "tariftenOynat").map((c) => ({ y: c.y, ms: Math.round(c.bit - c.bas) }));
  const asama = await page.evaluate(() => (performance.getEntriesByName("oyun-tarayici-hazir")[0] as PerformanceMark | undefined)?.detail ?? null);
  return { beklenenHafta: beklenen, toplamMs: ms, devamCagrilari, yuklemeAsamaMs: asama };
}

test("devam: sart degisikligi, 12/52/104. haftada yenile, 104'te dal", async ({ page, context }) => {
  const sonuc: Record<string, unknown> = { ...ortam() };
  await context.addInitScript(GIRIS_BETIGI);
  try {
    await kurucuBaslat(page);
    for (let i = 1; i <= 2; i += 1) {
      await page.getByRole("button", { name: "Tek hafta" }).click();
      await expect(DENETIM(page).getByText(new RegExp(`Hafta ${i} /`))).toBeVisible({ timeout: 120_000 });
    }
    await (await ayrintilarAc(page, "Koşu ve kararlar")).getByRole("button", { name: "Şartı değiştir" }).click();
    await page.getByRole("dialog").getByRole("navigation", { name: "Ayar grupları" }).getByRole("button", { name: /Kurtarma ve geçiş/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "kurtarma fonuyla" }).click();
    await page.getByRole("button", { name: /^Uygula \(en erken \d+\. hafta\)$/ }).click();
    const dikis = page.getByText(/\d+\. haftadan sonrası seçilen kuralla hesaplanıyor/);
    await expect(dikis).toBeVisible({ timeout: 120_000 });
    sonuc.sartSeam = Number(/(\d+)\. haftadan sonrası/.exec((await dikis.textContent()) ?? "")?.[1]);
    await page.keyboard.press("Escape");

    await oynatHaftayaKadar(page, 12);
    let w = await kurucuHafta(page);
    sonuc.yenile12 = { onceHafta: w, ...(await yenileOlc(page, w)) };

    const gor = async (h: number): Promise<number> => {
      for (let i = 0; i < 600; i++) {
        const d = await depoDurumu(page);
        if (d.son !== null && d.son.hafta >= h) return d.son.hafta;
        await page.waitForTimeout(1000);
      }
      throw new Error(`goruntu_yok_${h}`);
    };
    await oynatHaftayaKadar(page, 52);
    await gor(39);
    w = await kurucuHafta(page);
    const d52 = await depoDurumu(page);
    sonuc.yenile52 = { onceHafta: w, goruntu: d52.son, ...(await yenileOlc(page, w)) };

    await oynatHaftayaKadar(page, 104);
    await gor(91);
    w = await kurucuHafta(page);
    const d104 = await depoDurumu(page);
    sonuc.yenile104 = { onceHafta: w, goruntu: d104.son, ...(await yenileOlc(page, w)) };

    // dal: 104'te yenilendikten sonra Worker taze; dal iki dunya olusturur (goruntuden devam). Yigin ve yasayan once/sonra.
    const isci = await isciBul(page);
    const once = await isciBellek(isci);
    const kosuId = /^#\/canli\/([^/]+)/.exec(new URL(page.url()).hash)?.[1];
    const bas = Date.now();
    const dal = await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId ?? "")}/branch`, { week: w });
    const dalMs = Date.now() - bas;
    const sonra = await isciBellek(isci);
    sonuc.dal = { status: dal.status, ms: dalMs, once, sonra, yiginArtisMB: (sonra.yigin - once.yigin) / 1048576 };
    sonuc.konsol = (page as unknown as { __konsol?: string[] }).__konsol ?? [];
  } catch (e) {
    sonuc.hata = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ciktiYaz(CIKTI, `devam-${MOTOR}.json`, sonuc);
  }
});

// ---- arkaplan --------------------------------------------------------------------------------------------------

test("arkaplan: sekme gizliyken oyun ilerler mi, bekci tetiklenir mi", async ({ context }) => {
  const sonuc: Record<string, unknown> = { ...ortam(), arkaplanSn: ARKAPLAN_SN };
  const page = await sayfaAc(context, "/oyun/#/dao");
  try {
    const kosuId = await daoBaslat(page);
    await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/dao/karar`, { tur: "ahirdan_cik" });
    await enYuksekHiz(page, kosuId);
    await haftayaKadar(page, 8, 600_000);          // isinma
    const olc = async (saniye: number): Promise<{ haftalar: number; ms: number; bosluk: number }> => {
      const a = await anaDurum(page);
      const bas = Date.now();
      await page.waitForTimeout(saniye * 1000);
      const b = await anaDurum(page);
      return { haftalar: b.maxHafta - a.maxHafta, ms: Date.now() - bas, bosluk: b.bosluk };
    };
    sonuc.onPlan = await olc(ARKAPLAN_SN);
    // Ayni pencerede yeni SEKME: `window.open` onde acilir ve oyun sekmesi gizlenir (context.newPage ayri pencere acar; gorunurluk degismez).
    const [ikinci] = await Promise.all([context.waitForEvent("page"), page.evaluate(() => void window.open("about:blank", "_blank"))]);
    await ikinci.bringToFront();
    // Playwright her sayfada odak/gorunurluk taklidi acik tutar; gercek sekme gizlenmesi icin kapatilir.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await page.waitForTimeout(2000);
    sonuc.gorunurluk = await page.evaluate(() => document.visibilityState);
    sonuc.arkaPlan = await olc(ARKAPLAN_SN);
    sonuc.tepe = (await anaDurum(page)).tepe;
    await page.bringToFront();
    await page.waitForTimeout(3000);
    sonuc.geriDonus = await page.evaluate(() => ({ gorunurluk: document.visibilityState, dustu: !!document.body.innerText.match(/Oyun motoru durdu/) }));
    const isci = await isciBul(page);
    sonuc.worker = await isciYigin(isci);
  } catch (e) {
    sonuc.hata = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ciktiYaz(CIKTI, `arkaplan-${MOTOR}.json`, sonuc);
  }
});

// ---- devamdao: gercek DAO dunyasinda yenile + dal ---------------------------------------------------------------

async function daoHafta(page: Page): Promise<number> {
  const metin = (await page.getByText(/Hafta (\d+) \/ 520/).first().textContent()) ?? "";
  return Number(/Hafta (\d+) \//.exec(metin)?.[1] ?? NaN);
}

async function daoDurakla(page: Page, kosuId: string): Promise<number> {
  await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/control`, { action: "pause" });
  // DAO duraklatmasi hesaplanan bir haftayi daha yayimlayabilir: haftanin oturmasini bekle.
  let onceki = -1;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1500);
    const h = await daoHafta(page);
    if (h === onceki && !(await page.getByText("Hafta hesaplanıyor.").isVisible().catch(() => false))) return h;
    onceki = h;
  }
  return onceki;
}

test("devamdao: DAO dunyasinda 12/52/104. haftada yenile, 104'te dal", async ({ context }) => {
  const sonuc: Record<string, unknown> = { ...ortam() };
  const page = await sayfaAc(context, "/oyun/#/dao");
  try {
    let kosuId = await daoBaslat(page);
    await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/dao/karar`, { tur: "ahirdan_cik" });
    const bekleGoruntu = async (h: number): Promise<void> => {
      for (let i = 0; i < 900; i++) {
        const d = await depoDurumu(page);
        if (d.son !== null && d.son.hafta >= h) return;
        await page.waitForTimeout(1000);
      }
      throw new Error(`goruntu_yok_${h}`);
    };
    const yenile = async (ad: string): Promise<void> => {
      const w = await daoDurakla(page, kosuId);
      const depo = await depoDurumu(page);
      const t0 = Date.now();
      await page.reload();
      await waitForLayout(page);
      await expect(page.getByText(new RegExp(`Hafta ${w} / 520`)).first()).toBeVisible({ timeout: 1_200_000 });
      const ms = Date.now() - t0;
      const d = await anaDurum(page);
      sonuc[ad] = { onceHafta: w, goruntu: depo.son, toplamMs: ms, devamCagrilari: d.yeniCagrilar.filter((c) => c.y === "devam" || c.y === "tariftenOynat").map((c) => ({ y: c.y, ms: Math.round(c.bit - c.bas) })) };
    };
    const devamEt = async (h: number): Promise<void> => {
      await enYuksekHiz(page, kosuId);
      await haftayaKadar(page, h, 4 * 3600_000);
    };
    await devamEt(12);
    await yenile("yenile12");
    await devamEt(52);
    await bekleGoruntu(52);
    await yenile("yenile52");
    await devamEt(104);
    await bekleGoruntu(104);
    await yenile("yenile104");
    const isci = await isciBul(page);
    const once = await isciBellek(isci);
    const w = await daoHafta(page);
    kosuId = decodeURIComponent(/^#\/dao\/([^/]+)/.exec(new URL(page.url()).hash)?.[1] ?? kosuId);
    const bas = Date.now();
    const dal = await kopruGonder(page, "POST", `/api/runs/${encodeURIComponent(kosuId)}/branch`, { week: w });
    const dalMs = Date.now() - bas;
    const sonra = await isciBellek(isci);
    sonuc.dal = { status: dal.status, hafta: w, ms: dalMs, once, sonra, yiginArtisMB: (sonra.yigin - once.yigin) / 1048576 };
  } catch (e) {
    sonuc.hata = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    ciktiYaz(CIKTI, `devamdao-${MOTOR}.json`, sonuc);
  }
});
