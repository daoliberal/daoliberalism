import fs from "node:fs";
import path from "node:path";
import type { Page, Worker } from "@playwright/test";

/**
 * B9 olcum yardimcilari. Worker/Pyodide icine yalniz `olcumKancasi.ts` (bayrakli derleme) bakar; ana is parcacigi tarafi burada, sayfaya eklenen bir
 * baslangic betiğiyle (`Worker` sarmalayici) olculur: kaynak koda dokunmaz. Her olcum sayisal ham veri olarak JSON'a yazilir.
 */

/** Ana is parcacigi: oyun Worker'ina giden/gelen cagrilarin zamanlari ve hafta ilerlemesi. `window.__olcumIst`. */
export const GIRIS_BETIGI = `(() => {
  const Ist = (window.__olcumIst = { cagrilar: [], bekleyen: 0, sonMesaj: 0, bosluk: 0, enBuyukBosluk: 0, maxHafta: 0, mesaj: 0 });
  const simdi = () => performance.timeOrigin + performance.now();
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opt) {
      super(url, opt);
      if (!(opt && opt.name === "oyun-pyodide")) return;
      const beklemede = new Map();
      const pm = this.postMessage.bind(this);
      this.postMessage = (m, t) => {
        if (m && m.t === "cagri") {
          beklemede.set(m.id, { y: m.y, bas: simdi() });
          if (Ist.bekleyen === 0) Ist.sonMesaj = simdi();
          Ist.bekleyen++;
        }
        return pm(m, t);
      };
      this.addEventListener("message", (ev) => {
        const m = ev.data;
        const t = simdi();
        Ist.mesaj++;
        if (Ist.bekleyen > 0) Ist.bosluk = Math.max(Ist.bosluk, t - Ist.sonMesaj);
        Ist.sonMesaj = t;
        if (!m || m.t !== "yanit") return;
        const c = beklemede.get(m.id);
        if (!c) return;
        beklemede.delete(m.id);
        Ist.bekleyen--;
        Ist.cagrilar.push({ id: m.id, y: c.y, bas: c.bas, bit: t, tickMs: m.ok && m.s && typeof m.s.ms === "number" ? m.s.ms : null });
        if (m.ok && m.s && Array.isArray(m.s.olaylar)) {
          for (const a of m.s.olaylar) for (const o of a.olaylar || []) if (o.event === "week" && o.data && o.data.week > Ist.maxHafta) Ist.maxHafta = o.data.week;
        }
      });
    }
  };
})();`;

export interface Cagri {
  id: number;
  y: string;
  bas: number;
  bit: number;
  tickMs: number | null;
}

export interface AnaDurum {
  maxHafta: number;
  bekleyen: number;
  mesaj: number;
  /** Son okumadan beri, bekleyen cagri varken iki Worker mesaji arasindaki en buyuk sessizlik (ms); okuma sifirlar. */
  bosluk: number;
  yeniCagrilar: Cagri[];
  tepe: Record<string, number>;
  jsYigin: number | null;
}

/** Ana is parcacigi durumunu okur; bosluk ve cagri listesi sifirlanir (artimli okuma). */
export async function anaDurum(page: Page): Promise<AnaDurum> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __olcumIst?: { maxHafta: number; bekleyen: number; mesaj: number; bosluk: number; cagrilar: unknown[] };
      __oyunOlcum?: { tepe?: Record<string, number> };
    };
    const i = w.__olcumIst;
    if (!i) return { maxHafta: 0, bekleyen: 0, mesaj: 0, bosluk: 0, yeniCagrilar: [], tepe: {}, jsYigin: null };
    const bosluk = i.bosluk;
    i.bosluk = 0;
    const yeni = i.cagrilar.splice(0, i.cagrilar.length);
    const bellek = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return { maxHafta: i.maxHafta, bekleyen: i.bekleyen, mesaj: i.mesaj, bosluk, yeniCagrilar: yeni as never, tepe: w.__oyunOlcum?.tepe ?? {}, jsYigin: bellek?.usedJSHeapSize ?? null };
  });
}

export interface WorkerBellek {
  yasayan: number;
  arena: number;
  bos: number;
  gc_ms: number;
  yigin: number;
}

export interface GidenKayit {
  t: number;
  id: number | null;
  tur: string;
  postMs: number;
  yigin: number;
  tickMs?: number;
  haftalar?: { hafta: number; bayt: number }[];
}

/** Oyun Worker'i (`name: oyun-pyodide`); `page.workers()` URL'si paketleyiciye bagli oldugundan ada gore degil, kancali olana gore secilir. */
export async function isciBul(page: Page, zamanAsimi = 120_000): Promise<Worker> {
  const bas = Date.now();
  while (Date.now() - bas < zamanAsimi) {
    for (const w of page.workers()) {
      const var_ = await w.evaluate(() => typeof (self as unknown as { __oyunOlcum?: unknown }).__oyunOlcum !== "undefined").catch(() => false);
      if (var_) return w;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("isci_bulunamadi");
}

export async function isciBellek(w: Worker): Promise<WorkerBellek> {
  return w.evaluate(() => (self as unknown as { __oyunOlcum: { bellek(): WorkerBellek } }).__oyunOlcum.bellek());
}

/** Worker giden-yanit gunlugunun `bas` dizininden sonrasi (artimli okuma). */
export async function isciGunluk(w: Worker, bas: number): Promise<GidenKayit[]> {
  return w.evaluate((b) => (self as unknown as { __oyunOlcum: { gunluk: unknown[] } }).__oyunOlcum.gunluk.slice(b) as never, bas);
}

export async function isciYigin(w: Worker): Promise<number> {
  return w.evaluate(() => {
    const k = (self as unknown as { __oyunOlcum: { py?: { _module?: { HEAP8?: { length: number } } } } }).__oyunOlcum;
    return k.py?._module?.HEAP8?.length ?? 0;
  });
}

export interface DepoDurumu {
  depolama: { usage: number | null; quota: number | null };
  haftaKaydi: number;
  son: { hafta: number; ham: number; sikisik: number; zaman: number } | null;
  goruntuSayisi: number;
}

/** IndexedDB (`daoliberal-kayit`): hafta kaydi sayisi, en yeni goruntu (hafta/ham/sikisik) ve `navigator.storage.estimate()`. */
export async function depoDurumu(page: Page): Promise<DepoDurumu> {
  return page.evaluate(async () => {
    const tahmin = await navigator.storage?.estimate?.().catch(() => null);
    const db = await new Promise<IDBDatabase>((coz, red) => {
      const a = indexedDB.open("daoliberal-kayit");
      a.onsuccess = () => coz(a.result);
      a.onerror = () => red(a.error);
    });
    const say = (ad: string) =>
      new Promise<number>((coz, red) => {
        const r = db.transaction(ad, "readonly").objectStore(ad).count();
        r.onsuccess = () => coz(r.result);
        r.onerror = () => red(r.error);
      });
    const goruntuler = await new Promise<{ hafta: number; ham: number; sikisik: number; zaman: number }[]>((coz, red) => {
      const r = db.transaction("goruntuler", "readonly").objectStore("goruntuler").getAll();
      r.onsuccess = () => coz(r.result as never);
      r.onerror = () => red(r.error);
    });
    const haftaKaydi = await say("haftalar");
    db.close();
    goruntuler.sort((a, b) => b.hafta - a.hafta);
    const s = goruntuler[0];
    return {
      depolama: { usage: tahmin?.usage ?? null, quota: tahmin?.quota ?? null },
      haftaKaydi,
      son: s ? { hafta: s.hafta, ham: s.ham, sikisik: s.sikisik, zaman: s.zaman } : null,
      goruntuSayisi: goruntuler.length,
    };
  });
}

export interface KopruYaniti {
  status: number;
  body: unknown;
}

/** Kancali derlemede bridge nesnesi: kullanici yolu (LiveSource -> kopru) ile ayni `gonder`. */
export async function kopruGonder(page: Page, yontem: string, yol: string, govde?: unknown): Promise<KopruYaniti> {
  return page.evaluate(
    async ([y, p, g]) => {
      const k = (window as unknown as { __oyunOlcum?: { kopru?: { gonder(a: string, b: string, c?: unknown): Promise<{ status: number; body: unknown }> } } }).__oyunOlcum?.kopru;
      if (!k) throw new Error("kopru_yok");
      const r = await k.gonder(y as string, p as string, g);
      return { status: r.status, body: r.body };
    },
    [yontem, yol, govde ?? null] as const,
  );
}

export function medyan(d: number[]): number | null {
  if (d.length === 0) return null;
  const s = [...d].sort((a, b) => a - b);
  const o = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[o] ?? null) : (((s[o - 1] ?? 0) + (s[o] ?? 0)) / 2);
}

export function ciktiYaz(dizin: string, ad: string, veri: unknown): string {
  fs.mkdirSync(dizin, { recursive: true });
  const yol = path.join(dizin, ad);
  fs.writeFileSync(yol, JSON.stringify(veri, null, 1));
  return yol;
}
