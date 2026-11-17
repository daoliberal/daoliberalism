import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { paraOzeti } from "@/oyun/sim/result";
import type { World } from "@/oyun/sim/types";
import { packet } from "../helpers/sehirZincirVeri";
import { mountCanli, packets, state, ayrintilarHazir } from "../helpers/canliMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** İlk haftalar geldi ve Ayrıntılar penceresi `sekme` sekmesinde açık. */
const hazir = async (sekme = "Nüfus ve para"): Promise<void> => {
  await ayrintilarHazir(sekme);
};
const satir = (id: string) => document.querySelector(`[data-para="${id}"]`) as HTMLElement;
const dolu: Partial<World> = {
  money_households: 60000, money_npc_firms: 30000, money_player_firms: 8000, money_city: 250000, money_lonca: 90000, money_other: 12000,
  city_in_tax: 30000, city_in_profit: 20000, city_in_rent: 17000, city_in_mint: 0, city_in_other: 4000,
  city_out_households: 33000, city_out_wages: 2000, city_out_services: 5000, city_out_firms: 11000, city_out_other: 100,
  ghost_firms: 41, ghost_closed: 3,
};

describe("D11 Canlı: para dağılımı ve şehir bütçesi", () => {
  it("panel_isgucu_akislari_panelinin_hemen_altinda_ve_kesimleri_paylariyla_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.sahiplik.baslik") });
    const akis = await screen.findByRole("region", { name: t("canli.akis.baslik") });
    expect(akis.nextElementSibling).toBe(panel);
    expect(panel.textContent).toContain(t("canli.para.alt"));
    expect(satir("hane").textContent).toContain("60.000");
    expect(satir("hane").textContent).toContain("%13,3");                 // 60.000 / 450.000
    expect(satir("yerlesik").textContent).toContain("%6,7");
    expect(satir("oyuncu").textContent).toContain("8.000");
    expect(satir("kasa").textContent).toContain("%55,6");
    expect(satir("lonca").textContent).toContain("%20");
    expect(satir("diger").textContent).toContain("12.000");
    expect(within(panel).getByText(t("canli.para.kesim.hane"))).toBeTruthy();
  });

  it("sehir_gelir_gider_kalemleri_ve_net", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    expect(satir("gelir_vergi").textContent).toContain("30.000");
    expect(satir("gelir_kar").textContent).toContain("20.000");
    expect(satir("gelir_kira").textContent).toContain("17.000");
    expect(satir("gelir_basim").textContent).toContain("0");
    expect(satir("gelir_diger").textContent).toContain("4.000");
    expect(satir("gelir_toplam").textContent).toContain("71.000");
    expect(satir("gider_hane").textContent).toContain("33.000");
    expect(satir("gider_ucret").textContent).toContain("2.000");
    expect(satir("gider_hizmet").textContent).toContain("5.000");
    expect(satir("gider_isletme").textContent).toContain("11.000");
    expect(satir("gider_diger").textContent).toContain("100");
    expect(satir("gider_toplam").textContent).toContain("51.100");
    expect(satir("net").textContent).toContain("19.900");
  });

  it("hayalet_isletme_sayisi_ve_kapananlar", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    expect(satir("hayalet").textContent).toContain("41");
    expect(satir("hayalet_kapanan").textContent).toContain("3");
    expect(t("canli.para.hayalet")).toContain("işçisiz");
  });

  it("negatif_net_eksi_isaretiyle_yazilir", async () => {
    mountCanli([state(), ...packets(3, { world: { ...dolu, city_in_tax: 1000, city_in_profit: 0, city_in_rent: 0, city_in_other: 0 } })]);
    await hazir();
    expect(satir("net").textContent).toContain("-");
  });

  it("olculmeyen_alan_olculmuyor_der_ve_not_yazar", async () => {
    const bos: Partial<World> = Object.fromEntries(Object.keys(dolu).map((k) => [k, null]));
    mountCanli([state(), ...packets(3, { world: bos })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.sahiplik.baslik") });
    for (const id of ["hane", "kasa", "gelir_vergi", "gider_hane", "hayalet"]) expect(satir(id).textContent).toContain("ölçülmüyor");
    expect(satir("net").textContent).toContain("ölçülmüyor");
    expect(panel.textContent).toContain(t("canli.para.olculmuyor.live"));
  });

  it("hane_payi_mevduati_saymadigini_soyler", () => {
    expect(t("canli.sahiplik.hesap.tanim")).toContain("hane payına girmez");        // yalnız hesap görünümünde söylenir
    expect(t("canli.para.alt")).not.toMatch(/hane payına|mevduat/);                // her iki görünümün altındaki şehir bütçesi notu mevduattan söz etmez
  });
});

describe("D11 karne özeti", () => {
  const w = (week: number, o: Partial<World>) => ({ ...packet(week, { world: o }) });
  it("son_olculen_haftanin_paylari_ve_hayalet_sayilari", () => {
    const o = paraOzeti([
      w(1, { ...dolu, money_households: 30000, ghost_firms: 10, ghost_closed: 0 }),
      w(2, { ...dolu, ghost_firms: 41, ghost_closed: 3 }),
      w(3, { ...dolu, ghost_firms: 38, ghost_closed: 2 }),
    ]);
    expect(o).not.toBeNull();
    expect(o!.hane).toBeCloseTo(60000 / 450000, 6);
    expect(o!.kasa).toBeCloseTo(250000 / 450000, 6);
    expect(o!.hayalet).toBe(38);                  // son ölçülen hafta
    expect(o!.kapanan).toBe(5);                   // toplam
  });
  it("kesimlerden_biri_olculmediyse_paylar_null_ama_hayalet_yine_yazilir", () => {
    const o = paraOzeti([w(1, { money_households: 1000, ghost_firms: 7, ghost_closed: 1 })]);
    expect(o).not.toBeNull();
    expect(o!.hane).toBeNull();
    expect(o!.hayalet).toBe(7);
  });
  it("olculmediyse_null", () => {
    expect(paraOzeti([w(1, {}), w(2, {})])).toBeNull();
    expect(paraOzeti([])).toBeNull();
  });
});
