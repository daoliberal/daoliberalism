"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import type { NavKey } from "./Nav";

type MobileHeaderProps = Parameters<typeof import("./MobileHeader").MobileHeader>[0];
export type RouteFrame = { variant: "bare" } | { variant: "landing" } | { variant: "app"; current?: NavKey; mobile: MobileHeaderProps };

const ROOT: MobileHeaderProps = { variant: "root" };

/**
 * The routing table: which frame wraps which route (paths without the trailing slash).
 * Screens never render AppShell; to give a new route a frame, add one line here.
 * Only /treasury gets the phone "detail" header (C-M2-Treasury); every other route uses the root header.
 */
const ROUTES: Record<string, RouteFrame> = {
  "/": { variant: "landing" },
  "/treasuries": { variant: "app", current: "treasuries", mobile: ROOT },
  "/treasuries/new": { variant: "app", current: "treasuries", mobile: ROOT },
  "/treasury": {
    variant: "app",
    current: "treasuries",
    mobile: { variant: "detail", backHref: "/treasuries/", backLabel: "Back to treasuries", title: "Treasury" },
  },
  "/daos": { variant: "app", current: "daos", mobile: ROOT },
  "/daos/new": { variant: "app", current: "daos", mobile: ROOT },
  "/dao": { variant: "app", current: "daos", mobile: ROOT },
  "/agents": { variant: "app", current: "agents", mobile: ROOT },
  "/earnings": { variant: "app", current: "earnings", mobile: ROOT },
};

/** Unknown routes (404) get the app frame with no section marked. */
export function routeFor(pathname: string): RouteFrame {
  const key = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (key === "/oyun" || key.startsWith("/oyun/")) return { variant: "bare" };
  return ROUTES[key] ?? { variant: "app", mobile: ROOT };
}

/** Client wrapper used by the root layout: frames the current route's page. */
export function RouteShell({ children }: { children: ReactNode }) {
  const frame = routeFor(usePathname() ?? "/");
  if (frame.variant === "bare") return <>{children}</>;
  if (frame.variant === "landing") return <AppShell variant="landing">{children}</AppShell>;
  return (
    <AppShell variant="app" current={frame.current} mobile={frame.mobile}>
      {children}
    </AppShell>
  );
}
