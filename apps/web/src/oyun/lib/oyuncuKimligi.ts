/** Oyuncu kimliği: tarayıcıda kalıcı, rastgele, kişisel bilgi taşımaz. Sunucu yalnız `[A-Za-z0-9-]{8,64}` kabul eder. */
export const OYUNCU_ANAHTARI = "daoliberal.oyuncu";
const GECERLI = /^[A-Za-z0-9-]{8,64}$/;
let oturumluk: string | null = null;

function uret(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** `localStorage` `daoliberal.oyuncu` anahtarındaki kimlik; yoksa üretilip yazılır. Depolama erişilemezse süreç boyunca değişmeyen oturumluk kimlik. */
export function oyuncuKimligi(): string {
  try {
    const kayitli = window.localStorage.getItem(OYUNCU_ANAHTARI);
    if (kayitli !== null && GECERLI.test(kayitli)) return kayitli;
    const yeni = uret();
    window.localStorage.setItem(OYUNCU_ANAHTARI, yeni);
    return yeni;
  } catch {
    oturumluk ??= uret();
    return oturumluk;
  }
}

/** Yalnız sınama için: oturumluk kimliği sıfırlar. */
export function oturumlukKimligiSifirla(): void {
  oturumluk = null;
}
