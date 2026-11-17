import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { DataSource } from "@/data/datasource";
import { DEPLOYMENTS, type Deployments } from "@/data/deployments";
import { wallClockNow } from "@/lib/time";

interface DataContextValue {
  source: DataSource;
  now: () => bigint;
  deployments: Deployments;
}

const DataContext = createContext<DataContextValue | null>(null);

function useDataContext(): DataContextValue {
  const v = useContext(DataContext);
  if (!v) throw new Error("useDataSource must be used inside a DataProvider");
  return v;
}

export const useDataSource = (): DataSource => useDataContext().source;
export const useDeployments = (): Deployments => useDataContext().deployments;
/** The clock function itself (use `useNow()` from hooks for the current value). */
export const useClock = (): (() => bigint) => useDataContext().now;

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 } },
  });
}

export function DataProvider(props: {
  source: DataSource;
  /** Clock for time-dependent views; defaults to the system clock (mock mode passes its fixed clock explicitly). */
  now?: () => bigint;
  deployments?: Deployments;
  /** Tests inject their own client. */
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [own] = useState(newQueryClient);
  const value: DataContextValue = {
    source: props.source,
    now: props.now ?? wallClockNow,
    deployments: props.deployments ?? DEPLOYMENTS,
  };
  return (
    <QueryClientProvider client={props.queryClient ?? own}>
      <DataContext.Provider value={value}>{props.children}</DataContext.Provider>
    </QueryClientProvider>
  );
}
