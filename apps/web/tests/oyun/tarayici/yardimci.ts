import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import type { HaftaPaketi } from "@/oyun/tarayici/kayit/tel";
import type { IsciCagrisi } from "@/oyun/tarayici/kayitCekirdegi";
import { PYODIDE_SURUMU, type AboneOlaylari, type AnaMesaj, type HataTel, type IsciMesaji, type IstekYaniti, type Manifest, type OlayTel, type TickSonucu, type YontemAdi, type YontemGirdisi, type YontemSonucu } from "@/oyun/tarayici/protokol";
import type { CagriSecenegi, WorkerBaglantisi } from "@/oyun/tarayici/yukleyici";
import { ANAHTAR, SahteCekirdek } from "./kayit/yardimci";

export interface Ertelenmis<T = void> {
  promise: Promise<T>;
  coz(v: T): void;
}
export function ertele<T = void>(): Ertelenmis<T> {
  let coz!: (v: T) => void;
  const promise = new Promise<T>((c) => (coz = c));
  return { promise, coz };
}

interface SahteKosu {
  id: string;
  oynuyor: boolean;
  /** Python penceresi: bu haftaya kadar olanlar pencere disidir (`arsiv_gerek`). */
  pencereTaban: number;
  /** Abonelikte tekrar oynatilan (hizli ileri sarilmis) haftalar: 1..n. */
  pencere?: number;
}

/**
 * Worker protokolu duzeyinde sahte (Python yerine): istekler SIRAYLA islenir (tek is parcacigi). `tick` kapisi ile bir hafta adiminin
 * uzun surmesi taklit edilir: kapi acilana dek sonraki cagrilar kuyrukta bekler.
 */
export class SahteIsci implements IsciCagrisi {
  cagrilar: { y: string; a: unknown }[] = [];
  kosular = new Map<string, SahteKosu>();
  aboneler = new Map<number, { kosuId: string; kuyruk: OlayTel[]; sira: number; kapali: boolean }>();
  private sonAbone = 0;
  private sonKosu = 0;
  /** Her tick bu kapiyi bekler (varsa). */
  tickKapisi: (() => Promise<void>) | null = null;
  tickMs = 3000;
  p50: (number | null)[] = [];
  olusturulan: string[] = [];
  /** Dal olusturulurken hizli ileri sarilan hafta sayisi (abonelik penceresinde `week` olayi olarak gelir). */
  branchHaftalari = 0;
  kapatildi = false;
  /** Bekci testleri: Worker'dan gelen mesaj sayisi ve bekleyen cagri sayisi (elle surulur). */
  mesajlar = 0;
  bekleyenCagri = 0;
  /** `istek`: bu dizge icin bu yaniti ver (test enjeksiyonu). */
  yanitlar = new Map<string, IstekYaniti>();
  arsivIstekleri: { yol: string; arsiv: number }[] = [];
  /** `cagri` hatasi (Worker dustu). */
  dusur: Error | null = null;
  private zincir: Promise<unknown> = Promise.resolve();

  constructor(readonly cekirdek: SahteCekirdek) {}

  cagri<Y extends YontemAdi>(y: Y, a: YontemGirdisi<Y>, o?: CagriSecenegi): Promise<YontemSonucu<Y>> {
    void o;
    if (this.dusur) return Promise.reject(this.dusur);
    this.cagrilar.push({ y, a });
    const p = this.zincir.then(() => this.isle(y, a));
    this.zincir = p.catch(() => undefined);
    return p as Promise<YontemSonucu<Y>>;
  }

  private olum = ertele();
  kapat(): void {
    this.kapatildi = true;
    this.olum.coz();
  }

  mesajSayisi(): number {
    return this.mesajlar;
  }

  bekleyen(): number {
    return this.bekleyenCagri;
  }

  private abonelereYaz(kosuId: string, event: string, data: unknown): void {
    for (const ab of this.aboneler.values()) if (ab.kosuId === kosuId && !ab.kapali) ab.kuyruk.push({ id: ++ab.sira, event, data });
  }

  private bosalt(aboneler: number[]): AboneOlaylari[] {
    return aboneler.map((n) => {
      const ab = this.aboneler.get(n);
      if (!ab) return { abone: n, olaylar: [], kapandi: true };
      const olaylar = ab.kuyruk.splice(0);
      if (ab.kapali) this.aboneler.delete(n);
      return { abone: n, olaylar, kapandi: ab.kapali };
    });
  }

  private async isle(y: YontemAdi, a: unknown): Promise<unknown> {
    switch (y) {
      case "istek":
        return this.istek(a as YontemGirdisi<"istek">);
      case "tick": {
        if (this.tickKapisi) {
          await Promise.race([this.tickKapisi(), this.olum.promise]);
          if (this.kapatildi) throw new CekirdekHatasi("IsciHatasi", "kapali");
        }
        await new Promise((c) => setTimeout(c, 1));        // gercek Worker: mesaj turu / bosta bekleme; olay dongusune nefes
        let ms = 1;
        for (const k of this.kosular.values()) {
          if (!k.oynuyor) continue;
          ms = this.tickMs;
          const paket = this.cekirdek.tick(k.id);
          this.abonelereYaz(k.id, "week", paket);
        }
        const s: TickSonucu = { ms, olaylar: this.bosalt((a as YontemGirdisi<"tick">).aboneler) };
        return s;
      }
      case "olaylar":
        return this.bosalt((a as YontemGirdisi<"olaylar">).aboneler);
      case "olayKapat": {
        const ab = this.aboneler.get((a as YontemGirdisi<"olayKapat">).abone);
        if (ab) ab.kapali = true;
        this.aboneler.delete((a as YontemGirdisi<"olayKapat">).abone);
        return null;
      }
      case "p50":
        this.p50.push((a as YontemGirdisi<"p50">).sn);
        return null;
      default:
        throw new CekirdekHatasi("IsciHatasi", `desteklenmiyor_${y}`);
    }
  }

  private istek(g: YontemGirdisi<"istek">): IstekYaniti {
    const hazir = this.yanitlar.get(`${g.yontem} ${g.yol}`);
    if (hazir) return hazir;
    const yanit = (status: number, body: unknown): IstekYaniti => ({ status, headers: {}, body });
    const u = new URL(g.yol, "http://x");
    const p = u.pathname;
    if (g.yontem === "GET" && p === "/api/hello") return yanit(200, { ok: true, live: true, server_version: "1", model_version: "1", defaults_hash: "h", sec_per_week_p50: null });
    if (g.yontem === "POST" && p === "/api/runs") return this.kosuAc();
    const m = /^\/api\/runs\/([^/]+)(\/.*)?$/.exec(p);
    if (!m) return yanit(404, { error: { code: "yok" } });
    const id = decodeURIComponent(m[1] as string);
    const alt = m[2] ?? "";
    const kosu = this.kosular.get(id);
    if (!kosu) return yanit(404, { error: { code: "not_found" } });
    if (g.yontem === "GET" && alt === "") return yanit(200, { runId: id, state: { runId: id } });
    if (g.yontem === "GET" && alt === "/events") {
      const n = ++this.sonAbone;
      const kuyruk: OlayTel[] = [{ id: 1, event: "state", data: { runId: id } }];
      for (let w = 1; w <= (kosu.pencere ?? 0); w++) kuyruk.push({ id: w + 1, event: "week", data: { week: w, run_id: id } });
      this.aboneler.set(n, { kosuId: id, kuyruk, sira: kuyruk.length, kapali: false });
      return yanit(200, { abone: n });
    }
    if (g.yontem === "GET" && alt === "/weeks") {
      const a = Number(u.searchParams.get("from"));
      const b = Number(u.searchParams.get("to"));
      const var_ = new Set((g.arsiv ?? []).map((x) => x.week));
      this.arsivIstekleri.push({ yol: g.yol, arsiv: (g.arsiv ?? []).length });
      const eksik: number[] = [];
      for (let w = a; w <= b; w++) if (w <= kosu.pencereTaban && !var_.has(w)) eksik.push(w);
      if (eksik.length > 0) return { status: 0, headers: {}, body: null, arsiv_gerek: { runId: id, from: eksik[0] as number, to: eksik[eksik.length - 1] as number } };
      const paketler: HaftaPaketi[] = [];
      for (let w = a; w <= b; w++) paketler.push({ week: w, run_id: id });
      return yanit(200, paketler);
    }
    if (g.yontem === "POST" && alt === "/control") {
      const c = g.govde as { action?: string };
      kosu.oynuyor = c.action === "play";
      return yanit(200, { runId: id, status: kosu.oynuyor ? "running" : "paused" });
    }
    if (g.yontem === "POST" && alt === "/changes") {
      const sira = (this.cekirdek.kosular.get(id)?.gunluk.length ?? 0) + 1;
      this.cekirdek.gunlugeEkle(id, { sira, tur: "sart", dikis: this.cekirdek.kosular.get(id)?.released ?? 0, yama: g.govde as Record<string, unknown>, not: null, surum: sira + 1 });
      return yanit(200, { accepted: true });
    }
    if (g.yontem === "POST" && alt === "/branch") {
      const y = this.kosuAc();
      this.kosular.get((y.body as { runId: string }).runId)!.pencere = this.branchHaftalari;
      return y;
    }
    if (g.yontem === "DELETE" && alt === "") {
      this.kosular.delete(id);
      this.cekirdek.kosular.delete(id);
      for (const ab of this.aboneler.values()) if (ab.kosuId === id) ab.kapali = true;
      return { status: 204, headers: {}, body: null };
    }
    return yanit(405, { error: { code: "method" } });
  }

  private kosuAc(): IstekYaniti {
    const id = `canli-${(++this.sonKosu).toString(16).padStart(4, "0")}`;
    this.kosular.set(id, { id, oynuyor: false, pencereTaban: 0 });
    this.cekirdek.kosuYarat(id);
    this.olusturulan.push(id);
    return { status: 201, headers: {}, body: { runId: id, state: { runId: id } } };
  }
}

// ---- Sahte Worker: protokolu SahteIsci + SahteCekirdek ile yanitlar ----------------------------------------------------


/** Sahte Worker'in okudugu gevsek girdi (tip denetimi test icin gereksiz). */
type Girdi = Record<string, never> & {
  kosuId: string;
  sonra: number;
  parcalar: ArrayBuffer[];
  yonetici: import("@/oyun/tarayici/kayit/tel").Yonetici;
  gunluk: import("@/oyun/tarayici/kayit/tel").GunlukGirisi[];
  hedefHafta: number;
  paketler?: HaftaPaketi[];
  ebeveyn?: [string, number];
  azamiHafta?: number | null;
  tarif: import("@/oyun/tarayici/kayit/tel").Tarif;
};

export const MANIFEST_ORNEK: Manifest = {
  surum: 1,
  pyodide: PYODIDE_SURUMU,
  goruntu_sema: 2,
  host_sema: 1,
  model_sha256: "a".repeat(64),
  paket: { ad: "oyun-0123456789ab.zip", sha256: "b".repeat(64), boyut: 6 },
};

/** `Worker` yerine gecer: `yukle` -> `hazir` (ya da verilen hata); `cagri` -> sahte cekirdek/isci. Yanitlar asenkron (gercek mesajlasma gibi). */
export class SahteCalisanWorker implements WorkerBaglantisi {
  onmessage: WorkerBaglantisi["onmessage"] = null;
  onerror: WorkerBaglantisi["onerror"] = null;
  sonlandi = 0;
  mesajlar: AnaMesaj[] = [];
  yuklemeHatasi: { kod: Extract<IsciMesaji, { t: "yuklemeHatasi" }>["kod"] } | null = null;
  yuklemeBekle: Ertelenmis | null = null;

  constructor(
    readonly cekirdek: SahteCekirdek,
    readonly isci: SahteIsci,
  ) {}

  postMessage(m: AnaMesaj): void {
    this.mesajlar.push(m);
    if (m.t === "yukle") {
      void (async () => {
        await this.yuklemeBekle?.promise;
        if (this.sonlandi) return;
        if (this.yuklemeHatasi) this.gonder({ t: "yuklemeHatasi", kod: this.yuklemeHatasi.kod, ayrinti: {} });
        else {
          this.gonder({ t: "ilerleme", asama: "indirme", oran: 0.5, alinan: 3, toplam: 6 });
          this.gonder({ t: "hazir", anahtar: { ...ANAHTAR }, manifest: MANIFEST_ORNEK, sureler: { manifest: 1, indirme: 1, dogrulama: 1, derleme: 1, paket: 1, kurulum: 1 } });
        }
      })();
      return;
    }
    const { id, y, a } = m as unknown as { id: number; y: string; a: Girdi };
    void (async () => {
      try {
        const s = await this.isle(y, a);
        if (this.sonlandi) return;
        this.gonder({ t: "yanit", id, ok: true, s });
      } catch (e) {
        if (this.sonlandi) return;
        const h = e as { tur?: string; message?: string; fark?: Record<string, unknown> | null };
        const hata: HataTel = { tur: h.tur ?? "IsciHatasi", mesaj: h.message ?? "", fark: h.fark ?? null };
        this.gonder({ t: "yanit", id, ok: false, hata });
      }
    })();
  }

  private gonder(m: IsciMesaji): void {
    queueMicrotask(() => this.onmessage?.({ data: m }));
  }

  private async isle(y: string, a: Girdi): Promise<unknown> {
    const c = this.cekirdek;
    switch (y) {
      case "uyumlulukAnahtari":
        return c.uyumlulukAnahtari();
      case "goruntuGerekli":
        return c.goruntuGerekli(a.kosuId);
      case "gunlukAl":
        return c.gunlukAl(a.kosuId, a.sonra);
      case "tarifAl":
        return c.tarifAl(a.kosuId);
      case "goruntuAl": {
        const parcalar: ArrayBuffer[] = [];
        const sonuc = await c.goruntuAl(a.kosuId, (u) => parcalar.push(u.slice().buffer));
        return { sonuc, parcalar };
      }
      case "devam": {
        const r = await c.devam({ goruntu: { parcalar: a.parcalar, yonetici: a.yonetici }, gunluk: a.gunluk, hedefHafta: a.hedefHafta, paketler: a.paketler, kosuId: a.kosuId, ebeveyn: a.ebeveyn, azamiHafta: a.azamiHafta });
        this.isciyeKaydet(r.kosu_id);
        return r;
      }
      case "tariftenOynat": {
        const r = await c.tariftenOynat({ tarif: a.tarif, gunluk: a.gunluk, hedefHafta: a.hedefHafta, kosuId: a.kosuId, azamiHafta: a.azamiHafta });
        this.isciyeKaydet(r.kosu_id);
        return r;
      }
      default:
        return this.isci.cagri(y as YontemAdi as never, a as never);
    }
  }

  private isciyeKaydet(id: string): void {
    if (!this.isci.kosular.has(id)) this.isci.kosular.set(id, { id, oynuyor: false, pencereTaban: 0 });
  }

  terminate(): void {
    this.sonlandi++;
  }
}

// ---- Tek sekme kilidi sahteleri ----
import type { KanalYuzu, KilitYuzu } from "@/oyun/tarayici/sekmeKilidi";

/** `navigator.locks` taklidi: ifAvailable (dolu -> cb(null)), steal (tutanin sozu AbortError ile reddedilir), birakma. */
export class SahteKilitler implements KilitYuzu {
  private tutan: { reddet: (e: unknown) => void; birak: () => void } | null = null;
  request(_ad: string, o: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    if (this.tutan && o.ifAvailable) return Promise.resolve(cb(null));
    if (this.tutan && o.steal) this.tutan.reddet(new DOMException("calindi", "AbortError"));
    return new Promise((coz, reddet) => {
      const ben = { reddet, birak: () => coz(undefined) };
      this.tutan = ben;
      void Promise.resolve(cb({ name: "kilit" })).then(() => {
        if (this.tutan === ben) this.tutan = null;
        coz(undefined);
      });
    });
  }
  get dolu(): boolean {
    return this.tutan !== null;
  }
}

/** BroadcastChannel taklidi: ayni adli kanallar birbirine (kendisi hariç) yayar, asenkron. */
export class SahteYayin {
  kanallar = new Set<SahteKanal>();
  uret = (): KanalYuzu => new SahteKanal(this);
}
export class SahteKanal implements KanalYuzu {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(private yayin: SahteYayin) {
    yayin.kanallar.add(this);
  }
  postMessage(m: unknown): void {
    for (const k of this.yayin.kanallar) if (k !== this) queueMicrotask(() => k.onmessage?.({ data: m }));
  }
  close(): void {
    this.yayin.kanallar.delete(this);
  }
}

