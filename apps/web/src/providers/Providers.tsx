"use client";
import { useState, type ReactNode } from "react";
import { mockNow } from "@/data/mock/clock";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import { DataProvider } from "./DataProvider";
import { MockWalletProvider } from "./MockWallet";

const DEFAULT_LATENCY_MS = 400;

/** NEXT_PUBLIC_MOCK_LATENCY in ms; anything that is not a finite number >= 0 means the default. */
export function resolveLatency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LATENCY_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LATENCY_MS;
}

/** Client wrapper for the (server) root layout: mock data source + mock wallet. */
export function Providers({ children, latencyMs }: { children: ReactNode; latencyMs?: number }) {
  const [source] = useState(() =>
    createMockDataSource({ latencyMs: latencyMs ?? resolveLatency(process.env.NEXT_PUBLIC_MOCK_LATENCY) }),
  );
  return (
    <DataProvider source={source} now={mockNow}>
      <MockWalletProvider>{children}</MockWalletProvider>
    </DataProvider>
  );
}
