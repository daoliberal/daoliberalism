import type { OyunException } from "../exceptions";
import { forScreens } from "./liveShared";

/**
 * Dünya ve Şehir görünümü istisnaları.
 * Dünya görünümü: beş şehir düğümü SVG yerine HTML ızgara (sabit dizilim: üstte üç, altta iki). Prototipte SVG yalnız ticaret, göç ve kasa
 * dengeleme çizgileri içindir (aria-hidden); sunucu şehir çifti verisi vermediği için çizilecek çizgi yoktur, düğümler zaten HTML düğmedir.
 * HTML ızgara dar ekranda okunur kalır (SVG ölçeklenince yazı küçülürdü).
 */
export const LIVE_WORLD_EXCEPTIONS: readonly OyunException[] = forScreens(["live-world"], [
  { kind: "omit", line: /^Şehir \d Sağlıklı karşılama/, reason: "Düğüm metni: karşılama, işsizlik ve kasa (Akçe); kasa hafta cinsinden şehir başına ölçülmez (city_cash_weeks yalnız dünya)." },
  { kind: "omit", line: /^Ticaret \(kalınlık/, reason: "Ticaret ve göç çizgileri ile kasa dengeleme yok: sunucu şehir çifti akışı vermiyor; açıklama cümlesi 'Bir şehre bas: ayrıntı çekmecesi açılır.'" },
]);

export const LIVE_CITY_EXCEPTIONS: readonly OyunException[] = forScreens(["live-city"], [
  { kind: "omit", line: /^Şehir \d(karşılama|$)/, reason: "Şehir başlığı: karşılama, çalışan, işsiz, kasa (Akçe), firmalar, göç; batan firma ve kasa haftası şehir başına ölçülmez." },
  { kind: "omit", line: /^(Lonca \d · |Çalışan haneler|İşsiz haneler)/, reason: "Lonca ve hane bantları: şehir başına üye ve hane sayısı sunucu paketinde yok." },
  { kind: "omit", line: /^EnerjiGıdaKimya/, reason: "Parseller tek firma değil şehirdeki sektördür (kutu büyüklüğü firma sayısı sınıfı); sektör adları ve açıklama metni sunucudan ve tr.ts'ten gelir." },
  { kind: "omit", line: /^Şehir: Şehir \d \(karşılama/, reason: "Gösterge kapsam cümlesi yeniden yazıldı ('Şehir: ad. Karşılama, işsizlik, kasa ve firmalar şehir değeridir; diğerleri dünya değeridir.')." },
  { kind: "omit", line: /^[YO]$/, reason: "Prototipin firma etiketleri (Y yerleşik, O oyuncu); parseller sektör kutularıdır." },
  { kind: "omit", line: /^Şehir \d$/, reason: "Şehir seçici düğmeleri koşuya girilen şehir adlarını taşır." },
]);
