import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnimasyonTercihi, useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";

type Dinleyici = (e: { matches: boolean }) => void;
const mq = new Map<string, { matches: boolean; fns: Dinleyici[] }>();
function sahteMatchMedia(q: string) {
  const m = mq.get(q) ?? { matches: false, fns: [] };
  mq.set(q, m);
  return {
    get matches() { return m.matches; },
    media: q,
    addEventListener: (_: string, f: Dinleyici) => void m.fns.push(f),
    removeEventListener: (_: string, f: Dinleyici) => void (m.fns = m.fns.filter((x) => x !== f)),
  };
}
const degistir = (q: string, matches: boolean) => {
  const m = mq.get(q)!;
  m.matches = matches;
  for (const f of [...m.fns]) f({ matches });
};
const NARROW = "(max-width: 720px)";
const REDUCE = "(prefers-reduced-motion:reduce)";

beforeEach(() => {
  mq.clear();
  localStorage.clear();
  vi.stubGlobal("matchMedia", sahteMatchMedia);
  document.documentElement.dataset.theme = "light";
  delete document.documentElement.dataset.hareket;
});
afterEach(() => vi.unstubAllGlobals());

describe("useOyunTercihleri", () => {
  it("theme_toggle_writes_data_theme_and_persists", async () => {
    const { result } = renderHook(() => useOyunTercihleri());
    expect(result.current.tema).toBe("light");
    act(() => result.current.toggleTema());
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(result.current.tema).toBe("dark"));
    expect(localStorage.getItem("oyun.tema")).toBe("dark");
  });

  it("theme_toggle_survives_throwing_localStorage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("kota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("erişim yok");
    });
    const { result } = renderHook(() => useOyunTercihleri());
    expect(() => act(() => result.current.toggleTema())).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(() => act(() => result.current.toggleAzalt())).not.toThrow();
    expect(result.current.azalt).toBe(true); // depolama olmasa da oturumda çalışır
    act(() => result.current.toggleAzalt());
    vi.restoreAllMocks();
  });

  it("theme_pref_reapplied_after_breakpoint", () => {
    localStorage.setItem("oyun.tema", "light");
    // site kancası (useIsNarrow) önce kaydolur ve eşik geçişinde temayı kendi kuralıyla yazar
    sahteMatchMedia(NARROW);
    mq.get(NARROW)!.fns.push((e) => {
      document.documentElement.dataset.theme = e.matches ? "dark" : "light";
    });
    renderHook(() => useOyunTercihleri());
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => degistir(NARROW, true)); // site koyu yazar, tercih (açık) sonradan yeniden uygulanır
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("reduce_motion_toggle_sets_attribute_and_respects_media", async () => {
    const { result } = renderHook(() => useOyunTercihleri());
    expect(result.current.azalt).toBe(false);
    expect(result.current.etkinAzalt).toBe(false);
    act(() => result.current.toggleAzalt());
    await waitFor(() => expect(result.current.azalt).toBe(true));
    expect(result.current.etkinAzalt).toBe(true);
    expect(localStorage.getItem("oyun.hareket")).toBe("azalt");
    act(() => result.current.toggleAzalt());
    await waitFor(() => expect(result.current.etkinAzalt).toBe(false));
    // sistem tercihi: kullanıcı düğmesi kapalı olsa da hareket azalır
    sahteMatchMedia(REDUCE);
    act(() => degistir(REDUCE, true));
    await waitFor(() => expect(result.current.etkinAzalt).toBe(true));
    expect(result.current.azalt).toBe(false);
  });

  it("dusuk_performans_anahtari_kalici_ve_animasyon_tercihine_yansir", async () => {
    const { result } = renderHook(() => useOyunTercihleri());
    expect(result.current.dusukPerformans).toBe(false);
    act(() => result.current.toggleDusukPerformans());
    await waitFor(() => expect(result.current.dusukPerformans).toBe(true));
    expect(localStorage.getItem("oyun.dusukPerformans")).toBe("1");
    const { result: a } = renderHook(() => useAnimasyonTercihi());
    expect(a.current).toEqual({ etkinAzalt: false, dusukPerformans: true });
    act(() => result.current.toggleDusukPerformans());
    await waitFor(() => expect(result.current.dusukPerformans).toBe(false));
    expect(localStorage.getItem("oyun.dusukPerformans")).toBe("0");
  });
  it("gorunum_tercihi_saklanir", async () => {
    const { result } = renderHook(() => useOyunTercihleri());
    expect(result.current.gorunum).toBeNull();                  // belirtilmemiş: null (varsayılanı Görev 16 çevirir)
    act(() => result.current.setGorunum("izo"));
    await waitFor(() => expect(result.current.gorunum).toBe("izo"));
    expect(localStorage.getItem("oyun.gorunum")).toBe("izo");
    act(() => result.current.setGorunum("klasik"));
    await waitFor(() => expect(result.current.gorunum).toBe("klasik"));
    expect(localStorage.getItem("oyun.gorunum")).toBe("klasik");
    const yeniden = renderHook(() => useOyunTercihleri());
    expect(yeniden.result.current.gorunum).toBe("klasik");      // yenilemede korunur
  });

  it("gorunum_tercihi_gecersiz_deger_null_ve_depolama_kapaliyken_oturumda_calisir", () => {
    localStorage.setItem("oyun.gorunum", "baska");
    const a = renderHook(() => useOyunTercihleri());
    expect(a.result.current.gorunum).toBeNull();
    a.unmount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("kota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("erişim yok"); });
    const { result } = renderHook(() => useOyunTercihleri());
    expect(() => act(() => result.current.setGorunum("izo"))).not.toThrow();
    expect(result.current.gorunum).toBe("izo");
    vi.restoreAllMocks();
  });
});
