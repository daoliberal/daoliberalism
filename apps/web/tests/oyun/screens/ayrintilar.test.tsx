import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { ESLEME, KABUK_KATMANLARI, SEKMELER, type Kosul, type Yuzey } from "@/oyun/screens/canli/ayrintilarEslemesi";
import { Canli } from "@/oyun/screens/canli/Canli";
import { sifirlaKapat } from "@/oyun/screens/canli/sifirlaDurumu";
import { rehberKosuIsaretle } from "@/oyun/screens/rehber/rehberDurumu";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { CityRow, SimEvent } from "@/oyun/sim/types";
import { cityRows } from "../helpers/sehirZincirVeri";
import { ayrintilariAc, ayrintilariKapat, mountCanli, packets, state } from "../helpers/canliMount";
import { createFakeSource } from "../helpers/fakeSource";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  degistirKapat();
  sifirlaKapat();
  window.dispatchEvent(new Event("pointerdown")); // bekleyen "Şartı değiştir" odak isteği biter (sonraki teste sızmasın)
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const SRC = path.resolve(import.meta.dirname, "../../../src/oyun/screens/canli");
const kaynak = (dosya: string): string => readFileSync(path.join(SRC, dosya), "utf-8");

const dikisOlayi = (): SimEvent => ({
  type: "world_event",
  event: { id: "version:2:2:x", week: 2, kind: "neutral", textKey: "event.version", params: { hafta: 2, mod: "live" }, critical: false, sector: null, rule_ids: [] },
});

/** Satırın koşulunu kurar: koşu ekranı açılır ve pencere (ya da kabuk) aranmaya hazırdır. */
function kur(kosul: Kosul | undefined) {
  switch (kosul) {
    case "bitti": return mountCanli([state({ status: "ended", week: 3 }), ...packets(3)]);
    case "hesaplaniyor": return mountCanli([state({ computing: true }), ...packets(3)]);
    case "dikis": return mountCanli([state(), ...packets(3), dikisOlayi()]);
    case "ipucu":
      rehberKosuIsaretle("r", true); // rehberli koşu: ilk haftalarda ipucu
      return mountCanli([state({ status: "paused", week: 2 }), ...packets(2)]);
    case "kosuyok":
      return render(
        <SimSourceProvider source={createFakeSource([state()])}>
          <Canli runId="r" restore={{ status: "missing" }} />
        </SimSourceProvider>,
      );
    case "hata": {
      const m = mountCanli([state(), ...packets(3)]);
      return { ...m, sonra: () => act(() => m.src.emit("r", { type: "error", messageKey: "hata.degisiklik_basarisiz" })) };
    }
    default: return mountCanli([state(), ...packets(3)]);
  }
}

const bul = (kok: HTMLElement, y: Yuzey): HTMLElement => {
  const ad = t(y.ad, y.param);
  switch (y.rol) {
    case "text": return within(kok).getByText(ad);
    case "slider": return within(kok).getByRole("slider", { name: ad });
    default: return within(kok).getByRole(y.rol, { name: ad });
  }
};

describe("Ayrıntılar: eşleme tablosu (her yüzeye rol + ad ile ulaşılır)", () => {
  it("sekmeler_tabloda_tanimli_ve_her_sekmede_en_az_bir_yuzey_var", () => {
    for (const s of SEKMELER) expect(ESLEME.some((y) => y.sekme === s.id), s.id).toBe(true);
    for (const y of ESLEME) if (y.sekme !== null) expect(SEKMELER.some((s) => s.id === y.sekme), y.yuzey).toBe(true);
  });

  const pencerede = ESLEME.filter((y) => y.sekme !== null);
  it.each(pencerede.map((y) => [y.yuzey, y] as const))("pencere_%s", async (_ad, y) => {
    const m = kur(y.kosul);
    const sekme = SEKMELER.find((s) => s.id === y.sekme)!;
    const pencere = await ayrintilariAc(t(sekme.baslik));
    if ("sonra" in m) m.sonra();
    expect(await within(pencere).findByRole("tab", { name: t(sekme.baslik), selected: true })).toBeInTheDocument();
    expect(bul(pencere, y)).toBeInTheDocument();
  });

  const kabukta = ESLEME.filter((y) => y.sekme === null);
  it.each(kabukta.map((y) => [y.yuzey, y] as const))("kabuk_%s", async (_ad, y) => {
    kur(y.kosul);
    expect(y.yer, "kabuk satırı yerini söylemeli").toBeTruthy();
    await waitFor(() => expect(bul(document.body, y)).toBeInTheDocument());
    if (y.kosul === "kosuyok") expect(screen.queryByRole("button", { name: t("ayrintilar.dugme") })).toBeNull(); // koşu yok: pencere de yok
    if (y.kosul === "ipucu") expect(screen.getByText(t("rehber.ipucu.a"))).toBeInTheDocument();
  });

  it("ipucu_ve_kosuyok_satirlari_tabloda_kabuk_olarak_var", () => {
    for (const ad of ["Ipucu", "KosuYok"]) {
      const y = ESLEME.find((x) => x.yuzey === ad);
      expect(y, ad).toBeDefined();
      expect(y!.sekme).toBeNull();
      expect(y!.yer, ad).toBeTruthy();
    }
  });

  it("kabuk_katmanlari_kodda_var_ve_pencere_icinden_biri_kapidir", () => {
    const dosyalar: Record<(typeof KABUK_KATMANLARI)[number], string> = {
      BitisDiyalogu: "BitisDiyalogu.tsx", SifirdanBaslat: "SifirdanBaslat.tsx", Hesaplaniyor: "Hesaplaniyor.tsx", DurduDiyalogu: "../rehber/RehberBandi.tsx",
      Ipucu: "../rehber/RehberBandi.tsx", KosuYok: "KosuYok.tsx", Cekmece: "Cekmece.tsx", DunyaGorunumu: "dunya/DunyaGorunumu.tsx",
    };
    for (const k of KABUK_KATMANLARI) expect(kaynak(dosyalar[k]), k).toContain(`export function ${k}`);
  });

  it("tasinan_yuzeyler_yalniz_pencerede_cizilir_sayfa_govdesi_onlari_icermez", () => {
    const sayfa = kaynak("Canli.tsx");
    const pencere = kaynak("Ayrintilar.tsx");
    for (const b of ["Gostergeler", "BuHaftaSeridi", "PiyasaPaneli", "NufusPaneli", "ParaDagilimiPaneli", "IsgucuAkislariPaneli", "DunyaKurulumuPaneli", "ZincirGorunumu", "OlayAkisi", "NedenSonuc", "NeOlmuyor", "ZamanCizgisi", "SaglikBasligi", "IssizlikPaneli", "IseAlimPaneli", "TuketimPaneli"]) {
      expect(sayfa, `${b} sayfada`).not.toMatch(new RegExp(`<${b}[\\s/>]`));
      expect(pencere, `${b} pencerede`).toMatch(new RegExp(`<${b}[\\s/>]`));
    }
    // Karar günlüğü ve Şart okuyucusu menü/Şart panelinden de açılır (kabuk diyalogları); pencerede de vardır: iki kapı, tek bileşen.
    for (const b of ["KararGunlugu", "SartOkuyucu"]) {
      expect(sayfa, `${b} kabukta`).toMatch(new RegExp(`<${b}[\\s/>]`));
      expect(pencere, `${b} pencerede`).toMatch(new RegExp(`<${b}[\\s/>]`));
    }
  });
});

describe("Ayrıntılar: pencere davranışı", () => {
  it("menu_dugmesi_acar_sekmeli_pencere_esc_kapatir_ve_odak_dugmeye_doner", async () => {
    kur(undefined);
    const dugme = await screen.findByRole("button", { name: t("ayrintilar.dugme") });
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    const pencere = await ayrintilariAc();
    expect(within(pencere).getAllByRole("tab")).toHaveLength(SEKMELER.length);
    expect(within(pencere).getByRole("tabpanel")).toBeInTheDocument();
    fireEvent.keyDown(pencere, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    expect(document.activeElement).toBe(dugme);
  });

  it("sekme_ve_olay_suzgeci_kapanip_acilinca_korunur", async () => {
    kur(undefined);
    await ayrintilariAc(t("ayrintilar.sekme.piyasa"));
    ayrintilariKapat();
    const pencere = await ayrintilariAc();
    expect(within(pencere).getByRole("tab", { name: t("ayrintilar.sekme.piyasa"), selected: true })).toBeInTheDocument();
  });

  it("kapsam_secici_yalniz_sehir_suzgecli_sekmelerde_ve_sehir_secince_basili", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.genel"));
    const grup = within(pencere).getByRole("group", { name: t("ayrintilar.kapsam") });
    expect(within(grup).getByRole("button", { name: t("ayrintilar.kapsam_dunya") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(grup).getByRole("button", { name: "Cem" }));
    expect(within(grup).getByRole("button", { name: "Cem" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(pencere).getByRole("tab", { name: t("ayrintilar.sekme.olaylar") }));
    expect(within(pencere).queryByRole("group", { name: t("ayrintilar.kapsam") })).toBeNull();
  });

  it("eski_zincir_rotasi_pencereyi_zincir_sekmesinde_acar", async () => {
    window.location.hash = "#/canli/r/zincir";
    kur(undefined);
    const pencere = await screen.findByRole("dialog", { name: t("ayrintilar.baslik") });
    expect(within(pencere).getByRole("tab", { name: t("ayrintilar.sekme.zincir"), selected: true })).toBeInTheDocument();
    expect(await within(pencere).findByRole("region", { name: t("canli.zincir.baslik") })).toBeInTheDocument();
  });

  it("koşu_sekmesi_sartiyi_degistir_pencereyi_kapatir_ve_paneli_acar", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("degistir.dugme") }));
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    expect(await screen.findByRole("heading", { name: t("degistir.baslik", { a: 1, b: 2 }) })).toBeInTheDocument();
  });

  it("koşu_sekmesi_sifirdan_baslat_ve_sart_oku_kendi_diyaloglarini_acar", async () => {
    kur(undefined);
    let pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("canli.sifirla.baslik") }));
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    const sifirla = await screen.findByRole("dialog", { name: t("canli.sifirla.baslik") });
    fireEvent.click(within(sifirla).getByRole("button", { name: t("canli.sifirla.vazgec") }));
    pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("ustcubuk.sart_dugme") }));
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    expect(await screen.findByRole("dialog")).toBeInTheDocument(); // SartOkuyucu
  });

  it("koşu_sekmesi_ara_durum_sonuc_sayfasina_gider", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("ustcubuk.ara_durum") }));
    expect(window.location.hash).toBe("#/sonuc/r");
  });

  it("biten_kosuda_bitis_karti_pencereden_bitis_diyalogunu_acar", async () => {
    kur("bitti");
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    expect(within(pencere).queryByRole("button", { name: t("degistir.dugme") })).toBeNull(); // bitti: Şartı değiştir yok
    expect(within(pencere).getByRole("button", { name: t("ustcubuk.sonuc") })).toBeInTheDocument();
    fireEvent.click(within(pencere).getByRole("button", { name: t("canli.bitis.ac") }));
    expect(screen.queryByRole("dialog", { name: t("ayrintilar.baslik") })).toBeNull();
    expect(await screen.findByRole("dialog", { name: t("bitis.baslik", { n: 3 }) })).toBeInTheDocument();
  });
});

describe("Ayrıntılar: yüzen pencere biçimi", () => {
  it("pencere_sehrin_ustunde_yuzer_ve_opak_tam_ekran_kaplama_degildir", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc();
    expect(pencere.className).toMatch(/yuzen/);
    expect(pencere.parentElement!.className).toMatch(/yuzen/);
    expect(pencere.closest('[class*="kok"]')).not.toBeNull(); // ekran renk takma adları pencereye ulaşır
  });

  it("stil_kaynaginda_cam_zemin_takma_adi_var_color_mix_ve_telefon_alt_sayfasi", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../../src/oyun/ui/Diyalog.module.css"), "utf-8");
    expect(css).toContain("var(--ekran-cam)");
    expect(css).not.toContain("color-mix");
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*yuzen/);
  });

  it("telefon_blogunda_yuzen_kurallar_kaplama_ve_diyalog_kurallarindan_sonra_yazilir", () => {
    // Aynı özgüllükte sonraki kural kazanır: yüzen padding/radius kuralları genel `.kaplama`/`.diyalog` kurallarını ezmeli (aksi halde ezilirdi).
    const css = readFileSync(path.resolve(import.meta.dirname, "../../../src/oyun/ui/Diyalog.module.css"), "utf-8");
    const blok = css.slice(css.indexOf("@media (max-width: 720px)"));
    const sira = (sinif: string): number => blok.indexOf(`.${sinif} {`);
    expect(sira("kaplama")).toBeGreaterThanOrEqual(0);
    expect(sira("diyalog")).toBeGreaterThanOrEqual(0);
    expect(sira("yuzenKaplama")).toBeGreaterThan(sira("kaplama"));
    expect(sira("yuzenKaplama")).toBeGreaterThan(sira("diyalog"));
    expect(sira("yuzenDiyalog")).toBeGreaterThan(sira("diyalog"));
  });

  it("yuzen_pencere_ust_serit_yuksekliginin_altindan_baslar", () => {
    // Zaman kartı iki satırdır (≈ 76 px x 2): pencere onu örtmez. Pencere `top`ı belirteç hesabıdır (sabit piksel yok).
    const css = readFileSync(path.resolve(import.meta.dirname, "../../../src/oyun/ui/Diyalog.module.css"), "utf-8");
    expect(css).toContain("top: calc(var(--space-140) + var(--space-16))");
  });
});

describe("Ayrıntılar: katman kapanınca odak Ayrıntılar düğmesine döner", () => {
  const dugme = () => screen.getByRole("button", { name: t("ayrintilar.dugme") });

  it("sifirdan_baslat_kapaninca", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("canli.sifirla.baslik") }));
    const d = await screen.findByRole("dialog", { name: t("canli.sifirla.baslik") });
    fireEvent.click(within(d).getByRole("button", { name: t("canli.sifirla.vazgec") }));
    expect(screen.queryByRole("dialog")).toBeNull(); // pencere kendiliğinden geri açılmaz
    expect(document.activeElement).toBe(dugme());
  });

  it("bitis_diyalogu_kapaninca", async () => {
    kur("bitti");
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("canli.bitis.ac") }));
    const d = await screen.findByRole("dialog", { name: t("bitis.baslik", { n: 3 }) });
    fireEvent.click(within(d).getByRole("button", { name: t("diyalog.kapat") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(dugme());
  });

  it("sart_okuyucu_kapaninca", async () => {
    kur(undefined);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    fireEvent.click(within(pencere).getByRole("button", { name: t("ustcubuk.sart_dugme") }));
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("button", { name: t("diyalog.kapat") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(dugme());
  });
});

describe("Ayrıntılar: Genel sekmesi şehir kapsamı ve kilit dalları (eski Şehir/Dünya sayfası testlerinden)", () => {
  const gosterge = (id: string): HTMLElement => document.querySelector(`[data-gosterge="${id}"]`) as HTMLElement;
  const satirlar = (ek: Partial<CityRow> & { index: number }[] | never[] = []) => cityRows(3).map((r) => ({ ...r, ...((ek as unknown as { index: number }[]).find((e) => e.index === r.index) ?? {}) }));

  it("sehir_rotasinda_kapsam_sehir_degeri_dunya_secilince_dunya_degeri", async () => {
    window.location.hash = "#/canli/r/sehir-2";
    mountCanli([state(), ...packets(3, { cities: satirlar([{ index: 2, served: 0.68 }] as never) })]);
    const pencere = await ayrintilariAc("Genel");
    await waitFor(() => expect(gosterge("karsilama").textContent).toContain("%68")); // şehir değeri
    expect(within(pencere).getByRole("button", { name: "Cem" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(pencere).getByRole("button", { name: t("ayrintilar.kapsam_dunya") }));
    expect(gosterge("karsilama").textContent).toContain("%80"); // dünya değeri
  });

  it("bos_alan_olculmuyor_yazar_sayi_uydurulmaz", async () => {
    window.location.hash = "#/canli/r/sehir-1";
    mountCanli([state(), ...packets(3, { cities: satirlar([{ index: 1, cash: null, served: null }] as never) })]);
    await ayrintilariAc("Genel");
    await waitFor(() => expect(gosterge("kasa").textContent).toContain("ölçülmüyor"));
    expect(gosterge("karsilama").textContent).toContain("ölçülmüyor");
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it("sehir_yetenegi_yokken_kapsam_secicisi_cizilmez_yalniz_dunya", async () => {
    mountCanli([state(), ...packets(3, { cities: null, chain: null })], { kind: "replay", caps: {}, world: undefined, drawer: undefined });
    const pencere = await ayrintilariAc("Genel");
    expect(within(pencere).queryByRole("group", { name: t("ayrintilar.kapsam") })).toBeNull();
  });

  it("zincir_yetenegi_yokken_zincir_sekmesi_neden_notu_gosterir_varken_zincir", async () => {
    mountCanli([state(), ...packets(3, { cities: null, chain: null })], { kind: "replay", caps: {}, world: undefined, drawer: undefined });
    await ayrintilariAc(t("ayrintilar.sekme.zincir"));
    expect(screen.getByText("Bu kayıtta zincir bilgisi yok")).toBeInTheDocument();
    cleanup();
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc(t("ayrintilar.sekme.zincir"));
    expect(await screen.findByRole("region", { name: t("canli.zincir.baslik") })).toBeInTheDocument();
  });
});

