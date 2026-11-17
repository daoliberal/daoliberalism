import { describe, expect, it } from "vitest";
import { boyIlerlet, type BoyHaritasi } from "../../../src/oyun/harita/izoBoy";
import { IZO_STILI } from "../../../src/oyun/harita/haritaStili";
import { durumGorunumu, durumHaritasi, gecisler, gorselDurum, KURULUS_PENCERESI, type GorselDurum } from "../../../src/oyun/harita/izoDurum";
import type { HaritaDurumu, HaritaFirmaSatiri, HaritaVerisi } from "../../../src/oyun/harita/tipler";

const satir = (id: string, o: { calisan?: number; sahip?: "npc" | "oyuncu" | "dao"; dogum?: number | null; durum?: HaritaDurumu } = {}): HaritaFirmaSatiri =>
  [id, "market", 0, o.calisan ?? 5, null, o.sahip ?? "npc", o.dogum ?? null, o.durum ?? "uretim"];
const harita = (hafta: number, ...firmalar: HaritaFirmaSatiri[]): HaritaVerisi => ({ hafta, firmalar });
const boyOf = (h: HaritaVerisi | null, onceki: BoyHaritasi = new Map()): BoyHaritasi => (h ? boyIlerlet(onceki, h.firmalar.map((f) => ({ id: f[0], calisan: f[3] })), h.hafta) : onceki);
const G = (h0: HaritaVerisi | null, h1: HaritaVerisi, dao: Parameters<typeof gecisler>[3] = []) => {
  const b0 = boyOf(h0);
  return gecisler(h0, h1, boyOf(h1, b0), dao);
};

describe("gorselDurum", () => {
  it("dogum_yeniyse_kuruluyor_yalniz_oyuncu_dao", () => {
    expect(KURULUS_PENCERESI).toBe(4);
    expect(gorselDurum(satir("a", { sahip: "oyuncu", dogum: 10 }), 12, null, false)).toBe("kuruluyor");
    expect(gorselDurum(satir("a", { sahip: "dao", dogum: 10 }), 13, null, false)).toBe("kuruluyor");
    expect(gorselDurum(satir("a", { sahip: "oyuncu", dogum: 10 }), 14, null, false)).toBe("uretim");
    expect(gorselDurum(satir("a", { sahip: "npc", dogum: null }), 12, null, false)).toBe("uretim");
  });
  it("npc_dogum_null_ilk_gorulmeden_kuruluyor", () => {
    expect(gorselDurum(satir("n"), 12, 10, false)).toBe("kuruluyor");
    expect(gorselDurum(satir("n"), 14, 10, false)).toBe("uretim");
    expect(gorselDurum(satir("n"), 12, null, false)).toBe("uretim");
  });
  it("kapali_sonra_canli_canlandi", () => {
    expect(gorselDurum(satir("a", { durum: "kapali" }), 12, null, false)).toBe("kapali");
    expect(gorselDurum(satir("a", { durum: "kapali" }), 12, 12, true)).toBe("kapali");
    expect(gorselDurum(satir("a", { durum: "uretim" }), 12, null, true)).toBe("canlandi");
    expect(gorselDurum(satir("a", { durum: "zayif" }), 12, null, true)).toBe("canlandi");
  });
  it("canlandi_yalniz_bayrakla_sonraki_hafta_normal", () => {
    expect(gorselDurum(satir("a"), 13, null, true)).toBe("canlandi");
    expect(gorselDurum(satir("a"), 14, null, false)).toBe("uretim");
  });
  it("zayif_ve_issiz_oldugu_gibi", () => {
    expect(gorselDurum(satir("a", { durum: "zayif" }), 12, null, false)).toBe("zayif");
    expect(gorselDurum(satir("a", { durum: "issiz" }), 12, null, false)).toBe("issiz");
  });
});

describe("gecisler", () => {
  it("ilk_harita_baseline_kuruldu_uretmez", () => {
    expect(G(null, harita(10, satir("a"), satir("b", { sahip: "oyuncu", dogum: 9 })))).toEqual([]);
  });
  it("gecisler_kimlik_farkindan", () => {
    const g = G(harita(10, satir("a"), satir("b"), satir("c", { durum: "zayif" }), satir("d", { durum: "kapali" }), satir("e", { durum: "uretim" })),
      harita(11, satir("a"), satir("c"), satir("d"), satir("e", { durum: "zayif" }), satir("n")));
    // b kayboldu (kapanan), c toparlandi, d kapali->canli, e zayifladi, n yeni
    expect(g).toEqual(expect.arrayContaining([
      { id: "b", hafta: 11, tur: "batti" },
      { id: "c", hafta: 11, tur: "toparlandi" },
      { id: "d", hafta: 11, tur: "canlandi" },
      { id: "e", hafta: 11, tur: "zayifladi" },
      { id: "n", hafta: 11, tur: "kuruldu" },
    ]));
    expect(g).toHaveLength(5);
  });
  it("uretimden_kapaliya_batti_ve_kapali_dusunce_sessiz", () => {
    expect(G(harita(10, satir("a")), harita(11, satir("a", { durum: "kapali" })))).toEqual([{ id: "a", hafta: 11, tur: "batti" }]);
    expect(G(harita(10, satir("a", { durum: "kapali" })), harita(21))).toEqual([]);
    expect(G(harita(10), harita(11, satir("a", { durum: "kapali" })))).toEqual([]);
  });
  it("dao_olaylari_anlik_gecis", () => {
    const g = G(harita(10, satir("a")), harita(11, satir("a")), [
      { tur: "kuruldu", hafta: 11, firma: "x", sektor: "market" },
      { tur: "firma_batti", hafta: 11, firma: "y" },
      { tur: "ayrildi", hafta: 11 },
    ]);
    expect(g).toEqual([{ id: "x", hafta: 11, tur: "kuruldu" }, { id: "y", hafta: 11, tur: "batti" }]);
  });
  it("ayni_gecis_iki_kez_uretilmez", () => {
    const g = G(harita(10, satir("a")), harita(11, satir("a"), satir("x", { sahip: "dao", dogum: 11 })), [
      { tur: "kuruldu", hafta: 11, firma: "x", sektor: "market" },
      { tur: "kuruldu", hafta: 11, firma: "x", sektor: "market" },
    ]);
    expect(g).toEqual([{ id: "x", hafta: 11, tur: "kuruldu" }]);
  });
  it("buyudu_kuculdu_gecisi_boy_haritalarindan", () => {
    let b = boyOf(harita(1, satir("a", { calisan: 5 }), satir("b", { calisan: 30 })));
    for (const h of [2, 3]) b = boyOf(harita(h, satir("a", { calisan: 10 }), satir("b", { calisan: 5 })), b);
    const onceki = harita(3, satir("a", { calisan: 10 }), satir("b", { calisan: 5 }));
    const bo = b;
    const simdi = harita(4, satir("a", { calisan: 10 }), satir("b", { calisan: 5 }));
    const bs = boyOf(simdi, bo);
    expect(gecisler(onceki, simdi, bs)).toEqual(expect.arrayContaining([{ id: "a", hafta: 4, tur: "buyudu" }, { id: "b", hafta: 4, tur: "kuculdu" }]));
    expect(gecisler(onceki, harita(5, ...simdi.firmalar), boyOf(harita(5, ...simdi.firmalar), bs))).toEqual([]);
  });
});

describe("durumGorunumu", () => {
  it("tablo_durum_basina_gorunum", () => {
    const D = IZO_STILI.durum;
    expect(durumGorunumu("uretim")).toEqual({ alfa: 1, tint: null, tahta: false, iskele: false, duman: true, isik: true });
    expect(durumGorunumu("zayif")).toEqual({ alfa: 0.9, tint: null, tahta: false, iskele: false, duman: false, isik: false });
    expect(durumGorunumu("issiz")).toEqual({ alfa: 1, tint: null, tahta: false, iskele: false, duman: false, isik: false });
    expect(durumGorunumu("kapali")).toEqual({ alfa: 0.55, tint: D.kapali.tint, tahta: true, iskele: false, duman: false, isik: false });
    expect(durumGorunumu("kuruluyor")).toEqual({ alfa: 0.85, tint: null, tahta: false, iskele: true, duman: false, isik: false });
    expect(durumGorunumu("canlandi").tahta).toBe(false);
    expect(durumGorunumu("canlandi").isik).toBe(true);
  });
  it("kapali_tint_gri_sayi_diger_durumlarda_tint_yok", () => {
    expect(typeof durumGorunumu("kapali").tint).toBe("number");
    for (const d of ["uretim", "zayif", "issiz", "kuruluyor", "canlandi"] as GorselDurum[]) expect(durumGorunumu(d).tint, d).toBeNull();
  });
  it("duman_yalniz_uygun_turlerde_tur_listesi", () => {
    expect(IZO_STILI.dumanTurleri).toContain("maden_komur");
    expect(IZO_STILI.dumanTurleri).toContain("santral");
    expect(IZO_STILI.dumanTurleri).not.toContain("market");
    expect(IZO_STILI.dumanTurleri).not.toContain("okul");
  });
});

describe("durumHaritasi", () => {
  it("harita_durumu_kuruluyor_ve_canlandi_birlesir", () => {
    const h = harita(20, satir("a"), satir("b", { durum: "kapali" }), satir("c", { sahip: "oyuncu", dogum: 19 }), satir("d", { durum: "zayif" }), satir("e"));
    const m = durumHaritasi(h, new Map([["e", 18]]), new Set(["a"]));
    expect(m.get("a")).toBe("canlandi");
    expect(m.get("b")).toBe("kapali");
    expect(m.get("c")).toBe("kuruluyor");
    expect(m.get("d")).toBe("zayif");
    expect(m.get("e")).toBe("kuruluyor");
  });
});
