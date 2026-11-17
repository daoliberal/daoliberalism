import fs from "node:fs";
import path from "node:path";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spriteHatasiYaz } from "@/oyun/harita/gorunumDurumu";
import * as izoModul from "@/oyun/harita/izoSahne";
import type { IzoSahne } from "@/oyun/harita/izoSahne";
import type { HaritaRef, SehirSahnesi } from "@/oyun/harita/tipler";
import { manifestOnbelleginiSifirla } from "@/oyun/harita/useSpriteManifest";
import type { SimEvent, WeekPacket } from "@/oyun/sim/types";
import { mountCanli, state, week } from "../helpers/canliMount";
import { haritaOf } from "../helpers/fakeLiveServer";
import { packet } from "../helpers/sehirZincirVeri";

type TuvalProps = { sahne: SehirSahnesi; tabloSahnesi: SehirSahnesi; secili: HaritaRef | null; onSec(r: HaritaRef | null): void; onSpriteHatasi?(): void };
const tuval = vi.hoisted(() => ({ son: null as unknown as TuvalProps }));
vi.mock("@/oyun/harita/SehirTuvaliKap", () => ({
  SehirTuvaliKap: (p: TuvalProps) => {
    tuval.son = p;
    return <div data-testid="tuval" />;
  },
}));
vi.mock("@/oyun/harita/useWebgl", () => ({ useWebgl: () => true }));
vi.mock("@/oyun/harita/izoSahne", async (orig) => {
  const m = await orig<typeof import("@/oyun/harita/izoSahne")>();
  return { ...m, izoSahneKur: vi.fn(m.izoSahneKur) };
});
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const HAM = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/oyun-sprite/manifest.json"), "utf8")) as unknown;
const izoKur = vi.mocked(izoModul.izoSahneKur);
const hafta = (w: number): SimEvent => week({ ...packet(w), harita: haritaOf(w) } as unknown as WeekPacket);
const script = (): SimEvent[] => [state({ week: 2 }), hafta(1), hafta(2)];
const izoMu = (): boolean => tuval.son !== null && "kaynak" in (tuval.son.sahne as object);
const izoSahne = (): IzoSahne => tuval.son.sahne as unknown as IzoSahne;

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
  manifestOnbelleginiSifirla();
  tuval.son = null as never; // önceki testin bayat özellikleri
  izoKur.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("manifest.json") ? { ok: true, json: async () => HAM } : { ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  spriteHatasiYaz(false); // modül düzeyi bayrak son abone ayrılınca sıfırlanmaz: testler arası sızmasın
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Canlı: görünüm modu ve etkin sahne (izometrik)", () => {
  it("varsayilan_izo_tercih_ya_da_bayrak_yokken", async () => {
    mountCanli(script());
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    expect(izoKur).toHaveBeenCalled();
  });

  it("acik_klasik_izoSahneKur_cagrilmaz", async () => {
    window.history.replaceState(null, "", "/?gorunum=klasik");
    mountCanli(script());
    await screen.findByTestId("tuval");
    await vi.waitFor(() => expect(tuval.son.sahne.binalar.length).toBeGreaterThan(0));
    expect(izoMu()).toBe(false);
    expect(izoKur).not.toHaveBeenCalled();
    expect(tuval.son.onSpriteHatasi).toBeTypeOf("function");
  });

  it("izo_modunda_etkin_sahne_izoSahneKur_ile_usememoda_kurulur", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    mountCanli(script());
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    expect(izoKur.mock.calls.length).toBeGreaterThan(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); }); // kare sınırı otursun
    const n = izoKur.mock.calls.length;
    const once = tuval.son.sahne;
    act(() => tuval.son.onSec({ kind: "city", ref: "0" }));
    expect(izoKur.mock.calls.length).toBe(n);
    expect(tuval.son.sahne).toBe(once);
  });

  it("SehirTuvaliKap_manifest_ya_da_gorselBoy_almaz_ve_tablo_klasik", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    mountCanli(script());
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    expect(Object.keys(tuval.son)).not.toContain("manifest");
    expect(Object.keys(tuval.son)).not.toContain("gorselBoy");
    expect("kaynak" in tuval.son.tabloSahnesi).toBe(false);
    expect(tuval.son.tabloSahnesi.kademe).toBeUndefined();
  });

  it("izo_klasik_dususte_etkin_sahne_yeniden_kurulur_ve_secim_etkin_sahneden", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    mountCanli(script());
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    const isletme = izoSahne().binalar.find((b) => b.tur === "isletme")!;
    act(() => tuval.son.onSec(isletme.ref));
    expect(tuval.son.secili).toEqual(isletme.ref);
    expect(screen.getAllByRole("complementary").length).toBeGreaterThan(0); // sağ panel açık (etkin sahnenin kaynağından başlık)
    act(() => tuval.son.onSpriteHatasi!());
    await vi.waitFor(() => expect(izoMu()).toBe(false));
    expect(tuval.son.sahne.kademe).toBeUndefined();
    expect(tuval.son.secili).toEqual(isletme.ref); // firma seçimi iki yerleşimde de geçerlidir
  });

  it("izo_sehir_kurumlari_sahnede_secilince_sag_panel_kurum_basligi_ve_veri_yok_notu", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    mountCanli(script());
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    const liman = izoSahne().binalar.find((b) => b.tur === "liman")!;
    const ihracat = izoSahne().binalar.find((b) => b.tur === "ihracat")!;
    expect(liman.sprite.ad).toBe("liman");
    expect(ihracat.sprite.ad).toBe("gumruk");
    act(() => tuval.son.onSec(liman.ref));
    await vi.waitFor(() => expect(document.querySelector('[data-baglam="kurum"][data-kurum="liman"]')).not.toBeNull());
    expect(screen.getByRole("heading", { name: "Liman (ithalat)" })).toBeInTheDocument();
    act(() => tuval.son.onSec(ihracat.ref));
    await vi.waitFor(() => expect(document.querySelector('[data-baglam="kurum"][data-kurum="ihracat"]')).not.toBeNull());
    expect(screen.getByRole("heading", { name: "İhracat" })).toBeInTheDocument();
  });
});
