"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The safest control of the current view (marked data-autofocus), else the dialog itself. */
function focusStart(root: HTMLElement): void {
  (root.querySelector<HTMLElement>("[data-autofocus]") ?? root).focus();
}

/**
 * Modal behaviour: focus moves into the dialog and is handed back to the opener on close; Tab wraps inside; focus that
 * escapes is pulled back; Escape cancels, but only while `canCancel` (for the signing dialog: still reviewing, never while a wallet request is open). `focusKey` changes with the view and puts focus on its safest control.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, canCancel: boolean, cancel: () => void, focusKey: string): void {
  const live = useRef({ canCancel, cancel });
  useEffect(() => {
    live.current = { canCancel, cancel };
  });

  // Declared first on purpose: on unmount its cleanup (listeners off) must run before the opener gets focus back,
  // otherwise the focus guard below would pull focus straight back into the closing dialog.
  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Escape") {
        if (live.current.canCancel) {
          e.preventDefault();
          live.current.cancel();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        root.focus();
      } else if (!root.contains(active) || active === root) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const root = ref.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) focusStart(root);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [ref]);

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Each view (and a layout swap) puts focus on its own safest control.
  useLayoutEffect(() => {
    if (ref.current) focusStart(ref.current);
  }, [ref, focusKey]);
}

