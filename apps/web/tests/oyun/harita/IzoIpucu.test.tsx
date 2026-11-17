import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IzoIpucu, type IpucuVerisi } from "@/oyun/harita/IzoIpucu";
import { ipucuYeri } from "@/oyun/harita/izoIpucuYer";

const KUTU = { genislik: 800, yukseklik: 600 };
const OLCU = { genislik: 220, yukseklik: 72 };
const veri = (ek: Partial<IpucuVerisi> = {}): IpucuVerisi => ({ ad: "Fırın", durum: "uretim", calisan: 12, sahip: "npc", x: 300, y: 300, ...ek });
afterEach(cleanup);

describe("IzoIpucu", () => {
  it("ipucu_ad_durum_ve_calisan_metni", () => {
    render(<IzoIpucu id="ip" veri={veri({ durum: "kapali" })} />);
    const ip = screen.getByRole("tooltip");
    expect(ip).toHaveAttribute("id", "ip");
    expect(ip).toHaveTextContent("Fırın");
    expect(ip).toHaveTextContent("kapalı");
    expect(ip).toHaveTextContent("12 çalışan");
  });
  it("ipucu_oyuncu_isletmesini_belirtir_npcyi_belirtmez", () => {
    const { rerender } = render(<IzoIpucu id="ip" veri={veri({ sahip: "oyuncu" })} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Oyuncu işletmesi");
    rerender(<IzoIpucu id="ip" veri={veri({ sahip: "npc" })} />);
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("Oyuncu işletmesi");
  });
  it("isletme_olmayan_binada_durum_ve_calisan_yazilmaz", () => {
    render(<IzoIpucu id="ip" veri={veri({ ad: "Ahır", calisan: null, sahip: null })} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Ahır$/);
  });
  it("veri_yoksa_hicbir_sey_cizilmez", () => {
    render(<IzoIpucu id="ip" veri={null} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("ipucu_imlecin_sag_altinda_ve_imlecle_birlikte_kayar", () => {
    expect(ipucuYeri(100, 100, OLCU, KUTU, 12)).toEqual({ x: 112, y: 112 });
    expect(ipucuYeri(300, 250, OLCU, KUTU, 12)).toEqual({ x: 312, y: 262 });
  });
  it("ipucu_tuvalden_tasarsa_imlecin_karsi_yanina_gecer", () => {
    expect(ipucuYeri(700, 100, OLCU, KUTU, 12)).toEqual({ x: 700 - 12 - 220, y: 112 });
    expect(ipucuYeri(100, 560, OLCU, KUTU, 12)).toEqual({ x: 112, y: 560 - 12 - 72 });
    expect(ipucuYeri(790, 590, OLCU, KUTU, 12)).toEqual({ x: 790 - 12 - 220, y: 590 - 12 - 72 });
  });
  it("ipucu_dar_tuvalde_kenara_kistirilir", () => {
    expect(ipucuYeri(50, 20, OLCU, { genislik: 200, yukseklik: 60 }, 12)).toEqual({ x: 0, y: 0 });
  });
  it("tooltip_gorsel_gizli_erisilebilir_kopya_ve_inline_stilsiz", () => {
    render(<IzoIpucu id="ip" veri={veri({ x: 700, y: 500 })} />);
    const ip = screen.getByRole("tooltip");
    expect(ip.className).toMatch(/ipucu/);
    expect(ip.getAttribute("style")).toBeNull();
  });
});
