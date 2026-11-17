import { describe, expect, it } from "vitest";
import { tr } from "@/oyun/copy/tr";
import { urunAdiOf } from "@/oyun/lib/urunAdlari";
import { MODEL_URUN_KIMLIKLERI } from "./modelUrunKimlikleri";

const YASAK = /\b(aff|gate|shelf|pool|W\.|staff|tuk|döngü|donguc?)\b/i;
const ONEKLER = ["tuketim.", "isletme.", "dilim.", "seri.karsilanma_", "seri.harcama_", "seri.hane_", "seri.sepet_", "seri.parasiz_", "seri.ucret_", "seri.fiyat_", "ayrintilar.sekme.tuketim", "makro.", "seri.makro_", "ayrintilar.sekme.makro"];

describe("ekonomi metinleri", () => {
  const anahtarlar = Object.keys(tr).filter((k) => ONEKLER.some((o) => k.startsWith(o)));

  it("yeni_anahtarlar_tr_ts_de_tanimli_ve_bos_degil", () => {
    expect(anahtarlar.length).toBeGreaterThan(30);
    for (const k of ["ayrintilar.sekme.tuketim", "tuketim.baslik", "tuketim.eksik.baslik", "tuketim.urun.yok", "tuketim.urun.yok_hafta", "tuketim.olculmuyor_pano", "tuketim.eski_sunucu", "tuketim.dunya_rozeti", "tuketim.sehir_karsilanma", "tuketim.urun.baslik"]) {
      expect(Object.keys(tr), k).toContain(k);
    }
    for (const k of anahtarlar) expect((tr as Record<string, string>)[k]!.trim().length, k).toBeGreaterThan(0);
  });

  it("ic_jargon_yok", () => {
    for (const k of anahtarlar) expect((tr as Record<string, string>)[k], k).not.toMatch(YASAK);
  });

  it("makro_metinleri_tanimli_her_kartta_aciklama_var_ve_jargon_yok", () => {
    const m = tr as Record<string, string>;
    for (const id of ["enflasyon", "gercek_ucret", "buyume", "issizlik", "politika", "gercek_faiz", "gini", "yoksul"]) {
      expect(m[`makro.kart.${id}`], id).toBeTruthy();
      expect(m[`makro.kart.${id}.not`]!.length, id).toBeGreaterThan(40);                 // ne demek + iyi yönü
    }
    expect(m["ayrintilar.sekme.makro"]).toBe("Makro göstergeler");
    for (const k of Object.keys(m).filter((x) => x.startsWith("makro.") || x.startsWith("seri.makro_"))) expect(m[k], k).not.toMatch(/\b(pidx|ulc|cpi|ppi|WI|L\.flows|prod_w|dep_ema|fiscal)\b/i);
  });

  it("urun_yok_metni_hata_degil_duraklatinca_acilir", () => {
    expect(tr["tuketim.urun.yok_hafta"]).toBe("Bu hafta ürün ayrıntısı yok; oyunu duraklatınca açılır.");
  });

  it("urun_sozlugu_modelin_tum_urunlerini_kapsar", () => {
    expect(MODEL_URUN_KIMLIKLERI).toHaveLength(35);
    const eksik = MODEL_URUN_KIMLIKLERI.filter((k) => (tr as Record<string, string>)[`urun.ad.${k}`] === undefined);
    expect(eksik).toEqual([]);
    const sozlukKimlikleri = Object.keys(tr).filter((k) => k.startsWith("urun.ad.")).map((k) => k.slice("urun.ad.".length));
    expect(sozlukKimlikleri.sort()).toEqual([...MODEL_URUN_KIMLIKLERI].sort());                    // sözlükte modelde olmayan kimlik de yok
    for (const k of MODEL_URUN_KIMLIKLERI) expect(urunAdiOf(k).length, k).toBeGreaterThan(0);
  });

  it("urun_adlari_diakritikli_ve_bilinmeyen_kimlik_okunur_yedek", () => {
    const beklenen: Record<string, string> = { sut: "Süt", bugday: "Buğday", sise_sut: "Şişe süt", komur: "Kömür", seker: "Şeker", mucevher: "Mücevher", insaat: "İnşaat", aluminyum: "Alüminyum", eglence: "Eğlence", yazilim: "Yazılım", ekmek: "Ekmek" };
    for (const [k, ad] of Object.entries(beklenen)) expect(urunAdiOf(k), k).toBe(ad);
    expect(urunAdiOf("bilinmeyen_urun")).toBe("Bilinmeyen urun");                                  // yedek: okunur ad
    expect(urunAdiOf("bilinmeyen_urun", () => "Yedek ad")).toBe("Yedek ad");
  });
});
