/**
 * B8: arayuzun kayit hizmetleri. Kayit katmaninin (IndexedDB) arayuze acilan TEK yuzu: depolama durumu (kullanim, kota, kalicilik), kayitli oyunlar,
 * disa aktarma, ice aktarma (dosya boyutu ON denetimi metin okunmadan once) ve silme. Arayuz `kayit/` modullerini dogrudan import etmez (bayraksiz
 * derlemede budanir); bu dosya yalniz tarayici modullerinin dinamik ice aktarimiyla gelir.
 */
import { AZAMI_DOSYA_KARAKTERI, IceAktarmaHatasi, disaAktar, dosyaMetni, iceAktar } from "./kayit/disaAktar";
import type { KayitKatmani } from "./kayit/index";
import { KOTA_ESIGI, type KalicilikSonucu, type KotaOlcumu } from "./kayit/kota";
import type { KosuKaydi } from "./kayit/depo";

export interface KosuOzeti {
  kosuId: string;
  ad: string;
  hafta: number;
  guncelleme: number;
  kaynak: "yerel" | "ice_aktarma";
  /** Oyun turu: "Ac ve oynat" dogru rotayi yazar (`#/canli/<id>` ya da `#/dao/<id>`). */
  tur: "kurucu" | "dao";
  /** Kopru bu koşuyu su an takip ediyor (acik oyun): silinemez, "Ac ve oynat" gosterilmez. */
  aktif: boolean;
  /** Son disa aktarmadan bu yana gecen hafta (hic aktarilmadiysa oyunun haftasi). */
  disaAktarilmayanHafta: number;
}

export interface DepolamaDurumu {
  olcum: KotaOlcumu | null;
  esik: number;
  kotaUyarisi: boolean;
  kalicilik: KalicilikSonucu | null;
}

/** `File` benzeri: boyut once denetlenir, `text()` yalniz sinir icindeyse cagrilir. */
export interface KayitDosyasi {
  size: number;
  text(): Promise<string>;
}

export interface KayitHizmetleri {
  /** Ice aktarilabilecek en buyuk dosya (MB); arayuz hata metninde gosterir. */
  readonly dosyaSiniriMB: number;
  depolama(): Promise<DepolamaDurumu>;
  kosular(): Promise<KosuOzeti[]>;
  disaAktar(kosuId: string): Promise<{ ad: string; metin: string }>;
  iceAktar(dosya: KayitDosyasi): Promise<{ kosuId: string; hafta: number; tur: "kurucu" | "dao" }>;
  sil(kosuId: string): Promise<void>;
}

function kisaKimlik(kosuId: string): string {
  return kosuId.slice(-4);
}

export function kosuAdi(k: Pick<KosuKaydi, "kosuId" | "tarif">): string {
  const ad = (k.tarif.config as { name?: unknown } | null)?.name;
  return typeof ad === "string" && ad.trim() !== "" ? ad.trim() : kisaKimlik(k.kosuId);
}

/** Dosya adinda guvenli parca: ASCII, kucuk harf, `-` ile ayrilmis. */
function ascii(ad: string): string {
  return ad
    .replace(/\u0131/g, "i") // noktasiz i
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function rastgeleKimlik(): string {
  const g = globalThis.crypto;
  const a = typeof g?.randomUUID === "function" ? g.randomUUID().replace(/-/g, "").slice(0, 8) : Math.random().toString(16).slice(2, 10);
  return `canli-${a}`;
}

/** Kayit tarifinden oyun turu (`config.mode === "dao"`). */
export function kosuTuru(k: Pick<KosuKaydi, "tarif">): "kurucu" | "dao" {
  return (k.tarif.config as { mode?: unknown } | null)?.mode === "dao" ? "dao" : "kurucu";
}

export function kayitHizmetleri(
  k: KayitKatmani,
  o: {
    kimlikUret?: () => string;
    /** Silme KOPRU uzerinden (takip biter, GET diriltmez, cekirdek hatasi yutulmaz). Verilmezse dogrudan akis. */
    sil?: (kosuId: string) => Promise<void>;
    /** Koprunun su an takip ettigi koşular. */
    aktifler?: () => ReadonlySet<string>;
  } = {},
): KayitHizmetleri {
  const kimlikUret = o.kimlikUret ?? rastgeleKimlik;
  return {
    dosyaSiniriMB: Math.floor(AZAMI_DOSYA_KARAKTERI / (1024 * 1024)),
    async depolama() {
      const olcum = await k.kota.olc();
      const kalicilik = await k.kota.kalicilikDurumu().catch(() => null);
      return { olcum, esik: KOTA_ESIGI, kotaUyarisi: olcum !== null && olcum.oran > KOTA_ESIGI, kalicilik };
    },
    async kosular() {
      const l = await k.depo.kosulariListele();
      l.sort((a, b) => b.guncelleme - a.guncelleme);
      const aktif = o.aktifler?.() ?? new Set<string>();
      return l.map((x) => ({ kosuId: x.kosuId, ad: kosuAdi(x), hafta: x.yayimlanan, guncelleme: x.guncelleme, kaynak: x.kaynak, tur: kosuTuru(x), aktif: aktif.has(x.kosuId), disaAktarilmayanHafta: Math.max(0, x.yayimlanan - x.sonDisaAktarim) }));
    },
    async disaAktar(kosuId) {
      const kayit = await k.depo.kosuOku(kosuId);
      const d = await disaAktar(k.depo, kosuId);
      const ad = ascii(kayit ? kosuAdi(kayit) : kosuId) || ascii(kosuId) || "oyun";
      return { ad: `daoliberal-kayit-${ad}-hafta-${d.kosu.yayimlanan}.json`, metin: dosyaMetni(d) };
    },
    async iceAktar(dosya) {
      // Boyut denetimi metin okunmadan ONCE (bayt >= karakter: sinirin ustundeki dosya hic okunmaz).
      if (dosya.size > AZAMI_DOSYA_KARAKTERI) throw new IceAktarmaHatasi("cok_buyuk");
      const metin = await dosya.text();
      const r = await iceAktar(k.depo, metin, { kimlikUret });
      return { kosuId: r.kosuId, hafta: r.hedef, tur: kosuTuru(r.kayit) };
    },
    async sil(kosuId) {
      if (o.aktifler?.().has(kosuId)) throw new IceAktarmaHatasi("kosu_acik");
      await (o.sil ? o.sil(kosuId) : k.akis.kosuSil(kosuId, { kayitlaBirlikte: true }));
    },
  };
}
