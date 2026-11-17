import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { adlandirici } from "@/oyun/harita/adlar";
import type { SehirSahnesi } from "@/oyun/harita/tipler";
import { baglamBasligi, KurucuBaglam, type BaglamSecimi } from "@/oyun/screens/canli/KurucuBaglam";
import type { KurumSatiri, WeekPacket } from "@/oyun/sim/types";
import { packet } from "../helpers/sehirZincirVeri";

afterEach(cleanup);

const URUNLER = [["bugday", 0.4], ["un", 0.25], ["ekmek", 0.15], ["kumas", 0.1], ["giysi", 0.06]] as const;
const kurum = (sehir: number, ek: Partial<KurumSatiri> = {}): KurumSatiri => ({
  sehir, ithalat_hacim: 2010.4 + sehir, ihracat_hacim: 1500.2 + sehir, ithalat_urunler: URUNLER.map(([urun, pay]) => ({ urun, pay })), ...ek,
});
const cur = (kurumlar?: KurumSatiri[]): WeekPacket => ({ ...packet(3), ...(kurumlar ? { kurumlar } : {}) });
const secimOf = (ref: "liman" | "ihracat"): BaglamSecimi => ({ ref: { kind: "kurum", ref }, hafta: 3 });
const sahne = { binalar: [], ad: "Ada" } as unknown as SehirSahnesi;
const adlar = adlandirici();
const sektorAdi = (id: string): string => ({ tarla_bugday: "Buğday tarlası", un: "Un değirmeni", firin: "Fırın", tekstil: "Tekstil", giyim: "Giyim" })[id] ?? id;
const goster = (ref: "liman" | "ihracat", c: WeekPacket, sehir = 0) =>
  render(<KurucuBaglam runId="r" secim={secimOf(ref)} sahne={sahne} adlar={adlar} cur={c} sehir={sehir} sehirAdlari={["Ada", "Bay", "Cay", "Day", "Eda"]} sektorAdi={sektorAdi} />);
const alan = (id: string): string | null | undefined => document.querySelector(`[data-alan="${id}"] dd`)?.textContent;

describe("Şehir kurumu paneli (Liman, İhracat)", () => {
  it("baslik_liman_ithalat_ve_ihracat", () => {
    expect(baglamBasligi(secimOf("liman"), sahne, adlar)).toBe("Liman (ithalat)");
    expect(baglamBasligi(secimOf("ihracat"), sahne, adlar)).toBe("İhracat");
  });

  it("liman_haftalik_ithalat_hacmi_ilk_5_urun_ve_aciklama", () => {
    goster("liman", cur([kurum(0), kurum(1)]), 1);
    const p = document.querySelector('[data-baglam="kurum"]') as HTMLElement;
    expect(p.getAttribute("data-kurum")).toBe("liman");
    expect(alan("ithalat_hacim")).toBe(t("canli.gosterge.akce", { n: "2.011" }));          // 2011,4 (şehir 1): tam sayıya yuvarlanır
    const urunler = within(p).getAllByRole("listitem");
    expect(urunler).toHaveLength(5);
    expect(urunler[0]!.textContent).toContain("Buğday");
    expect(urunler[0]!.textContent).toContain("%40");
    expect(urunler[1]!.textContent).toContain("Un");
    expect(urunler[4]!.textContent).toContain("%6");
    expect(p.textContent).toContain(t("kurum.liman.not"));
    expect(p.textContent).not.toContain("1.501");                                          // ihracat hacmi limanda yazmaz
  });

  it("uretimi_bilinmeyen_urun_okunur_adla_yazilir", () => {
    goster("liman", cur([kurum(0, { ithalat_urunler: [{ urun: "gizli_mal", pay: 1 }] })]));
    expect(within(document.querySelector('[data-baglam="kurum"]') as HTMLElement).getAllByRole("listitem")[0]!.textContent).toContain("Gizli mal");
  });

  it("ithalat_yoksa_urun_listesi_yerine_not", () => {
    goster("liman", cur([kurum(0, { ithalat_hacim: 0, ithalat_urunler: [] })]));
    const p = document.querySelector('[data-baglam="kurum"]') as HTMLElement;
    expect(within(p).queryAllByRole("listitem")).toHaveLength(0);
    expect(p.textContent).toContain(t("kurum.liman.urun_yok"));
  });

  it("ihracat_haftalik_hacim_ve_aciklama_urun_listesi_yok", () => {
    goster("ihracat", cur([kurum(0)]));
    const p = document.querySelector('[data-baglam="kurum"]') as HTMLElement;
    expect(p.getAttribute("data-kurum")).toBe("ihracat");
    expect(alan("ihracat_hacim")).toBe(t("canli.gosterge.akce", { n: "1.500" }));
    expect(p.textContent).toContain(t("kurum.ihracat.not"));
    expect(within(p).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("kurum_verisi_yoksa_eski_sunucu_notu_uydurma_sayi_yok", () => {
    goster("liman", cur());
    const p = document.querySelector('[data-baglam="kurum"]') as HTMLElement;
    expect(p.textContent).toContain(t("kurum.veri_yok"));
    expect(alan("ithalat_hacim")).toBeUndefined();
    cleanup();
    goster("ihracat", cur([kurum(3)]), 0);                                                   // bu şehrin satırı yok
    expect(document.querySelector('[data-baglam="kurum"]')!.textContent).toContain(t("kurum.veri_yok"));
  });
});
