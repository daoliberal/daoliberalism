/**
 * B5: Worker tarafi mantigi (Pyodide yukleyici + cagri dagitimi). Ortam bagimliliklari (fetch, pyodide ice aktarimi, sha256, saat) enjekte edilir:
 * `oyunWorker.ts` gercekleriyle, testler sahteleriyle kurar. Bu dosya `self`e dokunmaz.
 *
 * Yukleme (B6 devri): manifest -> paket (sha256 dogrula) -> `pyodide.mjs` + `loadPyodide({indexURL, env:{PYTHONHASHSEED:"0"}})` ->
 * `unpackArchive(zip, "zip", {extractDir:"/app"})` -> `sys.path` -> `isci_kopru.kur()` -> model anahtari denetimi.
 * Cagri dagitimi: Python tarafi `IsciKopru` (tek sinir; hata `{tur, mesaj, fark}` olarak doner, istisna JS'e sizmaz).
 */
import {
  BOSTA_MS,
  PYODIDE_ON_INDIRME,
  PYODIDE_SURUMU,
  YuklemeHatasi,
  aktarilacaklar,
  type AboneOlaylari,
  type AnaMesaj,
  type HataTel,
  type IsciMesaji,
  type Manifest,
  type TickSonucu,
  type YontemAdi,
  type YontemGirdisi,
  type YontemSonucu,
  type YukleGirdisi,
  type YuklemeAsamasi,
  type YuklemeSureleri,
} from "./protokol";
import { SABITLER, type GoruntuAlSonuc, type ModelAnahtari } from "./kayit/tel";

// ---- Enjekte edilen ortam -------------------------------------------------------------------------------------

/** Pyodide'in kullandigimiz en dar yuzu (resmi tip paketi `src/oyun` sinirinin disindadir). */
export interface PyodideYuzu {
  version: string;
  unpackArchive(veri: Uint8Array, bicim: string, secenek?: { extractDir?: string }): void;
  pyimport(ad: string): PyProxyYuzu;
}

export interface PyProxyYuzu {
  [alan: string]: unknown;
}

export interface PyodideModulu {
  loadPyodide(secenek: { indexURL: string; env?: Record<string, string> }): Promise<PyodideYuzu>;
}

export interface IsciOrtami {
  fetch: (girdi: string, init?: RequestInit) => Promise<Response>;
  pyodideAc(url: string): Promise<PyodideModulu>;
  sha256Hex(veri: ArrayBuffer): Promise<string>;
  /** ms. */
  simdi(): number;
  /** Worker zamanlayicisi (bosta tick yanitini geciktirir). */
  bekle(ms: number): Promise<void>;
}

/** Python `IsciKopru`'nun JS gorunumu (her yontem JSON dizgesi doner). */
interface Kopru {
  istek(yontem: string, yol: string, govde?: string, arsiv?: string): string;
  tick(aboneler: number[]): string;
  olaylar(aboneler: number[]): string;
  olay_kapat(abone: number): string;
  p50(sn?: number): string;
  uyumluluk_anahtari(): string;
  goruntu_gerekli(kosuId: string): string;
  goruntu_al(kosuId: string, sink: (u: Uint8Array) => void): string;
  gunluk_al(kosuId: string, sonra: number): string;
  tarif_al(kosuId: string): string;
  devam(parcalar: Uint8Array[], yonetici: string, gunluk: string, hedef: number, paketler?: string, kosuId?: string, ebeveyn?: string, azami?: number | null, ilerleme?: (h: number) => void): string;
  tariften_oynat(tarif: string, gunluk: string, hedef: number, kosuId?: string, azami?: number | null, ilerleme?: (h: number) => void): string;
}

/** Worker'in kendi hatalari (`tur`): Python hatasi degil. */
export class IsciHatasi extends Error {
  readonly tur: string;
  readonly fark: null = null;
  constructor(tur: "hazir_degil" | "bilinmeyen_yontem" | "kapali") {
    super(tur);
    this.name = "IsciHatasi";
    this.tur = tur;
  }
}

/** Python tarafindan donen yapili hata. */
export class PythonHatasi extends Error {
  readonly tur: string;
  readonly fark: HataTel["fark"];
  constructor(h: HataTel) {
    super(h.mesaj);
    this.name = "PythonHatasi";
    this.tur = h.tur;
    this.fark = h.fark;
  }
}

const SHA_BICIMI = /^[0-9a-f]{64}$/;
const PAKET_ADI = /^oyun-[0-9a-f]{12}\.zip$/;

export function manifestiDogrula(x: unknown): Manifest {
  const o = x as Partial<Manifest> | null;
  const gecerli =
    typeof o === "object" &&
    o !== null &&
    o.surum === 1 &&
    typeof o.pyodide === "string" &&
    Number.isInteger(o.goruntu_sema) &&
    Number.isInteger(o.host_sema) &&
    typeof o.model_sha256 === "string" &&
    SHA_BICIMI.test(o.model_sha256) &&
    typeof o.paket === "object" &&
    o.paket !== null &&
    typeof o.paket.ad === "string" &&
    PAKET_ADI.test(o.paket.ad) &&
    typeof o.paket.sha256 === "string" &&
    SHA_BICIMI.test(o.paket.sha256) &&
    Number.isInteger(o.paket.boyut) &&
    o.paket.boyut > 0;
  if (!gecerli) throw new YuklemeHatasi("manifest_gecersiz");
  return o as Manifest;
}

export type Bildir = (m: IsciMesaji, aktar?: Transferable[]) => void;

export class Isci {
  private kopru: Kopru | null = null;
  private yukleniyor = false;
  private sonBosta = false;
  private alinanTop = 0;
  private toplamTop = 0;

  constructor(
    private readonly ortam: IsciOrtami,
    private readonly bildir: Bildir,
  ) {}

  /** Ana is parcacigindan gelen mesaj. `yukle` uzun surer (asenkron); `cagri` Python'u SENKRON cagirir ve yanitlar. */
  async mesaj(m: AnaMesaj): Promise<void> {
    if (m.t === "yukle") {
      await this.yukleVeBildir(m.girdi);
      return;
    }
    const id = m.id;
    try {
      // Bosta bekleme YANITI geciktirmez (yanit sirasi Python'daki uretim sirasidir): bir onceki tick bostaysa bu tick'in BASINDA beklenir;
      // bu surede gelen oteki mesajlar zaten yanitlanir ve tick sonucu onlardan daha yenidir.
      if (m.y === "tick") {
        const g = m.a as YontemGirdisi<"tick">;
        if (this.sonBosta && g.bostaBekleMs !== undefined && g.bostaBekleMs > 0) await this.ortam.bekle(g.bostaBekleMs);
      }
      const s = this.cagri(m.y, m.a, id);
      if (m.y === "tick") {
        const t = s as TickSonucu;
        this.sonBosta = t.ms < BOSTA_MS && !t.olaylar.some((x) => x.olaylar.some((o) => o.event === "week"));
      }
      this.bildir({ t: "yanit", id, ok: true, s }, aktarilacaklar(s));
    } catch (e) {
      this.bildir({ t: "yanit", id, ok: false, hata: hataTel(e) });
    }
  }

  private async yukleVeBildir(g: YukleGirdisi): Promise<void> {
    if (this.yukleniyor || this.kopru) return;
    this.yukleniyor = true;
    try {
      const r = await this.yukle(g);
      this.bildir({ t: "hazir", anahtar: r.anahtar, manifest: r.manifest, sureler: r.sureler });
    } catch (e) {
      this.yukleniyor = false;
      const h = e instanceof YuklemeHatasi ? e : new YuklemeHatasi("cekirdek_kurulamadi", { neden: e instanceof Error ? e.message : String(e) });
      this.bildir({ t: "yuklemeHatasi", kod: h.kod, ayrinti: h.ayrinti });
    }
  }

  private ilerleme(asama: YuklemeAsamasi, oran: number | null, alinan?: number, toplam?: number | null): void {
    this.bildir({ t: "ilerleme", asama, oran, alinan, toplam });
  }

  async yukle(g: YukleGirdisi): Promise<{ anahtar: ModelAnahtari; manifest: Manifest; sureler: YuklemeSureleri }> {
    const o = this.ortam;
    const sureler: YuklemeSureleri = { manifest: 0, indirme: 0, dogrulama: 0, derleme: 0, paket: 0, kurulum: 0 };
    const olc = async <T>(ad: keyof YuklemeSureleri, is: () => Promise<T> | T): Promise<T> => {
      const t0 = o.simdi();
      try {
        return await is();
      } finally {
        sureler[ad] = Math.round(o.simdi() - t0);
      }
    };

    // 1. manifest (her seferinde yeniden dogrulanir: B6/B7)
    this.ilerleme("manifest", null);
    const manifest = await olc("manifest", async () => {
      let metin: string;
      try {
        const r = await o.fetch(g.manifestUrl, { cache: "no-cache" });
        if (!r.ok) throw new YuklemeHatasi("manifest_okunamadi", { status: r.status });
        metin = await r.text();
      } catch (e) {
        throw e instanceof YuklemeHatasi ? e : new YuklemeHatasi("manifest_okunamadi", {}, e);
      }
      let json: unknown;
      try {
        json = JSON.parse(metin);
      } catch (e) {
        throw new YuklemeHatasi("manifest_gecersiz", {}, e);
      }
      const m = manifestiDogrula(json);
      if (m.pyodide !== PYODIDE_SURUMU) throw new YuklemeHatasi("pyodide_surumu_uyusmuyor", { beklenen: PYODIDE_SURUMU, manifest: m.pyodide });
      return m;
    });

    // 2. indirme (akis; ilerleme = TUM indirilen bayt / toplam): model paketi + Pyodide cekirdek dosyalari (on-indirme)
    this.alinanTop = 0;
    this.toplamTop = manifest.paket.boyut + PYODIDE_ON_INDIRME.reduce((a, [, b]) => a + b, 0);
    const zip = await olc("indirme", async () => {
      const z = await this.indir(g.oyunDizini + manifest.paket.ad, manifest.paket.boyut, true);
      for (const [ad, tahmin] of PYODIDE_ON_INDIRME) {
        try {
          await this.indir(g.pyodideDizini + ad, tahmin, false);
        } catch {
          // On-indirme basarisiz olabilir (ag); asil hata `loadPyodide` asamasinda acik koduyla gelir.
        }
      }
      return z;
    });

    // 3. sha256
    await olc("dogrulama", async () => {
      this.ilerleme("dogrulama", null);
      let bulunan: string;
      try {
        bulunan = await o.sha256Hex(zip.buffer as ArrayBuffer);
      } catch (e) {
        throw new YuklemeHatasi("sha_desteklenmiyor", {}, e);
      }
      if (bulunan !== manifest.paket.sha256) throw new YuklemeHatasi("sha_uyusmuyor", { beklenen: manifest.paket.sha256, bulunan });
    });

    // 4. Pyodide (modul worker: yalniz `pyodide.mjs`)
    this.ilerleme("derleme", null);
    const py = await olc("derleme", async () => {
      try {
        const modul = await o.pyodideAc(`${g.pyodideDizini}pyodide.mjs`);
        return await modul.loadPyodide({ indexURL: g.pyodideDizini, env: { PYTHONHASHSEED: "0" } });
      } catch (e) {
        throw new YuklemeHatasi("pyodide_yuklenemedi", {}, e);
      }
    });
    if (py.version !== PYODIDE_SURUMU) throw new YuklemeHatasi("pyodide_surumu_uyusmuyor", { beklenen: PYODIDE_SURUMU, yuklenen: py.version });

    // 5. paket: /app altina ac, sys.path
    this.ilerleme("paket", null);
    await olc("paket", () => {
      try {
        py.unpackArchive(zip, "zip", { extractDir: "/app" });
        const sys = py.pyimport("sys");
        const yol = sys.path as { insert(i: number, v: string): void };
        yol.insert(0, "/app/simulasyon/arayuz/server");
      } catch (e) {
        throw new YuklemeHatasi("paket_acilamadi", {}, e);
      }
    });

    // 6. cekirdek kurulumu + model anahtari
    this.ilerleme("kurulum", null);
    const anahtar = await olc("kurulum", () => {
      let kopru: Kopru;
      try {
        const ffi = py.pyimport("pyodide.ffi");
        const modul = py.pyimport("oyun_server.tarayici.isci_kopru") as { kur(toJs: unknown): Kopru };
        kopru = modul.kur(ffi.to_js);
      } catch (e) {
        throw new YuklemeHatasi("cekirdek_kurulamadi", {}, e);
      }
      const a = this.coz<ModelAnahtari>(kopru.uyumluluk_anahtari());
      const fark: Record<string, [unknown, unknown]> = {};
      if (a.model_sha256 !== manifest.model_sha256) fark.model_sha256 = [manifest.model_sha256, a.model_sha256];
      if (a.schema !== manifest.goruntu_sema) fark.schema = [manifest.goruntu_sema, a.schema];
      if (a.host_sema !== manifest.host_sema) fark.host_sema = [manifest.host_sema, a.host_sema];
      if (a.pyodide !== manifest.pyodide) fark.pyodide = [manifest.pyodide, a.pyodide];
      if (Object.keys(fark).length > 0) throw new YuklemeHatasi("model_anahtari_uyusmuyor", { fark });
      this.kopru = kopru;
      return a;
    });
    this.ilerleme("kurulum", 1);
    return { anahtar, manifest, sureler };
  }

  private async indir(url: string, tahmin: number, tut: boolean): Promise<Uint8Array> {
    let r: Response;
    try {
      r = await this.ortam.fetch(url);
    } catch (e) {
      throw new YuklemeHatasi("paket_indirilemedi", {}, e);
    }
    if (!r.ok) throw new YuklemeHatasi("paket_indirilemedi", { status: r.status });
    const uzunluk = Number(r.headers.get("content-length"));
    if (Number.isFinite(uzunluk) && uzunluk > 0 && uzunluk !== tahmin) this.toplamTop += uzunluk - tahmin;   // gercek boyut biliniyorsa
    const parcalar: Uint8Array[] = [];
    let alinan = 0;
    const iler = (n: number): void => {
      alinan += n;
      this.alinanTop += n;
      this.toplamTop = Math.max(this.toplamTop, this.alinanTop);
      this.ilerleme("indirme", Math.min(1, this.alinanTop / this.toplamTop), this.alinanTop, this.toplamTop);
    };
    try {
      if (r.body) {
        const okuyucu = r.body.getReader();
        for (;;) {
          const { done, value } = await okuyucu.read();
          if (done) break;
          if (tut) parcalar.push(value);
          iler(value.byteLength);
        }
      } else {
        const b = new Uint8Array(await r.arrayBuffer());
        if (tut) parcalar.push(b);
        iler(b.byteLength);
      }
    } catch (e) {
      throw new YuklemeHatasi("paket_indirilemedi", {}, e);
    }
    const tum = new Uint8Array(tut ? alinan : 0);
    let konum = 0;
    for (const p of parcalar) {
      tum.set(p, konum);
      konum += p.byteLength;
    }
    return tum;
  }

  // ---- cagrilar ---------------------------------------------------------------------------------------------

  /** Python dizgesini cozer; `{ok:false}` `PythonHatasi` olarak firlar. */
  private coz<T>(dizge: string): T {
    const o = JSON.parse(dizge) as { ok: true; s: T } | { ok: false; hata: HataTel };
    if (!o.ok) throw new PythonHatasi(o.hata);
    return o.s;
  }

  cagri<Y extends YontemAdi>(y: Y, a: YontemGirdisi<Y>, id: number): YontemSonucu<Y> {
    const k = this.kopru;
    if (k === null) throw new IsciHatasi("hazir_degil");
    // Her dal kendi girdi turunu bilir; ortak donus turu `unknown` uzerinden daraltilir.
    const s = this.dagit(k, y as YontemAdi, a as never, id);
    return s as YontemSonucu<Y>;
  }

  private dagit(k: Kopru, y: YontemAdi, a: never, id: number): unknown {
    switch (y) {
      case "istek": {
        const g = a as YontemGirdisi<"istek">;
        const govde = g.govde === undefined ? undefined : JSON.stringify(g.govde);
        const arsiv = g.arsiv !== undefined && g.arsiv.length > 0 ? JSON.stringify(g.arsiv) : undefined;
        return this.coz(k.istek(g.yontem, g.yol, govde, arsiv));
      }
      case "tick": {
        const t0 = this.ortam.simdi();
        const olaylar = this.coz<AboneOlaylari[]>(k.tick((a as YontemGirdisi<"tick">).aboneler));
        const s: TickSonucu = { ms: this.ortam.simdi() - t0, olaylar };
        return s;
      }
      case "olaylar":
        return this.coz(k.olaylar((a as YontemGirdisi<"olaylar">).aboneler));
      case "olayKapat":
        return this.coz(k.olay_kapat((a as YontemGirdisi<"olayKapat">).abone));
      case "p50":
        return this.coz(k.p50((a as YontemGirdisi<"p50">).sn ?? undefined));
      case "uyumlulukAnahtari":
        return this.coz(k.uyumluluk_anahtari());
      case "goruntuGerekli":
        return this.coz(k.goruntu_gerekli((a as YontemGirdisi<"goruntuGerekli">).kosuId));
      case "goruntuAl": {
        const parcalar: ArrayBuffer[] = [];
        const sink = (u: Uint8Array): void => {
          // `to_js` kopyasidir (wasm yiginina bakmaz): tamami kapsiyorsa dogrudan transfer edilir.
          const tam = u.byteOffset === 0 && u.byteLength === u.buffer.byteLength;
          parcalar.push(tam ? (u.buffer as ArrayBuffer) : (u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer));
        };
        const sonuc = this.coz<GoruntuAlSonuc>(k.goruntu_al((a as YontemGirdisi<"goruntuAl">).kosuId, sink));
        return { sonuc, parcalar };
      }
      case "gunlukAl": {
        const g = a as YontemGirdisi<"gunlukAl">;
        return this.coz(k.gunluk_al(g.kosuId, g.sonra));
      }
      case "tarifAl":
        return this.coz(k.tarif_al((a as YontemGirdisi<"tarifAl">).kosuId));
      case "devam": {
        const g = a as YontemGirdisi<"devam">;
        const ilerleme = (hafta: number): void => this.bildir({ t: "devamIlerleme", id, hafta });
        return this.coz(
          k.devam(
            g.parcalar.map((b) => new Uint8Array(b)),
            JSON.stringify(g.yonetici),
            JSON.stringify(g.gunluk),
            g.hedefHafta,
            g.paketler === undefined ? undefined : JSON.stringify(g.paketler),
            g.kosuId,
            g.ebeveyn === undefined ? undefined : JSON.stringify(g.ebeveyn),
            g.azamiHafta === undefined ? SABITLER.devam_azami_hafta : g.azamiHafta,
            ilerleme,
          ),
        );
      }
      case "tariftenOynat": {
        const g = a as YontemGirdisi<"tariftenOynat">;
        const ilerleme = (hafta: number): void => this.bildir({ t: "devamIlerleme", id, hafta });
        return this.coz(k.tariften_oynat(JSON.stringify(g.tarif), JSON.stringify(g.gunluk), g.hedefHafta, g.kosuId, g.azamiHafta ?? undefined, ilerleme));
      }
      default:
        throw new IsciHatasi("bilinmeyen_yontem");
    }
  }
}

export function hataTel(e: unknown): HataTel {
  if (e instanceof PythonHatasi) return { tur: e.tur, mesaj: e.message, fark: e.fark };
  if (e instanceof IsciHatasi) return { tur: e.tur, mesaj: e.message, fark: null };
  return { tur: "IsciHatasi", mesaj: e instanceof Error ? e.message : String(e), fark: null };
}

