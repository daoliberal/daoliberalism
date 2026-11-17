import { t, type CopyKey } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { num } from "@/oyun/lib/format";
import { SimUnsupported } from "./SimSource";

/** DAO oyununun süresi (hafta). */
export const DAO_SURE = 520;

/** `bilinmiyor`: bu istemcinin tanımadığı değer (sunucu yeni bir kod ekleyebilir); paket reddedilmez, genel metinle gösterilir. */
export type DaoDurum = "ahir" | "calisan" | "is_arayan" | "kurucu" | "bilinmiyor";
export type DaoUnvan = "cirak" | "kalfa" | "usta" | "girisimci" | "bilinmiyor";
export type DaoEksik = "issiz" | "calisma" | "harc" | "zaten_kurucu" | "erken" | "ahirda" | "bekleme" | "bilinmiyor";
/** Başvurunun sonuçlanmama nedenleri (modelin `basvuru_red.neden` kodları). Bilinmeyen kod genel metne düşer. */
export const BASVURU_RED_NEDENLERI = ["ilan_kapandi", "sehir", "zaten_calisiyor", "ayni_firma", "secilmedi"] as const;
/** İşletme batış nedenleri (modelin `firma_batti.neden` kodları; `diger` ve tanınmayan kod genel metne düşer). */
export const BATIS_NEDENLERI = ["ucret_odenmedi", "kredi_odenemedi", "sahip_ayrildi"] as const;
export type BasvuruRedNedeni = (typeof BASVURU_RED_NEDENLERI)[number];
/** F4: yaşam kaydının ölüm kodları (modelin `firm_log.NEDEN`; `gecmis.firmalar[*].neden_ayrinti`). Bilinmeyen kod "diğer" metnine düşer. */
export const OLUM_KODLARI = ["kredi_odenemedi", "ucret_odenemedi", "talep", "marj", "girdi", "teknoloji_geride", "zombi", "sahip_ayrildi", "odeme_gucu", "ozellestirme_alici_yok", "dao_bitti", "diger"] as const;
/** F4: ölümün yakın nedeni (kasa olayı; `yakin_neden`) ve kök nedeni (`kok_neden`: olum_neden) kodları; ikisi birlikte tek cümle kurar. */
export const YAKIN_NEDENLER = ["ucret_odenemedi", "kredi_odenemedi"] as const;
export const KOK_NEDENLER = ["marj", "talep", "girdi", "teknoloji_geride"] as const;
/** F4: canlı işletme uyarı kodları (`firmam.uyari`). */
export const UYARI_KODLARI = ["kasa_2_hafta_alti", "kasa_4_hafta_alti", "dort_hafta_zarar", "taksit_gecikti"] as const;

/** İstemsiz iş kaybının nedenleri (modelin `isten_cikarildi.neden` kodları; `diger` ve tanınmayan kod genel metne düşer). */
export const ISTEN_CIKARMA_NEDENLERI = ["ucret_odenmedi", "kucultme", "firma_kapandi"] as const;
export type IstenCikarmaNedeni = (typeof ISTEN_CIKARMA_NEDENLERI)[number];
/** İlanın işletme kasa gücü göstergesi (`bilinmiyor`: tanınmayan değer ya da eski sunucu). Zayıf işletmeler de gösterilir; risk görünür. */
export const KASA_GUCLERI = ["zayif", "orta", "guclu"] as const;
export type DaoKasaGucu = (typeof KASA_GUCLERI)[number] | "bilinmiyor";

/** Sunucunun bilinen kodları (`bilinmiyor` sunucudan gelmez). */
export const DAO_DURUMLAR: readonly DaoDurum[] = ["ahir", "calisan", "is_arayan", "kurucu"];
export const DAO_UNVANLAR: readonly DaoUnvan[] = ["cirak", "kalfa", "usta", "girisimci"];
export type DaoLoncam = { ad: string; sermaye: number; /** Kuruluşta ödediğim sermaye (kapanışta kayıp hesabının tabanı). */ odenen_sermaye?: number; uye_sayisi: number; kasa: number; durum: string };
export type DaoEksikAyrinti = { id: string; gerek?: number; var?: number; kalan?: number };
/** Lonca kuruluş yolları (modelin `lonca_kur.yol` kodları). */
export const DAO_LONCA_KUR_YOLLARI = ["girisimci", "medya", "yeniden"] as const;
export type DaoLoncaKurYol = (typeof DAO_LONCA_KUR_YOLLARI)[number];
export const DAO_EKSIKLER: readonly DaoEksik[] = ["issiz", "calisma", "harc", "zaten_kurucu", "erken", "ahirda", "bekleme"];

/** Son haftanın olayı: `tur` ve haftayla birlikte türüne özgü alanlar (modelin `human_ev` kaydı). */
export type DaoOlay =
  | { tur: "kuruldu"; hafta: number; firma: string; sektor: string }
  | { tur: "kurulamadi"; hafta: number; sektor: string; neden: "sart" | "kredi" | "bekleme" }
  | { tur: "ayrildi"; hafta: number }
  | { tur: "ise_girdi"; hafta: number; firma: string }
  /** `neden`: batış nedeni (`ucret_odenmedi`, `kredi_odenemedi`, `sahip_ayrildi`, `diger`; tanınmayan kod olabilir), `yas`: işletmenin ömrü (hafta). İkisi de eski sunucuda yoktur. */
  | { tur: "firma_batti"; hafta: number; firma: string; neden?: string | null; yas?: number | null }
  /** Çalışan insan başvurusu kabul edilince eski işten çıkış yeni işe girişle aynı adımda olur (arada işsiz sayılmaz). */
  | { tur: "is_degistirdi"; hafta: number; eski: string; yeni: string }
  /** `neden` modelin kodu (`ISTEN_CIKARMA_NEDENLERI`); bu istemcinin tanımadığı kod da gelebilir, nedensiz (eski sunucu) genel metne düşer. */
  | { tur: "isten_cikarildi"; hafta: number; firma: string; neden: string | null }
  | { tur: "goc_etti"; hafta: number; sehir: number }
  | { tur: "lonca_kapali"; hafta: number; lonca: string }
  | { tur: "mevduat_yatirilmadi"; hafta: number }
  | { tur: "cekildi"; hafta: number; miktar: number }
  | { tur: "cekilemedi"; hafta: number }
  | { tur: "sermaye_eklendi"; hafta: number; miktar: number; firma: string }
  | { tur: "sermaye_eklenemedi"; hafta: number; neden?: string }
  /** F2 (HUMAN_LONCA): firmanın loncası değişti / seçilen lonca kapanınca bot kuralıyla yeniden atandı. */
  | { tur: "lonca_degisti"; hafta: number; firma: string; eski: string; lonca: string; /** rekabet G1: "insan" (kendi seçimin), "otomatik" (bot kuralı taşıdı) ya da "kapanma" (loncan kapandı, bot kuralıyla taşındın); bilinmeyen değer "insan" gibi okunur. */ kaynak?: string }
  /** Son review Minor 1 (yalnız HUMAN_ON): işletmem beklenen satışa göre küçüldü, bir işçi çıkarıldı (`kisi` işçi kimliği; ekranda gösterilmez). */
  | { tur: "firmam_kuculdu"; hafta: number; firma: string; neden: string /** "satis" | "zarar" | "ucret"; bilinmeyen değer genel metne düşer */ }
  | { tur: "lonca_kapandi_yeniden_atandi"; hafta: number; firma: string; eski: string; lonca: string }
  /** F3 (HUMAN_LONCA): insanın lonca_kur kararının sonucu; `neden` lonca_kur_eksikleri kimlikleri. */
  | { tur: "lonca_kuruldu"; hafta: number; lonca: string }
  | { tur: "lonca_kurulamadi"; hafta: number; yol: string; neden: string[] }
  /** F3: insanın loncası kapandı; `kayip` = kuruluşta koyduğum sermayeden geri alamadığım tutar (Akçe; mevduat kayıp değil); `mevduat_tasindi` = o loncadaki mevduatımın taşındığı lonca ve tutar, `mevduat_odendi` = nakit ödenen kısmı. */
  | { tur: "loncam_kapandi"; hafta: number; lonca: string; neden: string; kayip: number; mevduat_tasindi?: { lonca: string; tutar: number } | null; mevduat_odendi?: number }
  | { tur: "kurabilir_oldu"; hafta: number }
  | { tur: "ahirdan_cikti"; hafta: number }
  | { tur: "basvuru_kabul"; hafta: number; firma: string }
  /** `neden` modelin kodu (`BASVURU_RED_NEDENLERI`); bu istemcinin tanımadığı kod da gelebilir. */
  | { tur: "basvuru_red"; hafta: number; firma: string; neden: string }
  /** Bu istemcinin tanımadığı olay türü: sessizce düşmez, genel metinle görünür (`kaynak` modelin olay türü, ekranda gösterilmez). */
  | { tur: "genel"; hafta: number; kaynak: string }
  /** Kabul edilen karar uygulama haftasında uygulanamadı (`karar`: ayril, goc, cek, kur, mevduat ...; `neden` modelin kodu, ekranda gösterilmez). */
  | { tur: "karar_uygulanamadi"; hafta: number; karar: string; neden: string | null };

/** Insanın şehrindeki bir iş ilanı: açık kadro ve bugün teklif edilen ücret (`ad` modelde ayrı ad yoksa kimliktir). */
export type DaoIlan = { firma: string; ad: string; sektor: string; acik: number; ucret: number; kasa_gucu: DaoKasaGucu; /** Son 4 haftada ücret ödeyemeyip çalışan kaybetti mi (salt okur gösterge). */ maas_odeyemedi: boolean };

export type DaoGozlem = {
  hafta: number;
  ben: {
    sehir: number;
    nakit: number;
    mevduat: { lonca: string | null; tutar: number };
    is: { firma: string | null; sektor: string | null; ucret: number };
    durum: DaoDurum;
    calisilan_hafta: number;
    /** Modelin terfi sayacı (skillw/7*(1+EDU_SPEED): özel işyerinde ödenen tecrübe haftası × (1 + eğitim hızı)); eski sunucuda yok. Varsa terfi ilerlemesi bunu kullanır. */
    tecrube_hafta?: number;
    /** Modelin terfi eşikleri; eski sunucuda yok (o zaman UNVAN_ESIKLERI). */
    terfi_esik?: { kalfa: { hafta: number; itibar: number }; usta: { hafta: number; itibar: number } };
    itibar: number;
    /** 1 (en alt) ... 5 */
    servet_dilimi: number;
    unvan: DaoUnvan;
    /** F3 (yalnız HUMAN_LONCA): sahibi olduğum lonca; yoksa null (eski sunucuda alan yok). durum: "acik" | "tehlikede" (gider/kasa sıkıntısı sayacı işliyor). */
    loncam?: DaoLoncam | null;
  };
  /** `lonca`, `lonca_degisebilir`: yalnız HUMAN_LONCA açıkken (eski sunucuda yok); bekleme süresi dolmuş ve başka açık lonca varsa değiştirilebilir. */
  firmam: null | { ad: string; sektor: string; nakit: number; isci: number; kar: number; yas: number; kasa_degisim?: number | null; kasa_hafta?: number | null; lonca?: string; lonca_degisebilir?: boolean; /** Son review I2: bot kuralıyla aynı kapı: ilk lonca geçişine kalan hafta (0: kapı açık; null: lonca payı kapalı, geçiş yok; eski sunucuda yok). */ lonca_erken_hafta?: number | null; /** F4: erken uyarı kodları (`UYARI_KODLARI`; tanınmayan kod genel metne düşer). Eski sunucuda yok. */ uyari?: string[]; /** F4: nakit pisti (hafta, bir ondalık): son 4 haftanın ortalama net çıkışıyla kasa kaç hafta dayanır; kasa erimiyorsa null. */ kasa_pisti_hafta?: number | null };
  kurabilir: { evet: boolean; eksikler: DaoEksik[]; harc: number; gereken_hafta: number; bekleyen?: string[] };
  /** F3 (yalnız HUMAN_LONCA açıkken; eski sunucuda yok): lonca kuruluş yolu -> eksik şart kimlikleri (boş = kurabilir). */
  lonca_kur?: Record<DaoLoncaKurYol, string[]>;
  /** F3: `lonca_kur` ile aynı sıra; nakit/itibar için gereken ve eldeki, kurucu yasağı için kalan hafta (yalnız HUMAN_LONCA). */
  lonca_kur_ayrinti?: Record<DaoLoncaKurYol, DaoEksikAyrinti[]>;
  sektorler: { sektor: string; urun: string; fiyat: number; firma: number; eksik: number; disaridan?: number | null; bekleme?: number; /** F4: türün şehirdeki toplam kasasının son 13 haftalık farkı (13 haftadan genç kayıtta ve eski sunucuda null/yok). */ kasa_egilim?: number | null; /** F4: 13 hafta önceki işletme sayısı. */ firma_sayisi_13hf?: number | null }[];
  /** `pay_orani` (lonca payı, fee), `kredi_verebilir`, `skor` (botun lonca seçim skoru, DÜŞÜK İYİ; işletmen yoksa ya da lonca kapalıysa null): yalnız HUMAN_LONCA açıkken. */
  loncalar: { ad: string; mevduat_faizi: number; kapali: boolean; mevduat: number; pay_orani?: number | null; kredi_verebilir?: boolean; skor?: number | null }[];
  sehir: { talep_karsilama: number | null; is_arayan: number };
  tercih: { mevduat: { lonca: string | null; oran: number } | null };
  gecmis: { dilim0: number; firmalar: { ad: string; sektor: string; yas: number; ayakta: boolean; /** Batış nedeni (ayaktaysa null; eski sunucuda yok). */ neden?: string | null; /** Öldüğü hafta (ayaktaysa null; eski sunucuda yok). */ olum_haftasi?: number | null; /** F4: yaşam kaydının ölüm kodu (`OLUM_KODLARI`; eski sunucuda yok: `neden`e düşülür). */ neden_ayrinti?: string | null; /** F4: ölümün yakın nedeni (kasa olayı: ucret_odenemedi, kredi_odenemedi, ...; yoksa null). */ yakin_neden?: string | null; /** F4: kök neden (marj, talep, girdi, teknoloji_geride; yoksa null). */ kok_neden?: string | null; /** F4: son 8 haftanın kasa farkı, cirosu ve ücreti (Akçe). */ son8_kasa_farki?: number; son8_ciro?: number; son8_ucret?: number }[] };
  /** Ücrete göre azalan, en çok 30; sunucu eskiyse boş. */
  ilanlar: DaoIlan[];
  olaylar: DaoOlay[];
};

/** Oyuncunun verebileceği kararlar (`POST /runs/{id}/dao/karar` gövdesi). */
export type DaoKarar =
  | { tur: "mevduat"; lonca: string | null; oran: number }
  | { tur: "cek"; miktar: number }
  /** İnsanın işletmesi için lonca seçimi (F2 HUMAN_LONCA); seçim korunur, bekleme süresi vardır. */
  | { tur: "lonca_sec"; lonca: string }
  /** İnsanın lonca kurması (F3 HUMAN_LONCA); şartlar gözlemdeki `lonca_kur` listesidir, kazanç hesabı oyuncunundur. */
  | { tur: "lonca_kur"; yol: DaoLoncaKurYol }
  /** Sahip (insan) nakdinden kendi işletmesine sermaye aktarımı (M14 OWNER_INJECT; transfer, para doğmaz). */
  | { tur: "sermaye_ekle"; miktar: number }
  | { tur: "ayril" }
  /** Yalnız ahırdayken geçerli; ahırdayken `ayril` ve `basvur` reddedilir. */
  | { tur: "ahirdan_cik" }
  | { tur: "basvur"; firma: string }
  | { tur: "goc"; sehir: number }
  | { tur: "kur"; sektor: string };

export type DaoKararSonucu = { kabul: true; hafta: number };

/** Olay metninde kullanılan adlandırıcılar (şehir numarası ve sektör türü ekran adına çevrilir). */
export type DaoAdlar = {
  sehir(i: number): string;
  sektor(tur: string): string;
  /** İşletme kimliği ekranda asla ham görünmez: sektör adı (ya da "Ahır"); okunur bir ad zaten ise o. */
  firma(kimlik: string, sektor?: string | null): string;
};

const UYGULANAMADI: Record<string, CopyKey> = {
  ayril: "dao.olay.uygulanamadi.ayril",
  ahirdan_cik: "dao.olay.uygulanamadi.ahirdan_cik",
  basvur: "dao.olay.uygulanamadi.basvur",
  goc: "dao.olay.uygulanamadi.goc",
  cek: "dao.olay.uygulanamadi.cek",
  lonca_sec: "dao.olay.uygulanamadi.lonca_sec",
  kur: "dao.olay.uygulanamadi.kur",
  mevduat: "dao.olay.uygulanamadi.mevduat",
};

/** Başvuru red nedeninin oyuncu metni; tanınmayan kod genel metne düşer. */
export function basvuruRedNedeni(neden: string): string {
  return t((BASVURU_RED_NEDENLERI as readonly string[]).includes(neden) ? `dao.olay.basvuru_red.${neden as BasvuruRedNedeni}` : "dao.olay.basvuru_red.genel");
}

/** İşten çıkarılma nedeninin oyuncu metni; nedensiz ya da tanınmayan kod genel metne düşer. */
export function istenCikarmaNedeni(neden: string | null): string {
  return t(neden !== null && (ISTEN_CIKARMA_NEDENLERI as readonly string[]).includes(neden) ? `dao.olay.isten_cikarildi.${neden as IstenCikarmaNedeni}` : "dao.olay.isten_cikarildi.genel");
}

/** Batış nedeninin oyuncu metni. Yeni kod (`ayrinti`, F4) varsa o okunur (tanınmayan kod "diğer"); yoksa eski üç kodlu `neden`e düşülür (kayıtlı oyunlar); nedensiz, `diger` ve tanınmayan kod genel metne düşer. */
export function batisNedeni(neden: string | null | undefined, ayrinti?: string | null): string {
  if (ayrinti != null) return t((OLUM_KODLARI as readonly string[]).includes(ayrinti) ? `dao.batis.${ayrinti as (typeof OLUM_KODLARI)[number]}` : "dao.batis.diger");
  return t(neden != null && (BATIS_NEDENLERI as readonly string[]).includes(neden) ? `dao.batis.${neden as (typeof BATIS_NEDENLERI)[number]}` : "dao.batis.genel");
}

/** Batış kaydı (`gecmis.firmalar` öğesinin neden alanları). */
export type BatisKaydi = { neden?: string | null; neden_ayrinti?: string | null; yakin_neden?: string | null; kok_neden?: string | null };

/**
 * Tek batış cümlesi (kart, bant ve olay şeridi aynı cümleyi gösterir). Yakın neden (ücret/kredi) ve kök neden birlikte biliniyorsa ikisi söylenir
 * ("Maaşlar ödenemedi; asıl neden: satışlar giderleri karşılamadı."); yoksa `batisNedeni` (yeni tek kod, sonra eski üç kod, sonra genel).
 */
export function batisMetni(k: BatisKaydi): string {
  const y = k.yakin_neden, o = k.kok_neden;
  if (y != null && o != null && (YAKIN_NEDENLER as readonly string[]).includes(y) && (KOK_NEDENLER as readonly string[]).includes(o)) {
    return t("dao.batis.birlesik", { yakin: t(`dao.batis.yakin.${y as (typeof YAKIN_NEDENLER)[number]}`), kok: t(`dao.batis.kok.${o as (typeof KOK_NEDENLER)[number]}`) });
  }
  return batisNedeni(k.neden, k.neden_ayrinti);
}

/** F4: uyarı rozetinin metni; tanınmayan kod genel uyarıya düşer. `kasa_4_hafta_alti` için nakit pisti (hafta) biliniyorsa "yaklaşık N hafta dayanır" der. */
export function uyariMetni(kod: string, pistHafta?: number | null): string {
  if (kod === "kasa_4_hafta_alti" && pistHafta != null) return t("dao.uyari.kasa_4_hafta_alti_n", { n: pistHafta.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) });
  return t((UYARI_KODLARI as readonly string[]).includes(kod) ? `dao.uyari.${kod as (typeof UYARI_KODLARI)[number]}` : "dao.uyari.genel");
}

/** F4: sektör kasa eğilimi ("+1.200 Akçe" / "−300 Akçe"); yoksa null. */
export function kasaEgilimMetni(x: number | null | undefined): string | null {
  if (x == null) return null;
  const r = Math.round(x);
  return t("dao.piyasa.egilim_deger", { n: `${r > 0 ? "+" : r < 0 ? "−" : ""}${num(Math.abs(r))}` });
}

/** "İşletmen battı: Fırın. Maaşlar ödenemedi. 12 hafta yaşadı." Yaş yoksa (eski sunucu) o parça düşer. */
export function firmaBatisMetni(firma: string, neden: string | null | undefined, yas: number | null | undefined, kayit?: BatisKaydi): string {
  const bas = t("dao.olay.firma_batti", { firma, neden: kayit && (kayit.neden_ayrinti != null || kayit.yakin_neden != null) ? batisMetni({ neden, ...kayit }) : batisNedeni(neden) });      // yeni kod yoksa olayın kendi nedeni (eski sunucu)
  return typeof yas === "number" ? `${bas} ${t("dao.batis.yas", { n: yas })}` : bas;
}

/** Unvan terfisinin şartları (kontenjan yok: yalnız kişinin kendi birikimi). Model: `KALFA_WEEKS, USTA_WEEKS` (params.py/model.py, ödenen tecrübe haftası) ve `REP_KALFA, REP_USTA` (itibar). */
export const UNVAN_ESIKLERI = {
  kalfa: { hafta: 40 /* KALFA_WEEKS */, itibar: 4 /* REP_KALFA */ },
  usta: { hafta: 150 /* USTA_WEEKS */, itibar: 12 /* REP_USTA */ },
} as const;
const SONRAKI_UNVAN: Partial<Record<DaoUnvan, keyof typeof UNVAN_ESIKLERI>> = { cirak: "kalfa", kalfa: "usta" };

export type TerfiIlerlemesi = { hedef: keyof typeof UNVAN_ESIKLERI; /** `tecrube_hafta` yoksa `calisilan_hafta` kullanıldı: değer yaklaşıktır. */ yaklasik: boolean; hafta: number; gerekenHafta: number; itibar: number; gerekenItibar: number; tamam: boolean };

/**
 * Mevcut unvandan bir sonrakine ilerleme (usta, girişimci ve tanınmayan unvanda null). Tecrübe: gözlemin `tecrube_hafta` alanı (modelin terfi sayacının kendisi).
 * Alan yoksa (eski sunucu) `calisilan_hafta` kullanılır: o, modelin sayacından (`skillw`) farklıdır (ahır, belediye, Ar-Ge'yi sayar, eğitim hızını katmaz), yani yaklaşıktır;
 * bu durumda `yaklasik` true olur ve "şartları sağladın" sonucu verilmez (`tamam` false).
 */
export function terfiIlerlemesi(b: Pick<DaoGozlem["ben"], "unvan" | "calisilan_hafta" | "tecrube_hafta" | "terfi_esik" | "itibar">): TerfiIlerlemesi | null {
  const hedef = SONRAKI_UNVAN[b.unvan];
  if (hedef === undefined) return null;
  const e = b.terfi_esik?.[hedef] ?? UNVAN_ESIKLERI[hedef];   // modelin eşikleri gelirse onlar; eski sunucuda yerel kopya
  const yaklasik = b.tecrube_hafta === undefined;
  const hafta = b.tecrube_hafta ?? b.calisilan_hafta;
  return { hedef, yaklasik, hafta, gerekenHafta: e.hafta, itibar: b.itibar, gerekenItibar: e.itibar, tamam: !yaklasik && hafta >= e.hafta && b.itibar >= e.itibar };
}

/** Belediyenin işletme kimliği: şehir binası (`city` ref'i şehir numarasıdır); belediyede çalışan insanın `ben.is.firma` değeri budur. */
export const belediyeKimligi = (sehir: number): string => `s${sehir}_belediye0`;

/** Modelde (SKILL_ALL_WORK=0) bu işlerde çalışılan haftalar terfi tecrübesine sayılmaz: yalnız özel işletmelerdeki ödenen haftalar sayılır. */
export const TECRUBE_SAYMAYAN_SEKTORLER: readonly string[] = ["ahir", "belediye", "arge"];
export const tecrubeSaymaz = (sektor: string | null): boolean => sektor !== null && TECRUBE_SAYMAYAN_SEKTORLER.includes(sektor);

export const kasaGucuMetni = (k: DaoKasaGucu): string => t(`dao.kasa_gucu.${k}`);

export function daoOlayMetni(o: DaoOlay, ad: DaoAdlar, gecmis?: readonly (BatisKaydi & { ad: string })[]): string {
  switch (o.tur) {
    case "kuruldu": return t("dao.olay.kuruldu", { firma: ad.firma(o.firma, o.sektor) });
    case "kurulamadi": return t(o.neden === "kredi" ? "dao.olay.kurulamadi.kredi" : o.neden === "bekleme" ? "dao.olay.kurulamadi.bekleme" : "dao.olay.kurulamadi.sart");
    case "ayrildi": return t("dao.olay.ayrildi");
    case "ise_girdi": return t("dao.olay.ise_girdi", { firma: ad.firma(o.firma) });
    case "isten_cikarildi": {
      const firma = ad.firma(o.firma);
      // Ahırdaki ilk iş bırakımı ceza değil, olağan ayrılıştır.
      return firma === ad.sektor("ahir") ? t("dao.olay.ahirdan_ayrildi") : t("dao.olay.isten_cikarildi", { firma, neden: istenCikarmaNedeni(o.neden) });
    }
    case "firma_batti": return firmaBatisMetni(ad.firma(o.firma), o.neden, o.yas, gecmis?.find((f) => f.ad === o.firma));      // F4: gecmis'teki yeni kodlar varsa kartla aynı cümle
    case "is_degistirdi": return t("dao.olay.is_degistirdi", { eski: ad.firma(o.eski), yeni: ad.firma(o.yeni) });
    case "goc_etti": return t("dao.olay.goc_etti", { sehir: ad.sehir(o.sehir) });
    case "lonca_kapali": return t("dao.olay.lonca_kapali");
    case "mevduat_yatirilmadi": return t("dao.olay.mevduat_yatirilmadi");
    case "cekildi": return t("dao.olay.cekildi", { miktar: num(o.miktar) });
    case "cekilemedi": return t("dao.olay.cekilemedi");
    case "sermaye_eklendi": return t("dao.olay.sermaye_eklendi", { miktar: num(o.miktar), firma: ad.firma(o.firma) });
    case "sermaye_eklenemedi": return t(o.neden === "isletme_yok" ? "dao.olay.sermaye_isletme_yok" : "dao.olay.sermaye_eklenemedi");
    case "lonca_kuruldu": return t("dao.olay.lonca_kuruldu", { lonca: loncaMetni(o.lonca) });
    case "lonca_kurulamadi": return t("dao.olay.lonca_kurulamadi", { neden: o.neden.map((x) => loncaKurEksikMetni(x)).join(" ") });
    case "loncam_kapandi": return t("dao.olay.loncam_kapandi", { lonca: loncaMetni(o.lonca), mevduat: loncamMevduatMetni(o), neden: t(o.neden === "batik" || o.neden === "gider" || o.neden === "uyesiz" ? `dao.olay.loncam_kapandi.${o.neden}` : "dao.olay.loncam_kapandi.diger"), kayip: num(o.kayip) });
    case "firmam_kuculdu": return t(o.neden === "satis" ? "dao.olay.firmam_kuculdu.satis" : o.neden === "zarar" ? "dao.olay.firmam_kuculdu.zarar" : o.neden === "ucret" ? "dao.olay.firmam_kuculdu.ucret" : "dao.olay.firmam_kuculdu", { firma: ad.firma(o.firma) });
    case "lonca_degisti": return o.kaynak === "kapanma" ? t("dao.olay.lonca_degisti.kapanma", { firma: ad.firma(o.firma), eski: loncaMetni(o.eski), lonca: loncaMetni(o.lonca) }) : o.kaynak === "otomatik" ? t("dao.olay.lonca_degisti.otomatik", { firma: ad.firma(o.firma), eski: loncaMetni(o.eski), lonca: loncaMetni(o.lonca) }) : t("dao.olay.lonca_degisti", { firma: ad.firma(o.firma), lonca: loncaMetni(o.lonca) });
    case "lonca_kapandi_yeniden_atandi": return t("dao.olay.lonca_kapandi_yeniden_atandi", { eski: loncaMetni(o.eski), lonca: loncaMetni(o.lonca) });
    case "kurabilir_oldu": return t("dao.olay.kurabilir_oldu");
    case "ahirdan_cikti": return t("dao.olay.ahirdan_cikti");
    case "basvuru_kabul": return t("dao.olay.basvuru_kabul", { firma: ad.firma(o.firma) });
    case "basvuru_red": return t("dao.olay.basvuru_red", { firma: ad.firma(o.firma), neden: basvuruRedNedeni(o.neden) });
    case "genel": return t("dao.olay.genel");
    case "karar_uygulanamadi": return t(Object.prototype.hasOwnProperty.call(UYGULANAMADI, o.karar) ? UYGULANAMADI[o.karar]! : "dao.olay.uygulanamadi.genel");
  }
}

function loncamMevduatMetni(o: Extract<DaoOlay, { tur: "loncam_kapandi" }>): string {
  const tasindi = o.mevduat_tasindi ? ` ${t("dao.olay.loncam_kapandi.mevduat_tasindi", { tutar: num(o.mevduat_tasindi.tutar), lonca: loncaMetni(o.mevduat_tasindi.lonca) })}` : "";
  const odendi = o.mevduat_odendi !== undefined && o.mevduat_odendi > 0 ? ` ${t("dao.olay.loncam_kapandi.mevduat_odendi", { tutar: num(o.mevduat_odendi) })}` : "";
  return tasindi + odendi;
}

/** Lonca kuruluş eksik kimliğinin metni; tanınmayan kimlik genel metne düşer. */
export function loncaKurEksikMetni(id: string, ayr?: DaoEksikAyrinti): string {
  const key = `dao.lonca_kur.eksik.${id}`;
  const metin = t(key in tr ? (key as CopyKey) : "dao.lonca_kur.eksik.bilinmiyor");
  if (ayr?.gerek !== undefined && ayr.var !== undefined) return t("dao.lonca_kur.eksik_sayi", { metin, gerek: num(ayr.gerek), var: num(ayr.var) });
  if (ayr?.kalan !== undefined) return t("dao.lonca_kur.eksik_kalan", { metin, kalan: num(Math.max(0, Math.ceil(ayr.kalan))) });
  return metin;
}

/** `lonca3` -> ekran adı ("Lonca 4"); tanınmayan biçim olduğu gibi. */
function loncaMetni(ref: string): string {
  const m = /^lonca(\d+)$/.exec(ref);
  return m ? t("canli.sahiplik.lonca.ad", { n: Number(m[1]) + 1 }) : ref;
}

export const daoDurumMetni = (d: DaoDurum): string => t(`dao.durum.${d}`);
export const daoUnvanMetni = (u: DaoUnvan): string => t(`dao.unvan.${u}`);

export function daoEksikMetni(e: DaoEksik, k: { harc: number; gereken_hafta: number }): string {
  switch (e) {
    case "issiz": return t("dao.eksik.issiz");
    case "calisma": return t("dao.eksik.calisma", { gereken_hafta: k.gereken_hafta });
    case "harc": return t("dao.eksik.harc", { harc: num(k.harc) });
    case "zaten_kurucu": return t("dao.eksik.zaten_kurucu");
    case "erken": return t("dao.eksik.erken");
    case "ahirda": return t("dao.eksik.ahirda");
    case "bekleme": return t("dao.eksik.bekleme");
    case "bilinmiyor": return t("dao.eksik.bilinmiyor");
  }
}

const HATALAR: Record<string, CopyKey> = {
  ayni_hafta: "dao.hata.ayni_hafta",
  once_cek: "dao.hata.once_cek",
  kurucuyken_goc: "dao.hata.kurucuyken_goc",
  kosu_bitti: "dao.hata.kosu_bitti",
  karar_gecersiz: "dao.hata.karar_gecersiz",
  karar_belirsiz: "dao.hata.karar_belirsiz",
};

/** Reddedilen kararın alan nedeni (`karar_gecersiz` 422 gövdesinin `fields` öğesi) -> metin anahtarı. Nedensiz (`invalid`) alan yalnız `firma` için anlamlıdır. */
const NEDENLER: Record<string, CopyKey> = {
  ahirda: "dao.hata.neden.ahirda",
  ahirda_degil: "dao.hata.neden.ahirda_degil",
  isletme_sahibi: "dao.hata.neden.isletme_sahibi",
  geri_alinmaz: "dao.hata.neden.geri_alinmaz",
  kurucu_degil: "dao.hata.neden.kurucu_degil",
  lonca_kapali: "dao.hata.neden.lonca_kapali",
  ayni_lonca: "dao.hata.neden.ayni_lonca",
  bekleme: "dao.hata.neden.bekleme",
  erken: "dao.hata.neden.erken",
};

function nedenAnahtari(f: { id: string; reason: string }): CopyKey | null {
  if (Object.prototype.hasOwnProperty.call(NEDENLER, f.reason)) return NEDENLER[f.reason]!;
  return f.id === "firma" ? "dao.hata.neden.firma" : null;
}

/** Kalıcı hata kodları: yeniden denemek işe yaramaz (geçici olanlar `hata.*` ağ/5xx anahtarlarıdır). */
export const daoGeciciMi = (e: unknown): boolean => e instanceof SimUnsupported && (e.message === "hata.sunucu_yok" || e.message === "hata.sunucu_bozuk");

/** Kontrol (hafta ilerlet, duraklat) hatasının metin anahtarı. */
export function daoKontrolHataAnahtari(e: unknown): CopyKey {
  return daoGeciciMi(e) ? (e as SimUnsupported).message as CopyKey : "dao.hata.kontrol";
}

/** Karar hatasının metin anahtarı: sunucu kodları Türkçe karşılığına, ağ hataları `hata.*` anahtarına, gerisi genel metne döner. */
export function daoHataAnahtari(e: unknown): CopyKey {
  if (e instanceof SimUnsupported) {
    if (e.message === "karar_gecersiz") {
      for (const f of e.alanlar) {
        const k = nedenAnahtari(f);
        if (k) return k;
      }
    }
    const k = HATALAR[e.message];
    if (k) return k;
    if (e.message === "hata.sunucu_yok" || e.message === "hata.sunucu_bozuk") return e.message;
  }
  return "dao.hata.genel";
}
