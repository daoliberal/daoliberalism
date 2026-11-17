/**
 * Harita yaklaştırma/uzaklaştırma tuşları (ok tuşları değil: oklar saat çubuğunda "tek hafta"dır).
 * `tus`: `KeyboardEvent.key` değerleri ("=" artı tuşunun üstsüz hali, U+2212 gerçek eksi); `kod`: numpad `code` değerleri.
 */
export const HARITA_TUSLARI = {
  yaklas: { tus: ["+", "="], kod: ["NumpadAdd"] },
  uzaklas: { tus: ["-", "\u2212"], kod: ["NumpadSubtract"] },
} as const;

const GIRIS_ROLLERI = ["listbox", "option", "combobox", "textbox", "searchbox", "spinbutton", "menu", "menuitem", "dialog", "alertdialog"];
const GIRIS_ETIKETLERI = ["INPUT", "TEXTAREA", "SELECT", "DIALOG"];

/**
 * Genel (pencere) kısayollar yalnız odak bir girişte, liste kutusunda ya da diyalogda DEĞİLKEN çalışır.
 * Odak öğesinin kendisi ya da atalarından biri bunlardan ise `false`.
 */
export function kisayolHedefiUygun(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  for (let el: HTMLElement | null = target; el !== null; el = el.parentElement) {
    if (el.isContentEditable || GIRIS_ETIKETLERI.includes(el.tagName)) return false;
    const rol = el.getAttribute("role");
    if (rol !== null && GIRIS_ROLLERI.includes(rol)) return false;
    if (el.getAttribute("aria-modal") === "true") return false;
  }
  return true;
}
