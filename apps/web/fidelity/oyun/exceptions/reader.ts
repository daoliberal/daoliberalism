import type { OyunException } from "../exceptions";

/** Şart okuyucusu (`live` + `readOpen`) istisnaları. */
export const READER_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "reader",
    kind: "omit",
    line: "Bu koşunun dünya senaryosu: Gerçekçi (Şart'a dahil değil)",
    reason: "W2 düzeltme: kayıt kaynağında dünya senaryosu kaydı yok, sayfa \"varsayılan\" yazar; sayfa sürümü birim testinde (sartOkuyucu.test.tsx) denetlenir.",
  },
  {
    screen: "reader",
    kind: "omit",
    line: "Zincir kayıtları",
    reason: "W2: zincir günlüğü sonraki görevdedir (Dilim 3); okuyucuda bu düğme yoktur.",
  },
];
