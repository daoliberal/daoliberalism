/**
 * Depolama omru: `navigator.storage.persist()`, kota denetimi ve kota dolunca en eski kosunun goruntulerinin silinmesi.
 * Gunluk ve paketler asla silinmez (goruntu yoksa tariften oynatilir).
 */
import type { KayitDeposu } from "./depo";

export interface DepolamaArayuzu {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export type KalicilikDurumu = "verildi" | "verilmedi" | "desteklenmiyor" | "hata";

export interface KalicilikSonucu {
  durum: KalicilikDurumu;
  /** Istek sirasinda zaten verilmisse true. */
  onceden: boolean;
  zaman: number;
}

export interface KotaOlcumu {
  kullanim: number;
  kota: number;
  oran: number;
}

export interface KotaSonucu {
  olcum: KotaOlcumu | null;
  /** Goruntuleri silinen kosular (sirayla). */
  bosaltilan: { kosuId: string; silinenGoruntu: number }[];
  /** Esik altina inildi ya da olculemedi (`olcum === null`) -> true; bosaltma yetmedi -> false. */
  yeterli: boolean;
}

export const KOTA_ESIGI = 0.85;
export const META_PERSIST = "persist";

export class KotaYoneticisi {
  private readonly storage: DepolamaArayuzu | null;
  private readonly depo: KayitDeposu;
  private readonly esik: number;
  private readonly zaman: () => number;

  constructor(o: { depo: KayitDeposu; storage?: DepolamaArayuzu | null; esik?: number; zaman?: () => number }) {
    this.depo = o.depo;
    this.storage = o.storage ?? null;
    this.esik = o.esik ?? KOTA_ESIGI;
    this.zaman = o.zaman ?? Date.now;
  }

  /** `persist()` ister, sonucu `meta`ya yazar ve dondurur (Safari 7 gun kurali metni B8'de; burada yalniz sonuc raporlanir). */
  async kalicilikIste(): Promise<KalicilikSonucu> {
    const s = this.storage;
    let sonuc: KalicilikSonucu;
    if (!s || typeof s.persist !== "function") sonuc = { durum: "desteklenmiyor", onceden: false, zaman: this.zaman() };
    else {
      try {
        const onceden = typeof s.persisted === "function" ? await s.persisted() : false;
        const verildi = onceden ? true : await s.persist();
        sonuc = { durum: verildi ? "verildi" : "verilmedi", onceden, zaman: this.zaman() };
      } catch {
        sonuc = { durum: "hata", onceden: false, zaman: this.zaman() };
      }
    }
    await this.depo.metaYaz(META_PERSIST, sonuc);
    return sonuc;
  }

  async kalicilikDurumu(): Promise<KalicilikSonucu | null> {
    return this.depo.metaOku<KalicilikSonucu>(META_PERSIST);
  }

  async olc(): Promise<KotaOlcumu | null> {
    const s = this.storage;
    if (!s || typeof s.estimate !== "function") return null;
    try {
      const e = await s.estimate();
      if (typeof e.usage !== "number" || typeof e.quota !== "number" || e.quota <= 0) return null;
      return { kullanim: e.usage, kota: e.quota, oran: e.usage / e.quota };
    } catch {
      return null;
    }
  }

  /**
   * Kota esigi asildiysa en eski kosudan baslayarak goruntuleri siler. `koru`: yazim yapilan kosu; ancak digerleri yetmezse
   * onun yalniz en yeni goruntusu disindakiler silinir. Olculemiyorsa (estimate yok) hicbir sey silinmez.
   */
  async denetle(koru?: string): Promise<KotaSonucu> {
    let olcum = await this.olc();
    const sonuc: KotaSonucu = { olcum, bosaltilan: [], yeterli: true };
    if (!olcum || olcum.oran <= this.esik) return sonuc;
    for (let tur = 0; tur < 64 && olcum && olcum.oran > this.esik; tur++) {
      const b = await this.enEskiBosalt(koru);
      if (!b) break;
      sonuc.bosaltilan.push(b);
      olcum = await this.olc();
    }
    sonuc.olcum = olcum;
    sonuc.yeterli = !olcum || olcum.oran <= this.esik;
    if (sonuc.bosaltilan.length > 0) await this.depo.taniYaz({ tur: "kota_bosaltma", ayrinti: { bosaltilan: sonuc.bosaltilan.length, oran: olcum?.oran ?? null, yeterli: sonuc.yeterli } });
    return sonuc;
  }

  /** Yazim `QuotaExceededError` verdiginde: olcum beklemeden en eski kosunun goruntulerini siler. Silinecek goruntu yoksa `null`. */
  async enEskiBosalt(koru?: string): Promise<{ kosuId: string; silinenGoruntu: number } | null> {
    // "En eski" = en uzun suredir kullanilmayan (`guncelleme`): yillik asil koşu, dunku denemeden once silinmez.
    const kosular = (await this.depo.kosulariListele()).sort((a, b) => a.guncelleme - b.guncelleme || a.olusturma - b.olusturma);
    for (const k of kosular) {
      if (k.kosuId === koru) continue;
      const adet = await this.depo.goruntuleriSil(k.kosuId);
      if (adet > 0) return { kosuId: k.kosuId, silinenGoruntu: adet };
    }
    const k = kosular.find((x) => x.kosuId === koru);
    if (k) {
      const en = k.sonGoruntu?.kimlik;
      const adet = await this.depo.goruntuleriSil(k.kosuId, en ? [en] : []);
      if (adet > 0) return { kosuId: k.kosuId, silinenGoruntu: adet };
    }
    return null;
  }
}

export function kotaDoluHatasi(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "QuotaExceededError";
}
