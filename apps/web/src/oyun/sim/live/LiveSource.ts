import type { CopyKey } from "@/oyun/copy/t";
import { SIM_NOT_FOUND, SimUnsupported } from "../SimSource";
import type { DunyaDetay, DunyaOzet, DunyaSkorSatiri } from "../types";
import type { DaoGozlem, DaoKarar, DaoKararSonucu } from "../dao";
import { detectEvents, newEventCtx, type EventCtx } from "../eventRules";
import type {
  Availability, Capabilities, ChangeResult, DrawerData, Job, JobSpec, RunConfig, RunHandle, RunState, SimEvent, SimSource, SourceInfo, Speed, ValuesPatch, WeekPacket, WorldEvent, WorldPlan,
} from "../types";
import {
  REQUEST_HEADERS, WireError, apiUrl, parseAvailability, parseChange, parseDaoYaniti, parseDrawer, parseEnded, parseEventOrNull, parseHandle, parseHandles, parseInfo, parseJob, parseJobId, parsePacket, parsePackets,
  parseDunyaDetay, parseDunyaOzetler, parseDunyaSkor, parseDunyaYayin, parseServerError, parseState, parseWorldPlan,
} from "./wire";

export type LiveOptions = { baseUrl: string; fetchImpl?: typeof fetch; eventSourceImpl?: typeof EventSource };

const NO_CAPS: Capabilities = { branch: false, seeds: false, compare: false, library: false, city: false, chain: false };
const YOK: CopyKey = "hata.sunucu_yok";
const BOZUK: CopyKey = "hata.sunucu_bozuk";
const NOT_FOUND: CopyKey = "hata.kosu_bulunamadi";
const CLOSED = 2; // EventSource.CLOSED (sahte uygulamalarda sabit olmayabilir)
/** Akış kalıcı kapanınca koşuyu yoklama aralıkları (ms); sonuncusu sürekli tekrarlanır. */
const RETRY_MS = [500, 1000, 2000, 5000] as const;

type Listener = (e: SimEvent) => void;
/** Koşu başına bellek önbelleği ve tek paylaşılan akış. */
type Entry = {
  /** Sunucudaki güncel koşu kimliği (kabul edilen değişiklik kimliği değiştirirse güncellenir). */
  id: string;
  state: RunState | null;
  weeks: Map<number, WeekPacket>;
  /** Sunucudan gelen olaylar (sürüm olayları). Kural olayları paketlerin `events` alanında taşınır. */
  events: WorldEvent[];
  /** Kural olayı bağlamı: `weeks` içindeki en son sıralı paketlere kadar kurulu. */
  ctx: EventCtx;
  listeners: Set<Listener>;
  stream: EventSource | null;
  endedSent: boolean;
  outage: boolean;
  /** Akış kapanınca koşu yoklama döngüsü sürüyor. */
  recovering: boolean;
  /** Bekleyen yoklama zamanlayıcısı ve onu uyandıran işlev. */
  retryTimer: ReturnType<typeof setTimeout> | null;
  wake: (() => void) | null;
  /** Sunucuda koşu yok (404): bir daha akış açılmaz, tek `hata.kosu_bulunamadi` bildirilmiştir. */
  lost: boolean;
  /** Sunucudan ilk durum henüz gelmedi (bilinmeyen kimlikle abonelik). */
  resolving: boolean;
};

type Reply = { status: number; json: unknown };

const keyOf = (e: unknown): CopyKey => (e instanceof SimUnsupported && e.message === YOK ? YOK : BOZUK);

export function createLiveSource(opts: LiveOptions): SimSource {
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const makeStream = (url: string): EventSource => (opts.eventSourceImpl ? new opts.eventSourceImpl(url) : new EventSource(url));
  const byId = new Map<string, Entry>();
  let disposed = false;

  const guard = (): void => {
    if (disposed) throw new SimUnsupported("disposed");
  };

  /** Ağ hatası `hata.sunucu_yok`, 5xx ve okunamayan gövde `hata.sunucu_bozuk` ile `SimUnsupported`. 4xx çağırana döner. */
  /** `govdeli504`: 504 yanıtın gövdesi okunur (DAO `karar_belirsiz`); öbür 5xx her zaman `hata.sunucu_bozuk`. */
  async function call(method: string, path: string, body?: unknown, govdeli504 = false): Promise<Reply> {
    guard();
    let res: Response;
    try {
      res = await doFetch(apiUrl(opts.baseUrl, path), {
        method,
        headers: body === undefined ? REQUEST_HEADERS : { ...REQUEST_HEADERS, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      guard();
      throw new SimUnsupported(YOK);
    }
    guard();
    if (res.status >= 500 && !(govdeli504 && res.status === 504)) throw new SimUnsupported(BOZUK);
    if (res.status === 204) return { status: 204, json: null };
    let json: unknown = null;
    try {
      const text = await res.text();
      json = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      if (res.ok) throw new SimUnsupported(BOZUK);
    }
    guard();
    return { status: res.status, json };
  }

  /** Gövdeyi ayrıştırır; bozuksa `hata.sunucu_bozuk`. */
  function parsed<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof WireError) throw new SimUnsupported(BOZUK);
      throw e;
    }
  }
  const okBody = (r: Reply): unknown => {
    if (r.status < 200 || r.status >= 300) throw new SimUnsupported(BOZUK);
    return r.json;
  };
  const enc = encodeURIComponent;
  /** DAO uç noktalarının 4xx yanıtı: iletisi sunucunun hata kodu olan `SimUnsupported` (404 `unknown_run`). */
  const daoHatasi = (r: Reply): SimUnsupported => {
    const code = (r.json as { error?: { code?: unknown } } | null)?.error?.code;
    if (r.status === 404 && code !== "dunya_yok") return new SimUnsupported("unknown_run");
    const fields = (r.json as { error?: { fields?: unknown } } | null)?.error?.fields;
    const alanlar = Array.isArray(fields)
      ? fields.flatMap((f): { id: string; reason: string }[] => {
          const o = f as { id?: unknown; reason?: unknown } | null;
          return o !== null && typeof o === "object" && typeof o.id === "string" && typeof o.reason === "string" ? [{ id: o.id, reason: o.reason }] : [];
        })
      : [];
    return new SimUnsupported(typeof code === "string" && code !== "" ? code : BOZUK, alanlar);
  };

  const newEntry = (id: string, state: RunState | null): Entry => ({
    id, state, weeks: new Map(), events: [], ctx: newEventCtx(), listeners: new Set(), stream: null, endedSent: false, outage: false, recovering: false, retryTimer: null, wake: null, lost: false,
    resolving: state === null,
  });
  /** Var olan girdi korunur (önbellek, aboneler); yeni durum yazılır. */
  function remember(id: string, state: RunState): Entry {
    const have = byId.get(id);
    if (have) {
      have.state = state;
      have.resolving = false;
      return have;
    }
    const e = newEntry(id, state);
    byId.set(id, e);
    return e;
  }

  const sortedWeeks = (entry: Entry): WeekPacket[] => [...entry.weeks.values()].sort((a, b) => a.week - b.week);
  const lastWeekOf = (entry: Entry): number => {
    let m = 0;
    for (const w of entry.weeks.keys()) if (w > m) m = w;
    return m;
  };
  const eventIdsOf = (entry: Entry): Set<string> => new Set([...entry.weeks.values()].flatMap((p) => p.events.map((e) => e.id)));

  /** Önbellekteki bütün haftalardan kural olaylarını ve bağlamı baştan kurar (olaylar paketlerin `events` alanına yazılır). */
  function reannotate(entry: Entry): void {
    const ctx = newEventCtx();
    let prev: WeekPacket | null = null;
    for (const p of sortedWeeks(entry)) {
      const next: WeekPacket = { ...p, events: detectEvents(prev, p, ctx) };
      entry.weeks.set(p.week, next);
      prev = next;
    }
    entry.ctx = ctx;
  }

  /** Yeni ya da daha yüksek sürümlü paketi önbelleğe alır, olaylarını bulur ve yayımlar. */
  function acceptWeek(entry: Entry, p: WeekPacket): void {
    // Daha yüksek sürümle yeniden hesaplanan haftadan sonraki eski sürüm haftalar bayattır.
    for (const [w, q] of [...entry.weeks]) if (w > p.week && q.version < p.version) entry.weeks.delete(w);
    let fresh: WorldEvent[];
    let stored: WeekPacket;
    if (!entry.weeks.has(p.week) && p.week > lastWeekOf(entry)) {
      // Olağan akış: sıradaki hafta, bağlam artımlı ilerler.
      stored = { ...p, events: detectEvents(entry.weeks.get(p.week - 1) ?? null, p, entry.ctx) };
      entry.weeks.set(p.week, stored);
      fresh = stored.events;
    } else {
      // Sıra dışı ya da yeniden hesaplanmış hafta: bağlam ve olaylar baştan kurulur, yalnız yeni kimlikler yayımlanır.
      const known = eventIdsOf(entry);
      entry.weeks.set(p.week, p);
      reannotate(entry);
      stored = entry.weeks.get(p.week)!;
      fresh = sortedWeeks(entry).flatMap((q) => q.events).filter((e) => !known.has(e.id));
    }
    emit(entry, { type: "week", packet: stored });
    for (const ev of fresh) emit(entry, { type: "world_event", event: ev });
  }

  const emit = (entry: Entry, e: SimEvent): void => {
    for (const l of [...entry.listeners]) {
      try {
        l(e);
      } catch {
        // dinleyici hatası akışı bozmaz
      }
    }
  };
  const emitError = (entry: Entry, key: CopyKey): void => emit(entry, { type: "error", messageKey: key });

  function onMessage(entry: Entry, type: string, data: string): void {
    entry.outage = false;
    let raw: unknown;
    try {
      raw = JSON.parse(data) as unknown;
    } catch {
      emitError(entry, BOZUK);
      return;
    }
    try {
      switch (type) {
        case "state": {
          const s = parseState(raw);
          entry.state = s;
          emit(entry, { type: "state", state: s });
          return;
        }
        case "week": {
          const p = parsePacket(raw);
          const have = entry.weeks.get(p.week);
          if (have && have.version >= p.version) return; // yeniden bağlanmada tekrar gelen geçmiş
          acceptWeek(entry, p);
          return;
        }
        case "world_event": {
          const ev = parseEventOrNull(raw);
          if (!ev) return; // bu istemcide metni olmayan olay (DK-15): sessizce düşer
          if (entry.events.some((x) => x.id === ev.id)) return;
          entry.events.push(ev);
          emit(entry, { type: "world_event", event: ev });
          return;
        }
        case "ended": {
          const d = parseEnded(raw);
          if (entry.endedSent) return;
          entry.endedSent = true;
          emit(entry, { type: "ended", reason: d.reason, week: d.week });
          closeStream(entry); // bitmiş koşuda akış kalmaz: sunucu keserse sahte kesinti hatası ve yeniden bağlanma döngüsü olmaz
          return;
        }
        case "error":
          emitError(entry, parseServerError(raw));
          return;
      }
    } catch (e) {
      if (!(e instanceof WireError)) throw e;
      emitError(entry, BOZUK);
    }
  }

  function cancelRetry(entry: Entry): void {
    if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    const w = entry.wake;
    entry.wake = null;
    w?.();
  }

  /** Koşu sunucuda yok: tek `hata.kosu_bulunamadi`, kayıt unutulur, akış/yoklama durur. */
  function lose(entry: Entry): void {
    if (entry.lost) return;
    entry.lost = true;
    for (const [k, v] of [...byId]) if (v === entry) byId.delete(k);
    closeStream(entry);
    emitError(entry, NOT_FOUND);
  }

  /** Kesinti başına tek bildirim (bağlantı kopması ve komut hatası aynı bayrağı paylaşır). */
  function outageError(entry: Entry, key: CopyKey): void {
    if (key === YOK) {
      if (entry.outage) return;
      entry.outage = true;
    }
    emitError(entry, key);
  }

  /**
   * Akış kalıcı kapandı (örn. sunucu yeniden başladı ve koşu kayboldu): koşu sunucuya sorulur. 404 -> koşu kayıp; 2xx -> akış yeniden
   * açılır (geçmiş tekrar gelir, tekilleşir); ağ/5xx -> tek bildirim ve geri çekilmeyle yeniden dene.
   */
  async function recover(entry: Entry): Promise<void> {
    if (entry.recovering || entry.lost) return;
    entry.recovering = true;
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (disposed || entry.lost || entry.listeners.size === 0) return;
        try {
          const r = await call("GET", `/runs/${enc(entry.id)}`);
          if (disposed || entry.lost || entry.listeners.size === 0) return;
          if (r.status === 404) {
            lose(entry);
            return;
          }
          parsed(() => parseHandle(okBody(r)));
          openStream(entry);
          return;
        } catch (e) {
          if (disposed) return;
          outageError(entry, keyOf(e));
        }
        await new Promise<void>((resolve) => {
          entry.wake = resolve;
          entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null;
            entry.wake = null;
            resolve();
          }, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
        });
      }
    } finally {
      entry.recovering = false;
    }
  }

  /** `control` hatası dinleyiciden gizlenmez: ağ/5xx ve koşu-yok bildirilir (SaatCubugu hatayı yutar). */
  function notify(entry: Entry | undefined, e: unknown): void {
    if (!entry || disposed || !(e instanceof SimUnsupported)) return;
    if (e.message === "unknown_run") lose(entry);
    else if (e.message === YOK || e.message === BOZUK) outageError(entry, e.message);
  }

  function closeStream(entry: Entry): void {
    cancelRetry(entry);
    const s = entry.stream;
    entry.stream = null;
    try {
      s?.close();
    } catch {
      // zaten kapalı
    }
  }

  function openStream(entry: Entry): void {
    if (disposed || entry.stream || entry.resolving || entry.endedSent || entry.listeners.size === 0) return;
    let s: EventSource;
    try {
      s = makeStream(apiUrl(opts.baseUrl, `/runs/${enc(entry.id)}/events`));
    } catch {
      emitError(entry, YOK);
      return;
    }
    entry.stream = s;
    for (const type of ["state", "week", "world_event", "ended"]) {
      s.addEventListener(type, (ev) => onMessage(entry, type, String((ev as MessageEvent).data)));
    }
    // "error" adı hem sunucu olayı (veri taşır) hem bağlantı hatası (veri yok) için kullanılır.
    s.addEventListener("error", (ev) => {
      if (entry.stream !== s) return;
      const data = (ev as MessageEvent).data as unknown;
      if (typeof data === "string") {
        onMessage(entry, "error", data);
        return;
      }
      if (s.readyState === CLOSED) {
        entry.stream = null;
        void recover(entry);
      } else if (!entry.outage) {
        entry.outage = true; // tarayıcı kendiliğinden yeniden bağlanır; kesinti başına tek bildirim
        emitError(entry, YOK);
      }
    });
  }

  function replay(entry: Entry, l: Listener): void {
    const safe = (e: SimEvent): void => {
      try {
        l(e);
      } catch {
        // dinleyici hatası akışı bozmaz
      }
    };
    if (entry.state) safe({ type: "state", state: entry.state });
    for (const p of sortedWeeks(entry)) safe({ type: "week", packet: p });
    for (const ev of entry.events) safe({ type: "world_event", event: ev });
  }

  /** Bu kaynağın açmadığı bir koşu: sunucuya sorulur; yoksa tek `error`. */
  async function resolveUnknown(id: string, entry: Entry): Promise<void> {
    try {
      const r = await call("GET", `/runs/${enc(id)}`);
      if (r.status === 404) {
        byId.delete(id);
        emitError(entry, NOT_FOUND);
        entry.listeners.clear();
        return;
      }
      const h = parsed(() => parseHandle(okBody(r)));
      entry.id = h.runId;
      entry.state = h.state;
      entry.resolving = false;
      if (h.runId !== id) byId.set(h.runId, entry);
      for (const l of [...entry.listeners]) replay(entry, l);
      openStream(entry);
    } catch (e) {
      if (disposed) return;
      byId.delete(id);
      emitError(entry, keyOf(e));
      entry.listeners.clear();
    }
  }

  async function startRun(config: RunConfig): Promise<RunHandle> {
    // Sunucu takvimi ve ileri sarmayı gövdenin üst düzeyinde okur (`config` içinde değil).
    const { schedule, fastForwardTo, ...cfg } = config;
    const r = await call("POST", "/runs", {
      config: cfg,
      ...(schedule !== undefined && schedule.length > 0 ? { schedule } : {}),
      ...(fastForwardTo !== undefined ? { fastForwardTo } : {}),
    });
    if (r.status === 400 || r.status === 422) {
      const f = (r.json as { error?: { fields?: unknown } } | null)?.error?.fields;
      throw new SimUnsupported(Array.isArray(f) && f.some((x) => (x as { reason?: unknown } | null)?.reason === "too_big") ? "too_big" : "invalid"); // D4: nüfus üst sınırı
    }
    // Sınır ve meşguliyet: gövdedeki `error.code` esastır; kod yoksa HTTP durumuna bakılır.
    const body = r.json as { error?: { code?: unknown } } | null;
    const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
    if (code === "too_many_runs" || (code === undefined && r.status === 429)) throw new SimUnsupported("too_many_runs");
    if (code === "busy_preparing" || (code === undefined && r.status === 409)) throw new SimUnsupported("busy_preparing");
    const h = parsed(() => parseHandle(okBody(r)));
    remember(h.runId, h.state);
    return h;
  }

  return {
    kind: "live",
    capabilities: NO_CAPS,

    async info(): Promise<SourceInfo> {
      const r = await call("GET", "/info");
      return parsed(() => parseInfo(okBody(r)));
    },

    async availability(values: ValuesPatch, runId?: string): Promise<Availability> {
      const r = await call("POST", "/availability", runId === undefined ? { values } : { values, runId });
      return parsed(() => parseAvailability(okBody(r)));
    },

    start: startRun,

    async open(runId: string, rebuild?: RunConfig): Promise<RunHandle | null> {
      guard();
      let r: Reply;
      try {
        r = await call("GET", `/runs/${enc(runId)}`);
      } catch (e) {
        if (disposed || rebuild !== undefined) throw e; // tarifle açmada neden gizlenmez
        return null; // açma hata fırlatmaz
      }
      // Sunucu bu kimliği tanımıyor (yeniden başlamış ya da koşu atılmış): tarif varsa aynı tarifle yeniden kurulur (DK-11).
      if (r.status === 404) return rebuild === undefined ? null : startRun(rebuild);
      let h: RunHandle;
      try {
        h = parseHandle(okBody(r));
      } catch {
        return null;
      }
      const entry = remember(h.runId, h.state);
      if (runId !== h.runId) byId.set(runId, entry);
      return h;
    },

    subscribe(runId: string, listener: (e: SimEvent) => void): () => void {
      if (disposed) return () => undefined;
      const sub: Listener = (e) => listener(e);
      let entry = byId.get(runId);
      const fresh = !entry;
      if (!entry) {
        entry = newEntry(runId, null);
        byId.set(runId, entry);
      }
      const e = entry;
      e.listeners.add(sub);
      if (fresh) void resolveUnknown(runId, e);
      else if (!e.resolving) {
        replay(e, sub);
        openStream(e);
      }
      return () => {
        if (!e.listeners.delete(sub)) return;
        if (e.listeners.size === 0) closeStream(e);
      };
    },

    async control(runId: string, cmd: { action: "play" | "pause" | "step" | "olay"; speed?: Speed }): Promise<RunState> {
      const entry = byId.get(runId);
      try {
        const r = await call("POST", `/runs/${enc(entry?.id ?? runId)}/control`, cmd);
        if (r.status === 404) throw new SimUnsupported("unknown_run");
        const s = parsed(() => parseState(okBody(r)));
        if (entry && !entry.stream) entry.state = s; // akış açıksa durumun sahibi akıştır
        return s;
      } catch (e) {
        notify(entry, e);
        throw e;
      }
    },

    async daoGozlem(runId: string): Promise<DaoGozlem> {
      const entry = byId.get(runId);
      const r = await call("GET", `/runs/${enc(entry?.id ?? runId)}/dao`);
      if (r.status >= 400) throw daoHatasi(r);
      return parsed(() => parseDaoYaniti(okBody(r)));
    },

    async daoKarar(runId: string, karar: DaoKarar): Promise<DaoKararSonucu> {
      const entry = byId.get(runId);
      const r = await call("POST", `/runs/${enc(entry?.id ?? runId)}/dao/karar`, karar, true);
      if (r.status === 504 && typeof (r.json as { error?: { code?: unknown } } | null)?.error?.code !== "string") throw new SimUnsupported("karar_belirsiz"); // vekil/ağ geçidi zaman aşımı: karar uygulanmış olabilir
      if (r.status >= 400) throw daoHatasi(r);
      const o = r.json as { kabul?: unknown; hafta?: unknown } | null;
      if (o === null || typeof o !== "object" || o.kabul !== true || typeof o.hafta !== "number" || !Number.isInteger(o.hafta)) throw new SimUnsupported(BOZUK);
      return { kabul: true, hafta: o.hafta };
    },

    sunucuKoku(): string {
      return new URL(opts.baseUrl === "" ? "/" : opts.baseUrl, typeof window === "undefined" ? "http://127.0.0.1" : window.location.origin).origin;
    },

    async daoAd(runId: string, ad: string, oyuncu: string): Promise<void> {
      const entry = byId.get(runId);
      const r = await call("POST", `/runs/${enc(entry?.id ?? runId)}/dao/ad`, { ad, oyuncu });
      if (r.status >= 400) throw daoHatasi(r);
      if (r.status >= 300) throw new SimUnsupported(BOZUK);
    },

    async dunyaYayinla(tarif: unknown, ad: string, aciklama: string, oyuncu: string): Promise<{ kod: string; baglanti: string }> {
      const r = await call("POST", "/dunyalar", { tarif, ad, aciklama, oyuncu });
      if (r.status >= 400) throw daoHatasi(r);
      return parsed(() => parseDunyaYayin(okBody(r)));
    },

    async dunyalarim(oyuncu: string): Promise<DunyaOzet[]> {
      const r = await call("GET", `/dunyalar?kurucu=${enc(oyuncu)}`);
      if (r.status >= 400) throw daoHatasi(r);
      return parsed(() => parseDunyaOzetler(okBody(r)));
    },

    async dunyaGetir(kod: string): Promise<DunyaDetay> {
      const r = await call("GET", `/dunyalar/${enc(kod)}`);
      if (r.status >= 400) throw daoHatasi(r);
      return parsed(() => parseDunyaDetay(okBody(r)));
    },

    async dunyaSkor(kod: string): Promise<DunyaSkorSatiri[]> {
      const r = await call("GET", `/dunyalar/${enc(kod)}/skor`);
      if (r.status >= 400) throw daoHatasi(r);
      return parsed(() => parseDunyaSkor(okBody(r)));
    },

    async dunyaOyna(kod: string, oyuncu: string): Promise<{ runId: string }> {
      const r = await call("POST", `/dunyalar/${enc(kod)}/oyna`, { oyuncu });
      if (r.status >= 400) throw daoHatasi(r);
      const o = okBody(r) as { runId?: unknown } | null;
      if (o === null || typeof o !== "object" || typeof o.runId !== "string") throw new SimUnsupported(BOZUK);
      return { runId: o.runId };
    },

    async applyChange(runId: string, change: { from: "next_week"; patch: ValuesPatch; note?: string }): Promise<ChangeResult> {
      const entry = byId.get(runId);
      const r = await call("POST", `/runs/${enc(entry?.id ?? runId)}/changes`, change);
      if (r.status === 404) throw new SimUnsupported("unknown_run");
      if (r.status >= 300 && !(r.status >= 400 && r.status < 500)) throw new SimUnsupported(BOZUK);
      const res = parsed(() => parseChange(r.json));
      if (res.accepted && entry) {
        if (res.runId !== entry.id) {
          entry.id = res.runId;
          byId.set(res.runId, entry);
        }
        // Dikişten sonrası eski sürümdür: haftalar, sürüm olayları, bitiş işareti ve olay bağlamı budanır.
        for (const w of [...entry.weeks.keys()]) if (w > res.seamWeek) entry.weeks.delete(w);
        entry.events = entry.events.filter((ev) => ev.week <= res.seamWeek);
        entry.endedSent = false;
        reannotate(entry);
        if (!entry.stream) openStream(entry); // bitişte kapanmış akış yeni sürüm için yeniden açılır
      }
      return res;
    },

    async weeks(runId: string, from: number, to: number): Promise<WeekPacket[]> {
      const entry = byId.get(runId);
      const r = await call("GET", `/runs/${enc(entry?.id ?? runId)}/weeks?from=${from}&to=${to}`);
      if (r.status === 404) throw new SimUnsupported("unknown_run");
      return parsed(() => parsePackets(okBody(r)));
    },

    async drawer(runId: string, kind: string, ref: string, week: number): Promise<DrawerData> {
      const entry = byId.get(runId);
      const r = await call("GET", `/runs/${enc(entry?.id ?? runId)}/drawer/${enc(kind)}/${enc(ref)}?week=${week}`);
      if (r.status === 404) throw new SimUnsupported(SIM_NOT_FOUND);
      if (r.status === 400) throw new SimUnsupported("invalid_drawer");
      return parsed(() => parseDrawer(okBody(r)));
    },

    async branch(runId: string, week: number, patch?: ValuesPatch): Promise<RunHandle> {
      const entry = byId.get(runId);
      const r = await call("POST", `/runs/${enc(entry?.id ?? runId)}/branch`, patch === undefined ? { week } : { week, patch });
      if (r.status === 404) throw new SimUnsupported("unknown_run");
      const body = r.json as { error?: { code?: unknown } } | null;
      const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
      if (code === "too_many_runs" || (code === undefined && r.status === 429)) throw new SimUnsupported("too_many_runs");
      if (code === "busy_preparing" || (code === undefined && r.status === 409)) throw new SimUnsupported("busy_preparing");
      if (code === "invalid_branch" || r.status === 400 || r.status === 422) throw new SimUnsupported("invalid_branch");
      const h = parsed(() => parseHandle(okBody(r)));
      remember(h.runId, h.state);
      return h;
    },

    async listRuns(): Promise<RunHandle[]> {
      const r = await call("GET", "/runs");
      return parsed(() => parseHandles(okBody(r)));
    },

    async discard(runId: string): Promise<void> {
      const entry = byId.get(runId);
      const r = await call("DELETE", `/runs/${enc(entry?.id ?? runId)}`);
      if (r.status === 404) return;
      if (r.status < 200 || r.status >= 300) throw new SimUnsupported(BOZUK);
      if (entry) {
        closeStream(entry);
        entry.listeners.clear();
        entry.lost = true; // sunucuda yok: yoklama ve yeniden bağlanma olmaz
        for (const [k, v] of [...byId]) if (v === entry) byId.delete(k);
      }
    },

    async startJob(spec: JobSpec): Promise<string> {
      const r = await call("POST", "/jobs", spec);
      const code = (r.json as { error?: { code?: unknown } } | null)?.error?.code;
      if (r.status === 409 || code === "job_running") throw new SimUnsupported("job_running");
      if (r.status === 422 || code === "invalid_job") throw new SimUnsupported("invalid_job");
      return parsed(() => parseJobId(okBody(r)));
    },

    async worldPlan(config: RunConfig): Promise<WorldPlan> {
      const cfg: RunConfig = { ...config };        // plan yalnız kuruluşu hesaplar: takvim ve ileri sarma gönderilmez
      delete cfg.schedule;
      delete cfg.fastForwardTo;
      const r = await call("POST", "/world/plan", { config: cfg });
      if (r.status === 400 || r.status === 422) throw new SimUnsupported("invalid");
      return parsed(() => parseWorldPlan(okBody(r)));
    },

    async job(id: string): Promise<Job> {
      const r = await call("GET", `/jobs/${enc(id)}`);
      if (r.status === 404) throw new SimUnsupported("unknown_job");
      return parsed(() => parseJob(okBody(r)));
    },

    async cancelJob(id: string): Promise<Job> {
      const r = await call("DELETE", `/jobs/${enc(id)}`);
      if (r.status === 404) throw new SimUnsupported("unknown_job");
      return parsed(() => parseJob(okBody(r)));
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of new Set(byId.values())) {
        closeStream(entry);
        entry.listeners.clear();
      }
      byId.clear();
    },
  };
}
