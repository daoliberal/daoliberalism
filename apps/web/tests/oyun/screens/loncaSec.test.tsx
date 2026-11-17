import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoncaSecEylemi, type KararDurumu } from "@/oyun/screens/dao/DaoKararlar";
import type { DaoGozlem } from "@/oyun/sim/dao";
import { GOZLEM_KURUCU } from "../helpers/daoVeri";

afterEach(cleanup);

const durum = (gonder = vi.fn(async () => true), ek: Partial<KararDurumu> = {}): KararDurumu => ({ gonder, mesgul: false, kapali: false, kabul: null, ret: null, sirada: null, ...ek }) as KararDurumu;

const gozlem = (degisebilir: boolean): DaoGozlem => ({
  ...GOZLEM_KURUCU,
  firmam: { ...GOZLEM_KURUCU.firmam!, lonca: "lonca0", lonca_degisebilir: degisebilir },
  loncalar: [
    { ad: "lonca0", mevduat_faizi: 0.001, kapali: false, mevduat: 100, pay_orani: 0.02, kredi_verebilir: true, skor: 0.05 },
    { ad: "lonca1", mevduat_faizi: 0.001, kapali: false, mevduat: 100, pay_orani: 0.03, kredi_verebilir: false, skor: 0.09 },
    { ad: "lonca2", mevduat_faizi: 0.001, kapali: false, mevduat: 100, pay_orani: 0.01, kredi_verebilir: true, skor: 0.02 },
    { ad: "lonca3", mevduat_faizi: 0.001, kapali: true, mevduat: 0, pay_orani: 0.01, kredi_verebilir: false, skor: null },
    { ad: "lonca4", mevduat_faizi: 0.001, kapali: false, mevduat: 100, pay_orani: 0.04, kredi_verebilir: true, skor: 0.07 },
  ],
});

describe("LoncaSecEylemi", () => {
  it("dugme_yalniz_lonca_degisebilir_iken_etkin", () => {
    render(<LoncaSecEylemi g={gozlem(true)} k={durum()} />);
    expect(screen.getByRole("button", { name: "Loncayı değiştir" })).toBeEnabled();
    cleanup();
    render(<LoncaSecEylemi g={gozlem(false)} k={durum()} />);
    expect(screen.getByRole("button", { name: "Loncayı değiştir" })).toBeDisabled();
  });

  it("erken_iken_kalan_hafta_yazilir_bekleme_metni_degil", () => {
    const g = gozlem(false);
    render(<LoncaSecEylemi g={{ ...g, firmam: { ...g.firmam!, lonca_erken_hafta: 22 } }} k={durum()} />);
    expect(screen.getByText(/22 hafta sonra değiştirebilirsin/)).toBeInTheDocument();
    expect(screen.queryByText(/bekleme süresi dolmadı/)).toBeNull();
    expect(screen.getByRole("button", { name: "Loncayı değiştir" })).toBeDisabled();
    cleanup();
    render(<LoncaSecEylemi g={{ ...g, firmam: { ...g.firmam!, lonca_erken_hafta: 0 } }} k={durum()} />);
    expect(screen.getByText(/bekleme süresi dolmadı/)).toBeInTheDocument();
  });

  it("liste_skora_gore_siralidir_mevcut_ve_kapali_lonca_yok", () => {
    render(<LoncaSecEylemi g={gozlem(true)} k={durum()} />);
    const secenekler = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(secenekler).toEqual(["lonca2", "lonca4", "lonca1"]);
  });

  it("gonderilen_karar_biciminde_varsayilan_en_dusuk_skor", () => {
    const gonder = vi.fn(async () => true);
    render(<LoncaSecEylemi g={gozlem(true)} k={durum(gonder)} />);
    fireEvent.click(screen.getByRole("button", { name: "Loncayı değiştir" }));
    expect(gonder).toHaveBeenCalledWith({ tur: "lonca_sec", lonca: "lonca2" });
  });

  it("secilen_lonca_gonderilir", () => {
    const gonder = vi.fn(async () => true);
    render(<LoncaSecEylemi g={gozlem(true)} k={durum(gonder)} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lonca4" } });
    fireEvent.click(screen.getByRole("button", { name: "Loncayı değiştir" }));
    expect(gonder).toHaveBeenCalledWith({ tur: "lonca_sec", lonca: "lonca4" });
  });

  it("sirada_kararda_dugme_kapali", () => {
    render(<LoncaSecEylemi g={gozlem(true)} k={durum(undefined, { sirada: { tur: "lonca_sec", hafta: 9 } })} />);
    expect(screen.getByRole("button", { name: "Loncayı değiştir" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("9");
  });

  it("eski_sunucuda_lonca_alani_yoksa_gorunmez", () => {
    const { container } = render(<LoncaSecEylemi g={GOZLEM_KURUCU} k={durum()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
