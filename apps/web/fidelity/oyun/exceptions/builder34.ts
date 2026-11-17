import type { OyunException } from "../exceptions";

const omit = (line: string | RegExp, reason: string): OyunException => ({ screen: "builder", kind: "omit", line, reason });

const SURE = "W7: prototipin süre notu örnek kayda özgüdür (\"son 50 hafta tekrarlanır\"); oyunda yeri kaynağa göre kilit nedenidir (kayıtta yalnız kaydın süresi, canlıda modelin süreleri).";
const DUNYA = "DK-8: modelde şans payı yoktur; prototipin \"Dünya tohumu\" başlığı \"Başlangıç dünyası\", \"Tohum n\" seçenekleri \"Dünya n\" olur ve açıklama kartın metnidir. Ekranda \"tohum\" ve \"rastlantı\" geçmez.";
const KONTRAT = "DK-1 (PLAN-CANLI §8 ertelemesi): zincir bağlantısı bu sürümde yoktur; kontrat önizlemesi, işlem önizlemesi ve \"Zincire işle\" adımı sadakat istisnasıdır. Özet adımı modelin kurallarını ve seçimleri listeler.";

/** Kurucu adım 3-4 (`builder`, bStep 3 ve 4) istisnaları (W7). Satır 1-11 (marka ve adım şeridi) testte `only` ile dışarıda kalır. */
export const BUILDER34_EXCEPTIONS: readonly OyunException[] = [
  omit(/^Örnek veri \d+ hafta; üstünde son \d+ hafta tekrarlanır/, SURE),
  omit(/^Devam: Kontrata işle$/, "DK-1: beşinci adım Özet adıyla gelir (\"Devam: Özet\"); kontrata işleme yoktur. Adım adı kurucuAdim34.spec.ts ile ayrıca denetlenir."),
  omit(/^Dünya tohumu$/, DUNYA),
  omit(/^Tohum kuralı değil rastlantıyı belirler/, DUNYA),
  omit(/^(?:Tohum|Seed)\s*\d*\s*$/, DUNYA),
  omit(/^Şartın üç yerde yaşar\. Onaylayınca sürüm \d+ zincire işlenir/, KONTRAT),
  omit(/^(?:Zincirde bugün var|Zincirde planlanan|Oyun sunucusu)$/, KONTRAT),
  omit(/^Lonca hazinesi: kuruluşta yazılır\.$|^Ekonomi Şartı: sürümlü kural kaydı\.$|^Üretim, stok, kredi kararı, pano\.$/, KONTRAT),
  omit(/^\d+ ayar$/, KONTRAT),
  omit(/ayar varsayılandan farklı$|^Hepsi varsayılanda$/, KONTRAT),
  omit(/^İşlem önizlemesi \(uzman ayrıntısı\)$/, KONTRAT),
  omit(/^(?:EkonomiSarti|surum=|basimTavaniBps|satisVergisiBps|ucretStopajiBps|kurumlarVergisiBps|kasaDengelemeBps|faizKurali|patentSuresiHf|\.\.\.$|\)$|\/\/ tx )/, KONTRAT),
  omit(/^Lonca fee \(aidat\)/, KONTRAT),
  omit(/^Zincire işle ve \d+\. haftayı başlat$/, "DK-1: zincire işleme yoktur; koşuyu \"Başlat\" düğmesi kurar (her adımda görünür)."),
  omit(/^Dünya senaryosu: .* \(kontrata girmez\)$/, "W7: oyunda \"Dünya senaryosu\" Kurulum listesinde etiket ve değer olarak ayrı satırlardır (\"... (Şart'a girmez)\"); kurucuAdim34.spec.ts metni ayrıca denetler. Şart: kontrat yerine Ekonomi Şartı."),
  omit(/^Seçili süre: \d+ hafta · /, "W7: süre ve dünya özet adımındaki Kurulum listesinde ayrı satırlarda yazılır."),
];
