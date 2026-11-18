import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { YuklemeHatasi } from "@/oyun/tarayici/protokol";
import type { AcilisDurumu, KaynakSecenek } from "@/oyun/tarayici/kaynak";
import { createFakeSource } from "./helpers/fakeSource";

/**
 * `NEXT_PUBLIC_OYUN_KAYNAK=tarayici` derleme bayragi: `chooseSource` tarayici kaynagini kurar (LiveSource'a fetch/EventSource koprusu verilir);
 * bayraksiz derlemede ayni cagri eski davranisi aynen surdurur ve tarayici modulleri hic yuklenmez.
 */
const h = vi.hoisted(() => ({
  probe: vi.fn(),
  live: vi.fn(),
  replay: vi.fn(),
  kur: vi.fn(),
  worker: vi.fn(),
}));

vi.mock("@/oyun/sim/live", async (orig) => ({
  ...(await orig<typeof import("@/oyun/sim/live")>()),
  probeLive: (...a: unknown[]) => h.probe(...a) as unknown,
  createLiveSource: (...a: unknown[]) => h.live(...a) as unknown,
}));
vi.mock("@/oyun/sim/replay", async (orig) => ({
  ...(await orig<typeof import("@/oyun/sim/replay")>()),
  createReplaySource: (...a: unknown[]) => h.replay(...a) as unknown,
}));
vi.mock("@/oyun/tarayici/kaynak", async (orig) => ({
  ...(await orig<typeof import("@/oyun/tarayici/kaynak")>()),
  tarayiciKaynagiKur: (...a: unknown[]) => h.kur(...a) as unknown,
}));
vi.mock("@/oyun/tarayici/isciUret", () => ({ gercekWorkerUret: (...a: unknown[]) => h.worker(...a) as unknown }));

const LOC = { hostname: "oyun.example", port: "", origin: "https://oyun.example", search: "", hash: "#/kurucu" };
const fetchKoprusu = vi.fn();
const akisKoprusu = vi.fn();
const kapat = vi.fn(async () => undefined);

beforeEach(() => {
  for (const f of [h.probe, h.live, h.replay, h.kur, h.worker, fetchKoprusu, akisKoprusu, kapat]) f.mockClear();
  h.probe.mockResolvedValue({ ok: true, hello: { serverVersion: "1", modelVersion: "1", defaultsHash: "x", secPerWeekP50: 4.2 } });
  h.live.mockImplementation(() => createFakeSource([], { kind: "live" }));
  h.replay.mockImplementation(() => createFakeSource([], { kind: "replay" }));
  h.worker.mockReturnValue({ sahte: "worker" });
  h.kur.mockResolvedValue({ kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat });
  vi.stubGlobal("indexedDB", { sahte: "idb" });
  window.history.replaceState(null, "", "/oyun");
  window.location.hash = "#/kurucu";
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

describe("chooseSource: tarayici bayragi", () => {
  it("bayrakli_ve_arayuz_verilince_LiveSource_fetch_ve_eventSource_koprusuyle_kurulur", async () => {
    const { chooseSource } = await bayrakli();
    const durum = vi.fn();
    const r = await chooseSource(LOC, () => true, { durum });
    const kaynakSecenek = h.kur.mock.calls[0]?.[0] as KaynakSecenek;
    expect(kaynakSecenek).toMatchObject({ origin: "https://oyun.example", hash: "#/kurucu", idb: { sahte: "idb" } });
    expect(kaynakSecenek.durum).toBe(durum);
    expect(kaynakSecenek.workerUret()).toEqual({ sahte: "worker" });
    expect(h.live).toHaveBeenCalledWith({ baseUrl: "", fetchImpl: fetchKoprusu, eventSourceImpl: akisKoprusu });
    expect(h.probe).toHaveBeenCalledWith("", { fetchImpl: fetchKoprusu, timeoutMs: 60_000 });
    expect(r.source?.kind).toBe("live");
    expect(r.secPerWeekP50).toBe(4.2);
    expect(r.kapat).toBe(kapat);
    expect(h.replay).not.toHaveBeenCalled();
  });

  it("B8 K1: bayrakli_derlemede_kayit_kaynagi_yok_kayit_baglantisi_ayiklanir_Baslangica_temizlenir", async () => {
    const { chooseSource, kayitBaglantisiniAyikla } = await bayrakli();
    const a = kayitBaglantisiniAyikla({ ...LOC, search: "?kaynak=kayit" });
    expect(a).toMatchObject({ kayit: true, loc: { search: "", hash: "#/" } });
    const b = kayitBaglantisiniAyikla({ ...LOC, hash: "#/canli/kayit-tarifi-abc/3" });
    expect(b).toMatchObject({ kayit: true, loc: { hash: "#/" } });
    expect(kayitBaglantisiniAyikla({ ...LOC, hash: "#/sonuc/kayit-x" }).kayit).toBe(true);
    // canli- oneki, Kurucu, Koşular, DAO ve bos konum kayit baglantisi degildir
    for (const hash of ["#/canli/canli-ab12", "#/sonuc/canli-ab12", "#/kurucu", "#/kosular", "#/dao/canli-1", "", "#/"]) expect(kayitBaglantisiniAyikla({ ...LOC, hash }).kayit).toBe(false);
    // Ayiklanmamis konum gelse bile tarayici kipinde kayit kaynagi KURULMAZ (tarayici kaynagi kurulur).
    const r = await chooseSource({ ...LOC, search: "?kaynak=kayit" }, () => true, { durum: vi.fn() });
    expect(h.replay).not.toHaveBeenCalled();
    expect(h.kur).toHaveBeenCalledTimes(1);
    expect(r.source?.kind).toBe("live");
  });

  it("bayrakli_ama_arayuz_verilmezse_eski_yol", async () => {
    const { chooseSource } = await bayrakli();
    const r = await chooseSource(LOC);
    expect(h.kur).not.toHaveBeenCalled();
    expect(r.source?.kind).toBe("replay");
  });

  it("bayraksiz_arayuz_verilse_de_eski_davranis_ve_tarayici_modulu_hic_cagrilmaz", async () => {
    vi.resetModules();
    const { chooseSource } = await import("@/oyun/OyunApp");
    const r = await chooseSource(LOC, () => true, { durum: vi.fn() });
    expect(h.kur).not.toHaveBeenCalled();
    expect(h.worker).not.toHaveBeenCalled();
    expect(r.source?.kind).toBe("replay");
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("bilesen_kalkmissa_kaynak_kapatilir_kaynak_donmez", async () => {
    const { chooseSource } = await bayrakli();
    let hayatta = true;
    h.kur.mockImplementation(async () => {
      hayatta = false;
      return { kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat };
    });
    const r = await chooseSource(LOC, () => hayatta, { durum: vi.fn() });
    expect(r).toEqual({ source: null });
    expect(kapat).toHaveBeenCalledTimes(1);
    expect(h.live).not.toHaveBeenCalled();
  });
});

describe("B7 Y3/N1/K-b: eski paketle acilmis oturum", () => {
  async function ac(hash: string, tamamla: () => Promise<boolean> = async () => true, kosuUyumsuz: (id: string) => Promise<boolean> = async () => false) {
    const reload = vi.fn();
    const surdur = vi.fn();
    const eski = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...eski, hash, reload, pathname: "/oyun/", search: "", origin: "https://oyun.example", hostname: "oyun.example", port: "" } });
    h.kur.mockResolvedValue({ kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat, eskiPaket: true, kayitTamamla: tamamla, surdur, kosuUyumsuz });
    const { OyunApp } = await bayrakli();
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    await waitFor(() => expect(h.probe).toHaveBeenCalled());
    return { reload, surdur, geri: () => Object.defineProperty(window, "location", { configurable: true, value: eski }) };
  }

  it("yeni_oyun_rotalari_(runIdsiz_Kurucu_ve_DAO)_kayit_tamamlandiktan_SONRA_yeniden_yuklenir", async () => {
    for (const hash of ["#/kurucu", "#/dao"]) {
      let bitir: (v: boolean) => void = () => undefined;
      const { reload, geri } = await ac(hash, () => new Promise<boolean>((c) => (bitir = c)));
      await new Promise((c) => setTimeout(c, 30));
      expect(reload).not.toHaveBeenCalled();           // kayit bitmeden yenileme yok (K-b)
      bitir(true);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      geri();
      cleanup();
      h.kur.mockClear();
      h.probe.mockClear();
    }
  });

  it("kayit_tamamlanamazsa_yenilenmez_oyun_surdurulur", async () => {
    const { reload, surdur, geri } = await ac("#/kurucu", async () => false);
    await waitFor(() => expect(surdur).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
    geri();
  });

  it("R2-1: kayit_yuklu_paketten_farkli_modelle_yazilmis_baska_kosuya_gecis_yeniden_yukler_ayni_kosuda_yuklemez", async () => {
    const uyumsuz = vi.fn(async (id: string) => id === "canli-baska");
    const { reload, geri } = await ac("#/canli/canli-baska", async () => true, uyumsuz);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    geri();
    cleanup();
    h.kur.mockClear();
    h.probe.mockClear();
    const ayni = await ac("#/canli/canli-ayni/3", async () => true, uyumsuz);
    await waitFor(() => expect(uyumsuz).toHaveBeenCalledWith("canli-ayni"));
    await new Promise((c) => setTimeout(c, 40));
    expect(ayni.reload).not.toHaveBeenCalled();
    ayni.geri();
  });

  it("R2-2: ayni_anda_iki_tetik_(rota_ve_409)_tek_kayitTamamla_ve_tek_yenileme", async () => {
    let bitir: (v: boolean) => void = () => undefined;
    const tamamla = vi.fn(() => new Promise<boolean>((c) => (bitir = c)));
    const { reload, geri } = await ac("#/kurucu", tamamla);
    await waitFor(() => expect(tamamla).toHaveBeenCalled());
    const yenile = (h.kur.mock.calls[0]?.[0] as KaynakSecenek).yeniOyunIcinYenile as () => void;
    yenile(); // 409 yolu ayni anda
    yenile();
    bitir(true);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await new Promise((c) => setTimeout(c, 30));
    expect(tamamla).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    geri();
  });

  it("R3-1: kayit_icin_yenileme_hash'i_korur_(kullanici_kosusuna_doner);_yeni_oyun_yenilemesi_#/kurucu_yapar", async () => {
    const { reload, geri } = await ac("#/canli/canli-genc");
    const s = h.kur.mock.calls[0]?.[0] as KaynakSecenek;
    (s.kayitIcinYenile as (id: string) => void)("canli-genc");
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#/canli/canli-genc");
    (s.yeniOyunIcinYenile as () => void)();
    expect(window.location.hash).toBe("#/kurucu");
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    geri();
  });

  it("kayda_bagli_rotalar_(canli,_sonuc,_runId'li_DAO,_paylasilan_dunya)_yeniden_yuklemez_N1", async () => {
    for (const hash of ["#/canli/canli-ab12", "#/dao/canli-ab12", "#/dao/canli-ab12/2", "#/dao/d/KOD", "#/sonuc/canli-ab12"]) {
      const { reload, geri } = await ac(hash);
      await new Promise((c) => setTimeout(c, 40));
      expect(reload, hash).not.toHaveBeenCalled();
      geri();
      cleanup();
      h.kur.mockClear();
      h.probe.mockClear();
    }
  });
});

describe("OyunApp: yukleme ekrani", () => {
  it("bayrakli_yukleme_asamasi_ilerleme_gosterir_sonra_ekran_acilir", async () => {
    const { OyunApp } = await bayrakli();
    let bitir: (v: unknown) => void = () => undefined;
    let durumYaz: (d: AcilisDurumu) => void = () => undefined;
    h.kur.mockImplementation((o: KaynakSecenek) => {
      durumYaz = o.durum;
      return new Promise((c) => (bitir = c));
    });
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    expect(screen.getByText(t("tarayici.baslik"))).toBeTruthy();
    act(() => durumYaz({ tur: "yukleme", asama: "indirme", oran: 0.5, alinan: 5 * 1024 * 1024, toplam: 10 * 1024 * 1024 }));
    expect(screen.getByText(t("tarayici.asama.indirme"))).toBeTruthy();
    expect(screen.getByText(t("tarayici.indirme_ayrinti", { alinan: "5.0", toplam: "10.0" }))).toBeTruthy();
    const cubuk = screen.getByRole("progressbar", { name: t("tarayici.ilerleme_etiket") }) as HTMLProgressElement;
    expect(cubuk.value).toBeGreaterThan(0);
    expect(cubuk.value).toBeLessThan(1);
    bitir({ kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat });
    await waitFor(() => expect(screen.queryByText(t("tarayici.baslik"))).toBeNull());
  });

  it("yukleme_hatasi_acik_metin_ve_yeniden_dene_yeni_deneme_baslatir", async () => {
    const { OyunApp } = await bayrakli();
    h.kur.mockRejectedValueOnce(new YuklemeHatasi("sha_uyusmuyor"));
    render(<OyunApp />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t("tarayici.hata.sha_uyusmuyor")));
    expect(screen.getByText(t("tarayici.hata.baslik"))).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: t("durum.yeniden") }).click());
    await waitFor(() => expect(h.kur).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("devam_secimi_butonlari_calisir", async () => {
    const { OyunApp } = await bayrakli();
    const devam = vi.fn();
    const yeni = vi.fn();
    h.kur.mockImplementation((o: KaynakSecenek) => {
      o.durum({ tur: "secim", kosuId: "canli-a", hafta: 7, devam, yeni });
      return new Promise(() => undefined);
    });
    render(<OyunApp />);
    await waitFor(() => expect(screen.getByText(t("tarayici.secim.ozet", { hafta: 7 }))).toBeTruthy());
    await act(async () => screen.getByRole("button", { name: t("tarayici.secim.devam") }).click());
    await act(async () => screen.getByRole("button", { name: t("tarayici.secim.yeni") }).click());
    expect(devam).toHaveBeenCalledTimes(1);
    expect(yeni).toHaveBeenCalledTimes(1);
  });
});

describe("OyunApp: motor ekranlari ve uyari bandi", () => {
  const kurDurum = (f: (o: KaynakSecenek) => void): void => {
    h.kur.mockImplementation((o: KaynakSecenek) => {
      f(o);
      return Promise.resolve({ kopru: { fetch: fetchKoprusu, eventSource: akisKoprusu }, kapat });
    });
  };

  it("Worker_dusunce_oyun_motoru_durdu_ekrani_ve_yeniden_yukle", async () => {
    const { OyunApp } = await bayrakli();
    let dustu: (e: unknown) => void = () => undefined;
    kurDurum((o) => (dustu = o.dustu ?? dustu));
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    act(() => dustu(new Error("yanit_yok")));
    expect(await screen.findByText(t("tarayici.motor_durdu.baslik"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("tarayici.yeniden_yukle") })).toBeTruthy();
  });

  it("baska_sekme_devraldiysa_devredildi_ekrani", async () => {
    const { OyunApp } = await bayrakli();
    let bas: () => void = () => undefined;
    kurDurum((o) => (bas = o.baskaSekme ?? bas));
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    act(() => bas());
    expect(await screen.findByText(t("tarayici.devredildi.baslik"))).toBeTruthy();
  });

  it("baska_sekme_acilista_sorulur_devral_dugmesi", async () => {
    const { OyunApp } = await bayrakli();
    const devral = vi.fn();
    h.kur.mockImplementation((o: KaynakSecenek) => {
      o.durum({ tur: "baska_sekme", devral });
      return new Promise(() => undefined);
    });
    render(<OyunApp />);
    const dugme = await screen.findByRole("button", { name: t("tarayici.baska_sekme.devral") });
    await act(async () => dugme.click());
    expect(devral).toHaveBeenCalledTimes(1);
  });

  it("kalicilik_uyarisi_bant_olarak_gorunur_duzelince_kalkar", async () => {
    const { OyunApp } = await bayrakli();
    let uyar: NonNullable<KaynakSecenek["uyari"]> = () => undefined;
    kurDurum((o) => (uyar = o.uyari ?? uyar));
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    act(() => uyar({ tur: "kayit_yazilamadi", kosuId: "k", bekleyen: 2 }));
    expect(await screen.findByText(t("tarayici.uyari.kayit_yazilamadi"))).toBeTruthy();
    act(() => uyar({ tur: "kayit_duzeldi", kosuId: "k" }));
    await waitFor(() => expect(screen.queryByText(t("tarayici.uyari.kayit_yazilamadi"))).toBeNull());
  });

  it("yazim_bekliyorken_beforeunload_onayi_duzelince_kalkar_acilis_suruyor_bandi", async () => {
    const { OyunApp } = await bayrakli();
    let uyar: NonNullable<KaynakSecenek["uyari"]> = () => undefined;
    kurDurum((o) => (uyar = o.uyari ?? uyar));
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    const engellendi = (): boolean => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    expect(engellendi()).toBe(false);
    act(() => uyar({ tur: "kayit_yazilamadi", kosuId: "k", bekleyen: 1 }));
    await screen.findByText(t("tarayici.uyari.kayit_yazilamadi"));
    expect(engellendi()).toBe(true);
    act(() => uyar({ tur: "kayit_duzeldi", kosuId: "k" }));
    await waitFor(() => expect(engellendi()).toBe(false));
    act(() => uyar({ tur: "acilis_suruyor", kosuId: "k", hafta: 4, hedef: 9 }));
    expect(await screen.findByText(t("tarayici.uyari.acilis_suruyor", { hafta: 4, hedef: 9 }))).toBeTruthy();
    act(() => uyar({ tur: "acilis_bitti", kosuId: "k" }));
    await waitFor(() => expect(screen.queryByText(t("tarayici.uyari.acilis_suruyor", { hafta: 4, hedef: 9 }))).toBeNull());
  });

  it("Z3_yazim_bekleme_durumu_acilis_bandindan_bagimsiz_beforeunload_surer", async () => {
    const { OyunApp } = await bayrakli();
    let uyar: NonNullable<KaynakSecenek["uyari"]> = () => undefined;
    kurDurum((o) => (uyar = o.uyari ?? uyar));
    render(<OyunApp />);
    await waitFor(() => expect(h.kur).toHaveBeenCalled());
    const engellendi = (): boolean => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    act(() => uyar({ tur: "kayit_yazilamadi", kosuId: "a", bekleyen: 1 }));
    act(() => uyar({ tur: "acilis_suruyor", kosuId: "b", hafta: 1, hedef: 5 }));
    act(() => uyar({ tur: "acilis_bitti", kosuId: "b" }));
    act(() => uyar({ tur: "kayit_duzeldi", kosuId: "baska" }));          // baska kosunun duzelmesi a'nin bekleyenini silmez
    await screen.findByText(t("tarayici.uyari.kayit_yazilamadi"));
    expect(engellendi()).toBe(true);
    act(() => uyar({ tur: "kayit_duzeldi", kosuId: "a" }));
    await waitFor(() => expect(engellendi()).toBe(false));
  });
});
