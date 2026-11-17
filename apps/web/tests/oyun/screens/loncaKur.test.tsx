import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { adlandirici } from "@/oyun/harita/adlar";
import type { SehirSahnesi } from "@/oyun/harita/tipler";
import { DaoBaglam } from "@/oyun/screens/dao/DaoBaglam";
import { LoncaKurEylemi, type KararDurumu } from "@/oyun/screens/dao/DaoKararlar";
import { DaoLoncam } from "@/oyun/screens/dao/DaoPaneller";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import { createFakeSource } from "../helpers/fakeSource";
import type { DaoGozlem } from "@/oyun/sim/dao";
import { GOZLEM_AHIR, GOZLEM_KURUCU } from "../helpers/daoVeri";

afterEach(cleanup);

const durum = (gonder = vi.fn(async () => true), ek: Partial<KararDurumu> = {}): KararDurumu => ({ gonder, mesgul: false, kapali: false, kabul: null, ret: null, sirada: null, ...ek }) as KararDurumu;
const gozlem = (lonca_kur: NonNullable<DaoGozlem["lonca_kur"]>): DaoGozlem => ({ ...GOZLEM_KURUCU, lonca_kur });

describe("LoncaKurEylemi", () => {
  it("eksik_varken_liste_gorunur_dugme_pasif", () => {
    render(<LoncaKurEylemi g={gozlem({ girisimci: ["inovator_degil", "nakit"], medya: ["medya_firma"], yeniden: ["yuva_yok"] })} k={durum()} />);
    expect(screen.getByText("Lonca kurmak için eksikler:")).toBeInTheDocument();
    expect(screen.getByText(/İnovatör değilsin/)).toBeInTheDocument();
    expect(screen.getByText(/Kuruluş sermayesi için nakdin yetmiyor/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lonca kur" })).toBeDisabled();
  });

  it("sart_tamamsa_dugme_etkin_ve_karar_gider", () => {
    const gonder = vi.fn(async () => true);
    render(<LoncaKurEylemi g={gozlem({ girisimci: [], medya: ["medya_firma"], yeniden: ["yuva_yok"] })} k={durum(gonder)} />);
    expect(screen.queryByText("Lonca kurmak için eksikler:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lonca kur" }));
    expect(gonder).toHaveBeenCalledWith({ tur: "lonca_kur", yol: "girisimci" });
  });

  it("yol_secilince_o_yolun_eksikleri_gorunur", () => {
    const gonder = vi.fn(async () => true);
    render(<LoncaKurEylemi g={gozlem({ girisimci: [], medya: ["medya_firma"], yeniden: [] })} k={durum(gonder)} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "medya" } });
    expect(screen.getByText(/Medya loncası için/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lonca kur" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yeniden" } });
    fireEvent.click(screen.getByRole("button", { name: "Lonca kur" }));
    expect(gonder).toHaveBeenCalledWith({ tur: "lonca_kur", yol: "yeniden" });
  });

  it("bilinmeyen_eksik_kimligi_genel_metne_duser", () => {
    render(<LoncaKurEylemi g={gozlem({ girisimci: ["yeni_sart"], medya: ["yeni_sart"], yeniden: ["yeni_sart"] })} k={durum()} />);
    expect(screen.getByText("Başka bir şart eksik.")).toBeInTheDocument();
  });

  it("sirada_kararda_dugme_kapali", () => {
    render(<LoncaKurEylemi g={gozlem({ girisimci: [], medya: [], yeniden: [] })} k={durum(undefined, { sirada: { tur: "lonca_kur", hafta: 7 } })} />);
    expect(screen.getByRole("button", { name: "Lonca kur" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("7");
  });

  it("eski_sunucuda_lonca_kur_yoksa_gorunmez", () => {
    const { container } = render(<LoncaKurEylemi g={GOZLEM_KURUCU} k={durum()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("F3 düzeltme turu", () => {
  it("nakit_ve_itibar_gereken_eldeki_ve_yasak_kalan_gosterilir", () => {
    const g: DaoGozlem = { ...gozlem({ girisimci: ["nakit", "kurucu_yasagi"], medya: ["medya_firma"], yeniden: ["yuva_yok"] }), lonca_kur_ayrinti: { girisimci: [{ id: "nakit", gerek: 3500, var: 10 }, { id: "kurucu_yasagi", kalan: 41.2 }], medya: [{ id: "medya_firma" }], yeniden: [{ id: "yuva_yok" }] } };
    render(<LoncaKurEylemi g={g} k={durum()} />);
    expect(screen.getByText(/gereken 3\.500, elinde 10/)).toBeInTheDocument();
    expect(screen.getByText(/Kalan: 42 hafta/)).toBeInTheDocument();
  });

  it("isletmesi_olmayan_insana_meydan_panelinde_yeniden_yolu_gorunur", () => {
    const g: DaoGozlem = { ...GOZLEM_AHIR, lonca_kur: { girisimci: ["inovator_degil"], medya: ["medya_firma"], yeniden: [] } };
    render(
      <SimSourceProvider source={createFakeSource([], { kind: "live" })}>
        <DaoBaglam
          runId="r" secim={{ ref: { kind: "lonca", ref: "meydan" }, hafta: 3, sehir: 0 }} sahne={{ binalar: [], ad: "Ada" } as unknown as SehirSahnesi} adlar={adlandirici()} g={g} ad={{} as never} cur={null} sehir={0}
          sehirAdlari={["Ada"]} sektorAdi={(id) => id} karar={durum()} ilkHafta={false} sekme="sehir" onSekme={() => {}}
        />
      </SimSourceProvider>,
    );
    expect(g.ben.durum).not.toBe("kurucu");
    expect(screen.getByRole("button", { name: "Lonca kur" })).toBeEnabled();
  });

  it("loncam_karti_sahipse_gorunur_degilse_gorunmez", () => {
    const g: DaoGozlem = { ...GOZLEM_KURUCU, ben: { ...GOZLEM_KURUCU.ben, loncam: { ad: "lonca6", sermaye: 3050, odenen_sermaye: 3000, uye_sayisi: 2, kasa: 15, durum: "tehlikede" } } };
    render(<DaoLoncam g={g} />);
    expect(screen.getByText(/Loncan: /)).toBeInTheDocument();
    expect(screen.getByText(/Tehlikede/)).toBeInTheDocument();
    expect(screen.getByText(/Kuruluşta koyduğun sermaye: 3\.000/)).toBeInTheDocument();
    cleanup();
    const { container } = render(<DaoLoncam g={{ ...GOZLEM_KURUCU, ben: { ...GOZLEM_KURUCU.ben, loncam: null } }} />);
    expect(container).toBeEmptyDOMElement();
    expect(t("dao.loncam.baslik")).toBe("Loncan");
  });
});
