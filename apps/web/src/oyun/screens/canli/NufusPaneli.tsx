import { useMemo, type ReactNode } from "react";
import { Table } from "@/components/primitives/Table";
import { t, type CopyKey } from "@/oyun/copy/t";
import { OYUNCU_GRUPLARI } from "@/oyun/sim/sahiplik";
import type { Holdings, WeekPacket, World } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, ondalik, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";
import nufus from "./NufusPaneli.module.css";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; isLive: boolean };

/** Öncelik sırası sunucudaki grup sırasıyla aynıdır (her kişi tek gruba girer); oyuncu grupları `sahiplik.ts`te. */
const NPC_GRUPLARI = ["employed_npc_firm", "employed_player_firm", "municipal", "pool", "dependent", "out", "other"] as const;

const akce = (x: number): string => t("canli.gosterge.akce", { n: sayi(x) });

/** Kalemlerin toplamı; biri bile ölçülmediyse `null` (eksik toplam uydurma sayı verirdi). */
function topla(v: (number | null | undefined)[]): number | null {
  let top = 0;
  for (const x of v) {
    if (!sonlu(x)) return null;
    top += x;
  }
  return top;
}

/**
 * NPC notundaki oran: nakdi yetmeyenler / (işsiz havuz + bakmakla yükümlü + işgücü dışı).
 * Yalnız dört dünya alanından hesaplanır; biri yoksa ya da payda sıfırsa `null`.
 */
export function npcNakitsizOrani(w: World | null): number | null {
  if (!w) return null;
  const payda = topla([w.npc_pool, w.npc_dependents, w.npc_discouraged]);
  if (payda === null || payda <= 0 || !sonlu(w.npc_broke)) return null;
  return w.npc_broke / payda;
}

/** Üç payı 1 ondalığa en büyük kalan yöntemiyle yuvarlar; gösterilen toplam tam %100 olur. Biri eksikse yuvarlama yapılmaz (`null`). */
export function dilimYuvarla(v: (number | null | undefined)[]): (number | null)[] | null {
  if (!v.every(sonlu)) return null;
  const bin = v.map((x) => (x as number) * 1000);
  const taban = bin.map(Math.floor);
  let kalan = Math.round(bin.reduce((a, b) => a + b, 0)) - taban.reduce((a, b) => a + b, 0);
  const sira = bin.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of sira) {
    if (kalan <= 0) break;
    taban[i] = (taban[i] ?? 0) + 1;
    kalan -= 1;
  }
  return taban.map((x) => x / 1000);
}

const kayan = (v: number | null | undefined): number | null => (sonlu(v) ? v : null);

/** Haftalık paketlerden seri: `values[i]` = hafta `i + 1`; paket ya da alan yoksa boşluk. */
function seri(weeks: WeekPacket[], pick: (p: WeekPacket) => number | null | undefined): (number | null)[] {
  const uzun = weeks.reduce((m, p) => Math.max(m, p.week), 0);
  const v: (number | null)[] = Array.from({ length: uzun }, () => null);
  for (const p of weeks) v[p.week - 1] = kayan(pick(p));
  return v;
}

/**
 * Nüfus ve dağılım (PLAN-TAKIP T6): başlıkta oyuncu serveti (sahip serveti, sunucunun hesabı), ikinci bölümde modelin kendi ölçüleri,
 * oyuncu ve NPC grup tabloları. Grup toplamları nüfusa eşittir; kişi kimliği yoktur.
 */
export function NufusPaneli({ weeks, cur, isLive }: Props) {
  const w = cur?.world ?? null;
  const h: Holdings | undefined = cur?.holdings;
  const sahip = h?.wealth;
  const olcek = (id: string, etiket: CopyKey, deger: string) => (
    <div key={id} className={styles.olcu} data-nufus={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
    </div>
  );

  const likit = dilimYuvarla([w?.liquid_b50, w?.liquid_m40, w?.liquid_t10]);
  const seriler = useMemo(() => {
    const sahipSeri: ChartSeries[] = [
      { id: "sahip_t10", labelKey: "canli.nufus.seri.sahip_t10", values: seri(weeks, (p) => p.holdings?.wealth.t10), styleIndex: 0 },
      { id: "sahip_t1", labelKey: "canli.nufus.seri.sahip_t1", values: seri(weeks, (p) => p.holdings?.wealth.t1), styleIndex: 1 },
      { id: "sahip_b50", labelKey: "canli.nufus.seri.sahip_b50", values: seri(weeks, (p) => p.holdings?.wealth.b50), styleIndex: 2 },
    ];
    const modelSeri: ChartSeries[] = [
      { id: "model_top10", labelKey: "canli.nufus.seri.model_top10", values: seri(weeks, (p) => p.world.wealth_top10), styleIndex: 0 },
      { id: "model_top1", labelKey: "canli.nufus.seri.model_top1", values: seri(weeks, (p) => p.world.wealth_top1), styleIndex: 1 },
      { id: "gelir_top10", labelKey: "canli.nufus.seri.gelir_top10", values: seri(weeks, (p) => p.world.income_top10), styleIndex: 2 },
      { id: "gelir_gini", labelKey: "canli.nufus.seri.gelir_gini", values: seri(weeks, (p) => p.world.income_gini), styleIndex: 3 },
      { id: "likit_t10", labelKey: "canli.nufus.seri.likit_t10", values: seri(weeks, (p) => p.world.liquid_t10), styleIndex: 4 },
    ];
    return { sahipSeri, modelSeri };
  }, [weeks]);
  const sahipVar = seriler.sahipSeri.some((s) => s.values.some(sonlu));
  const modelVar = seriler.modelSeri.some((s) => s.values.some(sonlu));

  const oyuncuToplamN = h ? topla(OYUNCU_GRUPLARI.map((g) => h.groups.player[g]?.n)) : null;
  const npcToplamN = h ? topla(NPC_GRUPLARI.map((g) => h.groups.npc[g]?.n)) : null;
  const pay = (n: number | null | undefined, top: number | null) => (sonlu(n) && top !== null && top > 0 ? oran1(n / top) : t("canli.gosterge.olculmuyor"));
  const kisi = (id: string, n: number | null | undefined, top: number | null) => (
    <span data-nufus={id} data-n={sonlu(n) ? n : undefined}>
      {sonlu(n) ? t("canli.nufus.kisi_pay", { n: sayi(n), pay: pay(n, top) }) : t("canli.gosterge.olculmuyor")}
    </span>
  );

  const oyuncuSatirlari = h
    ? [
        ...OYUNCU_GRUPLARI.map((g) => {
          const e = h.groups.player[g];
          return [kisi(`p_${g}`, e?.n, oyuncuToplamN), t(`canli.nufus.grup.p.${g}` as CopyKey), goster(e?.cash, akce), goster(e?.deposits, akce)];
        }),
        [
          kisi("p_toplam", oyuncuToplamN, oyuncuToplamN), t("canli.nufus.toplam"),
          goster(topla(OYUNCU_GRUPLARI.map((g) => h.groups.player[g]?.cash)), akce), goster(topla(OYUNCU_GRUPLARI.map((g) => h.groups.player[g]?.deposits)), akce),
        ],
      ]
    : [];
  const npcSatirlari = h
    ? [
        ...NPC_GRUPLARI.map((g) => {
          const e = h.groups.npc[g];
          const ort = e && sonlu(e.n) && e.n > 0 && sonlu(e.cash) ? e.cash / e.n : null;
          return [kisi(`n_${g}`, e?.n, npcToplamN), t(`canli.nufus.grup.n.${g}` as CopyKey), goster(e?.cash, akce), goster(ort, (x) => t("canli.gosterge.akce", { n: ondalik(1)(x) }))];
        }),
        [
          kisi("n_toplam", npcToplamN, npcToplamN), t("canli.nufus.toplam"),
          goster(topla(NPC_GRUPLARI.map((g) => h.groups.npc[g]?.cash)), akce), null,
        ],
      ]
    : [];
  /** Tablo hücre sırası: ad önce görünür, kişi sütunu ikinci. */
  const sirala = (r: ReactNode[]) => [r[1], r[0], ...r.slice(2)];

  const oyuncuBaslik = t("canli.nufus.oyuncu.baslik");
  const npcBaslik = t("canli.nufus.npc.baslik");
  return (
    <section aria-label={t("canli.nufus.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.nufus.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.nufus.alt")}</p>

      <h3 className={nufus.altBaslik}>{t("canli.nufus.sahip.baslik")}</h3>
      <p className={nufus.tanim}>{t("canli.nufus.sahip.tanim")}</p>
      <dl className={styles.serit}>
        {olcek("sahip_b50", "canli.nufus.sahip.b50", goster(sahip?.b50, oran1))}
        {olcek("sahip_m40", "canli.nufus.sahip.m40", goster(sahip?.m40, oran1))}
        {olcek("sahip_t10", "canli.nufus.sahip.t10", goster(sahip?.t10, oran1))}
        {olcek("sahip_t1", "canli.nufus.sahip.t1", goster(sahip?.t1, oran1))}
        {olcek("sahip_medyan", "canli.nufus.sahip.medyan", goster(sahip?.median, akce))}
        {olcek("sahip_gini", "canli.nufus.sahip.gini", goster(sahip?.gini, ondalik(2)))}
        {olcek("sahip_n", "canli.nufus.sahip.n", goster(sahip?.n, sayi))}
      </dl>
      {sahipVar ? <LineChart titleKey="canli.nufus.sahip.grafik" series={seriler.sahipSeri} yDomain={[0, 1]} /> : null}

      <h3 className={nufus.altBaslik}>{t("canli.nufus.model.baslik")}</h3>
      <p className={nufus.tanim}>{t("canli.nufus.model.tanim")}</p>
      <dl className={styles.serit}>
        {olcek("model_top10", "canli.nufus.model.top10", goster(w?.wealth_top10, oran1))}
        {olcek("model_top1", "canli.nufus.model.top1", goster(w?.wealth_top1, oran1))}
        {olcek("model_medyan", "canli.nufus.model.medyan", goster(w?.wealth_median, akce))}
        {olcek("gelir_gini", "canli.nufus.model.gelir_gini", goster(w?.income_gini, ondalik(2)))}
        {olcek("gelir_top10", "canli.nufus.model.gelir_top10", goster(w?.income_top10, oran1))}
        {olcek("likit_b50", "canli.nufus.model.likit_b50", goster(likit?.[0] ?? w?.liquid_b50, oran1))}
        {olcek("likit_m40", "canli.nufus.model.likit_m40", goster(likit?.[1] ?? w?.liquid_m40, oran1))}
        {olcek("likit_t10", "canli.nufus.model.likit_t10", goster(likit?.[2] ?? w?.liquid_t10, oran1))}
      </dl>
      {modelVar ? <LineChart titleKey="canli.nufus.model.grafik" series={seriler.modelSeri} yDomain={[0, 1]} /> : null}

      {h ? (
        <>
          <h3 className={nufus.altBaslik}>{oyuncuBaslik}</h3>
          <p className={nufus.tanim}>{t("canli.nufus.oyuncu.tanim")}</p>
          <Table
            caption={oyuncuBaslik} columns="even4" minWidth="md" density="compact" align={["start", "end", "end", "end"]}
            header={[t("canli.nufus.kol_grup"), t("canli.nufus.kol_kisi"), t("canli.nufus.kol_nakit"), t("canli.nufus.kol_mevduat")]}
            rows={oyuncuSatirlari.map(sirala)}
          />
          <h3 className={nufus.altBaslik}>{npcBaslik}</h3>
          <p className={nufus.tanim}>{t("canli.nufus.npc.tanim")}</p>
          <Table
            caption={npcBaslik} columns="even4" minWidth="md" density="compact" align={["start", "end", "end", "end"]}
            header={[t("canli.nufus.kol_grup"), t("canli.nufus.kol_kisi"), t("canli.nufus.kol_nakit"), t("canli.nufus.kol_ortalama")]}
            rows={npcSatirlari.map(sirala)}
          />
        </>
      ) : (
        <p className={nufus.tanim}>{t(isLive ? "canli.nufus.olculmuyor.live" : "canli.nufus.olculmuyor")}</p>
      )}
      <dl className={styles.serit}>{olcek("npc_oran", "canli.nufus.npc.not_etiket", goster(npcNakitsizOrani(w), oran1))}</dl>
      <p className={nufus.tanim}>{t("canli.nufus.npc.not")}</p>
    </section>
  );
}
