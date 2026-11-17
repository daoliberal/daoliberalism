/**
 * Oyun ekranı kabuğunun ölçüleri (renkler `ekranRenkleri.module.css` takma adlarındadır).
 * CSS tarafındaki kırılma noktaları (`@media (max-width: ...)`) bu değerlerle aynı olmalıdır; test bunu denetler.
 * Panel genişlikleri, boşluklar ve yüzen öğe ölçüleri `tokens.css` belirteçlerinden gelir, CSS modüllerindedir.
 */
export const EKRAN_STILI = {
  /** Piksel genişlik sınırları. Telefon: paneller alt sayfa olur. Dar: sol panel kapalı açılır. */
  kirilma: { telefon: 720, dar: 1280 },
  /** Olay şeridinde aynı anda görünen en çok olay. */
  olaySayisi: 3,
  /** Ölçülen yüzen öğeler (paneller, şeritler) ile harita arasında bırakılan boşluk (piksel). */
  payAralik: 8,
} as const;

export type EkranBoyutu = { telefon: boolean; dar: boolean };

/** `max-width` medya sorgusu (piksel). */
export const genislikSorgusu = (px: number): string => `(max-width: ${px}px)`;
