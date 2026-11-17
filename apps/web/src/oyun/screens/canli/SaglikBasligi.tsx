import { t } from "@/oyun/copy/t";
import type { CityRow, WeekPacket } from "@/oyun/sim/types";
import { cityDisplayName } from "@/oyun/lib/names";
import { OLCULMUYOR, SEVIYE_GLIF, bin, SEVIYE_METIN, goster, oran0, ondalik, seviye, sonlu } from "./bicim";
import styles from "./Canli.module.css";

type Props = {
  cur: WeekPacket | null;
  sehirAdlari: string[];
  /** Sektör kimliğinden oyuncu dilinde etiket; bilinmiyorsa kimliğin kendisi. */
  sektorAdi(sektor: string): string;
  /** Çekmece yoksa (kayıt kaynağı) satırlar düz metindir. */
  ac?(kind: string, ref: string): void;
};

function enKotu(cities: CityRow[] | undefined): CityRow | null {
  let kotu: CityRow | null = null;
  for (const c of cities ?? []) if (sonlu(c.served) && (kotu === null || c.served < (kotu.served ?? 1))) kotu = c;
  return kotu;
}

/** Sağlık başlığı: dünya durumu, en kötü şehir, en kıt halka, kasa, politika faizi. Durum glif + metin (renk tek başına değil). */
export function SaglikBasligi({ cur, sehirAdlari, sektorAdi, ac }: Props) {
  const w = cur?.world;
  const sev = seviye(cur?.week ?? 0, w?.served ?? null);
  const kotu = enKotu(cur?.cities);
  const kit = cur?.chain?.scarce?.[0] ?? null;
  const kitAd = kit ? sektorAdi(kit.sector) : null;
  const satir = (etiket: string, deger: string, git?: () => void) => (
    <span className={styles.sagSatir}>
      {git ? (
        <button type="button" className={styles.sagDugme} onClick={git}>
          <span className={styles.etiket}>{etiket}</span> <b>{deger}</b>
        </button>
      ) : (
        <>
          <span className={styles.etiket}>{etiket}</span> <b>{deger}</b>
        </>
      )}
    </span>
  );
  return (
    <section aria-label={t("canli.saglik.baslik")} data-seviye={sev} className={styles.saglik}>
      <span className={styles.durum} data-seviye={sev}>
        <span aria-hidden="true">{SEVIYE_GLIF[sev]}</span> {t("canli.saglik.dunya", { durum: t(SEVIYE_METIN[sev]) })}
      </span>
      {kotu
        ? satir(
            t("canli.saglik.en_kotu_sehir"),
            t("canli.saglik.en_kotu_deger", { ad: cityDisplayName(sehirAdlari[kotu.index] ?? "", kotu.index), kar: goster(kotu.served, oran0) }),
            ac ? () => ac("city", String(kotu.index)) : undefined,
          )
        : null}
      {kit && kitAd ? satir(t("canli.saglik.en_kit_halka"), kitAd, ac ? () => ac("sector", kit.sector) : undefined) : null}
      {satir(t("canli.saglik.kasa"), goster(w?.city_cash_total, bin))}
      {satir(t("canli.saglik.faiz"), sonlu(w?.policy_rate) ? t("canli.saglik.haftalik", { oran: `%${ondalik(2)(w.policy_rate * 100)}` }) : OLCULMUYOR())}
    </section>
  );
}
