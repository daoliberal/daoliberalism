import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import type { CityRow } from "@/oyun/sim/types";
import { SEVIYE_GLIF, SEVIYE_METIN, bin, goster, issizOrani, oran0, seviye } from "../bicim";
import styles from "./Dunya.module.css";

type Props = { satir: CityRow; ad: string; hafta: number; ac?(): void };

/** Bir şehir düğümü: karşılama, işsizlik ve kasa; durum glif + metin. Çekmece varsa düğme, yoksa düz kutu. */
export function SehirDugumu({ satir, ad, hafta, ac }: Props) {
  const sev = seviye(hafta, satir.served);
  const isim = cityDisplayName(ad, satir.index);
  const kar = goster(satir.served, oran0);
  const issiz = goster(issizOrani(satir.employed, satir.unemployed), oran0);
  const kasa = goster(satir.cash, bin);
  const durum = t(SEVIYE_METIN[sev]);
  const icerik = (
    <>
      <b className={styles.ad}>{isim}</b>
      <span className={styles.durum} data-seviye={sev}>
        <span aria-hidden="true">{SEVIYE_GLIF[sev]}</span> {durum}
      </span>
      <span className={styles.deger}>
        {t("canli.dunya.karsilama")} {kar}
      </span>
      <span className={styles.deger}>
        {t("canli.dunya.issizlik")} {issiz}
      </span>
      <span className={styles.deger}>
        {t("canli.dunya.kasa")} {kasa}
      </span>
    </>
  );
  const ortak = { className: styles.dugum, "data-sehir": satir.index, "data-seviye": sev } as const;
  if (!ac) return <div {...ortak}>{icerik}</div>;
  return (
    <button type="button" {...ortak} aria-label={t("canli.dunya.dugum_aria", { ad: isim, durum, kar, issiz, kasa })} onClick={ac}>
      {icerik}
    </button>
  );
}
