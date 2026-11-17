import { readFileSync } from "node:fs";
import path from "node:path";
import type { HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import { MAX_AD_UZUNLUK, MAX_NOT_UZUNLUK } from "@/oyun/lib/sinirlar";
import DAO_KARAR from "./daoKarar.json";
import { DaoRet, FakeDao } from "./fakeDao";
import { recipeToConfig, type SharedRecipe } from "@/oyun/sim/recipe";
import type { Diagnostic, Job, JobKind, JobMember, RunConfig, RunState, UIValue, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";

/** Bellek içi sahte canlı sunucu: `fetch` ve `EventSource` gerçeklemesi (sözleşme sözleşmesi ve LiveSource testleri için). */

type Conn = { es: FakeES; open: boolean };
type Takvim = { week: number; patch: Record<string, UIValue> }[];
type FakeRun = {
  id: string; state: RunState; packets: WeekPacket[]; versionEvents: WorldEvent[]; conns: Set<Conn>;
  /** Koşunun kuruluş tarifi (dallanma için): ham yapılandırma ve takvim (hafta 0 yamaları dahil; canlı kabuller eklenir). */
  config: RunConfig; schedule: Takvim;
  /** DAO koşusu (`config.mode === "dao"`): sahte oyuncu. */
  dao?: FakeDao;
  /** Yayınlanmış dünyaya bağlı DAO koşusu (`POST /dunyalar/{kod}/oyna`). */
  dunya?: { kod: string; oyuncu: string };
};

/** Sahte sunucunun yayınlanmış dünyası ve bitirilmiş koşu sonuçları (gerçek sunucunun bellek deposunun küçük taklidi). */
export type FakeDunya = { kod: string; ad: string; aciklama: string; tarif: Record<string, unknown>; modelSurumu: string; kurucu: string; olusturma: number; oynanma: number };
export type FakeSonuc = { kod: string; runId: string; oyuncu: string; ad: string | null; dilim: number; unvan: string; isletme: number; servet: number };

export type FakeLiveServer = {
  fetch: typeof fetch;
  EventSource: typeof EventSource;
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
  /** Açık (kapatılmamış) akış sayısı. */
  openStreams(): number;
  /** Koşu başına açık akış sayısı. */
  streamsFor(runId: string): number;
  /** Sonraki isteklerin hepsi için ağ hatası (true) / 500 (number) / normal (null). */
  failWith: "network" | 500 | null;
  /** `POST /runs` için sunucu reddi: 429 `too_many_runs` ya da 409 `busy_preparing` (gövdeler `wire_contract.json`'dan); null = normal. */
  startFailWith: "too_many_runs" | "busy_preparing" | null;
  /** `POST /runs/{id}/branch` için sunucu reddi (gövdeler `wire_contract.json`'dan); null = normal. */
  branchFailWith: "too_many_runs" | "busy_preparing" | "invalid_branch" | null;
  /** Dal koşusunun hazırlık ilerlemesini `done`'a taşır (`done >= total` ise hazırlık biter: hafta = W, paylaşılan geçmiş yayımlanır). */
  fastForwardTo(runId: string, done: number): void;
  /** true iken `GET /runs/{id}/dao` 409 `hazirlaniyor` döner (koşunun ilk paketi henüz yok). */
  daoHazirlaniyor: boolean;
  /** true iken `POST /dao/karar` 504 `karar_belirsiz` döner (işçi zamanında yanıtlamadı; karar uygulanmış olabilir). */
  daoKararBelirsiz: boolean;
  /** Kabul yanıtındaki `hafta`ya eklenen sapma: oynarken sunucu önde olduğundan yanıt yayımlanan hafta + 2 olabilir. */
  daoHaftaSapmasi: number;
  /** `/info.dunyalarKalici` (varsayılan false: bellek deposu). */
  dunyalarKalici: boolean;
  /** `guncelSurum`; dünyanın `modelSurumu` ile farklıysa `oyna` 409 `eski_surum` döner. */
  guncelSurum: string;
  /** İlk bu kadar `POST /dao/ad` sonuç henüz yazılmamış gibi 409 `sonuc_yok` döner (sonuç kancası gecikmesi). */
  sonucYokSayisi: number;
  dunyalar: Map<string, FakeDunya>;
  sonuclar: Map<string, FakeSonuc>;
  /** `/info` ve `/hello` yetenekleri; varsayılan hepsi kapalı, test alan açabilir. */
  capabilities: Record<string, boolean>;
  /** Açık akışlara bağlantı kesintisi (yeniden bağlanıyor) bildirir. */
  dropStreams(): void;
  /** Açık akışlara kalıcı kapanış bildirir. */
  killStreams(): void;
  /** Açık akışlara sunucu `error` olayı. */
  crashRun(runId: string): void;
  /** Akışlara ham SSE verisi. */
  push(runId: string, type: string, data: string): void;
  run(runId: string): FakeRun | undefined;
  /** S3 arka plan işleri (`capabilities.jobs` açıkken): `POST /jobs` işi `running` açar; testler ilerletir, bitirir ya da üyeyi bozar. */
  jobs: {
    /** Başlatılan işler (başlatma sırasıyla) ve gövdeleri. */
    all(): { job: Job; body: unknown }[];
    /** İlerleme sayacı (`status` değişmez); sayaç `total` altında da iş bitebilir. */
    progress(jobId: string, done: number): void;
    /** İşi bitirir: `failed` etiketli üyeler `model_error` ile başarısız olur, sayaç `total`'in altında kalır. */
    complete(jobId: string, opts?: { failed?: string[]; weeks?: number; status?: "done" | "failed" }): void;
    /** Sonraki `POST /jobs` reddi: 409 `job_running` ya da 422 `invalid_job`; null = normal. */
    startFailWith: "job_running" | "invalid_job" | null;
  };
};

const WORLD_NULL: World = {
  served: null, unemployed: null, employed: null, npc_firms: null, player_firms: null, failed_cum: null, city_cash_total: null,
  city_cash_weeks: null, gini: null, price_index: null, inflation_yoy: null, unemployment_rate: null, policy_rate: null, minted_year: null,
  mint_cap: null, loans_applied: null, loans_rejected: null, loans_granted: null, loan_rate_avg: null, support_weekly: null,
  survival_52: null, wage_index: null, rent_pct: null, occupancy: null, house_index: null, deposit_rate: null, bond_rate: null,
  lonca_fee_avg: null, royalty_avg: null, money_total: null, velocity: null, privatized_firms: null, no_founder: null, reject_pool: null,
  reject_reputation: null, no_buyer_cum: null, support_denied: null, policy_unemployment: null, city_spend_cut: null, tenants_per_house: null, house_resale_ratio: null, policy_inflation: null, minted_total: null,
};

/** Sahte `harita` anlık görüntüsü: gerçek model türleriyle, her şehirde birkaç işletme; bazıları loncalı, bazıları oyuncu işletmesi. */
const HARITA_TURLERI = ["tarla_bugday", "un", "firin", "market", "lojistik", "tekstil", "maden_komur", "restoran", "giyim", "okul", "ahir", "santral"];
export const haritaOf = (week: number): HaritaVerisi => {
  const sehirSayisi = Math.max(1, WIRE.packet.cities?.length ?? 0);
  const loncalar = (WIRE.packet.holdings?.loncas ?? []).map((l) => l.ref);
  const firmalar: HaritaFirmaSatiri[] = [];
  for (let i = 0; i < 6 * sehirSayisi; i++) {
    firmalar.push([`f${i}`, HARITA_TURLERI[i % HARITA_TURLERI.length], i % sehirSayisi, 2 + ((i * 11) % 60), i % 3 === 0 && loncalar.length > 0 ? loncalar[i % loncalar.length] : null, i % 5 === 0 ? "oyuncu" : "npc", i % 5 === 0 ? i : null, "uretim"]);
  }
  return { hafta: week, firmalar };
};

/** DAO koşusunun haritası: gerçek sunucu gibi her hafta; ilan veren firmalar (f1, f2, f9) oyuncunun şehrinde (0) bina olarak vardır. */
export const daoHaritasi = (week: number): HaritaVerisi => {
  const h = haritaOf(week);
  const ilan: Record<string, string> = { f1: "firin", f2: "market", f9: "firin" };
  return { hafta: h.hafta, firmalar: h.firmalar.map((f) => (f[0] in ilan ? [f[0], ilan[f[0]]!, 0, f[3], null, "npc", null, "uretim"] as HaritaFirmaSatiri : f)) };
};

/** Sunucunun sıkıştırılmış `harita` tel biçimi (`extract.harita_of`): tablolar blokta bir kez, kalıba uyan kimlik yalnız sayı. */
export const haritaTel = (h: HaritaVerisi): Record<string, unknown> => {
  const turler: string[] = []; const loncalar: string[] = []; const sahipler = ["npc", "oyuncu", "dao"];
  const idx = (liste: string[], v: string): number => { const i = liste.indexOf(v); if (i >= 0) return i; liste.push(v); return liste.length - 1; };
  const firmalar = h.firmalar.map(([id, tur, sehir, calisan, lonca, sahip, dogum, durum]) => {
    const on = `s${sehir}_${tur}`;
    const kalan = id.startsWith(on) ? id.slice(on.length) : "";
    const no = /^(0|[1-9][0-9]*)$/.test(kalan) ? Number(kalan) : id;
    return [no, idx(turler, tur), sehir, calisan, lonca === null ? -1 : idx(loncalar, lonca), sahipler.indexOf(sahip), dogum, durum];
  });
  return { hafta: h.hafta, alanlar: ["id", "tur", "sehir", "calisan", "lonca", "sahip", "dogum", "durum"], turler, loncalar, sahipler, firmalar };
};

export const packetOf = (runId: string, week: number, version: number, extra: { cities?: boolean; chain?: boolean; holdings?: boolean; harita?: boolean; dao?: boolean; ekonomi?: boolean; makro?: boolean; diagnostics?: Diagnostic[] } = {}): WeekPacket => ({
  v: 1, run_id: runId, week, version, world: { ...WORLD_NULL, served: 0.9 - week * 0.001, employed: 100 + week }, events: [],
  ...(extra.cities ? { cities: WIRE_PACKET.cities } : {}),
  ...(extra.chain ? { chain: WIRE_PACKET.chain } : {}),
  ...(extra.holdings ? { holdings: WIRE_PACKET.holdings } : {}),
  ...(extra.ekonomi ? { ekonomi: EKONOMI_TEL as WeekPacket["ekonomi"] } : {}),
  ...(extra.makro ? { makro: MAKRO_TEL as WeekPacket["makro"] } : {}),
  ...(extra.harita && (extra.dao === true || week === 1 || week % 10 === 0) ?     // gerçek işçi: DAO her hafta; Kurucu 1. hafta ve 10'un katları tam harita,
     { harita: haritaTel(haritaOf(week)) as unknown as HaritaVerisi } : {}),
  ...(extra.harita && extra.dao !== true && week !== 1 && week % 10 !== 0 ?        // Kurucu'nun aradaki haftaları: son tam haftaya (1 ya da 10'un katı) göre boş fark (sahte harita haftalar arası değişmez)
     { haritaFark: { hafta: week, taban: week < 10 ? 1 : Math.floor(week / 10) * 10, degisen: [], yeni: [], kapanan: [] } } : {}),
  ...(extra.diagnostics ? { diagnostics: extra.diagnostics } : {}),
});

/** Sahte sunucunun `apply` sınıfları (fikstür `applyFixture.json`: gerçek sınıflar R2 bitince veri olarak gelir). */
const APPLY = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/applyFixture.json"), "utf-8")) as Record<string, string>;

/** Gerçek sunucunun örnek yanıtları (Python `tests/test_wire_contract.py` ile ortak): sahte, bu alanlarda gerçekten ayrışmaz. */
const WIRE_FILE = path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json");
const WIRE = JSON.parse(readFileSync(WIRE_FILE, "utf-8")) as {
  info: Record<string, unknown>; availability_ok: unknown; error_job_running: unknown; error_422_job: unknown; error_404_job: unknown; error_too_many_runs: unknown; error_busy_preparing: unknown; error_422_branch: unknown;
  packet: { cities: WeekPacket["cities"]; chain: WeekPacket["chain"]; holdings: WeekPacket["holdings"]; ekonomi: unknown; makro: unknown }; drawer_fresh: Record<string, unknown>; drawer_firm: Record<string, unknown>; error_400_drawer: unknown; error_404_drawer: unknown;
};
const WIRE_PACKET = WIRE.packet;
/** Gerçek sunucunun ekonomi bloğu örneği (fikstür `packet.ekonomi`, tel biçimi). */
export const EKONOMI_TEL = WIRE_PACKET.ekonomi;
/** Gerçek sunucunun makro bloğu örneği (fikstür `packet.makro`, tel biçimi). */
export const MAKRO_TEL = WIRE_PACKET.makro;

/**
 * Gerçek kayıt (yayımlanan `registry.json`): şablon değerleri ve kart varsayılanları. Gerçek sunucu da koşunun `values`'ünü şablon + kullanıcı değerlerinden kurar;
 * sahte aynı kuralı aynı veriyle uygular (parite testi: `sim/live/paritySunucu.test.ts`).
 */
const KAYIT = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../public/oyun-kayit/registry.json"), "utf-8")) as {
  cards: { id: string; default: UIValue }[]; templates: { id: string; values: Record<string, UIValue> }[];
};
const sablonDegerleri = (id: unknown): Record<string, UIValue> => ({ ...(KAYIT.templates.find((t) => t.id === id)?.values ?? {}) });
const varsayilan = (id: string): UIValue | undefined => KAYIT.cards.find((c) => c.id === id)?.default;

/**
 * Bağlam kilidi (sunucu `runs/manager.py` `context_locks` ile aynı kural, arayüz değerleriyle): geçiş desteği, kuruluş fonu ve şehir kasası kuralı
 * kapalı kurulduysa kasa tabanı yapısı kurulmaz; bu koşuda `gecis_destegi` koşu ortasında değişmez.
 */
const baglamKilitleri = (base: Record<string, UIValue>): string[] => {
  const val = (id: string): UIValue | undefined => (id in base ? base[id] : varsayilan(id));
  const acik = (id: string): boolean => { const v = val(id); return typeof v === "object" && v !== null && !Array.isArray(v) ? v.acik === true : false; };
  return val("gecis_destegi") === "kapali" && !acik("kurulus_fonu") && !acik("sehir_kasasi_kurali") ? ["gecis_destegi"] : [];
};
const BAGLAM_NEDENI = "no_cash_floor" as const;

const hataGovdesi = (code: string, message: string, fields: { id: string; reason: string }[] = []) => ({ error: { code, message, fields } });

/** Sahte sunucu v2 özelliklerinin hiçbirini sunmaz: yetenekler kapalı. Gövdedeki bilinmeyen alanlar (ör. `worldScenarioId`) yok sayılır, durumda yansımaz. */
const CAPABILITIES = { branch: false, seeds: false, compare: false, library: false, city: false, chain: false, jobs: false, rebuild: false, harita: false };

class FakeES {
  readyState = 0;
  readonly url: string;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private handlers = new Map<string, Set<(e: Event) => void>>();
  constructor(url: string, private readonly attach: (es: FakeES) => void) {
    this.url = url;
    attach(this);
  }
  addEventListener(type: string, fn: (e: Event) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void): void {
    this.handlers.get(type)?.delete(fn);
  }
  close(): void {
    this.readyState = 2;
  }
  /** @internal */
  deliver(type: string, data?: string, force = false): void {
    if (this.readyState === 2 && !force) return;
    const ev = (data === undefined ? new Event(type) : Object.assign(new Event(type), { data })) as Event;
    for (const h of [...(this.handlers.get(type) ?? [])]) h(ev);
  }
}

export function createFakeLiveServer(opts: { computeMs?: number; autoFastForward?: boolean } = {}): FakeLiveServer {
  const runs = new Map<string, FakeRun>();
  const dunyalar = new Map<string, FakeDunya>();
  const sonuclar = new Map<string, FakeSonuc>();
  let seq = 0;
  let dunyaSeq = 0;
  const computeMs = opts.computeMs ?? 15;
  const log: FakeLiveServer["requests"] = [];
  const jobList: { job: Job; body: unknown }[] = [];
  const jobSpec = { startFailWith: null as "job_running" | "invalid_job" | null };

  const send = (r: FakeRun, type: string, data: unknown): void => {
    const text = JSON.stringify(data);
    for (const c of [...r.conns]) if (c.open) c.es.deliver(type, text);
  };
  const setState = (r: FakeRun, patch: Partial<RunState>): RunState => {
    r.state = { ...r.state, ...patch };
    send(r, "state", r.state);
    return r.state;
  };
  const respond = (status: number, body: unknown): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });


  /** Üyenin haftalık özet serileri: tohum ve hafta sayısına bağlı, belirlenimli. */
  const seriesOf = (seed: number, weeks: number): JobMember["series"] => {
    const col = (f: (w: number) => number): number[] => Array.from({ length: weeks }, (_, i) => Math.round(f(i + 1) * 1e4) / 1e4);
    return {
      served: col((w) => Math.max(0, 0.95 - 0.004 * w - 0.01 * seed)), failed_cum: col((w) => w * (seed + 1) * 0.5), city_cash_total: col((w) => 90000 - 500 * w + seed * 1000),
      gini: col((w) => 0.3 + 0.002 * w), unemployment_rate: col((w) => 0.05 + 0.0005 * w),
      failed_total_cum: col((w) => w * (seed + 1) * 0.75), unemployment_rate_all: col((w) => 0.5 + 0.001 * w),
    };
  };
  const labelsOf = (kind: JobKind): { label: string; seedIndex: (b: Record<string, unknown>) => number }[] => {
    if (kind === "seeds") return Array.from({ length: 6 }, (_, i) => ({ label: `seed-${i}`, seedIndex: () => i }));
    const seedOf = (b: Record<string, unknown>): number => {
      const cfg = (kind === "ab" ? (b.a as { config?: { seedIndex?: number } } | undefined)?.config : (b.base as { seedIndex?: number } | undefined)) ?? {};
      return typeof cfg.seedIndex === "number" ? cfg.seedIndex : 0;
    };
    return (kind === "ab" ? ["a", "b"] : ["base", "draft"]).map((label) => ({ label, seedIndex: seedOf }));
  };
  const jobById = (id: string): { job: Job; body: unknown } | undefined => jobList.find((j) => j.job.jobId === id);
  const setJob = (id: string, f: (j: Job) => Job): void => {
    const hit = jobById(id);
    if (hit) hit.job = f(hit.job);
  };

  /** Gerçek sunucunun `create` kuralı: hafta 0 yamaları kuruluşa katılır (sürüm 1'e), sonrakiler sürüm 2, 3... olur; durum yayımlanan haftanın sürümünü gösterir. */
  const kurRun = (cfg: RunConfig, takvim: Takvim, ff: number | undefined, ek: Partial<RunState> = {}): RunState & { id: string } => {
    const sched = [...takvim];
    const base: Record<string, UIValue> = { ...sablonDegerleri(cfg.templateId), ...(cfg.values ?? {}) };
    for (const e of sched.filter((x) => x.week === 0)) Object.assign(base, e.patch);
    const rest = sched.filter((x) => x.week > 0);
    const versions = rest.reduce<NonNullable<RunState["versions"]>>(
      (acc, e, i) => [...acc, { version: i + 2, fromWeek: e.week, values: { ...acc[acc.length - 1]!.values, ...e.patch } }], [{ version: 1, fromWeek: 0, values: base }],
    );
    const id = `run${++seq}`;
    const locks = baglamKilitleri(base);
    const dao = cfg.mode === "dao";
    const state: RunState = {
      runId: id, status: "paused", week: 0, durationWeeks: dao ? (cfg.durationWeeks ?? 520) : cfg.durationWeeks, speed: 1, computing: false, version: 1, seedIndex: cfg.seedIndex,
      values: base, scenarioId: typeof cfg.templateId === "string" ? cfg.templateId : "canli", name: cfg.name ?? "", cityNames: cfg.cityNames ?? [],
      ...(cfg.worldScenarioId ? { worldScenarioId: cfg.worldScenarioId } : {}),
      ...(cfg.worldScenarioValues ? { worldScenarioValues: cfg.worldScenarioValues } : {}),
      ...(cfg.goals ? { goals: cfg.goals } : {}),
      versions, ...(locks.length > 0 ? { settingLocks: locks.map((l) => ({ id: l, reason: BAGLAM_NEDENI })) } : {}),
      ...(ff ? { preparing: { done: 0, total: ff } } : {}), ...(dao ? { mode: "dao" as const, harita0: haritaTel(daoHaritasi(0)) as unknown as HaritaVerisi } : {}), ...ek,
    };
    const packets = Array.from({ length: ff ?? 0 }, (_, i) => packetOf(id, i + 1, 1 + rest.filter((e) => e.week < i + 1).length));
    runs.set(id, { id, state, packets, versionEvents: [], conns: new Set(), config: cfg, schedule: sched, ...(dao ? { dao: new FakeDao(state.durationWeeks) } : {}) });
    if (ff && opts.autoFastForward) setTimeout(() => server.fastForwardTo(id, ff), computeMs);       // gerçek sunucu hazırlığı kendiliğinden bitirir
    return { ...state, id };
  };
  /** Gerçek `ChangeResult` ret nedeni (kapı sırası: düzenlenemez/bilinmeyen `locked`, pasif, canlı olmayan ya da bağlam kilidi `start_only`). */
  const retNedeni = (id: string, kilitli: readonly string[]): "locked" | "passive" | "start_only" | null => {
    const sinif = APPLY[id];
    if (sinif === "passive") return "passive";
    if (sinif === "live" || sinif === "live_sync") return kilitli.includes(id) ? "start_only" : null;
    return sinif === "start_only" ? "start_only" : "locked";
  };
  const gecersizYapilandirma = (cfg: Record<string, unknown>): { id: string; reason: string }[] => {
    const bad: { id: string; reason: string }[] = [];
    const ad = cfg.name;
    if (ad !== undefined && ad !== null && (typeof ad !== "string" || ad.length > MAX_AD_UZUNLUK)) bad.push({ id: "name", reason: "invalid" });       // sunucu MAX_NAME_LEN
    const sehirler = cfg.cityNames;
    if (sehirler !== undefined && sehirler !== null && (!Array.isArray(sehirler) || sehirler.length > 5 || !sehirler.every((c) => typeof c === "string" && c.length <= MAX_AD_UZUNLUK))) bad.push({ id: "cityNames", reason: "invalid" });
    return bad;
  };

  const b0 = (x: unknown): Record<string, unknown> => (x !== null && typeof x === "object" ? (x as Record<string, unknown>) : {});
  const OYUNCU = /^[A-Za-z0-9-]{8,64}$/;
  const YASAK_METIN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c\u2028\u2029]/;
  const gecersizAlan = (id: string) => respond(422, hataGovdesi("karar_gecersiz", "Geçersiz.", [{ id, reason: "invalid" }]));
  const metinGecerli = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max && !YASAK_METIN.test(v);
  const dunyaYok = () => respond(404, hataGovdesi("dunya_yok", "Bu kodla bir dünya bulunamadı."));
  const normalKod = (s: string): string => decodeURIComponent(s).trim().toUpperCase();

  /** `/api/dunyalar...` uçları (gövdeler `wire_contract.json` örnekleriyle aynı biçimde). */
  const dunyaIstegi = (method: string, p: string, url: URL, body: unknown): Response => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === "POST" && p === "/dunyalar") {
      if (!metinGecerli(b.ad, 1, 60)) return gecersizAlan("ad");
      if (!metinGecerli(b.aciklama ?? "", 0, 280)) return gecersizAlan("aciklama");
      if (typeof b.oyuncu !== "string" || !OYUNCU.test(b.oyuncu)) return gecersizAlan("oyuncu");
      const tarif = b.tarif;
      if (tarif === null || typeof tarif !== "object" || Array.isArray(tarif) || (tarif as { v?: unknown }).v !== 1) return respond(422, hataGovdesi("invalid_config", "Tarif geçersiz.", [{ id: "tarif", reason: "invalid" }]));
      if ([...dunyalar.values()].filter((d) => d.kurucu === b.oyuncu).length >= 20) return respond(429, hataGovdesi("sinir", "Sınır.", []));
      const kod = `K7M2Q${"23456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(dunyaSeq / 31) % 31]}${"23456789ABCDEFGHJKMNPQRSTUVWXYZ"[dunyaSeq++ % 31]}`;
      dunyalar.set(kod, { kod, ad: b.ad, aciklama: typeof b.aciklama === "string" ? b.aciklama : "", tarif: structuredClone(tarif) as Record<string, unknown>, modelSurumu: server.guncelSurum, kurucu: b.oyuncu, olusturma: 1794000000 + dunyaSeq, oynanma: 0 });
      return respond(201, { kod, baglanti: `/d/${kod}` });
    }
    if (method === "GET" && p === "/dunyalar") {
      const k = url.searchParams.get("kurucu");
      if (k === null || !OYUNCU.test(k)) return gecersizAlan("kurucu");
      return respond(200, [...dunyalar.values()].filter((d) => d.kurucu === k).sort((x, y) => y.olusturma - x.olusturma).map((d) => ({ kod: d.kod, ad: d.ad, aciklama: d.aciklama, oynanma: d.oynanma, olusturma: d.olusturma, baglanti: `/d/${d.kod}` })));
    }
    const m = /^\/dunyalar\/([^/]+)(\/oyna|\/skor)?$/.exec(p);
    if (!m) return respond(404, hataGovdesi("not_found", "yok", []));
    const d = dunyalar.get(normalKod(m[1]!));
    if (!d) return dunyaYok();
    if (method === "GET" && m[2] === undefined) return respond(200, { kod: d.kod, ad: d.ad, aciklama: d.aciklama, tarif: d.tarif, modelSurumu: d.modelSurumu, oynanma: d.oynanma, guncelSurum: server.guncelSurum });
    if (method === "GET" && m[2] === "/skor") {
      const satirlar = [...sonuclar.values()].filter((x) => x.kod === d.kod).sort((x, y) => y.dilim - x.dilim || y.servet - x.servet).slice(0, 20);
      return respond(200, satirlar.map((x) => ({ ad: x.ad, dilim: x.dilim, unvan: x.unvan, isletme: x.isletme, servet: x.servet })));
    }
    if (method === "POST" && m[2] === "/oyna") {
      if (typeof b.oyuncu !== "string" || !OYUNCU.test(b.oyuncu)) return gecersizAlan("oyuncu");
      if (d.modelSurumu !== server.guncelSurum) return respond(409, hataGovdesi("eski_surum", "Eski sürüm.", []));
      if (server.startFailWith === "too_many_runs") return respond(429, WIRE.error_too_many_runs);
      if (server.startFailWith === "busy_preparing") return respond(409, WIRE.error_busy_preparing);
      const r = d.tarif as unknown as SharedRecipe;
      const cfg: RunConfig = { ...recipeToConfig(r, d.ad, []), durationWeeks: 520, mode: "dao" };
      const st = kurRun(cfg, [...(cfg.schedule ?? [])], undefined, { dunyaKodu: d.kod });
      runs.get(st.id)!.dunya = { kod: d.kod, oyuncu: b.oyuncu };
      d.oynanma += 1;
      return respond(201, { runId: st.id });
    }
    return respond(405, hataGovdesi("method_not_allowed", "yok", []));
  };

  const server: FakeLiveServer = {
    dunyalarKalici: false, guncelSurum: "v13.3-1a2b3c4d", sonucYokSayisi: 0, dunyalar, sonuclar,
    requests: log, daoHazirlaniyor: false, daoKararBelirsiz: false, daoHaftaSapmasi: 0, failWith: null, startFailWith: null, branchFailWith: null, capabilities: { ...CAPABILITIES },
    openStreams: () => [...runs.values()].reduce((n, r) => n + [...r.conns].filter((c) => c.es.readyState !== 2).length, 0),
    streamsFor: (id) => [...(runs.get(id)?.conns ?? [])].filter((c) => c.es.readyState !== 2).length,
    dropStreams() { for (const r of runs.values()) for (const c of r.conns) if (c.es.readyState !== 2) { c.es.readyState = 0; c.es.deliver("error"); } },
    killStreams() { for (const r of runs.values()) for (const c of r.conns) if (c.es.readyState !== 2) { c.es.readyState = 2; c.es.deliver("error", undefined, true); } },
    crashRun(id) { const r = runs.get(id); if (r) send(r, "error", { messageKey: "hata.model_coktu" }); },
    push(id, type, data) { const r = runs.get(id); if (r) for (const c of r.conns) c.es.deliver(type, data); },
    run: (id) => runs.get(id),
    fastForwardTo(id, done) {
      const r = runs.get(id);
      const prep = r?.state.preparing;
      if (!r || !prep) return;
      if (done < prep.total) { setState(r, { preparing: { done, total: prep.total } }); return; }
      const rest: RunState = { ...r.state };
      delete rest.preparing;
      r.state = rest;
      const vs = r.state.versions ?? [];
      const last = r.packets[prep.total - 1]?.version ?? 1;                       // yayımlanan son paketin sürümü (gerçek `_publish`)
      setState(r, { week: prep.total, status: "paused", version: last, values: vs.find((v) => v.version === last)?.values ?? r.state.values });
      for (const p of r.packets.slice(0, prep.total)) send(r, "week", p);
    },
    jobs: {
      all: () => jobList,
      progress(id, done) { setJob(id, (j) => ({ ...j, progress: { ...j.progress, done } })); },
      complete(id, opts = {}) {
        setJob(id, (j) => {
          const weeks = opts.weeks ?? 12;
          const members = j.members.map((m): JobMember => {
            const bad = opts.failed?.includes(m.label) === true;
            return { ...m, status: bad ? "failed" : "done", weeks: bad ? Math.min(2, weeks) : weeks, series: seriesOf(m.seedIndex, bad ? Math.min(2, weeks) : weeks), ...(bad ? { error: "model_error" } : {}) };
          });
          const lost = members.filter((m) => m.status === "failed").length;
          return { ...j, status: opts.status ?? "done", members, progress: { done: j.progress.total - lost, total: j.progress.total } };
        });
      },
      get startFailWith() { return jobSpec.startFailWith; },
      set startFailWith(v) { jobSpec.startFailWith = v; },
    },
    EventSource: undefined as unknown as typeof EventSource,
    fetch: undefined as unknown as typeof fetch,
  };

  server.EventSource = class extends FakeES {
    constructor(url: string) {
      super(url, (es) => {
        const m = /\/api\/runs\/([^/]+)\/events$/.exec(url);
        const r = m ? runs.get(decodeURIComponent(m[1]!)) : undefined;
        const conn: Conn = { es, open: false };
        // Bağlantı eşzamansız kurulur: önce durum, sonra bütün geçmiş, sonra sürüm olayları.
        queueMicrotask(() => {
          if (es.readyState === 2) return;
          if (!r) { es.readyState = 2; es.deliver("error"); return; }
          es.readyState = 1;
          r.conns.add(conn);
          conn.open = true;
          es.deliver("state", JSON.stringify(r.state));
          for (const p of r.packets.slice(0, r.state.week)) es.deliver("week", JSON.stringify(p));
          for (const v of r.versionEvents) es.deliver("world_event", JSON.stringify(v));
        });
      });
    }
  } as unknown as typeof EventSource;

  const handle = async (method: string, path: string, body: unknown): Promise<Response> => {
    if (server.failWith === "network") throw new TypeError("ağ yok");
    if (server.failWith === 500) return respond(500, { error: { code: "internal", message: "x", fields: [] } });
    const url = new URL(path, "http://x");
    const p = url.pathname.replace(/^\/api/, "");
    if (method === "GET" && p === "/hello") {
      return respond(200, { ok: true, server_version: "0", model_version: "v13.0", defaults_hash: "h", sec_per_week_p50: 0.4, live: true, capabilities: server.capabilities });
    }
    if (method === "GET" && p === "/info") {
      return respond(200, { ...WIRE.info, dunyalarKalici: server.dunyalarKalici, capabilities: server.capabilities });
    }
    if (p === "/dunyalar" || p.startsWith("/dunyalar/")) return dunyaIstegi(method, p, url, body);
    if (method === "POST" && p === "/availability") {
      const b = (body ?? {}) as { values?: unknown; runId?: unknown };
      if (b.values === null || typeof b.values !== "object" || Array.isArray(b.values)) return respond(422, hataGovdesi("invalid_values", "Ayar değerleri bir nesne olmalı.", [{ id: "values", reason: "invalid" }]));
      let kilitli: readonly string[] = [];
      if (b.runId !== undefined) {
        const rr = typeof b.runId === "string" ? runs.get(b.runId) : undefined;
        if (!rr) return respond(404, hataGovdesi("not_found", "Bu koşu bulunamadı."));
        kilitli = (rr.state.settingLocks ?? []).map((l) => l.id);
      }
      const blocked = Object.entries(b.values as Record<string, unknown>).flatMap(([id, raw]) => {
        const sinif = APPLY[id];
        // Koşu bağlamında yalnız canlı kartlar açıktır; başlangıçta doğrulanmamış kart `unverified`, bilinmeyen `locked`.
        const neden = b.runId !== undefined ? (retNedeni(id, kilitli) === "passive" ? "locked" : retNedeni(id, kilitli)) : sinif === "unknown" ? "unverified" : sinif === undefined ? "locked" : null;
        return neden === null ? [] : [{ settingId: id, option: typeof raw === "string" ? raw : JSON.stringify(raw), reason: neden }];
      });
      return respond(200, blocked.length === 0 ? WIRE.availability_ok : { ok: false, scenarioId: null, blocked });
    }
    if (method === "POST" && p === "/runs") {
      if (server.startFailWith === "too_many_runs") return respond(429, WIRE.error_too_many_runs);
      if (server.startFailWith === "busy_preparing") return respond(409, WIRE.error_busy_preparing);
      // Gerçek sunucu gibi: takvim (`schedule`) ve `fastForwardTo` gövdenin üst düzeyindedir; ileri sarma pacer'sız `preparing` ile hesaplanır.
      const b = (body ?? {}) as { config?: RunConfig; schedule?: Takvim; fastForwardTo?: number };
      const cfg = b.config;
      if (cfg === undefined || cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) return respond(422, hataGovdesi("invalid_config", "Koşu ayarları geçersiz.", [{ id: "config", reason: "invalid" }]));
      const bozuk = gecersizYapilandirma(cfg as unknown as Record<string, unknown>);
      if (bozuk.length > 0) return respond(422, hataGovdesi("invalid_config", "Koşu ayarları geçersiz.", bozuk));
      const ff = b.fastForwardTo;
      if (ff !== undefined && (!Number.isInteger(ff) || ff < 0 || ff > cfg.durationWeeks)) return respond(422, WIRE.error_422_branch);
      const sched = [...(b.schedule ?? [])].sort((x, y) => x.week - y.week);
      const st = kurRun(cfg, sched, ff || undefined);
      return respond(201, { runId: st.id, state: runs.get(st.id)!.state });
    }
    if (p === "/jobs" || p.startsWith("/jobs/")) {
      if (server.capabilities.jobs !== true) return respond(404, { error: { code: "not_found", message: "yok", fields: [] } });
      if (method === "POST" && p === "/jobs") {
        if (jobSpec.startFailWith === "job_running" || jobList.some((j) => j.job.status === "queued" || j.job.status === "running")) return respond(409, WIRE.error_job_running);
        const b = (body ?? {}) as Record<string, unknown>;
        if (jobSpec.startFailWith === "invalid_job" || (b.kind !== "seeds" && b.kind !== "ab" && b.kind !== "preview")) return respond(422, WIRE.error_422_job);
        const kind = b.kind as JobKind;
        if (kind === "preview") {            // gerçek `_build`: `fromWeek` tamsayı, koşunun süresinden küçük
          const fw = b.fromWeek ?? 0;
          const sureler = ["base", "draft"].map((k) => ((b[k] as { durationWeeks?: number } | undefined)?.durationWeeks) ?? 200);
          if (typeof fw !== "number" || !Number.isInteger(fw) || fw < 0 || fw > 1000 || sureler.some((d) => typeof d === "number" && fw >= d)) return respond(422, hataGovdesi("invalid_job", "İş isteği geçersiz.", [{ id: "fromWeek", reason: "invalid" }]));
        }
        const jobId = `job-${(jobList.length + 1).toString(16).padStart(8, "0")}`;
        const members: JobMember[] = labelsOf(kind).map((l) => ({ label: l.label, status: "running", seedIndex: l.seedIndex(b), weeks: 2, series: seriesOf(l.seedIndex(b), 2) }));
        const job: Job = { jobId, kind, status: "running", progress: { done: 0, total: members.length * 10 }, members };
        jobList.push({ job, body });
        return respond(201, { jobId });
      }
      const jm = /^\/jobs\/([^/]+)$/.exec(p);
      const hit = jm ? jobById(decodeURIComponent(jm[1]!)) : undefined;
      if (!hit) return respond(404, WIRE.error_404_job);
      if (method === "GET") return respond(200, hit.job);
      if (method === "DELETE") {
        const j = hit.job;
        if (j.status === "queued" || j.status === "running") setJob(j.jobId, (x) => ({ ...x, status: "cancelled", members: x.members.map((m) => (m.status === "done" ? m : { ...m, status: "cancelled" })) }));
        return respond(200, hit.job);
      }
    }
    if (method === "GET" && p === "/runs") return respond(200, [...runs.values()].map((r) => ({ runId: r.id, state: r.state })));
    const dm = /^\/runs\/([^/]+)\/drawer\/([^/]+)\/([^/]+)$/.exec(p);
    if (method === "GET" && dm) {
      const dr = runs.get(decodeURIComponent(dm[1]!));
      if (!dr) return respond(404, WIRE.error_404_drawer);
      const kind = decodeURIComponent(dm[2]!); const ref = decodeURIComponent(dm[3]!); const wk = Number(url.searchParams.get("week"));
      if (!["city", "sector", "firm", "lonca"].includes(kind) || !/^[a-z0-9_-]{1,40}$/.test(ref) || !Number.isInteger(wk) || wk < 1 || wk > dr.state.week) return respond(400, WIRE.error_400_drawer);
      if (kind === "city" && !(/^[0-4]$/.test(ref))) return respond(404, WIRE.error_404_drawer);
      if (kind === "lonca") {
        // Gerçek sunucu (`drawers.py`): çalışırken lonca çekmecesi paketin lonca satırıyla aynı §4.2 alanlarını taze verir.
        const satir = WIRE_PACKET.holdings?.loncas.find((l) => l.ref === ref);
        if (!satir) return respond(404, WIRE.error_404_drawer);
        const alanlar = Object.fromEntries(Object.entries(satir).filter(([k]) => k !== "ref"));
        return respond(200, { kind, ref, week: wk, stale: false, title: `Lonca ${Number(ref.replace("lonca", "")) + 1}`, fields: alanlar });
      }
      if (kind === "firm") return respond(200, { ...WIRE.drawer_firm, ref, week: wk });      // işletme penceresi alanları (product, price, wage_avg, sold_week, profit_hist)
      return respond(200, { ...WIRE.drawer_fresh, kind, ref, week: wk });
    }
    const m = /^\/runs\/([^/]+)(\/[a-z]+(?:\/[a-z]+)?)?$/.exec(p);
    const run = m ? runs.get(decodeURIComponent(m[1]!)) : undefined;
    if (!m || !run) return respond(404, { error: { code: "not_found", message: "yok", fields: [] } });
    const sub = m[2] ?? "";
    if (method === "GET" && sub === "") return respond(200, { runId: run.id, state: run.state });
    if (method === "DELETE" && sub === "") { runs.delete(run.id); return respond(204, null); }
    if (method === "GET" && sub === "/weeks") {
      const from = Number(url.searchParams.get("from")); const to = Number(url.searchParams.get("to"));
      return respond(200, run.packets.slice(0, run.state.week).filter((x) => x.week >= from && x.week <= to));
    }
    if (sub === "/dao/ad" && method === "POST") {
      if (!metinGecerli(b0(body).ad, 1, 30) || typeof b0(body).oyuncu !== "string" || !OYUNCU.test(b0(body).oyuncu as string)) return gecersizAlan("ad");
      const sonuc = sonuclar.get(run.id);
      if (!run.dunya || !sonuc || server.sonucYokSayisi > 0) {
        if (server.sonucYokSayisi > 0) server.sonucYokSayisi -= 1;
        return respond(409, hataGovdesi("sonuc_yok", "Sonuç henüz yazılmadı.", []));
      }
      if (sonuc.oyuncu !== b0(body).oyuncu) return respond(403, hataGovdesi("oyuncu_uyusmuyor", "Bu koşu sana ait değil.", []));
      if (sonuc.ad !== null) return respond(409, hataGovdesi("ad_var", "Ad zaten var.", []));
      sonuc.ad = b0(body).ad as string;
      return respond(200, { ok: true });
    }
    if (sub === "/dao" || sub === "/dao/karar") {
      if (!run.dao) return respond(409, hataGovdesi("dao_degil", "Bu koşu DAO oyunu değil."));
      if (method === "GET" && sub === "/dao") {
        if (server.daoHazirlaniyor) return respond(409, hataGovdesi("hazirlaniyor", "Koşu hazırlanıyor."));
        return respond(200, run.dao.gozlem());
      }
      if (method === "POST" && sub === "/dao/karar") {
        if (server.daoKararBelirsiz) return respond(504, DAO_KARAR.belirsiz_504);
        try {
          const hafta = run.dao.karar(body);
          return respond(202, { ...DAO_KARAR.kabul, hafta: hafta + server.daoHaftaSapmasi });
        } catch (e) {
          if (e instanceof DaoRet) return respond(e.status, hataGovdesi(e.kod, DAO_KARAR.ret_422.error.message, e.fields));
          throw e;
        }
      }
    }
    if (run.dao && (sub === "/changes" || sub === "/branch") && method === "POST") return respond(403, hataGovdesi("dao_kural_degistiremez", "DAO koşusunda kural değiştirilemez."));
    if (method === "POST" && sub === "/branch") {
      if (server.branchFailWith === "too_many_runs") return respond(429, WIRE.error_too_many_runs);
      if (server.branchFailWith === "busy_preparing") return respond(409, WIRE.error_busy_preparing);
      if (server.branchFailWith === "invalid_branch") return respond(422, WIRE.error_422_branch);
      const b = (body ?? {}) as { week?: unknown; patch?: unknown };
      const gecersiz: { id: string; reason: string }[] = [];
      if (!Number.isInteger(b.week) || (b.week as number) < 0 || (b.week as number) >= run.state.durationWeeks) gecersiz.push({ id: "week", reason: "invalid" });
      if (b.patch !== undefined && b.patch !== null && (typeof b.patch !== "object" || Array.isArray(b.patch))) gecersiz.push({ id: "patch", reason: "invalid" });
      if (gecersiz.length > 0) return respond(422, hataGovdesi("invalid_branch", "Dallanma isteği geçersiz.", gecersiz));
      const week = b.week as number;
      const patch = b.patch as Record<string, UIValue> | undefined | null;
      // Dal anlık görüntüdür: ebeveyn tarifinin `week`'e kadarki kısmı (+ yama `week`'te); `week > 0`'da yalnız canlı ayarlar.
      const sched: Takvim = run.schedule.filter((e) => e.week <= week).map((e) => ({ ...e }));
      if (patch && Object.keys(patch).length > 0) {
        if (week > 0) {
          const kilitli = (run.state.settingLocks ?? []).map((l) => l.id);
          const ret = Object.keys(patch).flatMap((id) => { const n = retNedeni(id, kilitli); return n === null ? [] : [{ id, reason: n }]; });
          if (ret.length > 0) return respond(422, hataGovdesi("invalid_branch", "Dallanma isteği geçersiz.", ret));
        }
        sched.push({ week, patch: { ...patch } });
      }
      const st = kurRun(run.config, sched, week || undefined, { parentRunId: run.id, forkWeek: week });
      const child = runs.get(st.id)!;
      child.packets = run.packets.slice(0, week).map((q) => ({ ...q, run_id: st.id }));      // paylaşılan geçmiş ebeveynin paketleridir
      return respond(201, { runId: st.id, state: child.state });
    }
    if (method === "POST" && sub === "/control") {
      const cmd = body as { action: "play" | "pause" | "step" | "olay"; speed?: 1 | 4 | 16 };
      const s = run.state;
      if (s.computing || s.status === "ended" || s.status === "failed") return respond(200, s);
      if (run.dao) {
        // DAO: `step` bir hafta, `olay` yayımlanan gözlemde olay çıkana ya da süre bitene kadar (hepsi anında); her hafta paket yayımlanır.
        const dao = run.dao;
        const bir = (): void => {
          dao.adim();
          const pk = { ...packetOf(run.id, dao.hafta, 1), dao: dao.gozlem(), harita: haritaTel(daoHaritasi(dao.hafta)) as unknown as HaritaVerisi };
          run.packets[dao.hafta - 1] = pk;
          send(run, "week", pk);
        };
        if (cmd.action === "step" || cmd.action === "olay") {
          do bir(); while (cmd.action === "olay" && dao.olaylar.length === 0 && dao.hafta < dao.sure);
        }
        // Gerçek sunucu: `olay` hızı 16'ya çeker ve orada bırakır; açık `speed` her eylemde uygulanır.
        const next: Partial<RunState> = { week: dao.hafta, status: cmd.action === "play" ? "running" : "paused", ...(cmd.action === "olay" ? { speed: 16 as const } : cmd.speed ? { speed: cmd.speed } : {}) };
        if (dao.hafta >= dao.sure) {
          next.status = "ended"; next.endedReason = "duration";
          const out = setState(run, next);
          send(run, "ended", { reason: "duration", week: dao.hafta });
          if (run.dunya) {
            const g = dao.gozlem();
            sonuclar.set(run.id, { kod: run.dunya.kod, runId: run.id, oyuncu: run.dunya.oyuncu, ad: null, dilim: g.ben.servet_dilimi, unvan: g.ben.unvan, isletme: g.gecmis.firmalar.filter((f) => f.ayakta).length, servet: g.ben.nakit + g.ben.mevduat.tutar });
          }
          return respond(200, out);
        }
        return respond(200, setState(run, next));
      }
      const next: Partial<RunState> = cmd.speed ? { speed: cmd.speed } : {};
      if (cmd.action === "pause") next.status = "paused";
      if (cmd.action === "play") next.status = "running";
      if (cmd.action === "step" && s.week < s.durationWeeks) {
        const week = s.week + 1;
        // Gerçek `_publish`: durumun sürümü ve değerleri YAYIMLANAN haftanın paketinden gelir (dikişten önceki haftalar eski sürümde kalır).
        const vs = s.versions ?? [];
        const surum = Math.max(1, ...vs.filter((v) => v.version > 1 && v.fromWeek < week).map((v) => v.version));
        const pk = packetOf(run.id, week, surum, { cities: server.capabilities.city === true, chain: server.capabilities.chain === true, holdings: server.capabilities.city === true, harita: server.capabilities.harita === true, dao: run.dao !== undefined });
        run.packets[week - 1] = pk;
        next.week = week;
        next.status = "paused";
        if (surum !== s.version) { next.version = surum; next.values = vs.find((v) => v.version === surum)?.values ?? s.values; }
        send(run, "week", pk);
        if (week >= s.durationWeeks) {
          next.status = "ended"; next.endedReason = "duration";
          const out = setState(run, next);
          send(run, "ended", { reason: "duration", week });
          return respond(200, out);
        }
      }
      return respond(200, setState(run, next));
    }
    if (method === "POST" && sub === "/changes") {
      const ch = (body ?? {}) as { from?: unknown; patch?: unknown; note?: unknown };
      const gecersiz: { id: string; reason: string }[] = [];
      if (ch.from !== "next_week") gecersiz.push({ id: "from", reason: "invalid" });
      if (ch.patch === null || typeof ch.patch !== "object" || Array.isArray(ch.patch)) gecersiz.push({ id: "patch", reason: "invalid" });
      if (ch.note !== undefined && ch.note !== null && (typeof ch.note !== "string" || ch.note.length > MAX_NOT_UZUNLUK)) gecersiz.push({ id: "note", reason: "invalid" });   // sunucu MAX_NOTE_LEN
      if (gecersiz.length > 0) return respond(422, hataGovdesi("invalid_change", "Değişiklik isteği geçersiz.", gecersiz));
      const patch = ch.patch as Record<string, UIValue>;
      const ids = Object.keys(patch);
      if (run.state.status === "ended") return respond(200, { accepted: false, fields: [{ id: "*", reason: "ended" }] });
      if (ids.length === 0) return respond(200, { accepted: false, fields: [{ id: "*", reason: "invalid" }] });
      // Atomik yama (S1): tek geçersiz ayar bütün yamayı reddeder; ret her geçersiz ayar için neden verir, koşuya dokunulmaz.
      const kilitli = (run.state.settingLocks ?? []).map((l) => l.id);
      const reddedilen = ids.flatMap((id) => { const n = retNedeni(id, kilitli); return n === null ? [] : [{ id, reason: n }]; });
      if (reddedilen.length > 0) return respond(200, { accepted: false, fields: reddedilen });
      const not = typeof ch.note === "string" && ch.note.trim() !== "" ? ch.note.trim() : undefined;
      setState(run, { computing: true });
      await new Promise((r) => setTimeout(r, computeMs));
      const seam = run.state.week;
      const onceki = run.state.versions ?? [{ version: 1, fromWeek: 0, values: run.state.values }];
      if (seam === 0) {                                     // gerçek dikiş 0 (sahte sunucuda önde hesap yok: dikiş = yayımlanan hafta): sürüm artmaz, olay yok (sunucu `_patched` ile aynı kural); not 1. sürüme yazılır
        const values = { ...run.state.values, ...patch };
        const versions = onceki.map((v) => (v.version === 1 ? { ...v, values: { ...v.values, ...patch }, ...(not ? { note: not } : {}) } : v));
        run.schedule.push({ week: 0, patch: { ...patch } });
        setState(run, { computing: false, values, versions });
        return respond(200, { accepted: true, runId: run.id, mode: "live", scenarioId: run.state.scenarioId, seamWeek: 0, version: 1 });
      }
      const version = onceki.length + 1;
      const changes = ids.map((id) => ({ id, from: run.state.values[id] ?? null, to: patch[id]! }));
      const ev: WorldEvent = {
        id: `version:${version}:${seam}:${ids.join("+")}`, week: seam, kind: "neutral", textKey: "event.version",
        params: { hafta: seam, mod: "live", surum: version }, critical: false, sector: null, rule_ids: ids, changes,
      };
      run.versionEvents.push(ev);
      const versions = [...onceki, { version, fromWeek: seam, values: { ...onceki[onceki.length - 1]!.values, ...patch }, ...(not ? { note: not } : {}) }];
      run.schedule.push({ week: seam, patch: { ...patch } });
      run.packets.length = seam;
      setState(run, { computing: false, versions });        // sürüm ve değerler, dikişten sonraki hafta yayımlanınca durumda görünür (gerçek `_publish`)
      send(run, "world_event", ev);
      return respond(200, { accepted: true, runId: run.id, mode: "live", scenarioId: run.state.scenarioId, seamWeek: seam, version });
    }
    return respond(404, { error: { code: "not_found", message: "yok", fields: [] } });
  };

  server.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const path = String(input);
    log.push({ method: init?.method ?? "GET", path, headers, body });
    return handle(init?.method ?? "GET", path, body);
  }) as typeof fetch;
  return server;
}
