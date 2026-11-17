import { mockNow } from "@/data/mock/clock";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { DataSource } from "@/data/datasource";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import type { MockOptions } from "@/data/mock/MockDataSource";
import { DataProvider } from "@/providers/DataProvider";
import { walletPort, WithWallet } from "./shell";

/** Renders a screen over the real mock data source with a spy on `execute`. */
export function renderScreen(ui: ReactElement, opts: { disconnected?: boolean; mock?: MockOptions } = {}) {
  const real = createMockDataSource(opts.mock);
  const execute = vi.fn(real.execute);
  const source: DataSource = { ...real, execute };
  const wallet = walletPort(opts.disconnected ? { address: null } : {});
  const view = render(
    <DataProvider now={mockNow} source={source} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WithWallet wallet={wallet}>{ui}</WithWallet>
    </DataProvider>,
  );
  return { ...view, execute, wallet };
}
