import type { OyunException } from "../exceptions";

/** Kurucu ekranı (`builder`) istisnaları; içerik W2 öncesiyle aynıdır. */
export const BUILDER_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "builder",
    kind: "strip",
    line: /Oynayan seri: (?:ayarlara göre seçilir|S\d+(?: · çöküş ~?\d+(?:\. hafta)?(?:, yumuşak)?| \(çöküş ~?\d+\. hf\))?\.?)/,
    reason: "Prototipin canlı model ölçüm sonu (hangi serinin oynadığı) kayıt oynatıcıda yok; tüm Oynayan seri parçası (cümle sonuna kadar) silinir, satırın geri kalanı beklenir.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: "Bir şablondan başla ya da boş şartla.",
    reason: "F1: MVP'de \"Boş şart\" şablonu yok (Dilim 2); kurucu yalnız kayıtlı iki şablonu sunar.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: "Şablonun değiştirdiği ayarlar Şartı yaz adımında işaretli görünür.",
    reason: "F1: Şartı yaz adımı (68 kuralın tamamı) Dilim 2; MVP'de şablonun değiştirdiği ayarlar işaretlenmez.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: "–Seçili",
    reason: "F1: Seçili göstergesi her şablon kartında Seçili etiketi ve aria-pressed ile verilir; başlık satırında ayrı bir parça yoktur.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: /^(?:Bu ne demek|Oyunda neyi değiştirir|İpucu): /,
    reason: "F1: SettingCard etiketi ayrı bir dt öğesidir (iki nokta üst üste olmadan); etiketler O2 testlerinde doğrulanır, satırın gövdesi beklenir.",
  },
  {
    screen: "builder",
    kind: "strip",
    line: / \(gerçekte: .*\)$/,
    reason: "F1: Gerçek dünya karşılığı (\"gerçekte: ...\") MVP kartında yok; kayıtla ilgisiz bir açıklamadır.",
  },
  {
    screen: "builder",
    kind: "omit",
    line: /6'nın 3'ü hiç çökmedi/,
    reason: "W1 dil kuralı: sayıya kesmeyle ek getirilmez (metin_kurallari.json sayi_sabit_ek); oyun \"6 dünyanın 3 tanesi hiç çökmedi, 5 tanesi ...\" yazar, prototip satırı bu kalıpla birebir eşleşemez. W2 bunu klasöre taşır.",
  },
  {
    screen: "builder",
    kind: "omit",
    line: /%20'de tek başına/,
    reason: "W1 dil kuralı: \"%20'de\" ve \"~%0,5'i\" sayıya kesmeyle ek alır; oyun \"%20 olduğunda ... yaklaşık %0,5 kadarı\" yazar. W2 bunu klasöre taşır.",
  },
];
