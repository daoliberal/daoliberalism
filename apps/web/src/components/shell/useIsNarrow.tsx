"use client";
import { useEffect, useSyncExternalStore } from "react";

/** The single layout breakpoint (documented in tokens.css). Defined here once; CSS repeats it only inside @media. */
export const NARROW_QUERY = "(max-width: 720px)";

const media = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY) : null;

function subscribe(onChange: () => void): () => void {
  const m = media();
  m?.addEventListener("change", onChange);
  return () => m?.removeEventListener("change", onChange);
}

const getSnapshot = (): boolean => media()?.matches ?? false;
// Server render and hydration are always the wide layout; the real answer arrives right after.
const getServerSnapshot = (): boolean => false;

/**
 * True on a phone-width viewport. Once the viewport is known it also writes `data-layout` ("wide" | "narrow") and
 * `data-theme` ("light" | "dark") on <html>: the prototype shows the desktop layout light and the mobile layout dark.
 * Fidelity and screenshot steps wait for `data-layout` before they measure anything.
 */
export function useIsNarrow(): boolean {
  const narrow = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    const m = media();
    if (!m) return;
    const apply = (isNarrow: boolean) => {
      const root = document.documentElement;
      root.dataset.layout = isNarrow ? "narrow" : "wide";
      root.dataset.theme = isNarrow ? "dark" : "light";
    };
    apply(m.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
