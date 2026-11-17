import fs from "node:fs";
import path from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spriteHatasiYaz } from "@/oyun/harita/gorunumDurumu";
import { animasyonModu, gorunumModu, urlBayragiOku, type GorunumGirdisi } from "@/oyun/harita/izoTercih";
import { useAnimasyonTercihi, useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";
import { manifestOnbelleginiSifirla, useSpriteManifest } from "@/oyun/harita/useSpriteManifest";

const web = vi.hoisted(() => ({ gl: true }));
vi.mock("@/oyun/harita/useWebgl", () => ({ useWebgl: () => web.gl }));
// Hook testleri `useGorunumModu`yu bu mock'lardan sonra içe aktarır.
const { useGorunumModu } = await import("@/oyun/harita/useGorunumModu");

const HAM = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/oyun-sprite/manifest.json"), "utf8")) as unknown;
const taban: GorunumGirdisi = { webgl: true, manifest: "hazir", tercih: null, spriteHatasi: false, urlBayragi: null };

describe("gorunumModu (saf)", () => {
  it("webgl_yok_klasik", () => {
    expect(gorunumModu({ ...taban, webgl: false, urlBayragi: "izo" })).toBe("klasik");
    expect(gorunumModu({ ...taban, webgl: false, tercih: "izo" })).toBe("klasik");
  });
  it("manifest_hata_klasik", () => {
    expect(gorunumModu({ ...taban, manifest: "hata", urlBayragi: "izo" })).toBe("klasik");
  });
  it("manifest_yukleniyor_bekle", () => {
    expect(gorunumModu({ ...taban, manifest: "yukleniyor", urlBayragi: "izo" })).toBe("bekle");
  });
  it("tercih_klasik_manifest_istenmez", () => {
    // kullanıcı klasik seçtiyse manifest durumu önemsizdir (yükleniyor bile olsa beklenmez)
    expect(gorunumModu({ ...taban, manifest: "yukleniyor", tercih: "klasik" })).toBe("klasik");
    expect(gorunumModu({ ...taban, manifest: "yukleniyor", tercih: "klasik", urlBayragi: null })).toBe("klasik");
  });
  it("url_bayragi_izo", () => {
    expect(gorunumModu({ ...taban, urlBayragi: "izo" })).toBe("izo");
    expect(gorunumModu({ ...taban, tercih: "izo" })).toBe("izo");
    expect(gorunumModu({ ...taban, urlBayragi: "izo", tercih: "klasik" })).toBe("izo"); // bağlantı bayrağı tercihi geçer
    expect(gorunumModu({ ...taban, urlBayragi: "klasik", tercih: "izo" })).toBe("klasik");
  });
  it("varsayilan_izo", () => {
    expect(gorunumModu(taban)).toBe("izo");                                   // tercih yok, bayrak yok
    expect(gorunumModu({ ...taban, manifest: "yukleniyor" })).toBe("bekle");
  });
  it("tercih_klasik_ise_klasik", () => {
    expect(gorunumModu({ ...taban, tercih: "klasik" })).toBe("klasik");
    expect(gorunumModu({ ...taban, urlBayragi: "klasik" })).toBe("klasik");
  });
  it("varsayilanla_webgl_yoksa_klasik_ve_manifest_hata_klasige_duser", () => {
    expect(gorunumModu({ ...taban, webgl: false })).toBe("klasik");
    expect(gorunumModu({ ...taban, manifest: "hata" })).toBe("klasik");
    expect(gorunumModu({ ...taban, spriteHatasi: true })).toBe("klasik");
  });
  it("sprite_hatasi_izoyu_kapatir", () => {
    expect(gorunumModu({ ...taban, urlBayragi: "izo", spriteHatasi: true })).toBe("klasik");
  });
  it("urlBayragiOku_yalniz_izo_ya_da_klasik", () => {
    expect(urlBayragiOku("?kaynak=canli&gorunum=izo")).toBe("izo");
    expect(urlBayragiOku("?gorunum=klasik")).toBe("klasik");
    expect(urlBayragiOku("?gorunum=baska")).toBeNull();
    expect(urlBayragiOku("")).toBeNull();
  });
});

describe("useGorunumModu", () => {
  const fetchSahte = vi.fn();
  beforeEach(() => {
    web.gl = true;
    manifestOnbelleginiSifirla();
    fetchSahte.mockReset();
    fetchSahte.mockResolvedValue({ ok: true, json: async () => HAM });
    vi.stubGlobal("fetch", fetchSahte);
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    spriteHatasiYaz(false); // bayrak son abone ayrılınca sıfırlanmaz: testler arası sızmasın
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });

  it("gorunum_tercihi_yokken_varsayilan_izo", async () => {
    const { result } = renderHook(() => ({ g: useGorunumModu(), t: useOyunTercihleri() }));
    expect(result.current.t.gorunum).toBeNull();
    expect(result.current.g.mod).toBe("bekle");
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
    expect(result.current.g.manifest).not.toBeNull();
    expect(result.current.g.dustu).toBe(false);
  });

  it("varsayilanda_manifest_hatasi_klasige_duser", async () => {
    fetchSahte.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const { result } = renderHook(() => useGorunumModu());
    await waitFor(() => expect(result.current.mod).toBe("klasik"));
    expect(result.current.dustu).toBe(true);
  });

  it("varsayilanda_webgl_yoksa_klasik_ve_manifest_cekilmez", async () => {
    web.gl = false;
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.mod).toBe("klasik");
    await act(async () => { await Promise.resolve(); });
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it("url_bayragi_klasik_kalici_desteklenir", async () => {
    window.history.replaceState(null, "", "/?gorunum=klasik");
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.mod).toBe("klasik");
    await act(async () => { await Promise.resolve(); });
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it("url_bayragi_izo_once_bekle_sonra_izo", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.mod).toBe("bekle");
    await waitFor(() => expect(result.current.mod).toBe("izo"));
    expect(result.current.manifest).not.toBeNull();
    expect(fetchSahte).toHaveBeenCalledWith("/oyun-sprite/manifest.json");
  });

  it("webgl_yoksa_klasik_ve_manifest_cekilmez", async () => {
    web.gl = false;
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.mod).toBe("klasik");
    await act(async () => { await Promise.resolve(); });
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it("manifest_404_klasik", async () => {
    fetchSahte.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    await waitFor(() => expect(result.current.mod).toBe("klasik"));
  });

  it("bozuk_manifest_klasik", async () => {
    fetchSahte.mockResolvedValue({ ok: true, json: async () => ({ girdiler: [] }) });
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    await waitFor(() => expect(result.current.mod).toBe("klasik"));
  });

  it("useGorunumModu_hata_bildirilince_klasik", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    await waitFor(() => expect(result.current.mod).toBe("izo"));
    act(() => result.current.spriteHatasiBildir());
    expect(result.current.mod).toBe("klasik");
  });

  it("kullanici_sade_secerse_manifest_hic_cekilmez", async () => {
    window.localStorage.setItem("oyun.gorunum", "klasik");
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.mod).toBe("klasik");
    expect(result.current.dustu).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it("kayitli_tercih_izo_ise_izo_ve_menuden_degisince_aninda_klasik", async () => {
    window.localStorage.setItem("oyun.gorunum", "izo");
    const { result } = renderHook(() => ({ g: useGorunumModu(), t: useOyunTercihleri() }));
    expect(result.current.t.gorunum).toBe("izo");
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
    act(() => result.current.t.setGorunum("klasik"));
    expect(result.current.g.mod).toBe("klasik");
  });

  it("manifest_hatasi_dustu_isaretler_klasik_istenmediyse_dusmez", async () => {
    fetchSahte.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    expect(result.current.dustu).toBe(false);                 // yüklenirken düşme yok
    await waitFor(() => expect(result.current.mod).toBe("klasik"));
    expect(result.current.dustu).toBe(true);
    act(() => result.current.spriteHatasiBildir());
    expect(result.current.dustu).toBe(true);
  });

  it("sprite_hatasi_bildirilince_dustu_webgl_yoksa_dusmez", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    const { result } = renderHook(() => useGorunumModu());
    await waitFor(() => expect(result.current.mod).toBe("izo"));
    expect(result.current.dustu).toBe(false);
    act(() => result.current.spriteHatasiBildir());
    expect(result.current.dustu).toBe(true);
    cleanup();
    web.gl = false;
    const b = renderHook(() => useGorunumModu());
    expect(b.result.current.dustu).toBe(false);                // WebGL yok: bu bir sprite düşüşü değil, tablo yolu
  });

  it("url_bayragi_varken_menu_secimi_bayragi_siler_ve_tercih_uygulanir", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo&x=1");
    const { result } = renderHook(() => ({ g: useGorunumModu(), t: useOyunTercihleri() }));
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
    act(() => result.current.t.setGorunum("klasik"));
    expect(window.location.search).toBe("?x=1");
    expect(result.current.g.mod).toBe("klasik");
    act(() => result.current.t.setGorunum("izo"));
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
  });

  it("acik_sehir_secimi_sprite_hatasini_ve_manifest_hatasini_sifirlayip_yeniden_dener", async () => {
    fetchSahte.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    window.localStorage.setItem("oyun.gorunum", "izo");
    const { result } = renderHook(() => ({ g: useGorunumModu(), t: useOyunTercihleri() }));
    await waitFor(() => expect(result.current.g.dustu).toBe(true));      // geçici ağ hatası: klasiğe düştü
    act(() => result.current.t.setGorunum("klasik"));
    act(() => result.current.t.setGorunum("izo"));
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
    expect(fetchSahte).toHaveBeenCalledTimes(2);
    act(() => result.current.g.spriteHatasiBildir());                    // sprite hatası da açık seçimle sıfırlanır
    expect(result.current.g.mod).toBe("klasik");
    act(() => result.current.t.setGorunum("izo"));
    await waitFor(() => expect(result.current.g.mod).toBe("izo"));
  });

  it("manifest_modul_onbellegi_tek_istek", async () => {
    window.history.replaceState(null, "", "/?gorunum=izo");
    const a = renderHook(() => useGorunumModu());
    await waitFor(() => expect(a.result.current.mod).toBe("izo"));
    const b = renderHook(() => useSpriteManifest(true));
    expect(b.result.current.durum).toBe("hazir");
    expect(fetchSahte).toHaveBeenCalledTimes(1);
  });
});

describe("animasyonModu", () => {
  const tam = { etkinAzalt: false, dusukPerformans: false, sekmeGorunur: true };
  it("normal_tam", () => {
    expect(animasyonModu(tam)).toBe("tam");
  });
  it("sistem_azaltma_kapali", () => {
    // etkinAzalt = sistem prefers-reduced-motion VEYA uygulama içi tercih (useOyunTercihleri çözümler)
    expect(animasyonModu({ ...tam, etkinAzalt: true })).toBe("kapali");
  });
  it("uygulama_ici_hareketi_azalt_kapali", () => {
    localStorage.setItem("oyun.hareket", "azalt");
    const { result } = renderHook(() => useAnimasyonTercihi());
    expect(result.current.etkinAzalt).toBe(true);
    expect(animasyonModu({ ...result.current, sekmeGorunur: true })).toBe("kapali");
    localStorage.removeItem("oyun.hareket");
  });
  it("dusuk_performans_kapali", () => {
    expect(animasyonModu({ ...tam, dusukPerformans: true })).toBe("kapali");
  });
  it("sekme_gizli_kapali", () => {
    expect(animasyonModu({ ...tam, sekmeGorunur: false })).toBe("kapali");
  });
});
