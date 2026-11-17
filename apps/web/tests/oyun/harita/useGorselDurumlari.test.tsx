import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Gecis } from "@/oyun/harita/izoDurum";
import type { HaritaDurumu, HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import { useGorselDurumlari } from "@/oyun/harita/useGorselDurumlari";

const satir = (id: string, durum: HaritaDurumu = "uretim", dogum: number | null = null): HaritaFirmaSatiri => [id, "market", 0, 5, null, "npc", dogum, durum];
const harita: HaritaVerisi = { hafta: 30, firmalar: [satir("a"), satir("b", "kapali"), satir("c", "uretim", 29), satir("d")] };

describe("useGorselDurumlari", () => {
  it("harita_yoksa_undefined", () => {
    const { result } = renderHook(() => useGorselDurumlari(null, { gecisler: [], ilkGorulme: new Map() }));
    expect(result.current).toBeUndefined();
  });
  it("canlandi_yalniz_bu_haftanin_canlanma_gecisinde_kuruluyor_ilk_gorulmeden", () => {
    const gecisler: Gecis[] = [{ id: "a", hafta: 30, tur: "canlandi" }, { id: "d", hafta: 20, tur: "canlandi" }];
    const { result } = renderHook(() => useGorselDurumlari(harita, { gecisler, ilkGorulme: new Map([["d", 28]]) }));
    expect(result.current!.get("a")).toBe("canlandi");
    expect(result.current!.get("b")).toBe("kapali");
    expect(result.current!.get("c")).toBe("kuruluyor");
    expect(result.current!.get("d")).toBe("kuruluyor"); // eski haftanın canlanması sayılmaz; ilk görülme 28
  });
});
