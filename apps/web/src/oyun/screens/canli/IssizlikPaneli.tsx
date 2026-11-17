import { useMemo } from "react";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import type { CityRow, WeekPacket, World } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, issizOrani, ondalik, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

const IZ = 13;
const akce = (x: number) => t("canli.gosterge.akce", { n: sayi(x) });

/** Bir haftanın değerleri: şehir seçiliyse şehir satırından gelenler şehir değeri, ötekiler dünya değeridir. */
type Deger = { oyuncuOran: number | null; oyuncuSayi: number | null; havuz: number | null; tuketemeyen: number | null; toplam: number | null };

function degerler(w: World, c: CityRow | null): Deger {
  if (c) {
    const havuz = c.npc_pool ?? null;
    const paydaOk = sonlu(havuz) && c.employed + c.unemployed + havuz > 0;
    return {
      oyuncuOran: issizOrani(c.employed, c.unemployed), oyuncuSayi: c.players_seeking ?? c.unemployed, havuz, tuketemeyen: c.npc_broke ?? null,
      toplam: paydaOk ? (c.unemployed + havuz) / (c.employed + c.unemployed + havuz) : null,
    };
  }
  return {
    oyuncuOran: w.unemployment_rate ?? issizOrani(w.employed, w.unemployed), oyuncuSayi: w.players_seeking ?? w.unemployed, havuz: w.npc_pool ?? null,
    tuketemeyen: w.npc_broke ?? null, toplam: w.unemployment_rate_all ?? null,
  };
}

const kayan = (v: number | null | undefined): number | null => (sonlu(v) ? v : null);
/** 13 hafta önceye göre eğilim işareti; karşılaştırma değeri yoksa eğilim yok. Renk tek başına anlam taşımaz. */
function egilim(cur: number | null, onceki: number | null): "▲" | "▼" | "=" | null {
  if (!sonlu(cur) || !sonlu(onceki)) return null;
  const esik = Math.abs(onceki) * 0.01;
  if (cur > onceki + esik) return "▲";
  if (cur < onceki - esik) return "▼";
  return "=";
}
const EGILIM_AD = { "▲": "seri.artis", "▼": "seri.dusus", "=": "seri.sabit" } as const;

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; sehir: number | null; sehirAdlari: string[]; isLive: boolean };

/** İşsizlik ve NPC havuzu: oyuncu işsizliği (iş arayan oyuncular), havuzdaki işsiz NPC'ler, tüketemeyen NPC'ler ve toplam işsizlik ayrı ayrı gösterilir. */
export function IssizlikPaneli({ weeks, cur, sehir, sehirAdlari, isLive }: Props) {
  const satirDe = (p: WeekPacket | undefined): CityRow | null => (sehir === null || !p ? null : (p.cities?.find((c) => c.index === sehir) ?? null));
  const w = cur?.world ?? null;
  const c = cur ? satirDe(cur) : null;
  const d = w ? degerler(w, c) : null;
  const eskiPaket = cur ? weeks.find((p) => p.week === cur.week - IZ) : undefined;
  const eski = eskiPaket ? degerler(eskiPaket.world, satirDe(eskiPaket)) : null;
  const olculuyor = useMemo(() => weeks.some((p) => sonlu(p.world.npc_pool)), [weeks]);
  const seriler = useMemo<ChartSeries[]>(() => {
    const uzun = weeks.reduce((m, p) => Math.max(m, p.week), 0);
    const sutun = (pick: (x: Deger) => number | null): (number | null)[] => {
      const v: (number | null)[] = Array.from({ length: uzun }, () => null);
      for (const p of weeks) v[p.week - 1] = kayan(pick(degerler(p.world, satirDe(p))));
      return v;
    };
    const out: ChartSeries[] = [{ id: "oyuncu", labelKey: "seri.issiz_orani", values: sutun((x) => x.oyuncuOran), styleIndex: 1 }];
    if (olculuyor) out.push({ id: "toplam", labelKey: "seri.issiz_toplam", values: sutun((x) => x.toplam), styleIndex: 2 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, sehir, olculuyor]);

  const satir = (id: string, etiket: CopyKey, deger: string, iz: ReturnType<typeof egilim> = null) => (
    <div key={id} className={styles.olcu} data-issizlik={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>
        {deger}
        {iz ? (
          <span className={styles.egilim}>
            <span aria-hidden="true">{iz}</span> {t(EGILIM_AD[iz])}
          </span>
        ) : null}
      </dd>
    </div>
  );
  const akis = (id: string, etiket: CopyKey, v: number | null | undefined) => satir(id, etiket, goster(v, akce));
  const kapsam = sehir === null ? null : t("canli.issizlik.kapsam_sehir", { ad: cityDisplayName(sehirAdlari[sehir] ?? "", sehir) });
  return (
    <section aria-label={t("canli.issizlik.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.issizlik.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.issizlik.alt")}</p>
      {kapsam ? <p className={styles.kucuk}>{kapsam}</p> : null}
      <dl className={styles.serit}>
        {satir("oyuncu_oran", "canli.issizlik.oyuncu_oran", goster(d?.oyuncuOran, oran1), egilim(d?.oyuncuOran ?? null, eski?.oyuncuOran ?? null))}
        {satir("oyuncu_sayi", "canli.issizlik.oyuncu_sayi", goster(d?.oyuncuSayi, sayi), egilim(d?.oyuncuSayi ?? null, eski?.oyuncuSayi ?? null))}
        {satir("npc_havuz", "canli.issizlik.npc_havuz", goster(d?.havuz, sayi), egilim(d?.havuz ?? null, eski?.havuz ?? null))}
        {satir("tuketemeyen", "canli.issizlik.tuketemeyen", goster(d?.tuketemeyen, sayi), egilim(d?.tuketemeyen ?? null, eski?.tuketemeyen ?? null))}
        {satir("toplam", "canli.issizlik.toplam", goster(d?.toplam, oran1), egilim(d?.toplam ?? null, eski?.toplam ?? null))}
        {satir("nakit", "canli.issizlik.nakit", goster(w?.npc_pool_cash_avg, (x) => t("canli.gosterge.akce", { n: ondalik(1)(x) })))}
        {satir("calisan_npc", "canli.issizlik.calisan_npc", goster(w?.npc_employed, sayi))}
        {satir("ahir", "canli.issizlik.ahir", goster(w?.players_in_ahir, sayi))}
        {satir("ogrenci", "canli.issizlik.ogrenci", goster(w?.players_students, sayi))}
        {akis("odenek", "canli.issizlik.odenek", w?.benefit_paid)}
        {sonlu(w?.benefit_paid_npc) ? akis("odenek_npc", "canli.issizlik.odenek_npc", w.benefit_paid_npc) : null}
        {akis("belediye", "canli.issizlik.belediye", w?.muni_wages)}
        {akis("burs", "canli.issizlik.burs", w?.bursary_paid)}
        {akis("kisinti", "canli.issizlik.kisinti", w?.benefit_cut)}
      </dl>
      {weeks.length > 0 ? <LineChart titleKey="canli.issizlik.grafik" series={seriler} yDomain={[0, 1]} /> : null}
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "canli.issizlik.olculmuyor.live" : "canli.issizlik.olculmuyor")}</p> : null}
    </section>
  );
}
