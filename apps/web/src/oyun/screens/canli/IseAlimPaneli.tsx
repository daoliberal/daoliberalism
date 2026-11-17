import { t, type CopyKey } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { goster, oran0, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";

const IZ = 13;

type Sayi = number | null | undefined;
/** 13 hafta önceye göre eğilim işareti; karşılaştırma değeri yoksa eğilim yok. Renk tek başına anlam taşımaz. */
function egilim(cur: Sayi, onceki: Sayi): "▲" | "▼" | "=" | null {
  if (!sonlu(cur) || !sonlu(onceki)) return null;
  const esik = Math.abs(onceki) * 0.01;
  if (cur > onceki + esik) return "▲";
  if (cur < onceki - esik) return "▼";
  return "=";
}
const EGILIM_AD = { "▲": "seri.artis", "▼": "seri.dusus", "=": "seri.sabit" } as const;

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; isLive: boolean };

/** İşe alım ve ahır: NPC firmalarındaki işe alım/çıkarma akışları, ahır doluluğu ve yeni oyuncu katılımı (dünya değerleri). */
export function IseAlimPaneli({ weeks, cur, isLive }: Props) {
  const w = cur?.world ?? null;
  const eski = cur ? (weeks.find((p) => p.week === cur.week - IZ)?.world ?? null) : null;
  const olculuyor = weeks.some((p) => sonlu(p.world.players_total));
  const satir = (id: string, etiket: CopyKey, deger: string, iz: ReturnType<typeof egilim> = null) => (
    <div key={id} className={styles.olcu} data-ise-alim={id}>
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
  const adet = (id: string, etiket: CopyKey, v: Sayi, onceki?: Sayi) => satir(id, etiket, goster(v, sayi), onceki === undefined ? null : egilim(v, onceki));
  return (
    <section aria-label={t("canli.ise_alim.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.ise_alim.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.ise_alim.alt")}</p>
      <dl className={styles.serit}>
        {adet("toplam_oyuncu", "canli.ise_alim.toplam_oyuncu", w?.players_total, eski?.players_total)}
        {adet("yeni_hafta", "canli.ise_alim.yeni_hafta", w?.players_new)}
        {adet("yeni_toplam", "canli.ise_alim.yeni_toplam", w?.players_new_total)}
        {adet("ahir_oyuncu", "canli.ise_alim.ahir_oyuncu", w?.players_in_ahir, eski?.players_in_ahir)}
        {satir("ahir_doluluk", "canli.ise_alim.ahir_doluluk", goster(w?.ahir_fill, oran0), egilim(w?.ahir_fill, eski?.ahir_fill))}
        {adet("firma_npc", "canli.ise_alim.firma_npc", w?.npc_firm_npc, eski?.npc_firm_npc)}
        {adet("firma_oyuncu", "canli.ise_alim.firma_oyuncu", w?.npc_firm_players, eski?.npc_firm_players)}
        {adet("alinan_oyuncu", "canli.ise_alim.alinan_oyuncu", w?.hired_player)}
        {adet("alinan_npc", "canli.ise_alim.alinan_npc", w?.hired_npc)}
        {adet("cikan_oyuncu", "canli.ise_alim.cikan_oyuncu", w?.fired_player)}
        {adet("cikan_npc", "canli.ise_alim.cikan_npc", w?.fired_npc)}
        {adet("gecis", "canli.ise_alim.gecis", w?.ahir_moves)}
        {adet("zincir", "canli.ise_alim.zincir", w?.ahir_backfilled)}
        {adet("engel", "canli.ise_alim.engel", w?.inflow_blocked)}
      </dl>
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "canli.ise_alim.olculmuyor.live" : "canli.ise_alim.olculmuyor")}</p> : null}
    </section>
  );
}
