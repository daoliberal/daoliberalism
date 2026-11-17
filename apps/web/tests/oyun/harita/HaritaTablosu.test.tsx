import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HaritaTablosu } from "@/oyun/harita/HaritaTablosu";
import type { SahneBina, SehirSahnesi } from "@/oyun/harita/tipler";

const bina = (id: string, tur: SahneBina["tur"], etiket: string, boyut: 1 | 2 | 3 | 4 = 2): SahneBina => ({
  id, tur, sehir: 0, x: 0, y: 0, boyut, ref: { kind: tur === "isletme" ? "firm" : tur === "lonca" ? "lonca" : tur === "ahir" ? "sector" : "city", ref: id }, etiket, parsel: null, sablon: tur === "isletme" ? "imalat" : (tur as "sehir"), taban: { g: 1, d: 1 },
});
const sahneOf = (ek: Partial<SehirSahnesi> = {}): SehirSahnesi => ({
  susler: [], sehir: 0, ad: "Ada", genislik: 1, yukseklik: 1, sokaklar: [], parseller: [],
  binalar: [bina("f1", "isletme", "firin", 1), bina("f2", "isletme", "kafe", 3), bina("lonca1", "lonca", "lonca1")], meydan: { x: 0, y: 0, yaricap: 1 },
  sehirBinasi: bina("sehir-0", "sehir", "Ada"), ahir: bina("ahir", "ahir", "ahir"), ben: null,
  katman: { tur: "yok", tonlar: new Map(), lejant: [], rozetler: [] }, veriYok: false, ...ek,
});
afterEach(cleanup);

describe("HaritaTablosu (tek şehir)", () => {
  it("sehir_isletme_lonca_ve_ahir_satirlari_tiklanir", () => {
    const onSec = vi.fn();
    render(<HaritaTablosu sahne={sahneOf()} secili={null} onSec={onSec} />);
    fireEvent.click(screen.getByRole("button", { name: "Ada" }));
    expect(onSec).toHaveBeenCalledWith({ kind: "city", ref: "sehir-0" });
    fireEvent.click(screen.getByRole("button", { name: "Ahır" }));
    expect(onSec).toHaveBeenCalledWith({ kind: "sector", ref: "ahir" });
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Ada işletmeleri · 2 işletme")).toBeInTheDocument();
  });
  it("veri_yoksa_not_ve_katman_lejanti_ile_rozetler_yazilir", () => {
    render(<HaritaTablosu sahne={sahneOf({ veriYok: true, katman: { tur: "talep", tonlar: new Map(), lejant: [{ ton: "iyi", anahtar: "talep.iyi", alt: 0.9, ust: null, adet: 3 }], rozetler: [{ hedef: "sehir", binaId: "sehir-0", sayi: 4 }] } })} secili={null} onSec={() => {}} />);
    expect(screen.getByText("Bina verisi bu kaynakta yok.")).toBeInTheDocument();
    expect(screen.getByText("Talep karşılanıyor: 3 işletme")).toBeInTheDocument();
    expect(screen.getByText("Bu şehirde 4 işsiz")).toBeInTheDocument();
  });
  it("meydan_her_zaman_bos_parsel_yalniz_varsa_secilir", () => {
    const onSec = vi.fn();
    const { rerender } = render(<HaritaTablosu sahne={sahneOf()} secili={null} onSec={onSec} />);
    fireEvent.click(screen.getByRole("button", { name: "Lonca meydanı" }));
    expect(onSec).toHaveBeenLastCalledWith({ kind: "lonca", ref: "meydan" });
    expect(screen.queryByRole("button", { name: /Boş parsel/ })).toBeNull();
    rerender(<HaritaTablosu sahne={sahneOf({ bosParseller: [{ id: "p0_1", x: 0, y: 0, genislik: 1, yukseklik: 1, kademe: 0 }, { id: "p1_1", x: 0, y: 0, genislik: 1, yukseklik: 1, kademe: 0 }] })} secili={null} onSec={onSec} />);
    fireEvent.click(screen.getByRole("button", { name: "Boş parsel (2 adet)" }));
    expect(onSec).toHaveBeenLastCalledWith({ kind: "parsel", ref: "p0_1" });
  });
  it("izo_durumlari_adin_yaninda_metinle_yazilir_uretimde_degismez", () => {
    render(<HaritaTablosu sahne={sahneOf()} secili={null} onSec={() => {}} durumlar={new Map([["f1", "kapali"], ["f2", "uretim"]])} />);
    expect(screen.getAllByRole("button", { name: /\(kapalı\)$/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /üretimde/ })).toBeNull();
  });
  it("kurumlar_yalniz_istenince_liman_ve_ihracat_satirlari_tiklanir", () => {
    const onSec = vi.fn();
    const { rerender } = render(<HaritaTablosu sahne={sahneOf()} secili={null} onSec={onSec} />);
    expect(screen.queryByRole("button", { name: "Liman (ithalat)" })).toBeNull();
    rerender(<HaritaTablosu sahne={sahneOf()} secili={null} onSec={onSec} kurumlar />);
    fireEvent.click(screen.getByRole("button", { name: "Liman (ithalat)" }));
    expect(onSec).toHaveBeenLastCalledWith({ kind: "kurum", ref: "liman" });
    fireEvent.click(screen.getByRole("button", { name: "İhracat" }));
    expect(onSec).toHaveBeenLastCalledWith({ kind: "kurum", ref: "ihracat" });
  });
});
