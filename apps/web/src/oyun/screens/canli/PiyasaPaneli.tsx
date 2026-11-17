import { t, type CopyKey } from "@/oyun/copy/t";
import type { WeekPacket, World } from "@/oyun/sim/types";
import { goster, ondalik, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

type Satir = { id: string; etiket: CopyKey; deger(w: World): number | null; metin(x: number): string };

const SATIRLAR: readonly Satir[] = [
  { id: "ucret", etiket: "canli.gosterge.p_ucret", deger: (w) => w.wage_index, metin: ondalik(1) },
  { id: "kira", etiket: "canli.gosterge.p_kira", deger: (w) => w.rent_pct, metin: oran1 },
  { id: "doluluk", etiket: "canli.gosterge.p_doluluk", deger: (w) => w.occupancy, metin: oran1 },
  { id: "kiraci", etiket: "canli.gosterge.p_kiraci", deger: (w) => w.tenants_per_house, metin: ondalik(2) },
  { id: "konut_endeksi", etiket: "canli.gosterge.p_konut_endeksi", deger: (w) => w.house_index, metin: ondalik(1) },
  { id: "konut_deger", etiket: "canli.gosterge.p_konut_deger", deger: (w) => w.house_resale_ratio, metin: ondalik(2) },
  { id: "mevduat", etiket: "canli.gosterge.p_mevduat", deger: (w) => w.deposit_rate, metin: (x) => `%${ondalik(2)(x * 100)}` },
  { id: "tahvil", etiket: "canli.gosterge.p_tahvil", deger: (w) => w.bond_rate, metin: (x) => `%${ondalik(2)(x * 100)}` },
  { id: "lonca", etiket: "canli.gosterge.p_lonca", deger: (w) => w.lonca_fee_avg, metin: oran1 },
  { id: "telif", etiket: "canli.gosterge.p_telif", deger: (w) => w.royalty_avg, metin: oran1 },
  { id: "para", etiket: "canli.gosterge.p_para", deger: (w) => w.money_total, metin: (x) => t("canli.gosterge.akce", { n: sayi(x) }) },
  { id: "devir", etiket: "canli.gosterge.p_devir", deger: (w) => w.velocity, metin: ondalik(2) },
];

const IZ = 13;
/** 13 hafta önceye göre eğilim: işaret + metin (renk tek başına değil). Karşılaştırma değeri yoksa eğilim yok. */
function egilim(cur: number | null, onceki: number | null): "▲" | "▼" | "=" | null {
  if (!sonlu(cur) || !sonlu(onceki)) return null;
  const esik = Math.abs(onceki) * 0.01; // negatif değerlerde de göreli yüzde bir
  if (cur > onceki + esik) return "▲";
  if (cur < onceki - esik) return "▼";
  return "=";
}
const EGILIM_AD = { "▲": "seri.artis", "▼": "seri.dusus", "=": "seri.sabit" } as const;

/** Piyasa: kendiliğinden oluşan değerler ve 13 haftalık eğilim. Ölçülmeyen değer "ölçülmüyor". */
export function PiyasaPaneli({ weeks, cur }: { weeks: WeekPacket[]; cur: WeekPacket | null }) {
  const w = cur?.world ?? null;
  const eski = cur ? (weeks.find((p) => p.week === cur.week - IZ)?.world ?? null) : null;
  const satir = (id: string, etiket: string, deger: string, iz: ReturnType<typeof egilim>) => (
    <div key={id} className={styles.olcu} data-piyasa={id}>
      <dt className={styles.etiket}>{etiket}</dt>
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
  return (
    <section aria-label={t("canli.gosterge.piyasa_baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.gosterge.piyasa_baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.gosterge.piyasa_alt")}</p>
      <dl className={styles.serit}>
        {/* Yıllık enflasyon ilk 65 hafta ölçülemez (fiyat endeksinin yıl öncesi yok); o dönemde kuralın gördüğü enflasyon ayrı satırdadır. */}
        {satir("enflasyon", t("canli.gosterge.p_enflasyon"), sonlu(w?.inflation_yoy) ? oran1(w.inflation_yoy) : t("canli.gosterge.p_enflasyon_bekle"), egilim(w?.inflation_yoy ?? null, eski?.inflation_yoy ?? null))}
        {satir("pol_enflasyon", t("canli.gosterge.p_pol_enflasyon"), goster(w?.policy_inflation, oran1), egilim(w?.policy_inflation ?? null, eski?.policy_inflation ?? null))}
        {SATIRLAR.map((s) => satir(s.id, t(s.etiket), goster(w ? s.deger(w) : null, s.metin), egilim(w ? s.deger(w) : null, eski ? s.deger(eski) : null)))}
      </dl>
    </section>
  );
}
