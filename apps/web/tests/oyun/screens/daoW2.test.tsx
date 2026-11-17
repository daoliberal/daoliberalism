import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { DaoGozlem } from "@/oyun/sim/dao";
import { GOZLEM_AHIR, GOZLEM_CALISAN, GOZLEM_KURUCU } from "../helpers/daoVeri";
import { haftaYayimla, mountDao, sagPanel, sec, solPanel } from "../helpers/daoMount";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));
const markersSayac = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/oyun/screens/canli/Canli", async (orig) => {
  const m = await orig<typeof import("@/oyun/screens/canli/Canli")>();
  return { ...m, markersOf: (...a: Parameters<typeof m.markersOf>) => { markersSayac.n += 1; return m.markersOf(...a); } };
});

beforeEach(() => {
  window.location.hash = "#/dao/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
  markersSayac.n = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sehirBinasi = "Közlüdere";
/** Çalışan oyuncu, başka bir işletmenin (f7) ilanı şehirde. */
const CALISAN_ILANLI: DaoGozlem = {
  ...GOZLEM_CALISAN,
  ben: { ...GOZLEM_CALISAN.ben, is: { firma: "f9", sektor: "market", ucret: 20 } },
  ilanlar: [{ firma: "f7", ad: "f7", sektor: "firin", acik: 2, ucret: 30, maas_odeyemedi: false, kasa_gucu: "guclu" }],
  olaylar: [],
};

describe("W2: ilan kartı çalışan oyuncuya iş değiştirme metnini gösterir", () => {
  it("test_calisan_ilan_kartinda_ayrilip_gecersin_alinmazsan_isin_surer", async () => {
    const { daoKarar } = mountDao(CALISAN_ILANLI);
    await sec(/^firin$/i);
    const p = within(await screen.findByRole("region", { name: t("dao.ilan.baslik") }));
    expect(p.getByText("Başvurursan ve alınırsan eski işinden ayrılıp buna geçersin; alınmazsan işin sürer.")).toBeInTheDocument();
    expect(screen.queryByText(/almayabilir/)).toBeNull();
    const dugme = p.getByRole("button", { name: /Başvur/ });
    expect(dugme).toBeEnabled();
    fireEvent.click(dugme);
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "basvur", firma: "f7" }));
  });
});

describe("W2: belediye çalışanı işten ayrılabilir", () => {
  const BELEDIYE: DaoGozlem = { ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, is: { firma: "s0_belediye0", sektor: "belediye", ucret: 8 } }, ilanlar: [] };

  it("test_belediyede_calisirken_sehir_panelinde_isten_ayril_cikar_ve_karar_gider", async () => {
    const { daoKarar } = mountDao(BELEDIYE);
    await sec(sehirBinasi);
    const p = sagPanel(sehirBinasi);
    expect(p.getByText(t("dao.isyeri.not"))).toBeInTheDocument();
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.ayril") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.ayril.onay") }));
    await waitFor(() => expect(daoKarar).toHaveBeenCalledWith("r", { tur: "ayril" }));
  });

  it("test_baska_isyerinde_ya_da_baska_sehrin_belediyesinde_sehir_panelinde_ayril_yok", async () => {
    mountDao(GOZLEM_CALISAN);
    await sec(sehirBinasi);
    expect(sagPanel(sehirBinasi).queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull();
    cleanup();
    mountDao({ ...BELEDIYE, ben: { ...BELEDIYE.ben, is: { ...BELEDIYE.ben.is, firma: "s3_belediye0" } } });
    await sec(sehirBinasi);
    expect(sagPanel(sehirBinasi).queryByRole("button", { name: t("dao.karar.ayril") })).toBeNull();
  });
});

describe("W2: işletme battı bildirimi ve İşletmelerim", () => {
  const BATTI: DaoGozlem = {
    ...GOZLEM_AHIR,
    ben: { ...GOZLEM_CALISAN.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } },
    firmam: null,
    gecmis: {
      dilim0: 3,
      firmalar: [
        { ad: "Eski Fırın", sektor: "firin", yas: 12, ayakta: false, neden: "ucret_odenmedi", olum_haftasi: 20 },
        { ad: "Yeni Market", sektor: "market", yas: 4, ayakta: true, neden: null, olum_haftasi: null },
        { ad: "Kısa Ömür", sektor: "firin", yas: 0, ayakta: false, neden: "kredi_odenemedi", olum_haftasi: 21 },
      ],
    },
    ilanlar: [],
    olaylar: [{ tur: "firma_batti", hafta: 3, firma: "Eski Fırın", neden: "ucret_odenmedi", yas: 12 }],
  };

  it("test_firma_batti_belirgin_bantta_ad_neden_ve_yas_tamam_ile_kapanir", async () => {
    mountDao(BATTI);
    const bildirim = await screen.findByLabelText(t("dao.batis.bildirim_etiket"));
    expect(bildirim).toHaveTextContent("İşletmen battı: Eski Fırın. Maaşlar ödenemedi. 12 hafta yaşadı.");
    fireEvent.click(within(bildirim).getByRole("button", { name: t("dao.batis.kapat") }));
    expect(screen.queryByLabelText(t("dao.batis.bildirim_etiket"))).toBeNull();
  });

  const ISTEN: DaoGozlem = {
    ...BATTI,
    olaylar: [
      { tur: "basvuru_kabul", hafta: 3, firma: "s0_universite0" },
      { tur: "isten_cikarildi", hafta: 3, firma: "s0_universite0", neden: "ucret_odenmedi" },
    ],
  };

  it("test_ayni_hafta_kabul_ve_isten_cikarma_belirgin_bantta_neden_ve_tamam_ile_kapanir_hafta_ilerleyince_kalir", async () => {
    const { src } = mountDao(ISTEN);
    const bildirim = await screen.findByLabelText(t("dao.isten.bildirim_etiket"));
    expect(bildirim).toHaveTextContent("İşten çıkarıldın");
    expect(bildirim).toHaveTextContent("İşletmenin kasası maaşını ödeyemedi.");
    expect(bildirim).toHaveTextContent(t("dao.isten.ayni_hafta"));
    haftaYayimla(src, { ...ISTEN, hafta: 4, olaylar: [] });
    expect(screen.getByLabelText(t("dao.isten.bildirim_etiket"))).toBeInTheDocument();
    fireEvent.click(within(screen.getByLabelText(t("dao.isten.bildirim_etiket"))).getByRole("button", { name: t("dao.isten.kapat") }));
    expect(screen.queryByLabelText(t("dao.isten.bildirim_etiket"))).toBeNull();
  });

  it("test_ahirdan_ayrilis_isten_cikarma_bildirimi_vermez", async () => {
    mountDao({ ...BATTI, olaylar: [{ tur: "isten_cikarildi", hafta: 2, firma: "s0_ahir3", neden: null }] });
    await screen.findByRole("log", { name: t("ekran.olay_baslik") });
    expect(screen.queryByLabelText(t("dao.isten.bildirim_etiket"))).toBeNull();
  });

  it("test_batis_bildirimi_hafta_ilerleyince_kaybolmaz_yalniz_tamam_ile_kapanir", async () => {
    const { src } = mountDao(BATTI);
    expect(await screen.findByLabelText(t("dao.batis.bildirim_etiket"))).toBeInTheDocument();
    haftaYayimla(src, { ...BATTI, hafta: 4, olaylar: [] });
    haftaYayimla(src, { ...BATTI, hafta: 5, olaylar: [] });
    await new Promise((r) => setTimeout(r, 250));   // kabuk haftaları 100 ms'de bir işler
    expect(screen.getByLabelText(t("dao.batis.bildirim_etiket"))).toHaveTextContent("Eski Fırın");
    fireEvent.click(within(screen.getByLabelText(t("dao.batis.bildirim_etiket"))).getByRole("button", { name: t("dao.batis.kapat") }));
    expect(screen.queryByLabelText(t("dao.batis.bildirim_etiket"))).toBeNull();
    haftaYayimla(src, { ...BATTI, hafta: 6, olaylar: [] });
    expect(screen.queryByLabelText(t("dao.batis.bildirim_etiket"))).toBeNull();
  });

  it("test_eski_sunucuda_neden_ve_yas_yoksa_bildirim_yine_ad_ile_gorunur", async () => {
    mountDao({ ...BATTI, olaylar: [{ tur: "firma_batti", hafta: 3, firma: "Eski Fırın" }] });
    expect(await screen.findByLabelText(t("dao.batis.bildirim_etiket"))).toHaveTextContent("İşletmen battı: Eski Fırın. Nedeni belirsiz.");
  });

  it("test_ben_panelinde_isletmelerim_ad_sektor_ve_durum_gosterir", async () => {
    mountDao(BATTI);
    const liste = within(await solPanel().findByRole("list", { name: t("dao.isletmelerim.liste") }));
    const satirlar = liste.getAllByRole("listitem");
    expect(satirlar).toHaveLength(3);
    expect(satirlar[0]).toHaveTextContent("Eski Fırın");
    expect(satirlar[0]).toHaveTextContent("(Firin)");
    expect(satirlar[0]).toHaveTextContent("Battı: Maaşlar ödenemedi. 12 hafta yaşadı.");
    expect(satirlar[1]).toHaveTextContent("Yeni Market");
    expect(satirlar[1]).toHaveTextContent("Ayakta, 4 hafta.");
    expect(satirlar[2]).toHaveTextContent("Battı: Lonca kredisi ödenemedi. 0 hafta yaşadı.");
  });

  it("test_gecmis_bossa_isletmelerim_bolumu_yok", async () => {
    mountDao(GOZLEM_AHIR);
    await solPanel().findByText("Çırak");
    expect(solPanel().queryByRole("heading", { name: t("dao.isletmelerim.baslik") })).toBeNull();
    cleanup();
    mountDao(GOZLEM_KURUCU);
    expect(await solPanel().findByRole("heading", { name: t("dao.isletmelerim.baslik") })).toBeInTheDocument();
  });
});

describe("W2: terfi ilerlemesi Ben panelinde", () => {
  it("test_cirak_icin_kalfa_olmak_icin_tecrube_ve_itibar_gosterilir", async () => {
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, calisilan_hafta: 23, tecrube_hafta: undefined, itibar: 2.1 } });
    expect(await solPanel().findByText("Kalfa olmak için (yaklaşık): tecrübe 23/40 hafta, itibar 2,1/4")).toBeInTheDocument();
  });

  it("test_kalfa_icin_usta_usta_ve_kurucu_icin_satir_yok_sartlar_tamamsa_not", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, unvan: "kalfa", calisilan_hafta: 60, tecrube_hafta: undefined, itibar: 5 } });
    expect(await solPanel().findByText("Usta olmak için (yaklaşık): tecrübe 60/150 hafta, itibar 5/12")).toBeInTheDocument();
    cleanup();
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, unvan: "usta", calisilan_hafta: 200, itibar: 15 } });
    await solPanel().findByText("Usta");
    expect(solPanel().queryByRole("heading", { name: t("dao.terfi.baslik") })).toBeNull();
    cleanup();
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, calisilan_hafta: 55, tecrube_hafta: undefined, itibar: 6 } });
    expect(await solPanel().findByText("Kalfa olmak için (yaklaşık): tecrübe 40/40 hafta, itibar 4/4")).toBeInTheDocument();
    expect(solPanel().queryByText(t("dao.terfi.tamam"))).toBeNull();   // alan yokken "şartları sağladın" denmez
  });

  it("test_tecrube_hafta_varken_o_deger_yaklasik_isareti_yok_ve_sartlar_tamamsa_not", async () => {
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, calisilan_hafta: 90, tecrube_hafta: 41.6, itibar: 4.5 } });
    expect(await solPanel().findByText("Kalfa olmak için: tecrübe 40/40 hafta, itibar 4/4")).toBeInTheDocument();
    expect(solPanel().getByText(t("dao.terfi.tamam"))).toBeInTheDocument();
    cleanup();
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, calisilan_hafta: 90, tecrube_hafta: 12.9, itibar: 2 } });
    expect(await solPanel().findByText("Kalfa olmak için: tecrübe 12/40 hafta, itibar 2/4")).toBeInTheDocument();
  });
});

describe("M8: tecrübe sayılmayan işler", () => {
  it("test_terfi_panelinde_kural_satiri_her_zaman_belediye_ve_ahir_isinde_saymaz_uyarisi_isletmede_yok", async () => {
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, unvan: "cirak", tecrube_hafta: 4.9 } });
    expect(await solPanel().findByText(t("dao.terfi.kural"))).toBeInTheDocument();
    expect(solPanel().queryByText(t("dao.terfi.saymaz"))).toBeNull();                     // işletmede çalışıyor: uyarı yok
    cleanup();
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, unvan: "cirak", tecrube_hafta: 4.9, is: { firma: "s0_belediye0", sektor: "belediye", ucret: 8 } } });
    expect(await solPanel().findByText(t("dao.terfi.saymaz"))).toBeInTheDocument();
    cleanup();
    mountDao({ ...GOZLEM_CALISAN, ben: { ...GOZLEM_CALISAN.ben, unvan: "cirak", tecrube_hafta: 4.9, is: { firma: "s0_ahir3", sektor: "ahir", ucret: 3 } } });
    expect(await solPanel().findByText(t("dao.terfi.saymaz"))).toBeInTheDocument();
  });

  it("test_belediye_ilaninda_kisa_tecrube_notu_isletme_ilaninda_yok", async () => {
    const ilanlar: DaoGozlem["ilanlar"] = [
      { firma: "s0_belediye0", ad: "s0_belediye0", sektor: "belediye", acik: 2, ucret: 8, maas_odeyemedi: false, kasa_gucu: "guclu" },
      { firma: "f7", ad: "f7", sektor: "firin", acik: 1, ucret: 12, maas_odeyemedi: false, kasa_gucu: "guclu" },
    ];
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } }, ilanlar, olaylar: [] });
    fireEvent.click(await solPanel().findByRole("button", { name: t("dao.ben.ilanlara_bak") }));
    const liste = within(await screen.findByRole("list", { name: t("dao.ilan.liste") }));
    expect(liste.getAllByText(t("dao.ilan.tecrube_saymaz"))).toHaveLength(1);
  });
});

describe("W2: kabul edilen tek seferlik karar 'Sırada' olur", () => {
  it("test_ahirdan_cik_sirada_dugme_kapali_ve_hafta_metni", async () => {
    mountDao(GOZLEM_AHIR, { karar: async () => ({ kabul: true, hafta: 5 }) });
    await sec("Ahır");
    fireEvent.click(screen.getByRole("button", { name: t("dao.ahir.cik") }));
    expect(await screen.findByText("Sırada: 5. haftada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("dao.ahir.cik") })).toBeDisabled();
  });

  it("test_basvuru_sirada_kartta_metin_ve_butun_basvur_dugmeleri_kapali", async () => {
    const ilanlar: DaoGozlem["ilanlar"] = [
      { firma: "f7", ad: "f7", sektor: "firin", acik: 2, ucret: 14.5, maas_odeyemedi: false, kasa_gucu: "orta" },
      { firma: "f8", ad: "f8", sektor: "market", acik: 1, ucret: 12, maas_odeyemedi: false, kasa_gucu: "guclu" },
    ];
    mountDao({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, durum: "is_arayan", is: { firma: null, sektor: null, ucret: 0 } }, ilanlar, olaylar: [] }, { karar: async () => ({ kabul: true, hafta: 4 }) });
    fireEvent.click(await solPanel().findByRole("button", { name: t("dao.ben.ilanlara_bak") }));
    const liste = within(await screen.findByRole("list", { name: t("dao.ilan.liste") }));
    fireEvent.click(liste.getAllByRole("button", { name: /Başvur/ })[0]!);
    expect(await liste.findByText("Başvurun sırada: 4. haftada.")).toBeInTheDocument();
    for (const b of liste.getAllByRole("button", { name: /Başvur/ })) expect(b).toBeDisabled();
  });

  it("test_isten_ayril_sirada_dugme_kapali_ve_hafta_metni", async () => {
    mountDao(GOZLEM_CALISAN, { karar: async () => ({ kabul: true, hafta: 4 }) });
    await sec(/^firin$/i);
    const p = sagPanel("Firin");
    fireEvent.click(p.getByRole("button", { name: t("dao.karar.ayril") }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dao.ayril.onay") }));
    expect(await p.findByText("Sırada: 4. haftada")).toBeInTheDocument();
    expect(p.getByRole("button", { name: t("dao.karar.ayril") })).toBeDisabled();
  });
});

describe("W2: Ekonomi penceresi", () => {
  const ac = async () => fireEvent.click(await within(await screen.findByRole("region", { name: t("ekran.ana") })).findByRole("button", { name: t("ekonomi.dugme") }));

  it("test_hafta_0da_ilk_hafta_oynanince_dolar_notu_veri_gelince_yok", async () => {
    mountDao(null, { harita: false });
    await ac();
    expect(await within(await screen.findByRole("dialog")).findByText(t("ekonomi.ilk_hafta_notu"))).toBeInTheDocument();
    cleanup();
    mountDao(GOZLEM_CALISAN);
    await ac();
    await screen.findByRole("dialog");
    expect(screen.queryByText(t("ekonomi.ilk_hafta_notu"))).toBeNull();
  });

  it("test_markers_yalniz_olaylar_degisince_hesaplanir_pencere_acmak_yeniden_hesaplatmaz", async () => {
    mountDao(GOZLEM_CALISAN);
    await screen.findByRole("region", { name: t("dao.kontrol") });
    const once = markersSayac.n;
    await ac();
    await screen.findByRole("dialog");
    expect(markersSayac.n).toBe(once);
  });
});
