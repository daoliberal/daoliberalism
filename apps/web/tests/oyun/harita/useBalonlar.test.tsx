import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Gecis } from "@/oyun/harita/izoDurum";
import { useBalonlar } from "@/oyun/harita/useBalonlar";
import type { DaoGozlem, DaoUnvan } from "@/oyun/sim/dao";
import type { SehirSahnesi } from "@/oyun/harita/tipler";

const kaynak = (): SehirSahnesi => ({ sehirBinasi: { id: "s" }, binalar: [{ id: "a" }], ahir: null, ben: { binaId: "a", neden: "isyeri" } }) as unknown as SehirSahnesi;
const goz = (unvan: DaoUnvan, hafta: number): DaoGozlem => ({ hafta, ben: { unvan } }) as unknown as DaoGozlem;
const GEC: readonly Gecis[] = [{ id: "a", tur: "kuruldu", hafta: 3 }];

describe("useBalonlar", () => {
  it("icerik_ayniysa_ayni_dizi_kimligi", () => {
    const { result, rerender } = renderHook((p: { g: DaoGozlem; k: SehirSahnesi }) => useBalonlar(GEC, undefined, p.g, p.k), { initialProps: { g: goz("cirak", 1), k: kaynak() } });
    const ilk = result.current;
    expect(ilk).toHaveLength(1);
    rerender({ g: goz("cirak", 2), k: kaynak() });
    expect(result.current).toBe(ilk);
  });
  it("kaynak_null_iken_gelen_terfi_kaybolmaz", () => {
    const { result, rerender } = renderHook((p: { g: DaoGozlem; k: SehirSahnesi | null }) => useBalonlar([], undefined, p.g, p.k), { initialProps: { g: goz("cirak", 1), k: null as SehirSahnesi | null } });
    rerender({ g: goz("kalfa", 2), k: null });
    rerender({ g: goz("kalfa", 2), k: kaynak() });
    expect(result.current.map((b) => b.metinAnahtari)).toEqual(["harita.balon.terfi"]);
  });
});
