/**
 * Sunucuyla paylaşılan uzunluk sınırları: sunucu bu değerlerden uzununu reddeder (`runs/manager.py` `MAX_NAME_LEN`, `MAX_CITY_NAME_LEN`
 * ve `MAX_NOTE_LEN`); `tests/oyun/sinirlar.test.ts` iki tarafın aynı kaldığını denetler. Web'de tek kaynak burasıdır.
 */
/** Koşu adı, dünya adı ve şehir adı için sunucu üst sınırı (kod birimi). */
export const MAX_AD_UZUNLUK = 64;
/** "Şartı değiştir" notu için sunucu üst sınırı. */
export const MAX_NOT_UZUNLUK = 500;
