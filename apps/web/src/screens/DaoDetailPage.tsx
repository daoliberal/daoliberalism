"use client";
import { useSearchParams } from "next/navigation";
import { DaoDetail } from "./DaoDetail";

/** Reads `?id=<n>` (static export: no dynamic segment). Must sit under <Suspense> or `next build` fails. */
export function DaoDetailPage() {
  const raw = useSearchParams().get("id");
  const id = raw !== null && /^\d{1,30}$/.test(raw) ? BigInt(raw) : undefined;
  return <DaoDetail id={id} />;
}
