import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWizard } from "@/screens/useWizard";

function setup(valid: Record<number, boolean>) {
  const state = { valid };
  const hook = renderHook(() => useWizard(3, (s) => state.valid[s] ?? true));
  return { ...hook, state };
}

describe("useWizard", () => {
  it("next_does_not_advance_from_an_invalid_step", () => {
    const { result } = setup({ 1: false });
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
  });

  it("next_advances_when_valid_and_stops_at_the_last_step", () => {
    const { result } = setup({});
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
  });

  it("back_never_goes_below_1", () => {
    const { result } = setup({});
    act(() => result.current.back());
    expect(result.current.step).toBe(1);
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.step).toBe(1);
  });

  it("go_ignores_out_of_range_steps", () => {
    const { result } = setup({});
    act(() => result.current.go(0));
    act(() => result.current.go(4));
    act(() => result.current.go(1.5));
    expect(result.current.step).toBe(1);
  });

  it("go_forward_needs_every_earlier_step_valid", () => {
    const blocked = setup({ 1: false });
    act(() => blocked.result.current.go(3));
    expect(blocked.result.current.step).toBe(1);
    const ok = setup({});
    act(() => ok.result.current.go(3));
    expect(ok.result.current.step).toBe(3);
  });

  it("go_back_is_always_allowed", () => {
    const { result, state } = setup({});
    act(() => result.current.go(3));
    state.valid[1] = false;
    act(() => result.current.go(1));
    expect(result.current.step).toBe(1);
  });

  it("canSign_only_when_all_steps_valid", () => {
    const a = setup({});
    expect(a.result.current.canSign).toBe(true);
    const b = setup({ 2: false });
    expect(b.result.current.canSign).toBe(false);
  });
});
