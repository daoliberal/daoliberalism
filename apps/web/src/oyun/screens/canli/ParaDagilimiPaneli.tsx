"use client";
import { useState } from "react";
import { t, type CopyKey } from "@/oyun/copy/t";
import { sahiplikGorunumu, type SahipSatirId } from "@/oyun/sim/sahiplik";
import type { WeekPacket, World } from "@/oyun/sim/types";
import { Sekmeler, sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { goster, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";
import { KesimAkisi } from "./KesimAkisi";
import { LoncaTablosu } from "./LoncaTablosu";
import sahipStiller from "./ParaSahiplik.module.css";
import { FirmaSahipligi, KrediTahvilStoku, LoncaHesapKirilimi, MevduatSahipleriBolumu } from "./SahiplikAyrintilari";

type Props = { weeks: WeekPacket[]; cur: WeekPacket | null; isLive: boolean; onAc?: (kind: string, ref: string) => void };
type Gorunum = "sahiplik" | "hesap";

const KESIMLER = [
  ["hane", "canli.para.kesim.hane", "money_households"],
  ["yerlesik", "canli.para.kesim.yerlesik", "money_npc_firms"],
  ["oyuncu", "canli.para.kesim.oyuncu", "money_player_firms"],
  ["kasa", "canli.para.kesim.kasa", "money_city"],
  ["lonca", "canli.para.kesim.lonca", "money_lonca"],
  ["diger", "canli.para.kesim.diger", "money_other"],
] as const satisfies readonly (readonly [string, CopyKey, keyof World])[];

const GELIRLER = [
  ["gelir_vergi", "canli.para.gelir.vergi", "city_in_tax"],
  ["gelir_kar", "canli.para.gelir.kar", "city_in_profit"],
  ["gelir_kira", "canli.para.gelir.kira", "city_in_rent"],
  ["gelir_basim", "canli.para.gelir.basim", "city_in_mint"],
  ["gelir_diger", "canli.para.gelir.diger", "city_in_other"],
] as const satisfies readonly (readonly [string, CopyKey, keyof World])[];

const GIDERLER = [
  ["gider_hane", "canli.para.gider.hane", "city_out_households"],
  ["gider_ucret", "canli.para.gider.ucret", "city_out_wages"],
  ["gider_hizmet", "canli.para.gider.hizmet", "city_out_services"],
  ["gider_isletme", "canli.para.gider.isletme", "city_out_firms"],
  ["gider_diger", "canli.para.gider.diger", "city_out_other"],
] as const satisfies readonly (readonly [string, CopyKey, keyof World])[];

const SAHIP_YOK: { id: SahipSatirId; deger: number | null }[] = (["hane_nakdi", "hane_mevduat", "sigorta", "yerlesik", "oyuncu_isletme", "kamu", "lonca_kasa", "diger"] as const).map((id) => ({ id, deger: null }));

/** Kalemlerin toplamı; biri bile ölçülmediyse `null` (eksik toplam uydurma sayı verirdi). */
function topla(w: World | null, kalemler: readonly (readonly [string, CopyKey, keyof World])[]): number | null {
  if (!w) return null;
  let top = 0;
  for (const [, , alan] of kalemler) {
    const v = w[alan];
    if (!sonlu(v)) return null;
    top += v;
  }
  return top;
}

/**
 * Para ve sahiplik (D11 + PLAN-TAKIP): para stokunun iki görünümü (kime ait / hangi hesapta; varsayılan sahiplik, blok yoksa hesap),
 * loncalar tablosu, mevduat sahipleri, kredi ve tahvil stoku, firma sahipliği, haftalık kesimden kesime akış, şehir kasalarının gelir ve gider kalemleri, hayalet işletme sayısı.
 */
export function ParaDagilimiPaneli({ weeks, cur, isLive, onAc }: Props) {
  const w = cur?.world ?? null;
  const holdings = cur?.holdings;
  const [secim, setSecim] = useState<Gorunum | null>(null);
  const gorunum: Gorunum = secim ?? (holdings ? "sahiplik" : "hesap");
  const sahip = sahiplikGorunumu(w, holdings);
  const olculuyor = weeks.some((p) => sonlu(p.world.money_households) || sonlu(p.world.city_in_tax) || sonlu(p.world.ghost_firms));
  const stok = topla(w, KESIMLER);
  const gelir = topla(w, GELIRLER);
  const gider = topla(w, GIDERLER);
  const net = gelir !== null && gider !== null ? gelir - gider : null;
  const satir = (id: string, etiket: CopyKey, deger: string) => (
    <div key={id} className={styles.olcu} data-para={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
    </div>
  );
  const kesim = (alan: keyof World) => {
    const v = w?.[alan];
    if (!sonlu(v)) return goster(null, sayi);
    return stok !== null && stok > 0 ? `${sayi(v)} (${oran1(v / stok)})` : sayi(v);
  };
  const sahipSatir = (id: SahipSatirId | "toplam" | "kredi", deger: number | null) => (
    <div key={id} className={`${sahipStiller.satir}${id === "toplam" ? ` ${sahipStiller.toplam}` : ""}`} data-para={`sahip_${id}`}>
      <dt className={styles.etiket}>{t(`canli.sahiplik.sahip.${id}` as CopyKey)}</dt>
      <dd className={sahipStiller.deger}>{goster(deger, sayi)}</dd>
      <dd className={sahipStiller.tanim}>{t(`canli.sahiplik.sahip.${id}_tanim` as CopyKey)}</dd>
    </div>
  );
  return (
    <section aria-label={t("canli.sahiplik.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("canli.sahiplik.baslik")}</h2>
      <p className={styles.kucuk}>{t("canli.sahiplik.alt")}</p>
      <Sekmeler
        etiket={t("canli.sahiplik.gorunum")} onek="para-gorunum" secili={gorunum} onSec={(id) => setSecim(id as Gorunum)}
        sekmeler={[
          { id: "sahiplik", baslik: t("canli.sahiplik.sekme.sahiplik"), alt: t("canli.sahiplik.sekme.sahiplik_alt") },
          { id: "hesap", baslik: t("canli.sahiplik.sekme.hesap"), alt: t("canli.sahiplik.sekme.hesap_alt") },
        ]}
      />
      <div role="tabpanel" id={sekmePaneliKimligi("para-gorunum")} aria-labelledby={sekmeKimligi("para-gorunum", gorunum)} className={styles.bolum}>
        {gorunum === "sahiplik" ? (
          <>
            <h3 className={styles.kucuk}>{t("canli.sahiplik.sahip.baslik")}</h3>
            <dl className={sahipStiller.satirlar}>
              {(sahip?.satirlar ?? SAHIP_YOK).map((r) => sahipSatir(r.id, r.deger))}
              {sahipSatir("toplam", sahip?.toplam ?? null)}
              {sahip?.krediDisarida != null ? sahipSatir("kredi", sahip.krediDisarida) : null}
            </dl>
            {!sahip || sahip.toplam === null ? <p className={sahipStiller.tanim}>{t(isLive ? "canli.sahiplik.olculmuyor.live" : "canli.sahiplik.olculmuyor")}</p> : null}
          </>
        ) : (
          <>
            <h3 className={styles.kucuk}>{t("canli.para.kesim.baslik")}</h3>
            <p className={sahipStiller.tanim}>{t("canli.sahiplik.hesap.tanim")}</p>
            <dl className={styles.serit}>{KESIMLER.map(([id, etiket, alan]) => satir(id, etiket, kesim(alan)))}</dl>
            <LoncaHesapKirilimi holdings={holdings} isLive={isLive} />
          </>
        )}
      </div>
      <LoncaTablosu holdings={holdings} isLive={isLive} onAc={onAc} />
      <MevduatSahipleriBolumu holdings={holdings} isLive={isLive} />
      <KrediTahvilStoku holdings={holdings} isLive={isLive} />
      <FirmaSahipligi holdings={holdings} isLive={isLive} />
      <KesimAkisi holdings={holdings} isLive={isLive} />
      <p className={styles.kucuk}>{t("canli.para.alt")}</p>
      <h3 className={styles.kucuk}>{t("canli.para.gelir.baslik")}</h3>
      <dl className={styles.serit}>
        {GELIRLER.map(([id, etiket, alan]) => satir(id, etiket, goster(w?.[alan], sayi)))}
        {satir("gelir_toplam", "canli.para.gelir.toplam", goster(gelir, sayi))}
      </dl>
      <h3 className={styles.kucuk}>{t("canli.para.gider.baslik")}</h3>
      <dl className={styles.serit}>
        {GIDERLER.map(([id, etiket, alan]) => satir(id, etiket, goster(w?.[alan], sayi)))}
        {satir("gider_toplam", "canli.para.gider.toplam", goster(gider, sayi))}
        {satir("net", "canli.para.net", goster(net, sayi))}
      </dl>
      <dl className={styles.serit}>
        {satir("hayalet", "canli.para.hayalet", goster(w?.ghost_firms, sayi))}
        {satir("hayalet_kapanan", "canli.para.hayalet.kapanan", goster(w?.ghost_closed, sayi))}
      </dl>
      {weeks.length > 0 && !olculuyor ? <p className={styles.kucuk}>{t(isLive ? "canli.para.olculmuyor.live" : "canli.para.olculmuyor")}</p> : null}
    </section>
  );
}
