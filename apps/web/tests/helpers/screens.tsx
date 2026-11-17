import { mockNow } from "@/data/mock/clock";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMockDataSource, type MockOptions } from "@/data/mock/MockDataSource";
import type { WalletPort } from "@/providers/WalletPort";
import { DataProvider } from "@/providers/DataProvider";
import { walletPort, WithWallet } from "./shell";

/** Renders a screen against a fresh mock data source and a (default: owner) connected wallet. */
export function renderScreen(ui: ReactElement, opts: { wallet?: WalletPort; mock?: MockOptions } = {}) {
  const source = createMockDataSource(opts.mock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wallet = opts.wallet ?? walletPort();
  const view = render(
    <DataProvider now={mockNow} source={source} queryClient={queryClient}>
      <WithWallet wallet={wallet}>{ui}</WithWallet>
    </DataProvider>,
  );
  return { ...view, source, queryClient, wallet };
}
