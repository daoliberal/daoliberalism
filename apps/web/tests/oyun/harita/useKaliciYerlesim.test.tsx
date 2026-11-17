import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useKaliciYerlesim, useOyuncuParseli } from "@/oyun/harita/useKaliciYerlesim";

beforeEach(() => localStorage.clear());

describe("useKaliciYerlesim", () => {
  it("kaydedilen_tablo_sonraki_kurulumda_ve_yenilemede_geri_okunur", () => {
    const a = renderHook(() => useKaliciYerlesim("r", "izo", 0));
    expect(a.result.current.onceki()).toBeNull();
    const t = new Map([["f1", "p0_0"]]);
    act(() => a.result.current.kaydet(t));
    expect(a.result.current.onceki()).toBe(t);
    const yenileme = renderHook(() => useKaliciYerlesim("r", "izo", 0));
    expect(yenileme.result.current.onceki()).toEqual(t);
    // izo ve klasik ayrı tablolar
    expect(renderHook(() => useKaliciYerlesim("r", "klasik", 0)).result.current.onceki()).toBeNull();
    expect(renderHook(() => useKaliciYerlesim("r", "izo", 1)).result.current.onceki()).toBeNull();
  });
});

describe("useOyuncuParseli", () => {
  it("kur_kabul_edilir_kurucu_firma_gorununce_parsele_baglanir_ve_yenilemede_kalir", () => {
    const { result, rerender } = renderHook(({ f }: { f: string | null }) => useOyuncuParseli("r", f), { initialProps: { f: null as string | null } });
    act(() => result.current.kurIstendi("p2_2", "izo", "market"));
    expect(result.current.sabitlemeler.izo.size).toBe(0);
    rerender({ f: "fy" });
    expect(result.current.sabitlemeler.izo.get("fy")).toBe("p2_2");
    expect(result.current.sabitlemeler.klasik.size).toBe(0);
    const yenileme = renderHook(() => useOyuncuParseli("r", "fy"));
    expect(yenileme.result.current.sabitlemeler.izo.get("fy")).toBe("p2_2");
  });
});
