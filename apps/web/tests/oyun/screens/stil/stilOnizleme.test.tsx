import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOYLAR, SABLONLAR, VARSAYILAN_KATALOG } from "@/oyun/harita/binaKatalogu";
import { parseHash, toHash } from "@/oyun/hooks/useHashRoute";
import { StilOnizleme } from "@/oyun/screens/stil/StilOnizleme";
import { kokTakmaAdlari, stilAcik } from "@/oyun/screens/stil/stilYardim";
import { t } from "@/oyun/copy/t";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect data-katman="duvar" width="10" height="10"/></svg>`;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => SVG })));
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:x/${n++}`, revokeObjectURL: () => undefined }));
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("stilAcik", () => {
  it("gelistirmede_acik_uretimde_yalniz_stil_1_ile", () => {
    expect(stilAcik()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(stilAcik()).toBe(false);
    window.history.replaceState(null, "", "/oyun?stil=1");
    expect(stilAcik()).toBe(true);
    window.history.replaceState(null, "", "/oyun#/stil?stil=1");
    expect(stilAcik()).toBe(true);
    window.history.replaceState(null, "", "/oyun?stil=0");
    expect(stilAcik()).toBe(false);
  });
});

describe("rota", () => {
  it("stil_rotasi_sorgu_ekiyle_de_taninir", () => {
    expect(parseHash("#/stil")).toEqual({ name: "stil" });
    expect(parseHash("#/stil?stil=1")).toEqual({ name: "stil" });
    expect(toHash({ name: "stil" })).toBe("#/stil");
  });
});

describe("StilOnizleme", () => {
  it("uretimde_stil_1_yoksa_kapali_notu", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<StilOnizleme />);
    expect(screen.getByText(t("stil.kapali"))).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("her_sablon_boy_icin_yukleyiciden_gorsel_ve_katalog_kaydi", async () => {
    const { container } = render(<StilOnizleme />);
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(SABLONLAR.length * BOYLAR.length));
    // Gerçek yol: katmanlı svg getirilir (yükleyici getir), kayıt satırı katalogdan gelir.
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("/oyun-harita/sablonlar/hammadde-1.svg"), expect.anything());
    const k = VARSAYILAN_KATALOG.hammadde[1];
    const kart = screen.getByTestId("stil-hammadde-1");
    expect(kart.textContent).toContain(k.dosya);
    expect(kart.textContent).toContain(k.tur);
    expect(kart.textContent).toContain(`${k.capa.x}`);
    expect(kart.textContent).toContain(`${k.taban.g}`);
    expect(container.querySelector("img")!.getAttribute("src")).toMatch(/^blob:/);
  });

  it("kok_sinifini_tasir_ve_tema_gecisi_yukleyiciyi_yeniden_calistirir", async () => {
    const { container } = render(<StilOnizleme />);
    expect(container.querySelector(".kok")).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(28));
    const once = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.tema_koyu") }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(once));
    expect(screen.getByRole("button", { name: t("ustcubuk.tema_acik") })).toBeTruthy();
  });

  it("koyu_temada_resim_kaydi_dosyaKoyu_kullanir", async () => {
    const katalog = structuredClone(VARSAYILAN_KATALOG);
    katalog.hizmet[2] = { ...katalog.hizmet[2], tur: "resim", dosya: "ozel/h2.png", dosyaKoyu: "ozel/h2-koyu.png" };
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<StilOnizleme katalog={katalog} />);
    await waitFor(() => expect(container.querySelector('[data-testid="stil-hizmet-2"] img')).toBeTruthy());
    expect(container.querySelector('[data-testid="stil-hizmet-2"] img')!.getAttribute("src")).toContain("/oyun-harita/ozel/h2-koyu.png");
  });

  it("dosya_yuklenemezse_o_kartta_hata_notu", async () => {
    const katalog = structuredClone(VARSAYILAN_KATALOG);
    katalog.lonca[1] = { ...katalog.lonca[1], dosya: "yok/lonca.svg" };
    vi.stubGlobal("fetch", vi.fn(async (yol: string) => (yol.includes("yok/") ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => SVG })));
    render(<StilOnizleme katalog={katalog} />);
    await waitFor(() => expect(screen.getByTestId("stil-lonca-1").textContent).toContain(t("stil.dosya_yuklenemedi")));
    expect(screen.getByTestId("stil-lonca-2").querySelector("img")).toBeTruthy();
  });
});

describe("kokTakmaAdlari", () => {
  it("kok_kuralindaki_takma_adlari_dondurur", () => {
    const st = document.createElement("style");
    st.textContent = `.denemeKok { --harita-a: red; --ekran-b: blue; color: red; } .baska { --harita-x: red; }`;
    document.head.appendChild(st);
    expect(kokTakmaAdlari(document.styleSheets, "denemeKok")).toEqual(["--harita-a", "--ekran-b"]);
    st.remove();
  });
  it("sayfada_ekranRenkleri_takma_adlari_listelenir", async () => {
    render(<StilOnizleme />);
    await waitFor(() => expect(screen.getAllByTestId("stil-takma-ad").length).toBeGreaterThan(40));
    expect(screen.getAllByTestId("stil-takma-ad").some((e) => e.textContent?.includes("--harita-grup-imalat"))).toBe(true);
  });
});

describe("GORSEL-DEGISTIRME.md", () => {
  it("kilavuz_katalog_alanlarini_ve_onizleme_adresini_anlatir", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const md = fs.readFileSync(path.resolve(__dirname, "../../../../src/oyun/harita/GORSEL-DEGISTIRME.md"), "utf8");
    for (const s of ["public/oyun-harita", "capa", "taban", "dosyaKoyu", "tur:", "oyun?stil=1#/stil", "ekranRenkleri.module.css", "tokens.css", "saydam", "VARSAYILAN_KATALOG"]) expect(md, s).toContain(s);
  });
});

describe("düzeltme turu 1", () => {
  it("kilavuzdaki_dosya_yollari_gercekten_var", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const web = path.resolve(__dirname, "../../../..");
    const md = fs.readFileSync(path.join(web, "src/oyun/harita/GORSEL-DEGISTIRME.md"), "utf8");
    const yollar = [...md.matchAll(/`((?:apps\/web\/)?(?:src|public)\/[\w./-]+)`/g)].map((m) => m[1]!.replace(/^apps\/web\//, ""));
    expect(yollar.length).toBeGreaterThan(3);
    for (const y of yollar) expect(fs.existsSync(path.join(web, y)), y).toBe(true);
  });

  it("blob_adresleri_tema_degisince_ve_sokulunce_serbest_birakilir", async () => {
    const revoke = vi.fn();
    let n = 0;
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:x/${n++}`, revokeObjectURL: revoke }));
    const { container, unmount } = render(<StilOnizleme />);
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(28));
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.tema_koyu") }));
    await waitFor(() => expect(revoke).toHaveBeenCalled());
    const tema = revoke.mock.calls.length;
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(28));
    unmount();
    expect(revoke.mock.calls.length).toBeGreaterThan(tema);
  });

  it("capa_noktasi_ve_taban_kutusu_resmin_ustune_bindirilir", async () => {
    const { container } = render(<StilOnizleme />);
    const kart = (): HTMLElement => screen.getByTestId("stil-hammadde-1");
    await waitFor(() => expect(kart().querySelector("img")).toBeTruthy());
    const img = kart().querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 100 });
    fireEvent.load(img);
    const sv = await waitFor(() => { const e = container.querySelector('[data-testid="stil-bindirme-hammadde-1"]'); expect(e).toBeTruthy(); return e!; });
    const k = VARSAYILAN_KATALOG.hammadde[1];
    expect(sv.querySelector("[data-capa]")).toBeTruthy();
    const kutu = sv.querySelector("[data-taban]")!;
    // oran: genişlik = taban.g / (taban.g * 1.4); yükseklik = taban.d / (taban.g * 1.4 * 1)
    expect(Number(kutu.getAttribute("width"))).toBeCloseTo(1 / 1.4, 3);
    expect(Number(kutu.getAttribute("height"))).toBeCloseTo(k.taban.d / (k.taban.g * 1.4), 3);
    expect(sv.getAttribute("style")).toBeNull();
  });
});

describe("rota kaynak seçiminden önce", () => {
  it("stil_sayfasi_sunucu_yokken_de_acilir", async () => {
    vi.resetModules();
    window.history.replaceState(null, "", "/oyun?kaynak=canli#/stil");
    const { OyunApp } = await import("@/oyun/OyunApp");
    render(<OyunApp />);
    expect(screen.getByRole("heading", { name: t("stil.baslik"), level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryAllByText(t("stil.baslik"))).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: t("app.baslik") })).toBeNull();
    expect(screen.queryByText(t("canli.sunucu_yok"), { exact: false })).toBeNull();
    window.location.hash = "";
  });
});
