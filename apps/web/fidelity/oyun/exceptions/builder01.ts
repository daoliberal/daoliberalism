import type { OyunException } from "../exceptions";

const omit = (line: string | RegExp, reason: string): OyunException => ({ screen: "builder", kind: "omit", line, reason });

const PROFIL = "W7: şehir kaynakları ve uzman sektörler modelden gelir (SourceInfo.world); prototipin Kömür/Altın/Silika ve uzmanlaşma yolu metinleri örnek veridir. Etiketler (Kaynak, Uzmanlaşma, Nüfus payı, Kaynağı oyuncu seçemez) ve eşit nüfus payı sayfada gösterilir ve beklenir."; // yalnız değer satırları ayrılır
const SABLON = "W3: kayıtta ve modelde yalnız Dayanıklı taban ile Geçiş desteği şablonu var; öbür prototip şablonları kayda girene kadar bu satırlar beklenmez (R1b şablonlarıyla kalkar).";

/** Kurucu adım 0-1 (`builder`, bStep 0 ve 1) istisnaları (W3). Satır 1-11 (marka ve beş adımlı şerit) testte `only` ile dışarıda kalır; adım şeridi ayrı denetlenir. */
export const BUILDER01_EXCEPTIONS: readonly OyunException[] = [
  omit(/^Dünyana ve beş şehrine ad ver\. Kaynak profilleri sabittir/, `${PROFIL} Cümlenin ortası çıktığı için satır tümden ayrılır; oyundaki giriş metni (kurucu.adim0.giris) kurucuAdim01.spec.ts ile ayrıca denetlenir.`),
  omit(/^Ad öner$/, "W3: Her şehir için ad önerisi yerine tek \"Rastgele isim\" düğmesi var (sahip kararı: dünya ve beş şehir adı listeden birlikte gelir)."),
  omit(/^(Kömür|Altın|Silika \/ cam|Kömür ve enerji|tekstil|süt ve gıda|tekstil → moda → turizm|elektronik → yazılım|mücevher, mobilya, inşaat; turist çeker)$/, PROFIL),
  omit(/^Dünya sabitleri/, "Prototipte bu panel display:none ile gizli; oyunda da gösterilmez."),
  omit(/^5 şehir · hafta = 7 döngü/, "Prototipte gizli Dünya sabitleri panelinin metni."),
  omit(/^Şablon (?:–|[145])?\s*$/, SABLON),
  omit(/^Boş şart$/, SABLON),
  omit(/^Tüm ayarlar varsayılanda\. Üzerine kendin inşa et\.$/, SABLON),
  omit(/^Serbest piyasa, kurtarma yok$/, SABLON),
  omit(/^Deney kuralları kapalı\.$/, SABLON),
  omit(/^Ölçüm: çöküş ~50–60\. hafta/, SABLON),
  omit(/^Sektör panosu \+ destek$/, SABLON),
  omit(/^Dayanıklı taban \+ şehir sektör verisini yayımlar/, SABLON),
  omit(/^Ölçüm: çöküş medyanı 87,5/, SABLON),
  omit(/^Girişime açık \(deneysel\)$/, SABLON),
  omit(/^Dayanıklı taban \+ firma kurmak için itibar şartı kalkar/, SABLON),
  omit(/^Ölçüm: çöküş medyanı ~75/, SABLON),
  { screen: "builder", kind: "strip", line: /çöküş medyanı 73, en kötü 63; 6 denemenin hiçbiri ayakta değil/, reason: "E0: Dayanıklı taban ölçüm metni, kayıt canlıyla aynı modelden (v13.0) yeniden üretilince kayıttan hesaplanan sayılara ve ifadeye geçti (kayitMetin.test.ts metni kayda bağlar, bayatlarsa kırar). Prototipin satırı iki yönden ayrışır: sayılar v12.3'ten eskidir ve söz dizimi farklıdır; prototip \"6 denemenin hiçbiri ayakta değil\" ve \"en kötü\" der, sayfa \"Altı başlangıç dünyasında 200 hafta koşuldu\" diye başlar, \"dünya\" sözcüğünü kullanır ve \"en kötü\" ölçüsünü vermez. Ayrılan kesit tam bu cümledir; \"Ölçüm:\" etiketi sayfada yine beklenir." },
];
