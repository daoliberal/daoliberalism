/**
 * B5: ana is parcacigi <-> oyun Worker'i protokolu (tarayicida Pyodide).
 *
 * Iki yonlu, turlu mesajlar. Istek/yanit korelasyon kimligiyle (`id`) eslesir; Worker tek is parcacigi oldugu icin
 * mesajlar GELIS SIRASIYLA islenir (bir hafta adimi 3-6 sn surer; adim sirasinda gelen istekler kuyrukta bekler, kaybolmaz).
 *
 * Worker -> ana (`IsciMesaji`):
 *   ilerleme        yukleme asamasi + oran (0..1 ya da null)
 *   hazir           yukleme bitti: model anahtari, manifest ozeti, asama sureleri (ms)
 *   yuklemeHatasi   yukleme basarisiz (acik kod); Worker'in isi biter
 *   yanit           `cagri`ya yanit: `ok` + sonuc, ya da `hata` {tur, mesaj, fark} (Python istisnasi; B4b `CekirdekHatasi` sozlesmesi)
 *   devamIlerleme   `devam`/`tariftenOynat` sirasinda oynatilan hafta (yanit gelene dek)
 * Ana -> Worker (`AnaMesaj`):
 *   yukle           yukleme baslat (URL'ler ana is parcacigindan gelir)
 *   cagri           adlandirilmis yontem cagrisi (`Yontemler`); `id` ile yanitlanir
 *
 * Aktarilan buyuk veri: goruntu parcalari `ArrayBuffer` olarak transfer listesiyle (kopya yok).
 * Pyodide yalniz Worker'da yuklenir; ana is parcacigi Python'a hic dokunmaz. `SharedArrayBuffer` kullanilmaz.
 */
import type { DevamGirdisi, TariftenGirdisi } from "./kayit/cekirdek";
import type { DevamSonuc, Fark, GoruntuAlSonuc, GunlukGirisi, HaftaPaketi, ModelAnahtari, Tarif } from "./kayit/tel";

/** Sabitler. Manifest B6 uretir (`apps/web/scripts/paketModel.mjs`). */
export const PYODIDE_SURUMU = "0.27.7";
export const MANIFEST_YOLU = "/oyun/manifest.json";
export const PYODIDE_YOLU = `/pyodide/${PYODIDE_SURUMU}/`;

/** Bir tick bu sureden kisaysa bosta sayilir (en kisa gercek hafta adimi ~1,5 sn). */
export const BOSTA_MS = 40;

/**
 * `indirme` asamasinda zip ile birlikte on-indirilen (HTTP onbellegini isitir; `loadPyodide` ayni dosyalari tekrar ister) cekirdek dosyalari ve
 * TAHMINI boyutlari (yalniz ilerleme orani icin; yanit `Content-Length` verirse gercek boyut kullanilir). Boyutlar B6 ciktisindandir.
 */
export const PYODIDE_ON_INDIRME: readonly (readonly [string, number])[] = [
  ["pyodide.asm.wasm", 10_105_545],
  ["python_stdlib.zip", 2_360_737],
  ["pyodide.asm.js", 1_255_688],
  ["pyodide-lock.json", 112_205],
];

export type YuklemeAsamasi = "manifest" | "indirme" | "dogrulama" | "derleme" | "paket" | "kurulum" | "kayit";
/** Gosterim sirasi (arayuz ilerleme cubugu). `kayit` (IndexedDB acilisi) ana is parcacigindadir. */
export const ASAMALAR: readonly YuklemeAsamasi[] = ["manifest", "indirme", "dogrulama", "derleme", "paket", "kurulum", "kayit"];

export type YuklemeHatasiKodu =
  | "manifest_okunamadi"
  | "manifest_gecersiz"
  | "paket_indirilemedi"
  | "sha_uyusmuyor"
  | "sha_desteklenmiyor"
  | "pyodide_yuklenemedi"
  | "pyodide_surumu_uyusmuyor"
  | "paket_acilamadi"
  | "cekirdek_kurulamadi"
  | "model_anahtari_uyusmuyor"
  | "worker_baslamadi"
  | "iptal_edildi";

export class YuklemeHatasi extends Error {
  readonly kod: YuklemeHatasiKodu;
  readonly ayrinti: Record<string, unknown>;
  constructor(kod: YuklemeHatasiKodu, ayrinti: Record<string, unknown> = {}, neden?: unknown) {
    super(kod, neden === undefined ? undefined : { cause: neden });
    this.name = "YuklemeHatasi";
    this.kod = kod;
    this.ayrinti = ayrinti;
  }
}

/** `/oyun/manifest.json` (B6): yalniz B5'in okudugu alanlar. */
export interface Manifest {
  surum: 1;
  pyodide: string;
  goruntu_sema: number;
  host_sema: number;
  model_sha256: string;
  paket: { ad: string; sha256: string; boyut: number };
}

export interface YukleGirdisi {
  /** Mutlak URL (ana is parcacigi `location.origin` ile kurar). */
  manifestUrl: string;
  /** `/pyodide/0.27.7/` (sonunda `/`). */
  pyodideDizini: string;
  /** Manifest'in bulundugu dizin (paket `ad` bu dizine eklenir). */
  oyunDizini: string;
}

export interface YuklemeSureleri {
  manifest: number;
  indirme: number;
  dogrulama: number;
  derleme: number;
  paket: number;
  kurulum: number;
}

// ---- Yontem tablosu -------------------------------------------------------------------------------------------

export interface IstekGirdisi {
  yontem: string;
  /** `/api/...` (sorgu dizgesiyle). */
  yol: string;
  govde?: unknown;
  /** `arsiv_gerek` yinelemesi: IndexedDB'den gelen hafta paketleri. */
  arsiv?: readonly HaftaPaketi[];
}

export interface ArsivGerekTel {
  runId: string;
  from: number;
  to: number;
}

export interface IstekYaniti {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  /** `status: 0` ile birlikte: pencere disi hafta istendi (B3 sozlesmesi). */
  arsiv_gerek?: ArsivGerekTel | null;
}

export interface OlayTel {
  id: number;
  event: string;
  data: unknown;
}

export interface AboneOlaylari {
  abone: number;
  olaylar: OlayTel[];
  kapandi: boolean;
}

export interface TickSonucu {
  /** Python `tick()` suresi (ms, Worker saati). Cok kisa tick = bosta (hafta hesaplanmadi). */
  ms: number;
  olaylar: AboneOlaylari[];
}

export interface WorkerDevamGirdisi {
  parcalar: ArrayBuffer[];
  yonetici: unknown;
  gunluk: GunlukGirisi[];
  hedefHafta: number;
  paketler?: HaftaPaketi[];
  kosuId?: string;
  ebeveyn?: [string, number];
  azamiHafta?: number | null;
}

export interface WorkerTariftenGirdisi {
  tarif: Tarif;
  gunluk: GunlukGirisi[];
  hedefHafta: number;
  kosuId?: string;
  azamiHafta?: number | null;
}

/** [girdi, sonuc] ciftleri. `null` girdi: bos. */
export interface Yontemler {
  istek: [IstekGirdisi, IstekYaniti];
  /**
   * Bir `tick()`; ardindan istenen abonelerin olaylari ayni yanitta doner. Onceki tick BOSTA ise (`BOSTA_MS`'den kisa ve `week` olayi yok) Worker bu
   * tick'e baslamadan `bostaBekleMs` bekler (Worker zamanlayicisi; yanit sirasi bozulmaz, bu surede gelen istekler yanitlanir).
   */
  tick: [{ aboneler: number[]; bostaBekleMs?: number }, TickSonucu];
  olaylar: [{ aboneler: number[] }, AboneOlaylari[]];
  olayKapat: [{ abone: number }, null];
  p50: [{ sn: number | null }, null];
  uyumlulukAnahtari: [null, ModelAnahtari];
  goruntuGerekli: [{ kosuId: string }, boolean];
  /** `parcalar` transfer listesiyle gelir (kopyasiz). */
  goruntuAl: [{ kosuId: string }, { sonuc: GoruntuAlSonuc; parcalar: ArrayBuffer[] }];
  gunlukAl: [{ kosuId: string; sonra: number }, GunlukGirisi[]];
  tarifAl: [{ kosuId: string }, Tarif];
  devam: [WorkerDevamGirdisi, DevamSonuc];
  tariftenOynat: [WorkerTariftenGirdisi, DevamSonuc];
}

export type YontemAdi = keyof Yontemler;
export type YontemGirdisi<Y extends YontemAdi> = Yontemler[Y][0];
export type YontemSonucu<Y extends YontemAdi> = Yontemler[Y][1];

export interface HataTel {
  /** Python sinif adi (`UyumsuzGoruntu`, `GoruntuHazirDegil`, `ValueError`, ...); Worker'in kendi hatalari `IsciHatasi`. */
  tur: string;
  mesaj: string;
  fark: Fark | null;
}

// ---- Mesajlar -------------------------------------------------------------------------------------------------

export type AnaMesaj =
  | { t: "yukle"; girdi: YukleGirdisi }
  | { [Y in YontemAdi]: { t: "cagri"; id: number; y: Y; a: YontemGirdisi<Y> } }[YontemAdi];

export type IsciMesaji =
  | { t: "ilerleme"; asama: YuklemeAsamasi; oran: number | null; alinan?: number; toplam?: number | null }
  | { t: "hazir"; anahtar: ModelAnahtari; manifest: Manifest; sureler: YuklemeSureleri }
  | { t: "yuklemeHatasi"; kod: YuklemeHatasiKodu; ayrinti: Record<string, unknown> }
  | { t: "yanit"; id: number; ok: true; s: unknown }
  | { t: "yanit"; id: number; ok: false; hata: HataTel }
  | { t: "devamIlerleme"; id: number; hafta: number };

/** Yanitin ArrayBuffer'larini toplar (postMessage transfer listesi). */
export function aktarilacaklar(s: unknown): ArrayBuffer[] {
  if (typeof s !== "object" || s === null) return [];
  const p = (s as { parcalar?: unknown }).parcalar;
  return Array.isArray(p) ? p.filter((x): x is ArrayBuffer => x instanceof ArrayBuffer) : [];
}

export function kayitGirdisiniWorkera(g: DevamGirdisi, parcalar: ArrayBuffer[]): WorkerDevamGirdisi {
  return {
    parcalar,
    yonetici: g.goruntu.yonetici,
    gunluk: g.gunluk,
    hedefHafta: g.hedefHafta,
    paketler: g.paketler,
    kosuId: g.kosuId,
    ebeveyn: g.ebeveyn,
    azamiHafta: g.azamiHafta,
  };
}

export function tariftenGirdisiniWorkera(g: TariftenGirdisi): WorkerTariftenGirdisi {
  return { tarif: g.tarif, gunluk: g.gunluk, hedefHafta: g.hedefHafta, kosuId: g.kosuId, azamiHafta: g.azamiHafta };
}
