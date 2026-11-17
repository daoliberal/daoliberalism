import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OyunEkrani } from "@/oyun/ekran/OyunEkrani";
import { EKRAN_STILI } from "@/oyun/ekran/ekranStili";
import { t } from "@/oyun/copy/t";
import { SEHIRLER, genislikAyarla } from "./ekranYardim";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Ek = Partial<Parameters<typeof OyunEkrani>[0]>;
function ekran(ek: Ek = {}, tuvalTik?: () => void) {
  return (
    <OyunEkrani
      tuval={<div data-testid="tuval" onClick={tuvalTik}>harita</div>}
      sehirler={SEHIRLER}
      sehir={0}
      onSehir={() => undefined}
      ustSol={<div>ust-sol-yuva</div>}
      ustOrta={<div>ust-orta-yuva</div>}
      menu={<button>menu-yuva</button>}
      solPanel={{ baslik: "Şehir özeti", icerik: <p>sol-icerik</p> }}
      sagPanel={null}
      olaylar={[{ id: 1, metin: "Birinci olay" }, { id: 2, metin: "İkinci olay" }]}
      haritaKontrolleri={<button>kontrol-yuva</button>}
      {...ek}
    />
  );
}

describe("OyunEkrani yuvaları", () => {
  it("yuvalar_rol_ve_adla_bulunur", () => {
    genislikAyarla(1600);
    render(ekran());
    expect(screen.getByRole("region", { name: t("ekran.ana") })).toBeInTheDocument();
    expect(screen.getByText("harita")).toBeInTheDocument();
    for (const m of ["ust-sol-yuva", "ust-orta-yuva"]) expect(screen.getByText(m)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "menu-yuva" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "kontrol-yuva" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Şehir özeti" })).toBeInTheDocument();
    const log = screen.getByRole("log", { name: t("ekran.olay_baslik") });
    expect(within(log).getByText("Birinci olay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(SEHIRLER[0].ad) })).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("kok_ekranRenkleri_kok_sinifini_tasir", () => {
    genislikAyarla(1600);
    const { container } = render(ekran());
    expect((container.firstElementChild as HTMLElement).className).toMatch(/\bkok\b/);
  });

  it("kabuk_kendi_erisilebilir_basligini_tasir", () => {
    genislikAyarla(1600);
    render(ekran());
    expect(screen.getByRole("heading", { level: 2, name: SEHIRLER[0].ad })).toBeInTheDocument();
  });

  it("kaynakta_bina_verisi_yoksa_not_gorunur", () => {
    genislikAyarla(1600);
    const { rerender } = render(ekran());
    expect(screen.queryByText(t("harita.bina_yok"))).toBeNull();
    rerender(ekran({ binaVerisiYok: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Bina verisi bu kaynakta yok");
  });
});

describe("OyunEkrani paneller", () => {
  it("sol_panel_aria_expanded_ve_daraltilir_masaustunde_acik", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    render(ekran());
    const dugme = screen.getByRole("button", { name: t("ekran.panel_daralt") });
    expect(dugme).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("sol-icerik")).toBeVisible();
    await user.click(dugme);
    const ac = screen.getByRole("button", { name: t("ekran.panel_ac") });
    expect(ac).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("sol-icerik")).not.toBeVisible();
    await user.click(ac);
    expect(screen.getByText("sol-icerik")).toBeVisible();
  });

  it("sol_panel_1280_ve_alti_kapali_baslar", () => {
    genislikAyarla(1280);
    render(ekran());
    expect(screen.getByRole("button", { name: t("ekran.panel_ac") })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("sol-icerik")).not.toBeVisible();
  });

  it("sag_panel_secim_yokken_kapali_secimle_acilir_ve_kapanir", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const { rerender } = render(ekran({ sagPanel: null }));
    expect(screen.queryByText("sag-icerik")).toBeNull();
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    const kapat = vi.fn();
    rerender(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <p>sag-icerik</p>, onKapat: kapat } }));
    const sag = screen.getByRole("complementary", { name: "Bina ayrıntısı" });
    expect(within(sag).getByText("sag-icerik")).toBeVisible();
    await user.click(within(sag).getByRole("button", { name: t("ekran.panel_kapat") }));
    expect(kapat).toHaveBeenCalledTimes(1);
  });

  it("escape_sag_paneli_kapatir", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const kapat = vi.fn();
    render(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <button>ic</button>, onKapat: kapat } }));
    await user.click(screen.getByRole("button", { name: "ic" }));
    await user.keyboard("{Escape}");
    expect(kapat).toHaveBeenCalledTimes(1);
  });

  // Sınır: jsdom'da isabet testi (hit-testing) yok; yalnız tuval ve panelin ayrı alt ağaçlar olduğu ve
  // kaplamanın pointer-events kuralı (ekranStili.test) denetlenir. Gerçek tıklama geçişi tarayıcıda doğrulanır.
  it("panel_disina_tiklama_tuvale_gider_panel_ici_gitmez", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const tik = vi.fn();
    render(ekran({}, tik));
    await user.click(screen.getByTestId("tuval"));
    expect(tik).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("sol-icerik"));
    expect(tik).toHaveBeenCalledTimes(1);
  });
});

describe("OyunEkrani telefon", () => {
  it("720_ve_altinda_paneller_alt_sayfa_olur", async () => {
    genislikAyarla(390);
    const user = userEvent.setup();
    const { rerender } = render(ekran());
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText("sol-icerik")).toBeNull();
    const ac = screen.getByRole("button", { name: t("ekran.panel_goster") });
    expect(ac).toHaveAttribute("aria-expanded", "false");
    await user.click(ac);
    const sayfa = screen.getByRole("region", { name: "Şehir özeti" });
    expect(within(sayfa).getByText("sol-icerik")).toBeVisible();
    await user.click(within(sayfa).getByRole("button", { name: t("ekran.alt_sayfa_kapat") }));
    expect(screen.queryByText("sol-icerik")).toBeNull();

    const kapat = vi.fn();
    rerender(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <p>sag-icerik</p>, onKapat: kapat } }));
    const sag = screen.getByRole("region", { name: "Bina ayrıntısı" });
    expect(within(sag).getByText("sag-icerik")).toBeVisible();
    await user.click(within(sag).getByRole("button", { name: t("ekran.alt_sayfa_kapat") }));
    expect(kapat).toHaveBeenCalledTimes(1);
  });
});

describe("OyunEkrani odak yönetimi", () => {
  it("telefon_alt_sayfa_odak_icerde_esc_kapatir_odak_tetikleyiciye_doner", async () => {
    genislikAyarla(390);
    const user = userEvent.setup();
    render(ekran());
    const ac = screen.getByRole("button", { name: t("ekran.panel_goster") });
    await user.click(ac);
    const sayfa = screen.getByRole("region", { name: "Şehir özeti" });
    expect(sayfa.contains(document.activeElement)).toBe(true);
    expect(ac).toHaveAttribute("aria-expanded", "true");
    expect(ac).toHaveAttribute("aria-controls", sayfa.id);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Şehir özeti" })).toBeNull();
    expect(ac).toHaveFocus();
  });

  it("telefon_pencere_buyuyunce_alt_sayfa_durumu_sol_paneli_acmaz", async () => {
    genislikAyarla(390);
    const user = userEvent.setup();
    const { rerender } = render(ekran());
    await user.click(screen.getByRole("button", { name: t("ekran.panel_goster") }));
    genislikAyarla(1600);
    rerender(ekran({ olaylar: [] }));
    // Masaüstü sol panel tercihi dokunulmadı: genişliğe göre açık kalır, alt sayfa durumu sızmaz (aria-expanded true = varsayılan açık).
    expect(screen.queryByRole("region", { name: "Şehir özeti" })).toBeNull();
    genislikAyarla(1280);
    rerender(ekran({ olaylar: [{ id: 9, metin: "x" }] }));
    expect(screen.getByRole("button", { name: t("ekran.panel_ac") })).toHaveAttribute("aria-expanded", "false");
  });

  it("telefon_sag_panel_odak_icerde_esc_kapatir", async () => {
    genislikAyarla(390);
    const user = userEvent.setup();
    const kapat = vi.fn();
    const tetik = document.createElement("button");
    document.body.append(tetik);
    tetik.focus();
    render(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <p>sag</p>, onKapat: kapat } }));
    expect(screen.getByRole("region", { name: "Bina ayrıntısı" }).contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(kapat).toHaveBeenCalledTimes(1);
    cleanup();
    expect(tetik).toHaveFocus();
    tetik.remove();
  });

  it("masaustu_sag_panel_odak_icerde_esc_her_yerde_kapatir_odak_doner", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const kapat = vi.fn();
    const tetik = document.createElement("button");
    document.body.append(tetik);
    tetik.focus();
    render(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <p>sag</p>, onKapat: kapat } }));
    expect(screen.getByRole("complementary", { name: "Bina ayrıntısı" }).contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(kapat).toHaveBeenCalledTimes(1);
    cleanup();
    expect(tetik).toHaveFocus();
    tetik.remove();
  });

  it("sehir_listesi_aciksa_esc_once_listeyi_kapatir_paneli_degil", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const kapat = vi.fn();
    render(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <p>sag</p>, onKapat: kapat } }));
    await user.click(screen.getByRole("button", { name: new RegExp(SEHIRLER[0].ad) }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(kapat).not.toHaveBeenCalled();
  });
});

describe("OyunEkrani: pencere yuvası ve yazı alanında Esc", () => {
  it("pencere_yuvasi_kabugun_icinde_cizilir", () => {
    genislikAyarla(1600);
    render(ekran({ pencere: <div role="dialog" aria-label="Sonuç penceresi">sonuc</div> }));
    expect(within(screen.getByRole("region", { name: t("ekran.ana") })).getByRole("dialog", { name: "Sonuç penceresi" })).toBeInTheDocument();
  });

  it("sag_panelde_yazi_alanindayken_esc_paneli_kapatmaz_alan_disinda_kapatir", async () => {
    genislikAyarla(1600);
    const user = userEvent.setup();
    const kapat = vi.fn();
    render(ekran({ sagPanel: { baslik: "Bina ayrıntısı", icerik: <><label>Miktar<input /></label><textarea aria-label="Not" /><button>Düğme</button></>, onKapat: kapat } }));
    await user.click(screen.getByLabelText("Miktar"));
    await user.keyboard("{Escape}");
    await user.click(screen.getByLabelText("Not"));
    await user.keyboard("{Escape}");
    expect(kapat).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Düğme" }));
    await user.keyboard("{Escape}");
    expect(kapat).toHaveBeenCalledTimes(1);
  });
});

describe("OyunEkrani: kilitli tuval, ipucu ve olay kapısı", () => {
  it("tuvalKilitli_tuvali_inert_yapar_ust_katmanlar_acik_kalir", () => {
    genislikAyarla(1600);
    const { rerender } = render(ekran());
    const tuval = screen.getByTestId("tuval").parentElement!;
    expect(tuval).not.toHaveAttribute("inert");
    rerender(ekran({ tuvalKilitli: true }));
    expect(tuval).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "menu-yuva" }).closest("[inert]")).toBeNull();
  });

  it("ipucu_olay_seridinin_ustunde_olay_kapisi_seridin_yaninda", async () => {
    genislikAyarla(1600);
    const ac = vi.fn();
    render(ekran({ ipucu: <p>kisa-ipucu</p>, olayKapisi: { ad: "Tüm olaylar", onAc: ac } }));
    const ipucu = screen.getByText("kisa-ipucu");
    const log = screen.getByRole("log", { name: t("ekran.olay_baslik") });
    expect(ipucu.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tüm olaylar" }));
    expect(ac).toHaveBeenCalledTimes(1);
  });

  it("olay_yokken_kapi_de_cizilmez", () => {
    genislikAyarla(1600);
    render(ekran({ olaylar: [], olayKapisi: { ad: "Tüm olaylar", onAc: () => undefined } }));
    expect(screen.queryByRole("button", { name: "Tüm olaylar" })).toBeNull();
  });
});

describe("OyunEkrani: yüzen öğelerin ölçülen payları", () => {
  it("onPay_alan_ve_yuzen_ogelerin_gercek_kutularindan_serbest_alani_bildirir", async () => {
    genislikAyarla(1600);
    const kutu = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      switch (this.getAttribute("data-pay")) {
        case "ust": return kutu(16, 16, 1408, 120);
        case "sol": return kutu(16, 100, 340, 500);
        case "sag": return kutu(1084, 100, 340, 500);
        case "alt": return kutu(16, 780, 560, 104);
        default: return kutu(0, 0, 1440, 900);
      }
    } as never);
    const onPay = vi.fn();
    render(ekran({ sagPanel: { baslik: "Sağ", icerik: <p>x</p>, onKapat: () => undefined }, onPay }));
    await waitFor(() => expect(onPay).toHaveBeenCalled());
    const p = onPay.mock.calls.at(-1)![0];
    const a = EKRAN_STILI.payAralik;
    expect(p).toEqual({ ust: 136 + a, alt: 900 - 780 + a, sol: 356 + a, sag: 1440 - 1084 + a });
  });

  it("panel_yokken_o_kenarin_payi_sifirdir", async () => {
    genislikAyarla(1600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return (this.getAttribute("data-pay") === "ust" ? { left: 0, top: 0, width: 1440, height: 80, right: 1440, bottom: 80 } : { left: 0, top: 0, width: 1440, height: 900, right: 1440, bottom: 900 }) as DOMRect;
    });
    const onPay = vi.fn();
    render(ekran({ solPanel: null, sagPanel: null, olaylar: [], haritaKontrolleri: undefined, onPay }));
    await waitFor(() => expect(onPay).toHaveBeenCalled());
    const p = onPay.mock.calls.at(-1)![0];
    expect(p.sol).toBe(0);
    expect(p.sag).toBe(0);
  });
});

