import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { OyuncuDilimleri } from "@/oyun/screens/canli/OyuncuDilimleri";
import type { EkonomiBlogu, WeekPacket } from "@/oyun/sim/types";
import { packet } from "../helpers/sehirZincirVeri";

afterEach(() => cleanup());

const para = (over: Partial<NonNullable<EkonomiBlogu["para"]>> = {}): EkonomiBlogu["para"] => ({
  oyuncu_n: 4, oyuncu_ust10: 9000, oyuncu_alt90: 3000, npc_hane_nakit: 120000, npc_hane_mevduat: 80000, ...over,
});
const paket = (p: EkonomiBlogu["para"] | undefined): WeekPacket => ({
  ...packet(1),
  ...(p === undefined ? {} : { ekonomi: { tuketim: { hane: { ise: { n: 1, karsilanma: 1, sepet: 1 }, issiz: { n: 1, karsilanma: 1, sepet: 1 }, npc: null, npc_issiz_parasiz: null, sehir: [] }, harcama: null, urunler: null }, isletme: { istihdam: { oyuncu: null, npc: null, ozel: null, kamu: null }, hareket: null, sektor: [], sektor_diger: null, sehir: [] }, para: p } }),
});
const d = (id: string) => (document.querySelector(`[data-dilim="${id}"]`) as HTMLElement).textContent!;

describe("M10 Oyuncu servet dilimleri", () => {
  it("test_ust10_alt90_ve_npc_hane_degerleri", () => {
    render(<OyuncuDilimleri cur={paket(para())} />);
    expect(screen.getByRole("region", { name: t("dilim.baslik") })).toBeInTheDocument();
    expect(d("ust10")).toContain("9.000");
    expect(d("ust10")).toContain("%75");
    expect(d("alt90")).toContain("3.000");
    expect(d("npc_nakit")).toContain("120.000");
    expect(d("npc_mevduat")).toContain("80.000");
    expect(screen.getByText(t("dilim.not"))).toBeInTheDocument();
  });

  it("test_oyuncu_yoksa_sifir_degil_olculmuyor", () => {
    render(<OyuncuDilimleri cur={paket(para({ oyuncu_n: 0, oyuncu_ust10: 0, oyuncu_alt90: 0 }))} />);
    expect(d("ust10")).toContain(t("canli.gosterge.olculmuyor"));
    expect(d("alt90")).toContain(t("canli.gosterge.olculmuyor"));
    expect(d("npc_nakit")).toContain("120.000");
    expect(screen.getByText(t("dilim.olculmuyor"))).toBeInTheDocument();
  });

  it("test_blok_yok_bolum_gizli", () => {
    const { container, rerender } = render(<OyuncuDilimleri cur={paket(undefined)} />);
    expect(container.innerHTML).toBe("");
    rerender(<OyuncuDilimleri cur={paket(null)} />);
    expect(container.innerHTML).toBe("");
    rerender(<OyuncuDilimleri cur={null} />);
    expect(container.innerHTML).toBe("");
  });
});
