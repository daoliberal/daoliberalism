import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Diyalog } from "@/oyun/ui/Diyalog";

afterEach(cleanup);

function Host() {
  const [acik, setAcik] = useState(false);
  return (
    <div>
      <button onClick={() => setAcik(true)}>Aç</button>
      {acik ? (
        <Diyalog baslik="Deneme başlığı" onKapat={() => setAcik(false)}>
          <button>İlk</button>
          <button>Son</button>
        </Diyalog>
      ) : null}
    </div>
  );
}

describe("Diyalog", () => {
  it("diyalog_focus_trap_escape_returns_focus", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const ac = screen.getByRole("button", { name: "Aç" });
    await user.click(ac);
    const d = screen.getByRole("dialog", { name: "Deneme başlığı" });
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(d.contains(document.activeElement)).toBe(true);
    // Tab dışarı kaçmaz
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(d.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(d.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ac).toHaveFocus();
  });

  it("kapat_dugmesi_kapatir_ve_odak_doner", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const ac = screen.getByRole("button", { name: "Aç" });
    await user.click(ac);
    await user.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ac).toHaveFocus();
  });
});
