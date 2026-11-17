import { describe, expect, it, vi } from "vitest";
import { VARSAYILAN_KATALOG } from "@/oyun/harita/binaKatalogu";
import { SVG_KATMANLARI } from "@/oyun/harita/haritaStili";
import { karistir, svgTonla, VarlikYukleyici } from "@/oyun/harita/varlikYukleyici";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect data-katman="duvar" x="0" y="0" width="10" height="10"/><rect data-katman="pencere" width="2" height="2"/><g data-ek="3"><rect data-katman="cati" width="1" height="1"/></g><rect data-katman="duman" width="1" height="1"/><rect width="1" height="1"/></svg>`;
const RENK: Record<string, string> = { "--g": "#102030", "--harita-pencere": "#aabbcc", "--harita-kontur": "#000000", "--harita-golge": "#000000", "--harita-isik": "#ffffff", "--harita-duman": "#777777" };
const okuyucu = (ad: string): string => RENK[ad] ?? "#808080";

describe("svgTonla", () => {
  it("katman_renkleri_takma_addan_gelir_sabit_renk_yok", () => {
    const s = svgTonla(SVG, 4, "--g", okuyucu, 2);
    expect(s).toContain('fill="#102030"'); // duvar = ana renk
    expect(s).toContain('fill="#aabbcc"'); // pencere = takma ad
    expect(SVG).not.toMatch(/fill=|#[0-9a-f]{3,6}\b/i); // kaynak çizimde sabit renk yok
    // cati ana renk + golge karışımı (sabit değil, hesaplanır)
    expect(s).toContain(`fill="${karistir("#102030", "#000000", SVG_KATMANLARI["cati"]!.karisim!.oran)}"`);
  });
  it("cizgisiz_katmanlar_kontursuz_ve_bilinmeyen_dokunulmaz", () => {
    const d = new DOMParser().parseFromString(svgTonla(SVG, 4, "--g", okuyucu, 2), "image/svg+xml");
    const duman = d.querySelector('[data-katman="duman"]')!;
    expect(duman.getAttribute("stroke")).toBeNull();
    expect(d.querySelector('[data-katman="duvar"]')!.getAttribute("stroke")).toBe("#000000");
    expect(d.querySelectorAll("rect:not([data-katman])")[0]!.getAttribute("fill")).toBeNull();
  });
  it("data_ek_boydan_buyukse_gizlenir_ve_boyut_cozunurlukle_carpilir", () => {
    const g = (boy: 1 | 2 | 3 | 4): Element => new DOMParser().parseFromString(svgTonla(SVG, boy, "--g", okuyucu, 2), "image/svg+xml").querySelector("[data-ek]")!;
    expect(g(2).getAttribute("display")).toBe("none");
    expect(g(3).getAttribute("display")).toBeNull();
    expect(new DOMParser().parseFromString(svgTonla(SVG, 1, "--g", okuyucu, 2), "image/svg+xml").documentElement.getAttribute("width")).toBe("200");
  });
  it("karistir_ayristiramazsa_ana_rengi_dondurur", () => {
    expect(karistir("var(--x)", "#000000", 0.5)).toBe("var(--x)");
    expect(karistir("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(karistir("rgb(255, 255, 255)", "#000", 0)).toBe("#ffffff");
  });
});

function kur(katalog = VARSAYILAN_KATALOG, tema = { v: 0, koyu: false }) {
  const getir = vi.fn(async () => SVG);
  const dokuYap = vi.fn(async (k: { svg: string } | { url: string }, c: number) => ({ k, c }));
  const y = new VarlikYukleyici({ renk: okuyucu, getir, dokuYap, katalog, tema: () => tema.v, koyu: () => tema.koyu });
  return { y, getir, dokuYap, tema };
}

describe("VarlikYukleyici", () => {
  it("svg_dokusu_cozunurluk_2_3_ve_onbellekli_anahtar_sablon_boy_tema", async () => {
    const { y, getir, dokuYap } = kur();
    const a = await y.doku("imalat", 2);
    await y.doku("imalat", 2);
    expect(dokuYap).toHaveBeenCalledTimes(1);
    expect(getir).toHaveBeenCalledWith("/oyun-harita/sablonlar/imalat-2.svg");
    expect(dokuYap.mock.calls[0]![1]).toBeGreaterThanOrEqual(2);
    expect(dokuYap.mock.calls[0]![1]).toBeLessThanOrEqual(3);
    expect(a.k).toHaveProperty("svg");
    await y.doku("imalat", 3);
    expect(dokuYap).toHaveBeenCalledTimes(2);
  });
  it("eszamanli_istekler_tek_yukleme_yapar", async () => {
    const { y, dokuYap } = kur();
    await Promise.all([y.doku("hizmet", 1), y.doku("hizmet", 1)]);
    expect(dokuYap).toHaveBeenCalledTimes(1);
  });
  it("tema_degisince_doku_anahtari_degisir_ve_renkler_yeniden_okunur", async () => {
    const { y, dokuYap, tema } = kur();
    await y.doku("imalat", 1);
    tema.v = 1;
    await y.doku("imalat", 1);
    expect(dokuYap).toHaveBeenCalledTimes(2);
  });
  it("resim_turu_tonlamasiz_dogrudan_url_ve_koyuda_dosyaKoyu", async () => {
    const katalog = { ...VARSAYILAN_KATALOG, hizmet: { ...VARSAYILAN_KATALOG.hizmet, 2: { ...VARSAYILAN_KATALOG.hizmet[2], tur: "resim" as const, dosya: "bina/h2.png", dosyaKoyu: "bina/h2-koyu.webp" } } };
    const t = { v: 0, koyu: false };
    const { y, getir, dokuYap } = kur(katalog, t);
    await y.doku("hizmet", 2);
    expect(getir).not.toHaveBeenCalled();
    expect(dokuYap.mock.calls[0]![0]).toEqual({ url: "/oyun-harita/bina/h2.png" });
    t.v = 1; t.koyu = true;
    await y.doku("hizmet", 2);
    expect(dokuYap.mock.calls[1]![0]).toEqual({ url: "/oyun-harita/bina/h2-koyu.webp" });
  });
  it("yukleme_hatasi_reddedilir_ve_onbellege_girmez", async () => {
    const getir = vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValue(SVG);
    const dokuYap = vi.fn(async () => 1);
    const y = new VarlikYukleyici({ renk: okuyucu, getir, dokuYap, tema: () => 0, koyu: () => false });
    await expect(y.doku("ahir", 1)).rejects.toThrow("404");
    await expect(y.doku("ahir", 1)).resolves.toBe(1);
  });
});

describe("VarlikYukleyici (bellek)", () => {
  it("I2_eski_tema_dokusu_kullanimda_degilse_yok_edilir_yoket_hepsini_temizler", async () => {
    const yok = vi.fn();
    const t = { v: 0 };
    const y = new VarlikYukleyici<{ id: number }>({ renk: okuyucu, getir: async () => SVG, dokuYap: async () => ({ id: ++sayac }), tema: () => t.v, koyu: () => false, dokuYoket: yok });
    let sayac = 0;
    const eski = await y.doku("imalat", 1);
    t.v = 1;
    const yeni = await y.doku("imalat", 1);
    y.emekliyiAt(new Set([eski])); // hâlâ kullanımda
    expect(yok).not.toHaveBeenCalled();
    y.emekliyiAt(new Set([yeni]));
    expect(yok).toHaveBeenCalledWith(eski);
    y.emekliyiAt(new Set([yeni]));
    expect(yok).toHaveBeenCalledTimes(1);
    y.yoket();
    expect(yok).toHaveBeenCalledWith(yeni);
  });

  it("N1_bekleyen_eski_tema_promisei_gec_cozulunce_yok_edilir", async () => {
    const yok = vi.fn();
    const t = { v: 0 };
    const cozucu: ((d: { id: number }) => void)[] = [];
    const y = new VarlikYukleyici<{ id: number }>({ renk: okuyucu, getir: async () => SVG, dokuYap: () => new Promise((r) => { cozucu.push(r); }), tema: () => t.v, koyu: () => false, dokuYoket: yok });
    const eski = y.doku("imalat", 1);
    await Promise.resolve();
    t.v = 1;
    void y.doku("imalat", 1); // eskiyi önbellekten atar (henüz çözülmemişti)
    await vi.waitFor(() => expect(cozucu).toHaveLength(1));
    const d = { id: 1 };
    cozucu[0]!(d);
    await eski;
    expect(yok).toHaveBeenCalledWith(d);
  });
  it("N1_yoket_sonrasi_gec_cozulen_doku_yok_edilir", async () => {
    const yok = vi.fn();
    const cozucu: ((d: { id: number }) => void)[] = [];
    const y = new VarlikYukleyici<{ id: number }>({ renk: okuyucu, getir: async () => SVG, dokuYap: () => new Promise((r) => { cozucu.push(r); }), tema: () => 0, koyu: () => false, dokuYoket: yok });
    const p = y.doku("imalat", 1);
    await vi.waitFor(() => expect(cozucu).toHaveLength(1));
    y.yoket();
    const d = { id: 2 };
    cozucu[0]!(d);
    await p;
    expect(yok).toHaveBeenCalledWith(d);
  });
});

describe("VarlikYukleyici süsler", () => {
  it("sus_dokusu_suslar_klasorunden_onbellekli_ve_isletme_dokusundan_ayri", async () => {
    const { y, getir, dokuYap } = kur();
    await y.susDoku("park");
    await y.susDoku("park");
    expect(getir).toHaveBeenCalledTimes(1);
    expect(getir).toHaveBeenCalledWith("/oyun-harita/suslar/park.svg");
    expect(dokuYap).toHaveBeenCalledTimes(1);
    await y.susDoku("cit");
    await y.doku("imalat", 1);
    expect(dokuYap).toHaveBeenCalledTimes(3);
  });
  it("sus_dokusu_tema_degisince_yeniden_yuklenir", async () => {
    const { y, dokuYap, tema } = kur();
    await y.susDoku("agac-kumesi");
    tema.v = 1;
    await y.susDoku("agac-kumesi");
    expect(dokuYap).toHaveBeenCalledTimes(2);
  });
});

