/**
 * Şehir haritası ortak türleri (T10). Veri katmanı (haritaModeli, yerlesim,
 * sektorGrubu, gorunum) ile çizim katmanı (HaritaSahnesi, SehirHaritasi,
 * HaritaTablosu) bu dosya üzerinden konuşur. Haritada insan çizilmez;
 * nüfus yalnız sayı olarak taşınır.
 */
import type { SusKimligi } from "./susKatalogu";

/** Paketin `harita` alanı (sunucu, 10 haftada bir). Satır: [id, tur, sehir, calisan, lonca, sahip, dogum, durum]; `dogum` işletmenin doğum haftası (NPC için null), `durum` salt-okunur. */
export const HARITA_DURUMLARI = ["uretim", "zayif", "issiz", "kapali"] as const;
export type HaritaDurumu = (typeof HARITA_DURUMLARI)[number];
export type HaritaFirmaSatiri = [id: string, tur: string, sehir: number, calisan: number, lonca: string | null, sahip: "npc" | "oyuncu" | "dao", dogum: number | null, durum: HaritaDurumu];
export type HaritaVerisi = { hafta: number; firmalar: HaritaFirmaSatiri[] };
/**
 * Paketin `haritaFark` alanı (Kurucu, tam `harita` taşımayan haftalarda): son tam `harita` haftasına (`taban`) göre fark.
 * `degisen`: yalnız durumu ya da bina boyu kovası değişen işletmeler `[id, durum, calisan]` (kapanış `durum = kapali`);
 * `yeni`: tabanda olmayan, şimdi listede olanlar (tam satır); `kapanan`: tabanda olup listeden düşenler.
 */
export type HaritaFarki = { hafta: number; taban: number; degisen: [id: string, durum: HaritaDurumu, calisan: number][]; yeni: HaritaFirmaSatiri[]; kapanan: string[] };

/** Dünya (harita koordinat uzayı) boyutu; tek kaynak. */
export const DUNYA = { genislik: 1000, yukseklik: 700 } as const;

export type SektorGrubu = "hammadde" | "imalat" | "hizmet" | "lojistik";
/** Şehir kurumları (yalnız izometrik sahnede çizilir): Liman = ithalat DAO'su, İhracat. Modelde firma değildir; harita firma listesinde yoktur. */
export type KurumTuru = "liman" | "ihracat";
export type BinaTuru = "isletme" | "lonca" | "sehir" | "ahir" | KurumTuru;

/** Çekmeceyi açan başvuru; Canli'daki `ac(kind, ref)` ile aynı biçim. `kurum`: şehir kurumu (`ref` = "liman" | "ihracat"; şehir seçimden gelir). */
export type HaritaRef = { kind: "firm" | "lonca" | "city" | "sector" | "parsel" | "kurum"; ref: string };
/** Meydan zemininin (lonca binası olmadan seçilen meydan) `HaritaRef.ref` değeri; `kind` "lonca". */
export const MEYDAN_REF = "meydan";

export type Bolge = { sehir: number; ad: string; x: number; y: number; genislik: number; yukseklik: number; calisan: number; issiz: number };

export type Bina = {
  id: string;
  tur: BinaTuru;
  grup?: SektorGrubu;
  /** Şehir dizini; lonca ve ahır için null. */
  sehir: number | null;
  x: number;
  y: number;
  /** İşçi ≥50 → 4, ≥20 → 3, ≥8 → 2, yoksa 1 (şehir ve ahır 4). */
  boyut: 1 | 2 | 3 | 4;
  ref: HaritaRef;
  etiket: string;
  sahip?: "npc" | "oyuncu" | "dao";
  /** Yalnız işletmede: harita satırının durumu (`kapali` işletme 10 hafta binasını tutar). */
  durum?: HaritaDurumu;
};

/** DAO oyununda oyuncunun yeri: figür değil, bina vurgusu. */
export type BenVurgusu = { binaId: string; neden: "isyeri" | "isletme" | "ahir" | "sehir" };

export type HaritaOzeti = { sehir: number; isletme: number; lonca: number; calisan: number; issiz: number; ahirda: number };

export type HaritaModeli = {
  hafta: number;
  /** Bina verisinin haftası; veri yoksa null. */
  firmaHafta: number | null;
  genislik: typeof DUNYA.genislik;
  yukseklik: typeof DUNYA.yukseklik;
  bolgeler: Bolge[];
  binalar: Bina[];
  ben: BenVurgusu | null;
  ozet: HaritaOzeti;
};

export type HaritaBaglami = {
  runId: string;
  sehirAdlari: string[];
  ben?: { sehir: number; firma: string | null; durum: "calisiyor" | "sahip" | "issiz" | "ahir" } | null;
};

export type Gorunum = { x: number; y: number; olcek: number };

/** Şehir ekranı (T2): bina şablonu = 4 işletme grubu + lonca + şehir binası + ahır. */
export type Sablon = SektorGrubu | "lonca" | "sehir" | "ahir";
export type BinaBoyu = 1 | 2 | 3 | 4;
export type Katman = "yok" | "talep" | "issizlik" | "fiyat";
/** Katman tonunun takma adı; renk haritaStili.ts'teki `katman.ton` tablosundan gelir. */
export type TonAdi = "iyi" | "orta" | "dar" | "dusen" | "yatay" | "artan";

/** Eksen hizalı dikdörtgen sokak (sahne koordinatı, sol üst köşe). */
export type Sokak = { id: string; ana: boolean; yon: "yatay" | "dikey"; x: number; y: number; genislik: number; yukseklik: number };
/** Parsel: merkez koordinatı ve ölçü. Kimliği ızgaranın merkezine göre ofsettir: `p<dr>_<dc>` (satır/sütun farkı; kademe büyüyünce aynı yer aynı kimliği korur). */
export type Parsel = { readonly id: string; readonly x: number; readonly y: number; readonly genislik: number; readonly yukseklik: number; /** İlk göründüğü ızgara kademesi (iç kademeler önce dolar). */ readonly kademe: number };
export type Meydan = { x: number; y: number; yaricap: number };
/** Zemin süsü: seçilemez, tonlanmaz. `x, y` ayak izinin merkezi, `taban` ayak izi (sahne birimi). */
export type Sus = { readonly id: string; readonly tur: SusKimligi; readonly x: number; readonly y: number; readonly taban: { readonly g: number; readonly d: number } };

/** Sahnedeki bina: `x, y` zemin ayak izinin merkezi; `parsel` meydandaki lonca için null. */
export type SahneBina = Bina & {
  parsel: string | null;
  sablon: Sablon;
  taban: { g: number; d: number };
  /** Yalnız izo sahnede (işletme): domino yuvanın genişleme parseli (ana parselin r+1 komşusu, aynı blok). */
  genisleme?: string;
  /** Yalnız izo sahnede (işletme): çalışan sayısı (ipucu metni). */
  calisan?: number;
  /** Yalnız izo sahnede (işletme): harita satırının durumu; `kapali` işletme 10 hafta parselini tutar. */
  durum?: HaritaDurumu;
};

export type LejantSatiri = { ton: TonAdi; anahtar: string; alt: number | null; ust: number | null; adet: number };
/** İşsizlik binaları tonlamaz: şehir binasında ve meydanda rozet olarak görünür. */
export type KatmanRozeti = { hedef: "sehir" | "meydan"; binaId: string | null; sayi: number };
export type KatmanVerisi = { tur: Katman; tonlar: Map<string, TonAdi>; lejant: LejantSatiri[]; rozetler: KatmanRozeti[] };

export type SehirSahnesi = {
  /** Zemin süsleri (meydan döşemesi, boş parsellerde ağaç/park, ahır çiti); işletme ve loncaların altında çizilir. */
  susler: readonly Sus[];
  sehir: number;
  ad: string;
  genislik: number;
  yukseklik: number;
  sokaklar: readonly Sokak[];
  /** Kullanılabilir tüm parseller (boş olanlar dahil); boş parsel = "İşletme kur" hedefi. */
  parseller: readonly Parsel[];
  /** Seçilebilir boş parseller (yalnız `parselSecilebilir` bağlamında dolu; Kurucu'da boş). `HaritaRef` = `{ kind: "parsel", ref: parsel kimliği }`. */
  bosParseller?: readonly Parsel[];
  /** Lonca ve işletme binaları (parsel kimlikli). Şehir binası ve ahır ayrı alanlardadır. */
  binalar: SahneBina[];
  meydan: Meydan;
  sehirBinasi: SahneBina;
  ahir: SahneBina;
  ben: BenVurgusu | null;
  /** İş ilanı veren (ve bu sahnede çizilen) işletme kimlikleri; bu binalar parlar. Boşsa parlayan yok. */
  ilanVeren?: ReadonlySet<string>;
  katman: KatmanVerisi;
  /** Kalıcı yerleşimde (`ctx.yerlesim` verildi): ilerlemiş {firma -> yuva} tablosu; çağıran commit edip bir sonraki sahneye verir. */
  yerlesim?: ReadonlyMap<string, string>;
  /** Yalnız izo sahnede: seçilen ızgara kademesi (plaza deliğini ve domino yuvaları yeniden türetmek için). */
  kademe?: number;
  /** Kayıt kaynağı ya da henüz bina anlık görüntüsü yok: işletme binası çizilmez, "Bina verisi bu kaynakta yok" notu gösterilir. */
  veriYok: boolean;
};
