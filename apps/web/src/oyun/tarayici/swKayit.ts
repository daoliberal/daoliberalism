/**
 * B7: Service Worker kaydi ve "yeni surum hazir" yonetimi. Yalniz oyun sayfasindan (/oyun/), YALNIZ tarayici kaynagi bayrakli URETIM derlemesinde,
 * oyun yuklendikten SONRA kaydedilir (ilk acilista Pyodide'i hem sayfa hem SW indirmesin: dosyalar HTTP onbelleginden gelir). Ana sayfa kaydetmez.
 *
 * Yeni surum kendiliginden UYGULANMAZ: bekleyen worker hazir olunca durum "hazir" olur (arayuz bant gosterir); kullanici onaylayinca
 * `uygula(hazirla, surdur)`: once oyun kaydi tamamlanir (`hazirla`: dongu durur, bekleyen yazimlar yazilir; basarisizsa surum UYGULANMAZ ve oyun surer),
 * sonra bekleyen worker'a `atla` gonderilir, `controllerchange` gelince sayfa yeniden yuklenir (kayittan devam eder).
 */
export const SW_YOLU = "/sw.js";
/**
 * Kapsam `/`: Chromium bir Web Worker'in alt isteklerini (manifest, Pyodide, paket) YALNIZ worker betiginin URL'si SW kapsamindaysa denetler. Oyun Worker'i
 * `/_next/static/chunks/...` altindan yuklenir; `/oyun/` kapsami Worker'in butun isteklerini SW'nin disinda birakir (e2e ile olculdu). KAYIT yine yalniz
 * oyun sayfasindan yapilir; kayit sonrasi SW tanitim sayfalarinda hicbir sey yanitlamaz (fetch dinleyicisi yalniz oyun yollarini tutar, gerisi aga gider).
 */
export const SW_KAPSAMI = "/";
const GUNCELLEME_ARALIGI_MS = 60 * 60 * 1000;
const GUNCELLEME_ESIGI_MS = 5 * 60 * 1000;
const DEGISIM_ZAMAN_ASIMI_MS = 10_000;

export type YeniSurumDurumu = "yok" | "hazir" | "kaydediliyor" | "uygulaniyor" | "hata";

interface IsciYuzu {
  readonly state: string;
  postMessage(m: unknown): void;
  addEventListener(tur: "statechange", f: () => void): void;
  removeEventListener?(tur: "statechange", f: () => void): void;
}

interface KayitYuzu {
  readonly waiting: IsciYuzu | null;
  readonly installing: IsciYuzu | null;
  addEventListener(tur: "updatefound", f: () => void): void;
  update(): Promise<unknown>;
}

export interface KonteynerYuzu {
  readonly controller: unknown;
  register(url: string, secenek: { scope: string; updateViaCache?: "none" | "all" | "imports" }): Promise<KayitYuzu>;
  addEventListener(tur: "controllerchange", f: () => void): void;
  removeEventListener(tur: "controllerchange", f: () => void): void;
}

export interface SwSecenek {
  /** Derleme bayragi (`NEXT_PUBLIC_OYUN_KAYNAK=tarayici`) ve uretim derlemesi. */
  etkin: boolean;
  konteyner: KonteynerYuzu | null;
  guvenliBaglam: boolean;
  /** `location.pathname`. */
  yol: string;
  yenidenYukle(): void;
  /** Sayfa gorunurlugu degisince guncelleme denetimi icin (testte enjekte). */
  gorunurluk?: { dinle(f: () => void): () => void; gorunur(): boolean };
  zamanlayici?: { aralik(f: () => void, ms: number): () => void; zaman(): number; bekle(ms: number): Promise<void> };
  hata?: (e: unknown) => void;
}

const GERCEK_ZAMAN = {
  aralik: (f: () => void, ms: number) => {
    const t = setInterval(f, ms);
    return () => clearInterval(t);
  },
  zaman: () => Date.now(),
  bekle: (ms: number) => new Promise<void>((c) => setTimeout(c, ms)),
};

export class SwKaydi {
  private durumDeger: YeniSurumDurumu = "yok";
  private readonly dinleyiciler = new Set<(d: YeniSurumDurumu) => void>();
  private sonKontrol: number;
  private readonly temizlik: (() => void)[] = [];
  private readonly ilkDenetleyici: unknown;
  /** Kullanici onayi verildi: `controllerchange` (gec de gelse, baska sekme onaylasa da) sayfayi yeniler. */
  private uygulamaBasladi = false;
  private degisimCoz: (() => void) | null = null;
  /** Zaman asimina ugrayan uygulamanin kayit/surdurme islevleri: etkinlesme sonradan gelirse kayit YENIDEN tamamlanip sayfa oyle yenilenir. */
  private gecKayit: { hazirla: () => Promise<boolean>; surdur: () => void } | null = null;

  constructor(
    private readonly kayit: KayitYuzu,
    private readonly o: SwSecenek,
  ) {
    const z = o.zamanlayici ?? GERCEK_ZAMAN;
    this.sonKontrol = z.zaman();
    this.ilkDenetleyici = o.konteyner?.controller ?? null;
    const degisti = (): void => {
      this.degisimCoz?.();
      if (this.uygulamaBasladi) o.yenidenYukle();
      else if (this.gecKayit) void this.gecDegisim();
    };
    o.konteyner?.addEventListener("controllerchange", degisti);
    this.temizlik.push(() => o.konteyner?.removeEventListener("controllerchange", degisti));
    this.izle();
    this.temizlik.push(z.aralik(() => void this.guncelle(), GUNCELLEME_ARALIGI_MS));
    const g = o.gorunurluk ?? gercekGorunurluk();
    if (g) {
      this.temizlik.push(
        g.dinle(() => {
          if (g.gorunur() && z.zaman() - this.sonKontrol >= GUNCELLEME_ESIGI_MS) void this.guncelle();
        }),
      );
    }
  }

  get durum(): YeniSurumDurumu {
    return this.durumDeger;
  }

  /** Durum degisimlerini dinler; hemen mevcut durumu verir. Donus: aboneligi birakir. */
  abone(f: (d: YeniSurumDurumu) => void): () => void {
    this.dinleyiciler.add(f);
    f(this.durumDeger);
    return () => this.dinleyiciler.delete(f);
  }

  private ayarla(d: YeniSurumDurumu): void {
    if (this.durumDeger === d) return;
    this.durumDeger = d;
    for (const f of [...this.dinleyiciler]) f(d);
  }

  /** Bekleyen (ya da kurulmakta olan) worker izlenir. Ilk kurulumda (denetleyen worker yok) bant GOSTERILMEZ: yenilenecek bir sey yok. */
  private izle(): void {
    const kontrol = (): void => {
      if (this.o.konteyner?.controller && this.kayit.waiting && this.durumDeger === "yok") this.ayarla("hazir");
    };
    const takip = (w: IsciYuzu | null): void => {
      if (!w) return;
      if (w.state === "installed") return kontrol();
      w.addEventListener("statechange", () => {
        if (w.state === "installed") kontrol();
      });
    };
    this.kayit.addEventListener("updatefound", () => takip(this.kayit.installing));
    kontrol();
    takip(this.kayit.installing);
  }

  /** Etkinlesme zaman asimindan SONRA geldi (oyun bu arada surdu): once kayit yeniden tamamlanir; tamamlanamazsa sayfa yenilenmez. */
  private async gecDegisim(): Promise<void> {
    const k = this.gecKayit;
    if (!k) return;
    this.gecKayit = null;
    this.ayarla("kaydediliyor");
    let tamam = false;
    try {
      tamam = await k.hazirla();
    } catch (e) {
      this.o.hata?.(e);
    }
    if (tamam) this.o.yenidenYukle();
    else {
      k.surdur();
      this.ayarla("hata");
    }
  }

  /** Sunucudaki sw.js'i yeniden sorgular (degismisse yeni worker kurulur). */
  async guncelle(): Promise<void> {
    this.sonKontrol = (this.o.zamanlayici ?? GERCEK_ZAMAN).zaman();
    try {
      await this.kayit.update();
    } catch (e) {
      this.o.hata?.(e); // cevrimdisi vb.: sessiz, sonraki denemede
    }
  }

  /**
   * Kullanici onayi: `hazirla` kaydi tamamlar (false = yazilamadi: surum UYGULANMAZ, oyun surer), sonra bekleyen worker etkinlesir ve sayfa yenilenir.
   * `surdur`: hazirla oyunu durdurmus olabilir; uygulama basarisiz olursa yeniden baslatir.
   */
  async uygula(hazirla: () => Promise<boolean>, surdur: () => void): Promise<void> {
    if (this.durumDeger !== "hazir" && this.durumDeger !== "hata") return;
    this.ayarla("kaydediliyor");
    let tamam = false;
    try {
      tamam = await hazirla();
    } catch (e) {
      this.o.hata?.(e);
    }
    const bekleyen = this.kayit.waiting;
    const konteyner = this.o.konteyner as KonteynerYuzu;
    if (tamam && !bekleyen) {
      // Bekleyen worker kalmadi: baska sekme onayladiysa denetleyen degismistir (yeni surum zaten etkin): sayfa yenilenir; aksi halde bant kalkar.
      if (konteyner.controller !== this.ilkDenetleyici) this.o.yenidenYukle();
      else {
        surdur();
        this.ayarla("yok");
      }
      return;
    }
    if (!tamam || !bekleyen) {
      surdur();
      this.ayarla("hata");
      return;
    }
    this.ayarla("uygulaniyor");
    this.uygulamaBasladi = true;
    const z = this.o.zamanlayici ?? GERCEK_ZAMAN;
    const degisti = await new Promise<boolean>((coz) => {
      this.degisimCoz = () => coz(true);
      void z.bekle(DEGISIM_ZAMAN_ASIMI_MS).then(() => coz(false));
      bekleyen.postMessage({ t: "atla" });
    });
    this.degisimCoz = null;
    if (degisti) return; // yenidenYukle controllerchange dinleyicisinde
    // Zaman asimi: oyun surdurulur; etkinlesme sonradan gelirse kayit yeniden tamamlanip sayfa yenilenir (`gecKayit`).
    this.uygulamaBasladi = false;
    this.gecKayit = { hazirla, surdur };
    surdur();
    this.ayarla("hata");
  }

  kapat(): void {
    for (const t of this.temizlik.splice(0)) t();
    this.dinleyiciler.clear();
  }
}

function gercekGorunurluk(): SwSecenek["gorunurluk"] | undefined {
  if (typeof document === "undefined") return undefined;
  return {
    dinle: (f) => {
      document.addEventListener("visibilitychange", f);
      return () => document.removeEventListener("visibilitychange", f);
    },
    gorunur: () => document.visibilityState === "visible",
  };
}

/** Uygunsa SW'yi kaydeder; degilse (bayraksiz/gelistirme/destek yok/oyun disi sayfa/guvensiz baglam) `null`: davranis degismez. */
export async function swBaslat(o: SwSecenek): Promise<SwKaydi | null> {
  if (!o.etkin || !o.konteyner || !o.guvenliBaglam) return null;
  if (o.yol !== "/oyun" && !o.yol.startsWith("/oyun/")) return null;
  try {
    const kayit = await o.konteyner.register(SW_YOLU, { scope: SW_KAPSAMI, updateViaCache: "none" });
    return new SwKaydi(kayit, o);
  } catch (e) {
    o.hata?.(e); // kayit basarisiz: oyun SW'siz calisir
    return null;
  }
}
