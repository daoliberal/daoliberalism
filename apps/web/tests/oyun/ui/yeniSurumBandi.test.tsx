import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { YeniSurumBandi } from "@/oyun/ui/YeniSurumBandi";

afterEach(cleanup);

/** OyunApp'in rolu: `sonra` durumunu bant disinda tutar. */
function Kontrollu({ durum, onayla, yuvada = false }: { durum: Parameters<typeof YeniSurumBandi>[0]["durum"]; onayla(): void; yuvada?: boolean }) {
  const [sonra, setSonra] = useState(false);
  const bant = <YeniSurumBandi durum={durum} onayla={onayla} sonra={sonra} onSonra={() => setSonra(true)} />;
  return yuvada ? <section data-yer="yuva">{bant}</section> : <div data-yer="sabit">{bant}</div>;
}

describe("YeniSurumBandi", () => {
  it("durum_yokken_hicbir_sey_cizilmez", () => {
    const { container } = render(<Kontrollu durum="yok" onayla={vi.fn()} />);
    expect(container.querySelector("[data-yer]")).toBeEmptyDOMElement();
  });

  it("hazirken_aciklama_ve_onay_dugmesi_gorunur_tiklayinca_onayla_cagrilir", async () => {
    const onayla = vi.fn();
    render(<Kontrollu durum="hazir" onayla={onayla} />);
    expect(screen.getByText(t("tarayici.surum.hazir"), { exact: false })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.surum.uygula") }));
    expect(onayla).toHaveBeenCalledOnce();
  });

  it("kaydediliyor_ve_uygulaniyorken_dugme_pasif", () => {
    for (const d of ["kaydediliyor", "uygulaniyor"] as const) {
      const { unmount } = render(<Kontrollu durum={d} onayla={vi.fn()} />);
      expect(screen.getByRole("button", { name: t("tarayici.surum.uygula") })).toBeDisabled();
      unmount();
    }
  });

  it("hatada_aciklama_gorunur_ve_yeniden_denenebilir", async () => {
    const onayla = vi.fn();
    render(<Kontrollu durum="hata" onayla={onayla} />);
    expect(screen.getByText(t("tarayici.surum.hata"), { exact: false })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.surum.uygula") }));
    expect(onayla).toHaveBeenCalledOnce();
  });
});

describe("B8: Sonra", () => {
  it("hazirken_Sonra_bandi_bu_oturumda_gizler_hata_durumunda_yeniden_gorunur", async () => {
    const { rerender } = render(<Kontrollu durum="hazir" onayla={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.surum.sonra") }));
    expect(screen.queryByText(t("tarayici.surum.hazir"), { exact: false })).toBeNull();
    rerender(<Kontrollu durum="hata" onayla={vi.fn()} />);
    expect(screen.getByText(t("tarayici.surum.hata"), { exact: false })).toBeVisible();
    expect(screen.queryByRole("button", { name: t("tarayici.surum.sonra") })).toBeNull();
  });

  it("Sonra_yuva_ile_sabit_sutun_arasinda_yeniden_kurulsa_da_korunur", async () => {
    // B10: bant `OyunEkrani` yuvasi (portal) ile sabit sutun arasinda tasininca eskiden yerel durum sifirlanip bant geri geliyordu.
    function Kok() {
      const [sonra, setSonra] = useState(false);
      const [yuvada, setYuvada] = useState(false);
      const bant = <YeniSurumBandi durum="hazir" onayla={vi.fn()} sonra={sonra} onSonra={() => setSonra(true)} />;
      return (
        <>
          <button onClick={() => setYuvada((y) => !y)}>tasi</button>
          {yuvada ? <section data-yer="yuva">{bant}</section> : <div data-yer="sabit">{bant}</div>}
        </>
      );
    }
    render(<Kok />);
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.surum.sonra") }));
    expect(screen.queryByText(t("tarayici.surum.hazir"), { exact: false })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "tasi" }));     // yeni ebeveyn: bilesen yeniden kuruldu
    expect(screen.queryByText(t("tarayici.surum.hazir"), { exact: false })).toBeNull();
  });
});
