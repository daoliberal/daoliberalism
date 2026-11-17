import { useMemo } from "react";
import { t, type CopyKey } from "@/oyun/copy/t";
import { endeksSerisi, gercekFaiz, gercekUcret100, istihdamOrani, issizlikOrani, makroDeger, oyuncuIssizlikOrani, makroSeri, makroVar, type MakroAlan } from "@/oyun/sim/makroSeri";
import type { WeekPacket } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, ondalik, oran1, sayi } from "./bicim";
import styles from "./Canli.module.css";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null };

const en1 = ondalik(1);
const en2 = ondalik(2);
const en3 = ondalik(3);
const kat = (x: number) => t("makro.kat", { n: en2(x) });
const akce = (x: number) => t("canli.gosterge.akce", { n: sayi(x) });
const akce1 = (x: number) => t("canli.gosterge.akce", { n: en1(x) });
const yuz = (f: MakroAlan): MakroAlan => (m) => { const v = f(m); return v === null ? null : v * 100; };

/** Üst şeritteki kart: etiket, değer, ne demek ve iyi yönü. */
type Kart = { id: string; etiket: CopyKey; not: CopyKey; deger: (p: WeekPacket | null) => number | null; bicim: (x: number) => string };
const KARTLAR: readonly Kart[] = [
  { id: "enflasyon", etiket: "makro.kart.enflasyon", not: "makro.kart.enflasyon.not", deger: (p) => makroDeger(p, (m) => m.fiyat.enf), bicim: oran1 },
  { id: "gercek_ucret", etiket: "makro.kart.gercek_ucret", not: "makro.kart.gercek_ucret.not", deger: (p) => makroDeger(p, gercekUcret100), bicim: en1 },
  { id: "buyume", etiket: "makro.kart.buyume", not: "makro.kart.buyume.not", deger: (p) => makroDeger(p, (m) => m.uretim.buyume), bicim: oran1 },
  { id: "issizlik", etiket: "makro.kart.issizlik", not: "makro.kart.issizlik.not", deger: issizlikOrani, bicim: oran1 },
  { id: "issizlik_oyuncu", etiket: "makro.kart.issizlik_oyuncu", not: "makro.kart.issizlik_oyuncu.not", deger: oyuncuIssizlikOrani, bicim: oran1 },
  { id: "politika", etiket: "makro.kart.politika", not: "makro.kart.politika.not", deger: (p) => makroDeger(p, (m) => m.faiz.politika), bicim: oran1 },
  { id: "gercek_faiz", etiket: "makro.kart.gercek_faiz", not: "makro.kart.gercek_faiz.not", deger: (p) => makroDeger(p, gercekFaiz), bicim: oran1 },
  { id: "gini", etiket: "makro.kart.gini", not: "makro.kart.gini.not", deger: (p) => makroDeger(p, (m) => m.dagilim.gini_nakit), bicim: en2 },
  { id: "yoksul", etiket: "makro.kart.yoksul", not: "makro.kart.yoksul.not", deger: (p) => makroDeger(p, (m) => m.dagilim.yoksul), bicim: oran1 },
];

/** Ayrıntılı göstergeler (kart şeridinde olmayanlar ve kalemler). */
type Satir = { id: string; etiket: CopyKey; not: CopyKey; deger: (p: WeekPacket | null) => number | null; bicim: (x: number) => string };
const m100 = (f: MakroAlan) => (p: WeekPacket | null) => makroDeger(p, yuz(f));
const mv = (f: MakroAlan) => (p: WeekPacket | null) => makroDeger(p, f);
const SATIRLAR: readonly Satir[] = [
  { id: "tuketici", etiket: "makro.ek.tuketici", not: "makro.ek.tuketici.not", deger: m100((m) => m.fiyat.tuk), bicim: en1 },
  { id: "uretici", etiket: "makro.ek.uretici", not: "makro.ek.uretici.not", deger: m100((m) => m.fiyat.uretici), bicim: en1 },
  { id: "ucret", etiket: "makro.ek.ucret", not: "makro.ek.ucret.not", deger: m100((m) => m.fiyat.ucret), bicim: en1 },
  { id: "uretim_nominal", etiket: "makro.ek.uretim_nominal", not: "makro.ek.uretim_nominal.not", deger: mv((m) => m.uretim.nominal), bicim: akce },
  { id: "uretim_gercek", etiket: "makro.ek.uretim_gercek", not: "makro.ek.uretim_gercek.not", deger: mv((m) => m.uretim.gercek), bicim: akce },
  { id: "verimlilik", etiket: "makro.ek.verimlilik", not: "makro.ek.verimlilik.not", deger: mv((m) => m.uretim.verimlilik), bicim: akce1 },
  { id: "para_stok", etiket: "makro.ek.para_stok", not: "makro.ek.para_stok.not", deger: mv((m) => m.para.stok), bicim: akce },
  { id: "para_mali", etiket: "makro.ek.para_mali", not: "makro.ek.para_mali.not", deger: mv((m) => m.para.mali), bicim: akce },
  { id: "para_kredi", etiket: "makro.ek.para_kredi", not: "makro.ek.para_kredi.not", deger: mv((m) => m.para.kredi_net), bicim: akce },
  { id: "para_acilis", etiket: "makro.ek.para_acilis", not: "makro.ek.para_acilis.not", deger: mv((m) => m.para.acilis), bicim: akce },
  { id: "hiz", etiket: "makro.ek.hiz", not: "makro.ek.hiz.not", deger: mv((m) => m.para.hiz), bicim: en3 },
  { id: "mevduat", etiket: "makro.ek.mevduat", not: "makro.ek.mevduat.not", deger: mv((m) => m.faiz.mevduat), bicim: oran1 },
  { id: "kredi_faiz", etiket: "makro.ek.kredi_faiz", not: "makro.ek.kredi_faiz.not", deger: mv((m) => m.faiz.kredi), bicim: oran1 },
  { id: "marj_npc", etiket: "makro.ek.marj_npc", not: "makro.ek.marj_npc.not", deger: mv((m) => m.marj.npc), bicim: oran1 },
  { id: "marj_oyuncu", etiket: "makro.ek.marj_oyuncu", not: "makro.ek.marj_oyuncu.not", deger: mv((m) => m.marj.oyuncu), bicim: oran1 },
  { id: "kira", etiket: "makro.ek.kira", not: "makro.ek.kira.not", deger: m100((m) => m.konut?.kira ?? null), bicim: en1 },
  { id: "kira_gelir", etiket: "makro.ek.kira_gelir", not: "makro.ek.kira_gelir.not", deger: mv((m) => m.konut?.kira_gelir ?? null), bicim: oran1 },
  { id: "gini_gelir", etiket: "makro.ek.gini_gelir", not: "makro.ek.gini_gelir.not", deger: mv((m) => m.dagilim.gini_gelir), bicim: en2 },
  { id: "gini_servet", etiket: "makro.ek.gini_servet", not: "makro.ek.gini_servet.not", deger: mv((m) => m.dagilim.gini_servet), bicim: en2 },
  { id: "medyan", etiket: "makro.ek.medyan", not: "makro.ek.medyan.not", deger: mv((m) => m.dagilim.medyan_sepet), bicim: kat },
  { id: "kredi_stok", etiket: "makro.ek.kredi_stok", not: "makro.ek.kredi_stok.not", deger: mv((m) => m.kredi.stok), bicim: akce },
  { id: "kredi_buyume", etiket: "makro.ek.kredi_buyume", not: "makro.ek.kredi_buyume.not", deger: mv((m) => m.kredi.buyume), bicim: oran1 },
  { id: "temerrut", etiket: "makro.ek.temerrut", not: "makro.ek.temerrut.not", deger: mv((m) => m.kredi.temerrut), bicim: oran1 },
  { id: "istihdam", etiket: "makro.ek.istihdam", not: "makro.ek.istihdam.not", deger: istihdamOrani, bicim: oran1 },
];

/**
 * Makro göstergeler: ekonominin bütününe tek bakış. Üstte dokuz kart (enflasyon, gerçek ücret, büyüme, geniş işsizlik, oyuncu işsizliği, politika faizi, gerçek faiz, Gini, yoksulluk;
 * her birinde ne demek olduğu ve iyi yönü), altında gruplanmış grafikler ve ayrıntılı göstergeler. Dünya düzeyindedir (şehir kırılımı yok).
 * Ölçülmeyen değer "ölçülmüyor", grafikte boşluktur (0 uydurulmaz). Sunucu bloğu göndermiyorsa (eski sunucu, kayıt) yalnız bir not görünür.
 */
export function MakroPaneli({ weeks, cur }: Props) {
  const var_ = useMemo(() => makroVar(weeks), [weeks]);
  const g = useMemo(() => {
    const ser = (id: string, labelKey: CopyKey, styleIndex: 0 | 1 | 2 | 3 | 4 | 5, values: (number | null)[]): ChartSeries => ({ id, labelKey, styleIndex, values });
    return {
      fiyat: [
        ser("tuketici", "seri.makro_tuketici", 0, endeksSerisi(weeks, (m) => m.fiyat.tuk)),
        ser("uretici", "seri.makro_uretici", 1, endeksSerisi(weeks, (m) => m.fiyat.uretici)),
        ser("ucret", "seri.makro_ucret", 2, endeksSerisi(weeks, (m) => m.fiyat.ucret)),
        ser("gercek-ucret", "seri.makro_gercek_ucret", 3, endeksSerisi(weeks, (m) => m.fiyat.gercek_ucret)),
      ],
      uretim: [ser("gercek-uretim", "seri.makro_gercek_uretim", 0, makroSeri(weeks, (m) => m.uretim.gercek))],
      para: [ser("para-stoku", "seri.makro_para", 0, makroSeri(weeks, (m) => m.para.stok))],
      hiz: [ser("hiz", "seri.makro_hiz", 0, makroSeri(weeks, (m) => m.para.hiz))],
      faiz: [ser("politika", "seri.makro_politika", 0, makroSeri(weeks, (m) => m.faiz.politika)), ser("gercek-faiz", "seri.makro_gercek_faiz", 1, makroSeri(weeks, gercekFaiz))],
      faiz2: [ser("mevduat", "seri.makro_mevduat", 0, makroSeri(weeks, (m) => m.faiz.mevduat)), ser("kredi-faiz", "seri.makro_kredi_faiz", 1, makroSeri(weeks, (m) => m.faiz.kredi))],
      gini: [ser("gini-nakit", "seri.makro_gini_nakit", 0, makroSeri(weeks, (m) => m.dagilim.gini_nakit)), ser("gini-gelir", "seri.makro_gini_gelir", 1, makroSeri(weeks, (m) => m.dagilim.gini_gelir))],
      yoksul: [ser("yoksul", "seri.makro_yoksul", 0, makroSeri(weeks, (m) => m.dagilim.yoksul))],
      kredi: [ser("kredi-stok", "seri.makro_kredi", 0, makroSeri(weeks, (m) => m.kredi.stok))],
      krediOran: [ser("kredi-buyume", "seri.makro_kredi_buyume", 0, makroSeri(weeks, (m) => m.kredi.buyume)), ser("temerrut", "seri.makro_temerrut", 1, makroSeri(weeks, (m) => m.kredi.temerrut))],
      marj: [ser("marj-npc", "seri.makro_marj_npc", 0, makroSeri(weeks, (m) => m.marj.npc)), ser("marj-oyuncu", "seri.makro_marj_oyuncu", 1, makroSeri(weeks, (m) => m.marj.oyuncu))],
      verimlilik: [ser("verimlilik", "seri.makro_verimlilik", 0, makroSeri(weeks, (m) => m.uretim.verimlilik))],
      kira: [ser("kira", "seri.makro_kira", 0, endeksSerisi(weeks, (m) => m.konut?.kira ?? null))],
    };
  }, [weeks]);

  if (!var_) {
    return (
      <section aria-label={t("makro.baslik")} className={styles.bolum}>
        <h2 className={styles.baslik}>{t("makro.baslik")}</h2>
        {weeks.length > 0 ? <p className={styles.kucuk}>{t("makro.eski_sunucu")}</p> : null}
      </section>
    );
  }
  const kiraVar = weeks.some((p) => p.makro?.konut != null);

  return (
    <section aria-label={t("makro.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("makro.baslik")}</h2>
      <p className={styles.kucuk}>{t("makro.alt")}</p>

      <dl className={styles.serit} aria-label={t("makro.kartlar")}>
        {KARTLAR.map((k) => (
          <div key={k.id} className={styles.olcu} data-makro={k.id}>
            <dt className={styles.etiket}>{t(k.etiket)}</dt>
            <dd className={styles.deger}>{goster(k.deger(cur), k.bicim)}</dd>
            <dd className={styles.fark}>{t(k.not)}</dd>
          </div>
        ))}
      </dl>

      <h3 className={styles.baslik}>{t("makro.grup.fiyat")}</h3>
      <LineChart titleKey="makro.grafik.fiyat" series={g.fiyat} referans={100} />

      <h3 className={styles.baslik}>{t("makro.grup.uretim")}</h3>
      <LineChart titleKey="makro.grafik.uretim" series={g.uretim} />
      <LineChart titleKey="makro.grafik.para" series={g.para} />
      <LineChart titleKey="makro.grafik.hiz" series={g.hiz} />

      <h3 className={styles.baslik}>{t("makro.grup.faiz")}</h3>
      <LineChart titleKey="makro.grafik.faiz" series={g.faiz} referans={0} />
      <LineChart titleKey="makro.grafik.faiz2" series={g.faiz2} />

      <h3 className={styles.baslik}>{t("makro.grup.dagilim")}</h3>
      <LineChart titleKey="makro.grafik.gini" series={g.gini} yDomain={[0, 1]} />
      <LineChart titleKey="makro.grafik.yoksul" series={g.yoksul} yDomain={[0, 1]} />

      <h3 className={styles.baslik}>{t("makro.grup.kredi")}</h3>
      <LineChart titleKey="makro.grafik.kredi" series={g.kredi} />
      <LineChart titleKey="makro.grafik.kredi_oran" series={g.krediOran} referans={0} />

      <h3 className={styles.baslik}>{t("makro.grup.firma")}</h3>
      <LineChart titleKey="makro.grafik.marj" series={g.marj} referans={0} />
      <LineChart titleKey="makro.grafik.verimlilik" series={g.verimlilik} />
      {kiraVar ? <LineChart titleKey="makro.grafik.kira" series={g.kira} referans={100} /> : null}

      <h3 className={styles.baslik}>{t("makro.ek.baslik")}</h3>
      <dl className={styles.serit}>
        {SATIRLAR.map((s) => (
          <div key={s.id} className={styles.olcu} data-makro-ek={s.id}>
            <dt className={styles.etiket}>{t(s.etiket)}</dt>
            <dd className={styles.deger}>{goster(s.deger(cur), s.bicim)}</dd>
            <dd className={styles.fark}>{t(s.not)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
