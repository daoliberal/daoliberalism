/**
 * Koşular ekranının ekranlar arası bağlamı (bellekte, sayfa yenilenince sıfırlanır): son bakılan koşu ("Kaydet" ve "Karşılaştır" bunu kullanır)
 * ve Sonuç ekranının A/B'de önceden seçeceği B koşusu.
 */
let sonKosu: string | null = null;
let abAday: string | null = null;

export const sonKosuYaz = (runId: string | null): void => {
  sonKosu = runId;
};
export const sonKosuOku = (): string | null => sonKosu;

export const abAdayiYaz = (runId: string | null): void => {
  abAday = runId;
};
/** Önerilen B koşusunu bir kez verir ve unutur. */
export function abAdayiAl(): string | null {
  const x = abAday;
  abAday = null;
  return x;
}
