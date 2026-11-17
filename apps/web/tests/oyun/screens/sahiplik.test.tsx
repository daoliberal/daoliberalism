import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import type { Holdings } from "@/oyun/sim/types";
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
const panel = () => screen.findByRole("region", { name: t("canli.sahiplik.baslik") });
const satir = (id: string) => document.querySelector(`[data-para="${id}"]`) as HTMLElement;
const kur = (holdings?: Holdings, world = worldOrnek()) => mountCanli([state(), ...packets(3, { world, ...(holdings ? { holdings } : {}) })]);

describe("Para ve sahiplik paneli", () => {
  it("varsayilan_gorunum_sahiplik_ve_toplam_para_stokuna_esit", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    expect(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.sahiplik")) })).toHaveAttribute("aria-selected", "true");
    expect(satir("sahip_hane_nakdi").textContent).toContain("59.900");
    expect(satir("sahip_hane_mevduat").textContent).toContain("900");
    expect(satir("sahip_sigorta").textContent).toContain("500");
    expect(satir("sahip_kamu").textContent).toContain("255.500");
    expect(satir("sahip_lonca_kasa").textContent).toContain("83.600");
    expect(satir("sahip_toplam").textContent).toContain("447.450");
    expect(satir("sahip_kredi")).toBeNull();                                  // net kasa pozitif: kredi satırı yok
    expect(satir("hane")).toBeNull();                                         // hesap görünümü gizli
  });

  it("hesap_gorunumu_alternatif_olarak_eski_kesimleri_gosterir", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    fireEvent.click(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.hesap")) }));
    expect(satir("hane").textContent).toContain("59.900");
    expect(satir("lonca").textContent).toContain("90.000");
    expect(satir("sahip_toplam")).toBeNull();
  });

  it("negatif_lonca_kasasinda_kredi_olarak_disarida_satiri_gorunur", async () => {
    kur(holdingsOrnek({ lonca_cash_net: -2000 }), worldOrnek({ money_lonca: 4400 }));
    await hazir();
    await panel();
    expect(satir("sahip_lonca_kasa").textContent).toContain("-2.000");
    expect(satir("sahip_kredi").textContent).toContain("2.040");
    expect(satir("sahip_kredi").textContent).toContain(t("canli.sahiplik.sahip.kredi"));
  });

  it("lonca_tablosu_satiri_tiklaninca_lonca_cekmecesi_acilir", async () => {
    const { drawer } = kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    const tablo = within(p).getByRole("table", { name: t("canli.sahiplik.lonca.baslik") });
    expect(within(tablo).getAllByRole("row")).toHaveLength(7);                // başlık + 6 lonca
    fireEvent.click(within(tablo).getByRole("button", { name: "Lonca 2" }));   // lonca1 -> "Lonca 2"
    await waitFor(() => expect(drawer).toHaveBeenCalledWith("r", "lonca", "lonca1", 3));
    expect(within(tablo).getByText(t("cekmece.sahip.closed"))).toBeTruthy();
  });

  it("lonca_cekmecesi_yalniz_dortbir_iki_alanlari_gosterir", async () => {
    mountCanli([state(), ...packets(3, { world: worldOrnek(), holdings: holdingsOrnek() })], {
      drawer: async () => ({ kind: "lonca", ref: "lonca5", week: 3, stale: false, title: "Lonca 6", fields: { members: 15, fee: 0.05, capital: 6500, deposits: 950, credit_out: 500, equity: 4750, owner: "closed", pool_cash: 7 } }),
    });
    await hazir();
    const p = await panel();
    fireEvent.click(within(await within(p).findByRole("table", { name: t("canli.sahiplik.lonca.baslik") })).getByRole("button", { name: "Lonca 6" }));
    const c = await waitFor(() => { const e = document.querySelector('[data-cekmece="lonca"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    await waitFor(() => expect(c.querySelector('[data-alan="capital"]')?.textContent).toContain("6.500"));
    expect(c.querySelector('[data-alan="credit_out"]')?.textContent).toContain("500");
    expect(c.querySelector('[data-alan="equity"]')?.textContent).toContain("4.750");
    expect(c.querySelector('[data-alan="owner"]')?.textContent).toContain(t("cekmece.sahip.closed"));
    expect(c.querySelector('[data-alan="pool_cash"]')).toBeNull();            // artık gönderilmeyen alan gösterilmez
  });

  it("mevduat_sahipleri_grup_tutari_ve_payi_yazar", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    const tablo = within(p).getByRole("table", { name: t("canli.sahiplik.mevduat.baslik") });
    expect(within(tablo).getAllByRole("row")).toHaveLength(1 + 10 + 1);        // başlık + 9 oyuncu grubu + sigortacılar + toplam
    const lonca = within(tablo).getByText(t("canli.nufus.grup.p.lonca_owner")).closest("tr, [role=row]") as HTMLElement;
    expect(lonca.textContent).toContain("300");
    expect(lonca.textContent).toContain("30,0");                              // 300 / 1000
    expect(tablo.textContent).toContain(t("canli.sahiplik.sahip.sigorta"));
    expect(tablo.textContent).toContain(t("canli.sahiplik.mevduat.toplam"));
    expect(tablo.textContent).toContain("1.000");
  });

  it("kredi_ve_tahvil_stoku_dort_sayiyi_yazar", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    expect(within(p).getByRole("heading", { name: t("canli.sahiplik.kredi.baslik") })).toBeTruthy();
    expect(satir("kredi_lonca").textContent).toContain("2.000");
    expect(satir("kredi_fon").textContent).toContain("300");
    expect(satir("kredi_tahvil").textContent).toContain("40");
    expect(satir("kredi_ozkaynak").textContent).toContain("1.200");
  });

  it("firma_sahipligi_dort_sayiyi_yazar", async () => {
    kur(holdingsOrnek());
    await hazir();
    await panel();
    expect(satir("firma_adet").textContent).toContain("14");
    expect(satir("firma_sahip").textContent).toContain("9");
    expect(satir("firma_coklu").textContent).toContain("2");
    expect(satir("firma_nakit10").textContent).toContain("32,0");
  });

  it("bolum_sirasi_lonca_mevduat_kredi_firma_akis_butce", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    const sira = [t("canli.sahiplik.lonca.baslik"), t("canli.sahiplik.mevduat.baslik"), t("canli.sahiplik.kredi.baslik"), t("canli.sahiplik.firma.baslik"), t("canli.kesim.baslik"), t("canli.para.gelir.baslik")];
    const yer = sira.map((b) => (p.textContent ?? "").indexOf(b));
    expect(yer.every((x) => x >= 0)).toBe(true);
    expect([...yer].sort((a, b) => a - b)).toEqual(yer);
  });

  it("hesap_gorunumunde_loncalar_altinda_dort_satir_ve_toplam_money_lonca", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    fireEvent.click(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.hesap")) }));
    expect(satir("lonca_mevduat").textContent).toContain("1.000");
    expect(satir("lonca_fon").textContent).toContain("5.000");
    expect(satir("lonca_rezerv").textContent).toContain("400");
    expect(satir("lonca_kasa").textContent).toContain("83.600");
    expect(satir("lonca_toplam").textContent).toContain("90.000");              // = Loncalar kesimi (money_lonca)
    expect(satir("lonca").textContent).toContain("90.000");
    fireEvent.click(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.sahiplik")) }));
    expect(satir("lonca_toplam")).toBeNull();
  });

  it("blok_yoksa_yeni_bolumler_olculmuyor_yazar", async () => {
    kur(undefined);
    await hazir();
    const p = await panel();
    for (const id of ["mevduat_sahipleri", "kredi_stoku", "firma_sahipligi"]) expect(satir(id).textContent).toContain(t("canli.sahiplik.blok.olculmuyor.live"));
    fireEvent.click(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.hesap")) }));
    expect(satir("lonca_kirilim").textContent).toContain(t("canli.sahiplik.blok.olculmuyor.live"));
  });

  it("oyuncu_metninde_model_gibi_ic_bakis_sozcugu_yok", () => {
    for (const [k, v] of Object.entries(tr)) if (/^(canli\.nufus|canli\.sahiplik|canli\.kesim)\./.test(k)) expect(v, k).not.toMatch(/\bmodel/i);
  });

  it("kesim_akisi_etiketli_satirlar_ve_toplu_diger_satiri", async () => {
    kur(holdingsOrnek());
    await hazir();
    const p = await panel();
    const tablo = within(p).getByRole("table", { name: t("canli.kesim.baslik") });
    expect(tablo.textContent).toContain(t("canli.kesim.ad.players"));
    expect(tablo.textContent).toContain(t("canli.kesim.ad.npc_firms"));
    expect(tablo.textContent).toContain("88.000");
    expect(tablo.textContent).toContain(t("canli.kesim.ad.mint"));
    expect(tablo.textContent).toContain(t("canli.kesim.diger_satir"));
    expect(tablo.textContent).not.toMatch(/npc_firms|public_firms|found_fund/);   // iç adlar görünmez
  });

  it("kesim_akisi_en_cok_18_hucre_ve_bir_diger_satiri_yazar", async () => {
    const h = holdingsOrnek();
    const hucre = Array.from({ length: 24 }, (_, i) => ({ from: "players", to: "npc_firms", amount: 1000 - i }));
    kur({ ...h, flows: [...hucre, { from: "rest", to: "rest", amount: 400 }] });
    await hazir();
    const p = await panel();
    const tablo = within(p).getByRole("table", { name: t("canli.kesim.baslik") });
    expect(within(tablo).getAllByRole("row")).toHaveLength(1 + 18 + 1);
  });

  it("kesim_akisi_rest_ve_other_kalan_satiri_ayni_toplu_satirda", async () => {
    const h = holdingsOrnek();
    const hucre = [{ from: "players", to: "npc_firms", amount: 1000 }, { from: "other", to: "city", amount: 7 }];
    kur({ ...h, flows: [...hucre, { from: "rest", to: "rest", amount: 400 }, { from: "other", to: "other", amount: 300 }] });
    await hazir();
    const p = await panel();
    const tablo = within(p).getByRole("table", { name: t("canli.kesim.baslik") });
    const satirlar = within(tablo).getAllByRole("row");
    expect(satirlar).toHaveLength(1 + 2 + 1);
    const toplu = satirlar.filter((r) => r.textContent?.includes(t("canli.kesim.diger_satir")));
    expect(toplu).toHaveLength(1);
    expect(toplu[0].textContent).toContain("700");
    expect(tablo.textContent).not.toMatch(/\brest\b/);                           // iç ad görünmez
    expect(satirlar.some((r) => r.textContent?.includes(t("canli.kesim.ad.other")) && r.textContent.includes(t("canli.kesim.ad.city")))).toBe(true);   // gerçek other->city hücresi kalır
  });

  it("eski_kayitta_blok_yok_olculmuyor_yazar_ve_hesap_gorunumu_acilir", async () => {
    kur(undefined);
    await hazir();
    const p = await panel();
    expect(satir("hane").textContent).toContain("59.900");                    // hesap görünümü varsayılan: eski kayıtla karşılaştırılabilir
    expect(p.textContent).toContain(t("canli.sahiplik.lonca.olculmuyor.live"));
    expect(p.textContent).toContain(t("canli.kesim.olculmuyor.live"));
    fireEvent.click(within(p).getByRole("tab", { name: new RegExp(t("canli.sahiplik.sekme.sahiplik")) }));
    expect(satir("sahip_toplam").textContent).toContain("ölçülmüyor");
    expect(p.textContent).toContain(t("canli.sahiplik.olculmuyor.live"));
  });

  it("akis_olculemediyse_blok_var_ama_akis_yok_olculmuyor_der", async () => {
    kur({ ...holdingsOrnek(), flows: null });
    await hazir();
    const p = await panel();
    expect(p.textContent).toContain(t("canli.kesim.olculmuyor.live"));
    expect(within(p).getByRole("table", { name: t("canli.sahiplik.lonca.baslik") })).toBeTruthy();
  });

  it("metinde_ic_ad_ya_da_kod_yok", async () => {
    const IC = /K-?\d+|flow_kinds|lonca_cash_net|credit_out|holdings|secfn|money_|_sermaye|\b[a-z]+_[a-z_]+\b/;
    for (const [k, v] of Object.entries(tr)) if (/^(canli\.sahiplik|canli\.kesim)\./.test(k)) expect(v, k).not.toMatch(IC);
    kur({ ...holdingsOrnek(), loncas: [] });
    await hazir();
    const p = await panel();
    expect(p.textContent ?? "").not.toMatch(/lonca_cash_net|credit_out|flow_kinds|holdings|lonca\d/);
  });
});
