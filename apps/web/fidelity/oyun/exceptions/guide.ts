import type { OyunException } from "../exceptions";

const builder = (line: string | RegExp, reason: string): OyunException => ({ screen: "builder", kind: "omit", line, reason });
const live = (line: string | RegExp, reason: string): OyunException => ({ screen: "live", kind: "omit", line, reason });

const TUR_METIN = "W12: tur metinleri modelin gerçek davranışından fazlasını söylemez; kartı anlatan içerik kartın kendi metnidir (registry), çerçeve cümleleri `rehber.*`. Prototipin tur metni ve başlığı örnek kartlara ve 13 adıma özgüdür; oyun kayıttan doğrulanan kartları (canlı değişebilenler önde) ve katman girişlerini anlatır.";
const ADIM = "W12: rehberli akışın üçüncü adımı \"Başlat ve oynat\"tır; zincire işleme bu sürümde yoktur (DK-1). Adım adı rehber.test.tsx ile ayrıca denetlenir.";
const DUR = "W12: \"Dünya durdu\" kutusunun başlık, neden ve not satırları: prototip örnek zincir ve \"Kural koydun, ölçümde bu oldu\" nedensellik cümlesi taşır; oyun yalnız olayın kendi kaydındaki adımları gösterir ve neden iddiası kurmaz.";

/** Rehberli ilk oyun (W12): tur iletişim kutusu ve ilk kritik olay kutusu. Tur ekranı sayfa metninin sonunda; `rehber.spec.ts` `only` ile yalnız o satırları karşılaştırır. */
export const GUIDE_EXCEPTIONS: readonly OyunException[] = [
  builder(/^(?:Kurallar senin Şartın|Dünyanın insanları kural değil|Piyasayı sen seçmezsin, izlersin)\s*\d+ \/ \d+$/, TUR_METIN),
  builder(/^[ABC] katmanı: /, TUR_METIN),
  builder(/ › .*\d+ \/ \d+$/, TUR_METIN),
  builder(/(?:^Bu ne demek: ).*Oyunda neyi değiştirir: /, TUR_METIN),
  builder(/Oyunda neyi değiştirir: /, TUR_METIN),
  builder(/^Devam: Zincire işle ve oynat$/, ADIM),
  builder(/^\d*\s*Zincire işle ve oynat$/, ADIM),
  builder(/^Zincire işle ve \d+\. haftayı başlat$/, "DK-1: zincire işleme yoktur; koşuyu \"Başlat\" düğmesi kurar (her adımda görünür)."),
  live(/^Dünya durdu: hf \d+, .*Neden\?$/, DUR),
  live(/^(?:Zarar|Kasa|Kredi|Firma|Zarar eden) .*→/, DUR),
  live(/^Bu kuralı değiştir$/, "W12 düzeltme 1: olay kimlikleri kart değildir; kutu olayla ilgisiz bir kartı \"bu kural\" diye önermez, genel \"Şartı değiştir\" gösterir. \"Bu kuralı değiştir\" yalnız olay kayıtta bir karta çözülürse çıkar (rehber.test.tsx)."),
  live(/^Kural koydun, ölçümde bu oldu\./, DUR),
  live(/^"Bu hafta" şeridi: her hafta neyin değiştiğini ok ve farkla gösterir\.$/, "W12: ipucu metni oyunun gerçek şeridini anlatır (sekiz değer ve önceki haftaya fark); \"ok\" sözcüğü kullanılmaz."),
];
