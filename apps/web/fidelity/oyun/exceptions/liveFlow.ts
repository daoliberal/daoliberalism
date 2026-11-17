import type { OyunException } from "../exceptions";

/**
 * Canlı akış ekranları (W9b): `live-flow` (olay süzgeci, neden-sonuç, Ne olmuyor, zaman çizgisi), `live-reset` ve `live-end`.
 * Ana `OYUN_EXCEPTIONS` listesine eklenmez; `canliAkis.spec.ts` yalnız bu listeyi kullanır (`live` ekranının "Geçmiş hafta" istisnası
 * burada uygulanmaz: zaman çizgisi W9b'de yapıldı ve satır beklenir; "Olay akışından bir olaya tıkla" satırı artık hiçbir listede
 * istisna değildir, panel bütün canlı görünümlerde vardır).
 *
 * Dolu hâl ekranları: `live-chain-full` (seçili olayın zinciri), `live-diag` (Ne olmuyor kartı); "Simülasyon hesaplanıyor" diyaloğunda
 * yalnız başlık satırı seçilir (prototipin gövdesi şart değişikliğinin metnidir, dal diyaloğunun metni farklıdır).
 */
export const LIVE_FLOW_EXCEPTIONS: readonly OyunException[] = [
  // Neden-sonuç zinciri, dolu hâl (`live-chain-full`): olay seçili, zincir adımları listelenir.
  {
    screen: "live-chain-full",
    kind: "omit",
    line: /^Hf \d+: /,
    reason: "Seçili olayın başlığı ve zincir adımları modelin olayıdır, copy anahtarlarıyla \"Hf N: ...\" yazılır; prototipteki örnek metinler (\"ilk N firma battı\", \"Zarar N hafta sürdü\" ...) bu koşuda çıkmaz.",
  },
  {
    screen: "live-chain-full",
    kind: "omit",
    line: /^(Zarar \d+ hafta sürdü|Kasa işletme sermayesinin altına indi|Kredi reddedildi: itibar düşük|Firma battı|Zarar eden yerleşik firma özelleştirildi)$/,
    reason: "Zincir adımları olayın verisidir (sunucunun `chain` alanı, copy anahtarları); prototipin örnek adımları bu koşuda çıkmaz. Adım sayısı (beş adım, dört ok) ve ok işaretleri yine beklenir.",
  },
  {
    screen: "live-chain-full",
    kind: "omit",
    line: /^Adıma tıkla: ilgili görünüm açılır\./,
    reason: "Bilinçli sapma: sözleşmede zincir adımının görünüm kimliği yok (`chain[].step` yalnız adım kimliğidir); adım tıklaması görünüm açmaz ve ipucu satırı yazılmaz, uydurma yönlendirme olmaz. Adım başına `view` alanı sözleşme maddesi olarak S tarafına izleme açıldı (sürüm eklenirse satır geri gelir).",
  },
  // Ne olmuyor, dolu hâl (`live-diag`).
  {
    screen: "live-diag",
    kind: "omit",
    line: /Neden: /,
    reason: "Tanı metni olguyu söyler, nedeni iddia etmez (S4 hükmü); prototipin \"Neden:\" açıklaması yazılmaz.",
  },
  {
    screen: "live-diag",
    kind: "omit",
    line: /^Bu bir dünya varsayımı: /,
    reason: "Davranış ekranına bağlantı sözleşmede yok; kart yalnız olguyu, \"N. haftadan beri\" bilgisini ve \"Bu kuralı değiştir\" düğmesini taşır.",
  },
  {
    screen: "live-flow",
    kind: "strip",
    line: "mavi çizgi = şart sürümü · nokta = olay",
    reason: "F2: grafik göstergesi renge dayanmaz; sürüm satırları metinli listedir (\"v1 · hafta 0–4\"). Başlık satırı yine beklenir.",
  },
  {
    screen: "live-flow",
    kind: "omit",
    line: "Henüz olay yok. Oynat'a bas.",
    reason: "Boş durum yalnız olay gelmeden önce görünür; koşu birkaç hafta oynatılmıştır ve olay çıkıp çıkmaması modele bağlıdır.",
  },
  {
    screen: "live-flow",
    kind: "omit",
    line: /^v\d+$/,
    reason: "Sürüm iğnesi etiketi; MVP'de sürümler \"v1 · hafta 0–4\" satırı olarak yazılır (aynı satır sürüm numarasını içerir).",
  },
  {
    screen: "live-reset",
    kind: "omit",
    line: "Koşu yok.",
    reason: "Prototipte koşusuz durumun metni; oyunda koşu vardır ve \"N haftalık koşu Koşular'a kaydedilecek.\" yazar (birim testi sınar).",
  },
  {
    screen: "live-end",
    kind: "strip",
    line: /^Koşu bitti: .*$/,
    reason: "Başlık \"200 hafta tamamlandı\" ve çöküş/toparlanma özeti ayrı bir bantta yazılır (prototipte tek satır); satırın tamamı atlanır.",
  },
];
