import { afterEach, describe, expect, it, vi } from "vitest";

/** B8: merkezi yetenek listesi. Tarayici kipi (derleme bayragi) sunucuya bagli ekranlari gizler; sunucu ve bayraksiz (onizleme) derleme AYNI kalir. */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function yukle(bayrak: string | null): Promise<typeof import("@/oyun/yetenekler")> {
  if (bayrak !== null) vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", bayrak);
  vi.resetModules();
  return import("@/oyun/yetenekler");
}

describe("yetenekler", () => {
  it("tarayici_kipinde_sunucuya_bagli_ozellikler_kapali_yerel_kayit_acik", async () => {
    const { yetenekler } = await import("@/oyun/yetenekler");
    expect(yetenekler(true)).toEqual({
      isEkranlari: false,
      dunyaYayinla: false,
      paylasilanDunyalar: false,
      kayitBaglantilari: false,
      yerelKayit: true,
      cihazUyarisi: true,
    });
  });

  it("sunucu_ve_onizleme_kipinde_bugunku_arayuz_degismez_yerel_kayit_paneli_yok", async () => {
    const { yetenekler } = await import("@/oyun/yetenekler");
    expect(yetenekler(false)).toEqual({
      isEkranlari: true,
      dunyaYayinla: true,
      paylasilanDunyalar: true,
      kayitBaglantilari: true,
      yerelKayit: false,
      cihazUyarisi: false,
    });
  });

  it("YETENEKLER_derleme_bayragindan_okunur_bos_bayrak_sunucu_kipidir", async () => {
    expect((await yukle("tarayici")).YETENEKLER.isEkranlari).toBe(false);
    expect((await yukle("")).YETENEKLER.isEkranlari).toBe(true);
    expect((await yukle(null)).YETENEKLER.yerelKayit).toBe(false);
    expect((await yukle("baska")).TARAYICI).toBe(false);
  });
});
