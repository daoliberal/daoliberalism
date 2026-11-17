import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaatCubugu } from "@/oyun/screens/canli/SaatCubugu";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState } from "@/oyun/sim/types";
import { createFakeSource } from "./helpers/fakeSource";

const state: RunState = {
  runId: "r", status: "paused", week: 3, durationWeeks: 50, speed: 1, computing: false, version: 1, seedIndex: 0, values: {},
  scenarioId: "x", name: "Ada", cityNames: [],
};
function ac(ic: React.ReactNode = null) {
  const source = createFakeSource([]);
  const control = vi.spyOn(source, "control");
  render(
    <SimSourceProvider source={source}>
      <SaatCubugu runId="r" state={state} onDegistir={() => {}} panelAcik={false} />
      {ic}
    </SimSourceProvider>,
  );
  return control;
}
afterEach(cleanup);

describe("saat kısayolları kapsamı", () => {
  it("govdede_calisir", () => {
    const control = ac();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(control).toHaveBeenCalled();
  });
  it("giris_listekutusu_diyalogta_calismaz", () => {
    const control = ac(
      <>
        <input aria-label="g" />
        <ul role="listbox" aria-label="l"><li role="option" aria-selected={false} tabIndex={0}>a</li></ul>
        <div role="dialog" aria-label="d"><span tabIndex={0}>x</span></div>
        <div role="combobox" aria-expanded={false} aria-controls="l" tabIndex={0} aria-label="c" />
      </>,
    );
    for (const el of [screen.getByLabelText("g"), screen.getByRole("option"), screen.getByText("x"), screen.getByLabelText("c")]) {
      fireEvent.keyDown(el, { key: "2" });
      fireEvent.keyDown(el, { key: "ArrowRight" });
    }
    expect(control).not.toHaveBeenCalled();
  });
});
