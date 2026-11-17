"use client";
import { useSearchParams } from "next/navigation";
import { isAddress } from "viem";
import type { Address } from "@/data/types";
import { TreasuryDetail } from "./TreasuryDetail";

/** Reads `?a=<treasury address>`; a missing or malformed value is passed on as "no address" (the screen says not found). */
export function TreasuryRoute() {
  const raw = useSearchParams()?.get("a") ?? null;
  const address = raw !== null && isAddress(raw, { strict: false }) ? (raw as Address) : undefined;
  return <TreasuryDetail address={address} />;
}
