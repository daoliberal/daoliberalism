import type { CopyKey } from "@/oyun/copy/t";
import type { WeekPacket, World, WorldEvent } from "./types";

export type EventCtx = { fired: Set<string>; collapseWeek: number | null; recoveryWeek: number | null };
type Params = Record<string, string | number>;
type Rule = {
  id: string;
  kind: WorldEvent["kind"];
  critical: boolean;
  textKey: CopyKey;
  when: (w: number, x: World, ctx: EventCtx) => boolean;
  params: (w: number, x: World) => Params;
};

/** Çöküş kuralı: 26. haftadan sonra talep karşılama ilk kez %50'nin altına iner (olay kuralı ve iş üyeleri özeti tek kaynaktan). */
export const COKUS_ILK_HAFTA = 26;
export const COKUS_ESIK = 0.5;

const num = (v: number | null): number => v ?? 0;
const pct = (v: number | null): number => Math.round(num(v) * 100);
/** Eşiğin altı gösterimi için aşağı yuvarlar (0,697 -> 69). */
const pctBelow = (v: number | null): number => Math.floor(num(v) * 100 + 1e-9);
const ge = (v: number | null, lim: number): boolean => v !== null && v >= lim;
const lt = (v: number | null, lim: number): boolean => v !== null && v < lim;

/** Sıra bağlayıcıdır: aynı haftada tetiklenenler bu sırayla yayılır. */
export const EVENT_RULES: Rule[] = [
  { id: "batis10", kind: "bad", critical: true, textKey: "event.batis10", when: (_w, x) => ge(x.failed_cum, 10), params: (w, x) => ({ hafta: w, sayi: num(x.failed_cum) }) },
  { id: "batis39", kind: "bad", critical: false, textKey: "event.batis39", when: (_w, x) => ge(x.failed_cum, 39), params: (w, x) => ({ hafta: w, sayi: num(x.failed_cum) }) },
  { id: "kredi_ret", kind: "warn", critical: false, textKey: "event.kredi_ret", when: (w, x) => w > 20 && ge(x.loans_rejected, 3), params: (w, x) => ({ hafta: w, sayi: num(x.loans_rejected) }) },
  { id: "karsilama70", kind: "warn", critical: false, textKey: "event.karsilama70", when: (w, x) => w > 26 && lt(x.served, 0.7), params: (w, x) => ({ hafta: w, oran: pctBelow(x.served) }) },
  { id: "cokus", kind: "bad", critical: true, textKey: "event.cokus", when: (w, x) => w > COKUS_ILK_HAFTA && lt(x.served, COKUS_ESIK), params: (w) => ({ hafta: w }) },
  { id: "toparlanma", kind: "good", critical: false, textKey: "event.toparlanma", when: (_w, x, c) => c.fired.has("cokus") && ge(x.served, 0.7), params: (w, x) => ({ hafta: w, oran: pct(x.served) }) },
  { id: "kasa25", kind: "bad", critical: true, textKey: "event.kasa25", when: (w, x) => w > 30 && lt(x.city_cash_total, 25000), params: (w) => ({ hafta: w }) },
  { id: "oyuncu20", kind: "good", critical: false, textKey: "event.oyuncu20", when: (_w, x) => ge(x.player_firms, 20), params: (w, x) => ({ hafta: w, sayi: num(x.player_firms) }) },
  { id: "ozellestirme", kind: "neutral", critical: false, textKey: "event.ozellestirme", when: (_w, x) => x.privatized_firms !== null && x.privatized_firms > 0, params: (w) => ({ hafta: w }) },
  { id: "destek_basladi", kind: "neutral", critical: false, textKey: "event.destek_basladi", when: (_w, x) => x.support_weekly !== null && x.support_weekly > 0, params: (w) => ({ hafta: w }) },
  { id: "katilim_siniri", kind: "neutral", critical: false, textKey: "event.katilim_siniri", when: (_w, x) => typeof x.inflow_blocked === "number" && x.inflow_blocked > 0, params: (w, x) => ({ hafta: w, sayi: num(x.inflow_blocked ?? null) }) },
];

export const newEventCtx = (): EventCtx => ({ fired: new Set(), collapseWeek: null, recoveryWeek: null });

/** Saf kural değerlendirmesi: yalnız `ctx` değişir; her kural bir kez tetiklenir. */
export function detectEvents(_prev: WeekPacket | null, packet: WeekPacket, ctx: EventCtx): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const r of EVENT_RULES) {
    if (ctx.fired.has(r.id) || !r.when(packet.week, packet.world, ctx)) continue;
    ctx.fired.add(r.id);
    if (r.id === "cokus") ctx.collapseWeek = packet.week;
    if (r.id === "toparlanma") ctx.recoveryWeek = packet.week;
    out.push({
      id: `${r.id}:${packet.week}`, week: packet.week, kind: r.kind, textKey: r.textKey,
      params: r.params(packet.week, packet.world), critical: r.critical, sector: null, rule_ids: [r.id],
    });
  }
  return out;
}

/** Dikiş sonrası: `week` dahil o haftaya kadar bağlamı yeniden kurar. */
export function eventCtxUpTo(packets: WeekPacket[], week: number): EventCtx {
  const ctx = newEventCtx();
  let prev: WeekPacket | null = null;
  for (const p of packets) {
    if (p.week > week) break;
    detectEvents(prev, p, ctx);
    prev = p;
  }
  return ctx;
}

/**
 * "İlk kritik olay" tek kaynaktan: kritik olaylar yalnız `EVENT_RULES`'taki `critical: true` kurallardan doğar (sürüm olayları kritik değildir).
 * Rehberli ilk oyun (W12) ve atlama bu tanımı kullanır; kayıt ve canlı kaynakta aynıdır.
 */
export const kritikOlayMi = (e: WorldEvent): boolean => e.critical;
export function ilkKritikOlay(events: readonly WorldEvent[]): WorldEvent | null {
  return events.find(kritikOlayMi) ?? null;
}
