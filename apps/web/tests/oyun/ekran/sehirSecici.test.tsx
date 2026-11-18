import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SehirSecici } from "@/oyun/ekran/SehirSecici";
import { t } from "@/oyun/copy/t";
import { SEHIRLER } from "./ekranYardim";

afterEach(cleanup);

function kur(sehir = 0) {
  const onSehir = vi.fn();
  render(<SehirSecici sehirler={SEHIRLER} sehir={sehir} onSehir={onSehir} />);
  return { onSehir, dugme: screen.getByRole("button", { name: "Şehir" }) };
}

describe("SehirSecici", () => {
  it("klavyeyle_ac_ok_tuslari_enter_secer", async () => {
    const user = userEvent.setup();
    const { onSehir, dugme } = kur();
    expect(dugme).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    dugme.focus();
    await user.keyboard("{Enter}");
    expect(dugme).toHaveAttribute("aria-expanded", "true");
    const liste = screen.getByRole("listbox", { name: t("ekran.sehir_liste") });
    expect(liste).toHaveFocus();
    const secenekler = screen.getAllByRole("option");
    expect(secenekler).toHaveLength(3);
    expect(secenekler[0]).toHaveAttribute("aria-selected", "true");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[0].id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[2].id);
    await user.keyboard("{ArrowDown}");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[2].id);
    await user.keyboard("{ArrowUp}");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[1].id);
    await user.keyboard("{Enter}");
    expect(onSehir).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dugme).toHaveFocus();
  });

  it("escape_kapatir_secim_yapmaz_odagi_geri_verir", async () => {
    const user = userEvent.setup();
    const { onSehir, dugme } = kur();
    await user.click(dugme);
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSehir).not.toHaveBeenCalled();
    expect(dugme).toHaveFocus();
  });

  it("ok_asagi_dugmeden_acar_home_end_calisir", async () => {
    const user = userEvent.setup();
    const { onSehir, dugme } = kur(1);
    dugme.focus();
    await user.keyboard("{ArrowDown}");
    const liste = screen.getByRole("listbox");
    const secenekler = screen.getAllByRole("option");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[1].id);
    await user.keyboard("{Home}");
    expect(liste).toHaveAttribute("aria-activedescendant", secenekler[0].id);
    await user.keyboard("{End}{Enter}");
    expect(onSehir).toHaveBeenCalledWith(2);
  });

  it("tiklayarak_secer_ve_disina_tiklayinca_kapanir", async () => {
    const user = userEvent.setup();
    const { onSehir, dugme } = kur();
    await user.click(dugme);
    await user.click(screen.getByRole("option", { name: new RegExp(SEHIRLER[2].ad) }));
    expect(onSehir).toHaveBeenCalledWith(2);
    await user.click(dugme);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("SehirSecici liste degisimi", () => {
  it("liste_kuculunce_aktif_sinirlanir_bos_listede_activedescendant_yok", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SehirSecici sehirler={SEHIRLER} sehir={2} onSehir={() => undefined} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[2].id);
    rerender(<SehirSecici sehirler={SEHIRLER.slice(0, 1)} sehir={0} onSehir={() => undefined} />);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    rerender(<SehirSecici sehirler={[]} sehir={0} onSehir={() => undefined} />);
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-activedescendant");
  });
});
