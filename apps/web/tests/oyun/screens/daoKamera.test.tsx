import fs from "node:fs";
import path from "node:path";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spriteHatasiYaz } from "@/oyun/harita/gorunumDurumu";
import { t } from "@/oyun/copy/t";
import * as izoModul from "@/oyun/harita/izoSahne";
import type { IzoSahne } from "@/oyun/harita/izoSahne";
import { manifestOnbelleginiSifirla } from "@/oyun/harita/useSpriteManifest";
import type { SehirSahnesi, HaritaRef } from "@/oyun/harita/tipler";
import { GOZLEM_AHIR, GOZLEM_CALISAN } from "../helpers/daoVeri";
import { mountDao, sagPanel } from "../helpers/daoMount";

type TuvalProps = {
  sahne: SehirSahnesi;
  tabloSahnesi: SehirSahnesi;
  secili: HaritaRef | null;
  onSec(r: HaritaRef | null): void;
  onSpriteHatasi?(): void;
  komut?: { n: number; tur: string; hedef?: { x: number; y: number } };
};
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

beforeEach(() => {
  window.location.hash = "#/dao/r";
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

describe("DAO şehir ekranı: kamera ve tuval seçimi", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/?gorunum=klasik"); }); // klasik tuval davranışı: açık sabitleme (varsayılan izo)
  it("test_hafta_0da_kamera_ahira_zorlanmaz_sehir_otomatik_sigdirilir", async () => {
    mountDao(null, { harita: false });
    await screen.findByTestId("tuval");
    expect(tuval.son.komut).toBeUndefined(); // odak komutu yok: tuval ilk haritada şehri bir kez sığdırır (kullanıcı oynatmadıkça)
    expect(tuval.son.sahne.veriYok).toBe(false); // hafta 0: bina verisi henüz yok ama "yok" notu değil, boş şehir
    expect(tuval.son.sahne.ben).toBeNull(); // gözlem yok: vurgu yok
  });

  it("test_sonraki_haftalarda_acilista_odak_komutu_yok", async () => {
    mountDao(GOZLEM_CALISAN);
    await screen.findByTestId("tuval");
    expect(tuval.son.komut).toBeUndefined();
  });

  it("test_ahirdaki_oyuncu_haritada_vurgulanir_ve_tuvalden_secim_sag_paneli_acar", async () => {
    mountDao(GOZLEM_AHIR);
    await screen.findByTestId("tuval");
    await vi.waitFor(() => expect(tuval.son.sahne.ben).toEqual({ binaId: "ahir", neden: "ahir" }));
    act(() => tuval.son.onSec({ kind: "sector", ref: "ahir" }));
    expect(sagPanel(t("harita.ahir")).getByRole("button", { name: t("dao.ahir.cik") })).toBeEnabled();
    expect(tuval.son.secili).toEqual({ kind: "sector", ref: "ahir" });
    act(() => tuval.son.onSec(null));
    expect(screen.queryByRole("complementary", { name: t("harita.ahir") })).toBeNull();
  });

  it("test_bos_parsel_tuvalde_secilebilir_sahne_parselleri_verir", async () => {
    mountDao(GOZLEM_CALISAN);
    await screen.findByTestId("tuval");
    await vi.waitFor(() => expect(tuval.son.sahne.bosParseller!.length).toBeGreaterThan(0));
    const id = tuval.son.sahne.bosParseller![0]!.id;
    act(() => tuval.son.onSec({ kind: "parsel", ref: id }));
    expect(sagPanel(t("dao.baglam.parsel")).getByRole("button", { name: t("dao.karar.kur") })).toBeEnabled();
  });
});

const izoMu = (): boolean => tuval.son !== null && "kaynak" in (tuval.son.sahne as object);
const izoSahne = (): IzoSahne => tuval.son.sahne as unknown as IzoSahne;
const izoAc = async (g = GOZLEM_CALISAN): Promise<void> => {
  window.history.replaceState(null, "", "/?gorunum=izo");
  mountDao(g);
  await vi.waitFor(() => expect(izoMu()).toBe(true));
};

describe("DAO: görünüm modu ve etkin sahne (izometrik)", () => {
  it("izo_modunda_etkin_sahne_izoSahneKur_ile_usememoda_kurulur_klasikte_degil", async () => {
    window.history.replaceState(null, "", "/?gorunum=klasik");
    mountDao(GOZLEM_CALISAN);
    await screen.findByTestId("tuval");
    expect(izoMu()).toBe(false);
    expect(izoKur).not.toHaveBeenCalled(); // açık klasik: izo sahne hiç kurulmaz
    cleanup();
    window.history.replaceState(null, "", "/");
    mountDao(GOZLEM_CALISAN); // tercih/bayrak yok: varsayılan izo
    await vi.waitFor(() => expect(izoMu()).toBe(true));
    cleanup();
    izoKur.mockClear();
    await izoAc();
    await vi.waitFor(() => expect(izoKur).toHaveBeenCalled()); // sahne harita paketiyle kurulur (Y-r2-1)
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); }); // gözlem ve kare sınırı otursun
    const n = izoKur.mock.calls.length;
    const once = tuval.son.sahne;
    act(() => tuval.son.onSec({ kind: "city", ref: "0" })); // seçim sahneyi yeniden kurmaz (useMemo)
    expect(izoKur.mock.calls.length).toBe(n);
    expect(tuval.son.sahne).toBe(once);
    expect(izoSahne().binalar.length).toBeGreaterThan(0);
  });

  it("SehirTuvaliKap_manifest_ya_da_gorselBoy_almaz", async () => {
    await izoAc();
    const anahtarlar = Object.keys(tuval.son);
    expect(anahtarlar).not.toContain("manifest");
    expect(anahtarlar).not.toContain("gorselBoy");
  });

  it("tablo_her_zaman_klasik_sahne_listesi", async () => {
    await izoAc();
    expect("kaynak" in tuval.son.tabloSahnesi).toBe(false);
    expect(tuval.son.tabloSahnesi.kademe).toBeUndefined(); // klasik yerleşim (izo: true değil)
    expect(tuval.son.tabloSahnesi.binalar.map((b) => b.id).sort()).toEqual(izoSahne().kaynak.binalar.map((b) => b.id).sort());
  });

  it("izo_klasik_dususte_etkin_sahne_yeniden_kurulur", async () => {
    await izoAc();
    expect(tuval.son.onSpriteHatasi).toBeTypeOf("function");
    act(() => tuval.son.onSpriteHatasi!());
    await vi.waitFor(() => expect(izoMu()).toBe(false));
    expect(tuval.son.sahne.kademe).toBeUndefined(); // klasik yerleşim
    expect(tuval.son.sahne.binalar.length).toBeGreaterThan(0);
  });

  it("paneller_lejant_ben_ilanVeren_secimGecerli_etkin_sahneden", async () => {
    await izoAc(GOZLEM_AHIR);
    await vi.waitFor(() => expect(izoSahne().kaynak.ben).toEqual({ binaId: "ahir", neden: "ahir" })); // ben izo sahnenin kaynağında
    const ahir = izoSahne().binalar.find((b) => b.id === izoSahne().kaynak.ahir.id)!;
    act(() => tuval.son.onSec(ahir.ref));
    expect(sagPanel(t("harita.ahir")).getByRole("button", { name: t("dao.ahir.cik") })).toBeEnabled();
    expect(tuval.son.secili).toEqual(ahir.ref);
  });

  it("tablo_isletme_kur_secenekleri_etkin_sahnenin_bosParsellerinden", async () => {
    await izoAc();
    await vi.waitFor(() => expect(izoSahne().bosHucreler.length).toBeGreaterThan(0));
    const izoIdler = izoSahne().kaynak.bosParseller!.map((p) => p.id);
    expect(izoIdler).toEqual(izoSahne().bosHucreler.map((b) => b.parselId)); // domino ankraj kimlikleri
    // tuvale verilen etkin kaynak ile tabloya verilen klasik sahne aynı parsel kümesini kullanmaz
    expect(tuval.son.tabloSahnesi.bosParseller!.map((p) => p.id)).not.toEqual(izoIdler);
  });

  /** İzo sahnede kur hedefi bir dolgudur (konut, park, boş arsa): panel başlığı türü söyler, "Boş parsel" demez. */
  const izoParselBasligi = (id: string): string => {
    const tur = izoModul.parselTuruOf(izoSahne(), id);
    expect(tur).not.toBe("bos");
    return t(`dao.baglam.parsel_${tur as "konut"}`);
  };

  it("mod_degisince_gecersiz_parsel_secimi_temizlenir", async () => {
    await izoAc();
    await vi.waitFor(() => expect(izoSahne().bosHucreler.length).toBeGreaterThan(0));
    const id = izoSahne().bosHucreler[0]!.parselId;
    act(() => tuval.son.onSec({ kind: "parsel", ref: id }));
    const baslik = izoParselBasligi(id);
    expect(sagPanel(baslik)).toBeTruthy();
    act(() => tuval.son.onSpriteHatasi!());
    await vi.waitFor(() => expect(izoMu()).toBe(false));
    expect(screen.queryByRole("complementary", { name: baslik })).toBeNull();
    expect(tuval.son.secili).toBeNull();
  });

  it("tablodan_secilen_parsel_izo_sahnede_gecerli", async () => {
    await izoAc();
    await vi.waitFor(() => expect(izoSahne().bosHucreler.length).toBeGreaterThan(0));
    const id = izoSahne().kaynak.bosParseller![0]!.id;
    act(() => tuval.son.onSec({ kind: "parsel", ref: id })); // tablo da aynı onSec'i çağırır
    expect(sagPanel(izoParselBasligi(id)).getByRole("button", { name: t("dao.karar.kur") })).toBeEnabled();
    expect(tuval.son.secili).toEqual({ kind: "parsel", ref: id });
  });

  it("kamera_odagi_etkin_sahneden", async () => {
    await izoAc();
    // sığdırma komutu izo sahnenin dünya ölçüsüne göre tuvalde işlenir: komut yolu etkin sahneyle birlikte iner
    expect(izoSahne().dunya.genislik).toBeGreaterThan(0);
    expect(tuval.son.komut).toBeUndefined();
    act(() => screen.getByRole("button", { name: t("harita.sigdir") }).click());
    expect(tuval.son.komut).toMatchObject({ tur: "sigdir" });
    expect(izoMu()).toBe(true);
  });
});
