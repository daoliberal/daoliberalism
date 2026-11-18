import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AltSayfa } from "@/oyun/ekran/AltSayfa";
import { Diyalog } from "@/oyun/ui/Diyalog";

afterEach(cleanup);

describe("AltSayfa açıkken Diyalog", () => {
  it("diyalogdaki_input_odak_alir_yazi_girilir_odak_dongusu_yok", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AltSayfa baslik="Panel" onKapat={() => undefined}><p>icerik</p></AltSayfa>
        <Diyalog baslik="Dünya adı" onKapat={() => undefined}>
          <input aria-label="Ad" />
        </Diyalog>
      </>,
    );
    const girdi = screen.getByLabelText("Ad");
    await user.click(girdi);
    await user.keyboard("abc");
    expect(girdi).toHaveValue("abc");
    expect(girdi).toHaveFocus();
  });

  it("alt_sayfa_acilista_odagi_alir_Esc_kapatir_kapaninca_acan_dugmeye_doner", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<button type="button">ac</button>);
    const ac = screen.getByRole("button", { name: "ac" });
    ac.focus();
    let kapandi = 0;
    rerender(<><button type="button">ac</button><AltSayfa baslik="Panel" onKapat={() => { kapandi += 1; }}><p>x</p></AltSayfa></>);
    expect(screen.getByRole("dialog", { name: "Panel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(kapandi).toBe(1);
    rerender(<button type="button">ac</button>);
    expect(screen.getByRole("button", { name: "ac" })).toHaveFocus();
  });
});
