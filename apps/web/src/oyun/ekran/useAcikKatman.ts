import { useEffect, useRef, type RefObject } from "react";

/** Esc, kendi kapanışını yöneten üst katmanlara (liste kutusu, menü, diyalog) bırakılır. */
const UST_KATMAN = '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"],[aria-modal="true"]';

/** Yazı girilen öğeler: Esc burada yazıyı bozmaz, paneli kapatmaz. */
const YAZI_ALANI = "input,textarea,[contenteditable=''],[contenteditable='true']";

/**
 * Açık sağ panel ya da alt sayfa için odak yönetimi: açılınca odak `kok` öğesine taşınır, Esc odak nerede olursa olsun
 * `onKapat` çağırır (üst katman açıkken ve yazı alanındayken değil), kapanınca odak açan öğeye döner. `onKapat` verilmezse hiçbir şey yapmaz.
 */
export function useAcikKatman(kok: RefObject<HTMLElement | null>, onKapat: (() => void) | undefined): void {
  const son = useRef(onKapat);
  useEffect(() => {
    son.current = onKapat;
  });
  const etkin = onKapat !== undefined;
  useEffect(() => {
    if (!etkin) return;
    const acan = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    kok.current?.focus();
    const tus = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && (e.target.closest(UST_KATMAN) || e.target.closest(YAZI_ALANI))) return;
      son.current?.();
    };
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("keydown", tus);
      if (acan && acan !== document.body && acan.isConnected) acan.focus();
    };
  }, [etkin, kok]);
}
