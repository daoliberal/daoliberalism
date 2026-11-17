import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHash, toHash, useHashRoute } from "@/oyun/hooks/useHashRoute";

beforeEach(() => {
  window.history.replaceState(null, "", "/oyun/");
});
afterEach(() => {
  window.history.replaceState(null, "", "/oyun/");
});

describe("parseHash", () => {
  it("baslangic_varsayilan", () => {
    expect(parseHash("")).toEqual({ name: "baslangic" });
    expect(parseHash("#/")).toEqual({ name: "baslangic" });
    expect(parseHash("#/canli/")).toEqual({ name: "baslangic" });
    expect(parseHash("#/bilinmeyen/x")).toEqual({ name: "baslangic" });
  });
  it("parseHash_all_routes", () => {
    expect(parseHash("#/kurucu")).toEqual({ name: "kurucu" });
    expect(parseHash("#/kurucu/3")).toEqual({ name: "kurucu", adim: "3" });
    expect(parseHash("#/kurucu/2/uzman")).toEqual({ name: "kurucu", adim: "2", uzman: true });
    expect(parseHash("#/kurucu/rehberli/2/uzman")).toEqual({ name: "kurucu", rehberli: true, adim: "2" });
    expect(parseHash("#/kurucu/2/baska")).toEqual({ name: "kurucu", adim: "2" });
    expect(parseHash("#/kurucu/rehberli")).toEqual({ name: "kurucu", rehberli: true });
    expect(parseHash("#/kurucu/rehberli/2")).toEqual({ name: "kurucu", rehberli: true, adim: "2" });
    expect(parseHash("#/canli/abc/dunya")).toEqual({ name: "canli", runId: "abc", view: "dunya" });
    expect(parseHash("#/canli/abc/sehir-3")).toEqual({ name: "canli", runId: "abc", view: "sehir-3" });
    expect(parseHash("#/canli/abc/zincir")).toEqual({ name: "canli", runId: "abc", view: "zincir" });
    expect(parseHash("#/canli/abc/sehir-9")).toEqual({ name: "canli", runId: "abc/sehir-9" });
    expect(parseHash("#/sonuc/abc")).toEqual({ name: "sonuc", runId: "abc" });
    expect(parseHash("#/sonuc/")).toEqual({ name: "baslangic" });
    expect(parseHash("#/kosular")).toEqual({ name: "kosular" });
  });
  it("dao_rotalari", () => {
    expect(parseHash("#/dao")).toEqual({ name: "dao" });
    expect(parseHash("#/dao/canli-1a2b")).toEqual({ name: "dao", runId: "canli-1a2b" });
    expect(parseHash("#/dao/d/K7M2QXA")).toEqual({ name: "dao", dunya: "K7M2QXA" });
    // boş dünya kodu ve sondaki eğik çizgi giriş ekranıdır; "d" koşu kimliği sayılmaz
    for (const h of ["#/dao/d/", "#/dao/d", "#/dao/"]) expect(parseHash(h)).toEqual({ name: "dao" });
    for (const h of ["#/dao", "#/dao/canli-1a2b", "#/dao/d/K7M2QXA"]) expect(toHash(parseHash(h))).toBe(h);
  });
  it("toHash_roundtrip", () => {
    for (const r of [
      { name: "baslangic" }, { name: "kurucu" }, { name: "kurucu", adim: "2" }, { name: "kurucu", adim: "2", uzman: true }, { name: "kurucu", rehberli: true }, { name: "kurucu", rehberli: true, adim: "1" },
      { name: "canli", runId: "canli-ab12" }, { name: "canli", runId: "x%20y", view: "zincir" }, { name: "sonuc", runId: "abc" }, { name: "kosular" },
      { name: "dao" }, { name: "dao", runId: "canli-1a2b" }, { name: "dao", dunya: "K7M2QXA" },
    ] as const) {
      expect(parseHash(toHash(r))).toEqual(r);
    }
    expect(toHash({ name: "baslangic" })).toBe("#/");
  });
  it("old_live_links_work", () => {
    expect(parseHash("#/canli/canli-0a1b")).toEqual({ name: "canli", runId: "canli-0a1b" });
  });
  it("canli_tarif", () => {
    expect(parseHash("#/canli/abc")).toEqual({ name: "canli", runId: "abc" });
    expect(parseHash("#/canli/kapali.2~x%20y")).toEqual({ name: "canli", runId: "kapali.2~x%20y" });
  });
});

describe("useHashRoute", () => {
  it("go_hash_yazar_ve_hashchange_ile_haber_verir", async () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toEqual({ name: "baslangic" });
    const listener = vi.fn();
    window.addEventListener("hashchange", listener);
    act(() => result.current.go({ name: "canli", runId: "abc" }));
    await waitFor(() => expect(result.current.route).toEqual({ name: "canli", runId: "abc" }));
    expect(window.location.hash).toBe("#/canli/abc");
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("hashchange", listener);
  });

  it("replace_bildirimsiz", async () => {
    const { result } = renderHook(() => useHashRoute());
    const listener = vi.fn();
    window.addEventListener("hashchange", listener);
    const before = window.history.length;
    act(() => result.current.replace({ name: "canli", runId: "x" }));
    expect(window.location.hash).toBe("#/canli/x");
    expect(result.current.route).toEqual({ name: "canli", runId: "x" });
    expect(window.history.length).toBe(before);
    await new Promise((r) => setTimeout(r, 30));
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("hashchange", listener);
  });
});
