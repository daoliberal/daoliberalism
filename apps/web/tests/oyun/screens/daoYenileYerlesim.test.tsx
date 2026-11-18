import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spriteHatasiYaz } from "@/oyun/harita/gorunumDurumu";
import { manifestOnbelleginiSifirla } from "@/oyun/harita/useSpriteManifest";
import { tabloOku, tabloYaz } from "@/oyun/harita/yerlesimTablosu";
import { mountDao } from "../helpers/daoMount";

vi.mock("@/oyun/harita/SehirTuvaliKap", () => ({ SehirTuvaliKap: () => <div data-testid="tuval" /> }));
vi.mock("@/oyun/harita/useWebgl", () => ({ useWebgl: () => true }));
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.localStorage.clear();
  manifestOnbelleginiSifirla();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  spriteHatasiYaz(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("B10 Y-r2-1: DAO yenilemede kalici yerlesim (K9)", () => {
  it("hafta10_paketsiz_yenilemede_kayitli_yerlesim_tablosu_silinmez_ve_bos_tablo_yazilmaz", async () => {
    // Yenileme: durum hafta 10, hafta paketleri henuz yok (harita yok): sahne kurulmaz, kayitli tablo AYNEN kalir.
    for (const mod of ["klasik", "izo"]) for (let s = 0; s < 5; s++) tabloYaz(`r.${mod}.${s}`, new Map([["f7", "p1_1"], ["f9", "p2_3"], ["#kademe", "3"]]));
    window.history.replaceState(null, "", "/?gorunum=klasik");
    mountDao(null, { state: { week: 10, status: "running" } });
    await screen.findByText(/Hafta 10/);
    await new Promise((r) => setTimeout(r, 300));
    for (const mod of ["klasik", "izo"]) for (let s = 0; s < 5; s++) {
      const t = tabloOku(`r.${mod}.${s}`);
      expect(t?.get("f7"), `${mod} sehir ${s}`).toBe("p1_1");
      expect(t?.get("f9")).toBe("p2_3");
    }
  });
});
