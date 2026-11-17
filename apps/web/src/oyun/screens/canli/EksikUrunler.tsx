import { Button } from "@/components/primitives/Button";
import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import { urunAdiOf } from "@/oyun/lib/urunAdlari";
import { urunAcilabilir } from "@/oyun/sim/ekonomiSeri";
import type { EksikUrun, WeekPacket } from "@/oyun/sim/types";
import { oran0, sayi } from "./bicim";
import styles from "./Canli.module.css";

type Props = {
  cur: WeekPacket | null;
  /** `null` = pano kapalı (ürün bazında eksik ölçülmüyor). */
  urunler: EksikUrun[] | null;
  secili: string | null;
  onSec(urun: string | null): void;
};

/** Ürünün ekrandaki adı: ürün sözlüğü (`urun.ad.*`), yoksa okunur ad. */
export const urunAdi = (urun: string): string => urunAdiOf(urun);

/** Karşılanmayan talebin istenene oranı; istek 0 ise ölçülemez. */
const oranOf = (u: EksikUrun): number | null => (u.istek > 0 ? u.karsilanmayan / u.istek : null);

/**
 * En çok eksik kalan ürünler (tüm dünya): karşılanmayan oranı en yüksek ürün üstte. Yalnız sektör panosundaki ürünler (listede olanlar) düğmedir;
 * bir ürüne basınca şehirlere göre ayrıntısı açılır.
 */
export function EksikUrunler({ cur, urunler, secili, onSec }: Props) {
  const satirlar = urunler === null ? [] : [...urunler].sort((a, b) => (oranOf(b) ?? -1) - (oranOf(a) ?? -1));
  return (
    <section aria-label={t("tuketim.eksik.baslik")} className={styles.bolum}>
      <h3 className={styles.baslik}>{t("tuketim.eksik.baslik")}</h3>
      <p className={styles.etiket} data-tuketim="eksik_kapsam">{t("tuketim.dunya_rozeti")}</p>
      {urunler === null ? (
        <p className={styles.kucuk}>{t("tuketim.olculmuyor_pano")}</p>
      ) : (
        <>
          <p className={styles.kucuk}>{t("tuketim.eksik.ipucu")}</p>
          <Table
            caption={t("tuketim.eksik.tablo")} columns="even5" minWidth="md" density="compact" align={["start", "end", "end", "end", "end"]}
            header={[t("tuketim.eksik.urun"), t("tuketim.eksik.istek"), t("tuketim.eksik.karsilanmayan"), t("tuketim.eksik.uretim"), t("tuketim.eksik.stok")]}
            rows={satirlar.map((u) => {
              const ad = urunAdi(u.urun);
              const oran = oranOf(u);
              return [
                urunAcilabilir(cur, u.urun) ? (
                  <Button key={u.urun} variant="toggle" size="sm" pressed={secili === u.urun} onClick={() => onSec(secili === u.urun ? null : u.urun)}>{ad}</Button>
                ) : ad,
                sayi(u.istek),
                oran === null ? sayi(u.karsilanmayan) : `${sayi(u.karsilanmayan)} (${oran0(oran)})`,
                sayi(u.uretim),
                sayi(u.stok),
              ];
            })}
          />
        </>
      )}
    </section>
  );
}
