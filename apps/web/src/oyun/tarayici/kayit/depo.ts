/**
 * IndexedDB kayit deposu (B4b). Tum depolar, anahtarlar ve gocler burada.
 *
 * Depolar (surum 1):
 * - `kosular`   anahtar `kosuId`; indeks `olusturma`. Kosu ozeti: tarif, model anahtari, yayimlanan, goruntu isaretcisi, durum bayraklari.
 * - `haftalar`  anahtar `[kosuId, hafta]`: hafta paketleri (hafta anahtariyla idempotent).
 * - `gunluk`    anahtar `[kosuId, sira]`: karar ve sart girisleri (sira anahtariyla idempotent).
 * - `goruntuler` anahtar `[kosuId, goruntuKimligi]`: goruntu ustverisi + yonetici durumu (parcalar ayri).
 * - `parcalar`  anahtar `[kosuId, goruntuKimligi, sira]`: sikisik goruntu parcalari (`ArrayBuffer`, birlestirilmez).
 * - `tani`      otomatik anahtar: tani kayitlari (kisisel veri yok; en cok `TANI_AZAMI`).
 * - `meta`      anahtar `anahtar`: kucuk genel degerler (persist sonucu vb.).
 *
 * Goruntu yazimi tek islemde "yeni anahtara yaz, sonra isaretciyi cevir" ile yapilir; herhangi bir adim basarisiz olursa
 * islem iptal edilir ve eski goruntu (ve isaretci) oldugu gibi kalir.
 */
import type { HaftaPaketi, GunlukGirisi, ModelAnahtari, Tarif, Yonetici } from "./tel";

export const DB_ADI = "daoliberal-kayit";
export const TANI_AZAMI = 200;
export const GORUNTU_AZAMI = 2;

export type DepoAdi = "kosular" | "haftalar" | "gunluk" | "goruntuler" | "parcalar" | "tani" | "meta";
export const DEPOLAR: readonly DepoAdi[] = ["kosular", "haftalar", "gunluk", "goruntuler", "parcalar", "tani", "meta"];

export interface GoruntuIsaretcisi {
  kimlik: string;
  hafta: number;
  yayimlanan: number;
}

export interface GoruntuDurdu {
  tur: string;
  hafta: number;
  zaman: number;
}

export interface KosuKaydi {
  kosuId: string;
  olusturma: number;
  guncelleme: number;
  tarif: Tarif;
  /** Kaydin hangi model/Pyodide anahtariyla yazildigi (B7 onceki model paketini bununla eslestirir). */
  modelAnahtari: ModelAnahtari;
  ebeveyn: [string, number] | null;
  kaynak: "yerel" | "ice_aktarma";
  yayimlanan: number;
  gunlukSira: number;
  sonGoruntu: GoruntuIsaretcisi | null;
  /** Kalici dump hatasi: bu kosu icin goruntu denemesi durduruldu. */
  goruntuDurdu: GoruntuDurdu | null;
  sonDisaAktarim: number;
  sonHatirlatma: number;
}

export interface GoruntuUstverisi {
  kosuId: string;
  goruntuKimligi: string;
  zaman: number;
  hafta: number;
  yayimlanan: number;
  ham: number;
  sikisik: number;
  parca: number;
  anahtar: ModelAnahtari;
  gunlukSira: number;
  yonetici: Yonetici;
}

interface ParcaKaydi {
  kosuId: string;
  goruntuKimligi: string;
  sira: number;
  veri: ArrayBuffer;
}

export interface TaniKaydi {
  id?: number;
  zaman: number;
  tur: string;
  kosuId?: string | null;
  /** Serbest ama kisisel veri icermeyen alanlar (surum, model_sha256, hafta, fark...). */
  ayrinti: Record<string, unknown>;
}

export class DepoHatasi extends Error {
  readonly kod: string;
  constructor(kod: string, neden?: unknown) {
    super(kod);
    this.name = "DepoHatasi";
    this.kod = kod;
    if (neden !== undefined) this.cause = neden;
  }
}

/** Gocler: indeks `i` -> surum `i+1`'e cikarken calisir. Depo surumu = liste uzunlugu. */
export type Goc = (db: IDBDatabase, tx: IDBTransaction, eskiSurum: number) => void;

export const GOCLER: readonly Goc[] = [
  (db) => {
    const kosular = db.createObjectStore("kosular", { keyPath: "kosuId" });
    kosular.createIndex("olusturma", "olusturma");
    db.createObjectStore("haftalar", { keyPath: ["kosuId", "hafta"] });
    db.createObjectStore("gunluk", { keyPath: ["kosuId", "sira"] });
    db.createObjectStore("goruntuler", { keyPath: ["kosuId", "goruntuKimligi"] });
    db.createObjectStore("parcalar", { keyPath: ["kosuId", "goruntuKimligi", "sira"] });
    db.createObjectStore("tani", { keyPath: "id", autoIncrement: true });
    db.createObjectStore("meta", { keyPath: "anahtar" });
  },
];

function istek<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((coz, red) => {
    r.onsuccess = () => coz(r.result);
    r.onerror = () => red(r.error ?? new DepoHatasi("istek_hatasi"));
  });
}

function islemBitti(tx: IDBTransaction): Promise<void> {
  const p = new Promise<void>((coz, red) => {
    tx.oncomplete = () => coz();
    tx.onabort = () => red(tx.error ?? new DepoHatasi("islem_iptal"));
    tx.onerror = () => undefined; // ayrintisi `onabort`ta
  });
  p.catch(() => undefined); // beklenmeden reddedilirse "ele alinmamis red" olmasin; bekleyen yine hatayi gorur
  return p;
}

/** Esit JSON degeri (anahtar sirasindan bagimsiz). */
export function jsonEsit(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEsit(v, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEsit((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export interface GunlukYazimSonucu {
  eklenen: number;
  /** Ayni `sira` ile farkli icerik gelenler (ilk yazilan korunur). */
  cakisan: number[];
}

export interface HaftaYazimSonucu {
  /** 52 hafta hatirlatmasi bu yazimda tetiklendi. */
  hatirlatma: boolean;
  yayimlanan: number;
}

export const HATIRLATMA_HAFTA = 52;

/** Yeniden eskiye: duvar saatine degil model haftasina dayanir (saat geri alinsa da bozulmaz). */
const goruntuSirasi = (a: GoruntuUstverisi, b: GoruntuUstverisi): number => b.yayimlanan - a.yayimlanan || b.hafta - a.hafta || b.zaman - a.zaman;

const bos = (kosuId: string): IDBKeyRange => IDBKeyRange.bound([kosuId], [kosuId, []]);
const hafta = (kosuId: string, ilk: number, son: number): IDBKeyRange => IDBKeyRange.bound([kosuId, ilk], [kosuId, son]);

export class KayitDeposu {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly zaman: () => number,
  ) {}

  static async ac(idb: IDBFactory, secenek: { ad?: string; gocler?: readonly Goc[]; zaman?: () => number } = {}): Promise<KayitDeposu> {
    const ad = secenek.ad ?? DB_ADI;
    const gocler = secenek.gocler ?? GOCLER;
    const db = await new Promise<IDBDatabase>((coz, red) => {
      const r = idb.open(ad, gocler.length);
      r.onupgradeneeded = (ev) => {
        const tx = r.transaction as IDBTransaction;
        try {
          for (let s = ev.oldVersion; s < gocler.length; s++) (gocler[s] as Goc)(r.result, tx, s);
        } catch (e) {
          tx.abort();
          red(new DepoHatasi("goc_hatasi", e));
        }
      };
      r.onsuccess = () => coz(r.result);
      r.onerror = () => red(r.error?.name === "VersionError" ? new DepoHatasi("depo_daha_yeni", r.error) : new DepoHatasi("acilamadi", r.error));
      r.onblocked = () => undefined;
    });
    db.onversionchange = () => db.close();
    return new KayitDeposu(db, secenek.zaman ?? Date.now);
  }

  kapat(): void {
    this.db.close();
  }

  get surum(): number {
    return this.db.version;
  }

  depoAdlari(): string[] {
    return Array.from(this.db.objectStoreNames);
  }

  // ---- koşular ----------------------------------------------------------------------------------------------------

  /** Var olan kayit korunur (idempotent): donen, depodaki kayittir. */
  async kosuOlustur(kayit: Omit<KosuKaydi, "olusturma" | "guncelleme"> & Partial<Pick<KosuKaydi, "olusturma" | "guncelleme">>): Promise<KosuKaydi> {
    const tx = this.db.transaction("kosular", "readwrite");
    const bitti = islemBitti(tx);
    const var_ = (await istek(tx.objectStore("kosular").get(kayit.kosuId))) as KosuKaydi | undefined;
    let sonuc: KosuKaydi;
    if (var_) sonuc = var_;
    else {
      const z = this.zaman();
      sonuc = { ...kayit, olusturma: kayit.olusturma ?? z, guncelleme: kayit.guncelleme ?? z };
      tx.objectStore("kosular").put(sonuc);
    }
    await bitti;
    return sonuc;
  }

  async kosuOku(kosuId: string): Promise<KosuKaydi | null> {
    const tx = this.db.transaction("kosular", "readonly");
    return ((await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined) ?? null;
  }

  async kosulariListele(): Promise<KosuKaydi[]> {
    const tx = this.db.transaction("kosular", "readonly");
    const hepsi = (await istek(tx.objectStore("kosular").index("olusturma").getAll())) as KosuKaydi[];
    return hepsi;
  }

  /** Okuma-degistirme-yazma tek islemde. `degistir` yeni kayit ya da `null` (degisiklik yok) dondurur. */
  async kosuGuncelle(kosuId: string, degistir: (k: KosuKaydi) => KosuKaydi | null): Promise<KosuKaydi | null> {
    const tx = this.db.transaction("kosular", "readwrite");
    const bitti = islemBitti(tx);
    const k = (await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined;
    let sonuc: KosuKaydi | null = k ?? null;
    if (k) {
      const yeni = degistir(k);
      if (yeni) {
        sonuc = { ...yeni, guncelleme: this.zaman() };
        tx.objectStore("kosular").put(sonuc);
      }
    }
    await bitti;
    return sonuc;
  }

  /** Koşu ve tum bagli kayitlari (hafta, gunluk, goruntu, parca) siler. */
  async kosuSil(kosuId: string): Promise<void> {
    const tx = this.db.transaction(["kosular", "haftalar", "gunluk", "goruntuler", "parcalar"], "readwrite");
    const bitti = islemBitti(tx);
    tx.objectStore("kosular").delete(kosuId);
    for (const ad of ["haftalar", "gunluk", "goruntuler", "parcalar"] as const) tx.objectStore(ad).delete(bos(kosuId));
    await bitti;
  }

  // ---- haftalar (paketler) ----------------------------------------------------------------------------------------

  /** Hafta anahtariyla idempotent: ayni hafta tekrar gelirse ustune yazilir. Kosu ozetini (yayimlanan, 52 hf hatirlatmasi) ayni islemde gunceller. */
  async haftalarYaz(kosuId: string, paketler: readonly HaftaPaketi[]): Promise<HaftaYazimSonucu> {
    if (paketler.length === 0) return { hatirlatma: false, yayimlanan: (await this.kosuOku(kosuId))?.yayimlanan ?? 0 };
    const tx = this.db.transaction(["kosular", "haftalar"], "readwrite");
    const bitti = islemBitti(tx);
    try {
      const k = (await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined;
      if (!k) throw new DepoHatasi("kosu_yok");
      let en = k.yayimlanan;
      for (const p of paketler) {
        if (!Number.isInteger(p.week) || p.week < 0) throw new DepoHatasi("paket_hafta_gecersiz");
        tx.objectStore("haftalar").put({ kosuId, hafta: p.week, paket: p });
        en = Math.max(en, p.week);
      }
      const yeni: KosuKaydi = { ...k, yayimlanan: en, guncelleme: this.zaman() };
      const ref = Math.max(k.sonDisaAktarim, k.sonHatirlatma);
      const hatirlatma = en - ref >= HATIRLATMA_HAFTA;
      if (hatirlatma) yeni.sonHatirlatma = en;
      tx.objectStore("kosular").put(yeni);
      await bitti;
      return { hatirlatma, yayimlanan: en };
    } catch (e) {
      throw await iptalVeHata(tx, bitti, e);
    }
  }

  async paketOku(kosuId: string, hf: number): Promise<HaftaPaketi | null> {
    const tx = this.db.transaction("haftalar", "readonly");
    const k = (await istek(tx.objectStore("haftalar").get([kosuId, hf]))) as { paket: HaftaPaketi } | undefined;
    return k?.paket ?? null;
  }

  /** `[ilk, son]` araligindaki mevcut paketler (artan hafta). */
  async paketAraligi(kosuId: string, ilk: number, son: number): Promise<HaftaPaketi[]> {
    if (son < ilk) return [];
    const tx = this.db.transaction("haftalar", "readonly");
    const satirlar = (await istek(tx.objectStore("haftalar").getAll(hafta(kosuId, ilk, son)))) as { paket: HaftaPaketi }[];
    return satirlar.map((s) => s.paket);
  }

  /** `hf` dahil geriye dogru en cok `adet` paket (artan hafta sirasiyla). */
  async paketPenceresi(kosuId: string, hf: number, adet: number): Promise<HaftaPaketi[]> {
    const tx = this.db.transaction("haftalar", "readonly");
    const sonuc: HaftaPaketi[] = [];
    await new Promise<void>((coz, red) => {
      const c = tx.objectStore("haftalar").openCursor(hafta(kosuId, 0, hf), "prev");
      c.onsuccess = () => {
        const im = c.result;
        if (!im || sonuc.length >= adet) return coz();
        sonuc.push((im.value as { paket: HaftaPaketi }).paket);
        im.continue();
      };
      c.onerror = () => red(c.error);
    });
    return sonuc.reverse();
  }

  async paketSayisi(kosuId: string): Promise<number> {
    const tx = this.db.transaction("haftalar", "readonly");
    return istek(tx.objectStore("haftalar").count(hafta(kosuId, 0, Number.MAX_SAFE_INTEGER)));
  }

  // ---- gunluk -----------------------------------------------------------------------------------------------------

  /** `sira` anahtariyla idempotent: ayni sira + ayni icerik atlanir; ayni sira + farkli icerik `cakisan`a yazilir (ilk korunur). */
  async gunlukYaz(kosuId: string, girisler: readonly GunlukGirisi[]): Promise<GunlukYazimSonucu> {
    const sonuc: GunlukYazimSonucu = { eklenen: 0, cakisan: [] };
    if (girisler.length === 0) return sonuc;
    const tx = this.db.transaction(["kosular", "gunluk"], "readwrite");
    const bitti = islemBitti(tx);
    try {
      const k = (await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined;
      if (!k) throw new DepoHatasi("kosu_yok");
      let en = k.gunlukSira;
      for (const g of girisler) {
        if (!Number.isInteger(g.sira) || g.sira < 1) throw new DepoHatasi("gunluk_sira_gecersiz");
        const var_ = (await istek(tx.objectStore("gunluk").get([kosuId, g.sira]))) as { giris: GunlukGirisi } | undefined;
        if (var_) {
          if (!jsonEsit(var_.giris, g)) sonuc.cakisan.push(g.sira);
        } else {
          tx.objectStore("gunluk").put({ kosuId, sira: g.sira, giris: g });
          sonuc.eklenen++;
        }
        en = Math.max(en, g.sira);
      }
      if (en !== k.gunlukSira) tx.objectStore("kosular").put({ ...k, gunlukSira: en, guncelleme: this.zaman() });
      await bitti;
      return sonuc;
    } catch (e) {
      throw await iptalVeHata(tx, bitti, e);
    }
  }

  /** `sira > sonSira` girislerini siler ve sayaci geri ceker (reddedilen/sapan koşudan sonra devam icin; bkz. `KosuYazici.gunlukKes`). */
  async gunlukKes(kosuId: string, sonSira: number): Promise<number> {
    const tx = this.db.transaction(["kosular", "gunluk"], "readwrite");
    const bitti = islemBitti(tx);
    try {
      const k = (await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined;
      if (!k) throw new DepoHatasi("kosu_yok");
      const sira = Math.max(0, sonSira);
      const silinecek = (await istek(tx.objectStore("gunluk").getAllKeys(IDBKeyRange.bound([kosuId, sira], [kosuId, Number.MAX_SAFE_INTEGER], true, false)))) as unknown[];
      tx.objectStore("gunluk").delete(IDBKeyRange.bound([kosuId, sira], [kosuId, Number.MAX_SAFE_INTEGER], true, false));
      tx.objectStore("kosular").put({ ...k, gunlukSira: Math.min(k.gunlukSira, sira), guncelleme: this.zaman() });
      await bitti;
      return silinecek.length;
    } catch (e) {
      throw await iptalVeHata(tx, bitti, e);
    }
  }

  /** Ice aktarma: koşu + gunluk + paketler TEK islemde. Kimlik varsa `kosu_var` (sessiz birlesme yok). */
  async iceAktarimYaz(kayit: Omit<KosuKaydi, "olusturma" | "guncelleme">, gunluk: readonly GunlukGirisi[], paketler: readonly HaftaPaketi[], yayimlanan: number): Promise<KosuKaydi> {
    const tx = this.db.transaction(["kosular", "gunluk", "haftalar"], "readwrite");
    const bitti = islemBitti(tx);
    try {
      if ((await istek(tx.objectStore("kosular").get(kayit.kosuId))) !== undefined) throw new DepoHatasi("kosu_var");
      const z = this.zaman();
      const yeni: KosuKaydi = { ...kayit, olusturma: z, guncelleme: z, yayimlanan, sonDisaAktarim: yayimlanan, sonHatirlatma: yayimlanan, gunlukSira: gunluk.length };
      tx.objectStore("kosular").put(yeni);
      for (const g of gunluk) tx.objectStore("gunluk").put({ kosuId: kayit.kosuId, sira: g.sira, giris: g });
      for (const p of paketler) tx.objectStore("haftalar").put({ kosuId: kayit.kosuId, hafta: p.week, paket: p });
      await bitti;
      return yeni;
    } catch (e) {
      throw await iptalVeHata(tx, bitti, e);
    }
  }

  /** `sira > sonra` girisleri, artan sira. */
  async gunlukOku(kosuId: string, sonra = 0): Promise<GunlukGirisi[]> {
    const tx = this.db.transaction("gunluk", "readonly");
    const satirlar = (await istek(tx.objectStore("gunluk").getAll(IDBKeyRange.bound([kosuId, sonra], [kosuId, Number.MAX_SAFE_INTEGER], true, false)))) as { giris: GunlukGirisi }[];
    return satirlar.map((s) => s.giris);
  }

  // ---- goruntuler -------------------------------------------------------------------------------------------------

  /**
   * Goruntuyu atomik yazar: parcalar -> ustveri+yonetici -> isaretci cevirme -> eski goruntulerin budanmasi (son `GORUNTU_AZAMI`), TEK islem.
   * Hata (ornegin klonlanamayan yonetici, kota) islemi iptal eder; onceki goruntu ve isaretci degismez.
   */
  async goruntuYaz(ust: GoruntuUstverisi, parcalar: readonly ArrayBuffer[]): Promise<void> {
    const tx = this.db.transaction(["kosular", "goruntuler", "parcalar"], "readwrite");
    const bitti = islemBitti(tx);
    try {
      const k = (await istek(tx.objectStore("kosular").get(ust.kosuId))) as KosuKaydi | undefined;
      if (!k) throw new DepoHatasi("kosu_yok");
      if (parcalar.length !== ust.parca) throw new DepoHatasi("parca_sayisi_tutarsiz");
      tx.objectStore("parcalar").delete(IDBKeyRange.bound([ust.kosuId, ust.goruntuKimligi], [ust.kosuId, ust.goruntuKimligi, []])); // ayni kimlik yeniden yazilirsa eski parcalar kalmaz
      parcalar.forEach((veri, sira) => tx.objectStore("parcalar").put({ kosuId: ust.kosuId, goruntuKimligi: ust.goruntuKimligi, sira, veri } satisfies ParcaKaydi));
      tx.objectStore("goruntuler").put(ust);
      const yeni: KosuKaydi = {
        ...k,
        sonGoruntu: { kimlik: ust.goruntuKimligi, hafta: ust.hafta, yayimlanan: ust.yayimlanan },
        yayimlanan: Math.max(k.yayimlanan, ust.yayimlanan),
        guncelleme: this.zaman(),
      };
      tx.objectStore("kosular").put(yeni);
      // Butun goruntuler: yeni + onceki en yakin `GORUNTU_AZAMI - 1`i kalir.
      const hepsi = (await istek(tx.objectStore("goruntuler").getAll(bos(ust.kosuId)))) as GoruntuUstverisi[];
      const sirali = hepsi.sort(goruntuSirasi);
      const kalacak = new Set([ust.goruntuKimligi, ...sirali.filter((g) => g.goruntuKimligi !== ust.goruntuKimligi).map((g) => g.goruntuKimligi)].slice(0, GORUNTU_AZAMI));
      for (const g of sirali) {
        if (kalacak.has(g.goruntuKimligi)) continue;
        tx.objectStore("goruntuler").delete([g.kosuId, g.goruntuKimligi]);
        tx.objectStore("parcalar").delete(IDBKeyRange.bound([g.kosuId, g.goruntuKimligi], [g.kosuId, g.goruntuKimligi, []]));
      }
      await bitti;
    } catch (e) {
      throw await iptalVeHata(tx, bitti, e);
    }
  }

  /** Kosunun saklanan goruntu ustverileri (yonetici dahil), yeniden eskiye. */
  async goruntuleriListele(kosuId: string): Promise<GoruntuUstverisi[]> {
    const tx = this.db.transaction("goruntuler", "readonly");
    const hepsi = (await istek(tx.objectStore("goruntuler").getAll(bos(kosuId)))) as GoruntuUstverisi[];
    return hepsi.sort(goruntuSirasi);
  }

  /** Parcalar yazildigi sirayla; eksik/fazla parca `null` (bozuk kayit). */
  async goruntuParcalari(kosuId: string, kimlik: string): Promise<ArrayBuffer[] | null> {
    const tx = this.db.transaction(["goruntuler", "parcalar"], "readonly");
    const ust = (await istek(tx.objectStore("goruntuler").get([kosuId, kimlik]))) as GoruntuUstverisi | undefined;
    if (!ust) return null;
    const satirlar = (await istek(tx.objectStore("parcalar").getAll(IDBKeyRange.bound([kosuId, kimlik], [kosuId, kimlik, []])))) as ParcaKaydi[];
    if (satirlar.length !== ust.parca || satirlar.some((s, i) => s.sira !== i)) return null;
    return satirlar.map((s) => s.veri);
  }

  async parcaSayisi(): Promise<number> {
    const tx = this.db.transaction("parcalar", "readonly");
    return istek(tx.objectStore("parcalar").count());
  }

  /**
   * Goruntulerin silinmesi (gunluk ve paketler kalir). `birak`: korunacak goruntu kimlikleri. Isaretci, silinen goruntuyu gosteriyorsa
   * `birak` icindeki en yeniye (yoksa `null`a) cevrilir.
   */
  async goruntuleriSil(kosuId: string, birak: readonly string[] = []): Promise<number> {
    const tx = this.db.transaction(["kosular", "goruntuler", "parcalar"], "readwrite");
    const bitti = islemBitti(tx);
    const hepsi = (await istek(tx.objectStore("goruntuler").getAll(bos(kosuId)))) as GoruntuUstverisi[];
    let silinen = 0;
    const kalan: GoruntuUstverisi[] = [];
    for (const g of hepsi) {
      if (birak.includes(g.goruntuKimligi)) {
        kalan.push(g);
        continue;
      }
      tx.objectStore("goruntuler").delete([g.kosuId, g.goruntuKimligi]);
      tx.objectStore("parcalar").delete(IDBKeyRange.bound([g.kosuId, g.goruntuKimligi], [g.kosuId, g.goruntuKimligi, []]));
      silinen++;
    }
    const k = (await istek(tx.objectStore("kosular").get(kosuId))) as KosuKaydi | undefined;
    if (k && silinen > 0) {
      const en = kalan.sort(goruntuSirasi)[0];
      tx.objectStore("kosular").put({ ...k, sonGoruntu: en ? { kimlik: en.goruntuKimligi, hafta: en.hafta, yayimlanan: en.yayimlanan } : null, guncelleme: this.zaman() });
    }
    await bitti;
    return silinen;
  }

  // ---- tani ve meta -----------------------------------------------------------------------------------------------

  async taniYaz(kayit: Omit<TaniKaydi, "zaman"> & { zaman?: number }): Promise<void> {
    const tx = this.db.transaction("tani", "readwrite");
    const bitti = islemBitti(tx);
    const depo = tx.objectStore("tani");
    depo.add({ ...kayit, zaman: kayit.zaman ?? this.zaman() });
    const sayi = await istek(depo.count());
    let fazla = sayi - TANI_AZAMI;
    if (fazla > 0) {
      await new Promise<void>((coz, red) => {
        const c = depo.openCursor();
        c.onsuccess = () => {
          const im = c.result;
          if (!im || fazla <= 0) return coz();
          im.delete();
          fazla--;
          im.continue();
        };
        c.onerror = () => red(c.error);
      });
    }
    await bitti;
  }

  async taniOku(): Promise<TaniKaydi[]> {
    const tx = this.db.transaction("tani", "readonly");
    return (await istek(tx.objectStore("tani").getAll())) as TaniKaydi[];
  }

  async metaYaz(anahtar: string, deger: unknown): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    const bitti = islemBitti(tx);
    tx.objectStore("meta").put({ anahtar, deger });
    await bitti;
  }

  async metaOku<T>(anahtar: string): Promise<T | null> {
    const tx = this.db.transaction("meta", "readonly");
    const k = (await istek(tx.objectStore("meta").get(anahtar))) as { deger: T } | undefined;
    return k?.deger ?? null;
  }
}

/** Islemi iptal eder ve ASIL hatayi dondurur: istek duzeyinde hata (ornegin kota) sonraki `await`te `AbortError` olarak gorunur, nedeni `tx.error`dadir. */
async function iptalVeHata(tx: IDBTransaction, bitti: Promise<void>, e: unknown): Promise<unknown> {
  islemiIptal(tx);
  await bitti.catch(() => undefined);
  return tx.error ?? e;
}

function islemiIptal(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    /* islem zaten bitmis ya da iptal edilmis */
  }
}
