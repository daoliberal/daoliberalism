import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SermayeEkleEylemi, type KararDurumu } from "@/oyun/screens/dao/DaoKararlar";

afterEach(cleanup);

const durum = (gonder = vi.fn(async () => true), kapali = false): KararDurumu => ({ gonder, mesgul: false, kapali, kabul: null, ret: null, sirada: null }) as KararDurumu;

describe("SermayeEkleEylemi", () => {
  it("miktar girilince sermaye_ekle kararini gonderir", () => {
    const gonder = vi.fn(async () => true);
    render(<SermayeEkleEylemi k={durum(gonder)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Sermaye ekle" }));
    expect(gonder).toHaveBeenCalledWith({ tur: "sermaye_ekle", miktar: 250 });
  });
  it("bos ya da gecersiz miktarda dugme kapali", () => {
    render(<SermayeEkleEylemi k={durum()} />);
    expect(screen.getByRole("button", { name: "Sermaye ekle" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "-5" } });
    expect(screen.getByRole("button", { name: "Sermaye ekle" })).toBeDisabled();
  });
});
