import { useMemo, useState } from "react";
import { Table } from "@/components/primitives/Table";
import { Button } from "@/components/primitives/Button";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import type { CityRow, WeekPacket, World } from "@/oyun/sim/types";
import { LineChart, type ChartMarker, type ChartSeries } from "@/oyun/ui/LineChart";
import { bin, goster, issizOrani, ondalik, oran0, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

/** Seçili şehir (0..4) ya da dünya (`null`) için bir haftalık değer. */
export type Kaynak = { w: World; c: CityRow | null };

export type Gosterge = { id: string; etiket: CopyKey; metin(k: Kaynak): string };

const akce = (x: number) => t("canli.gosterge.akce", { n: sayi(x) });
const haftalikOran = (x: number) => `%${ondalik(2)(x * 100)}`;
export const GOSTERGELER: readonly Gosterge[] = [
  { id: "karsilama", etiket: "canli.gosterge.karsilama", metin: ({ w, c }) => goster(c ? c.served : w.served, oran0) },
  { id: "issiz", etiket: "canli.gosterge.issiz", metin: ({ w }) => goster(w.unemployment_rate_all ?? null, oran0) },      // geniş oran (oyuncu + yerleşik halk); ölçülmüyorsa oyuncu oranına düşmez
  { id: "issiz_oyuncu", etiket: "canli.gosterge.issiz_oyuncu", metin: ({ w, c }) => goster(c ? issizOrani(c.employed, c.unemployed) : (w.unemployment_rate ?? issizOrani(w.employed, w.unemployed)), oran0) },
  { id: "fiyat", etiket: "canli.gosterge.fiyat", metin: ({ w }) => goster(w.price_index, ondalik(1)) },
  { id: "gini", etiket: "canli.gosterge.gini", metin: ({ w }) => goster(w.gini, ondalik(2)) },
  { id: "kasa", etiket: "canli.gosterge.kasa", metin: ({ w, c }) => goster(c ? c.cash : w.city_cash_total, bin) },
  { id: "basim", etiket: "canli.gosterge.basim", metin: ({ w }) => goster(w.minted_total, (x) => akce(x)) },
  { id: "faiz", etiket: "canli.gosterge.faiz", metin: ({ w }) => goster(w.policy_rate, haftalikOran) },
  { id: "kredi", etiket: "canli.gosterge.kredi", metin: ({ w }) => (sonlu(w.loans_granted) && sonlu(w.loans_rejected) ? `${sayi(w.loans_granted)} / ${sayi(w.loans_rejected)}` : goster(null, sayi)) },
  { id: "kredi_faiz", etiket: "canli.gosterge.kredi_faiz", metin: ({ w }) => goster(w.loan_rate_avg, haftalikOran) },
  {
    id: "firmalar", etiket: "canli.gosterge.firmalar",
    metin: ({ w, c }) => {
      const a = c ? c.firms_npc : w.npc_firms;
      const b = c ? c.firms_player : w.player_firms;
      return sonlu(a) && sonlu(b) ? `${sayi(a)} / ${sayi(b)}` : goster(null, sayi);
    },
  },
  { id: "sagkalim", etiket: "canli.gosterge.sagkalim", metin: ({ w }) => goster(w.survival_52, oran0) },
  { id: "destek", etiket: "canli.gosterge.destek", metin: ({ w }) => goster(w.support_weekly, (x) => akce(x)) },
];

/** Hafta `w` -> `values[w - 1]`; kayıt dışı haftalar `null`. */
function sutun(weeks: WeekPacket[], total: number, pick: (p: WeekPacket) => number | null): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: total }, () => null);
  for (const p of weeks) if (p.week >= 1 && p.week <= total) out[p.week - 1] = pick(p);
  return out;
}

/** Grafiğin ve tablonun ortak verisi: karşılama, işsiz oranı, kasa. `sehir` verilirse şehir satırından. */
export function gostergeSerileri(weeks: WeekPacket[], total: number, sehir: number | null) {
  const satir = (p: WeekPacket): CityRow | null => (sehir === null ? null : (p.cities?.find((c) => c.index === sehir) ?? null));
  const karsilama = sutun(weeks, total, (p) => (sehir === null ? p.world.served : (satir(p)?.served ?? null)));
  const issiz = sutun(weeks, total, (p) => {
    if (sehir === null) return p.world.unemployment_rate;
    const c = satir(p);
    return c ? issizOrani(c.employed, c.unemployed) : null;
  });
  const kasa = sutun(weeks, total, (p) => (sehir === null ? p.world.city_cash_total : (satir(p)?.cash ?? null)));
  return { karsilama, issiz, kasa };
}

type Props = {
  weeks: WeekPacket[];
  total: number;
  cur: WeekPacket | null;
  /** Seçili şehir (0..4) ya da `null` (dünya). */
  sehir: number | null;
  sehirAdlari: string[];
  markers: ChartMarker[];
  isLive: boolean;
};

const SON_HAFTA = 10;

/** Göstergeler: değerler (şehir görünümünde şehir değeri), grafik ve aynı verinin tablo karşılığı. */
export function Gostergeler({ weeks, total, cur, sehir, sehirAdlari, markers, isLive }: Props) {
  const [tablo, setTablo] = useState(false);
  const veri = useMemo(() => gostergeSerileri(weeks, total, sehir), [weeks, total, sehir]);
  const olculuyor = veri.issiz.some((v) => v !== null);
  const seriler = useMemo<ChartSeries[]>(() => {
    const s: ChartSeries[] = [{ id: "served", labelKey: "seri.karsilama", values: veri.karsilama, styleIndex: 0 }];
    if (olculuyor) s.push({ id: "unemployment", labelKey: "seri.issiz_orani", values: veri.issiz, styleIndex: 1 });
    return s;
  }, [veri, olculuyor]);
  const satirlar = useMemo(() => {
    const out: string[][] = [];
    for (let h = weeks.length === 0 ? 0 : Math.min(total, weeks[weeks.length - 1]!.week); h >= 1 && out.length < SON_HAFTA; h -= 1) {
      if (!weeks.some((p) => p.week === h)) continue;
      const i = h - 1;
      out.push([String(h), goster(veri.karsilama[i], oran0), goster(veri.issiz[i], oran0), goster(veri.kasa[i], bin)]);
    }
    return out;
  }, [weeks, total, veri]);
  const kaynak: Kaynak | null = cur ? { w: cur.world, c: sehir === null ? null : (cur.cities?.find((c) => c.index === sehir) ?? null) } : null;
  const kapsam = sehir === null ? t("canli.gosterge.kapsam_dunya") : t("canli.gosterge.kapsam_sehir", { ad: cityDisplayName(sehirAdlari[sehir] ?? "", sehir) });
  return (
    <section aria-labelledby="gostergeler" className={styles.bolum}>
      <div className={styles.baslikSatir}>
        <h2 id="gostergeler" className={styles.baslik}>
          {t("canli.gostergeler")}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setTablo(!tablo)}>
          {t(tablo ? "canli.gosterge.grafik_ac" : "canli.gosterge.tablo_ac")}
        </Button>
      </div>
      <p className={styles.kucuk}>{kapsam}</p>
      <dl className={styles.serit} aria-label={t("canli.gosterge.liste")}>
        {GOSTERGELER.map((g) => (
          <div key={g.id} className={styles.olcu} data-gosterge={g.id}>
            <dt className={styles.etiket}>{t(g.etiket)}</dt>
            <dd className={styles.deger}>{kaynak ? g.metin(kaynak) : t("canli.gosterge.olculmuyor")}</dd>
          </div>
        ))}
      </dl>
      {tablo ? (
        <Table
          caption={t("canli.gosterge.tablo_ad")} columns="even4" minWidth="sm" density="compact" align={["start", "end", "end", "end"]}
          header={[t("canli.gosterge.kol_hafta"), t("canli.gosterge.kol_karsilama"), t("canli.gosterge.kol_issiz"), t("canli.gosterge.kol_kasa")]}
          rows={satirlar}
        />
      ) : (
        <LineChart titleKey="canli.grafik" series={seriler} markers={markers} yDomain={[0, 1]} />
      )}
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "seri.issiz_olculmuyor.live" : "seri.issiz_olculmuyor")}</p> : null}
    </section>
  );
}
