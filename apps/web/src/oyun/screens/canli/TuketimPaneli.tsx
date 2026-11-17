import { useMemo, useState } from "react";
import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { eksikUrunler, haneKirilimi, haneSeri, harcamaSeri, parasizIssizSeri, type HaneKaynagi } from "@/oyun/sim/ekonomiSeri";
import type { WeekPacket } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, oran0, sayi } from "./bicim";
import styles from "./Canli.module.css";
import { EksikUrunler, urunAdi } from "./EksikUrunler";
import { UcretFiyatBolumu } from "./UcretFiyatBolumu";
import { UrunAyrintisi } from "./UrunAyrintisi";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; sehir: number | null; sehirAdlari: string[]; isLive: boolean; runId: string };

const akce = (x: number) => t("canli.gosterge.akce", { n: sayi(x) });
const kisi = (x: number) => t("tuketim.kisi", { n: sayi(x) });
const KAYNAKLAR: readonly [HaneKaynagi, "seri.hane_oyuncu" | "seri.hane_npc" | "seri.hane_birlesik", 0 | 1 | 2][] = [
  ["oyuncu", "seri.hane_oyuncu", 1], ["npc", "seri.hane_npc", 0], ["birlesik", "seri.hane_birlesik", 2],
];

/**
 * Tüketim: hanelerin ihtiyaç sepetinin ne kadarı karşılanıyor (çalışanlar ve iş arayanlar ayrı; oyuncu haneleri, yerleşik halk, birleşik), haftalık sepet bedeli,
 * oyuncu ve yerleşik halk harcaması, parası olmadığı için tüketemeyen işsiz sayısı ve en çok eksik kalan ürünler. Şehir seçiliyse hane ve harcama değerleri o şehrindir;
 * ürün listesi her zaman tüm dünyadır. Ölçülmeyen değer "ölçülmüyor", grafikte boşluktur (0 uydurulmaz).
 */
export function TuketimPaneli({ weeks, cur, sehir, sehirAdlari, runId }: Props) {
  const [urun, setUrun] = useState<string | null>(null);
  const blokVar = useMemo(() => weeks.some((p) => p.ekonomi !== undefined), [weeks]);
  const seriler = useMemo(() => {
    const oranlar = (grup: "ise" | "issiz"): ChartSeries[] =>
      KAYNAKLAR.map(([kaynak, labelKey, styleIndex]) => ({ id: `${grup}-${kaynak}`, labelKey, styleIndex, values: haneSeri(weeks, grup, "karsilanma", kaynak, sehir) }));
    return {
      ise: oranlar("ise"), issiz: oranlar("issiz"),
      sepet: [
        { id: "sepet-ise", labelKey: "seri.sepet_ise", styleIndex: 0, values: haneSeri(weeks, "ise", "sepet", "birlesik", sehir) },
        { id: "sepet-issiz", labelKey: "seri.sepet_issiz", styleIndex: 1, values: haneSeri(weeks, "issiz", "sepet", "birlesik", sehir) },
      ] satisfies ChartSeries[],
      harcama: [
        { id: "harcama-oyuncu", labelKey: "seri.harcama_oyuncu", styleIndex: 1, values: harcamaSeri(weeks, "oyuncu", sehir) },
        { id: "harcama-npc", labelKey: "seri.harcama_npc", styleIndex: 0, values: harcamaSeri(weeks, "npc", sehir) },
      ] satisfies ChartSeries[],
      parasiz: [{ id: "parasiz", labelKey: "seri.parasiz_issiz", styleIndex: 1, values: parasizIssizSeri(weeks, sehir) }] satisfies ChartSeries[],
    };
  }, [weeks, sehir]);

  if (!blokVar) {
    return (
      <section aria-label={t("tuketim.baslik")} className={styles.bolum}>
        <h2 className={styles.baslik}>{t("tuketim.baslik")}</h2>
        {weeks.length > 0 ? <p className={styles.kucuk}>{t("tuketim.eski_sunucu")}</p> : null}
      </section>
    );
  }

  const ad = sehir === null ? null : cityDisplayName(sehirAdlari[sehir] ?? "", sehir);
  const servis = sehir === null ? null : (cur?.cities?.find((c) => c.index === sehir)?.served ?? null);
  const e = cur?.ekonomi;
  const ise = haneKirilimi(cur, "ise", sehir);
  const issiz = haneKirilimi(cur, "issiz", sehir);
  const harcama = sehir === null ? (e?.tuketim.harcama ?? null) : (e?.tuketim.hane.sehir.find((s) => s.sehir === sehir)?.harcama ?? null);
  const parasiz = sehir === null ? (e?.tuketim.hane.npc_issiz_parasiz ?? null) : (e?.tuketim.hane.sehir.find((s) => s.sehir === sehir)?.npc_issiz_parasiz ?? null);

  /** Bir hane grubunun bu haftası: birleşik oran büyük, oyuncu / yerleşik halk / kişi sayısı altında. */
  const karsilanma = (id: "ise" | "issiz", k: ReturnType<typeof haneKirilimi>) => (
    <div key={id} className={styles.olcu} data-tuketim={`karsilanma_${id}`}>
      <dt className={styles.etiket}>{t(id === "ise" ? "tuketim.karsilanma.ise" : "tuketim.karsilanma.issiz")}</dt>
      <dd className={styles.deger}>{goster(k?.birlesik.karsilanma, oran0)}</dd>
      <dd className={styles.fark}>
        {t("tuketim.karsilanma.oyuncu")}: {goster(k?.oyuncu.karsilanma, oran0)} · {t("tuketim.karsilanma.npc")}: {goster(k?.npc?.karsilanma, oran0)} · {goster(k?.nKisiHaftaBirlesik, kisi)}
      </dd>
    </div>
  );
  const olcu = (id: string, etiket: Parameters<typeof t>[0], deger: string) => (
    <div key={id} className={styles.olcu} data-tuketim={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
    </div>
  );
  const urunSecili = urun !== null && eksikUrunler(cur)?.some((u) => u.urun === urun) === true ? urun : null;

  return (
    <section aria-label={t("tuketim.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("tuketim.baslik")}</h2>
      <p className={styles.kucuk}>{t("tuketim.alt")}</p>
      <p className={styles.etiket} data-tuketim="kapsam">{ad === null ? t("tuketim.dunya_rozeti") : t("tuketim.sehir_rozeti", { ad })}</p>
      {ad !== null ? <p className={styles.kucuk} data-tuketim="sehir_karsilanma"><span title={t("tuketim.sehir_karsilanma.aciklama")}>{t("tuketim.sehir_karsilanma", { ad })}: {goster(servis, oran0)}</span></p> : null}
      {ad !== null ? <p className={styles.kucuk}>{t("tuketim.sehir_karsilanma.aciklama")}</p> : null}

      <h3 className={styles.baslik}>{t("tuketim.karsilanma.baslik")}</h3>
      <dl className={styles.serit}>
        {karsilanma("ise", ise)}
        {karsilanma("issiz", issiz)}
        {olcu("parasiz", "tuketim.parasiz.baslik", goster(parasiz, kisi))}
        {olcu("sepet", "tuketim.sepet.baslik", `${goster(ise?.birlesik.sepet, akce)} · ${goster(issiz?.birlesik.sepet, akce)}`)}
      </dl>
      <p className={styles.kucuk}>{t("tuketim.hane.aciklama")}</p>
      <p className={styles.kucuk}>{t("tuketim.parasiz.aciklama")}</p>
      <LineChart titleKey="tuketim.karsilanma.grafik" titleParams={{ grup: t("tuketim.karsilanma.ise") }} series={seriler.ise} yDomain={[0, 1]} />
      <LineChart titleKey="tuketim.karsilanma.grafik" titleParams={{ grup: t("tuketim.karsilanma.issiz") }} series={seriler.issiz} yDomain={[0, 1]} />
      <LineChart titleKey="tuketim.parasiz.baslik" series={seriler.parasiz} />
      <LineChart titleKey="tuketim.sepet.baslik" series={seriler.sepet} />

      <h3 className={styles.baslik}>{t("tuketim.harcama.baslik")}</h3>
      <dl className={styles.serit}>
        {olcu("harcama_oyuncu", "tuketim.harcama.oyuncu", goster(harcama?.oyuncu, akce))}
        {olcu("harcama_npc", "tuketim.harcama.npc", goster(harcama?.npc, akce))}
      </dl>
      <LineChart titleKey="tuketim.harcama.baslik" series={seriler.harcama} />

      <UcretFiyatBolumu weeks={weeks} cur={cur} sehir={sehir} />

      <EksikUrunler cur={cur} urunler={eksikUrunler(cur)} secili={urunSecili} onSec={setUrun} />
      {urunSecili !== null && cur ? (
        <UrunAyrintisi runId={runId} urun={urunSecili} ad={urunAdi(urunSecili)} hafta={cur.week} sehirAdlari={sehirAdlari} onKapat={() => setUrun(null)} />
      ) : null}
    </section>
  );
}
