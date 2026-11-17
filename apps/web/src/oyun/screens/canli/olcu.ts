import { t, type CopyKey } from "@/oyun/copy/t";
import { num, pct } from "@/oyun/lib/format";
import type { World } from "@/oyun/sim/types";

const DASH = "–";
const nf = (digits: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

/** Kayan nokta artığını gidermek için gösterim basamağına yuvarlar. */
const round = (x: number, digits: number): number => Number(x.toFixed(digits));

export type Fark = { yon: "up" | "down" | "flat" | "none"; metin: string };

export type Olcu = {
  id: "karsilama" | "calisan" | "issiz" | "npc" | "oyuncu" | "batan" | "batan_oyuncu" | "kasa" | "gini";
  etiket: CopyKey;
  deger(w: World): number | null;
  goster(v: number | null): string;
  /** Fark gösterimi: ölçekli sayı, basamak ve birim. */
  olcek: number;
  basamak: number;
  /** Kırılım ipucu (fare ve odak başlığı); yoksa ya da ölçülmüyorsa null. */
  ipucu?(w: World): string | null;
  birim: "puan" | "bin" | null;
};

export const OLCULER: readonly Olcu[] = [
  { id: "karsilama", etiket: "canli.sk.karsilama", deger: (w) => w.served, goster: (v) => pct(v, 0), olcek: 100, basamak: 1, birim: "puan" },
  { id: "calisan", etiket: "canli.sk.calisan", deger: (w) => w.employed, goster: num, olcek: 1, basamak: 0, birim: null },
  { id: "issiz", etiket: "canli.sk.issiz", deger: (w) => w.unemployed, goster: num, olcek: 1, basamak: 0, birim: null },
  { id: "npc", etiket: "canli.sk.npc", deger: (w) => w.npc_firms, goster: num, olcek: 1, basamak: 0, birim: null },
  { id: "oyuncu", etiket: "canli.sk.oyuncu", deger: (w) => w.player_firms, goster: num, olcek: 1, basamak: 0, birim: null },
  {
    id: "batan", etiket: "canli.sk.batan", deger: (w) => w.failed_total_cum ?? null, goster: (v) => (v === null ? t("canli.gosterge.olculmuyor") : num(v)), olcek: 1, basamak: 0, birim: null,
    ipucu: (w) => (w.failed_total_cum == null || w.failed_player_cum == null || w.failed_dao_cum == null || w.failed_npc_default_cum == null ? null
      : t("canli.sk.batan.ipucu", { yerlesik: num(w.failed_cum), oyuncu: num(w.failed_player_cum), dao: num(w.failed_dao_cum), temerrut: num(w.failed_npc_default_cum) })),
  },
  { id: "batan_oyuncu", etiket: "canli.sk.batan_oyuncu", deger: (w) => w.failed_player_cum ?? null, goster: (v) => (v === null ? t("canli.gosterge.olculmuyor") : num(v)), olcek: 1, basamak: 0, birim: null },
  { id: "kasa", etiket: "canli.sk.kasa", deger: (w) => w.city_cash_total, goster: (v) => (v === null ? DASH : `${num(v / 1000)} ${t("seri.bin")}`), olcek: 0.001, basamak: 0, birim: "bin" },
  { id: "gini", etiket: "canli.sk.gini", deger: (w) => w.gini, goster: (v) => (v === null || !Number.isFinite(v) ? DASH : nf(2).format(v)), olcek: 1, basamak: 2, birim: null },
];

/** Önceki haftaya fark: işaretli sayı; gösterim basamağında sıfırsa "değişmedi". Ölçülmeyen taraf varsa fark yok. */
export function fark(o: Olcu, cur: number | null, prev: number | null): Fark {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev)) return { yon: "none", metin: t("seri.fark_yok") };
  const d = round((cur - prev) * o.olcek, o.basamak);
  if (d === 0) return { yon: "flat", metin: "0" };
  const sayi = nf(o.basamak).format(Math.abs(d));
  const birim = o.birim === "puan" ? ` ${t("seri.puan")}` : o.birim === "bin" ? ` ${t("seri.bin")}` : "";
  return { yon: d > 0 ? "up" : "down", metin: `${d > 0 ? "+" : "−"}${sayi}${birim}` };
}
