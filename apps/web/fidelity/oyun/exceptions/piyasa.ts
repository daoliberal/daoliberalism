import type { OyunException } from "../exceptions";

/**
 * C katmanı (Piyasa, W6): karşılaştırılan prototip satırları yalnız yapı satırlarıdır (katman sekmeleri, "Başlangıç piyasası" ve "Piyasa" başlıkları).
 * Prototipin başlangıç değerleri (uydurma 100, %0,3 ...) ve giriş cümlesi karşılaştırılmaz: Kurucu'da değerler "Koşu başlayınca görünür", giriş cümlesi buna göre yazıldı.
 */
export const PIYASA_EXCEPTIONS: readonly OyunException[] = [];
