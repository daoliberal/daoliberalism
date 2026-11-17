import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { GOZLEM_CALISAN } from "../helpers/daoVeri";
import { DAO_ADLAR, mountDao } from "../helpers/daoMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/dao/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DAO: Ekonomi penceresi (Kurucu Ayrıntılar, salt okunur)", () => {
  it("test_ekonomi_dugmesi_menu_ve_sehir_yaninda_pencereyi_acar", async () => {
    mountDao(GOZLEM_CALISAN);
    const ekran = within(await screen.findByRole("region", { name: t("ekran.ana") }));
    const dugme = await ekran.findByRole("button", { name: t("ekonomi.dugme") });
    expect(ekran.getByRole("button", { name: t("kurucu.menu.dugme") })).toBeInTheDocument();
    expect(ekran.getByRole("button", { name: /Şehir: Közlüdere/ })).toBeInTheDocument();
    expect(ekran.queryByRole("button", { name: t("ayrintilar.dugme") })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(dugme);
    const pencere = within(await screen.findByRole("dialog"));
    expect(pencere.getByRole("heading", { name: t("ekonomi.baslik") })).toBeInTheDocument();
    // göstergeler, grafikler ve tablolar: Genel sekmesinin yüzeyleri
    expect(pencere.getByRole("region", { name: t("canli.gostergeler") })).toBeInTheDocument();
    fireEvent.click(pencere.getByRole("tab", { name: t("ayrintilar.sekme.nufus") }));
    expect(pencere.getByRole("region", { name: t("canli.nufus.baslik") })).toBeInTheDocument();
  });

  it("test_ekonomi_salt_okunur_kosu_ve_sart_kontrolleri_yok", async () => {
    mountDao(GOZLEM_CALISAN);
    fireEvent.click(await within(await screen.findByRole("region", { name: t("ekran.ana") })).findByRole("button", { name: t("ekonomi.dugme") }));
    const pencere = within(await screen.findByRole("dialog"));
    const sekmeler = pencere.getAllByRole("tab").map((x) => x.textContent);
    expect(sekmeler).not.toContain(t("ayrintilar.sekme.kosu"));
    expect(sekmeler).not.toContain(t("ayrintilar.sekme.zaman"));
    for (const ad of ["degistir.dugme", "ustcubuk.sart_dugme", "canli.sifirla.baslik", "ustcubuk.ara_durum", "canli.yeni_kosu"] as const) {
      expect(pencere.queryByRole("button", { name: t(ad) }), ad).toBeNull();
    }
    expect(pencere.queryByRole("slider")).toBeNull();
    // Olaylar sekmesinde de "şartı değiştir" bağlantısı yoktur
    fireEvent.click(pencere.getByRole("tab", { name: t("ayrintilar.sekme.olaylar") }));
    expect(pencere.queryByRole("button", { name: t("degistir.dugme") })).toBeNull();
  });

  it("test_ekonomi_kapaninca_pencere_kalkar_ve_dao_kontrolu_yerinde", async () => {
    mountDao(GOZLEM_CALISAN);
    fireEvent.click(await within(await screen.findByRole("region", { name: t("ekran.ana") })).findByRole("button", { name: t("ekonomi.dugme") }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: t("dao.kontrol") })).toBeInTheDocument();
  });

  it("test_ekonomi_acik_sehirle_acilir_ve_kapsamla_dunyaya_donulur", async () => {
    mountDao(GOZLEM_CALISAN, { route: { sehir: 2 }, caps: { city: true } });
    fireEvent.click(await within(await screen.findByRole("region", { name: t("ekran.ana") })).findByRole("button", { name: t("ekonomi.dugme") }));
    const pencere = within(await screen.findByRole("dialog"));
    fireEvent.click(pencere.getByRole("tab", { name: t("ayrintilar.sekme.tuketim") }));
    const sehirDugmesi = () => pencere.getByRole("button", { name: DAO_ADLAR[2]! });
    const dunyaDugmesi = () => pencere.getByRole("button", { name: t("ayrintilar.kapsam_dunya") });
    expect(sehirDugmesi()).toHaveAttribute("aria-pressed", "true");                 // haritadaki şehir seçili açılır
    expect(dunyaDugmesi()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(dunyaDugmesi());
    expect(dunyaDugmesi()).toHaveAttribute("aria-pressed", "true");                 // Kapsam ile dünyaya dönülür
    expect(sehirDugmesi()).toHaveAttribute("aria-pressed", "false");
  });
});
