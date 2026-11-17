import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { issizlikOzeti } from "@/oyun/sim/result";
import type { World } from "@/oyun/sim/types";
import { cityRows, packet } from "../helpers/sehirZincirVeri";
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
const hazir = async (sekme = "Piyasa ve iş"): Promise<void> => {
  await ayrintilarHazir(sekme);
};
const satir = (id: string) => document.querySelector(`[data-issizlik="${id}"]`) as HTMLElement;
const dolu: Partial<World> = {
  unemployment_rate: 0.05, unemployed: 55, employed: 1000, npc_pool: 300, npc_employed: 700, npc_broke: 40, npc_pool_cash_avg: 12.5, players_seeking: 55,
  players_in_ahir: 20, players_students: 6, unemployment_rate_all: 0.2, benefit_paid: 1234, benefit_paid_npc: null, muni_wages: 800, bursary_paid: 90, benefit_cut: 15,
};

describe("D5 Canlı: işsizlik ve NPC havuzu", () => {
  it("dunya_gorunumunde_oyuncu_npc_havuzu_tuketemeyen_ve_toplam_ayri_gorunur", async () => {
    mountCanli([state(), ...packets(3, { world: dolu })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.issizlik.baslik") });
    expect(panel.textContent).toContain(t("canli.issizlik.alt"));
    expect(satir("oyuncu_oran").textContent).toContain("%5");
    expect(satir("oyuncu_sayi").textContent).toContain("55");
    expect(satir("npc_havuz").textContent).toContain("300");
    expect(satir("tuketemeyen").textContent).toContain("40");
    expect(satir("toplam").textContent).toContain("%20");
    expect(satir("calisan_npc").textContent).toContain("700");
    expect(satir("ahir").textContent).toContain("20");
    expect(satir("odenek").textContent).toContain("1.234");
    expect(satir("belediye").textContent).toContain("800");
    expect(satir("kisinti").textContent).toContain("15");
    expect(satir("odenek_npc")).toBeNull();                                   // NPC ödeneği yok (null): satır hiç gösterilmez
    expect(within(panel).getByText(t("canli.issizlik.toplam"))).toBeTruthy();
  });

  it("olculmeyen_alan_olculmuyor_der_ve_not_yazar", async () => {
    mountCanli([state(), ...packets(3, { world: { npc_pool: null, npc_broke: null, unemployment_rate_all: null, players_students: null } })]);
    await hazir();
    const panel = await screen.findByRole("region", { name: t("canli.issizlik.baslik") });
    expect(satir("npc_havuz").textContent).toContain("ölçülmüyor");
    expect(satir("toplam").textContent).toContain("ölçülmüyor");
    expect(satir("ogrenci").textContent).toContain("ölçülmüyor");
    expect(panel.textContent).toContain(t("canli.issizlik.olculmuyor.live"));
  });

  it("sehir_kapsaminda_sehir_degeri", async () => {
    window.location.hash = "#/canli/r/sehir-2";
    const rows = cityRows(3).map((r) => (r.index === 2 ? { ...r, employed: 90, unemployed: 10, npc_pool: 50, npc_broke: 7, players_seeking: 10 } : r));
    mountCanli([state(), ...packets(3, { cities: rows, world: dolu })]);
    await hazir(); // pencerede şehir kapsamı (rotadaki şehirden gelir)
    expect(satir("npc_havuz").textContent).toContain("50");           // şehir değeri; dünya 300
    expect(satir("tuketemeyen").textContent).toContain("7");
    expect(satir("toplam").textContent).toContain("%40");             // (10 + 50) / (90 + 10 + 50)
    expect(satir("calisan_npc").textContent).toContain("700");        // şehir kırılımı olmayan değer dünya değeridir
  });

  it("islem_etiketleri_kimi_saydigini_soyler", () => {
    for (const k of ["canli.gosterge.issiz", "seri.issiz_orani", "canli.gosterge.kol_issiz", "canli.sehir.alan.issiz", "canli.sk.issiz", "canli.grafik"] as const) {
      expect(t(k).toLowerCase(), k).toContain("oyuncu");
    }
  });
});

describe("D5 karne özeti", () => {
  const w = (week: number, o: Partial<World>) => ({ ...packet(week, { world: o }) });
  it("toplam_isizlik_son_ve_zirve_tuketemeyen_zirve_hafta_ve_son", () => {
    const weeks = [w(1, { unemployment_rate_all: 0.1, npc_broke: 0 }), w(2, { unemployment_rate_all: 0.5, npc_broke: 90 }), w(3, { unemployment_rate_all: 0.3, npc_broke: 10 })];
    const o = issizlikOzeti(weeks);
    expect(o.toplam).toEqual({ son: 0.3, zirve: 0.5, zirveHafta: 2 });
    expect(o.tuketemeyen).toEqual({ son: 10, zirve: 90, zirveHafta: 2 });
  });
  it("olculmediyse_null", () => {
    expect(issizlikOzeti([w(1, {}), w(2, {})])).toEqual({ toplam: null, tuketemeyen: null });
    expect(issizlikOzeti([])).toEqual({ toplam: null, tuketemeyen: null });
    const eksik = issizlikOzeti([w(1, { npc_broke: 5 }), w(2, {})]);
    expect(eksik.tuketemeyen).toEqual({ son: 5, zirve: 5, zirveHafta: 1 });          // son ölçülen değer
  });
});

describe("D8 Canlı: dünya kurulumu paneli", () => {
  const kurulum = (id: string) => document.querySelector(`[data-kurulum="${id}"]`) as HTMLElement;

  it("isletme_sayisi_doluluk_dolan_tur_konut_ve_acilis_kadrosu_gorunur", async () => {
    mountCanli([state(), ...packets(3, { world: { firms_total: 541, staff_fill: 0.83, kinds_full: 3, house_stock: 1956, opening_staff: 2663 } })]);
    await hazir("Nüfus ve para");
    const panel = await screen.findByRole("region", { name: t("canli.kurulum.baslik") });
    expect(panel.textContent).toContain(t("canli.kurulum.alt"));
    expect(kurulum("isletme").textContent).toContain("541");
    expect(kurulum("doluluk").textContent).toContain("%83");
    expect(kurulum("dolan").textContent).toContain("3");
    expect(kurulum("konut").textContent).toContain("1.956");
    expect(kurulum("acilis").textContent).toContain("2.663");
  });

  it("firms_total_yoksa_isletme_turetilir_olculmeyen_alan_olculmuyor_der", async () => {
    mountCanli([state(), ...packets(3, { world: { npc_firms: 400, player_firms: 20 } })]);
    await hazir("Nüfus ve para");
    expect(kurulum("isletme").textContent).toContain("420");
    expect(kurulum("doluluk").textContent).toContain(t("canli.gosterge.olculmuyor"));
  });
});

describe("D9 Canlı: işgücüne katılım ve bakmakla yükümlü NPC", () => {
  const kurulum = (id: string) => document.querySelector(`[data-kurulum="${id}"]`) as HTMLElement;

  it("hane_kipinde_katilim_orani_ve_bakmakla_yukumlu_sayisi_gorunur", async () => {
    mountCanli([state(), ...packets(3, { world: { npc_lfp: 0.5, npc_dependents: 2550, npc_broke: 900 } })]);
    await hazir("Nüfus ve para");
    expect(kurulum("katilim").textContent).toContain("%50");
    expect(kurulum("bagimli").textContent).toContain("2.550");
  });

  it("olculmediyse_olculmuyor_der", async () => {
    mountCanli([state(), ...packets(3, { world: { firms_total: 541 } })]);
    await hazir("Nüfus ve para");
    expect(kurulum("katilim").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(kurulum("bagimli").textContent).toContain(t("canli.gosterge.olculmuyor"));
  });
});
