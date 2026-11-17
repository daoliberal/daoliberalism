import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gecisler from "@/oyun/harita/useHaritaGecisleri";
import { ayrintilarHazir, mountCanli, packets, state } from "../helpers/canliMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));
vi.mock("@/oyun/harita/useHaritaGecisleri", async (orig) => {
  const gercek = await orig<typeof import("@/oyun/harita/useHaritaGecisleri")>();
  return { ...gercek, useHaritaGecisleri: vi.fn(gercek.useHaritaGecisleri) };
});

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
});

describe("klasik görünümde izo'ya özgü hesap", () => {
  it("klasik_modda_haritaGecisleri_hesabi_yapilmaz_harita_null_verilir", async () => {
    vi.mocked(gecisler.useHaritaGecisleri).mockClear();
    const haritali = packets(3).map((e) => (e.type === "week" ? { ...e, packet: { ...e.packet, harita: { hafta: e.packet.week, firmalar: [["f1", "market", 0, 5, null, "npc", null, "uretim"]] } } } : e)) as ReturnType<typeof packets>;
    mountCanli([state(), ...haritali]);
    await ayrintilarHazir("Genel");
    const cagrilar = vi.mocked(gecisler.useHaritaGecisleri).mock.calls;
    expect(cagrilar.length).toBeGreaterThan(0);
    expect(cagrilar.length).toBeGreaterThan(0);
    for (const [harita] of cagrilar) expect(harita).toBeNull();
  });
});
