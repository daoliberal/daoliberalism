import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Providers, resolveLatency } from "@/providers/Providers";
import { MOCK_NOW } from "@/data/mock/clock";
import { useNow, useTreasuries } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";

describe("resolveLatency", () => {
  it("defaults to 400", () => {
    expect(resolveLatency(undefined)).toBe(400);
  });
  it("reads a number, including 0", () => {
    expect(resolveLatency("0")).toBe(0);
    expect(resolveLatency("250")).toBe(250);
  });
  it("falls back to 400 for NaN, blank or negative values", () => {
    expect(resolveLatency("abc")).toBe(400);
    expect(resolveLatency("")).toBe(400);
    expect(resolveLatency("  ")).toBe(400);
    expect(resolveLatency("-5")).toBe(400);
    expect(resolveLatency("Infinity")).toBe(400);
  });
});

describe("Providers", () => {
  it("wires data and wallet for its children", async () => {
    function Probe() {
      const w = useWallet();
      const t = useTreasuries();
      return <p>{`${w.status}:${t.data?.length ?? "…"}`}</p>;
    }
    render(
      <Providers latencyMs={0}>
        <Probe />
      </Providers>,
    );
    expect(screen.getByText("disconnected:…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("disconnected:4")).toBeInTheDocument());
  });

  it("passes the fixed mock clock explicitly in mock mode", () => {
    function Clock() {
      return <p>{`now:${useNow()}`}</p>;
    }
    render(
      <Providers latencyMs={0}>
        <Clock />
      </Providers>,
    );
    expect(screen.getByText(`now:${MOCK_NOW}`)).toBeInTheDocument();
  });
});
