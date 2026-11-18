/**
 * Python cekirdeginin (B4a `TarayiciCekirdegi`) kayit katmanina enjekte edilen async arayuzu.
 *
 * B5 bunu Worker koprusuyle baglar (Pyodide `*_json` yontemleri + JSON.parse); testlerde sahte cekirdek kullanilir.
 * Veri nesneleri tel'deki gibi (snake_case) akar; yontem adlari ve secenek nesneleri JS stilindedir.
 *
 * Hata sozlesmesi: Python istisnalari `CekirdekHatasi` olarak reddedilir (`tur` = Python sinif adi, `fark` = `UyumsuzGoruntu.fark`).
 * Koprunun Python hata adini tasimasi zorunlu; tasimazsa `hataTuru` mesajdan taninan adi arar.
 */
import { HATA_TURLERI, type DevamSonuc, type Fark, type GoruntuAlSonuc, type GunlukGirisi, type HaftaPaketi, type ModelAnahtari, type Tarif, type Yonetici } from "./tel";

export class CekirdekHatasi extends Error {
  readonly tur: string;
  readonly fark: Fark | null;
  constructor(tur: string, mesaj?: string, fark?: Fark | null) {
    super(mesaj ?? tur);
    this.name = "CekirdekHatasi";
    this.tur = tur;
    this.fark = fark ?? null;
  }
}

export function hataTuru(e: unknown): string {
  if (typeof e !== "object" || e === null) return "Bilinmeyen";
  const o = e as { tur?: unknown; name?: unknown; message?: unknown };
  if (typeof o.tur === "string" && o.tur !== "") return o.tur;
  // Alt tur once: GuvensizGoruntu, UyumsuzGoruntu'nun alt turudur.
  const metin = typeof o.message === "string" ? o.message : "";
  const bulunan = [...HATA_TURLERI].sort((a, b) => b.length - a.length).find((t) => metin.includes(t) || o.name === t);
  return bulunan ?? (typeof o.name === "string" ? o.name : "Bilinmeyen");
}

export function hataFark(e: unknown): Fark | null {
  if (typeof e !== "object" || e === null) return null;
  const f = (e as { fark?: unknown }).fark;
  return typeof f === "object" && f !== null && !Array.isArray(f) ? (f as Fark) : null;
}

export function hataMesaji(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : "";
}

/** Gorunti parcalari: `goruntuAl` sink'inin verdigi sirayla; birlestirme yapilmaz. */
export interface GoruntuGirdisi {
  parcalar: ArrayBuffer[];
  yonetici: Yonetici;
}

export interface DevamGirdisi {
  goruntu: GoruntuGirdisi;
  /** Cekirdek `sira > yonetici.gunluk_sira` girislerini kendisi secer; dal icin cagiran yalnız `dikis <= dal haftasi` olanlari verir. */
  gunluk: GunlukGirisi[];
  hedefHafta: number;
  /** Son <= 4 yayimlanmis hafta paketi (artan hafta sirasiyla). */
  paketler?: HaftaPaketi[];
  kosuId?: string;
  /** Dal: `[ebeveyn kimligi, dal haftasi]`. */
  ebeveyn?: [string, number];
  azamiHafta?: number | null;
  ilerleme?: (hafta: number) => void;
}

export interface TariftenGirdisi {
  tarif: Tarif;
  /** TAM gunluk (hicbir giris suzulmez). */
  gunluk: GunlukGirisi[];
  hedefHafta: number;
  kosuId?: string;
  azamiHafta?: number | null;
  ilerleme?: (hafta: number) => void;
}

export interface KayitCekirdegi {
  uyumlulukAnahtari(): Promise<ModelAnahtari>;
  /** Son goruntuden beri kadans doldu mu (kadans Python'da tek yerde). */
  goruntuGerekli(kosuId: string): Promise<boolean>;
  /** `sink` her sikisik parca icin senkron cagrilir (baytlar cagridan sonra gecersiz olabilir: kopyalanmali). `GoruntuHazirDegil`, `TaninmayanReferans`, `TaninmayanLambda` ile reddedilebilir. */
  goruntuAl(kosuId: string, sink: (parca: Uint8Array) => void): Promise<GoruntuAlSonuc>;
  gunlukAl(kosuId: string, sonra: number): Promise<GunlukGirisi[]>;
  tarifAl(kosuId: string): Promise<Tarif>;
  /** `UyumsuzGoruntu` / `GuvensizGoruntu` / `ValueError` / `TooManyRuns` ile reddedilebilir. */
  devam(girdi: DevamGirdisi): Promise<DevamSonuc>;
  tariftenOynat(girdi: TariftenGirdisi): Promise<DevamSonuc>;
  /** Koşuyu cekirdekten siler (kopru: `DELETE /api/runs/<id>`). */
  kosuSil(kosuId: string): Promise<void>;
}
