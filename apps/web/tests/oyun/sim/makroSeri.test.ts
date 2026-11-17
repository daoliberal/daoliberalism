import { describe, expect, it } from "vitest";
import { endeksSerisi, gercekFaiz, gercekUcret100, ilkHafta100, istihdamOrani, issizlikOrani, makroDeger, makroSeri, makroVar } from "@/oyun/sim/makroSeri";
import type { MakroBlogu, WeekPacket } from "@/oyun/sim/types";

const blok = (over: Partial<{ tuk: number | null; enf: number | null; politika: number | null; gercek: number | null; gercek_ucret: number | null; buyume: number | null }> = {}): MakroBlogu => ({
  fiyat: { tuk: over.tuk ?? 1, enf: over.enf ?? null, uretici: 1, ucret: 1, gercek_ucret: over.gercek_ucret ?? 1 },
  uretim: { nominal: 100, gercek: 90, buyume: over.buyume ?? null, verimlilik: 9 },
  para: { stok: 1000, korunum: 0, mali: 1000, kredi_net: 0, acilis: 0, hiz: 0.4 },
  faiz: { politika: over.politika ?? null, mevduat: null, kredi: null, gercek: over.gercek ?? null },
  marj: { npc: 0.05, oyuncu: null },
  konut: null,
  dagilim: { gini_nakit: 0.4, gini_gelir: 0.2, gini_servet: 0.5, yoksul: 0.3, medyan_sepet: 1.1 },
  kredi: { stok: 0, buyume: null, temerrut: null },
});
const paket = (week: number, makro?: MakroBlogu, unemployment: number | null = null): WeekPacket =>
  ({ v: 1, run_id: "r", week, version: 1, world: { unemployment_rate_all: unemployment } as WeekPacket["world"], events: [], ...(makro ? { makro } : {}) });

describe("makro seçicileri", () => {
  it("test_seri_haftaya_hizali_eksik_hafta_null", () => {
    const w = [paket(1, blok({ tuk: 1 })), paket(2), paket(4, blok({ tuk: 1.2 }))];
    expect(makroSeri(w, (m) => m.fiyat.tuk)).toEqual([1, null, null, 1.2]);
  });

  it("test_ilk_olculen_hafta_100_ve_sifir_ilk_deger_null", () => {
    expect(ilkHafta100([null, 2, 3, null, 1])).toEqual([null, 100, 150, null, 50]);
    expect(ilkHafta100([null, 0, 1])).toEqual([null, 0, 100]);                     // 0 taban olamaz: ilk POZİTİF ölçüm = 100 (ekonomiSeri.endeksSeri ile aynı kural)
    expect(ilkHafta100([0, 0])).toEqual([null, null]);                             // pozitif ölçüm yoksa tüm seri null
    expect(ilkHafta100([null, null])).toEqual([null, null]);
    const w = [paket(1, blok({ tuk: 1 })), paket(2, blok({ tuk: 1.25 }))];
    expect(endeksSerisi(w, (m) => m.fiyat.tuk)).toEqual([100, 125]);
  });

  it("test_negatif_deger_seride_korunur", () => {
    const w = [paket(1, blok({ enf: -0.1 })), paket(2, blok({ enf: 0.2 }))];
    expect(makroSeri(w, (m) => m.fiyat.enf)).toEqual([-0.1, 0.2]);
  });

  it("test_gercek_faiz_blok_degeri_yoksa_politika_eksi_enflasyon", () => {
    expect(gercekFaiz(blok({ gercek: -0.3, politika: 0.1, enf: 0.5 }))).toBe(-0.3);       // sunucunun değeri esas
    expect(gercekFaiz(blok({ politika: 0.2, enf: 0.05 }))).toBeCloseTo(0.15, 12);
    expect(gercekFaiz(blok({ politika: 0.2 }))).toBeNull();                                // enflasyon yoksa uydurma yok
  });

  it("test_gercek_ucret_kart_degeri_100_ile_carpilir", () => {
    expect(gercekUcret100(blok({ gercek_ucret: 0.945 }))).toBeCloseTo(94.5, 9);
  });

  it("test_issizlik_istihdam_dunya_alanindan_ve_makro_var", () => {
    expect(issizlikOrani(paket(1, blok(), 0.25))).toBe(0.25);
    expect(istihdamOrani(paket(1, blok(), 0.25))).toBe(0.75);
    expect(issizlikOrani(paket(1, blok(), null))).toBeNull();
    expect(istihdamOrani(null)).toBeNull();
    expect(makroDeger(paket(1), (m) => m.fiyat.tuk)).toBeNull();
    expect(makroDeger(null, (m) => m.fiyat.tuk)).toBeNull();
    expect(makroVar([paket(1)])).toBe(false);
    expect(makroVar([paket(1), paket(2, blok())])).toBe(true);
  });
});
