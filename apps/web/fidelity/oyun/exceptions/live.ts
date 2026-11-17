import type { OyunException } from "../exceptions";

/** Canlı Dünya ekranı (`live`) istisnaları; içerik W2 öncesiyle aynıdır. */
export const LIVE_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "live",
    kind: "strip",
    line: " geçiş 8 haftada yumuşak oynayacak",
    reason: "Kayıt oynatıcıda yumuşatma yok; kayıtlar önceden hesaplanmış olarak oynar.",
  },
  {
    screen: "live",
    kind: "strip",
    line: /, R$/,
    reason: "Klavye kısayolu R şart editörünü açar; editör MVP'de ayrı panelde ve kısayol sunulmaz.",
  },
  {
    screen: "live",
    kind: "strip",
    line: "mavi çizgi = şart sürümü · nokta = olay",
    reason: "F2: grafik göstergesi renge dayanmaz; iğne türleri metinli gösterge listesiyle (\"Hf N: kritik olay / şart sürümü / çöküş / toparlanma\") verilir.",
  },
  {
    screen: "live",
    kind: "omit",
    line: "Geçmiş hafta",
    reason: "F2: geçmiş haftaya dönme Dilim 3; MVP'de yalnız ilerleyen koşu ve grafik vardır.",
  },
  {
    screen: "live",
    kind: "strip",
    line: /(?<=hafta \d+)'de/,
    reason: "F3: \"hafta 5'de\" sayıya göre yanlış ek alır (5'te); MVP cümlesi eksiz \"hafta 5 duraklatıldı\" der. Yalnız bu cümlede ek silinir.",
  },
  {
    screen: "live",
    kind: "strip",
    line: /^(?:Bu ne demek|Oyunda neyi değiştirir|İpucu): /,
    reason: "F3: SettingCard etiketi ayrı bir dt öğesidir (iki nokta üst üste olmadan), F1 ile aynı; satırın gövdesi beklenir.",
  },
  {
    screen: "live",
    kind: "strip",
    line: / \(gerçekte: .*\)$/,
    reason: "F3: Gerçek dünya karşılığı (\"gerçekte: ...\") MVP kartında yok (F1 ile aynı).",
  },
  {
    screen: "live",
    kind: "omit",
    line: /6'nın 3'ü hiç çökmedi/,
    reason: "W1 dil kuralı: sayıya kesmeyle ek getirilmez (metin_kurallari.json sayi_sabit_ek); oyun \"6 dünyanın 3 tanesi hiç çökmedi, 5 tanesi ...\" yazar, prototip satırı bu kalıpla birebir eşleşemez. W2 bunu klasöre taşır.",
  },
  {
    screen: "live",
    kind: "omit",
    line: /%20'de tek başına/,
    reason: "W1 dil kuralı: \"%20'de\" ve \"~%0,5'i\" sayıya kesmeyle ek alır; oyun \"%20 olduğunda ... yaklaşık %0,5 kadarı\" yazar. W2 bunu klasöre taşır.",
  },
];
