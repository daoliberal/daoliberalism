import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnizlemeSeridi } from "@/oyun/OnizlemeSeridi";

const TAM = "Önizleme: kayıtlı örnek koşular oynatılıyor; canlı oyun yakında.";
const KISA = "Önizleme · kayıtlı koşular";

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OnizlemeSeridi (sabit rozet)", () => {
  it("bayrak_acikken_kisa_metin_gorunur_tam_metin_erisilebilir", () => {
    vi.stubEnv("NEXT_PUBLIC_ONIZLEME", "1");
    render(<OnizlemeSeridi />);
    const r = screen.getByRole("status");
    expect(r.textContent).toContain(KISA);
    expect(r.textContent).toContain(TAM);
    expect(r.querySelector("[style]")).toBeNull();
  });

  it.each(["", "0", undefined as unknown as string])("bayrak_%s_iken_hicbir_sey_cizmez", (v) => {
    vi.stubEnv("NEXT_PUBLIC_ONIZLEME", v);
    const { container } = render(<OnizlemeSeridi />);
    expect(container.innerHTML).toBe("");
  });

  it("kapat_dugmesi_rozeti_kaldirir_ve_oturuma_yazar", () => {
    vi.stubEnv("NEXT_PUBLIC_ONIZLEME", "1");
    render(<OnizlemeSeridi />);
    fireEvent.click(screen.getByRole("button", { name: "Önizleme bildirimini kapat" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.sessionStorage.length).toBe(1);
  });

  it("kapatilmis_oturumda_yeniden_cizilmez", () => {
    vi.stubEnv("NEXT_PUBLIC_ONIZLEME", "1");
    const a = render(<OnizlemeSeridi />);
    fireEvent.click(screen.getByRole("button", { name: "Önizleme bildirimini kapat" }));
    a.unmount();
    render(<OnizlemeSeridi />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sessionStorage_hata_verse_de_calisir", () => {
    vi.stubEnv("NEXT_PUBLIC_ONIZLEME", "1");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("yok"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("yok"); });
    render(<OnizlemeSeridi />);
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Önizleme bildirimini kapat" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
