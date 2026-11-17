import type { GoalId, GoalResult, Job, JobResult, Registry, RunResult, ValuesPatch, WeekPacket, WorldEvent } from "./types";

/** Hedef eşikleri (Kurucu'daki hedef metinleriyle aynı): talep karşılama, şehir kasası tabanı, servet Gini. */
export const SERVE_ESIK = 0.8;
export const SERVE_PENCERE = 30;
/**
 * Şehir kasası tabanı, modelin KOŞUNUN şartında uyguladığı tabandır (hafta cinsinden sönümlü zorunlu gider katı): geçiş desteği "kurtarma fonuyla"
 * (TRANS_SUPPORT=2) iken derin taban TRANS_FLOOR2, öteki şartlarda TRANS_FLOOR_WEEKS (`kasa_tabani` kartı). Değerler kayıt kartlarından okunur
 * (`kasaTaban`); sabit yalnız kayıt yokken yedektir (kaynağı simkit/params.py TRANS_FLOOR_WEEKS = 2.0, TRANS_FLOOR2 = 0.5).
 * Ölçü şehir başına kasa-haftadır (kasa kaç haftalık gidere yeter; en düşük şehir); şehir verisi yoksa sunucunun toplam `city_cash_weeks`'i;
 * taban kuralı kapalıysa `null` = ölçülmedi.
 */
export const KASA_TABAN_HAFTA = 2;
const KASA_TABAN_DERIN_HAFTA = 0.5;
/** Açılış dönemi: şehir kasası tabanı bu haftadan sonra denetlenir. */
export const KASA_ILK_HAFTA = 14;
export const GINI_ESIK = 0.8;
/** Çöküşten sonra bu kadar hafta geçince koşu "bitmiş" sayılır: hedefler kesinleşir. */
export const COKUS_SONRASI = 10;

export const TUM_HEDEFLER: readonly GoalId[] = ["alive", "serve", "kasa", "gini"];

/** Koşunun şartında modelin uyguladığı kasa tabanı (hafta): kayıt kartlarından (`gecis_destegi`, `kasa_tabani`, `destek_bitis_esigi.shows`) okunur. */
export function kasaTaban(registry: Registry | null, values: ValuesPatch): number {
  const kart = (id: string) => registry?.cards.find((c) => c.id === id);
  const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const gecis = values.gecis_destegi ?? kart("gecis_destegi")?.default;
  if (gecis === "kurtarma_fonuyla") return sayi(kart("destek_bitis_esigi")?.shows?.find((s) => typeof s.value === "number")?.value) ?? KASA_TABAN_DERIN_HAFTA;
  return sayi(values.kasa_tabani) ?? sayi(kart("kasa_tabani")?.default) ?? KASA_TABAN_HAFTA;
}

/** Model tabanı yalnız geçiş desteği açıkken uygular (kapalıyken taban kuralı yok): kapalıyken `kasaTaban` değeri yalnız hedef eşiğidir. */
export function kasaTabanUygulanir(registry: Registry | null, values: ValuesPatch): boolean {
  const gecis = values.gecis_destegi ?? registry?.cards.find((c) => c.id === "gecis_destegi")?.default;
  return gecis !== "kapali";
}

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Bir haftanın kasa ölçüsü: şehir başına kasa-hafta varsa (canlı `cities[].cash_weeks`, kayıt `cash_weeks`) en düşük şehir; yoksa (eski sunucu/kayıt,
 * ya da tüm şehir ölçüleri `null`) beş şehrin toplam ölçüsü `world.city_cash_weeks`.
 */
function kasaOlcusu(w: WeekPacket): { value: number; city: boolean } | null {
  const sehirler = [...(w.cities?.map((c) => c.cash_weeks) ?? []), ...(w.cash_weeks ?? [])].filter(fin);
  if (sehirler.length > 0) return { value: Math.min(...sehirler), city: true };
  const toplam = w.world.city_cash_weeks;
  return fin(toplam) ? { value: toplam, city: false } : null;
}
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Olayın haftası: `params.hafta`, yoksa kimliğin `kural:<hafta>` sonu. */
function olayHaftasi(e: WorldEvent): number {
  const h = e.params.hafta;
  if (typeof h === "number" && Number.isFinite(h)) return h;
  const n = Number(e.id.split(":")[1]);
  return Number.isFinite(n) ? n : e.week;
}

function ilkHafta(events: WorldEvent[], kural: string): number | null {
  const weeks = events.filter((e) => e.id.startsWith(`${kural}:`)).map(olayHaftasi);
  return weeks.length > 0 ? Math.min(...weeks) : null;
}

/**
 * Koşunun sonucu: çöküş ve toparlanma haftaları (olaylardan), koşunun bitip bitmediği ve dört hedefin durumu.
 * `extraEvents`: paketlerin dışında gelen olaylar (sürüm olayları gibi); çöküş ve toparlanma kural olayları iki yerden de okunur.
 * Ölçülemeyen değer (`null`) hedefi `unmeasured` yapar (koşu bitmişse); bitmemişse `pending`.
 */
export function computeResult(weeks: WeekPacket[], goals: readonly GoalId[] | undefined, duration: number, extraEvents: WorldEvent[] = [], taban: number = KASA_TABAN_HAFTA, tabanUygulanir = true): RunResult {
  const week = weeks[weeks.length - 1]?.week ?? 0;
  const events = [...weeks.flatMap((w) => w.events), ...extraEvents];
  const collapseWeek = ilkHafta(events, "cokus");
  const rec = ilkHafta(events, "toparlanma");
  const recoveryWeek = collapseWeek !== null && rec !== null && rec >= collapseWeek ? rec : null;
  const over = week > 0 && (week >= duration || (collapseWeek !== null && week >= collapseWeek + COKUS_SONRASI));
  const secili = new Set(goals ?? []);

  /** Değer yokken: koşu bitmişse ölçülemedi, bitmemişse henüz belli değil. */
  const bos = (): Pick<GoalResult, "met" | "reason"> => ({ met: null, reason: over ? "unmeasured" : "pending" });
  const karar = (ok: boolean): Pick<GoalResult, "met" | "reason"> => (over ? { met: ok, reason: null } : { met: null, reason: "pending" });

  const sonServe = weeks.slice(-SERVE_PENCERE).map((w) => w.world.served).filter(fin);
  const ortalama = sonServe.length > 0 ? round6(sonServe.reduce((a, x) => a + x, 0) / sonServe.length) : null;
  const kasalar = weeks.filter((w) => w.week >= KASA_ILK_HAFTA).flatMap((w) => { const o = kasaOlcusu(w); return o ? [o] : []; });
  // En düşük değeri veren ölçü hem değeri hem etiketi (şehir/toplam) belirler; eşitlikte şehir ölçüsü.
  const dip = kasalar.reduce<{ value: number; city: boolean } | null>((m, o) => (m === null || o.value < m.value || (o.value === m.value && o.city) ? o : m), null);
  const enDusuk = dip?.value ?? null;
  const kasaKaynak: GoalResult["basis"] = dip?.city ? "city" : "total";
  const gini = weeks[weeks.length - 1]?.world.gini;
  const sonGini = fin(gini) ? gini : null;

  const sonuc: Record<GoalId, Pick<GoalResult, "met" | "reason" | "value" | "basis" | "floor" | "floorApplied">> = {
    alive: collapseWeek !== null ? { met: false, reason: null, value: collapseWeek } : { ...karar(true), value: null },
    serve: ortalama === null ? { ...bos(), value: null } : { ...karar(ortalama >= SERVE_ESIK), value: ortalama },
    // Kasa tabanın altına inmişse koşu bitmeden de kesin başarısızdır.
    kasa: enDusuk === null ? { ...bos(), value: null } : enDusuk < taban ? { met: false, reason: null, value: enDusuk, basis: kasaKaynak, floor: taban, floorApplied: tabanUygulanir } : { ...karar(true), value: enDusuk, basis: kasaKaynak, floor: taban, floorApplied: tabanUygulanir },
    gini: sonGini === null ? { ...bos(), value: null } : { ...karar(sonGini <= GINI_ESIK), value: sonGini },
  };
  return {
    week, duration, over, collapseWeek, recoveryWeek,
    goals: TUM_HEDEFLER.map((id) => ({ id, selected: secili.has(id), ...sonuc[id] })),
  };
}

/** Biten işin çizilebilir özeti: tamamlanan üyeler çizgi, başarısız üyeler uyarı; öteki durumlar çizilmez. */
export function jobResult(job: Job): JobResult {
  return {
    lines: job.members.filter((m) => m.status === "done").map((m) => ({ label: m.label, seedIndex: m.seedIndex, served: m.series.served })),
    failed: job.members.filter((m) => m.status === "failed").map((m) => ({ label: m.label, seedIndex: m.seedIndex, error: m.error ?? null })),
  };
}

/** Bir ölçünün son (en son ölçülen hafta), zirve (ilk görüldüğü hafta) değeri. */
export type SeriOzeti = { son: number; zirve: number; zirveHafta: number };
export type IssizlikOzeti = { toplam: SeriOzeti | null; tuketemeyen: SeriOzeti | null };

function seriOzeti(weeks: WeekPacket[], pick: (p: WeekPacket) => number | null | undefined): SeriOzeti | null {
  let son: number | null = null;
  let zirve: SeriOzeti | null = null;
  for (const p of weeks) {
    const v = pick(p);
    if (!fin(v)) continue;
    son = v;
    if (zirve === null || v > zirve.zirve) zirve = { son: v, zirve: v, zirveHafta: p.week };
  }
  return zirve === null || son === null ? null : { son, zirve: zirve.zirve, zirveHafta: zirve.zirveHafta };
}

/** Sonuç karnesi için işsizlik özeti: toplam işsizlik (NPC dahil) ve tüketemeyen NPC; ölçülmediyse `null` ("ölçülmedi"). */
export function issizlikOzeti(weeks: WeekPacket[]): IssizlikOzeti {
  return {
    toplam: seriOzeti(weeks, (p) => p.world.unemployment_rate_all),
    tuketemeyen: seriOzeti(weeks, (p) => p.world.npc_broke),
  };
}

/** Sonuç karnesi için işe alım ve nüfus özeti: toplam oyuncu artışı ve NPC istihdam oranı (NPC nüfusunun çalışan payı); ölçülmediyse `null`. */
export type IseAlimOzeti = { oyuncu: { ilk: number; son: number; yeni: number } | null; npcIstihdam: { ilk: number; son: number } | null };

export function iseAlimOzeti(weeks: WeekPacket[]): IseAlimOzeti {
  let ilk: number | null = null;
  let son: number | null = null;
  let yeni = 0;
  let oIlk: number | null = null;
  let oSon: number | null = null;
  for (const p of weeks) {
    const n = p.world.players_total;
    if (fin(n)) {
      if (ilk === null) ilk = n;
      son = n;
    }
    if (fin(p.world.players_new_total)) yeni = p.world.players_new_total;
    const e = p.world.npc_employed;
    const h = p.world.npc_pool;
    if (fin(e) && fin(h) && e + h > 0) {
      const o = e / (e + h);
      if (oIlk === null) oIlk = o;
      oSon = o;
    }
  }
  return {
    oyuncu: ilk === null || son === null ? null : { ilk, son, yeni },
    npcIstihdam: oIlk === null || oSon === null ? null : { ilk: oIlk, son: oSon },
  };
}

/** Hafta paketinden işletme sayısı: sunucunun `firms_total` alanı, yoksa (eski sunucu, kayıt) yerleşik + oyuncu işletmesi. */
export function isletmeSayisi(w: WeekPacket["world"]): number | null {
  if (fin(w.firms_total)) return w.firms_total;
  return fin(w.npc_firms) && fin(w.player_firms) ? w.npc_firms + w.player_firms : null;
}

/** Sonuç karnesi için dünya kurulumu özeti (D8): işletme sayısı (ilk ve son hafta), kadro doluluğu, açılış kadrosu; ölçülmediyse alan `null`. */
export type KurulumOzeti = {
  isletme: { ilk: number; son: number } | null;
  doluluk: { ilk: number; son: number } | null;
  acilis: number | null;
};

export function kurulumOzeti(weeks: WeekPacket[]): KurulumOzeti {
  let iIlk: number | null = null;
  let iSon: number | null = null;
  let dIlk: number | null = null;
  let dSon: number | null = null;
  let acilis: number | null = null;
  for (const p of weeks) {
    const n = isletmeSayisi(p.world);
    if (n !== null) {
      if (iIlk === null) iIlk = n;
      iSon = n;
    }
    if (fin(p.world.staff_fill)) {
      if (dIlk === null) dIlk = p.world.staff_fill;
      dSon = p.world.staff_fill;
    }
    if (acilis === null && fin(p.world.opening_staff)) acilis = p.world.opening_staff;
  }
  return {
    isletme: iIlk === null || iSon === null ? null : { ilk: iIlk, son: iSon },
    doluluk: dIlk === null || dSon === null ? null : { ilk: dIlk, son: dSon },
    acilis,
  };
}

/** İşgücü göstergeleri (D9): NPC işgücüne katılım oranı ve bakmakla yükümlü NPC sayısının son ölçülen değeri; ölçülmediyse `null`. */
export type IsgucuOzeti = { katilim: number | null; bagimli: number | null };

export function isgucuOzeti(weeks: WeekPacket[]): IsgucuOzeti {
  let katilim: number | null = null;
  let bagimli: number | null = null;
  for (const p of weeks) {
    if (fin(p.world.npc_lfp)) katilim = p.world.npc_lfp;
    if (fin(p.world.npc_dependents)) bagimli = p.world.npc_dependents;
  }
  return { katilim, bagimli };
}

/** İşgücü akışları özeti (D10): haftalık iş bulma oranının ve tahmini işsizlik süresinin ortalaması, toplam işe alım ve ayrılma; hiçbiri ölçülmediyse `null`. */
export type AkisOzeti = { isBulma: number | null; sure: number | null; alim: number | null; ayrilma: number | null };

export function akisOzeti(weeks: WeekPacket[]): AkisOzeti | null {
  const ort = (f: (p: WeekPacket) => number | null | undefined): number | null => {
    let top = 0;
    let n = 0;
    for (const p of weeks) {
      const v = f(p);
      if (fin(v)) {
        top += v;
        n += 1;
      }
    }
    return n === 0 ? null : top / n;
  };
  const toplam = (f: (p: WeekPacket) => number | null | undefined): number | null => {
    let top = 0;
    let n = 0;
    for (const p of weeks) {
      const v = f(p);
      if (fin(v)) {
        top += v;
        n += 1;
      }
    }
    return n === 0 ? null : top;
  };
  const o: AkisOzeti = {
    isBulma: ort((p) => p.world.job_finding_rate),
    sure: ort((p) => p.world.unemployment_duration),
    alim: toplam((p) => p.world.hires),
    ayrilma: toplam((p) => p.world.separations),
  };
  return o.isBulma === null && o.sure === null && o.alim === null && o.ayrilma === null ? null : o;
}

/** Para dağılımı özeti (D11): son haftanın para stoku payları (altı kesimin hepsi ölçülmüşse), son hayalet işletme sayısı ve koşu boyunca kapananların toplamı; hiçbiri ölçülmediyse `null`. */
export type ParaOzeti = {
  hane: number | null; yerlesik: number | null; oyuncu: number | null; kasa: number | null; lonca: number | null; diger: number | null;
  hayalet: number | null; kapanan: number | null;
};

export function paraOzeti(weeks: WeekPacket[]): ParaOzeti | null {
  const o: ParaOzeti = { hane: null, yerlesik: null, oyuncu: null, kasa: null, lonca: null, diger: null, hayalet: null, kapanan: null };
  let kapanan = 0;
  let kapananVar = false;
  for (const p of weeks) {
    const w = p.world;
    const kes = [w.money_households, w.money_npc_firms, w.money_player_firms, w.money_city, w.money_lonca, w.money_other];
    if (kes.every(fin)) {
      const top = (kes as number[]).reduce((a, b) => a + b, 0);
      if (top > 0) {
        const [hane, yerlesik, oyuncu, kasa, lonca, diger] = (kes as number[]).map((v) => v / top);
        Object.assign(o, { hane, yerlesik, oyuncu, kasa, lonca, diger });
      }
    }
    if (fin(w.ghost_firms)) o.hayalet = w.ghost_firms;
    if (fin(w.ghost_closed)) {
      kapanan += w.ghost_closed;
      kapananVar = true;
    }
  }
  o.kapanan = kapananVar ? kapanan : null;
  return o.hane === null && o.hayalet === null && o.kapanan === null ? null : o;
}
