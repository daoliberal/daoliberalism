import type { OyunException } from "../exceptions";

/**
 * "Şartı değiştir" editör kaplaması (W8): prototipin `editorOpen` ekranı (`screen: "live"`) tek bir sayfa metnidir; satır 3-97 editör
 * panelini, 98 sonrası Canlı Dünya'nın öbür bölümlerini (F2 spec'i) kapsar. Panel bu oyunda Şart editörünün canlı kipidir (aynı bileşen),
 * kartlar kayıttan gelir; prototipin elle yazılmış kartları ve özet/dal alanları aşağıdaki nedenlerle satır satır beklenmez.
 */
const OZET = "W8: prototipin sağ yan özeti ('Başlangıç Şart v1' vb.) hesaplı özetin yerini 'Bu şartta değişenler' şeridi ve Canlı özet bölümü (sart.ozet.*) alır; Kurucu özet adımı (builder) bunu ayrıca denetler.";
const SEKME = "W8: sekme etiketi ile alt metni ayrı öğelerdir (prototip bitişik yazar); sekmeler Şart editörünün kendi spec'inde denetlenir.";

export const EDITOR_EXCEPTIONS: readonly OyunException[] = [
  { screen: "live", kind: "omit", line: /^[ABC]\. [A-ZÇĞİÖŞÜa-zçğıöşü ]+(?=Senin|Simüle|Kendiliğinden)/, reason: SEKME },
  { screen: "live", kind: "omit", line: /^Bu haftadan dallan ve senaryoyu değiştir$/, reason: "W8: koşu ortasında dünya senaryosu değişmez; Dünyanın insanları sekmesi bunu 'insanlar.kilit_kosu' ile söyler." },
  { screen: "live", kind: "omit", line: /^(6\. Kurtarma ve destek|9\. Düzenleme|10\. Buluş ve patent)$/, reason: "W8: grup adları kayıttan: '7. Kurtarma ve geçiş', '10. Fiyat ve düzenleme', '13. İnovasyon ve sektörler'." },
  { screen: "live", kind: "omit", line: /^(Başlangıç|Basım tavanı|Faiz|Satış vergisi|Kurtarma|Geçiş desteği|Firma kurmak için|Sektör verisi|Dünya senaryosu|Satış vergisi · stopaj|Firma kurmak için itibar şartı|Sektör verisi yayımı)(?=Şart v|%|politika|\d|yok|kapalı|var|Gerçekçi)/, reason: OZET },
  { screen: "live", kind: "omit", line: /^(Ölçüm \(6 koşu\)|Oyun sunucusu$|Oyun sunucusunda çalışır|Oyunda: Açık: talep karşılama)/, reason: OZET },
];
