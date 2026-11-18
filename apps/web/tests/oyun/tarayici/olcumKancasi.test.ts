// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IsciMesaji } from "@/oyun/tarayici/protokol";

/** `OLCUM` derleme sabitidir (modul yuklenirken okunur): her durum icin modul sifirlanip yeniden ice aktarilir. */
async function yukle(bayrak: string | undefined): Promise<typeof import("@/oyun/tarayici/olcumKancasi")> {
  vi.resetModules();
  if (bayrak === undefined) vi.stubEnv("NEXT_PUBLIC_OYUN_OLCUM", "");
  else vi.stubEnv("NEXT_PUBLIC_OYUN_OLCUM", bayrak);
  return import("@/oyun/tarayici/olcumKancasi");
}

const g = globalThis as { __oyunOlcum?: unknown };

afterEach(() => {
  delete g.__oyunOlcum;
  vi.unstubAllEnvs();
});

describe("B9 olcum kancasi", () => {
  it("varsayilan kapali: hicbir kok kurulmaz, sarmalayicilar verileni AYNEN doner", async () => {
    const k = await yukle(undefined);
    expect(k.OLCUM).toBe(false);
    k.olcumTepe("yazimKuyrugu", 5);
    k.olcumKopru({});
    expect(g.__oyunOlcum).toBeUndefined();
    const bildir = vi.fn();
    expect(k.olcumBildirSar(bildir)).toBe(bildir);
    const modul = { loadPyodide: vi.fn() };
    expect(k.olcumPyodideSar(modul)).toBe(modul);
    expect(g.__oyunOlcum).toBeUndefined();
  });

  it("'0' ve baska degerler de kapali sayilir (yalniz '1' acar)", async () => {
    for (const v of ["0", "true", "yes"]) {
      const k = await yukle(v);
      expect(k.OLCUM).toBe(false);
      k.olcumTepe("a", 1);
      expect(g.__oyunOlcum).toBeUndefined();
    }
  });

  it("acik: tepe en buyugu tutar, kopru kok'e baglanir", async () => {
    const k = await yukle("1");
    expect(k.OLCUM).toBe(true);
    k.olcumTepe("yazimKuyrugu", 3);
    k.olcumTepe("yazimKuyrugu", 9);
    k.olcumTepe("yazimKuyrugu", 4);
    const kopru = { gonder: 1 };
    k.olcumKopru(kopru);
    expect(g.__oyunOlcum).toMatchObject({ tepe: { yazimKuyrugu: 9 }, kopru });
  });

  it("acik: Pyodide sarmalayicisi ornegi kok'e baglar, bellek() mallinfo + HEAP8 doner", async () => {
    const k = await yukle("1");
    const py = {
      _module: { HEAP8: { length: 4096 } },
      runPython: vi.fn<(kod: string) => string>(() => JSON.stringify({ yasayan: 100, arena: 120, bos: 20, gc_ms: 1.5 })),
    };
    const modul = { surum: "x", loadPyodide: vi.fn(async () => py) };
    const sarili = k.olcumPyodideSar(modul);
    expect(sarili).not.toBe(modul);
    expect(await sarili.loadPyodide()).toBe(py);
    const kok = g.__oyunOlcum as { py: unknown; bellek: () => Record<string, number>; gunluk: unknown[] };
    expect(kok.py).toBe(py);
    expect(kok.bellek()).toEqual({ yasayan: 100, arena: 120, bos: 20, gc_ms: 1.5, yigin: 4096 });
    expect(py.runPython.mock.calls[0]?.[0]).toContain("mallinfo");
    expect(py.runPython.mock.calls[0]?.[0]).toContain("gc.collect()");
    expect(kok.gunluk).toEqual([]);
  });

  it("acik: giden yanit kaydi (tick suresi, hafta olay boyutu, yigin); mesaj degismeden iletilir", async () => {
    const k = await yukle("1");
    const py = { _module: { HEAP8: { length: 777 } }, runPython: vi.fn() };
    await k.olcumPyodideSar({ loadPyodide: async () => py }).loadPyodide();
    const iletilen: IsciMesaji[] = [];
    const bildir = k.olcumBildirSar((m: IsciMesaji) => void iletilen.push(m));
    const veri = { week: 7, x: "abc" };
    const mesaj: IsciMesaji = { t: "yanit", id: 4, ok: true, s: { ms: 2500, olaylar: [{ abone: 1, kapandi: false, olaylar: [{ id: 1, event: "week", data: veri }, { id: 2, event: "state", data: {} }] }] } };
    bildir(mesaj);
    bildir({ t: "ilerleme", asama: "indirme", oran: 0.5 });
    expect(iletilen[0]).toBe(mesaj);
    expect(iletilen).toHaveLength(2);
    const gunluk = (g.__oyunOlcum as { gunluk: Record<string, unknown>[] }).gunluk;
    expect(gunluk).toHaveLength(2);
    expect(gunluk[0]).toMatchObject({ id: 4, tur: "yanit", yigin: 777, tickMs: 2500, haftalar: [{ hafta: 7, bayt: JSON.stringify(veri).length }] });
    expect(gunluk[1]).toMatchObject({ id: null, tur: "ilerleme" });
    expect(typeof gunluk[0]?.postMs).toBe("number");
  });
});
