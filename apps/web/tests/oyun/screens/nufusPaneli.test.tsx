import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import type { Holdings, World } from "@/oyun/sim/types";
import { mountCanli, packets, state, ayrintilarHazir } from "../helpers/canliMount";
import { holdingsOrnek, worldOrnek } from "../helpers/sahiplikVeri";

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
const panel = () => screen.findByRole("region", { name: t("canli.nufus.baslik") });
/** Tablo satırında `data-nufus` ilk hücrededir: satırın tamamı döner; ölçü kutusunda kutunun kendisi. */
const oge = (id: string) => {
  const e = document.querySelector(`[data-nufus="${id}"]`) as HTMLElement;
  return (e?.closest('[role="row"]') as HTMLElement | null) ?? e;
};
const sayilar = (kok: HTMLElement): number[] => [...kok.querySelectorAll("[data-n]")].map((e) => Number(e.getAttribute("data-n")));

/** Oyuncu 1.500, NPC 5.000: gruplar toplamı nüfusa eşit. */
function nufusBlogu(): Holdings {
  const h = holdingsOrnek();
  return {
    ...h,
    groups: {
      player: {
        lonca_owner: { n: 10, cash: 9000, deposits: 400 }, firm_owner: { n: 90, cash: 20000, deposits: 800 }, employed_player_firm: { n: 100, cash: 5000, deposits: 100 },
        employed_npc_firm: { n: 800, cash: 40000, deposits: 900 }, municipal: { n: 50, cash: 2000, deposits: 0 }, ahir: { n: 100, cash: 900, deposits: 0 },
        seeking: { n: 200, cash: 1500, deposits: 10 }, student: { n: 50, cash: 300, deposits: 0 }, other: { n: 100, cash: 700, deposits: 0 },
      },
      npc: {
        employed_npc_firm: { n: 3000, cash: 90000 }, employed_player_firm: { n: 500, cash: 12000 }, municipal: { n: 100, cash: 3000 },
        pool: { n: 400, cash: 800 }, dependent: { n: 600, cash: 100 }, out: { n: 200, cash: 50 }, other: { n: 200, cash: 400 },
      },
    },
    wealth: { b50: 0.05, m40: 0.25, t10: 0.7, t1: 0.2, median: 151, gini: 0.62, n: 1500 },
  };
}
const dunya = (o: Partial<World> = {}) =>
  worldOrnek({
    wealth_top10: 0.55, wealth_top1: 0.12, wealth_median: 310, income_gini: 0.41, income_top10: 0.33,
    liquid_b50: 0.1, liquid_m40: 0.3, liquid_t10: 0.6, npc_broke: 90, npc_pool: 400, npc_dependents: 600, npc_discouraged: 200, ...o,
  });
const kur = (holdings?: Holdings, world = dunya()) => mountCanli([state(), ...packets(3, { world, ...(holdings ? { holdings } : {}) })]);
const ondalikAyir = (s: string): number => Number(s.replace("%", "").replace(",", ".").trim());

describe("Nüfus ve dağılım paneli", () => {
  it("grup_toplami_nufusa_esit", async () => {
    kur(nufusBlogu());
    await hazir();
    const p = await panel();
    const oyuncu = within(p).getByRole("table", { name: t("canli.nufus.oyuncu.baslik") });
    const npc = within(p).getByRole("table", { name: t("canli.nufus.npc.baslik") });
    const o = sayilar(oyuncu);
    const n = sayilar(npc);
    expect(o).toHaveLength(9 + 1);
    expect(n).toHaveLength(7 + 1);
    expect(o.slice(0, 9).reduce((a, b) => a + b, 0)).toBe(1500);
    expect(o[9]).toBe(1500);                                                // toplam satırı
    expect(n.slice(0, 7).reduce((a, b) => a + b, 0)).toBe(5000);
    expect(n[7]).toBe(5000);
    expect(oge("p_toplam").textContent).toContain("1.500");
    expect(oge("p_firm_owner").textContent).toContain("%6,0");                // 90 / 1500
    expect(oge("p_firm_owner").textContent).toContain("800");                 // mevduat yalnız oyuncu tablosunda
  });

  it("baslik_servet_sahip_serveti_olup_tanimi_yazilidir", async () => {
    kur(nufusBlogu());
    await hazir();
    const p = await panel();
    expect(oge("sahip_b50").textContent).toContain("%5,0");
    expect(oge("sahip_m40").textContent).toContain("%25,0");
    expect(oge("sahip_t10").textContent).toContain("%70,0");
    expect(oge("sahip_t1").textContent).toContain("%20,0");
    expect(oge("sahip_medyan").textContent).toContain("151");
    expect(oge("sahip_gini").textContent).toContain("0,62");
    expect(oge("sahip_n").textContent).toContain("1.500");
    expect(p.textContent).toContain(t("canli.nufus.sahip.tanim"));
    // başlık servet bölümü modelin bölümünden önce gelir
    const bas = within(p).getByRole("heading", { name: t("canli.nufus.sahip.baslik") });
    const mod = within(p).getByRole("heading", { name: t("canli.nufus.model.baslik") });
    expect(bas.compareDocumentPosition(mod) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(p.textContent).toContain(t("canli.nufus.model.tanim"));
  });

  it("modelin_olculeri_ikinci_bolumde_ve_likit_dilimler_toplami_yuzdur", async () => {
    kur(nufusBlogu());
    await hazir();
    await panel();
    expect(oge("model_top10").textContent).toContain("%55,0");
    expect(oge("model_top1").textContent).toContain("%12,0");
    expect(oge("model_medyan").textContent).toContain("310");
    expect(oge("gelir_gini").textContent).toContain("0,41");
    expect(oge("gelir_top10").textContent).toContain("%33,0");
    const toplam = ["likit_b50", "likit_m40", "likit_t10"].map((id) => ondalikAyir(oge(id).querySelector("dd")!.textContent ?? "")).reduce((a, b) => a + b, 0);
    expect(Math.abs(toplam - 100)).toBeLessThanOrEqual(0.1);
  });

  it("likit_dilimler_ucte_bir_gibi_paylarda_da_gosterimde_tam_yuz_eder", async () => {
    kur(nufusBlogu(), dunya({ liquid_b50: 0.333, liquid_m40: 0.333, liquid_t10: 0.334 }));
    await hazir();
    await panel();
    const toplam = ["likit_b50", "likit_m40", "likit_t10"].map((id) => ondalikAyir(oge(id).querySelector("dd")!.textContent ?? "")).reduce((a, b) => a + b, 0);
    expect(Math.abs(toplam - 100)).toBeLessThanOrEqual(0.1);
    cleanup();
    kur(nufusBlogu(), dunya({ liquid_b50: 0.3333, liquid_m40: 0.3333, liquid_t10: 0.3334 }));
    await hazir();
    await panel();
    const t2 = ["likit_b50", "likit_m40", "likit_t10"].map((id) => ondalikAyir(oge(id).querySelector("dd")!.textContent ?? "")).reduce((a, b) => a + b, 0);
    expect(Math.abs(t2 - 100)).toBeLessThanOrEqual(0.1);
  });

  it("npc_notu_modelin_tanimina_uyar_nakdi_olmayan_demez", () => {
    expect(tr["canli.nufus.npc.not"]).not.toMatch(/nakdi olmayan/);
    expect(tr["canli.nufus.npc.not_etiket"]).not.toMatch(/nakdi olmayan/);
    expect(tr["canli.nufus.npc.not"]).toContain("eşiğin altında");
  });

  it("null_olculmuyor_der_ve_uydurma_sayi_yazmaz", async () => {
    kur(undefined, worldOrnek());
    await hazir();
    const p = await panel();
    for (const id of ["sahip_b50", "sahip_gini", "model_top10", "gelir_gini", "likit_b50"]) expect(oge(id).textContent, id).toContain(t("canli.gosterge.olculmuyor"));
    expect(oge("npc_oran").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(p.textContent).toContain(t("canli.nufus.olculmuyor.live"));
    expect(within(p).queryByRole("table", { name: t("canli.nufus.oyuncu.baslik") })).toBeNull();
  });

  it("blok_var_ama_servet_payi_null_ise_yalniz_o_alan_olculmuyor", async () => {
    const h = nufusBlogu();
    kur({ ...h, wealth: { ...h.wealth, b50: null, m40: null, t10: null, t1: null, gini: null } });
    await hazir();
    await panel();
    expect(oge("sahip_b50").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(oge("sahip_medyan").textContent).toContain("151");
    expect(oge("p_toplam").textContent).toContain("1.500");
  });

  it("npc_notundaki_oran_yalniz_dort_dunya_alanindan_hesaplanir", async () => {
    kur(nufusBlogu(), dunya({ npc_broke: 120, npc_pool: 300, npc_dependents: 500, npc_discouraged: 200 }));
    await hazir();
    await panel();
    expect(oge("npc_oran").textContent).toContain("%12,0");                   // 120 / (300 + 500 + 200)
    cleanup();
    // gruplar, nakit ve öbür dünya alanları değişse de oran aynı kalır
    const h = nufusBlogu();
    kur({ ...h, groups: { ...h.groups, npc: { ...h.groups.npc, pool: { n: 1, cash: 1 } } } }, dunya({ npc_broke: 120, npc_pool: 300, npc_dependents: 500, npc_discouraged: 200, npc_employed: 7, money_households: 1 }));
    await hazir();
    await panel();
    expect(oge("npc_oran").textContent).toContain("%12,0");
  });

  it("npc_orani_alanlardan_biri_yoksa_ya_da_payda_sifirsa_olculmuyor", async () => {
    kur(nufusBlogu(), dunya({ npc_discouraged: null }));
    await hazir();
    await panel();
    expect(oge("npc_oran").textContent).toContain(t("canli.gosterge.olculmuyor"));
    cleanup();
    kur(nufusBlogu(), dunya({ npc_pool: 0, npc_dependents: 0, npc_discouraged: 0 }));
    await hazir();
    await panel();
    expect(oge("npc_oran").textContent).toContain(t("canli.gosterge.olculmuyor"));
  });

  it("zaman_serisi_haftalik_paketlerden_iki_grafik_cizer", async () => {
    kur(nufusBlogu());
    await hazir();
    const p = await panel();
    expect(within(p).getByText(t("canli.nufus.sahip.grafik"))).toBeInTheDocument();
    expect(within(p).getByText(t("canli.nufus.model.grafik"))).toBeInTheDocument();
    expect(p.querySelector('[data-seri="sahip_t10"]')).not.toBeNull();       // son hafta bloğu var; ilk iki haftada yok, çizgi kopuk
    expect(p.querySelector('[data-seri="model_top10"]')).not.toBeNull();
  });

  it("metinde_ic_ad_ya_da_kod_yok", async () => {
    const IC = /K-?\d+|npc_|holdings|wealth_|liquid_|income_|lonca_owner|firm_owner|\b[a-z]+_[a-z_]+\b/;
    for (const [k, v] of Object.entries(tr)) if (/^canli\.nufus\./.test(k)) expect(v, k).not.toMatch(IC);
    kur(nufusBlogu());
    await hazir();
    const p = await panel();
    expect(p.textContent ?? "").not.toMatch(/npc_broke|npc_pool|wealth_top|liquid_|income_|firm_owner|seeking/);
  });
});
