import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { spriteHatasiYaz, useSpriteHatasi } from "@/oyun/harita/gorunumDurumu";
import { useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";

afterEach(() => {
  cleanup();
  spriteHatasiYaz(false);
  window.history.replaceState(null, "", "/");
});

describe("gorunumDurumu", () => {
  it("son_abone_ayrilinca_sprite_hatasi_bayragi_sifirlanmaz", () => {
    const a = renderHook(() => useSpriteHatasi());
    act(() => spriteHatasiYaz(true));
    expect(a.result.current).toBe(true);
    a.unmount();
    const b = renderHook(() => useSpriteHatasi());
    expect(b.result.current).toBe(true);
  });

  it("bayrak_yalniz_acik_setGorunum_izo_eyleminde_sifirlanir", () => {
    const a = renderHook(() => ({ hata: useSpriteHatasi(), tercih: useOyunTercihleri() }));
    act(() => spriteHatasiYaz(true));
    expect(a.result.current.hata).toBe(true);
    act(() => a.result.current.tercih.setGorunum("klasik"));
    expect(a.result.current.hata).toBe(true);
    act(() => a.result.current.tercih.setGorunum("izo"));
    expect(a.result.current.hata).toBe(false);
  });
});
