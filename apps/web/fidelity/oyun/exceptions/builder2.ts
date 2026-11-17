import type { OyunException } from "../exceptions";

/**
 * Prototipteki grup adı (numarasız) ve kayıttaki gerçek karşılığı. GEÇİCİ: R1b grup adlarını prototiple hizaladığında ilgili satır buradan ve
 * `sartEditoru.spec.ts` içindeki "gereksiz istisna" denetiminden kalkar (denetim, sayfada bu ad belirince spec'i kırar).
 */
export const BUILDER2_GRUP_FARKLARI: readonly { proto: string; kayit: string }[] = [
  { proto: "Kurtarma ve destek", kayit: "Kurtarma ve geçiş" },
  { proto: "Düzenleme", kayit: "Fiyat ve düzenleme" },
  { proto: "Buluş ve patent", kayit: "İnovasyon ve sektörler" },
];

/**
 * Kurucu adım 2 (`builder`, bStep 2) istisnaları (W4). Bu görev A katmanının çekirdeğini (şerit, arama, gruplar, kural kartları) kurar;
 * B ve C katmanı sekmeleri, "Senaryoyu değiştir", turu başlatma, Canlı özet ve Tutarlılık uyarıları sonraki görevlerdedir (W5, W6, W12)
 * ve spec'te `only` aralıklarının dışında bırakılır.
 */
export const BUILDER2_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "builder",
    kind: "strip",
    line: "Senin Ekonomi Şartın: kontrata işlenir",
    reason: "W4: sekme adı ile alt satırı sayfada ayrı satırlardır (prototipte bitişik yazılmış görünür); alt satırı spec ayrıca denetler, sekme adı bu satırda kalır.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: /^Ücretten gelir vergisi(?=Kurallar)/,
    reason: "W4: prototip kartı eski adıyla (Ücretten gelir vergisi) listeler; kayıtta kart adı Ücret stopajıdır ve eski ad `aliases` ile aranır, bulunur. Sonucun yeri (Kurallar › grup) beklenir.",
  },
  ...BUILDER2_GRUP_FARKLARI.map(
    (g): OyunException => ({
      screen: "builder",
      kind: "omit",
      line: new RegExp(`^\\d+\\. ${g.proto}$`),
      reason: `W4 (geçici, grup adları hizalanınca kalkar): prototipte grup "${g.proto}", kayıtta "${g.kayit}" (ad farkı).`,
    }),
  ),
];
