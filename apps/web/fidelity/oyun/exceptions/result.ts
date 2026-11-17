import type { OyunException } from "../exceptions";

/** Sonuç ekranı (`result`): prototipin satırlarından oyunun göstermediği ya da dil kuralıyla yeniden yazdığı kısımlar. */
export const RESULT_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "result", kind: "omit", line: /^Hafta \d+ itibarıyla talep karşılama .*, kümülatif \d+ batış, kasa /,
    reason: "Prototip 'kümülatif N batış' der; ölçüm sonradan düzeltildi (PLAN-KREDI T3: failed_cum yalnız YERLEŞİK işletme batışını sayar, oyuncu işletmeleri ayrı sayaçlardır), sayfa 'kümülatif N yerleşik işletme batışı' yazar (copy sonuc.ozet). Doğru taraf sayfadır; satırın kendisi sonuc.spec.ts'te açıkça sınanır.",
  },
  {
    screen: "result", kind: "omit", line: /^Örnek veri: gerçek koşulardan/,
    reason: "Prototipin örnek-veri uyarısı; oyunda veri gerçek koşudan gelir (aynı satır start/live ekranlarında da istisnadır).",
  },
  {
    screen: "result", kind: "strip", line: /Dünya: .*$/,
    reason: "Dünya senaryosunun adı kayıttan gelir (prototipte 'Gerçekçi' sabit örnek); satırın geri kalanı beklenir.",
  },
  {
    screen: "result", kind: "strip", line: /(\(seçilmedi\) )?(henüz belli değil|tutturuldu|tutturulamadı)$/,
    reason: "Prototipte hedef ölçüsü ile durum iki bitişik span'dir (boşluksuz birleşir); oyunda ayrı öğelerdir. Durum metinleri birim testinde (sonuc.test.tsx goal_statuses...) denetlenir, ölçü kısmı burada.",
  },
  {
    screen: "result", kind: "strip", line: /en düşük [\d.]+ bin\s*/,
    reason: "Kasa hedefinin ölçüsü modelin kasa tabanıdır (haftalık gidere göre: 'en düşük 2,3 haftalık gider'); prototipin 'en düşük 24 bin' parasal örneği uydurma bir eşiğe dayanıyordu (W10 düzeltme 1, I2).",
  },
  {
    screen: "result", kind: "strip", line: " tohumda koş",
    reason: "Dil kuralı: sayfada 'tohum' sözcüğü geçmez (başlangıç dünyası denir); oyun 'Aynı şartı 6 dünyada koş' yazar.",
  },
  {
    screen: "result", kind: "omit", line: /^6 tohumdan/,
    reason: "Dil kuralı ('tohum', sayıya kesmeyle ek: 0'i, 26'e) ve içerik: özet ve açıklama iş bitince görünür ('6 dünyanın 3 tanesi ... çöktü'); çöküş eşiği çizgisi yoktur, not metni yeniden yazıldı. Sayfa sürümü birim testinde.",
  },
];
