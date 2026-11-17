import type { CopyKey } from "@/oyun/copy/t";
import type { HaritaFarki, HaritaVerisi } from "@/oyun/harita/tipler";
import type { DaoGozlem, DaoKarar, DaoKararSonucu } from "./dao";

// Veri sözleşmesi (MVP kümesi). Tel biçimi snake_case; arayüz durum türleri camelCase.
// Oranlar ondalıktır; biçimlendirme istemcidedir. Kayıt sütunları başlık adıyla okunur.

export type Speed = 1 | 4 | 16;
export type RunStatus = "ready" | "running" | "paused" | "ended" | "failed";
/** Ayar değeri: skaler, dize listesi (`order`/`multi`) ya da düz nesne (`fields`). */
export type UIValue = number | string | boolean | string[] | Record<string, number | string | boolean>;
export type ValuesPatch = Record<string, UIValue>;

export type RunState = {
  runId: string;
  status: RunStatus;
  week: number;
  durationWeeks: number;
  speed: Speed;
  computing: boolean;
  version: number;
  seedIndex: number;
  values: ValuesPatch;
  scenarioId: string;
  /** Dünya adı ve 5 şehir adı (Kurucu'da girilen); ham, gösterimde `cityDisplayName` ile. */
  name: string;
  cityNames: string[];
  endedReason?: "duration";
  error?: { messageKey: CopyKey; week: number };
  /** Canlı model: ekran, yayımlanacak hafta hazır olmadığı için bekliyor. Kayıt oynatıcı hiç doldurmaz. */
  buffering?: boolean;
  /** Canlı model: ölçülen model hızı (hafta/sn); "model hızı sınırı" notu için. Kayıt oynatıcı hiç doldurmaz. */
  modelWeeksPerSec?: number;
  /** Koşu arka planda hazırlanıyor (dallanma, ileri sarma). */
  preparing?: { done: number; total: number };
  /** Dünya senaryosu kimliği; `scenarioId` (kayıt kümesi / canlı kimliği) ile karıştırılmaz. */
  worldScenarioId?: string;
  /** Kullanıcının dünya değerleri (özel dünya senaryosu); `values`'a karışmaz. Eski sunucuda yoktur. */
  worldScenarioValues?: ValuesPatch;
  goals?: GoalId[];
  parentRunId?: string;
  forkWeek?: number;
  /** Her sürümün `values` alanı TAM değer kümesidir (yama değil): okuyucu eksik anahtarı varsayılanla doldurur, farkı kümeler arasında alır. */
  versions?: { version: number; fromWeek: number; values: ValuesPatch; note?: string }[];
  /** Bu koşuda koşu ortasında değiştirilemeyen kartlar ve nedeni (koşunun kuruluş bağlamından; sunucu bildirir). `no_cash_floor`: geçiş desteği, kuruluş fonu ve şehir kasası kuralı kapalı başladı. */
  settingLocks?: { id: string; reason: "no_cash_floor" }[];
  /** DAO oyunu koşusu (tek oyunculu); Kurucu koşusunda alan yoktur. */
  mode?: "dao";
  /** Paylaşılan dünya kodu (DAO; yayımlanmış dünyadan kurulan koşuda). */
  dunyaKodu?: string;
  /** DAO: hafta 0 harita anlık görüntüsü (sunucu ready olunca verir); ilk hafta paketi gelince `weeks` içindeki harita geçer. */
  harita0?: HaritaVerisi;
  /** DAO: hafta 0 gözlemi (sunucu ready olunca verir); ilk hafta paketi gelmeden üst metrikler bununla dolar. */
  dao0?: DaoGozlem;
};

export type GoalId = "alive" | "serve" | "kasa" | "gini";

export type RunConfig = {
  name: string;
  cityNames: string[];
  templateId: string;
  durationWeeks: number;
  seedIndex: number;
  values: ValuesPatch;
  worldScenarioId?: string;
  worldScenarioValues?: ValuesPatch;
  goals?: GoalId[];
  schedule?: { week: number; patch: ValuesPatch }[];
  fastForwardTo?: number;
  /** "dao": tek oyunculu DAO oyunu (yoksa Kurucu koşusu). */
  mode?: "dao";
};

export type RunHandle = { runId: string; state: RunState };

/** Açılış kapasite hesabı (D7 `POST /api/world/plan`, model koşusu yok): bir tür için işletme sayısı, kapasite ve ilk hafta kadro hedefi. */
export type WorldPlanKind = {
  kind: string; label: string; group: "hammadde" | "imalat" | "hizmet" | "lojistik";
  firms: number; capacity: number; maxPeople: number; target: number; planned: number; blocked: boolean; shortfall: number; growthCeiling: number;
};
export type WorldPlan = {
  population: { playersPerCity: number; cities: number; players: number; npc: number; total: number };
  firms: { total: number; perCity: number[]; per1000: number };
  openingStaff: { total: number; perCity: number[]; npcRate: number };
  kinds: WorldPlanKind[];
  blockedKinds: string[];
  housing: { stock: number[]; total: number; tenants: number[] } | null;
  scale: { employment: number; population: number };
  capMode: "sabit" | "otomatik" | "elle";
  capGrowth: "sabit_taban" | "acilis_kapasitesi" | "yok";
  /** İşgücü (D9, A2): oyuncu + işgücündeki NPC. `tek_kisi`: her NPC işgücünde; `hane`: bir kısmı işgücü dışı (bakmakla yükümlü). Eski sunucuda alan yok. */
  laborForce?: { mode: "tek_kisi" | "hane"; players: number; npc: number; dependents: number; participation: number; total: number };
};

export type World = {
  served: number | null;
  unemployed: number | null;
  employed: number | null;
  npc_firms: number | null;
  player_firms: number | null;
  failed_cum: number | null;
  city_cash_total: number | null;
  city_cash_weeks: number | null;
  gini: number | null;
  price_index: number | null;
  inflation_yoy: number | null;
  unemployment_rate: number | null;
  /** Politika faizi, haftalık birim (kesir); faiz kuralı kapalıysa `null`. */
  policy_rate: number | null;
  minted_year: number | null;
  mint_cap: number | null;
  loans_applied: number | null;
  loans_rejected: number | null;
  loans_granted: number | null;
  loan_rate_avg: number | null;
  support_weekly: number | null;
  survival_52: number | null;
  wage_index: number | null;
  rent_pct: number | null;
  occupancy: number | null;
  house_index: number | null;
  deposit_rate: number | null;
  bond_rate: number | null;
  lonca_fee_avg: number | null;
  royalty_avg: number | null;
  money_total: number | null;
  velocity: number | null;
  privatized_firms: number | null;
  no_founder: number | null;
  reject_pool: number | null;
  reject_reputation: number | null;
  no_buyer_cum: number | null;
  /** Haftada istenip verilemeyen geçiş desteği (Akçe); açılış döneminde 0. */
  support_denied: number | null;
  /** Faiz kuralının o hafta gördüğü işsizlik (iş arayanlar / oyuncular); kural kapalıysa `null`. */
  policy_unemployment: number | null;
  /** Haftada basım izni ve tahvil yetmediği için kısılan şehir harcaması (Akçe). */
  city_spend_cut: number | null;
  /** Konut başına kiracı (ortalama); konut kapalıysa `null`. */
  tenants_per_house: number | null;
  /** Konutun ikinci el değeri / yeni yapım maliyeti oranı; konut kapalıysa `null`. */
  house_resale_ratio: number | null;
  /** Faiz kuralının o hafta gördüğü yıllık enflasyon (kural kapalıysa `null`); açılış döneminde de gösterilebilir. */
  policy_inflation: number | null;
  /** Başlangıçtan bu yana basılan toplam para (Akçe). */
  minted_total: number | null;
  /**
   * İşsizlik ve NPC havuzu (D5). Alanlar eski sunucuda ve eski kayıtta yoktur (`undefined` ya da `null` = ölçülmedi).
   * `unemployed` / `unemployment_rate` YALNIZ iş arayan oyuncuları sayar; havuzdaki işsiz NPC'ler `npc_pool`'dadır.
   */
  /** Havuzdaki işsiz NPC sayısı. */
  npc_pool?: number | null;
  /** Bir firmada çalışan NPC sayısı. */
  npc_employed?: number | null;
  /** Nakdi eşiğin altında kalan, bu yüzden tüketemeyen havuz NPC'si. */
  npc_broke?: number | null;
  /** Havuz NPC'lerinin ortalama nakdi (Akçe). */
  npc_pool_cash_avg?: number | null;
  /** İş arayan oyuncu sayısı (`unemployed` ile aynı). */
  players_seeking?: number | null;
  /** Ahırda çalışan oyuncu sayısı. */
  players_in_ahir?: number | null;
  /** Öğrenci oyuncu sayısı; eğitim kapalıysa `null`. */
  players_students?: number | null;
  /** Toplam işsizlik: (iş arayan oyuncu + havuz NPC) / (çalışan + iş arayan oyuncu + havuz NPC). */
  unemployment_rate_all?: number | null;
  /** Haftada ödenen işsizlik ödeneği, oyunculara (Akçe). */
  benefit_paid?: number | null;
  /** Haftada havuz NPC'lerine ödenen ödenek (Akçe); bu kural kapalıysa `null`. */
  benefit_paid_npc?: number | null;
  /** Haftada ödenen belediye ücreti (Akçe). */
  muni_wages?: number | null;
  /** Haftada ödenen çıraklık bursu (Akçe). */
  bursary_paid?: number | null;
  /** Haftada kısılan işsizlik ödeneği (Akçe). */
  benefit_cut?: number | null;
  /**
   * İşe alım kuralları ve yeni oyuncu katılımı (D6). Alanlar eski sunucuda ve eski kayıtta yoktur (`undefined` ya da `null` = ölçülmedi).
   * İlk hafta açılış kadrosu işe alım sayılmaz; haftalık alanlar o haftanın değeridir.
   */
  /** Toplam oyuncu: başlangıçtakiler ve sonradan katılanlar. */
  players_total?: number | null;
  /** O hafta katılan yeni oyuncu. */
  players_new?: number | null;
  /** Başlangıçtan bu yana katılan yeni oyuncu. */
  players_new_total?: number | null;
  /** Ahırların toplam kapasitesi (kişi). */
  ahir_capacity?: number | null;
  /** Ahır doluluğu: ahırdaki kişi / kapasite (1'in üstü kapasite aşımı). */
  ahir_fill?: number | null;
  /** NPC firmalarında çalışan NPC sayısı (ahır ve belediye hariç). */
  npc_firm_npc?: number | null;
  /** NPC firmalarında çalışan oyuncu sayısı (ahır ve belediye hariç). */
  npc_firm_players?: number | null;
  /** O hafta NPC firmalarına işe alınan oyuncu. */
  hired_player?: number | null;
  /** O hafta NPC firmalarına işe alınan NPC. */
  hired_npc?: number | null;
  /** O hafta küçülmeyle çıkarılan oyuncu. */
  fired_player?: number | null;
  /** O hafta küçülmeyle havuza dönen NPC. */
  fired_npc?: number | null;
  /** O hafta ahırdan ya da belediyeden NPC firmasına geçen oyuncu. */
  ahir_moves?: number | null;
  /** O hafta boşluk zinciriyle ahıra giren NPC. */
  ahir_backfilled?: number | null;
  /** O hafta toplam kişi sınırı yüzünden katılamayan yeni oyuncu. */
  inflow_blocked?: number | null;
  /**
   * Dünya kurulumu göstergeleri (D7). Alanlar eski sunucuda ve eski kayıtta yoktur (`undefined` ya da `null` = ölçülmedi).
   */
  /** Yerleşik (NPC) işletmelerin kadro doluluğu: çalışan / kapasite (1'e yakın = kapasite tıkanıyor). */
  staff_fill?: number | null;
  /** Kapasitesi dolan tür sayısı (türün çalışanı / kapasitesi en az 0,95). */
  kinds_full?: number | null;
  /** Toplam konut stoku (tüm şehirler); konut kapalıysa null. */
  house_stock?: number | null;
  /** Birinci haftada işe alınan NPC sayısı (açılış kadrosu, sabit). */
  opening_staff?: number | null;
  /** İşletme sayısı: yerleşik (NPC) + oyuncu işletmesi (ahır ve belediye hariç, canlılar); eski sunucuda ve kayıtlarda alan yok. */
  firms_total?: number | null;
  /** Bakmakla yükümlü NPC sayısı (D9): hane kipinde işgücü dışındaki NPC'ler; tek kişi kipinde 0. Eski sunucuda ve kayıtlarda alan yok. */
  npc_dependents?: number | null;
  /** NPC işgücüne katılım oranı (D9): işgücündeki NPC / NPC nüfusu (tek kişi kipinde 1). Eski sunucuda ve kayıtlarda alan yok. */
  npc_lfp?: number | null;
  /** İşgücü dışına çıkmış (cesareti kırılmış) NPC sayısı (D10, B7); kural kapalıyken 0. Eski sunucuda ve kayıtlarda alan yok. */
  npc_discouraged?: number | null;
  /** Belediye işlerinde çalışan NPC sayısı (D10, B6); kural kapalıyken 0. Eski sunucuda ve kayıtlarda alan yok. */
  muni_npc?: number | null;
  /** O hafta NPC firmalarına işe alınan toplam kişi, oyuncu ve NPC (D10). Eski sunucuda ve kayıtlarda alan yok. */
  hires?: number | null;
  /** O hafta NPC firmalarından ayrılan toplam kişi: çıkarılan oyuncu ve NPC artı kendiliğinden ayrılan NPC (D10). */
  separations?: number | null;
  /** O hafta kendiliğinden ayrılan NPC (D10, B3); kural kapalıyken 0. */
  quits_npc?: number | null;
  /** İş bulma oranı: işsizlikten işe girenler / hafta başı işsizler, 0-1 (D10). İşsiz yoksa null. */
  job_finding_rate?: number | null;
  /** Ortalama işsizlik süresi, hafta: 1 / iş bulma oranı (kararlı durum tahmini; D10). */
  unemployment_duration?: number | null;
  /** Para stokunun kesimlere dağılımı, Akçe (D11); altısının toplamı para stokudur. Hane: oyuncu ve NPC nakdi (mevduat lonca hesabındadır). Eski sunucuda ve kayıtlarda alan yok. */
  money_households?: number | null;
  /** Yerleşik (NPC) işletmelerin kasaları, Akçe (D11). */
  money_npc_firms?: number | null;
  /** Oyuncu işletmelerinin kasaları, Akçe (D11). */
  money_player_firms?: number | null;
  /** Şehir kasalarının toplamı, Akçe (D11). */
  money_city?: number | null;
  /** Loncaların hesapları (sermaye, mevduat, refah, rezerv), Akçe (D11). */
  money_lonca?: number | null;
  /** Öbür hesaplar, Akçe: kamu işletmeleri, yenileme fonları (D11). Kira emaneti şehre sayılır, burada değildir. */
  money_other?: number | null;
  /** Şehir kasalarına o hafta giren vergiler (D11). */
  city_in_tax?: number | null;
  /** O hafta yerleşik işletmelerden şehre süpürülen kâr (D11). */
  city_in_profit?: number | null;
  /** O hafta şehir kasalarına giren kiralar (D11). */
  city_in_rent?: number | null;
  /** O hafta şehir kasalarının eksiğini kapatmak için basılan para (D11). */
  city_in_mint?: number | null;
  /** O hafta şehir kasalarına giren öbür kalemler (D11). */
  city_in_other?: number | null;
  /** Şehir kasalarından o hafta hanelere giden para: burs, işsizlik ödeneği, hane transferi (D11). */
  city_out_households?: number | null;
  /** Şehir kasalarından o hafta belediye ücretleri (D11). */
  city_out_wages?: number | null;
  /** Şehir kasalarından o hafta hizmet alımı ve sözleşmeler (D11). */
  city_out_services?: number | null;
  /** Şehir kasalarından o hafta işletmelere giden sermaye ve destek (D11). */
  city_out_firms?: number | null;
  /** Şehir kasalarından o hafta çıkan öbür kalemler (D11). */
  city_out_other?: number | null;
  /** Oyuncu servetinde üst %10'un payı, 0-1 (modelin ölçüsü; nakit + mevduat + konut + mal, firma kasası dahil değil). Eski kayıtlarda yok. */
  wealth_top10?: number | null;
  /** Oyuncu servetinde üst %1'in payı, 0-1 (modelin ölçüsü, firma kasası dahil değil). */
  wealth_top1?: number | null;
  /** Medyan oyuncunun serveti, Akçe (modelin ölçüsü, firma kasası dahil değil). */
  wealth_median?: number | null;
  /** Oyuncu gelirinin Gini katsayısı (o haftanın gelir türleri). */
  income_gini?: number | null;
  /** Oyuncu gelirinde üst %10'un payı, 0-1 (o haftanın gelir türleri). */
  income_top10?: number | null;
  /** Likit varlıkta (nakit + mevduat) alt %50 oyuncunun payı, 0-1. */
  liquid_b50?: number | null;
  /** Likit varlıkta orta %40 oyuncunun payı, 0-1. */
  liquid_m40?: number | null;
  /** Likit varlıkta üst %10 oyuncunun payı, 0-1. */
  liquid_t10?: number | null;
  /** Haftada kuruluş kredisi isteyen farklı kurucu sayısı (`loans_applied` deneme sayısıdır: ret olunca aynı kurucu her lonca turunda yeniden denenir). Eski kayıtlarda yok. */
  founders_applied?: number | null;
  /** Haftada kuruluş kredisi reddedilen farklı kurucu sayısı (ret / lonca sayısı; bölünmüyorsa null). Eski kayıtlarda yok. */
  founders_rejected?: number | null;
  /** Batan oyuncu işletmesi, birikimli (kurucusu ayrılınca ya da kadrosu boşalınca kapananlar; Ar-Ge DAO hariç). `failed_cum` yalnız yerleşik işletme iflasıdır. Eski kayıtlarda yok. */
  failed_player_cum?: number | null;
  /** Batan Ar-Ge DAO, birikimli. Eski kayıtlarda yok. */
  failed_dao_cum?: number | null;
  /** Temerrütle ölen yerleşik işletme, birikimli (`failed_cum` iflastır, bu temerrüt). Eski kayıtlarda yok. */
  failed_npc_default_cum?: number | null;
  /** Batan işletme, toplam, birikimli: `failed_cum` + oyuncu + DAO + temerrüt. Pano 'batan' göstergesi. Eski kayıtlarda yok. */
  failed_total_cum?: number | null;
  /** Açık kadro, toplam (hedef kadro eksiği; modelin kadro hedefi kaydı varsa, yoksa null). Eski kayıtlarda yok. */
  vacancies?: number | null;
  /** İşçisiz canlı yerleşik işletme sayısı (ahır ve belediye dışı). Eski kayıtlarda yok. */
  staffless_npc?: number | null;
  /** Haftada ücreti ödenemediği için işten çıkan kişi sayısı. Eski kayıtlarda yok. */
  wage_fail?: number | null;
  /** Uzun süreli işsiz payı: 26 haftadan uzun süredir iş arayanlar / bütün iş arayanlar (ölçülmüş süre). Eski kayıtlarda yok. */
  unemp_long_share?: number | null;
  /** Dört hafta önce işe girip hâlâ aynı firmada olan kişi sayısı (dört hafta gecikmeli). Eski kayıtlarda yok. */
  hires_stable4?: number | null;
  /** Hayalet işletme sayısı: işçisiz ve bir kişilik işletme sermayesinden az nakdi olan yerleşik işletme (D11). */
  ghost_firms?: number | null;
  /** O hafta hayalet işletme kuralı yüzünden kapanan işletme sayısı (D11). */
  ghost_closed?: number | null;
};

/** Şehir başına haftalık satır (S5). Ölçülemeyen alan `null`. */
export type CityRow = {
  index: number; served: number | null; employed: number; unemployed: number; cash: number | null; firms_npc: number; firms_player: number;
  /** İşletme sayısı = firms_npc + firms_player; eski sunucuda alan yok. */
  firms_total?: number;
  rent_pct: number | null; occupancy: number | null; tenants_per_house: number | null; migration_in: number; migration_out: number;
  /** Şehir kasası / sönümlü haftalık zorunlu gider (modelin kasa tabanı ölçüsü); taban kuralı kapalıysa `null`, eski sunucuda alan yok. */
  cash_weeks?: number | null;
  /** Şehrin havuzundaki işsiz NPC; eski sunucuda alan yok. */
  npc_pool?: number;
  /** Havuzdaki NPC'lerden nakdi eşiğin altında olanlar (tüketemeyen). */
  npc_broke?: number;
  /** İş arayan oyuncu (`unemployed` ile aynı). */
  players_seeking?: number;
  /** Şehirdeki kişi sayısı (oyuncu + NPC); eski sunucuda alan yok. */
  population?: number;
  /** Şehrin ahırında çalışan oyuncu; eski sunucuda alan yok. */
  players_in_ahir?: number;
};

/** İşletme çekmecesinin işletme penceresi alanları (`DrawerData.fields` içinde; eski sunucuda yok). */
export type IsletmeCekmecesi = {
  product: string | null; price: number | null; wage_avg: number | null;
  /** Haftalık satış: `W.fsold` (satılan miktar; modelde firma başına üretim alanı yok). */
  sold_week: number | null;
  /** Son en çok 12 haftanın kârı, eskiden yeniye. */
  profit_hist: number[];
};

/** Zincir panosu paketi (S5). `edges` yalnız tarif sürümü (`edges_rev`) değişince gelir. */
export type ChainSector = {
  sector: string; product: string | null; firms: number; healthy: number | null; shortage: number | null; persist: number | null;
  cover_days: number | null; price_trend: number | null; price: number | null;
};
export type ChainNode = {
  sector: string; city: number; shortage: number | null; price: number | null; firms: number; healthy: number | null;
  demand: number | null; output: number | null; stock: number | null;
};
export type ChainScarce = { sector: string; product: string; persist: number | null; shortage: number | null; firms: number; healthy: number | null };
/**
 * Şehir kurumları (Liman = ithalat, İhracat), şehir başına bir satır (sunucu `kurumlar`, her hafta; eski sunucuda ve kayıtta yok).
 * `ithalat_hacim` / `ihracat_hacim`: o hafta başka şehirlerden alınan / başka şehirlere satılan malın değeri (Akçe). `ithalat_urunler`: en çok ithal edilen en fazla 5 ürün,
 * `pay` = ürünün tüm ithalat içindeki oranı (0-1), paya göre azalan. Modelde kota yok (kapalı dünya: ihracat başka şehrin ithalatıdır).
 */
export type KurumSatiri = { sehir: number; ithalat_hacim: number; ithalat_urunler: { urun: string; pay: number }[]; ihracat_hacim: number };
/**
 * Ekonomi bloğu (M10; paketin `ekonomi` alanı, her hafta; eski sunucuda ve kayıtta yok). Ayrıştırıcı sayıları olduğu gibi korur:
 * ölçülmeyen (ya da sonlu olmayan / negatif) değer `null` kalır, 0'a çevrilmez. `n` birimi kişi-DÖNGÜdür (haftada 7 döngü);
 * `npc_issiz_parasiz` kişi-HAFTAdır. Oranlar (`karsilanma`, 0-1) birimden bağımsızdır.
 */
export type HaneTuketim = { n: number | null; karsilanma: number | null; sepet: number | null };
export type NpcHaneTuketim = { ise: HaneTuketim; issiz: HaneTuketim; dis: HaneTuketim };
export type EksikUrun = { urun: string; istek: number; karsilanmayan: number; uretim: number; stok: number };
export type Hareket = { kurulan: number; buyuyen: number; kuculen: number; batan: number };
export type TuketimSehir = {
  sehir: number; ise: HaneTuketim; issiz: HaneTuketim; npc: NpcHaneTuketim | null;
  /** Kişi-hafta. */
  npc_issiz_parasiz: number | null;
  harcama: { oyuncu: number | null; npc: number | null } | null;
};
export type EkonomiSehir = {
  sehir: number; ozel_calisan: number | null; kamu_calisan: number | null; calisan_oyuncu: number | null; calisan_npc: number | null; isgucu_disi: number | null;
  boy: [number, number, number, number]; hareket: Hareket | null;
};
/**
 * Ücret ve fiyat satırı (dünya ya da bir şehir). `ucret` / `fiyat`: ücret ve fiyat endeksi (1,00 = modelin başlangıç düzeyi; ilk hafta = 100 yeniden tabanlama istemcide);
 * `net`: alt kademe (çırak) vergi sonrası haftalık ücret (Akçe); `oran`: net ücret / kişi başı haftalık sepet bedeli (en düşük ücret sepetin kaç katı).
 * Dünya değerleri nüfus ağırlıklıdır. Ölçülmeyen alan `null`.
 */
export type UcretSatiri = { ucret: number | null; fiyat: number | null; net: number | null; oran: number | null };
export type UcretBlogu = { dunya: UcretSatiri; sehir: UcretSatiri[] };
export type EkonomiBlogu = {
  tuketim: {
    hane: {
      ise: HaneTuketim; issiz: HaneTuketim;
      /** NPC haneleri (dünya); eski blokta yok. */
      npc: NpcHaneTuketim | null;
      /** Kişi-hafta (n gibi kişi-döngü değil). */
      npc_issiz_parasiz: number | null;
      sehir: TuketimSehir[];
    };
    harcama: { npc: number | null; oyuncu: number | null; toplam: number | null } | null;
    /** Yalnız sektör panosunda olan ürünler (en çok açık veren en çok 5); bir ürünün çekmecesi yalnız burada varsa açılabilir. `null` = pano kapalı/yok. */
    urunler: EksikUrun[] | null;
    /** Ücret ve fiyat endeksi (sunucu `ucret`; eski blokta yok). `sehir[i]` = şehir `i`. */
    ucret?: UcretBlogu | null;
  };
  isletme: {
    istihdam: { oyuncu: number | null; npc: number | null; ozel: number | null; kamu: number | null };
    hareket: Hareket | null;
    sektor: { tur: string; calisan: number; firma: number }[];
    sektor_diger: { calisan: number; firma: number } | null;
    sehir: EkonomiSehir[];
  };
  para: { oyuncu_n: number | null; oyuncu_ust10: number | null; oyuncu_alt90: number | null; npc_hane_nakit: number | null; npc_hane_mevduat: number | null } | null;
};
/**
 * Makro göstergeler (M10; paketin `makro` alanı, her hafta; eski sunucuda ve kayıtta yok). Ekonomi bloğundan ayrıdır. Ayrıştırıcı sayıları olduğu gibi korur
 * (negatif de olabilir: enflasyon, büyüme, gerçek faiz, kâr marjı); ölçülmeyen alan `null`, 0'a çevrilmez.
 * Endeksler (`tuk`, `uretici`, `ucret`, `gercek_ucret`, `kira`) ilk hafta = 1 (istemci grafikte 100 yapar). Oranlar 0-1 arası kesirdir (0,05 = yüzde 5);
 * faizler YILLIK BİLEŞİK ((1 + haftalık)^52 - 1), enflasyon yıllık, `buyume` son 13 haftadaki değişimdir. Para tutarları Akçe.
 */
export type MakroBlogu = {
  fiyat: { tuk: number | null; enf: number | null; uretici: number | null; ucret: number | null; gercek_ucret: number | null };
  uretim: { nominal: number | null; gercek: number | null; buyume: number | null; verimlilik: number | null };
  para: { stok: number | null; korunum: number | null; mali: number | null; kredi_net: number | null; acilis: number | null; hiz: number | null };
  faiz: { politika: number | null; mevduat: number | null; kredi: number | null; gercek: number | null };
  marj: { npc: number | null; oyuncu: number | null };
  /** Konut modeli kapalıysa `null`. */
  konut: { kira: number | null; kira_gelir: number | null } | null;
  dagilim: { gini_nakit: number | null; gini_gelir: number | null; gini_servet: number | null; yoksul: number | null; medyan_sepet: number | null };
  kredi: { stok: number | null; buyume: number | null; temerrut: number | null };
};
export type ChainPacket = {
  board: boolean; edges_rev: number; edges?: [string, string, string][]; sectors: ChainSector[]; nodes: ChainNode[]; scarce: ChainScarce[] | null;
};

/** Çekmece verisi (S5): `stale` bayat sayılan istek (hafta ilerlemiş), `note_key` bir `tr.ts` anahtarı. */
export type DrawerData = {
  kind: string; ref: string; week: number; stale: boolean; title: string; fields: Record<string, unknown>; note_key?: CopyKey;
};

export type WorldEvent = {
  id: string;
  week: number;
  kind: "good" | "warn" | "bad" | "neutral";
  textKey: CopyKey;
  params: Record<string, string | number>;
  critical: boolean;
  sector: string | null;
  rule_ids: string[];
  /** Sürüm olayında değişen ayarlar (eski değer yoksa `null`). */
  changes?: { id: string; from: UIValue | null; to: UIValue }[];
  /** Neden-sonuç zinciri adımları. */
  chain?: { step: string; textKey: CopyKey; params: Record<string, string | number> }[];
};

/** "Ne olmuyor" tanısı; `textKey` bilinen bir `neolmuyor.*` anahtarıdır (bilinmeyen tel girdisi düşürülür). */
export type Diagnostic = { id: string; textKey: CopyKey; params: Record<string, string | number>; rule_ids: string[]; since_week: number };

export type WeekPacket = {
  v: 1; run_id: string; week: number; version: number; world: World; events: WorldEvent[];
  diagnostics?: Diagnostic[];
  cities?: CityRow[];
  chain?: ChainPacket;
  /** Şehir kurumları (Liman/İhracat): şehir başına haftalık ithal/ihraç hacmi ve en çok ithal edilen ürünler. Eski sunucuda ve kayıtta yok. */
  kurumlar?: KurumSatiri[];
  /** Ekonomi paneli verisi (tüketim, işletmeler ve iş gücü, para). Eski sunucuda ve kayıtta yok. */
  ekonomi?: EkonomiBlogu;
  /** Makro göstergeler (fiyat, üretim, para, faiz, kâr, dağılım, kredi). Eski sunucuda ve kayıtta yok. */
  makro?: MakroBlogu;
  /** Kayıtta şehir başına kasa-hafta (canlıda aynı değer `cities[].cash_weeks`'te); sütun yoksa alan yok. */
  cash_weeks?: (number | null)[];
  /** Kim ne tutuyor (PLAN-TAKIP): paranın hesap ve sahiplik ayrışımı, gruplar, loncalar, sahip serveti, kesimden kesime akış. Eski kayıtta ve eski sunucuda yok. */
  holdings?: Holdings;
  /** Şehir haritası için işletme anlık görüntüsü (sunucu 10 haftada bir yollar; diğer haftalarda ve kayıtta yok). */
  harita?: HaritaVerisi;
  /** Kurucu: tam `harita` taşımayan haftalarda, son tam `harita` haftasına göre hafif fark (DAO'da yok: her hafta tam harita). Kayıtta yok. */
  haritaFark?: HaritaFarki;
  /** DAO koşusunda oyuncunun gözlemi (yalnız DAO koşusunda). */
  dao?: DaoGozlem;
};

type Sayi = number | null;

/** Bölüm 4.1: paranın hesap ve sahiplik ayrışımının girdileri (Akçe). `lonca_cash_net` işaretlidir. */
export type HoldingsMoney = {
  deposits_players: Sayi; deposits_insurance: Sayi; found_fund: Sayi; insurance_reserve: Sayi; lonca_cash_net: Sayi;
  credit_out: Sayi; fund_credit_out: Sayi; bonds_out: Sayi; lonca_equity: Sayi;
};
export type HoldingsPlayerGroup = { n: Sayi; cash: Sayi; deposits: Sayi };
/** Lonca satırı (§4.2). Kişi kimliği yoktur (K1). `owner` bilinmeyen değerde `null`. */
export type HoldingsLonca = {
  ref: string; owner: "player" | "none" | "closed" | null; members: Sayi; fee: Sayi; capital: Sayi; deposits: Sayi; credit_out: Sayi; equity: Sayi;
};
/** Sahip serveti dilimleri (K2: firma kasası sahibin servetidir); paylar toplam <= 0 iken `null`. */
export type HoldingsWealth = { b50: Sayi; m40: Sayi; t10: Sayi; t1: Sayi; median: Sayi; gini: Sayi; n: Sayi };
export type HoldingsFlow = { from: string; to: string; amount: number };
export type Holdings = {
  money: HoldingsMoney;
  groups: { player: Record<string, HoldingsPlayerGroup>; npc: Record<string, { n: Sayi; cash: Sayi }> };
  deposits: { by_group: Record<string, Sayi> };
  loncas: HoldingsLonca[];
  firms: { player_count: Sayi; owners: Sayi; multi_owners: Sayi; cash_top10_share: Sayi };
  wealth: HoldingsWealth;
  /** Haftalık kesimden kesime akış (tutara göre en büyük hücreler; `other` -> `other` satırı kalanların toplamı). Sunucu ölçemediyse `null`. */
  flows: HoldingsFlow[] | null;
};

export type SimEvent =
  | { type: "state"; state: RunState }
  | { type: "week"; packet: WeekPacket }
  | { type: "world_event"; event: WorldEvent }
  | { type: "ended"; reason: "duration"; week: number }
  | { type: "error"; messageKey: CopyKey };

export type ChangeResult =
  | { accepted: true; runId: string; mode: "exact" | "nearest" | "live"; scenarioId: string; seamWeek: number; version: number }
  | { accepted: false; fields: { id: string; reason: "no_recording" | "locked" | "busy" | "ended" | "invalid" | "start_only" | "passive" }[] };

export type Availability = {
  ok: boolean;
  scenarioId: string | null;
  blocked: { settingId: string; option: string; reason: "no_recording" | "locked" | "start_only" | "unverified" }[];
};

export type SettingAvail = {
  id: string;
  options: { value: string; available: boolean; reason?: "no_recording" | "locked" }[];
  /** Bu bağlamda (Kurucu ya da koşu ortası) değiştirilebilir mi; yoksa `options[].available` geçerli. */
  changeable?: boolean;
  reason?: "locked" | "no_recording" | "start_only" | "passive" | "unverified" | "no_cash_floor";
};

export type RegistryControl =
  | { type: "options"; options: { value: string | number | boolean; label: string }[] }
  | { type: "number"; min: number; max: number; step: number; unit: string | null; integer: boolean }
  | { type: "fields"; fields: { key: string; label: string; hint?: string; control: RegistryControl }[] }
  | { type: "order" | "multi"; items: { value: string; label: string }[] };

export type RegistryCard = {
  id: string;
  layer: string;
  group: string;
  actor: string | null;
  level: string;
  editable: boolean;
  status: "active" | "passive" | "experimental";
  kind: "options" | "toggle" | "number" | "fields" | "order" | "multi";
  params: string[];
  requires: string[];
  title: string;
  what: string;
  changes: string;
  hint?: string;
  basis?: { label: string; note?: string };
  warning?: string;
  aliases?: string[];
  /** Salt okunur satırlar (etiketi isteğe bağlı, değer birimli metin olarak hazır); `key` yayımlanmaz. */
  shows?: { label?: string; value: number | string | boolean; text: string }[];
  control: RegistryControl;
  default: UIValue;
  /** Canlılığın tek kaynağı (DK-17): `unknown` her yerde kilitli. */
  apply: "live" | "live_sync" | "start_only" | "passive" | "unknown";
  /** Ölçülmüş değerler (her zaman liste; order/multi kartlarında her eleman bir liste-değer) ya da `null`. */
  measured_values: UIValue[] | null;
  measured_with: Record<string, UIValue> | null;
  measured_weeks: number | null;
  hint_source: string | null;
  credit_type: string | null;
  scenario_editable: boolean;
  source_world_field: string | null;
  /** Kart varsayılandan farklı seçilince koşu "yeni ölçüm" sayılır (tek kaynak: sunucu `plan.DECISIONS`; alan yoksa false). */
  new_measurement?: boolean;
  /** Yalnız V: kartın yalnız bu kural kartları bu değerdeyken işlediği koşul ({kural kartı: değer}); yayımlanmıyorsa yoktur. */
  effective_when?: Record<string, UIValue>;
};

export type RegistryGroup = { id: string; order: number; title: string; hint?: string };
export type RegistryTemplate = {
  id: string; title: string; what?: string; values: ValuesPatch;
  /** Şablon bu kaynakta başlatılabilir mi (`false`: `blocked_by` kartlar doğrulanmadı); alan yoksa başlatılabilir sayılır. */
  startable?: boolean;
  blocked_by?: string[];
  /** Şablonun varsayılandan farklı yaptığı dünya varsayımı kartları (V). Başlat bunları göndermez; sunucu `templateId` ile uygular. */
  behavior_changes?: string[];
  /** Şablonun taşıdığı dünya değerleri; arayüz göndermez. */
  world_values?: ValuesPatch;
};
/** Dünya senaryosu (V kartı değerleri). `startable: false` ise `blocked_by` kartlar doğrulanmadı; `measured: false` etkisi ölçülmedi. */
export type RegistryScenario = { id: string; title: string; what?: string; values: ValuesPatch; startable?: boolean; blocked_by?: string[]; measured?: boolean };
/** `units`: birleşik sözcükler ve birim şablonları (`acik`, `kapali`, `yok`, `yuzde` = "%{n}" ...); `formatValue` bunlardan okur. */
/**
 * Tutarlılık kuralı (R1b `tutarlilik.json`; metin çözülmüş): `when` = kartların hepsi aynı anda eşleşirse uyarı (nesne değerli kartta yalnız
 * verilen alanlar eşleşir); `artan` = kartın alanları sırayla küçükten büyüğe olmalıdır, aksi hâlde uyarı. Kayıt yayımlamıyorsa alan yoktur.
 */
export type ConsistencyRule = {
  id: string;
  text: string;
  when?: Record<string, UIValue>;
  artan?: { kart: string; alanlar: string[] };
};
export type Registry = {
  cards: RegistryCard[]; groups: RegistryGroup[]; templates: RegistryTemplate[]; scenarios: RegistryScenario[]; units: Record<string, string>;
  consistency?: ConsistencyRule[];
};

export type JobKind = "seeds" | "ab" | "preview";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
/** Arka plan işinin yalnız özet serileri (haftalık; hafta 1 ilk eleman). */
export type JobSeriesKey = "served" | "failed_cum" | "city_cash_total" | "gini" | "unemployment_rate" | JobSeriesYeni;
/** Sonradan eklenen seriler (toplam batan, geniş işsizlik): eski sunucu ve kayıtlarda yoktur. */
export type JobSeriesYeni = "failed_total_cum" | "unemployment_rate_all";
export type JobMember = {
  label: string;
  status: JobStatus;
  seedIndex: number;
  weeks: number;
  series: Record<Exclude<JobSeriesKey, JobSeriesYeni>, (number | null)[]> & Partial<Record<JobSeriesYeni, (number | null)[]>>;
  /** Başarısız üyenin neden kodu (ör. `model_error`). */
  error?: string;
};
export type Job = { jobId: string; kind: JobKind; status: JobStatus; progress: { done: number; total: number }; members: JobMember[] };
/** Etki önizlemesi: aynı dünyada taban şart ve taslak şartla gerçek koşu (`weeks` 1..52). */
export type PreviewSpec = {
  kind: "preview"; base: RunConfig; draft: RunConfig; weeks?: number;
  /** Koşu ortası: işçi `fromWeek + weeks` haftada durur; `base`/`draft` tarifleri `schedule` ile koşunun kendisidir. */
  fromWeek?: number;
};

/** Tarif (DK-11): `config` + sürüm takvimi (`week` dikiş haftası). `config.schedule` ayrıca taşınmaz; sunucu `recipe.schedule` okur. */
export type JobRecipe = { config: Omit<RunConfig, "schedule">; schedule: { week: number; patch: ValuesPatch }[] };
/** Aynı şartı başlangıç dünyalarının hepsinde koşar (`members`: her dünya için bir üye). */
export type SeedsSpec = { kind: "seeds"; recipe: JobRecipe };
/** İki tarifi aynı dünyada (A'nın dünyası) koşar; `members` etiketleri `a` ve `b`. */
export type AbSpec = { kind: "ab"; a: JobRecipe; b: JobRecipe };
export type JobSpec = PreviewSpec | SeedsSpec | AbSpec;

/** Hedef sonucu: `met` null ise `reason` nedeni söyler (`pending` henüz belli değil, `unmeasured` ölçülemedi). */
export type GoalResult = {
  id: GoalId;
  /** Kurucu'da seçilmiş mi (seçilmeyen hedef de hesaplanır, "seçilmedi" etiketiyle gösterilir). */
  selected: boolean;
  met: boolean | null;
  reason: "pending" | "unmeasured" | null;
  /** Etiketin ölçüsü: alive çöküş haftası, serve son 30 hafta ortalaması, kasa en düşük değer, gini son değer; yoksa `null`. */
  value: number | null;
  /** Yalnız kasa: ölçü en düşük şehirden (`city`) mi, yoksa beş şehrin toplamından (`total`: eski sunucu/kayıt) mı geldi. */
  basis?: "city" | "total";
  /** Yalnız kasa: hükmün karşılaştırıldığı taban (hafta); modelin koşunun şartında uyguladığı değer. */
  floor?: number;
  /** Yalnız kasa: model bu şartta tabanı gerçekten uyguluyor mu (geçiş desteği kapalıyken uygulamaz; `floor` yalnız hedef eşiğidir). */
  floorApplied?: boolean;
};
/** Koşunun istemcide hesaplanan sonucu (`computeResult`). */
export type RunResult = {
  week: number;
  duration: number;
  /** Koşu bitti ya da çöküşten sonra 10 hafta geçti: hedefler artık kesinleşir. */
  over: boolean;
  collapseWeek: number | null;
  recoveryWeek: number | null;
  goals: GoalResult[];
};
/** Biten işin çizilebilir özeti: tamamlanan üyeler çizgi, başarısız üyeler uyarı olur. */
export type JobResult = {
  lines: { label: string; seedIndex: number; served: (number | null)[] }[];
  failed: { label: string; seedIndex: number; error: string | null }[];
};

export type SourceInfo = {
  kind: "replay" | "live";
  modelNote: string;
  /** Başlangıç dünyaları; sunucunun `label` alanı ("Dünya N") gösterilmez: etiket kartın seçeneklerinden gelir. */
  seeds: { index: number }[];
  durationWeeks: number;
  settings: SettingAvail[];
  /** `valueText`: canlıda modelin varsayılanından üretilen, biçimlenmiş değer metni; varsa `valueKey` yerine gösterilir. */
  fixedRules: { settingId: string; valueKey: CopyKey; valueText?: string }[];
  templates: { id: string; values: ValuesPatch }[];
  registry?: Registry;
  /** Seçilebilir koşu süreleri (hafta). */
  durations?: number[];
  capabilities?: Capabilities;
  /** Sunucu yayınlanan dünyaları kalıcı tutuyor mu (`/info.dunyalarKalici`); yoksa bilinmiyor (eski sunucu). */
  dunyalarKalici?: boolean;
  /** Statik dünya bilgisi (S5): şehir kaynakları ve zincir; `basis` modelin varsayılan dünyasına göre olduğunu söyler. */
  world?: WorldInfo;
};

export type WorldInfo = {
  basis: string;
  cities: { index: number; coal: boolean; gold: boolean; resources: { id: string; label: string }[]; specialties: { sector: string; label: string }[]; population_share: number }[];
  chain?: { sectors: { sector: string; label: string; product: string | null }[]; edges: { from: string; to: string; product: string }[] };
};

/** Yayınlanmış dünyanın liste satırı (`GET /dunyalar?kurucu=`). */
export type DunyaOzet = { kod: string; ad: string; aciklama: string; oynanma: number; olusturma: number; baglanti: string };
/** Yayınlanmış dünya (`GET /dunyalar/{kod}`). `guncelSurum !== modelSurumu` ise dünya oynanamaz. */
export type DunyaDetay = { kod: string; ad: string; aciklama: string; tarif: Record<string, unknown>; modelSurumu: string; guncelSurum: string; oynanma: number };
/** Skor tablosu satırı; `ad` yoksa oyuncu ad vermemiştir. */
export type DunyaSkorSatiri = { ad: string | null; dilim: number; unvan: string; isletme: number; servet: number };

export type Capabilities = {
  branch: boolean; seeds: boolean; compare: boolean; library: boolean; city: boolean; chain: boolean;
  jobs?: boolean; rebuild?: boolean;
  /** Paket `harita` taşır (canlı koşu); kayıtta yok. */
  harita?: boolean;
};

/**
 * Kaynak sözleşmesi. Davranış kuralları `tests/oyun/sim/contractSuite.ts` ile her kaynakta sınanır.
 * Kapatılmış (`dispose`) kaynakta asenkron yöntemler `SimUnsupported` ile reddeder; `subscribe` ya
 * `SimUnsupported` fırlatır ya da hiç olay vermeyen boş bir iptal işlevi döner.
 */
export interface SimSource {
  readonly kind: "replay" | "live";
  readonly capabilities: Capabilities;
  /** Kaynak bilgisi (tohumlar, ayarlar, şablonlar). Kapanmışsa `SimUnsupported`. */
  info(): Promise<SourceInfo>;
  /**
   * Ayar değerleri için kullanılabilirlik; hiçbir koşu durumunu değiştirmez. `runId` koşu ortası bağlamıdır: canlı kaynakta
   * yalnız o koşuda değiştirilebilen ayarlar açık kalır (öteki `locked`); kayıt kaynağı bağlamı yok sayar.
   */
  availability(values: ValuesPatch, runId?: string): Promise<Availability>;
  /** Yeni koşu açar: `status: "ready"`, `week: 0`, `version: 1`. Desteklenmeyen yapılandırma `SimUnsupported`. */
  start(config: RunConfig): Promise<RunHandle>;
  /**
   * Var olan koşuyu (ör. yenilemeden sonra) açar; bilinmeyen kimlikte `null`. Hata fırlatmaz.
   * `rebuild` (canlı kaynak, Koşular): kimlik bilinmiyorsa koşu bu tarifle (`schedule`, `fastForwardTo` dahil) yeniden kurulur;
   * bu durumda `start` hataları (`too_many_runs`, `busy_preparing`, `invalid`, `hata.sunucu_yok`) fırlatılır, sessiz `null` olmaz.
   */
  open(runId: string, rebuild?: RunConfig): Promise<RunHandle | null>;
  /**
   * Olay akışı. Sıra: önce `state`, sonra geçmiş haftalar `1..state.week` artan sırayla ve yinelemesiz,
   * sonra gösterilmiş sürüm olayları, sonra canlı olaylar. Geçmiş ilk `listener` çağrısından önce
   * `subscribe` dönmeden EŞZAMANLI teslim edilir (ikinci ve sonraki aboneler dahil). Bilinmeyen kimlikte
   * tek bir `error` olayı verilir. Dönen işlev yinelenen çağrıda zararsızdır.
   */
  subscribe(runId: string, listener: (e: SimEvent) => void): () => void;
  /**
   * Oynat/duraklat/tek adım ve isteğe bağlı hız. `computing` iken, `ended`/`failed` iken durumu
   * değiştirmeden mevcut durumu döner (hafta taşmaz; `ended` olayı yinelenmez). Bilinmeyen kimlikte `SimUnsupported`.
   */
  control(runId: string, cmd: { action: "play" | "pause" | "step" | "olay"; speed?: Speed }): Promise<RunState>;
  /**
   * Gelecek haftadan itibaren geçerli ayar değişikliği. Kabulde `seamWeek >= 0` ve `version` artar
   * (hafta 0'daki değişiklik istisna: sürüm 1'de kalabilir); koşu kimliği değişebilir (`runId`), eski kimlik
   * takma ad olarak geçerli kalır. Reddedilirse `fields` neden verir; `ended` koşuda `reason: "ended"`.
   */
  applyChange(runId: string, change: { from: "next_week"; patch: ValuesPatch; note?: string }): Promise<ChangeResult>;
  /** Yayımlanmış (`<= state.week`) haftalar, kapsayıcı aralık. Bilinmeyen kimlikte `SimUnsupported`. */
  weeks(runId: string, from: number, to: number): Promise<WeekPacket[]>;
  /** v2 (isteğe bağlı; yoksa özellik kapalıdır, `capabilities` ile bildirilir). Tür parametreleri tüketen görevde daraltılır. */
  registry?(): Promise<Registry>;
  /** Canlı kaynak: seçilen ayarlarla açılış kapasite hesabı (model koşusu yok). Geçersiz ayar `SimUnsupported("invalid")`. Kayıt kaynağında yoktur. */
  worldPlan?(config: RunConfig): Promise<WorldPlan>;
  /**
   * Dal koşusu: `week` 0 <= W < süre. Dönen koşu hazırlanırken `state.preparing` doludur. Hata kimlikleri (`SimUnsupported` iletisi):
   * `invalid_branch`, `too_many_runs`, `busy_preparing`, `unknown_run`.
   */
  branch?(runId: string, week: number, patch?: ValuesPatch): Promise<RunHandle>;
  /** Koşuyu sunucudan atar (dal hazırlığını iptal). Ebeveyn etkilenmez; bilinmeyen kimlik sessizdir. */
  discard?(runId: string): Promise<void>;
  listRuns?(): Promise<RunHandle[]>;
  /** Arka plan işi başlatır; iş kimliğini döner. Sunucu meşgulse `SimUnsupported("job_running")`, geçersiz istekte `SimUnsupported("invalid_job")`. */
  startJob?(spec: JobSpec): Promise<string>;
  job?(id: string): Promise<Job>;
  cancelJob?(id: string): Promise<Job>;
  /** Ayrıntı çekmecesi (canlı kaynak, S5): yalnız okur, koşu durumunu değiştirmez. `week` yayımlanmış bir hafta (<= state.week). */
  drawer?(runId: string, kind: string, ref: string, week: number): Promise<DrawerData>;
  /** DAO koşusunun yayımlanan haftadaki gözlemi (bitmiş koşuda son gözlem). Hata: `SimUnsupported` iletisi `dao_degil`, `hazirlaniyor`, `unknown_run`. Canlı kaynakta vardır. */
  daoGozlem?(runId: string): Promise<DaoGozlem>;
  /**
   * DAO kararı. Kabulde uygulanacak hafta döner. Ret: `SimUnsupported` iletisi sunucunun hata kodu (`karar_gecersiz`, `ayni_hafta`, `once_cek`, `kurucuyken_goc`,
   * `kosu_bitti`, `dao_degil`, `unknown_run`); ağ/5xx için `hata.sunucu_yok` / `hata.sunucu_bozuk`.
   */
  daoKarar?(runId: string, karar: DaoKarar): Promise<DaoKararSonucu>;
  /**
   * DAO görünen adı (koşu başına bir kez, dünyaya bağlı koşuda). Hata iletisi sunucu kodu: `sonuc_yok`, `ad_var`, `oyuncu_uyusmuyor`, `karar_gecersiz`, `unknown_run`.
   */
  daoAd?(runId: string, ad: string, oyuncu: string): Promise<void>;
  /** Dünya yayınlama (canlı kaynak). `tarif` bir `SharedRecipe`'tir. Hata iletisi: `sinir`, `invalid_config`, `karar_gecersiz`. */
  dunyaYayinla?(tarif: unknown, ad: string, aciklama: string, oyuncu: string): Promise<{ kod: string; baglanti: string }>;
  /** Canlı kaynağın sunucu kökeni (paylaşım bağlantıları bu kökenle kurulur; `/d/<kod>` yalnız oyun sunucusunda vardır). */
  sunucuKoku?(): string;
  /** Oyuncunun yayınladığı dünyalar (yeniden eskiye). */
  dunyalarim?(oyuncu: string): Promise<DunyaOzet[]>;
  /** Hata iletisi `dunya_yok`. */
  dunyaGetir?(kod: string): Promise<DunyaDetay>;
  dunyaSkor?(kod: string): Promise<DunyaSkorSatiri[]>;
  /** Dünyada yeni DAO koşusu kurar. Hata iletisi: `dunya_yok`, `eski_surum`, `busy_preparing`, `too_many_runs`. */
  dunyaOyna?(kod: string, oyuncu: string): Promise<{ runId: string }>;
  /** Kaynağı kapatır; sonraki çağrılar yukarıdaki kurala uyar. Yinelenen çağrı zararsızdır. */
  dispose(): void;
}
