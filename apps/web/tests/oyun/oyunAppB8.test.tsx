import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { KaynakSecenek } from "@/oyun/tarayici/kaynak";
import type { KayitHizmetleri } from "@/oyun/tarayici/hizmetler";
import { createFakeSource } from "./helpers/fakeSource";

/** B8: tarayici kipi arayuzu (OyunApp): durum rozeti, kayit bantlari, panel, hatirlatma, K1 bilgisi, cihaz uyarisi, surum yenileme bekleme ekrani. */
const h = vi.hoisted(() => ({ probe: vi.fn(), live: vi.fn(), replay: vi.fn(), kur: vi.fn(), worker: vi.fn() }));

vi.mock("@/oyun/sim/live", async (orig) => ({
  ...(await orig<typeof import("@/oyun/sim/live")>()),
  probeLive: (...a: unknown[]) => h.probe(...a) as unknown,
  createLiveSource: (...a: unknown[]) => h.live(...a) as unknown,
}));
vi.mock("@/oyun/sim/replay", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/replay")>()), createReplaySource: (...a: unknown[]) => h.replay(...a) as unknown }));
vi.mock("@/oyun/tarayici/kaynak", async (orig) => ({ ...(await orig<typeof import("@/oyun/tarayici/kaynak")>()), tarayiciKaynagiKur: (...a: unknown[]) => h.kur(...a) as unknown }));
vi.mock("@/oyun/tarayici/isciUret", () => ({ gercekWorkerUret: (...a: unknown[]) => h.worker(...a) as unknown }));

const fetchKoprusu = vi.fn();
const akisKoprusu = vi.fn();
const kapat = vi.fn(async () => undefined);

function sahteHizmetler(ek: Partial<KayitHizmetleri> = {}): KayitHizmetleri {
  return {
    dosyaSiniriMB: 64,
    depolama: vi.fn(async () => ({ olcum: { kullanim: 10 * 1024 * 1024, kota: 100 * 1024 * 1024, oran: 0.1 }, esik: 0.85, kotaUyarisi: false, kalicilik: { durum: "verildi" as const, onceden: false, zaman: 1 } })),
    kosular: vi.fn(async () => [{ kosuId: "canli-a1", ad: "Oyun A", hafta: 20, guncelleme: 1, kaynak: "yerel" as const, tur: "kurucu" as const, aktif: false, disaAktarilmayanHafta: 0 }]),
    disaAktar: vi.fn(async () => ({ ad: "d.json", metin: "{}" })),
    iceAktar: vi.fn(async () => ({ kosuId: "canli-yeni", hafta: 3, tur: "kurucu" as const })),
    sil: vi.fn(async () => undefined),
    ...ek,
  };
}

let secenek: KaynakSecenek;
function kurulum(ek: Record<string, unknown> = {}): void {
  h.kur.mockImplementation((o: KaynakSecenek) => {
    secenek = o;
    return Promise.resolve({ kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat, hizmetler: sahteHizmetler(), ...ek });
  });
}

beforeEach(() => {
  for (const f of [h.probe, h.live, h.replay, h.kur, h.worker, fetchKoprusu, akisKoprusu, kapat]) f.mockClear();
  h.probe.mockResolvedValue({ ok: true, hello: { serverVersion: "1", modelVersion: "1", defaultsHash: "x", secPerWeekP50: 4.2 } });
  h.live.mockImplementation(() => createFakeSource([], { kind: "live" }));
  h.replay.mockImplementation(() => createFakeSource([], { kind: "replay" }));
  vi.stubGlobal("indexedDB", { sahte: "idb" });
  window.history.replaceState(null, "", "/oyun");
  window.location.hash = "#/";
  window.localStorage.clear();
  kurulum();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function bayrakli(): Promise<typeof import("@/oyun/OyunApp")> {
  vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", "tarayici");
  vi.resetModules();
  return import("@/oyun/OyunApp");
}

describe("durum gostergeleri", () => {
  it("hesaplaniyor_rozeti_acilir_kapanir_ve_kayit_durumu_bantlari_gorunur", async () => {
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    await screen.findByText(t("baslangic.kurucu_ad"));
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    act(() => secenek.uyari?.({ tur: "hesaplaniyor", mesgul: true }));
    expect(await screen.findByText(t("hesap.hesaplaniyor"))).toBeVisible();
    act(() => secenek.uyari?.({ tur: "hesaplaniyor", mesgul: false }));
    await waitFor(() => expect(screen.queryByText(t("hesap.hesaplaniyor"))).toBeNull());
    act(() => secenek.uyari?.({ tur: "kaydediliyor", mesgul: true }));
    expect(await screen.findByText(t("kayit.durum.kaydediliyor"))).toBeVisible();
    act(() => secenek.uyari?.({ tur: "kayit_kilitli", kosuId: "k", kilitli: true }));
    expect(await screen.findByText(t("kayit.durum.kilitli"))).toBeVisible();
    act(() => secenek.uyari?.({ tur: "kayit_bekliyor", kosuId: "k", bekliyor: true }));
    expect(await screen.findByText(t("kayit.durum.bekliyor"))).toBeVisible();
    act(() => secenek.uyari?.({ tur: "kayit_bekliyor", kosuId: "k", bekliyor: false }));
    await waitFor(() => expect(screen.queryByText(t("kayit.durum.bekliyor"))).toBeNull());
  });
});

describe("kayit paneli, hatirlatma, acik kod", () => {
  it("Baslangicta_Kayit_ve_depolama_dugmesi_paneli_acar_acik_kod_satiri_gorunur", async () => {
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.dugme") }));
    expect(await screen.findByRole("dialog", { name: t("kayit.baslik") })).toBeVisible();
    expect(await screen.findByText(t("kayit.kalici.verildi"))).toBeVisible();
    expect(screen.getAllByText(t("acikkod.satir"), { exact: false }).length).toBeGreaterThan(0);
  });

  it("hatirlatma_geri_cagrisi_baglidir_banner_ve_Simdi_disa_aktar_paneli_acar_Sonra_gizler", async () => {
    const hizmet = sahteHizmetler();
    kurulum({ hizmetler: hizmet });
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    expect(typeof secenek.hatirlatma).toBe("function");
    act(() => secenek.hatirlatma?.({ kosuId: "k", hafta: 52 }));
    expect(await screen.findByText(t("kayit.hatirlatma.metin", { hafta: 52 }), { exact: false })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("kayit.hatirlatma.sonra") }));
    expect(screen.queryByText(t("kayit.hatirlatma.metin", { hafta: 52 }), { exact: false })).toBeNull();
    act(() => secenek.hatirlatma?.({ kosuId: "k", hafta: 104 }));
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.hatirlatma.disa") }));
    await waitFor(() => expect(hizmet.disaAktar).toHaveBeenCalledWith("k"));       // Ö10: o koşuyu dogrudan disa aktarir
    await waitFor(() => expect(screen.queryByText(t("kayit.hatirlatma.metin", { hafta: 104 }), { exact: false })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    // disa aktarma basarisizsa panel acilir
    (hizmet.disaAktar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("x"));
    act(() => secenek.hatirlatma?.({ kosuId: "k", hafta: 156 }));
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.hatirlatma.disa") }));
    expect(await screen.findByRole("dialog", { name: t("kayit.baslik") })).toBeVisible();
  });

  it("panelden_Ac_ve_oynat_kayit_tamamlanir_hash_o_rotaya_yazilir_ve_sayfa_yenilenir", async () => {
    const reload = vi.fn();
    const eski = window.location;
    const tamamla = vi.fn(async () => true);
    kurulum({ kayitTamamla: tamamla, surdur: vi.fn() });
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash: "#/", reload, pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.dugme") }));
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Oyun A" }) }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(tamamla).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: eski });
    }
  });

  it("kota_esigi_asilirsa_acilista_uyari_bandi_ve_panel_dugmesi_asilmazsa_yok", async () => {
    kurulum({ hizmetler: sahteHizmetler({ depolama: vi.fn(async () => ({ olcum: { kullanim: 90, kota: 100, oran: 0.9 }, esik: 0.85, kotaUyarisi: true, kalicilik: null })) }) });
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    expect(await screen.findByText(t("kayit.depolama.uyari", { yuzde: 90 }), { exact: false })).toBeVisible();
    cleanup();
    kurulum();
    const { OyunApp: B } = await bayrakli();
    render(<B />);
    await screen.findByText(t("baslangic.kurucu_ad"));
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    expect(screen.queryByText(t("kayit.depolama.uyari", { yuzde: 90 }), { exact: false })).toBeNull();
  });

  it("bayraksiz_derlemede_panel_dugmesi_rozet_ve_bildirim_sutunu_yok", async () => {
    vi.resetModules();
    const { OyunApp } = await import("@/oyun/OyunApp");
    render(<OyunApp />);
    await screen.findByText(t("baslangic.kurucu_ad"));
    expect(screen.queryByRole("button", { name: t("kayit.dugme") })).toBeNull();
    expect(document.querySelector('[role="status"][aria-live="polite"]')).toBeNull();
    expect(h.kur).not.toHaveBeenCalled();
  });
});

describe("K1: kayit baglantisi", () => {
  it("kaynak_kayit_baglantisi_Baslangica_temizlenir_ve_bilgi_gosterilir", async () => {
    window.history.replaceState(null, "", "/oyun?kaynak=kayit#/canli/kayit-x");
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    expect(await screen.findByText(t("tarayici.acilamaz.kayit"), { exact: false })).toBeVisible();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/");
    expect(h.replay).not.toHaveBeenCalled();
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    expect((h.kur.mock.calls[0]?.[0] as KaynakSecenek).hash).toBe("#/");
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.acilamaz.kapat") }));
    expect(screen.queryByText(t("tarayici.acilamaz.kayit"), { exact: false })).toBeNull();
  });
});

describe("cihaz ve Safari uyarilari", () => {
  it("telefon_tablet_uyarisi_gorunur_oyun_engellenmez_kapatilinca_hatirlanir", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("pointer:coarse") || q.includes("hover:none"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      const { OyunApp } = await bayrakli();
      const { unmount } = render(<OyunApp />);
      expect(await screen.findByText(t("cihaz.uyari"), { exact: false })).toBeVisible();
      expect(await screen.findByText(t("baslangic.kurucu_ad"))).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: t("cihaz.kapat") }));
      unmount();
      cleanup();
      const { OyunApp: Yeni } = await bayrakli();
      render(<Yeni />);
      await screen.findByText(t("baslangic.kurucu_ad"));
      expect(screen.queryByText(t("cihaz.uyari"), { exact: false })).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    }
  });

  it("masaustu_cihazda_uyari_yok", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    await screen.findByText(t("baslangic.kurucu_ad"));
    expect(screen.queryByText(t("cihaz.uyari"), { exact: false })).toBeNull();
  });

  it("WebKit_tarayicisinda_Safari_7_gun_seridi_belirgin_diger_tarayicida_yok", async () => {
    const ua = vi.spyOn(window.navigator, "userAgent", "get");
    ua.mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15");
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    expect(await screen.findByText(t("kayit.safari_serit"), { exact: false })).toBeVisible();
    cleanup();
    ua.mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
    const { OyunApp: B } = await bayrakli();
    render(<B />);
    await screen.findByText(t("baslangic.kurucu_ad"));
    expect(screen.queryByText(t("kayit.safari_serit"), { exact: false })).toBeNull();
    ua.mockRestore();
  });
});

describe("B7 devri: surum yenilemesi beklenirken notr ekran", () => {
  it("eski_paketli_oturumda_Kurucu_rotasi_kayit_tamamlanana_dek_dogru_surum_yukleniyor_gosterir_formu_gostermez", async () => {
    window.location.hash = "#/kurucu";
    let bitir: (v: boolean) => void = () => undefined;
    kurulum({ eskiPaket: true, kayitTamamla: () => new Promise<boolean>((c) => (bitir = c)), surdur: vi.fn() });
    const reload = vi.fn();
    const eski = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash: "#/kurucu", reload, pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      expect(await screen.findByRole("heading", { name: t("tarayici.surum_yukleniyor.baslik") })).toBeVisible();
      expect(screen.queryByText(t("acilis.hata.baslik"))).toBeNull();
      bitir(true);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: eski });
    }
  });

  it("kayit_tamamlanamazsa_notr_ekran_kalkar_oyun_surer", async () => {
    const surdur = vi.fn();
    kurulum({ eskiPaket: true, kayitTamamla: async () => false, surdur });
    const eski = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash: "#/kurucu", reload: vi.fn(), pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await waitFor(() => expect(surdur).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("heading", { name: t("tarayici.surum_yukleniyor.baslik") })).toBeNull());
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: eski });
    }
  });
});

describe("B8 Y1/Ö8/Ö9/K1: Ac ve oynat, yenileme, secim icin yenileme", () => {
  async function konumlu(hash: string, ek: Record<string, unknown>) {
    const reload = vi.fn();
    const eski = window.location;
    const replace = vi.spyOn(window.history, "replaceState");
    kurulum(ek);
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash, reload, pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    return { reload, replace, geri: () => Object.defineProperty(window, "location", { configurable: true, value: eski }) };
  }

  it("DAO_koşusu_icin_Ac_ve_oynat_hash_i_dao_rotasina_yazar_yalniz_kayit_tamamlaninca", async () => {
    const h2 = sahteHizmetler({ kosular: vi.fn(async () => [{ kosuId: "canli-d1", ad: "DAO oyun", hafta: 9, guncelleme: 1, kaynak: "yerel" as const, tur: "dao" as const, aktif: false, disaAktarilmayanHafta: 0 }]) });
    let bitir: (v: boolean) => void = () => undefined;
    const { reload, replace, geri } = await konumlu("#/", { hizmetler: h2, kayitTamamla: () => new Promise<boolean>((c) => (bitir = c)), surdur: vi.fn() });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.dugme") }));
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "DAO oyun" }) }));
      expect(await screen.findByRole("heading", { name: t("tarayici.acma_yukleniyor.baslik") })).toBeVisible();      // Ö8 + r1-Ö1: "Oyun aciliyor" (surum degil)
      expect(screen.queryByText(t("tarayici.surum_yukleniyor.bilgi"))).toBeNull();
      expect(replace.mock.calls.some((c) => String(c[2]).includes("#/dao/canli-d1"))).toBe(false);                  // kayit bitmeden hash yazilmaz
      bitir(true);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(replace.mock.calls.some((c) => String(c[2]).endsWith("#/dao/canli-d1"))).toBe(true);
    } finally {
      replace.mockRestore();
      geri();
    }
  });

  it("Ö8_kayit_tamamlanamazsa_hash_yazilmaz_bilgi_bandi_cikar_notr_ekran_kalkar", async () => {
    const { reload, replace, geri } = await konumlu("#/", { kayitTamamla: async () => false, surdur: vi.fn() });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.dugme") }));
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Oyun A" }) }));
      expect(await screen.findByText(t("kayit.durum.acma_hata"))).toBeVisible();
      expect(reload).not.toHaveBeenCalled();
      expect(replace.mock.calls.some((c) => String(c[2]).includes("#/canli/canli-a1"))).toBe(false);
      expect(screen.queryByRole("heading", { name: t("tarayici.surum_yukleniyor.baslik") })).toBeNull();
    } finally {
      replace.mockRestore();
      geri();
    }
  });

  it("Ö9_yenileme_gerceklesmezse_Kal_notr_ekran_zaman_asimiyla_kalkar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { reload, geri } = await konumlu("#/", { kayitTamamla: async () => true, surdur: vi.fn() });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.dugme") }), { advanceTimers: vi.advanceTimersByTime } as never).catch(() => undefined);
      await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Oyun A" }) }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("heading", { name: t("tarayici.acma_yukleniyor.baslik") })).toBeVisible();
      await act(async () => vi.advanceTimersByTime(5100));
      await waitFor(() => expect(screen.queryByRole("heading", { name: t("tarayici.acma_yukleniyor.baslik") })).toBeNull());
    } finally {
      vi.useRealTimers();
      geri();
    }
  });

  it("K1_kayitSecimiIcin_hash_i_koşu_rotasina_yazar_DAO_ise_dao_kayit_tamamlanip_yenilenir", async () => {
    const h2 = sahteHizmetler({ kosular: vi.fn(async () => [{ kosuId: "canli-d1", ad: "D", hafta: 9, guncelleme: 1, kaynak: "yerel" as const, tur: "dao" as const, aktif: false, disaAktarilmayanHafta: 0 }]) });
    const { reload, replace, geri } = await konumlu("#/kosular", { hizmetler: h2, kayitTamamla: async () => true, surdur: vi.fn() });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await waitFor(() => expect(h.kur).toHaveBeenCalled());
      await waitFor(() => expect(h.probe).toHaveBeenCalled());
      (secenek.kayitSecimiIcin as (id: string) => void)("canli-d1");
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(replace.mock.calls.some((c) => String(c[2]).endsWith("#/dao/canli-d1"))).toBe(true);
    } finally {
      replace.mockRestore();
      geri();
    }
  });
});

describe("B8 tur 2: r1-O1/O2", () => {
  it("r1_O2_secim_yolunda_kayit_tamamlanamazsa_acma_hata_bandi_notr_ekran_yok", async () => {
    const eski = window.location;
    kurulum({ kayitTamamla: async () => false, surdur: vi.fn() });
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash: "#/kosular", reload: vi.fn(), pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    try {
      const { OyunApp } = await bayrakli();
      render(<OyunApp />);
      await waitFor(() => expect(h.kur).toHaveBeenCalled());
      await waitFor(() => expect(h.probe).toHaveBeenCalled());
      const sonuc = await (secenek.kayitSecimiIcin as (id: string) => Promise<boolean>)("canli-a1");
      expect(sonuc).toBe(false);
      expect(await screen.findByText(t("kayit.durum.acma_hata"))).toBeVisible();
      expect(screen.queryByRole("heading", { name: t("tarayici.acma_yukleniyor.baslik") })).toBeNull();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: eski });
    }
  });
});
