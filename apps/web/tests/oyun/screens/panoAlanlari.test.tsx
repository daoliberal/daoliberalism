import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { DaoBen } from "@/oyun/screens/dao/DaoBen";
import { DaoBatisBildirimi } from "@/oyun/screens/dao/DaoPaneller";
import { DaoPiyasa } from "@/oyun/screens/dao/DaoPaneller";
import { OLUM_KODLARI, UYARI_KODLARI, type DaoAdlar } from "@/oyun/sim/dao";
import { parseDaoGozlem } from "@/oyun/sim/live/wire";
import { GOZLEM_KURUCU } from "../helpers/daoVeri";

/** F1: tel ayrıştırıcısından geçen `kasa_degisim`, `kasa_hafta` ve `disaridan` ekrana kadar ulaşır. */
const ad: DaoAdlar = { sehir: (i) => `Sehir ${i}`, sektor: (s) => s, firma: (k) => k };
afterEach(cleanup);
const tel = (firmam: Record<string, unknown>, sektorler: Record<string, unknown>[]) => parseDaoGozlem(JSON.parse(JSON.stringify({ ...GOZLEM_KURUCU, firmam, sektorler })));

describe("F1: pano alanları ekranda", () => {
  it("firmam_kasa_degisim_ve_kasa_hafta_gorunur", () => {
    const g = tel({ ad: "f", sektor: "firin", nakit: 400, isci: 3, kar: -50, yas: 6, kasa_degisim: -600, kasa_hafta: 2.5 }, []);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.firmam.kasa_degisim")).nextElementSibling).toHaveTextContent("600");
    expect(screen.getByText(t("dao.firmam.kasa_hafta")).nextElementSibling).toHaveTextContent("2,5 hafta");
  });
  it("eski_sunucuda_tire", () => {
    const g = tel({ ad: "f", sektor: "firin", nakit: 400, isci: 3, kar: -50, yas: 6 }, []);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.firmam.kasa_degisim")).nextElementSibling).toHaveTextContent("—");
  });
  it("piyasa_tablosunda_disaridan_sutunu_eksikten_ayri", () => {
    const g = tel({ ad: "f", sektor: "firin", nakit: 1, isci: 1, kar: 0, yas: 1 }, [{ sektor: "firin", urun: "un", fiyat: 1, firma: 2, eksik: 0, disaridan: 100 }]);
    render(<DaoPiyasa g={g} ad={ad} />);
    const tablo = screen.getByRole("table");
    expect(within(tablo).getByText(t("dao.piyasa.disaridan"))).toBeInTheDocument();
    const hucreler = within(within(tablo).getAllByRole("row")[1]!).getAllByRole("cell").map((c) => c.textContent);
    expect(hucreler.slice(-2)).toEqual(["0", "100"]);
  });
});

/** F4: yaşam kaydı panoda: uyarı rozetleri, batış nedeni (yeni kod, eski kod, bilinmeyen kod), sektör eğilimi; metinler tr.ts'ten. */
describe("F4: yaşam kaydı panoda", () => {
  const firma = { ad: "f", sektor: "firin", nakit: 400, isci: 3, kar: -50, yas: 6 };
  const telGecmis = (firmalar: Record<string, unknown>[]) =>
    parseDaoGozlem(JSON.parse(JSON.stringify({ ...GOZLEM_KURUCU, firmam: null, gecmis: { dilim0: 2, firmalar } })));
  it("uyari_rozetleri_tr_metniyle", () => {
    const g = tel({ ...firma, uyari: ["kasa_2_hafta_alti", "taksit_gecikti"] }, []);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.uyari.kasa_2_hafta_alti"))).toBeInTheDocument();
    expect(screen.getByText(t("dao.uyari.taksit_gecikti"))).toBeInTheDocument();
    expect(screen.queryByText(t("dao.uyari.dort_hafta_zarar"))).not.toBeInTheDocument();
  });
  it("nakit_pisti_rozeti_hafta_sayisiyla", () => {
    render(<DaoBen g={tel({ ...firma, uyari: ["kasa_4_hafta_alti"], kasa_pisti_hafta: 2.5 }, [])} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.uyari.kasa_4_hafta_alti_n", { n: "2,5" }))).toBeInTheDocument();
    cleanup();
    render(<DaoBen g={tel({ ...firma, uyari: ["kasa_4_hafta_alti"] }, [])} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.uyari.kasa_4_hafta_alti"))).toBeInTheDocument();
  });
  it("bilinmeyen_uyari_kodu_genel_metin_ve_bos_liste_rozetsiz", () => {
    render(<DaoBen g={tel({ ...firma, uyari: ["yeni_kod"] }, [])} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(t("dao.uyari.genel"))).toBeInTheDocument();
    cleanup();
    render(<DaoBen g={tel({ ...firma, uyari: [] }, [])} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.queryByLabelText(t("dao.uyari.baslik"))).not.toBeInTheDocument();
  });
  it("batis_nedeni_yeni_kod_eski_neden_uzerinde", () => {
    const g = telGecmis([{ ad: "a", sektor: "firin", yas: 5, ayakta: false, neden: "diger", olum_haftasi: 9, neden_ayrinti: "talep", son8_kasa_farki: -120, son8_ciro: 300, son8_ucret: 250 }]);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(new RegExp(t("dao.batis.talep")))).toBeInTheDocument();
    expect(screen.getByText(new RegExp("Son 8 hafta"))).toBeInTheDocument();
  });
  it("eski_sunucu_neden_ayrinti_yoksa_eski_koda_duser", () => {
    const g = telGecmis([{ ad: "a", sektor: "firin", yas: 5, ayakta: false, neden: "kredi_odenemedi", olum_haftasi: 9 }]);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(new RegExp(t("dao.batis.kredi_odenemedi")))).toBeInTheDocument();
    expect(screen.queryByText(/Son 8 hafta/)).not.toBeInTheDocument();
  });
  it("bilinmeyen_olum_kodu_diger_gosterir", () => {
    const g = telGecmis([{ ad: "a", sektor: "firin", yas: 5, ayakta: false, neden: "diger", olum_haftasi: 9, neden_ayrinti: "uydurma_kod" }]);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(new RegExp(t("dao.batis.diger")))).toBeInTheDocument();
  });
  it("her_olum_kodunun_metni_var", () => {
    for (const k of OLUM_KODLARI) expect(t(`dao.batis.${k}`).length).toBeGreaterThan(5);
    for (const k of UYARI_KODLARI) expect(t(`dao.uyari.${k}`).length).toBeGreaterThan(5);
  });
  it("bant_ve_kart_ayni_batis_cumlesi_yakin_ve_kok_neden", () => {
    const kayit = { ad: "a", sektor: "firin", yas: 5, ayakta: false, neden: "ucret_odenmedi", olum_haftasi: 9, neden_ayrinti: "marj", yakin_neden: "ucret_odenemedi", kok_neden: "marj", son8_kasa_farki: -120, son8_ciro: 300, son8_ucret: 250 };
    const cumle = t("dao.batis.birlesik", { yakin: t("dao.batis.yakin.ucret_odenemedi"), kok: t("dao.batis.kok.marj") });
    const g = telGecmis([kayit]);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(new RegExp(cumle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    cleanup();
    render(<DaoBatisBildirimi olaylar={[{ tur: "firma_batti", hafta: 9, firma: "a", neden: "ucret_odenmedi", yas: 5 }]} gecmis={g.gecmis.firmalar} ad={ad} kapatilan={new Set()} onKapat={() => undefined} />);
    expect(screen.getByText(new RegExp(cumle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
  });
  it("bant_gecmis_yoksa_eski_koda_duser", () => {
    render(<DaoBatisBildirimi olaylar={[{ tur: "firma_batti", hafta: 9, firma: "a", neden: "ucret_odenmedi", yas: 5 }]} ad={ad} kapatilan={new Set()} onKapat={() => undefined} />);
    expect(screen.getByText(new RegExp(t("dao.batis.ucret_odenmedi")))).toBeInTheDocument();
  });
  it("yalniz_kredi_yakin_nedeni_kokle_birlesir_digeri_tek_kod", () => {
    const g = telGecmis([{ ad: "a", sektor: "firin", yas: 5, ayakta: false, neden: "diger", olum_haftasi: 9, neden_ayrinti: "talep", yakin_neden: "sahip_ayrildi", kok_neden: "talep" }]);
    render(<DaoBen g={g} ad={ad} onIsletmeyiGoster={() => undefined} />);
    expect(screen.getByText(new RegExp(t("dao.batis.talep")))).toBeInTheDocument();
  });
  it("sektor_egilimi_piyasa_tablosunda", () => {
    const g = tel(firma, [{ sektor: "firin", urun: "un", fiyat: 1, firma: 4, eksik: 0, disaridan: 0, kasa_egilim: -1250, firma_sayisi_13hf: 6 }]);
    render(<DaoPiyasa g={g} ad={ad} />);
    const hucre = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(hucre).toHaveTextContent("−1.250");
    expect(hucre).toHaveTextContent(t("dao.piyasa.onceki_firma", { n: 6 }));
  });
  it("sektor_egilimi_yoksa_eski_gorunum", () => {
    const g = tel(firma, [{ sektor: "firin", urun: "un", fiyat: 1, firma: 4, eksik: 0, disaridan: 0, kasa_egilim: null, firma_sayisi_13hf: null }]);
    render(<DaoPiyasa g={g} ad={ad} />);
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]!).not.toHaveTextContent("Kasa (13 hf)");
  });
});
