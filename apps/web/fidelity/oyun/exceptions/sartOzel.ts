import type { OyunException } from "../exceptions";

/**
 * Kurucu adım 2 özel bölümleri (W5): prototip satırlarından, oyuncu dilinde ve modele göre yeniden yazılanlar. Her istisnanın gerekçesi vardır;
 * kayıt/ürün metni prototiple hizalanırsa ilgili satır buradan kalkar. Spec bu bölümlerin kendi metinlerini ayrıca denetler.
 */
export const SARTOZEL_EXCEPTIONS: readonly OyunException[] = [
  { screen: "builder", kind: "omit", line: /^Kural hesaplayıcısı: simülasyonu etkilemez$/, reason: "W5: başlık ve etiket ayrı öğeler (\"Faiz kuralı hesaplayıcısı\" + \"Simülasyonu etkilemez\"); spec ikisini ayrıca denetler." },
  { screen: "builder", kind: "omit", line: /^kural: [a-zçğıöşü ]+$/, reason: "W5: prototip seçili kuralın adını yankılar; burada kural durumu formül ya da \"Faiz kuralı kapalı\" metniyle anlatılır." },
  { screen: "builder", kind: "omit", line: /^Formül: /, reason: "W5: prototipin formül özeti yerine modelin kendi formülü (pol_step) yazılır: işsizlik, enflasyon, kredi/mevduat ya da boşta mevduat tepkisi ve kırpma." },
  { screen: "builder", kind: "strip", line: /Denenen enflasyon: %\d+\/yıl$/, reason: "W5: giriş etiketi ayrı bir alan etiketidir (\"Denenen enflasyon (yıllık)\"); cümlenin geri kalanı beklenir." },
  { screen: "builder", kind: "omit", line: /^Denenen işsizlik: %\d+$/, reason: "W5: etiket \"Denenen işsizlik (faiz kuralının baktığı ölçü)\": modelin faiz kuralı kendi işsizlik ölçüsüne bakar." },
  { screen: "builder", kind: "omit", line: /^Enflasyon %\d+, işsizlik %\d+ olsaydı politika faizi /, reason: "W5: sonuç \"hedef faiz\" diye adlandırılır (politika faizi adım sınırıyla ona yaklaşır); birim ve yıllık karşılık biçimlenmiş yazılır." },
  { screen: "builder", kind: "omit", line: /^Yatay: enflasyon /, reason: "W5: eksen açıklaması \"Yatay eksen: ...\" biçiminde, turuncu nokta yerine sonuç cümlesi var." },
  { screen: "builder", kind: "omit", line: /^Lonca havuzları şehir tahvili de alır; o bir kredi türü değil, kamu borcudur: Para ve basım › Şehir tahvili\.$/, reason: "W5: kayıttaki grup adı \"Para ve faiz\"; not aynı anlamda, kart adıyla yazıldı (\"Şehir tahvili kartı\")." },
  { screen: "builder", kind: "omit", line: /^Şehir bütçesi: gider öncelik sırası$/, reason: "W5: modelde sıra yok, üyelik listesi var; bölüm başlığı kartın adıdır (\"Basım izninden tam pay alan giderler\")." },
  { screen: "builder", kind: "strip", line: " (şehre giden)", reason: "W5: grup ve kart adı \"Dünyanın sabit kalemleri\"; \"şehre giden\" açıklaması salt okunur notta yazılır." },
  { screen: "builder", kind: "strip", line: /\s*Bu şablon \d+ dünya varsayımını da değiştirir: .*$/, reason: "W5 öncesi: varsayım cümlesi artık kayıttaki behavior_changes'tan türetilir; dayanıklı taban ve geçiş desteği şablonları dünya varsayımı değiştirmez (prototipin sabit cümlesi bu modelde yanlıştı)." },
];
