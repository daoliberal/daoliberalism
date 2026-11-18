import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { createLiveSource } from "@/oyun/sim/live";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { DaoGozlem } from "@/oyun/sim/dao";
import type { RunConfig, SimSource } from "@/oyun/sim/types";
import { GOZLEM_AHIR, GOZLEM_CALISAN, GOZLEM_KURUCU } from "../helpers/daoVeri";
import { daoHafta, daoDurum, haftaYayimla, mountDao, sagPanel, sec, solPanel, tablo } from "../helpers/daoMount";
import { createFakeLiveServer } from "../helpers/fakeLiveServer";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/dao/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ust = (id: string): HTMLElement => document.querySelector(`[data-ust="${id}"] dd`) as HTMLElement;
const sehirBinasi = "Közlüdere";

describe("DAO şehir ekranı: kabuk", () => {
  it("test_tam_ekran_bolge_ust_metrikler_zaman_menu_secici_sol_panel_sag_panel_yalniz_secimde", async () => {
    mountDao(GOZLEM_CALISAN);
    await screen.findByRole("region", { name: t("dao.kontrol") });
    const e = screen.getByRole("region", { name: t("ekran.ana") });
    expect(within(e).getByRole("button", { name: t("kurucu.menu.dugme") })).toBeInTheDocument();
    expect(within(e).getByRole("button", { name: /Şehir: Közlüdere/ })).toBeInTheDocument();
    expect(within(e).getByRole("group", { name: t("ekran.kontrol") })).toBeInTheDocument();
    expect(within(e).getByRole("region", { name: t("dao.kontrol") })).toBeInTheDocument();
    expect(solPanel().getByText("Çalışıyor")).toBeInTheDocument();
    expect(screen.queryAllByRole("complementary")).toHaveLength(1); // yalnız sol panel
    expect(ust("nakit").textContent).toBe("900 Akçe");
    expect(ust("mevduat").textContent).toBe("300 Akçe");
    expect(ust("durum").textContent).toBe("Çalışıyor");
    expect(ust("unvan").textContent).toBe("Kalfa");
  });

  it("test_ben_paneli_alanlari_ve_olay_seridi", async () => {
    mountDao(GOZLEM_AHIR);
    const ben = solPanel();
    expect(await ben.findByText("Ahırda çalışıyor")).toBeInTheDocument();
    expect(ben.getByText("Çırak")).toBeInTheDocument();
    expect(ben.getByText("Közlüdere")).toBeInTheDocument();
    expect(ben.getByText("121 Akçe")).toBeInTheDocument();
    expect(ben.getByText(t("dao.ben.dilim_deger", { n: 3 }))).toBeInTheDocument();
    expect(ben.getByText(t("dao.ilerleme.calisma", { n: 3, toplam: 13 }))).toBeInTheDocument();
    expect(ben.getByText("Nakit: 121 / 500 Akçe (mevduat sayılmaz)")).toBeInTheDocument();
    // ahırdayken iş sayılmaz: "İş: var" yazmaz, çubukta iş 0
    expect(ben.queryByText(t("dao.ilerleme.is_var"))).toBeNull();
    expect(ben.getByText(t("dao.ilerleme.is_ahir"))).toBeInTheDocument();
    expect(within(screen.getByRole("log", { name: t("ekran.olay_baslik") })).getByText("3. hafta: İşe girdin: Fırın Bir.")).toBeInTheDocument();
  });

  it("test_ilerleme_butun_sartlari_gosterir_cubuk_en_az_dolu_sarta_gore", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, nakit: 50 }, kurabilir: { evet: false, eksikler: ["harc"], harc: 500, gereken_hafta: 13 } });
    const ben = solPanel();
    expect(await ben.findByText(t("dao.ilerleme.calisma", { n: 13, toplam: 13 }))).toBeInTheDocument();
    expect(ben.getByText("Nakit: 50 / 500 Akçe (mevduat sayılmaz)")).toBeInTheDocument();
    expect(Number(ben.getByRole("progressbar", { name: t("dao.ilerleme.etiket") }).getAttribute("value"))).toBeCloseTo(0.1, 5);
    expect(ben.queryByText(t("dao.ilerleme.hazir"))).toBeNull();
  });

  it("test_ahirdayken_ilerleme_cubugu_is_0_sayar_ahirda_eksigi_ayni_metni_gosterir", async () => {
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, nakit: 900, calisilan_hafta: 20 }, kurabilir: { evet: false, eksikler: ["ahirda"], harc: 500, gereken_hafta: 13 } });
    const ben = solPanel();
    expect(await ben.findByRole("progressbar", { name: t("dao.ilerleme.etiket") })).toHaveAttribute("value", "0");
    expect(ben.getByText(t("dao.ilerleme.is_ahir"))).toBeInTheDocument();
    await sec(/^Boş parsel/);
    expect(sagPanel(t("dao.baglam.parsel")).getByText(t("dao.eksik.ahirda"))).toBeInTheDocument();
  });

  it("test_bilinmeyen_durum_unvan_ve_eksiklik_ekrani_bozmaz_genel_metin_gosterir", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, durum: "bilinmiyor", unvan: "bilinmiyor" }, kurabilir: { evet: false, eksikler: ["bilinmiyor"], harc: 500, gereken_hafta: 13 } });
    expect(await solPanel().findAllByText("Bilinmiyor")).toHaveLength(2);
    await sec(/^Boş parsel/);
    expect(sagPanel(t("dao.baglam.parsel")).getByText("Bir şart eksik.")).toBeInTheDocument();
  });

  it("test_ilerleme_issizken_is_satiri_yok_der_ve_cubuk_sifir", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } }, kurabilir: { evet: false, eksikler: ["issiz"], harc: 0, gereken_hafta: 13 } });
    const ben = solPanel();
    expect(await ben.findByText(t("dao.ilerleme.is_yok"))).toBeInTheDocument();
    expect(ben.queryByText(/Nakit: /)).toBeNull();
    expect(ben.getByRole("progressbar", { name: t("dao.ilerleme.etiket") })).toHaveAttribute("value", "0");
  });

  it("test_hazirken_cubuk_dolu_ve_hazir_metni_var", async () => {
    mountDao(GOZLEM_CALISAN);
    const ben = solPanel();
    expect(await ben.findByRole("progressbar", { name: t("dao.ilerleme.etiket") })).toHaveAttribute("value", "1");
    expect(ben.getByText(t("dao.ilerleme.hazir"))).toBeInTheDocument();
  });

  it("test_sahip_ben_paneli_isletmeyi_gosterir_kurmaya_dogru_cubugu_yok", async () => {
    mountDao(GOZLEM_KURUCU);
    expect((await solPanel().findAllByText("Benim Fırınım")).length).toBeGreaterThanOrEqual(1);
    expect(solPanel().queryByRole("progressbar")).toBeNull();
  });

  it("test_ham_isletme_kimligi_hicbir_metinde_gecmez", async () => {
    const g: DaoGozlem = {
      ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, is: { firma: "s0_maden_komur0", sektor: "maden_komur", ucret: 5 } },
      olaylar: [{ tur: "ise_girdi", hafta: 3, firma: "s0_maden_komur0" }, { tur: "isten_cikarildi", hafta: 2, firma: "s0_ahir3", neden: null }],
    };
    mountDao(g);
    await solPanel().findByText(/, Közlüdere$/);
    expect(document.body.textContent).not.toMatch(/\bs\d+_/);
  });

  it("test_erisilebilirlik_dugme_adlari_dolu_alanlarin_kimligi_var_satir_ici_stil_yok", async () => {
    mountDao(GOZLEM_CALISAN);
    await screen.findByRole("region", { name: t("dao.kontrol") });
    await sec("Lonca meydanı");
    for (const b of document.body.querySelectorAll("button")) expect(b.textContent?.trim() ?? b.getAttribute("aria-label") ?? "").not.toBe("");
    for (const f of document.body.querySelectorAll("input, select")) expect(f.id).not.toBe("");
    expect(document.body.querySelector("[style]")).toBeNull();
  });
});

describe("DAO şehir ekranı: şehir seçimi", () => {
  it("test_sehir_verilmezse_oyuncunun_sehri_secilidir_oyuncunun_sehrinde_burada_yasiyorsun_notu", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, sehir: 2 } });
    expect(await screen.findByRole("button", { name: /Şehir: Bakırbük/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Şehir: Bakırbük/ }));
    expect(await screen.findByText(t("dao.sehir.sen"))).toBeInTheDocument();
  });

  it("test_rotadaki_sehir_oncelikli_ve_sehir_degisince_secim_temizlenir_hash_yazilir", async () => {
    mountDao(GOZLEM_CALISAN, { route: { sehir: 1 } });
    expect(await screen.findByRole("button", { name: /Şehir: Yaldızova/ })).toBeInTheDocument();
    await sec("Ahır");
    expect(sagPanel("Ahır")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Şehir: Yaldızova/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Demirpınar/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/dao/r/3"));
    expect(screen.queryByRole("complementary", { name: "Ahır" })).toBeNull();
    expect(screen.queryAllByRole("complementary")).toHaveLength(1);
  });

  it("test_oyuncu_tasininca_ekran_yeni_sehri_izler_ve_secim_temizlenir", async () => {
    const { src } = mountDao(GOZLEM_CALISAN, { route: { sehir: 0 } });
    await sec("Ahır");
    expect(screen.getByRole("complementary", { name: "Ahır" })).toBeInTheDocument();
    haftaYayimla(src, { ...GOZLEM_CALISAN, hafta: 4, ben: { ...GOZLEM_CALISAN.ben, sehir: 2 }, olaylar: [{ tur: "goc_etti", hafta: 4, sehir: 2 }] });
    await waitFor(() => expect(window.location.hash).toBe("#/dao/r/2"));
    expect(await screen.findByRole("button", { name: /Şehir: Bakırbük/ })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Ahır" })).toBeNull();
  });
});

describe("DAO şehir ekranı: ahır ve ahırdan çık", () => {
  it("test_hafta_0da_ipucu_gorunur_ahir_secilince_ahirdan_cik_dugmesi_karar_gonderir", async () => {
    const { daoKarar } = mountDao(null, { harita: false, state: { dao0: { ...GOZLEM_AHIR, hafta: 0, ilanlar: [] } } });
    expect(await screen.findByText(t("dao.ipucu.ahir"))).toBeInTheDocument();
    expect(solPanel().getByText(t("dao.ilk_hafta_ipucu"))).toBeInTheDocument();
    expect(ust("nakit").textContent).not.toBe(t("canli.gosterge.olculmuyor")); // I-3: hafta 0 üst metrikler state.dao0'dan dolu (ilk paket yokken)
    expect(ust("nakit").textContent).toMatch(/\d/);
    await sec("Ahır");
    const p = sagPanel("Ahır");
    expect(p.getByText(t("dao.ahir.ahirda"))).toBeInTheDocument();
    expect(daoKarar).not.toHaveBeenCalled(); // otomatik değil, oyuncu basmadan karar gitmez
    fireEvent.click(p.getByRole("button", { name: t("dao.ahir.cik") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "ahirdan_cik" }));
    // iki haftalık akış ipucu: bir sonraki haftada uygulanır, "Bir şey olana kadar" olayda durur
    expect(await screen.findByText(t("dao.karar.kabul_akis", { hafta: 1 }))).toBeInTheDocument();
  });

  it("test_ipucu_tamam_ile_kapanir_ahirdan_cikinca_gorunmez", async () => {
    const { src } = mountDao(GOZLEM_AHIR);
    const ip = await screen.findByText(t("dao.ipucu.ahir"));
    fireEvent.click(within(ip.closest("[role=status]") as HTMLElement).getByRole("button", { name: t("rehber.ipucu.tamam") }));
    expect(screen.queryByText(t("dao.ipucu.ahir"))).toBeNull();
    cleanup();
    mountDao({ ...GOZLEM_CALISAN });
    await screen.findByRole("region", { name: t("dao.kontrol") });
    expect(screen.queryByText(t("dao.ipucu.ahir"))).toBeNull();
    void src;
  });

  it("test_ahirdayken_yalniz_ahirdan_cik_var_islten_ayril_goc_yok_ahirdan_cikinca_not", async () => {
    const { src } = mountDao(GOZLEM_AHIR);
    await sec("Ahır");
    expect(screen.queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull();
    expect(screen.getByRole("button", { name: t("dao.ahir.cik") })).toBeEnabled();
    haftaYayimla(src, { ...GOZLEM_CALISAN, hafta: 4, ben: { ...GOZLEM_CALISAN.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } } });
    await waitFor(() => expect(screen.queryByRole("button", { name: t("dao.ahir.cik") })).toBeNull());
    expect(screen.getByText(t("dao.ahir.disarida"))).toBeInTheDocument();
  });

  it("test_ahirdan_cik_reddedilirse_metin_panelde_alert_olur", async () => {
    const daoKarar = vi.fn().mockRejectedValue(Object.assign(new SimUnsupported("karar_gecersiz"), { alanlar: [{ id: "tur", reason: "ahirda_degil" }] }));
    mountDao(GOZLEM_AHIR, { karar: daoKarar });
    await sec("Ahır");
    fireEvent.click(screen.getByRole("button", { name: t("dao.ahir.cik") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zaten ahırda değilsin.");
  });
});

describe("DAO şehir ekranı: kendi işyerinde işten ayrıl", () => {
  it("test_kendi_isyerinde_isten_ayril_onay_penceresiyle", async () => {
    const { daoKarar } = mountDao(GOZLEM_CALISAN);
    await sec(/^firin$/i);
    const p = sagPanel("Firin");
    expect(p.getByText(t("dao.isyeri.not"))).toBeInTheDocument();
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.ayril") }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByText("İşsizken işletme kuramazsın.")).toBeInTheDocument();
    expect(daoKarar).not.toHaveBeenCalled();
    fireEvent.click(d.getByRole("button", { name: t("dao.ayril.vazgec") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(daoKarar).not.toHaveBeenCalled();
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.ayril") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.ayril.onay") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "ayril" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(t("dao.karar.kabul", { hafta: 4 }))).toBeInTheDocument();
  });

  it("test_ayril_reddedilirse_diyalog_acik_kalir_ve_hata_diyalogta_tek_alert", async () => {
    const daoKarar = vi.fn().mockRejectedValue(new SimUnsupported("karar_gecersiz"));
    mountDao(GOZLEM_CALISAN, { karar: daoKarar });
    await sec(/^firin$/i);
    fireEvent.click(sagPanel("Firin").getByRole("button", { name: t("dao.karar.ayril") }));
    const d = within(await screen.findByRole("dialog"));
    fireEvent.click(d.getByRole("button", { name: t("dao.ayril.onay") }));
    await waitFor(() => expect(d.getByRole("alert")).toHaveTextContent(t("dao.hata.karar_gecersiz")));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(d.getByRole("button", { name: t("dao.ayril.onay") })).toBeEnabled();
  });

  it("test_sahipken_isletmeyi_kapat_onayi_sahip_metniyle", async () => {
    const { daoKarar } = mountDao({ ...GOZLEM_KURUCU, ben: { ...GOZLEM_KURUCU.ben, is: { firma: "f7", sektor: "firin", ucret: 0 } } });
    await sec(/^firin$/i);
    const p = sagPanel("Firin");
    expect(p.getByText(t("dao.isletme.not"))).toBeInTheDocument();
    fireEvent.click(p.getByRole("button", { name: "İşletmeyi kapat" }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByText(t("dao.ayril.sahip"))).toBeInTheDocument();
    fireEvent.click(d.getByRole("button", { name: t("dao.ayril.kapat_onay") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "ayril" }));
  });

  it("test_baska_isletmede_ayril_yok_isyerinde_var_issizken_hic_yok", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, is: { firma: "f9", sektor: "firin", ucret: 22 } } });
    await sec(/^firin$/i); // f7: oyuncunun işyeri değil (f9)
    expect(screen.queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull();
    expect(screen.getByText(t("dao.baska_isletme"))).toBeInTheDocument();
    cleanup();
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } } });
    await sec(/^firin$/i);
    expect(screen.queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull();
  });

  it("test_baska_sehirdeki_isletme_kendi_isyerim_sayilmaz", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, is: { firma: "f2", sektor: "market", ucret: 22 } } }, { route: { sehir: 1 } });
    await sec(/^market$/i);
    expect(screen.queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull(); // ben.sehir 0, f2 şehir 1'de
  });
});

describe("DAO şehir ekranı: meydan (mevduat ve para çek)", () => {
  it("test_meydanda_mevduat_ve_para_cek_govdeleri_loncalar_listesi", async () => {
    const { daoKarar } = mountDao(GOZLEM_CALISAN);
    await sec("Lonca meydanı");
    const p = sagPanel(t("kurucu.baglam.meydan"));
    expect(within(p.getByRole("list", { name: t("dao.lonca.tablo") })).getByText("Lonca 1")).toBeInTheDocument();
    fireEvent.change(p.getByLabelText(t("dao.karar.oran")), { target: { value: "25" } });
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.mevduat_kaydet") }));
    await waitFor(() => expect(daoKarar).toHaveBeenLastCalledWith("r", { tur: "mevduat", lonca: "lonca0", oran: 0.25 }));
    fireEvent.change(p.getByLabelText(t("dao.karar.miktar")), { target: { value: "40,5" } });
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.cek_dugme") }));
    await waitFor(() => expect(daoKarar).toHaveBeenLastCalledWith("r", { tur: "cek", miktar: 40.5 }));
  });

  it("test_loncalar_dunya_geneli_her_sehrin_meydani_ayni_listeyi_gosterir", async () => {
    const liste = async () => {
      await sec("Lonca meydanı");
      const t0 = within(screen.getByRole("complementary", { name: t("kurucu.baglam.meydan") })).getByRole("list", { name: t("dao.lonca.tablo") });
      return within(t0).getAllByRole("listitem").map((r) => r.textContent);
    };
    mountDao(GOZLEM_CALISAN, { route: { sehir: 0 } });
    const birinci = await liste();
    expect(birinci.length).toBe(GOZLEM_CALISAN.loncalar.length);
    expect(birinci[0]).toContain("Lonca 1");
    expect(birinci[0]).toMatch(/%0,12|%0,1/);
    cleanup();
    mountDao(GOZLEM_CALISAN, { route: { sehir: 3 } });
    expect(await liste()).toEqual(birinci);
  });

  it("test_kapali_lonca_secenegi_devre_disi_dolu_hesapla_baska_lonca_once_cek", async () => {
    const g: DaoGozlem = { ...GOZLEM_CALISAN, loncalar: GOZLEM_CALISAN.loncalar.map((l) => ({ ...l, kapali: l.ad === "lonca1" })) };
    const { daoKarar } = mountDao(g);
    await sec("Lonca meydanı");
    const p = sagPanel(t("kurucu.baglam.meydan"));
    expect(within(p.getByLabelText(t("dao.karar.lonca"))).getByRole("option", { name: t("dao.karar.lonca_kapali", { lonca: "Lonca 2" }) })).toBeDisabled();
    cleanup();
    const acik: DaoGozlem = { ...GOZLEM_CALISAN, loncalar: GOZLEM_CALISAN.loncalar.map((l) => ({ ...l, kapali: false })) };
    const m2 = mountDao(acik);
    await sec("Lonca meydanı");
    const q = sagPanel(t("kurucu.baglam.meydan"));
    fireEvent.change(q.getByLabelText(t("dao.karar.lonca")), { target: { value: "lonca1" } });
    expect(q.getByText(`${t("dao.hata.once_cek")} ${t("dao.karar.sonraki_hafta")}`)).toBeInTheDocument();
    expect(q.getByRole("button", { name: t("dao.karar.mevduat_kaydet") })).toBeDisabled();
    expect(m2.daoKarar).not.toHaveBeenCalled();
    expect(daoKarar).not.toHaveBeenCalled();
  });

  it("test_hafta_0da_meydan_gozlem_yok_notu_verir_karar_dugmesi_yok", async () => {
    mountDao(null, { harita: false });
    await sec("Lonca meydanı");
    expect(sagPanel(t("kurucu.baglam.meydan")).getByText(t("dao.baglam.gozlem_yok"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("dao.karar.cek_dugme") })).toBeNull();
  });

  it("test_secenekler_degisince_bayat_lonca_gonderilmez", async () => {
    const { src, daoKarar } = mountDao(GOZLEM_CALISAN);
    await sec("Lonca meydanı");
    const p = sagPanel(t("kurucu.baglam.meydan"));
    const yeni: DaoGozlem = {
      ...GOZLEM_KURUCU, hafta: 4, ben: { ...GOZLEM_CALISAN.ben, mevduat: { lonca: null, tutar: 0 } }, firmam: null,
      loncalar: [{ ad: "lonca0", mevduat_faizi: 0.001, kapali: true, mevduat: 5000 }, { ad: "lonca1", mevduat_faizi: 0.002, kapali: false, mevduat: 800 }],
      tercih: { mevduat: null },
    };
    haftaYayimla(src, yeni);
    await waitFor(() => expect((p.getByLabelText(t("dao.karar.lonca")) as HTMLSelectElement).value).toBe("lonca1"));
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.mevduat_kaydet") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "mevduat", lonca: "lonca1", oran: 0.5 }));
  });
});

describe("DAO şehir ekranı: başka şehre taşın", () => {
  it("test_baska_sehirde_bu_sehre_tasin_onay_ister_vazgecince_karar_gitmez", async () => {
    const { daoKarar } = mountDao(GOZLEM_CALISAN, { route: { sehir: 1 } });
    await sec("Yaldızova");
    const p = sagPanel("Yaldızova");
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.goc") }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByText(t("dao.goc.metin"))).toBeInTheDocument();
    expect(d.getByRole("heading", { name: t("dao.goc.baslik", { sehir: "Yaldızova" }) })).toBeInTheDocument();
    expect(daoKarar).not.toHaveBeenCalled();
    fireEvent.click(d.getByRole("button", { name: t("dao.ayril.vazgec") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(daoKarar).not.toHaveBeenCalled();
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.goc") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.goc.onay") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "goc", sehir: 1 }));
    expect(await screen.findByText(t("dao.karar.kabul", { hafta: 4 }))).toBeInTheDocument();
  });

  it("test_kendi_sehrinde_tasin_yok_not_var_sahipken_tasin_kapali", async () => {
    mountDao(GOZLEM_CALISAN, { route: { sehir: 0 } });
    await sec(sehirBinasi);
    expect(screen.queryByRole("button", { name: t("dao.karar.goc") })).toBeNull();
    expect(screen.getByText(t("dao.sehir.burada"))).toBeInTheDocument();
    cleanup();
    mountDao(GOZLEM_KURUCU, { route: { sehir: 2 } });
    await sec("Bakırbük");
    expect(screen.getByRole("button", { name: t("dao.karar.goc") })).toBeDisabled();
    expect(screen.getByText(t("dao.hata.kurucuyken_goc"))).toBeInTheDocument();
  });

  it("test_goc_reddedilirse_diyalog_acik_kalir_hata_diyalogta_tek_alert_ve_kodlar_turkce", async () => {
    const kodlar: [string, string][] = [
      ["ayni_hafta", "Bu hafta için zaten bir karar verdin."], ["once_cek", "Başka loncaya geçmeden önce mevduatını çek."],
      ["kurucuyken_goc", "İşletme sahibiyken taşınamazsın."], ["kosu_bitti", "Oyun bitti."], ["karar_gecersiz", "Bu karar verilemiyor."],
      ["karar_belirsiz", "Kararın uygulanıp uygulanmadığı belirsiz; gözlemi yenileyip tekrar bak."],
    ];
    for (const [kod, metin] of kodlar) {
      cleanup();
      const { daoKarar } = mountDao(GOZLEM_CALISAN, { route: { sehir: 2 }, karar: async () => { throw new SimUnsupported(kod); } });
      await sec("Bakırbük");
      fireEvent.click(screen.getByRole("button", { name: t("dao.karar.goc") }));
      const d = within(await screen.findByRole("dialog"));
      fireEvent.click(d.getByRole("button", { name: t("dao.goc.onay") }));
      expect(await d.findByRole("alert")).toHaveTextContent(metin);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(daoKarar).toHaveBeenCalledTimes(1); // belirsiz karar kendiliğinden tekrar gönderilmez
    }
  });

  it("test_kabul_mesajinda_sunucunun_haftasi_released_arti_iki_dahil_hafta_yayimlaninca_kalkar", async () => {
    const { src } = mountDao(GOZLEM_CALISAN, { route: { sehir: 1 }, karar: async () => ({ kabul: true, hafta: GOZLEM_CALISAN.hafta + 2 }) });
    await sec("Yaldızova");
    fireEvent.click(screen.getByRole("button", { name: t("dao.karar.goc") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.goc.onay") }));
    expect(await screen.findByText(t("dao.karar.kabul", { hafta: 5 }))).toBeInTheDocument();
    haftaYayimla(src, { ...GOZLEM_CALISAN, hafta: 5 });
    await waitFor(() => expect(screen.queryByText(t("dao.karar.kabul", { hafta: 5 }))).toBeNull());
  });
});

describe("DAO şehir ekranı: boş parselde işletme kur", () => {
  it("test_kurulamazken_kur_kapali_ve_eksikler_duz_turkce", async () => {
    mountDao(GOZLEM_AHIR, { route: { sehir: 0 } });
    await sec(/^Boş parsel/);
    const p = sagPanel(t("dao.baglam.parsel"));
    expect(p.getByRole("button", { name: t("dao.karar.kur") })).toBeDisabled();
    expect(p.getByText("En az 13 hafta çalışmış olmalısın.")).toBeInTheDocument();
    expect(p.getByText("Kuruluş harcı için 500 Akçe gerekir.")).toBeInTheDocument();
  });

  it("test_bekleyen_sektorde_kalan_hafta_gosterilir", async () => {
    const s0 = GOZLEM_CALISAN.sektorler[0]!;
    mountDao({ ...GOZLEM_CALISAN, sektorler: GOZLEM_CALISAN.sektorler.map((s, i) => (i === 0 ? { ...s, bekleme: 5 } : s)), kurabilir: { ...GOZLEM_CALISAN.kurabilir, evet: true, eksikler: [], bekleyen: [s0.sektor] } }, { route: { sehir: 0 } });
    await sec(/^Boş parsel/);
    expect(sagPanel(t("dao.baglam.parsel")).getByText(t("dao.karar.bekleme", { hafta: 5 }))).toBeInTheDocument();
  });

  it("test_kurabilirken_kur_sektorle_gider", async () => {
    const { daoKarar } = mountDao(GOZLEM_CALISAN, { route: { sehir: 0 } });
    await sec(/^Boş parsel/);
    const p = sagPanel(t("dao.baglam.parsel"));
    expect(p.queryByText(t("dao.karar.eksikler"))).toBeNull();
    fireEvent.change(p.getByLabelText(t("dao.karar.sektor")), { target: { value: "market" } });
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.kur") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "kur", sektor: "market" }));
    expect(await screen.findByText(t("dao.karar.kabul", { hafta: 4 }))).toBeInTheDocument();
  });

  it("test_baska_sehrin_parselinde_kur_yok_once_tasin_notu_hafta_0da_gozlem_notu", async () => {
    mountDao(GOZLEM_CALISAN, { route: { sehir: 2 } });
    await sec(/^Boş parsel/);
    expect(screen.getByText(t("dao.parsel.baska_sehir"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("dao.karar.kur") })).toBeNull();
    cleanup();
    mountDao(null, { harita: false });
    await sec(/^Boş parsel/);
    expect(screen.getByText(t("dao.baglam.gozlem_yok"))).toBeInTheDocument();
  });

  it("test_secenekler_degisince_bayat_sektor_gonderilmez", async () => {
    const { src, daoKarar } = mountDao(GOZLEM_CALISAN, { route: { sehir: 0 } });
    await sec(/^Boş parsel/);
    const p = sagPanel(t("dao.baglam.parsel"));
    fireEvent.change(p.getByLabelText(t("dao.karar.sektor")), { target: { value: "market" } });
    haftaYayimla(src, { ...GOZLEM_CALISAN, hafta: 4, sektorler: [{ sektor: "firin", urun: "ekmek", fiyat: 4, firma: 3, eksik: 0 }] });
    await waitFor(() => expect((p.getByLabelText(t("dao.karar.sektor")) as HTMLSelectElement).value).toBe("firin"));
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.kur") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "kur", sektor: "firin" }));
  });
});

describe("DAO şehir ekranı: şehir binası ve piyasa", () => {
  it("test_oyuncunun_sehir_binasinda_piyasa_en_cok_eksik_8_sektor_tumunu_goster_acar", async () => {
    const sektorler = Array.from({ length: 12 }, (_, i) => ({ sektor: `s${i}`, urun: "u", fiyat: 1 + i, firma: 1, eksik: i }));
    mountDao({ ...GOZLEM_AHIR, sektorler }, { route: { sehir: 0 } });
    await sec(sehirBinasi);
    const tablo8 = within(await screen.findByRole("table", { name: t("dao.piyasa.tablo") }));
    expect(tablo8.getByRole("columnheader", { name: "Eksik" })).toBeInTheDocument();
    expect(tablo8.getAllByRole("row")).toHaveLength(1 + 8);
    expect(tablo8.getByText("S11")).toBeInTheDocument();
    expect(tablo8.queryByText("s0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tümünü göster (12)" }));
    expect(within(screen.getByRole("table", { name: t("dao.piyasa.tablo") })).getAllByRole("row")).toHaveLength(1 + 12);
    expect(screen.getByText("%93")).toBeInTheDocument();
  });

  it("test_baska_sehrin_binasinda_piyasa_yok", async () => {
    mountDao(GOZLEM_AHIR, { route: { sehir: 1 } });
    await sec("Yaldızova");
    expect(screen.queryByRole("table", { name: t("dao.piyasa.tablo") })).toBeNull();
  });
});

describe("DAO şehir ekranı: haritasız ortam ve durumlar", () => {
  it("test_haritasiz_ortamda_butun_eylemler_liste_dugmeleriyle_yapilir", async () => {
    const { daoKarar } = mountDao(GOZLEM_CALISAN);
    const l = await tablo();
    for (const ad of [sehirBinasi, "Ahır", "Lonca meydanı", /^Boş parsel/, /^firin$/i]) expect(await l.findByRole("button", { name: ad })).toBeInTheDocument();
    await sec(/^firin$/i);
    fireEvent.click(sagPanel("Firin").getByRole("button", { name: t("dao.karar.ayril") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.ayril.onay") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "ayril" }));
  });

  it("test_sag_panel_kapat_ve_esc_ile_kapanir_yazi_alaninda_esc_kapatmaz", async () => {
    mountDao(GOZLEM_CALISAN);
    await sec("Lonca meydanı");
    const p = sagPanel(t("kurucu.baglam.meydan"));
    fireEvent.keyDown(p.getByLabelText(t("dao.karar.oran")), { key: "Escape" });
    expect(screen.getByRole("complementary", { name: t("kurucu.baglam.meydan") })).toBeInTheDocument();
    fireEvent.click(p.getByRole("button", { name: t("ekran.panel_kapat") }));
    expect(screen.queryByRole("complementary", { name: t("kurucu.baglam.meydan") })).toBeNull();
  });

  it("test_oynatma_kontrolleri_ekranin_icinde_step_olay_pause", async () => {
    const { control } = mountDao(GOZLEM_AHIR);
    const k = within(await screen.findByRole("region", { name: t("dao.kontrol") }));
    expect(k.getByText("Hafta 3 / 520")).toBeInTheDocument();
    fireEvent.click(k.getByRole("button", { name: "1 hafta" }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "step" });
    fireEvent.click(k.getByRole("button", { name: "Bir şey olana kadar" }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "olay" });
    expect(k.getByRole("button", { name: "Duraklat" })).toBeDisabled();
  });

  it("test_calisirken_duraklat_acik_ve_ilerletme_kapali", async () => {
    const { control } = mountDao(GOZLEM_AHIR, { state: { status: "running" } });
    const dur = await screen.findByRole("button", { name: "Duraklat" });
    expect(dur).toBeEnabled();
    expect(screen.getByRole("button", { name: "1 hafta" })).toBeDisabled();
    fireEvent.click(dur);
    expect(control).toHaveBeenLastCalledWith("r", { action: "pause" });
  });

  it("test_hafta_0_gercekten_hazirlanirken_hazirlaniyor_metni_ipucu_degil", async () => {
    mountDao(null, { harita: false, state: { computing: true } });
    expect(await solPanel().findByText(t("dao.hazirlaniyor"))).toBeInTheDocument();
    expect(screen.queryByText(t("dao.ilk_hafta_ipucu"))).toBeNull();
  });

  it("test_bilinmeyen_kosu_yeni_oyun_onerir_dao_degil_kosu_da", async () => {
    const src = (await import("../helpers/fakeSource")).createFakeSource([], { kind: "live", runId: "baska" });
    Object.assign(src, { daoKarar: vi.fn(), daoGozlem: vi.fn() });
    render(<SimSourceProvider source={src}><DaoEkrani route={{ name: "dao", runId: "yok" }} /></SimSourceProvider>);
    expect(await screen.findByText(t("dao.kosu_yok"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("dao.yeni_oyun") }));
    expect(window.location.hash).toBe("#/dao");
  });
});

describe("DAO şehir ekranı: oyun sonucu penceresi", () => {
  const bitmis: DaoGozlem = { ...GOZLEM_KURUCU, hafta: 520, gecmis: { dilim0: 2, firmalar: [{ ad: "Benim Fırınım", sektor: "firin", yas: 40, ayakta: false }, { ad: "İkinci Fırın", sektor: "market", yas: 12, ayakta: true }] } };

  it("test_sonuc_sehir_ekraninin_ustunde_pencere_olarak_acilir_sehir_kalir_kapatilinca_menuden_yeniden_acilir", async () => {
    mountDao(bitmis, { state: { status: "ended", week: 520, endedReason: "duration" } });
    const d = within(await screen.findByRole("dialog", { name: t("dao.sonuc.baslik") }));
    expect(screen.getByRole("region", { name: t("ekran.ana") })).toContainElement(screen.getByRole("dialog", { name: t("dao.sonuc.baslik") }));
    expect(d.getByText(t("dao.sonuc.baslangic")).nextSibling).toHaveTextContent("2 / 5");
    expect(d.getByText(t("dao.sonuc.son")).nextSibling).toHaveTextContent("5 / 5");
    expect(d.getByText(t("dao.sonuc.unvan")).nextSibling).toHaveTextContent("Girişimci");
    expect(d.getByText(t("dao.sonuc.durum")).nextSibling).toHaveTextContent("İşletme sahibi");
    const tab = within(d.getByRole("table", { name: t("dao.sonuc.isletmeler") }));
    expect(tab.getByText("Kapandı")).toBeInTheDocument();
    expect(tab.getByText("Ayakta")).toBeInTheDocument();
    expect(tab.getByText("40 hafta")).toBeInTheDocument();
    // şehir ekranı yerinde (tablo hâlâ DOM'da), oynatma kapalı
    expect(await screen.findByRole("region", { name: /\(liste\)$/ })).toBeInTheDocument(); // sahne harita paketiyle kurulur (Y-r2-1): paket gelene dek bekleme
    expect(screen.getByRole("button", { name: "1 hafta" })).toBeDisabled();
    fireEvent.click(d.getByRole("button", { name: t("dao.sonuc.kapat") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.menu.dugme") }));
    fireEvent.click(screen.getByRole("button", { name: t("dao.menu.sonuc") }));
    expect(await screen.findByRole("dialog", { name: t("dao.sonuc.baslik") })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dao.yeni_oyun") }));
    expect(window.location.hash).toBe("#/dao");
  });

  it("test_isletme_kurulmadiysa_not", async () => {
    mountDao({ ...GOZLEM_AHIR, hafta: 520 }, { state: { status: "ended", week: 520 } });
    expect(await screen.findByText(t("dao.sonuc.isletme_yok"))).toBeInTheDocument();
  });

  it("test_biten_kosuda_gozlem_okunamazsa_hata_gosterilir_sonsuz_yukleniyor_degil", async () => {
    const { createFakeSource } = await import("../helpers/fakeSource");
    const src = createFakeSource([{ type: "state", state: daoDurum({ status: "ended", week: 520 }) }], { kind: "live" });
    Object.assign(src, { daoKarar: vi.fn(), daoGozlem: vi.fn().mockRejectedValue(new SimUnsupported("kosu_yok_baska")) });
    render(<SimSourceProvider source={src}><DaoEkrani route={{ name: "dao", runId: "r" }} /></SimSourceProvider>);
    expect(await screen.findByText(t("dao.hata.gozlem"))).toBeInTheDocument();
  });
});

describe("DAO şehir ekranı: olay şeridi ve Tüm olaylar", () => {
  it("test_seritte_en_yeni_uc_olay_tum_olaylar_pencerede_hepsi_yeniden_eskiye", async () => {
    const olaylar = [1, 2, 3, 4, 5].map((h) => ({ tur: "cekildi" as const, hafta: h, miktar: h * 10 }));
    mountDao({ ...GOZLEM_CALISAN, olaylar });
    const serit = await screen.findByRole("log", { name: t("ekran.olay_baslik") });
    expect(within(serit).getAllByRole("listitem").map((x) => x.textContent)).toEqual(["5. hafta: 50 Akçe çektin.", "4. hafta: 40 Akçe çektin.", "3. hafta: 30 Akçe çektin."]);
    fireEvent.click(screen.getByRole("button", { name: t("dao.olaylar.tumu") }));
    const d = within(await screen.findByRole("dialog", { name: t("dao.olaylar.baslik") }));
    expect(d.getAllByRole("listitem")).toHaveLength(5);
    expect(d.getAllByRole("listitem")[4]!.textContent).toBe("1. hafta: 10 Akçe çektin.");
  });

  it("test_olaylar_paketlerden_birikir_ayni_olay_iki_kez_gorunmez", async () => {
    const { src } = mountDao({ ...GOZLEM_CALISAN, olaylar: [{ tur: "kurabilir_oldu", hafta: 3 }] });
    haftaYayimla(src, { ...GOZLEM_CALISAN, hafta: 4, olaylar: [{ tur: "kurabilir_oldu", hafta: 3 }, { tur: "ayrildi", hafta: 4 }] });
    await waitFor(() => expect(within(screen.getByRole("log")).getByText("4. hafta: İşten ayrıldın.")).toBeInTheDocument());
    expect(within(screen.getByRole("log")).getAllByText(/İşletme kurabilirsin/)).toHaveLength(1);
  });
});

describe("DAO akışı: sahte canlı sunucuda iki haftalık akış (karar -> hafta -> olay)", () => {
  let kaynaklar: SimSource[] = [];
  afterEach(() => { kaynaklar.forEach((s) => s.dispose()); kaynaklar = []; });
  const config: RunConfig = { name: "Ada", cityNames: DAO_ADLAR_KOPYA(), templateId: "dayanikli_taban", durationWeeks: 520, seedIndex: 0, values: {}, mode: "dao" };

  it("test_bir_sey_olana_kadar_ahirdan_cikti_ve_basvuru_kabul_olaylarinda_durur", async () => {
    const server = createFakeLiveServer();
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    kaynaklar.push(source);
    const h = await source.start({ ...config });
    window.location.hash = `#/dao/${h.runId}`;
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", runId: h.runId }} /></SimSourceProvider>);
    const olayDugme = () => screen.findByRole("button", { name: t("dao.olay_kadar") });

    // 1) Hafta 0: ahır -> "Ahırdan çık, iş ara" (oyuncu basar), kabul bandı akış ipucunu taşır.
    await sec("Ahır");
    fireEvent.click(await screen.findByRole("button", { name: t("dao.ahir.cik") }));
    expect(await screen.findByText(t("dao.karar.kabul_akis", { hafta: 1 }))).toBeInTheDocument();
    // 2) "Bir şey olana kadar": ahirdan_cikti olayında durur (1. hafta), 520. haftaya koşmaz.
    fireEvent.click(await olayDugme());
    const serit = await screen.findByRole("log", { name: t("ekran.olay_baslik") });
    await waitFor(() => expect(within(serit).getByText(`1. hafta: ${t("dao.olay.ahirdan_cikti")}`)).toBeInTheDocument());
    expect(server.run(h.runId)!.state.week).toBe(1);
    expect(server.run(h.runId)!.state.status).toBe("paused");
    // 3) Başvuru (arayüzdeki düğmeyle aynı karar) -> bir sonraki olay basvuru_kabul, yine orada durur.
    await source.daoKarar!(h.runId, { tur: "basvur", firma: "f2" });
    await waitFor(() => expect(screen.getByRole("button", { name: t("dao.olay_kadar") })).toBeEnabled());
    fireEvent.click(await olayDugme());
    await waitFor(() => expect(within(serit).getByText(/2\. hafta: Başvurun kabul edildi/)).toBeInTheDocument());
    expect(server.run(h.runId)!.state.week).toBe(2);
    expect(within(serit).getByText(`1. hafta: ${t("dao.olay.ahirdan_cikti")}`)).toBeInTheDocument();
    // 4) Kabulden 3 hafta sonra işletme küçülür: "Bir şey olana kadar" isten_cikarildi olayında da durur (5. hafta), nedeni oyuncu diliyle.
    fireEvent.click(await olayDugme());
    await waitFor(() => expect(within(serit).getByText(/5\. hafta: İşten çıkarıldın: .* İşletme kadrosunu küçülttü\./)).toBeInTheDocument());
    expect(server.run(h.runId)!.state.week).toBe(5);
    expect(server.run(h.runId)!.state.status).toBe("paused");
    await act(async () => {});
  });
});

const ARAYAN: DaoGozlem = {
  ...GOZLEM_AHIR,
  ben: { ...GOZLEM_AHIR.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } },
  ilanlar: [
    { firma: "f7", ad: "f7", sektor: "firin", acik: 2, ucret: 14.5, maas_odeyemedi: true, kasa_gucu: "zayif" },
    { firma: "f2", ad: "f2", sektor: "market", acik: 1, ucret: 12, maas_odeyemedi: false, kasa_gucu: "guclu" },
  ],
  olaylar: [],
};

describe("DAO hafta 0 haritası", () => {
  it("test_dao0_yokken_ust_metrikler_olculmuyor_sayi_uydurulmaz", async () => {
    mountDao(null, { harita: false });
    expect(await screen.findByText(t("dao.ipucu.ahir"))).toBeInTheDocument();
    expect(ust("nakit").textContent).toBe(t("canli.gosterge.olculmuyor"));
  });

  it("test_hafta0_ilan_sekmesi_bos_metni_ilk_haftadan_sonra_ve_maas_odeyemedi_uyarisi", async () => {
    mountDao({ ...ARAYAN, hafta: 0, ilanlar: [] });
    await sec(sehirBinasi);
    fireEvent.click(await screen.findByRole("tab", { name: t("dao.ilan.sekme_ilanlar") }));
    expect(await screen.findByText(t("dao.ilan.bos_hafta0"))).toBeInTheDocument();
  });

  it("test_weeks_bos_state_harita0_dolu_binalar_cizilir_harita_yokken_bos_sehir", async () => {
    const { src } = mountDao(null, { state: { harita0: { hafta: 0, firmalar: [["f7", "firin", 0, 8, null, "npc", null, "uretim"]] } } });
    expect(src).toBeDefined();
    await sec(/^firin$/i);                                                     // hafta 0'da (ilk paket yok) harita0'dan gelen bina tabloda
    expect(screen.getByText(t("dao.baska_isletme"))).toBeInTheDocument();
  });
});

describe("DAO iş ilanları", () => {
  it("test_ben_panelinde_ilanlara_bak_ipucu_ilanlar_sekmesini_acar_zayif_kasa_gorunur_basvur_acik_dugmeyle", async () => {
    const { daoKarar } = mountDao(ARAYAN);
    const ben = solPanel();
    expect(await ben.findByText(t("dao.ben.ilan_ipucu"))).toBeInTheDocument();
    expect(screen.queryAllByRole("complementary")).toHaveLength(1);              // sağ panel kendiliğinden açılmaz
    fireEvent.click(ben.getByRole("button", { name: t("dao.ben.ilanlara_bak") }));
    const liste = within(await screen.findByRole("list", { name: t("dao.ilan.liste") }));
    expect(liste.getAllByRole("listitem")).toHaveLength(2);
    expect(liste.getByText(t("dao.ilan.kasa", { durum: t("dao.kasa_gucu.zayif") }))).toBeInTheDocument();   // zayıf firma gizlenmez, risk görünür
    expect(liste.getByText(t("dao.ilan.kasa", { durum: t("dao.kasa_gucu.guclu") }))).toBeInTheDocument();
    expect(liste.getByText(t("dao.ilan.zayif_uyari"))).toBeInTheDocument();
    expect(liste.getAllByText(t("dao.ilan.maas_odeyemedi"))).toHaveLength(1);       // I-2: yalnız son haftalarda maaş ödeyemeyen ilanda
    expect(daoKarar).not.toHaveBeenCalled();
    // Kasası zayıf ilan sona sıralanır (f7 zayıf, f2 güçlü): ilk kart güçlü olan.
    expect(liste.getAllByRole("listitem").map((li) => li.querySelector("[data-ilan]")?.getAttribute("data-ilan"))).toEqual(["f2", "f7"]);
    // Zayıf ilana başvuru onaylıdır: ilk tık uyarı gösterir, karar gitmez; "Yine de başvur" gönderir.
    fireEvent.click(liste.getAllByRole("button", { name: /Başvur/ })[1]!);
    expect(await liste.findByText(t("dao.ilan.zayif_onay"))).toBeInTheDocument();
    expect(daoKarar).not.toHaveBeenCalled();
    fireEvent.click(liste.getByRole("button", { name: t("dao.ilan.zayif_vazgec") }));
    expect(liste.queryByText(t("dao.ilan.zayif_onay"))).toBeNull();
    fireEvent.click(liste.getAllByRole("button", { name: /Başvur/ })[1]!);
    fireEvent.click(await liste.findByRole("button", { name: t("dao.ilan.zayif_onayla") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "basvur", firma: "f7" }));
    expect(await screen.findByText(t("dao.karar.kabul_akis", { hafta: 4 }))).toBeInTheDocument();
  });

  it("test_ilan_veren_binaya_tiklayinca_ilan_ve_basvur_ilansiz_binada_yok_ahirdayken_basvur_kapali", async () => {
    mountDao({ ...ARAYAN, ilanlar: [{ firma: "f7", ad: "f7", sektor: "firin", acik: 2, ucret: 14.5, maas_odeyemedi: false, kasa_gucu: "orta" }] });
    await sec(/^firin$/i);
    const p = within(await screen.findByRole("region", { name: t("dao.ilan.baslik") }));
    expect(p.getByText(/Haftalık ücret: .* Akçe/)).toBeInTheDocument();
    expect(p.getByRole("button", { name: /Başvur/ })).toBeEnabled();
    cleanup();
    mountDao(GOZLEM_AHIR);
    await sec(/^firin$/i);
    expect(screen.queryByRole("region", { name: t("dao.ilan.baslik") })).toBeNull();
    cleanup();
    mountDao({ ...ARAYAN, ben: { ...ARAYAN.ben, durum: "ahir" } });
    await sec(/^firin$/i);
    expect(within(await screen.findByRole("region", { name: t("dao.ilan.baslik") })).getByRole("button", { name: /Başvur/ })).toBeDisabled();
    expect(screen.getByText(t("dao.ilan.ahirda"))).toBeInTheDocument();
  });

  it("test_ilan_yokken_bos_metin_ve_ipucu_yalniz_is_ararken", async () => {
    mountDao({ ...ARAYAN, ilanlar: [] });
    fireEvent.click(await solPanel().findByRole("button", { name: t("dao.ben.ilanlara_bak") }));
    expect(await screen.findByText(t("dao.ilan.bos"))).toBeInTheDocument();
    cleanup();
    mountDao(GOZLEM_CALISAN);
    await solPanel().findByText("Çalışıyor");
    expect(solPanel().queryByRole("button", { name: t("dao.ben.ilanlara_bak") })).toBeNull();
  });

  it("test_eksik_listesinde_iki_bilinmiyor_ayni_anahtarla_cakismaz", async () => {
    mountDao({ ...GOZLEM_AHIR, kurabilir: { evet: false, eksikler: ["bilinmiyor", "bilinmiyor"], harc: 500, gereken_hafta: 13 } });
    await sec(/^Boş parsel/);
    expect(await screen.findAllByText(t("dao.eksik.bilinmiyor"))).toHaveLength(2);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

function DAO_ADLAR_KOPYA(): string[] {
  return ["Közlüdere", "Yaldızova", "Bakırbük", "Demirpınar", "Taşyaka"];
}
void daoHafta;
