import type { OyunException } from "../exceptions";

/**
 * B katmanı (Dünyanın insanları, W6): karşılaştırılan prototip satırları yapı satırlarıdır (sekmeler, şerit, giriş, senaryo satırı ve düğmesi).
 * Aktör kartlarının metni kayıttan (registry) gelir ve prototipin uydurma değerleriyle karşılaştırılmaz; spec onları ayrıca denetler.
 *
 * Bilinçli yapı farkları (karşılaştırma aralığı dışında; sebepleriyle):
 *  - Aktör sekmeleri numarasız ("Haneler"; prototipte "1. Haneler"): sekme ARIA adı sıra sayısı taşımaz.
 *  - Altıncı sekme "Dünya kalibrasyonu"; "Dünya kuralları" (Y) ayrı, tüm aktörlerin altında bir bölümdür (prototipte "Dünya kuralları ve sabitleri" sekmesi):
 *    kalibrasyon V kartıdır (aktör sekmesi), Y kartı değildir.
 *  - Aktör başlığı ("Haneler" h3) ve "Uzman ayrıntısını göster" yok: sekme zaten adı taşır; uzman/kullanıcı ayrımı bu katmanda kayıtta yok.
 *  - Kart başına "Etki" düğmesi yok: kart zaten "Oyunda neyi değiştirir" satırını taşır (RuleCard ile aynı).
 *  - Piyasa'da "Başlangıç (5 şehirde aynı)" sütun başlığı ve "Şehirler: ..." satırı yok: başlangıç değerleri koşu başlayınca ölçülür ve şehir adları editörde bilinmez.
 */
export const INSANLAR_EXCEPTIONS: readonly OyunException[] = [
  { screen: "builder", kind: "strip", line: "Simüle edilen davranışlar: kural değil, varsayım", reason: "W6: sekme adı ile alt satırı sayfada ayrı satırlardır (prototipte bitişik görünür); alt satırı spec ayrıca denetler, sekme adı bu satırda kalır." },
  { screen: "builder", kind: "strip", line: "Kendiliğinden oluşan değerler: ayar değil", reason: "W6: sekme adı ile alt satırı sayfada ayrı satırlardır (prototipte bitişik görünür); alt satırı spec ayrıca denetler, sekme adı bu satırda kalır." },
];
