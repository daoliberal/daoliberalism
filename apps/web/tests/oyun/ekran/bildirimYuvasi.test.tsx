import { cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { OyunEkrani } from "@/oyun/ekran/OyunEkrani";
import { BildirimYuvaSaglayici } from "@/oyun/ui/BildirimYuvasi";
import { SEHIRLER, genislikAyarla } from "./ekranYardim";

afterEach(cleanup);

const tuval = <div>harita</div>;
const ekran = (
  <OyunEkrani tuval={tuval} sehirler={SEHIRLER} sehir={0} onSehir={() => undefined} ipucu={<p data-testid="ipucu">ipucu</p>} olaylar={[]} />
);

describe("B10 Y-5: bildirim yuvasi", () => {
  it("baglam_yoksa_(bayraksiz_onizleme)_OyunEkrani_hicbir_yuva_ogesi_cizmez", () => {
    genislikAyarla(1600);
    const { container } = render(ekran);
    expect(container.querySelector("[data-bildirim-yuvasi]")).toBeNull();
    expect(container.querySelector("[data-alt-seviye]")).toBeNull(); // yan panel basamak ozniteligi de yok (DOM ayni)
  });

  it("baglam_varsa_yuva_alt_sol_sutunda_ipucunun_USTUNDE_ve_tasinan_bant_oraya_girer", () => {
    genislikAyarla(1600);
    function Kok() {
      const [yuva, setYuva] = useState<HTMLElement | null>(null);
      return (
        <BildirimYuvaSaglayici value={setYuva}>
          {ekran}
          {yuva !== null ? createPortal(<div data-testid="bant">bant</div>, yuva) : null}
        </BildirimYuvaSaglayici>
      );
    }
    const { container } = render(<Kok />);
    const yuva = container.querySelector("[data-bildirim-yuvasi]") as HTMLElement;
    expect(yuva).not.toBeNull();
    expect(yuva.contains(screen.getByTestId("bant"))).toBe(true);
    const ipucu = screen.getByTestId("ipucu");
    expect(yuva.parentElement).toBe(ipucu.parentElement); // ayni sutun
    expect(yuva.compareDocumentPosition(ipucu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // yuva ipucundan ONCE (ustte)
  });
});
