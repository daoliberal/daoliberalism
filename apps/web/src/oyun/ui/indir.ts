/** Metni dosya olarak indirir (gecici `<a download>` + Blob adresi). Tarayici disinda ya da Blob yoksa `false`. */
export function dosyaIndir(ad: string, metin: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const adres = URL.createObjectURL(new Blob([metin], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = adres;
  a.download = ad;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adres), 10_000);
  return true;
}
