import { useMemo } from "react";
import { t } from "@/oyun/copy/t";
import { endeksSeri, tamSepet, ucretOraniSeri, ucretSatiri } from "@/oyun/sim/ekonomiSeri";
import type { WeekPacket } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, ondalik } from "./bicim";
import styles from "./Canli.module.css";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; sehir: number | null };

const akce = (x: number) => t("canli.gosterge.akce", { n: ondalik(1)(x) });
const endeks = ondalik(1);
const kat = (x: number) => t("tuketim.ucret.kat", { n: ondalik(2)(x) });

/**
 * Ücret ve fiyat: ücretler fiyatları izliyor mu? Ücret endeksi ile fiyat endeksi aynı grafikte, ilk ölçülen hafta = 100 (ikisi de modelin kendi endeksidir, tahmin değil);
 * en düşük (çırak) kademenin vergi sonrası haftalık ücreti ve TAM sabit sepetin haftalık bedeli (hanelerin fiilen aldığı sepet değil; o Tüketim hane kartlarında). Şehir seçiliyse değerler o şehrindir, değilse nüfus ağırlıklı dünya.
 * Sunucu bu alanı göndermiyorsa (eski sunucu, kayıt) bölüm hiç görünmez.
 */
export function UcretFiyatBolumu({ weeks, cur, sehir }: Props) {
  const ucretVar = useMemo(() => weeks.some((p) => p.ekonomi?.tuketim.ucret != null), [weeks]);
  const seriler = useMemo(() => {
    const ucret = endeksSeri(weeks, "ucret", sehir);
    const fiyat = endeksSeri(weeks, "fiyat", sehir);
    return {
      ucret, fiyat,
      endeks: [
        { id: "ucret-endeksi", labelKey: "seri.ucret_endeksi", styleIndex: 0, values: ucret },
        { id: "fiyat-endeksi", labelKey: "seri.fiyat_endeksi", styleIndex: 1, values: fiyat },
      ] satisfies ChartSeries[],
      oran: [{ id: "ucret-orani", labelKey: "seri.ucret_orani", styleIndex: 0, values: ucretOraniSeri(weeks, sehir) }] satisfies ChartSeries[],
    };
  }, [weeks, sehir]);
  if (!ucretVar) return null;

  const satir = ucretSatiri(cur, sehir);
  const i = cur === null ? -1 : cur.week - 1;
  const sepet = tamSepet(satir);
  const olcu = (id: string, etiket: Parameters<typeof t>[0], deger: string, fark?: string) => (
    <div key={id} className={styles.olcu} data-tuketim={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
      {fark === undefined ? null : <dd className={styles.fark}>{fark}</dd>}
    </div>
  );

  return (
    <>
      <h3 className={styles.baslik}>{t("tuketim.ucret.baslik")}</h3>
      <p className={styles.kucuk}>{t("tuketim.ucret.aciklama")}</p>
      <dl className={styles.serit}>
        {olcu("ucret_endeksi", "tuketim.ucret.endeks", goster(seriler.ucret[i], endeks), t("tuketim.ucret.endeks_not"))}
        {olcu("fiyat_endeksi", "tuketim.ucret.fiyat", goster(seriler.fiyat[i], endeks), t("tuketim.ucret.endeks_not"))}
        {olcu("net_ucret", "tuketim.ucret.net", goster(satir?.net, akce), t("tuketim.ucret.net_not"))}
        {olcu("sepet_bedeli", "tuketim.ucret.sepet", goster(sepet, akce))}
        {olcu("ucret_orani", "tuketim.ucret.oran", goster(satir?.oran, kat))}
      </dl>
      <LineChart titleKey="tuketim.ucret.grafik" series={seriler.endeks} referans={100} />
      <LineChart titleKey="tuketim.ucret.oran_grafik" series={seriler.oran} referans={1} />
    </>
  );
}
