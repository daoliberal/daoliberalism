import type { OyunException } from "../exceptions";
import { LIVE_EXCEPTIONS } from "./live";

/** Canlı görünüm ekranları (`live-world`, `live-city`, `live-chain`): canlı ekranın ortak istisnaları ve her görünüme yazılan kopyası. */
export const CANLI_EKRANLARI = ["live-world", "live-city", "live-chain"] as const;

export const forScreens = (screens: readonly string[], list: readonly Omit<OyunException, "screen">[]): OyunException[] =>
  screens.flatMap((screen) => list.map((e) => ({ ...e, screen })));

const COMMON: Omit<OyunException, "screen">[] = [
  { kind: "omit", line: /^Koyu tema$/, reason: "Dar ekranda tema düğmesi üst çubuğun menüsündedir (kabuk davranışı, canlı ekran değil)." },
  { kind: "omit", line: /^Dünya: (Sağlıklı|Uyarı|Çöküş)$/, reason: "Sağlık düzeyi canlı modelin o haftaki karşılamasına bağlıdır; hangi düzeyin göründüğü koşuya göre değişir (birim testi üç düzeyi sınar)." },
  { kind: "omit", line: /^(En kötü şehir|En kıt halka|Kasa|Politika faizi):/, reason: "Değerler sunucudan; kasa Akçe/bin olarak, faiz haftalık gösterilir (prototipteki 'hf' ve yıllık karşılıklar örnek veridir). Şehir adı ve en kıt halka koşuya bağlıdır." },
  { kind: "omit", line: /Bu hafta karşılama/, reason: "Prototipte tek satır, MVP'de sekiz değerli ayrı bileşen (birim testiyle denetlenir)." },
  { kind: "omit", line: /^Henüz olay yok\. Oynat'a bas\.$/, reason: "Boş durum yalnız olay gelmeden önce görünür; koşu birkaç hafta oynatılmıştır." },
  { kind: "omit", line: /^Zincir kayıtları$/, reason: "Zincir kayıtları (üretim günlüğü) Dilim 3." },
  {
    kind: "omit", line: /^(Talep karşılama|İşsizlik|Fiyat endeksi|Servet Gini|Şehir kasası|Basım payı|Politika faizi \(haftalık\)|Kredi \(verilen|Ortalama kredi faizi|Firmalar \(yerleşik|Yeni firmaların 52|Destek \/ kurtarma)/,
    reason: "Prototipin örnek seri göstergeleri; oyunda göstergeler sunucunun ölçtüğü alanlardır ve adları FIELD_NOTES'a göre yazılır (basım toplamı, haftalık faiz, ölçülmeyen 'ölçülmüyor').",
  },
  {
    kind: "omit", line: /^(kendiliğinden oluşan değerler|Enflasyon \(hedef|İşsizlik \(normal kabul|Ücret endeksi|Kira \(çırak|Konut fiyat|Mevduat faizi|Şehir tahvili|Ortalama lonca|Ortalama telif|Navlun)/,
    reason: "Piyasa satırları sunucu alanlarına göre yeniden adlandırıldı (yıllık enflasyon 66. haftadan itibaren, haftalık faizler, konut endeksi); prototipteki yıllıklandırılmış ve 'faiz yükseliyor' yorumları örnek veridir.",
  },
  {
    kind: "omit", line: /^(En kıt 5 halka \(dünya\)|karşılanmayan talep payı|Plastik%|Petrol%|Buğday%|Un%|Elektrik%)/,
    reason: "En kıt halkalar Zincir görünümünde ve sunucunun panosundan (kıtlık, süreklilik) gelir; prototipin karşılanmayan talep yüzdeleri örnek veridir.",
  },
];

export const LIVE_SHARED_EXCEPTIONS: readonly OyunException[] = [
  ...CANLI_EKRANLARI.flatMap((screen) => LIVE_EXCEPTIONS.map((e) => ({ ...e, screen }))),
  ...forScreens(CANLI_EKRANLARI, COMMON),
];
