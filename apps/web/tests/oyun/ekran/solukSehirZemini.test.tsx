import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GirisBinalariBaglami, ZEMIN_BINALARI } from "@/oyun/ekran/girisBinalari";
import { SolukSehirZemini } from "@/oyun/ekran/SolukSehirZemini";
import { binaAnahtari } from "@/oyun/ekran/useBinaResimleri";

afterEach(cleanup);

describe("SolukSehirZemini", () => {
  it("dekoratif_ve_etkilesimsiz_resimler_bos_alt_metinli", () => {
    const resimler = Object.fromEntries(ZEMIN_BINALARI.map(([s, b]) => [binaAnahtari(s, b), `blob:${s}-${b}`]));
    render(
      <GirisBinalariBaglami.Provider value={resimler}>
        <SolukSehirZemini />
      </GirisBinalariBaglami.Provider>,
    );
    const zemin = screen.getByTestId("soluk-sehir-zemini");
    expect(zemin).toHaveAttribute("aria-hidden", "true");
    expect(zemin.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
    const img = Array.from(zemin.querySelectorAll("img"));
    expect(img.length).toBeGreaterThan(20);
    for (const i of img) expect(i.getAttribute("alt")).toBe("");
    // Birden çok farklı bina kullanılır (tek tip döşeme değil).
    expect(new Set(img.map((i) => i.getAttribute("src"))).size).toBeGreaterThan(4);
  });

  it("resimler_gelmemisse_bos_dosemelerle_bozulmadan_cizilir", () => {
    render(<SolukSehirZemini />);
    const zemin = screen.getByTestId("soluk-sehir-zemini");
    expect(zemin.querySelectorAll("img")).toHaveLength(0);
    expect(zemin).toHaveAttribute("aria-hidden", "true");
  });
});
