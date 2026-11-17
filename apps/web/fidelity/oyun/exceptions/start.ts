import type { OyunException } from "../exceptions";

/** Başlangıç ekranı (`start`) istisnaları. */
export const START_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "start",
    kind: "omit",
    line: /^[1-4](?:Kural yaz|Haftaları izle|Teşhisi oku|Kuralı değiştir)/,
    reason: "W2: prototipte adım numarası, başlık ve açıklama boşluksuz birleşik tek satırdır (\"1Kural yazPara, ...\"); sayfada üç ayrı öğedir ve satır boşlukla okunur. Dört adımın metni birim testinde (baslangic.test.tsx) tek tek denetlenir.",
  },
];
