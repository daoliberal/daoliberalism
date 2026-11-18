/**
 * B5: ana is parcacigi tarafi. Worker'i baslatir, yukleme ilerlemesini iletir ve `cagri` ile istek/yanit (korelasyon kimligi) sunar.
 * Iptal = `worker.terminate()` (betada baska kesme yoktur: `SharedArrayBuffer`/`setInterruptBuffer` ve COOP/COEP kullanilmaz).
 */
import { CekirdekHatasi } from "./kayit/cekirdek";
import type { ModelAnahtari } from "./kayit/tel";
import {
  MANIFEST_YOLU,
  PYODIDE_YOLU,
  YuklemeHatasi,
  type AnaMesaj,
  type IsciMesaji,
  type Manifest,
  type YontemAdi,
  type YontemGirdisi,
  type YontemSonucu,
  type YuklemeAsamasi,
  type YuklemeSureleri,
} from "./protokol";

/** `Worker` yuzeyi (testte sahte). */
export interface WorkerBaglantisi {
  postMessage(m: AnaMesaj, aktar?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: IsciMesaji }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
  onmessageerror?: ((ev: unknown) => void) | null;
}

export interface YuklemeIlerlemesi {
  asama: YuklemeAsamasi;
  /** 0..1; bilinmiyorsa null. */
  oran: number | null;
  alinan?: number;
  toplam?: number | null;
}

export interface CagriSecenegi {
  aktar?: Transferable[];
  /** `devam`/`tariftenOynat`: oynatilan hafta (yanit gelene dek). */
  devamIlerleme?: (hafta: number) => void;
}

interface Bekleyen {
  coz(s: unknown): void;
  reddet(e: unknown): void;
  devamIlerleme?: (hafta: number) => void;
}

/** Hazir Worker ile konusma: istek/yanit, hata `CekirdekHatasi{tur, mesaj, fark}`. */
export class IsciIstemcisi {
  private sonId = 0;
  private readonly bekleyenler = new Map<number, Bekleyen>();
  private kapali = false;
  private mesajlar = 0;

  constructor(
    private readonly worker: WorkerBaglantisi,
    readonly bilgi: { anahtar: ModelAnahtari; manifest: Manifest; sureler: YuklemeSureleri },
    /** Yaşam boyu hata dinleyicisi (Worker dustu). */
    private readonly dustu: (e: unknown) => void = () => undefined,
  ) {
    worker.onmessage = (ev) => this.mesaj(ev.data);
    worker.onerror = () => this.coktu(new CekirdekHatasi("IsciHatasi", "kapali"));
    worker.onmessageerror = () => this.coktu(new CekirdekHatasi("IsciHatasi", "kapali"));
  }

  /** `yukleyici` yukleme asamasinda aldigi mesajlari buraya yonlendirir (hazir sonrasi). */
  mesaj(m: IsciMesaji): void {
    this.mesajlar++;
    if (m.t === "yanit") {
      const b = this.bekleyenler.get(m.id);
      if (!b) return;
      this.bekleyenler.delete(m.id);
      if (m.ok) b.coz(m.s);
      else b.reddet(new CekirdekHatasi(m.hata.tur, m.hata.mesaj, m.hata.fark));
    } else if (m.t === "devamIlerleme") {
      this.bekleyenler.get(m.id)?.devamIlerleme?.(m.hafta);
    }
  }

  cagri<Y extends YontemAdi>(y: Y, a: YontemGirdisi<Y>, o: CagriSecenegi = {}): Promise<YontemSonucu<Y>> {
    if (this.kapali) return Promise.reject(new CekirdekHatasi("IsciHatasi", "kapali"));
    const id = ++this.sonId;
    return new Promise<YontemSonucu<Y>>((coz, reddet) => {
      this.bekleyenler.set(id, { coz: coz as (s: unknown) => void, reddet, devamIlerleme: o.devamIlerleme });
      try {
        this.worker.postMessage({ t: "cagri", id, y, a } as AnaMesaj, o.aktar ?? []);
      } catch (e) {
        this.bekleyenler.delete(id);
        reddet(e);
      }
    });
  }

  /** Worker'i sonlandirir; bekleyen tum cagrilar reddedilir. */
  kapat(): void {
    this.coktu(new CekirdekHatasi("IsciHatasi", "kapali"), false);
  }

  private coktu(e: CekirdekHatasi, bildir = true): void {
    if (this.kapali) return;
    this.kapali = true;
    try {
      this.worker.terminate();
    } catch {
      // zaten kapali
    }
    for (const b of this.bekleyenler.values()) b.reddet(e);
    this.bekleyenler.clear();
    if (bildir) this.dustu(e);
  }

  mesajSayisi(): number {
    return this.mesajlar;
  }

  bekleyen(): number {
    return this.bekleyenler.size;
  }

  get acik(): boolean {
    return !this.kapali;
  }

}

export interface YukleyiciSecenek {
  workerUret(): WorkerBaglantisi;
  origin: string;
  /**
   * B7: kayitli oyunun model_sha256'i. Verilirse manifest `?model=<sha>` ile istenir: Service Worker o modele uyan (guncel ya da onceki) paketin
   * manifestini doner; SW yoksa/uymuyorsa guncel manifest gelir (eski davranis: kayit uyumsuz sayilir).
   */
  model?: string;
  ilerleme?: (i: YuklemeIlerlemesi) => void;
  /** Hazir olduktan sonra Worker dusmesi. */
  dustu?: (e: unknown) => void;
}

export interface YukleyiciSonucu {
  istemci: IsciIstemcisi;
}

/** Calisan yukleme; `iptal()` Worker'i sonlandirir ve `bitti` `iptal_edildi` ile reddedilir. */
export class OyunYukleyici {
  readonly bitti: Promise<YukleyiciSonucu>;
  private worker: WorkerBaglantisi | null = null;
  private reddet: ((e: unknown) => void) | null = null;
  private bitis = false;

  constructor(private readonly o: YukleyiciSecenek) {
    this.bitti = new Promise<YukleyiciSonucu>((coz, reddet) => {
      this.reddet = reddet;
      let w: WorkerBaglantisi;
      try {
        w = o.workerUret();
      } catch (e) {
        this.bitis = true;
        reddet(new YuklemeHatasi("worker_baslamadi", {}, e));
        return;
      }
      this.worker = w;
      w.onerror = (ev) => {
        if (this.bitis) return;
        this.bitis = true;
        this.sonlandir();
        reddet(new YuklemeHatasi("worker_baslamadi", { mesaj: ev.message ?? "" }));
      };
      w.onmessage = (ev) => {
        const m = ev.data;
        if (this.bitis) return;
        if (m.t === "ilerleme") o.ilerleme?.({ asama: m.asama, oran: m.oran, alinan: m.alinan, toplam: m.toplam });
        else if (m.t === "yuklemeHatasi") {
          this.bitis = true;
          this.sonlandir();
          reddet(new YuklemeHatasi(m.kod, m.ayrinti));
        } else if (m.t === "hazir") {
          this.bitis = true;
          coz({ istemci: new IsciIstemcisi(w, { anahtar: m.anahtar, manifest: m.manifest, sureler: m.sureler }, o.dustu) });
        }
      };
      w.postMessage({
        t: "yukle",
        girdi: { manifestUrl: `${o.origin}${MANIFEST_YOLU}${o.model ? `?model=${encodeURIComponent(o.model)}` : ""}`, pyodideDizini: `${o.origin}${PYODIDE_YOLU}`, oyunDizini: `${o.origin}${MANIFEST_YOLU.slice(0, MANIFEST_YOLU.lastIndexOf("/") + 1)}` },
      });
    });
  }

  private sonlandir(): void {
    try {
      this.worker?.terminate();
    } catch {
      // zaten kapali
    }
  }

  /** Yukleme sirasinda iptal. Yukleme bittiyse etkisizdir (`IsciIstemcisi.kapat` kullanilir). */
  iptal(): void {
    if (this.bitis) return;
    this.bitis = true;
    this.sonlandir();
    this.reddet?.(new YuklemeHatasi("iptal_edildi"));
  }
}
