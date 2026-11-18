import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepIcon } from "@/components/primitives/icons";
import { SehirSecici } from "@/oyun/ekran/SehirSecici";
import { t } from "@/oyun/copy/t";
import { IkonDugmesi } from "@/oyun/ui/IkonDugmesi";
import { SEHIRLER } from "../ekran/ekranYardim";

afterEach(cleanup);

describe("IkonDugmesi", () => {
  it("aria_label_ve_ipucu_ayni_metin_tiklama_eylemi_cagirir", () => {
    const onClick = vi.fn();
    render(<IkonDugmesi variant="primary" etiket="Bir hafta ilerle" ikon={<StepIcon size="20" />} onClick={onClick} />);
    const d = screen.getByRole("button", { name: "Bir hafta ilerle" });
    expect(d).toHaveAttribute("aria-label", "Bir hafta ilerle");
    expect(d.textContent).toBe(""); // yalnız ikon: görünür metin yok
    expect(d.querySelector("svg")).not.toBeNull();
    const ipucu = screen.getByText("Bir hafta ilerle", { selector: "span[aria-hidden]" });
    expect(ipucu).toBeInTheDocument(); // fare/odak ile CSS gösterir
    fireEvent.click(d);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("basili_durum_ve_kapali_durum_korunur", () => {
    render(<IkonDugmesi variant="toggle" etiket="Duraklat" ikon={<StepIcon size="20" />} pressed disabled />);
    const d = screen.getByRole("button", { name: "Duraklat" });
    expect(d).toHaveAttribute("aria-pressed", "true");
    expect(d).toBeDisabled();
  });

  it("copy_metinleri_hafta_denetimleri_ve_menu", () => {
    expect(t("dao.bir_hafta")).toBe("Bir hafta ilerle");
    expect(t("dao.olay_kadar")).toBe("Bir şey olana kadar devam et");
    expect(t("dao.duraklat")).toBe("Duraklat");
    expect(t("kurucu.menu.dugme")).toBe("Menü");
  });
});

describe("Şehir seçici etiketi", () => {
  it("dugme_yalniz_ikon_ipucu_Sehir_sehir_adi_yazmaz", () => {
    render(<SehirSecici sehirler={SEHIRLER} sehir={1} onSehir={() => {}} />);
    const d = screen.getByRole("button", { name: "Şehir" });
    expect(d.textContent).toBe(""); // yalnız ikon
    expect(d.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Şehir", { selector: "span[aria-hidden]" })).toBeInTheDocument();
    for (const s of SEHIRLER) expect(d.textContent).not.toContain(s.ad);
  });
});

describe("G4 mobil tam ekran katman", () => {
  it("izo_ipucu_dokunmatikte_gorunur_kart_ve_X_ile_kapanir", async () => {
    const { IzoIpucu } = await import("@/oyun/harita/IzoIpucu");
    const kapat = vi.fn();
    render(<IzoIpucu id="ip" veri={{ ad: "Fırın", durum: "uretim", calisan: 2, sahip: "npc", x: 1, y: 1 }} kapat={kapat} />);
    fireEvent.click(screen.getByRole("button", { name: t("harita.ipucu_kapat") }));
    expect(kapat).toHaveBeenCalledTimes(1);
  });
});

describe("G5 olay seridi dugme", () => {
  it("serit_kendisi_dugme_ayri_Tum_olaylar_dugmesi_yok", async () => {
    const { OlaySeridi } = await import("@/oyun/ekran/OlaySeridi");
    const ac = vi.fn();
    render(<OlaySeridi olaylar={[{ id: 1, metin: "a" }, { id: 2, metin: "b" }]} kapi={{ ad: "Tüm olayları aç", onAc: ac }} kapiUstte />);
    expect(screen.getByRole("log", { name: t("ekran.olay_baslik") })).toBeInTheDocument();
    const d = screen.getByRole("button", { name: "Tüm olayları aç" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(d);
    expect(ac).toHaveBeenCalledTimes(1);
  });
});
