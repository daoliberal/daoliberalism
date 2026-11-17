import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { DrawerData, SimSource } from "@/oyun/sim/types";
import { useCekmece } from "@/oyun/screens/canli/useCekmece";

const veri = (hafta: number): DrawerData => ({ kind: "urun", ref: "un", week: hafta, stale: false, title: "Un", fields: {} });
const kaynak = (f: (hafta: number) => Promise<DrawerData>): SimSource => ({ drawer: (_r: string, _k: string, _f: string, h: number) => f(h) } as unknown as SimSource);
const sar = (s: SimSource) => ({ children }: { children: ReactNode }) => <SimSourceProvider source={s}>{children}</SimSourceProvider>;

describe("useCekmece: ürün 404 = yok, hata değil", () => {
  it("urun_404_yok_durumu_son_basarili_yanit_tutulur", async () => {
    const s = kaynak(async (h) => { if (h > 3) throw new SimUnsupported("not_found"); return veri(h); });
    const { result, rerender } = renderHook(({ h }) => useCekmece("r", "urun", "un", h), { wrapper: sar(s), initialProps: { h: 3 } });
    await waitFor(() => expect(result.current.durum).toBe("hazir"));
    rerender({ h: 5 });
    await waitFor(() => expect(result.current.durum).toBe("yok"));
    expect(result.current.veri).toBeNull();
    expect(result.current.son?.week).toBe(3);
  });

  it("baska_tur_404_hata_kalir", async () => {
    const s = kaynak(async () => { throw new SimUnsupported("not_found"); });
    const { result } = renderHook(() => useCekmece("r", "firm", "x", 3), { wrapper: sar(s) });
    await waitFor(() => expect(result.current.durum).toBe("hata"));
  });

  it("urun_baska_hata_hata_kalir", async () => {
    const s = kaynak(async () => { throw new SimUnsupported("invalid_drawer"); });
    const { result } = renderHook(() => useCekmece("r", "urun", "un", 3), { wrapper: sar(s) });
    await waitFor(() => expect(result.current.durum).toBe("hata"));
  });
});

describe("Cekmece.tsx: ürün 404 = yok", () => {
  it("urun_404_hata_degil_yok_metni_baska_tur_hata", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { Cekmece } = await import("@/oyun/screens/canli/Cekmece");
    const { t } = await import("@/oyun/copy/t");
    const yok = kaynak(async () => { throw new SimUnsupported("not_found"); });
    const a = render(<SimSourceProvider source={yok}><Cekmece runId="r" hafta={3} kind="urun" refId="un" sehirAdlari={[]} onAc={() => {}} onKapat={() => {}} /></SimSourceProvider>);
    expect(await screen.findByText(t("tuketim.urun.yok_hafta"))).toBeTruthy();
    expect(screen.queryByText(t("cekmece.yuklenemedi"))).toBeNull();
    a.unmount();
    render(<SimSourceProvider source={yok}><Cekmece runId="r" hafta={3} kind="firm" refId="x" sehirAdlari={[]} onAc={() => {}} onKapat={() => {}} /></SimSourceProvider>);
    expect(await screen.findByText(t("cekmece.yuklenemedi"))).toBeTruthy();
  });
});
