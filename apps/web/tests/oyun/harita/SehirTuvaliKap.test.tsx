import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SehirTuvaliKap } from "@/oyun/harita/SehirTuvaliKap";
import type { IzoSahne } from "@/oyun/harita/izoSahne";
import type { SahneBina, SehirSahnesi } from "@/oyun/harita/tipler";

const web = vi.hoisted(() => ({ gl: true, atar: false, son: null as unknown as Record<string, unknown> }));
vi.mock("@/oyun/harita/useWebgl", () => ({ useWebgl: () => web.gl }));
vi.mock("@/oyun/harita/HaritaSahnesi", async () => {
  const React = await import("react");
  return {
    SehirTuvali: (p: { onHata(): void; sahne: object }) => {
      web.son = p as unknown as Record<string, unknown>;
      if (web.atar) throw new Error("render patladi");
      return React.createElement("button", { type: "button", "data-testid": "tuval", onClick: p.onHata }, "tuval");
    },
  };
});

const bina = (id: string, tur: SahneBina["tur"], etiket: string): SahneBina => ({
  id, tur, sehir: 0, x: 0, y: 0, boyut: 2, ref: { kind: tur === "isletme" ? "firm" : "city", ref: id }, etiket, parsel: null, sablon: tur === "isletme" ? "imalat" : (tur as "sehir"), taban: { g: 1, d: 1 },
});
const sahne: SehirSahnesi = {
  susler: [], sehir: 0, ad: "Ada", genislik: 1, yukseklik: 1, sokaklar: [], parseller: [], binalar: [bina("f1", "isletme", "firin")], meydan: { x: 0, y: 0, yaricap: 1 },
  sehirBinasi: bina("sehir-0", "sehir", "Ada"), ahir: bina("ahir", "ahir", "ahir"), ben: null,
  katman: { tur: "yok", tonlar: new Map(), lejant: [], rozetler: [] }, veriYok: false,
};
const G = { x: 0, y: 0, olcek: 1 };
afterEach(() => { cleanup(); web.gl = true; web.atar = false; });

describe("SehirTuvaliKap", () => {
  it("tuval_hata_verince_tablo_yedegi_acilir_ve_not_gorunur", async () => {
    render(<SehirTuvaliKap sahne={sahne} tabloSahnesi={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} />);
    const tuval = await screen.findByTestId("tuval");
    expect(document.querySelector("details")!.open).toBe(false);
    tuval.click();
    expect(await screen.findByText("Harita çizilemedi; tablo gösteriliyor.")).toBeInTheDocument();
    expect(document.querySelector("details")!.open).toBe(true);
    expect(screen.queryByTestId("tuval")).toBeNull();
  });
  it("webgl_yoksa_tablo_acik", () => {
    web.gl = false;
    render(<SehirTuvaliKap sahne={sahne} tabloSahnesi={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} />);
    expect(document.querySelector("details")!.open).toBe(true);
  });

  const parsel = (id: string) => ({ id, x: 0, y: 0, genislik: 1, yukseklik: 1, kademe: 0 });
  const izoOf = (kaynak: SehirSahnesi): IzoSahne => ({ kaynak, dunya: { genislik: 1, yukseklik: 1 }, binalar: [], kaydirma: { x: 0, y: 0 } }) as unknown as IzoSahne;

  it("tablo_klasik_sahneden_isletme_kur_hedefi_etkin_sahnenin_bosParsellerinden", () => {
    const klasik: SehirSahnesi = { ...sahne, bosParseller: [parsel("p5_5"), parsel("p6_6")] };
    const izo = izoOf({ ...sahne, bosParseller: [parsel("p0_0")], binalar: [] });
    const onSec = vi.fn();
    render(<SehirTuvaliKap sahne={izo} tabloSahnesi={klasik} secili={null} onSec={onSec} kamera={G} onKamera={() => {}} />);
    // işletme listesi klasik sahneden (izo kaynağında işletme yok)
    expect(screen.getByRole("button", { name: /f[ıi]r[ıi]n/i })).toBeInTheDocument();
    // kur hedefi izo domino kimliğiyle
    fireEvent.click(screen.getByRole("button", { name: "Boş parsel (1 adet)" }));
    expect(onSec).toHaveBeenCalledWith({ kind: "parsel", ref: "p0_0" });
  });

  it("izo_sahne_tuvale_aynen_iner_manifest_ve_gorselBoy_yok", () => {
    const izo = izoOf(sahne);
    render(<SehirTuvaliKap sahne={izo} tabloSahnesi={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} />);
    expect(web.son.sahne).toBe(izo);
    expect(Object.keys(web.son)).not.toContain("manifest");
    expect(Object.keys(web.son)).not.toContain("gorselBoy");
  });

  it("onSpriteHatasi_tuvale_iletilir_yoksa_verilmez", () => {
    const f = vi.fn();
    render(<SehirTuvaliKap sahne={sahne} tabloSahnesi={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} onSpriteHatasi={f} />);
    expect(web.son.onSpriteHatasi).toBe(f);
    cleanup();
    render(<SehirTuvaliKap sahne={sahne} tabloSahnesi={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} />);
    expect(Object.keys(web.son)).not.toContain("onSpriteHatasi");
  });
});

describe("SehirTuvaliKap: kademeli yedek (izo -> klasik -> tablo)", () => {
  const izoOf = (kaynak: SehirSahnesi): IzoSahne => ({ kaynak, dunya: { genislik: 1, yukseklik: 1 }, binalar: [], kaydirma: { x: 0, y: 0 } }) as unknown as IzoSahne;
  const ortak = { tabloSahnesi: sahne, secili: null, onSec: () => {}, kamera: G, onKamera: () => {} };
  const tablo = (): HTMLDetailsElement => document.querySelector("details")!;

  it("yukleniyor_role_status", () => {
    render(<SehirTuvaliKap sahne={sahne} {...ortak} yukleniyor />);
    expect(screen.getByRole("status")).toHaveTextContent("Şehir yükleniyor");
    expect(tablo().open).toBe(false);
    expect(screen.getByTestId("tuval")).toBeInTheDocument();       // klasik çizim kare atlamadan sürer
    cleanup();
    render(<SehirTuvaliKap sahne={sahne} {...ortak} />);
    expect(screen.queryByText("Şehir yükleniyor")).toBeNull();
  });

  it("manifest_404_klasige_duser_not_gorunur_tablo_kapali", () => {
    render(<SehirTuvaliKap sahne={sahne} {...ortak} dustu />);
    expect(screen.getByRole("status")).toHaveTextContent("Şehir görünümü yüklenemedi; sade görünüm gösteriliyor.");
    expect(tablo().open).toBe(false);
    expect(screen.getByTestId("tuval")).toBeInTheDocument();
  });

  it("izo_tuval_hata_verince_klasige_dusulur_tabloya_degil_ve_bildirim_tek_sefer", () => {
    const f = vi.fn();
    render(<SehirTuvaliKap sahne={izoOf(sahne)} {...ortak} onSpriteHatasi={f} />);
    const tuval = screen.getByTestId("tuval");
    fireEvent.click(tuval);
    fireEvent.click(tuval);
    expect(f).toHaveBeenCalledTimes(1);
    expect(tablo().open).toBe(false);
    expect(screen.queryByText("Harita çizilemedi; tablo gösteriliyor.")).toBeNull();
  });

  it("izo_render_atarsa_klasige_dusulur_tabloya_degil", () => {
    const f = vi.fn();
    const hataSus = vi.spyOn(console, "error").mockImplementation(() => {});
    web.atar = true;
    render(<SehirTuvaliKap sahne={izoOf(sahne)} {...ortak} onSpriteHatasi={f} />);
    expect(f).toHaveBeenCalledTimes(1);
    expect(tablo().open).toBe(false);
    expect(screen.queryByText("Harita çizilemedi; tablo gösteriliyor.")).toBeNull();
    hataSus.mockRestore();
  });

  it("sprite_hatasi_modu_klasige_cevirir_ve_sahne_klasik_yerlesimle_yeniden_kurulur_klasik_de_atarsa_tablo_acik", async () => {
    const f = vi.fn();
    const izo = izoOf(sahne);
    const { rerender } = render(<SehirTuvaliKap sahne={izo} {...ortak} onSpriteHatasi={f} />);
    fireEvent.click(screen.getByTestId("tuval"));
    expect(f).toHaveBeenCalledTimes(1);
    // üst bileşen klasiğe döner: tuval klasik sahneyle yeniden kurulur (izo hata durumu devralınmaz)
    rerender(<SehirTuvaliKap sahne={sahne} {...ortak} onSpriteHatasi={f} dustu />);
    expect(web.son.sahne).toBe(sahne);
    expect(tablo().open).toBe(false);
    // klasik de atarsa: tablo açık ve harita.hata notu
    fireEvent.click(screen.getByTestId("tuval"));
    expect(await screen.findByText("Harita çizilemedi; tablo gösteriliyor.")).toBeInTheDocument();
    expect(tablo().open).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tuval")).toBeNull();
  });

  it("izo_sahnede_onSpriteHatasi_yoksa_hata_tabloya_duser", () => {
    render(<SehirTuvaliKap sahne={izoOf(sahne)} {...ortak} />);
    fireEvent.click(screen.getByTestId("tuval"));
    expect(tablo().open).toBe(true);
  });

  it("webgl_yok_tablo_acik_ve_yukleniyor_notu_yok", () => {
    web.gl = false;
    render(<SehirTuvaliKap sahne={sahne} {...ortak} yukleniyor />);
    expect(tablo().open).toBe(true);
    expect(screen.queryByText("Şehir yükleniyor")).toBeNull();
  });

  it("tablo_her_zaman_erisilebilir", () => {
    for (const o of [{}, { yukleniyor: true }, { dustu: true }] as const) {
      render(<SehirTuvaliKap sahne={sahne} {...ortak} {...o} />);
      expect(screen.getByText("Şehir haritası (tablo)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /f[ıi]r[ıi]n/i })).toBeInTheDocument();
      cleanup();
    }
    render(<SehirTuvaliKap sahne={izoOf(sahne)} {...ortak} />);
    expect(screen.getByText("Şehir haritası (tablo)")).toBeInTheDocument();
  });

  it("aria_ozeti_moddan_bagimsiz", () => {
    render(<SehirTuvaliKap sahne={sahne} {...ortak} />);
    const klasik = screen.getByRole("region", { name: /Şehir haritası: Ada/ }).getAttribute("aria-label");
    expect(klasik).toBe("Şehir haritası: Ada, 1 işletme, 0 lonca");
    cleanup();
    render(<SehirTuvaliKap sahne={izoOf({ ...sahne, binalar: [] })} {...ortak} />);
    expect(screen.getByRole("region", { name: /Şehir haritası: Ada/ }).getAttribute("aria-label")).toBe(klasik);
    cleanup();
    render(<SehirTuvaliKap sahne={sahne} {...ortak} yukleniyor />);
    expect(screen.getByRole("region", { name: /Şehir haritası: Ada/ }).getAttribute("aria-label")).toBe(klasik);
  });

  it("durum_notlari_sabit_status_kabinin_icinde_metin_degisir", () => {
    const { rerender } = render(<SehirTuvaliKap sahne={sahne} {...ortak} />);
    const kap = screen.getByRole("status");
    expect(kap).toHaveTextContent("");
    rerender(<SehirTuvaliKap sahne={sahne} {...ortak} yukleniyor />);
    expect(screen.getByRole("status")).toBe(kap);
    expect(kap).toHaveTextContent("Şehir yükleniyor");
    rerender(<SehirTuvaliKap sahne={sahne} {...ortak} dustu />);
    expect(screen.getByRole("status")).toBe(kap);
    expect(kap).toHaveTextContent("Şehir görünümü yüklenemedi");
    fireEvent.click(screen.getByTestId("tuval"));
    expect(screen.getByRole("status")).toBe(kap);
    expect(kap).toHaveTextContent("Harita çizilemedi; tablo gösteriliyor.");
  });
});
