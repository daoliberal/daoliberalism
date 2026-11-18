import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { CIHAZ_ANAHTARI, SAFARI_ANAHTARI, cihazUyarisiKapali, dokunmatikDarMi, kapaliYaz, webkitMi } from "@/oyun/ui/cihaz";
import { CihazUyarisi } from "@/oyun/ui/CihazUyarisi";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const ortam = (o: { coarse?: boolean; hoverYok?: boolean; mobil?: boolean | undefined; ua?: string; dokunma?: number }) => ({
  matchMedia: (q: string) => ({ matches: q.includes("pointer:coarse") ? o.coarse === true : q.includes("hover:none") ? (o.hoverYok ?? true) : false }),
  userAgentData: o.mobil === undefined ? undefined : { mobile: o.mobil },
  userAgent: o.ua ?? "",
  maxTouchPoints: o.dokunma ?? 0,
});

describe("dokunmatikDarMi (cihaz algilama)", () => {
  it("dokunmatik_ve_hover_yok_genislikten_bagimsiz_telefon_ve_buyuk_tablet_sayilir", () => {
    expect(dokunmatikDarMi(ortam({ coarse: true }))).toBe(true);
    expect(dokunmatikDarMi({ ...ortam({ coarse: true }), innerWidth: 1366 } as never)).toBe(true);        // iPad Pro yatay
  });
  it("userAgentData_mobile_tek_basina_yeter", () => {
    expect(dokunmatikDarMi(ortam({ mobil: true }))).toBe(true);
  });
  it("iPadOS_masaustu_kimligi_Macintosh_ve_cok_noktali_dokunma", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    expect(dokunmatikDarMi(ortam({ ua, dokunma: 5 }))).toBe(true);
    expect(dokunmatikDarMi(ortam({ ua, dokunma: 0 }))).toBe(false);           // gercek Mac
  });
  it("masaustu_ve_hover_destekleyen_dokunmatik_dizustu_uyarmaz", () => {
    expect(dokunmatikDarMi(ortam({ coarse: false }))).toBe(false);
    expect(dokunmatikDarMi(ortam({ coarse: true, hoverYok: false }))).toBe(false);
    expect(dokunmatikDarMi(ortam({ mobil: false }))).toBe(false);
  });
  it("matchMedia_yoksa_uyarmaz", () => {
    expect(dokunmatikDarMi({})).toBe(false);
  });
});

describe("webkitMi", () => {
  it("safari_ve_ios_tarayicilari_evet_chromium_ve_firefox_hayir", () => {
    expect(webkitMi("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")).toBe(true);
    expect(webkitMi("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(webkitMi("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")).toBe(false);
    expect(webkitMi("Mozilla/5.0 (Windows NT 10.0; rv:125.0) Gecko/20100101 Firefox/125.0")).toBe(false);
  });
});

describe("kapatma tercihi", () => {
  it("kapatilinca_hatirlanir_ve_depolama_hatasinda_sessizce_calisir", () => {
    expect(cihazUyarisiKapali(CIHAZ_ANAHTARI)).toBe(false);
    kapaliYaz(CIHAZ_ANAHTARI);
    expect(cihazUyarisiKapali(CIHAZ_ANAHTARI)).toBe(true);
    expect(cihazUyarisiKapali(SAFARI_ANAHTARI)).toBe(false);
    const asil = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("erisim yok");
    };
    try {
      expect(cihazUyarisiKapali(CIHAZ_ANAHTARI)).toBe(false);
    } finally {
      Storage.prototype.getItem = asil;
    }
    const yaz = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("dolu");
    };
    try {
      expect(() => kapaliYaz(CIHAZ_ANAHTARI)).not.toThrow();
    } finally {
      Storage.prototype.setItem = yaz;
    }
  });
});

describe("CihazUyarisi", () => {
  it("metin_aynen_gorunur_oyun_engellenmez_kapatilabilir_ve_hatirlanir", async () => {
    const { unmount } = render(<CihazUyarisi gorunur />);
    expect(screen.getByText(t("cihaz.uyari"))).toBeInTheDocument();
    expect(t("cihaz.uyari")).toBe("Telefonda ve tablette uzun oyun desteklenmiyor; tarayıcı kapanabilir. Masaüstü önerilir.");
    await userEvent.click(screen.getByRole("button", { name: t("cihaz.kapat") }));
    expect(screen.queryByText(t("cihaz.uyari"))).toBeNull();
    unmount();
    render(<CihazUyarisi gorunur />);
    expect(screen.queryByText(t("cihaz.uyari"))).toBeNull();
  });

  it("cihaz_uygun_degilse_hic_cizilmez", () => {
    render(<CihazUyarisi gorunur={false} />);
    expect(screen.queryByText(t("cihaz.uyari"))).toBeNull();
  });
});
