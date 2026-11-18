/**
 * B5 koprusu: `LiveSource`un konustugu HTTP/SSE sozlesmesini Worker'daki Python cekirdegine yonlendirir (LiveSource degismez).
 *
 *   fetchImpl        `/api/...` -> Worker `istek` (Python `yonlendirici`); `arsiv_gerek` IndexedDB'den karsilanir (en cok 3 yineleme).
 *   eventSourceImpl  `GET /api/runs/<id>/events` -> Python aboneligi + `olaylar()` dagitimi (`state/week/world_event/ended/error`).
 *   tick dongusu     hafta basina bir `tick` (Worker, 3-6 sn); okuma istekleri adimlar arasinda yanitlanir (Worker mesaj kuyrugu).
 *   kayit            her `week` olayi IndexedDB'ye (`haftalarOlayi`); her tick sonrasi `yazici.tick`; her mutasyondan sonra `gunlukSenkronla`.
 *
 * Her kosuya (olusturma, dal, devam) KOPRUNUN KENDI "kalicilik" aboneligi vardir: kosu yaratilir yaratilmaz acilir (abonesiz kosu 15 sn sonra
 * duraklar ve paketler Python'da birikir). Arayuzun SSE baglantilari ayri Python abonelikleridir (her baglanti `state` + pencere tekrarini alir).
 * Kalicilik olaylari, ayni drenajda arayuz olaylarindan ONCE islenir.
 *
 * Not (B4b `disaAktar`: "paketler cekirdege verilmez" ile ilgili): `arsiv` yolu yalniz JSON paketleri ve `run_id` filtresiyle Python'a gider; pickle/goruntu yolu degildir
 * (ice aktarilan kosunun paketleri de bu yoldan gorunebilir; risk dusuk, belgelenmistir).
 *
 * Arka plan sekmesi: tick dongusu zamanlayicisizdir (Worker yanit mesajiyla ilerler; bosta bekleme Worker zamanlayicisindadir), ama sekme gizliyken
 * tarayici ana is parcacigi mesajlarini geciktirebilir; olcum B9'dadir.
 */
import { arsivliIstek, ArsivHatasi, type ArsivliYanit } from "./kayit/arsiv";
import type { KayitKatmani } from "./kayit/index";
import type { HaftaPaketi } from "./kayit/tel";
import { CekirdekHatasi } from "./kayit/cekirdek";
import { acilisKarari } from "./acilisEslemesi";
import { BOSTA_MS, type AboneOlaylari, type IstekYaniti, type OlayTel, type TickSonucu } from "./protokol";
import type { IsciCagrisi } from "./kayitCekirdegi";
import { olcumTepe } from "./olcumKancasi";

const RUN_YOLU = /^\/api\/runs\/([^/?#]+)(\/[^?#]*)?$/;
const EVENTS_YOLU = /^\/api\/runs\/([^/?#]+)\/events$/;
const BOSTA_BEKLEME_MS = 100;
/** Bosta tick'lerde `yazici.tick` en fazla bu aralikla (hazir_degil goruntu yinelemesi). */
const BOSTA_YAZICI_MS = 2000;
const P50_ORNEK = 9;
const CLOSED = 2;
/** Python `TarayiciCekirdegi.MAX_RUNS` (tek oyun + en cok 1 dal). */
const MAX_KOSU = 2;
/** Hafta yazimi: ayni drenajda en cok bu kadar deneme; sonra bellekte bekler, sonraki tick'te yeniden denenir. */
const YAZIM_DENEME = 3;
/** Bellekte bekleyen hafta paketi siniri (koşu basina): dolunca tick dongusu DURAKLAR (en eski atilmaz: kayitta delik olusmaz) ve uyari gorunur. */
const BEKLEYEN_AZAMI = 700;
/** Dolu kuyrukta yazimin yeniden denenme araligi. */
const DOLU_YENIDEN_MS = 1000;
/** Bekci: bekleyen cagri varken Worker bu kadar SESSIZ kalirsa (hicbir mesaj, ilerleme dahil) olu sayilir. Uyku/askiya almada dilim en cok 2 yoklama sayilir. */
const SESSIZLIK_ASIMI_MS = 180_000;
const BEKCI_YOKLAMA_MS = 5000;
/** B8: "hesaplaniyor"/"kaydediliyor" gostergesinin varsayilan gecikmesi (ms). */
const GOSTERGE_GECIKME_MS = 400;
/** B8 Ö2: gosterge, son is bittikten bu kadar sonra (yeni is baslamadiysa) kapanir. */
const GOSTERGE_KAPANMA_MS = 1000;
/** `GET /api/runs/<id>` (alt yol yok). */
const TEK_KOSU_YOLU = /^\/api\/runs\/([^/?#]+)$/;

/** Kullaniciya gorunur kalicilik durumu (metin B8; B5'te asgari bant). */
export type Uyari =
  | { tur: "kayit_acilamadi"; kosuId: string }
  | { tur: "kayit_yazilamadi"; kosuId: string; bekleyen: number }
  | { tur: "kayit_duzeldi"; kosuId: string }
  /** Kayitli kosu IndexedDB'den yeniden kuruluyor (dakikalar surebilir; metin B8). */
  | { tur: "acilis_suruyor"; kosuId: string; hafta: number; hedef: number }
  | { tur: "acilis_bitti"; kosuId: string }
  /** B8: hafta adimi suruyor (Worker mesgul); gecikme esigini asinca `mesgul: true`, bitince `false`. */
  | { tur: "hesaplaniyor"; mesgul: boolean }
  /** B8: goruntu/gunluk yazimi suruyor (yavassa). */
  | { tur: "kaydediliyor"; mesgul: boolean }
  /** B8: koşu kaydi kilitli (kayitli bir karar uygulanamadi); yeni haftalar yazilmaz. Koşu basina bir kez. */
  | { tur: "kayit_kilitli"; kosuId: string; kilitli: boolean }
  /** B8: bu haftanin goruntusu hazir degil (gecici); yeniden denenir. */
  | { tur: "kayit_bekliyor"; kosuId: string; bekliyor: boolean };

export interface KopruSecenek {
  isci: IsciCagrisi;
  kayit: KayitKatmani;
  /** Dongu/kayit hatasi bildirimi (arayuz tani kaydi icin). Hata dongu'yu durdurmaz (kalici yazim hatasi oyunu kesmez). */
  hata?: (kaynak: string, e: unknown) => void;
  /** Worker dustu (tick dongusu bitti). */
  dustu?: (e: unknown) => void;
  /** Kalicilik durumu (kayit acilamadi / hafta yazilamiyor / duzeldi). */
  uyari?: (u: Uyari) => void;
  simdi?: () => number;
  /** Bekci: Worker sessizlik siniri / yoklama araligi (testler). */
  sessizlikAsimiMs?: number;
  bekciYoklamaMs?: number;
  bekleyenAzami?: number;
  /** B8: "hesaplaniyor"/"kaydediliyor" gostergesi bu kadar ms suren islerde acilir (kisa isler gostergeyi titretmez). Varsayilan 400. */
  gostergeGecikmeMs?: number;
  /** B8 Ö2: gosterge kapanmadan once ardisik islerin arasinda beklenen tolerans (ms; varsayilan 1000): yanip sonme ve her hafta duyuru olmaz. */
  gostergeKapanmaMs?: number;
  /**
   * B8 K1: Koşular/`#/sonuc`/`#/dao` yolundan acilan kayit secim ekrani gerektiriyor (uyumsuz, durdu, hata, uzun/uyumsuz tariften). Sessiz yeni koşu KURULMAZ;
   * yanit 409 `kayit_secim_gerek`. Arayuz hash'i o koşunun rotasina yazip kaydi tamamlayarak sayfayi yeniden yukler (acilis akisi ayni secim ekranini sunar).
   */
  kayitSecimiIcin?: (kosuId: string) => void | Promise<boolean>;
  /**
   * B7: oturum, guncel olmayan (onceki) model paketiyle acildi. Yeni oyun (`POST /api/runs`) bu pakette kurulmaz: 409 `yeni_surum_gerek` ve
   * `yeniOyunIcinYenile` (sayfa guncel paketle yeniden yuklenir, Kurucu'da acilir); aksi halde yeni kayit eski modelle yazilirdi.
   */
  eskiPaket?: boolean;
  yeniOyunIcinYenile?: () => void;
  /** B7 R3-1: kayittan acmada `yeniden_yukle_gerek` (kayit yuklu paketten farkli modelde): kayit tamamlanip AYNI rota ile yeniden yuklenir (kullanici kosusuna doner). */
  kayitIcinYenile?: (kosuId: string) => void;
}

type Dinleyici = (ev: { type: string; data?: unknown; lastEventId?: string }) => void;

/** `EventSource` benzeri akis (LiveSource'un kullandigi yuz: `addEventListener`, `readyState`, `close`). */
export class KopruAkisi {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = CLOSED;
  readyState = 0;
  abone: number | null = null;
  private readonly dinleyiciler = new Map<string, Set<Dinleyici>>();
  constructor(
    readonly url: string,
    readonly kosuId: string,
    private readonly kapatildi: (a: KopruAkisi) => void,
  ) {}
  addEventListener(tur: string, f: Dinleyici): void {
    let k = this.dinleyiciler.get(tur);
    if (!k) this.dinleyiciler.set(tur, (k = new Set()));
    k.add(f);
  }
  removeEventListener(tur: string, f: Dinleyici): void {
    this.dinleyiciler.get(tur)?.delete(f);
  }
  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.kapatildi(this);
  }
  /** Kopru kullanir. */
  yay(tur: string, data: unknown, id?: number): void {
    const ev = { type: tur, data, lastEventId: id === undefined ? "" : String(id) };
    for (const f of [...(this.dinleyiciler.get(tur) ?? [])]) {
      try {
        f(ev);
      } catch {
        // dinleyici hatasi akisi bozmaz
      }
    }
  }
}

interface KosuTakibi {
  abone: number;
  ebeveyn: [string, number] | null;
  /** Yazilamayan hafta paketleri (hafta -> paket); Python aboneliginden bir kez bosaltildigi icin burada tutulur. */
  bekleyen: Map<number, HaftaPaketi>;
  yazimUyarisi: boolean;
}

export class TarayiciKopru {
  private readonly isci: IsciCagrisi;
  private readonly kayit: KayitKatmani;
  private readonly hata: (kaynak: string, e: unknown) => void;
  private readonly dustu: (e: unknown) => void;
  private readonly uyari: (u: Uyari) => void;
  private readonly sessizlikAsimiMs: number;
  private readonly bekciYoklamaMs: number;
  private readonly bekleyenAzami: number;
  private readonly gostergeGecikmeMs: number;
  private readonly gostergeKapanmaMs: number;
  private readonly kayitSecimiIcin: (kosuId: string) => void | Promise<boolean>;
  private readonly gosterge = new Map<string, { gorunur: boolean; acik: ReturnType<typeof setTimeout> | null; kapan: ReturnType<typeof setTimeout> | null }>();
  private readonly kilitliBildirilen = new Set<string>();
  private readonly bekliyorBildirilen = new Set<string>();
  private readonly eskiPaket: boolean;
  private readonly yeniOyunIcinYenile: () => void;
  private readonly kayitIcinYenile: (kosuId: string) => void;
  /** Kimlik basina suren kayittan-acma (ayni anda gelen ikinci GET ayni sozu bekler). */
  private readonly kayittanAcilan = new Map<string, Promise<"tamam" | "yok" | "secim">>();
  private readonly kayittanDenenen = new Set<string>();
  private readonly secimGereken = new Set<string>();
  private uzunSayac = 0;
  private uzunBekleyen: (() => void) | null = null;
  private kayitYenilenen = new Set<string>();
  private readonly simdi: () => number;
  /** abone no -> kosu (kalicilik abonelikleri). */
  private readonly kalici = new Map<number, string>();
  private readonly kosular = new Map<string, KosuTakibi>();
  /** abone no -> arayuz akisi. */
  private readonly akislar = new Map<number, KopruAkisi>();
  private sira: Promise<unknown> = Promise.resolve();
  private durdu = true;
  private donguIsi: Promise<void> | null = null;
  private sonYazici = 0;
  private readonly p50Ornek: number[] = [];

  constructor(o: KopruSecenek) {
    this.isci = o.isci;
    this.kayit = o.kayit;
    this.hata = o.hata ?? (() => undefined);
    this.dustu = o.dustu ?? (() => undefined);
    this.uyari = o.uyari ?? (() => undefined);
    this.sessizlikAsimiMs = o.sessizlikAsimiMs ?? SESSIZLIK_ASIMI_MS;
    this.bekciYoklamaMs = o.bekciYoklamaMs ?? BEKCI_YOKLAMA_MS;
    this.bekleyenAzami = o.bekleyenAzami ?? BEKLEYEN_AZAMI;
    this.gostergeGecikmeMs = o.gostergeGecikmeMs ?? GOSTERGE_GECIKME_MS;
    this.gostergeKapanmaMs = o.gostergeKapanmaMs ?? GOSTERGE_KAPANMA_MS;
    this.kayitSecimiIcin = o.kayitSecimiIcin ?? (() => undefined);
    this.simdi = o.simdi ?? Date.now;
    this.eskiPaket = o.eskiPaket ?? false;
    this.yeniOyunIcinYenile = o.yeniOyunIcinYenile ?? (() => undefined);
    this.kayitIcinYenile = o.kayitIcinYenile ?? (() => undefined);
  }

  // ---- LiveSource enjeksiyonu -----------------------------------------------------------------------------------

  /** `createLiveSource({ fetchImpl })`. */
  readonly fetch: typeof fetch = (girdi, init) => this.istekYap(girdi, init);

  /**
   * `createLiveSource({ eventSourceImpl })` (`typeof EventSource` olarak verilir). `new` ile cagrilir: ok fonksiyonu degil, nesne donduren
   * duz fonksiyondur (`new f(url)` donen nesneyi verir).
   */
  readonly eventSource: typeof EventSource = ((): typeof EventSource => {
    const ac = (url: string): KopruAkisi => this.akisAc(url);
    return function KopruEventSource(url: string | URL): KopruAkisi {
      return ac(String(url));
    } as unknown as typeof EventSource;
  })();

  private async istekYap(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const sinyal = init?.signal;
    if (sinyal?.aborted) throw new DOMException("aborted", "AbortError");
    const url = typeof girdi === "string" ? girdi : girdi instanceof URL ? girdi.href : girdi.url;
    const u = new URL(url, "http://yerel.invalid");
    if (!u.pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    const yontem = (init?.method ?? "GET").toUpperCase();
    let govde: unknown;
    if (typeof init?.body === "string" && init.body !== "") govde = JSON.parse(init.body);
    let y: IstekYaniti;
    try {
      y = await this.iptalEdilebilir(this.gonder(yontem, u.pathname + u.search, govde), sinyal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // Cekirdek hatasi ya da Worker dustu: "sunucu yok" (ag hatasi) degil, 500 (LiveSource `sunucu_bozuk`); neden kodda.
      const kod = e instanceof CekirdekHatasi ? e.tur : "kopru_hatasi";
      y = { status: 500, headers: {}, body: { error: { code: kod } } };
    }
    const baslik = new Headers({ "Content-Type": "application/json" });
    const bos = y.status === 204 || y.body === null || y.body === undefined;
    return new Response(y.status === 204 ? null : bos ? "" : JSON.stringify(y.body), { status: y.status, headers: baslik });
  }

  /**
   * Sinyal gelirse bekleyen istegin CAGIRANI hemen birakilir (AbortError). Worker kuyrugundaki is yine yapilir (mesaj geri alinamaz);
   * yan etkisi olan istekler (mutasyon) bu yuzden iptal edilse de sonuclanabilir.
   */
  private iptalEdilebilir<T>(p: Promise<T>, sinyal: AbortSignal | null | undefined): Promise<T> {
    if (!sinyal) return p;
    return new Promise<T>((coz, reddet) => {
      const iptal = (): void => reddet(new DOMException("aborted", "AbortError"));
      sinyal.addEventListener("abort", iptal, { once: true });
      p.then(coz, reddet).finally(() => sinyal.removeEventListener("abort", iptal));
    });
  }

  /** Worker'a istek + `arsiv_gerek` + kayit yan etkileri. Dondurulen yanit son (arsiv sonrasi) yanittir. */
  async gonder(yontem: string, yol: string, govde?: unknown): Promise<IstekYaniti> {
    if (yontem === "POST" && this.eskiPaket && (yol.split("?")[0] ?? yol) === "/api/runs") {
      this.yeniOyunIcinYenile();
      return { status: 409, headers: {}, body: { error: { code: "yeni_surum_gerek" } } };
    }
    if (yontem === "POST") await this.yerAc(yol.split("?")[0] ?? yol);
    let son: IstekYaniti | null = null;
    try {
      await arsivliIstek(this.kayit.depo, async (arsiv?: HaftaPaketi[]): Promise<ArsivliYanit> => {
        const r = await this.isci.cagri("istek", { yontem, yol, govde, arsiv });
        son = r;
        return { status: r.status, body: r.body, arsiv_gerek: r.arsiv_gerek ?? undefined };
      });
    } catch (e) {
      if (e instanceof ArsivHatasi) return { status: 500, headers: {}, body: { error: { code: e.kod } } };
      throw e;
    }
    const y = son as IstekYaniti | null;
    if (y === null) throw new Error("yanit_yok");
    // Koşular ekranindan kayitli kosuyu acma: Python'da yok (404) ama IndexedDB'de kayit var -> yeniden kurma (devam/tariften), sonra istegi yinele.
    if (yontem === "GET" && y.status === 404) {
      const id = TEK_KOSU_YOLU.exec(yol.split("?")[0] ?? yol)?.[1];
      if (id !== undefined) {
        const a = await this.kayittanAc(decodeURIComponent(id));
        if (a === "tamam") return this.gonder(yontem, yol, govde);
        // Secim gerekiyor: 404 DEGIL (LiveSource tarifle yeni koşu kurardi); 409 ile yalnizca "su an acilamaz".
        if (a === "secim") return { status: 409, headers: {}, body: { error: { code: "kayit_secim_gerek" } } };
      }
    }
    await this.yanEtkiler(yontem, yol, y, govde);
    // Bariyer: bu istekten once Worker'dan gelmis olaylarin kalici yazimi bitmeden yanit (hafta/durum) arayuze verilmez; yenilemede geri gitme olmaz.
    await this.sira;
    return y;
  }

  /**
   * Kayitli ama Python'da olmayan kosuyu IndexedDB'den kurar (`devamEt`, goruntu yoksa `tariftenBastan`). Kimlik icin bir kez denenir; suren
   * deneme ayni anda gelen ikinci istekle PAYLASILIR (404 almaz, bitmeyi bekler). Suresince tick dongusu duraklar, ilerleme `acilis_suruyor` uyarisi.
   */
  private kayittanAc(kosuId: string): Promise<"tamam" | "yok" | "secim"> {
    const suren = this.kayittanAcilan.get(kosuId);
    if (suren) return suren;
    if (this.secimGereken.has(kosuId)) return Promise.resolve("secim");
    if (this.kosular.has(kosuId) || this.kayittanDenenen.has(kosuId)) return Promise.resolve("yok");
    this.kayittanDenenen.add(kosuId);
    const p = this.uzunIs(async (): Promise<"tamam" | "yok" | "secim"> => {
      const { depo, akis } = this.kayit;
      const k = await depo.kosuOku(kosuId);
      if (k === null) return "yok";
      await this.yerAc("/api/runs");
      const ilerleme = (hafta: number): void => this.uyari({ tur: "acilis_suruyor", kosuId, hafta, hedef: k.yayimlanan });
      let s = await akis.devamEt(kosuId, { ilerleme });
      if (s.sonuc === "hata" && s.tur === "kosu_yok") return "yok";
      if (s.sonuc !== "tamam") {
        // Acilis akisiyla AYNI tablo (`acilisKarari`): otomatik baştan oynatma ya da secim ekrani. Sessiz yeni kosu kurulmaz (K1).
        if (s.sonuc === "tariften_gerek" && (await akis.yenidenYuklemeGerekli(kosuId).catch(() => false))) s = { sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" };
        else {
          const u = await akis.uyumlulukDurumu(kosuId).catch(() => null);
          const karar = acilisKarari(s, { uyumlu: u?.uyumlu ?? true, ...(u ? { fark: u.fark } : {}) });
          if (karar.tur === "otomatik") s = await akis.tariftenBastan(kosuId, { ilerleme });
        }
      }
      this.uyari({ tur: "acilis_bitti", kosuId });
      if (s.sonuc !== "tamam") {
        this.secimGereken.add(kosuId);
        // Yenileme baslamazsa (kayit tamamlanamadi) kayit silinir: sonraki "Ac" yeniden dener.
        void Promise.resolve(this.kayitSecimiIcin(kosuId)).then((ok) => {
          if (ok === false) {
            this.secimGereken.delete(kosuId);
            this.kayittanDenenen.delete(kosuId);
          }
        });              // hash o kosunun rotasina yazilir, kayit tamamlanip sayfa yeniden yuklenir: acilis akisi secim ekranini sunar
        return "secim";
      }
      await this.takipEt(kosuId);
      return "tamam";
    }).finally(() => this.kayittanAcilan.delete(kosuId));
    this.kayittanAcilan.set(kosuId, p);
    return p;
  }

  /**
   * Uzun suren Worker cagrisi (devam/tariften oynatma): suresince tick dongusu duraklar (cagri Worker'da FIFO'dur; tick arkasinda beklemesin ve
   * bekci yalniz ilerleme mesajlariyla beslensin). B8'in `dalOlustur` cagrilari da bunun icinden gecmelidir.
   */
  async uzunIs<T>(is: () => Promise<T>): Promise<T> {
    this.uzunSayac++;
    try {
      return await is();
    } finally {
      this.uzunSayac--;
      if (this.uzunSayac === 0) {
        this.uzunBekleyen?.();
        this.uzunBekleyen = null;
      }
    }
  }

  /**
   * Yeni kosu (olusturma/dal) oncesi: Python en cok `MAX_RUNS` (2) kosu tutar ve ABONESI olan kosuyu cikarmaz (429). Arayuzu ekranda olmayan
   * (acik SSE baglantisi kalmamis) kosularin kalicilik aboneligi birakilir; boylece Python en eskisini cikarabilir. Kayit IndexedDB'de durur
   * (yeniden acilis `devamEt` ile). Dalin ebeveyni korunur.
   */
  private async yerAc(yolu: string): Promise<void> {
    const dal = /^\/api\/runs\/([^/]+)\/branch$/.exec(yolu);
    if (yolu !== "/api/runs" && dal === null) return;
    if (this.kosular.size < MAX_KOSU) return;
    const koru = dal === null ? null : decodeURIComponent(dal[1] ?? "");
    const arayuzde = new Set([...this.akislar.values()].map((a) => a.kosuId));
    for (const id of [...this.kosular.keys()]) {
      if (id === koru || arayuzde.has(id)) continue;
      await this.takipBitir(id);
    }
  }

  /** Olusturma/dal -> kayit + abone; silme -> takip biter; mutasyon -> gunluk senkronu + olay drenaji. */
  private async yanEtkiler(yontem: string, yol: string, y: IstekYaniti, govde: unknown): Promise<void> {
    if (yontem === "GET" || y.status < 200 || y.status >= 300) return;
    const yolu = yol.split("?")[0] ?? yol;
    const body = y.body as { runId?: unknown } | null;
    if (yontem === "POST" && yolu === "/api/runs") {
      if (typeof body?.runId === "string") await this.kosuKur(body.runId, null);
      return;
    }
    const m = RUN_YOLU.exec(yolu);
    if (!m) return;
    const kosuId = decodeURIComponent(m[1] ?? "");
    const alt = m[2] ?? "";
    if (yontem === "POST" && alt === "/branch") {
      const hafta = (govde as { week?: unknown } | null | undefined)?.week;
      if (typeof body?.runId === "string") await this.kosuKur(body.runId, typeof hafta === "number" ? [kosuId, hafta] : null);
      return;
    }
    if (yontem === "DELETE" && alt === "") {
      this.kayittanDenenen.add(kosuId);          // silinen kosu GET ile kayittan diriltilmez
      await this.takipBitir(kosuId);
      return;
    }
    // Diger mutasyonlar (kontrol, degisiklik, karar): uretilen olaylar hemen dagitilir; gunluk senkronu ARKADAN (yazici kosu basina siralar),
    // yanit Worker/IndexedDB sirasini beklemez (`gunlukAl` sonraki tick'in arkasina dusebilir).
    void this.korumali("gunluk", () => this.kayit.yazici.gunlukSenkronla(kosuId));
    this.drenajPlanla();
  }

  /**
   * Koşu yaratildi (yeni, dal): ONCE kayit (aksi halde abonelik penceresindeki haftalar `kosu_yok` ile yazilamazdi), sonra kalicilik aboneligi.
   * Aradaki sure (iki Worker turu) abonesiz kosunun 15 sn duraklama siniri ve Python paket birikimi (abonesizken kirpilmaz) icinde kalir.
   * Kayit acilamazsa oyun surer ama kullaniciya GORUNUR uyari verilir; haftalar bellekte bekler, yazim kayit kendini acabildiginde tamamlanir.
   */
  async kosuKur(kosuId: string, ebeveyn: [string, number] | null): Promise<void> {
    try {
      await this.kayit.yazici.kosuBaslat(kosuId, { ebeveyn });
    } catch (e) {
      this.hata("kosu_baslat", e);
      this.uyari({ tur: "kayit_acilamadi", kosuId });
    }
    await this.takipEt(kosuId, ebeveyn);
  }

  /** Mevcut (devam edilen) kosuyu kalicilik abonesiyle takibe alir. Idempotent. */
  async takipEt(kosuId: string, ebeveyn: [string, number] | null = null): Promise<void> {
    if (this.kosular.has(kosuId)) return;
    const r = await this.isci.cagri("istek", { yontem: "GET", yol: `/api/runs/${encodeURIComponent(kosuId)}/events` });
    const abone = (r.body as { abone?: unknown } | null)?.abone;
    if (r.status !== 200 || typeof abone !== "number") throw new Error("abone_olunamadi");
    this.kosular.set(kosuId, { abone, ebeveyn, bekleyen: new Map(), yazimUyarisi: false });
    this.kalici.set(abone, kosuId);
    this.drenajPlanla();
  }

  private async takipBitir(kosuId: string): Promise<void> {
    const t = this.kosular.get(kosuId);
    if (!t) return;
    this.kosular.delete(kosuId);
    this.kalici.delete(t.abone);
    await this.isci.cagri("olayKapat", { abone: t.abone }).catch(() => undefined);
  }

  // ---- SSE ------------------------------------------------------------------------------------------------------

  private akisAc(url: string): KopruAkisi {
    const yol = new URL(url, "http://yerel.invalid").pathname;
    const m = EVENTS_YOLU.exec(yol);
    const akis = new KopruAkisi(url, m ? decodeURIComponent(m[1] ?? "") : "", (a) => this.akisKapandi(a));
    void this.akisBagla(akis, m !== null);
    return akis;
  }

  private async akisBagla(akis: KopruAkisi, gecerli: boolean): Promise<void> {
    try {
      if (!gecerli) throw new Error("gecersiz_yol");
      const r = await this.isci.cagri("istek", { yontem: "GET", yol: new URL(akis.url, "http://yerel.invalid").pathname });
      const abone = (r.body as { abone?: unknown } | null)?.abone;
      if (r.status !== 200 || typeof abone !== "number") throw new Error("abone_olunamadi");
      if (akis.readyState === CLOSED) {
        await this.isci.cagri("olayKapat", { abone }).catch(() => undefined);
        return;
      }
      akis.abone = abone;
      akis.readyState = 1;
      this.akislar.set(abone, akis);
      this.drenajPlanla();
    } catch {
      if (akis.readyState !== CLOSED) {
        akis.readyState = CLOSED;
        akis.yay("error", undefined);
      }
    }
  }

  private akisKapandi(a: KopruAkisi): void {
    if (a.abone === null) return;
    this.akislar.delete(a.abone);
    void this.isci.cagri("olayKapat", { abone: a.abone }).catch(() => undefined);
  }

  // ---- olay isleme ----------------------------------------------------------------------------------------------

  private tumAboneler(): number[] {
    return [...this.kalici.keys(), ...this.akislar.keys()];
  }

  /** Kuyruk: drenajlar ve tick sonuclari tek sirada islenir (sira bozulmaz). */
  private seriye<T>(is: () => Promise<T>): Promise<T> {
    const p = this.sira.then(is, is);
    this.sira = p.catch(() => undefined);
    return p;
  }

  /**
   * Kosu olusumu/mutasyon sonrasi olaylari hemen almak icin (tick'i beklemeden). Istek SIRADAN CIKARILMADAN gonderilir ve yanitlar Worker'in
   * urettigi sirayla islenir: bir tick'in sonucu, ondan SONRA istenen drenajdan once uygulanir (aksi halde arayuz bir haftayi kayittan once gorebilirdi).
   */
  drenajPlanla(): void {
    const aboneler = this.tumAboneler();
    if (aboneler.length === 0) return;
    this.isci
      .cagri("olaylar", { aboneler })
      .then((s) => this.seriye(() => this.olaylariIsle(s)))
      .catch((e) => this.hata("drenaj", e));
  }

  private async olaylariIsle(sonuclar: AboneOlaylari[]): Promise<void> {
    // 1) kalicilik (IndexedDB) -- arayuzden ONCE: ekranda gorulen hafta kayitta vardir.
    for (const s of sonuclar) {
      const kosuId = this.kalici.get(s.abone);
      if (kosuId === undefined) continue;
      const paketler = s.olaylar.filter((o) => o.event === "week").map((o) => o.data as HaftaPaketi);
      if (paketler.length > 0) await this.haftalariYaz(kosuId, paketler);
      if (s.kapandi) {
        // Koşu bitti/silindi: yazilamamis haftalar dusmez. Son yazim denenir; hala bekleyen varsa kosu takipte kalir (dongu yeniden dener).
        this.kalici.delete(s.abone);
        await this.haftalariYaz(kosuId, []);
        if ((this.kosular.get(kosuId)?.bekleyen.size ?? 0) === 0) this.kosular.delete(kosuId);
      }
    }
    // 2) arayuz akislari
    for (const s of sonuclar) {
      const akis = this.akislar.get(s.abone);
      if (akis === undefined) continue;
      for (const o of s.olaylar) this.dagit(akis, o);
      if (s.kapandi) {
        this.akislar.delete(s.abone);
        if (akis.readyState !== CLOSED) {
          akis.readyState = CLOSED;
          akis.yay("error", undefined);
        }
      }
    }
  }

  /**
   * Hafta paketlerini yazar. Python aboneliginden bir kez bosaltilan olay geri gelmez: yazilamayanlar kosu basina bellekte tutulur ve
   * her sonraki drenaj/tick'te yeniden denenir. Kuyruk ATILMAZ (delik olmaz): `bekleyenAzami`ya gelince tick dongusu durur. `kosu_yok` olursa
   * kayit sira DISINDA yeniden acilir (HTTP bariyeri bu islemi beklemez). Kalici basarisizlikta kullaniciya uyari.
   */
  private async haftalariYaz(kosuId: string, yeni: readonly HaftaPaketi[]): Promise<void> {
    const t = this.kosular.get(kosuId);
    const bekleyen = t?.bekleyen ?? new Map<number, HaftaPaketi>();
    for (const p of yeni) bekleyen.set(p.week, p);
    olcumTepe("yazimKuyrugu", bekleyen.size);
    if (bekleyen.size === 0) return;
    const liste = [...bekleyen.values()].sort((a, b) => a.week - b.week);
    for (let n = 0; n < YAZIM_DENEME; n++) {
      try {
        await this.kayit.yazici.haftalarOlayi(kosuId, liste);
        bekleyen.clear();
        if (t?.yazimUyarisi) {
          t.yazimUyarisi = false;
          this.uyari({ tur: "kayit_duzeldi", kosuId });
        }
        return;
      } catch (e) {
        this.hata("hafta", e);
        if ((e as { kod?: unknown } | null)?.kod === "kosu_yok") {
          this.kayitiYenidenAc(kosuId, t?.ebeveyn ?? null);
          break;
        }
      }
    }
    if (t !== undefined && !t.yazimUyarisi) {
      t.yazimUyarisi = true;
      this.uyari({ tur: "kayit_yazilamadi", kosuId, bekleyen: bekleyen.size });
    }
  }

  private kayitiYenidenAc(kosuId: string, ebeveyn: [string, number] | null): void {
    if (this.kayitYenilenen.has(kosuId)) return;
    this.kayitYenilenen.add(kosuId);
    void this.korumali("kosu_baslat", () => this.kayit.yazici.kosuBaslat(kosuId, { ebeveyn })).finally(() => this.kayitYenilenen.delete(kosuId));
  }

  private yazimDolu(): boolean {
    for (const k of this.kosular.values()) if (k.bekleyen.size >= this.bekleyenAzami) return true;
    return false;
  }

  private dagit(akis: KopruAkisi, o: OlayTel): void {
    akis.yay(o.event, JSON.stringify(o.data), o.id);
  }

  /** Yazim/okuma hatasi oyunu kesmez: bildirilir. */
  private async korumali<T>(kaynak: string, is: () => Promise<T>): Promise<T | undefined> {
    try {
      return await is();
    } catch (e) {
      this.hata(kaynak, e);
      return undefined;
    }
  }

  /**
   * B8: is `gostergeGecikmeMs`'den uzun surerse `{tur, mesgul: true}` bildirilir; is bitince gosterge `gostergeKapanmaMs` sonra (araya yeni is girmediyse)
   * kapanir. Ardisik isler (hafta adimlari) gostergeyi acik tutar: yanip sonme ve her hafta duyuru olmaz; kisa isler hic gosterilmez.
   */
  private async gostergeyle<T>(tur: "hesaplaniyor" | "kaydediliyor", is: () => Promise<T>): Promise<T> {
    let g = this.gosterge.get(tur);
    if (!g) this.gosterge.set(tur, (g = { gorunur: false, acik: null, kapan: null }));
    const d = g;
    if (d.kapan !== null) {
      clearTimeout(d.kapan);
      d.kapan = null;
    }
    if (!d.gorunur && d.acik === null) {
      d.acik = setTimeout(() => {
        d.acik = null;
        d.gorunur = true;
        this.uyari({ tur, mesgul: true });
      }, this.gostergeGecikmeMs);
    }
    try {
      return await is();
    } finally {
      if (d.acik !== null) {
        clearTimeout(d.acik);
        d.acik = null;
      }
      if (d.gorunur && d.kapan === null) {
        d.kapan = setTimeout(() => {
          d.kapan = null;
          d.gorunur = false;
          this.uyari({ tur, mesgul: false });
        }, this.gostergeKapanmaMs);
      }
    }
  }

  /** `yazici.tick` + B8 durum bildirimi: kilitli (bir kez), hazir_degil (acilir/kapanir), "kaydediliyor". */
  private async yaziciTick(kosuId: string): Promise<Awaited<ReturnType<KayitKatmani["yazici"]["tick"]>> | undefined> {
    const y = await this.gostergeyle("kaydediliyor", () => this.korumali("yazici_tick", () => this.kayit.yazici.tick(kosuId)));
    if (y === undefined) return undefined;
    const d = y.goruntu.durum;
    if (d === "kilitli") {
      if (!this.kilitliBildirilen.has(kosuId)) {
        this.kilitliBildirilen.add(kosuId);
        this.uyari({ tur: "kayit_kilitli", kosuId, kilitli: true });
      }
    } else if (this.kilitliBildirilen.delete(kosuId)) this.uyari({ tur: "kayit_kilitli", kosuId, kilitli: false });
    if (d === "hazir_degil") {
      if (!this.bekliyorBildirilen.has(kosuId)) {
        this.bekliyorBildirilen.add(kosuId);
        this.uyari({ tur: "kayit_bekliyor", kosuId, bekliyor: true });
      }
    } else if (this.bekliyorBildirilen.delete(kosuId)) this.uyari({ tur: "kayit_bekliyor", kosuId, bekliyor: false });
    return y;
  }

  // ---- tick dongusu ---------------------------------------------------------------------------------------------

  get calisiyor(): boolean {
    return !this.durdu;
  }

  /** Tick dongusunu baslatir (idempotent). */
  baslat(): void {
    if (!this.durdu) return;
    this.durdu = false;
    this.donguIsi = this.dongu();
  }

  /** Bellekte kalici yazimi bekleyen hafta paketi sayisi (B7: yeni surum uygulamasi oncesi sifir olmali). */
  bekleyenYazim(): number {
    let n = 0;
    for (const k of this.kosular.values()) n += k.bekleyen.size;
    return n;
  }

  /**
   * B7: yeni surum uygulamasi oncesi kaydi KESIN tamamlar. Sira: dongu durur (yeni hafta uretilmez: onay ile tamamlama arasi yaris yok), kuyruk
   * bosalir, bekleyen hafta paketleri yazilir, sonra her koşu icin gunluk senkronu ve son `yazici.tick` (kadansa gore goruntu). Koşu basina yazici kuyrugu
   * sirali oldugundan bu cagrilar daha once siraya girmis (askidaki) gunluk yazimlarinin da BITMESINI bekler. `false` = bir yazim basarisiz.
   */
  async kayitTamamla(): Promise<boolean> {
    await this.durdur();
    await this.bosalt().catch(() => undefined);
    await this.bekleyenleriYaz().catch(() => undefined);
    let tamam = true;
    for (const kosuId of [...this.kosular.keys()]) {
      if ((await this.korumali("gunluk", () => this.kayit.yazici.gunlukSenkronla(kosuId))) === undefined) tamam = false;
      if ((await this.yaziciTick(kosuId)) === undefined) tamam = false;
    }
    await this.bosalt().catch(() => undefined);
    return tamam && this.bekleyenYazim() === 0;
  }

  /** Devir/kapatma oncesi: bellekte bekleyen hafta paketlerinin son yazim denemesi. */
  async bekleyenleriYaz(): Promise<void> {
    for (const [kosuId, k] of [...this.kosular]) if (k.bekleyen.size > 0) await this.haftalariYaz(kosuId, []);
  }

  /** Siradaki (kalici yazim dahil) isler bitene dek bekler; kapatmadan once cagrilir. */
  async bosalt(): Promise<void> {
    await this.sira;
  }

  /** Dongunun bitmesini bekler (testler). */
  async durdur(): Promise<void> {
    this.durdu = true;
    this.uzunBekleyen?.();                      // uzun is beklerken duran dongu hemen cikar
    this.uzunBekleyen = null;
    await this.donguIsi?.catch(() => undefined);
    this.donguIsi = null;
  }

  /** Arayuzun "su an takip edilen" koşulari (paneldeki Sil/Ac kararlari icin). */
  takipEdilenler(): ReadonlySet<string> {
    return new Set(this.kosular.keys());
  }

  /**
   * B8 Y1: kaydi KOPRU uzerinden siler: once takip biter (yazim durur, GET ile diriltilmez), kuyruk bosalir, sonra cekirdek + depo silinir.
   * Cekirdek "yok" disinda bir hatayla silemezse hata YUKARI cikar ve kayit silinmez.
   */
  async kosuSil(kosuId: string): Promise<void> {
    this.kayittanDenenen.add(kosuId);
    await this.takipBitir(kosuId);
    await this.bosalt().catch(() => undefined);
    await this.kayit.akis.kosuSil(kosuId, { kayitlaBirlikte: true });
  }

  private async dongu(): Promise<void> {
    const bekci = setInterval(() => this.bekciYokla(), this.bekciYoklamaMs);
    try {
      await this.donguGovdesi();
    } finally {
      clearInterval(bekci);
    }
  }

  private async donguGovdesi(): Promise<void> {
    while (!this.durdu) {
      // Uzun cagri (kayittan acma) suruyorsa tick gonderilmez.
      if (this.uzunSayac > 0) {
        await new Promise<void>((coz) => (this.uzunBekleyen = coz));
        continue;
      }
      // Yazim kuyrugu dolu: tick durur (delik olusmasin), yazim yeniden denenir.
      if (this.yazimDolu()) {
        for (const [kosuId, k] of [...this.kosular]) if (k.bekleyen.size > 0) await this.haftalariYaz(kosuId, []);
        if (this.yazimDolu()) await new Promise<void>((c) => setTimeout(c, DOLU_YENIDEN_MS));
        continue;
      }
      let r: TickSonucu;
      try {
        r = await this.gostergeyle("hesaplaniyor", () => this.isci.cagri("tick", { aboneler: this.tumAboneler(), bostaBekleMs: BOSTA_BEKLEME_MS }));
      } catch (e) {
        if (!this.durdu) {
          this.durdu = true;
          this.dustu(e);
        }
        return;
      }
      // Gercek bosta: kisa SURDU ve hic hafta yayimlanmadi (onceden hesaplanmis hafta yayimi hesapsiz kisa olabilir ama bosta degildir).
      const haftaVar = r.olaylar.some((x) => x.olaylar.some((o) => o.event === "week"));
      const bosta = r.ms < BOSTA_MS && !haftaVar;
      try {
        await this.seriye(() => this.olaylariIsle(r.olaylar));
      } catch (e) {
        this.hata("olay", e);
      }
      const t = this.simdi();
      if (!bosta || t - this.sonYazici >= BOSTA_YAZICI_MS) {
        this.sonYazici = t;
        for (const kosuId of [...this.kosular.keys()]) {
          if (this.durdu) break;
          await this.yaziciTick(kosuId);
        }
      }
      // Yazilamayan haftalar her turda yeniden denenir (yeni olay gelmese de); HTTP bariyeri (`sira`) bunu BEKLEMEZ.
      for (const [kosuId, k] of [...this.kosular]) if (k.bekleyen.size > 0 && !this.durdu) await this.haftalariYaz(kosuId, []);
      if (!bosta && r.ms >= BOSTA_MS) this.p50Guncelle(r.ms / 1000);
    }
  }

  /** Bekci: bekleyen cagri varken Worker'dan HICBIR mesaj gelmezse (ilerleme dahil) sessizlik birikir; sinir asilirsa olu sayilir. */
  private bekciSessiz = 0;
  private bekciSonSayi = -1;
  private bekciSon = 0;
  private bekciYokla(): void {
    const simdi = this.simdi();
    const gecen = this.bekciSon === 0 ? this.bekciYoklamaMs : Math.min(simdi - this.bekciSon, 2 * this.bekciYoklamaMs);
    this.bekciSon = simdi;
    const sayi = this.isci.mesajSayisi?.() ?? 0;
    const bekleyen = this.isci.bekleyen?.() ?? 0;
    if (bekleyen === 0 || sayi !== this.bekciSonSayi) this.bekciSessiz = 0;
    else this.bekciSessiz += gecen;
    this.bekciSonSayi = sayi;
    olcumTepe("bekciSessizMs", this.bekciSessiz);
    if (this.bekciSessiz > this.sessizlikAsimiMs && !this.durdu) {
      this.durdu = true;
      this.isci.kapat?.();
      this.dustu(new CekirdekHatasi("IsciHatasi", "yanit_yok"));
    }
  }

  /** Gercek hafta adimlarinin ortancasi `/api/hello` `sec_per_week_p50` icin. */
  private p50Guncelle(sn: number): void {
    this.p50Ornek.push(sn);
    if (this.p50Ornek.length > P50_ORNEK) this.p50Ornek.shift();
    if (this.p50Ornek.length < 3) return;
    const s = [...this.p50Ornek].sort((a, b) => a - b);
    const ort = s[Math.floor(s.length / 2)] ?? sn;
    const deger = Math.round(ort * 100) / 100;
    void this.isci.cagri("p50", { sn: deger }).catch(() => undefined);
    void this.kayit.depo.metaYaz("p50", deger).catch(() => undefined);      // sonraki acilista cekirdege onceden verilir (`/hello` dogru deger)
  }
}
