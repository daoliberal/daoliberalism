import { cx } from "@/components/primitives/cx";
import { t, type CopyKey } from "@/oyun/copy/t";
import { OLCULER } from "@/oyun/screens/canli/olcu";
import { num, pct } from "@/oyun/lib/format";
import { akisOzeti, iseAlimOzeti, isgucuOzeti, issizlikOzeti, kurulumOzeti, paraOzeti, type SeriOzeti } from "@/oyun/sim/result";
import type { GoalResult, RunResult, WeekPacket } from "@/oyun/sim/types";
import { ondalikAsagi } from "./sonucMantik";
import styles from "./Sonuc.module.css";

const olcu = (id: "gini") => OLCULER.find((o) => o.id === id)!;

/** Etiketin ölçüsü: hedefe göre bir kısa ifade ("çöküş yok", "ortalama %15", ...). */
function detay(g: GoalResult): string {
  if (g.id === "alive") return g.value === null ? t("sonuc.karne.alive_yok") : t("sonuc.karne.alive_cokus", { n: g.value });
  if (g.value === null) return t("sonuc.karne.deger_yok");
  if (g.id === "serve") return t("sonuc.karne.serve", { n: pct(g.value, 0) });
  if (g.id === "kasa") return t(`sonuc.karne.${g.basis === "city" ? "kasa_sehir" : "kasa"}${g.floorApplied === false ? "_esik" : ""}`, { n: ondalikAsagi(g.value), taban: g.floor === undefined ? "?" : ondalikAsagi(g.floor) });
  return t("sonuc.karne.gini", { n: olcu("gini").goster(g.value) });
}

const durumAnahtari = (g: GoalResult): CopyKey => (g.met === true ? "sonuc.karne.met" : g.met === false ? "sonuc.karne.missed" : g.reason === "unmeasured" ? "sonuc.karne.unmeasured" : "sonuc.karne.pending");

/** Şart hedefleri karnesi: dört hedefin durumu; seçilmeyen hedef de hesaplanır ve "(seçilmedi)" ile gösterilir. */
export function HedefKarnesi({ result, duration, weeks }: { result: RunResult; duration: number; weeks?: WeekPacket[] }) {
  const issizlik = weeks ? issizlikOzeti(weeks) : null;
  const iseAlim = weeks ? iseAlimOzeti(weeks) : null;
  const kurulum = weeks ? kurulumOzeti(weeks) : null;
  const akis = weeks ? akisOzeti(weeks) : null;                                     // D10: iş bulma oranı, işsizlik süresi, toplam işe alım ve ayrılma
  const para = weeks ? paraOzeti(weeks) : null;                                     // D11: son haftanın para payları, hayalet işletme
  const isgucu = weeks ? isgucuOzeti(weeks) : null;                                // D9: yalnız hane kipinde (bakmakla yükümlü NPC varsa) gösterilir
  const haneVar = isgucu !== null && isgucu.katilim !== null && isgucu.bagimli !== null && isgucu.bagimli > 0;
  const yok = t("sonuc.karne.unmeasured");
  const pay = (v: number | null) => (v === null ? "?" : pct(v, 1));
  const toplam = (o: SeriOzeti | null | undefined) => (o ? t("sonuc.karne.toplam_issizlik_detay", { son: pct(o.son, 1), zirve: pct(o.zirve, 1), hafta: o.zirveHafta }) : yok);
  const tuketemeyen = (o: SeriOzeti | null | undefined) => (o ? t("sonuc.karne.tuketemeyen_npc_detay", { son: num(o.son), zirve: num(o.zirve), hafta: o.zirveHafta }) : yok);
  return (
    <section className={styles.panel} aria-labelledby="sonuc-karne">
      <h3 id="sonuc-karne" className={styles.altBaslik}>{t("sonuc.karne.baslik")}</h3>
      <ul className={styles.satirlar} aria-label={t("sonuc.karne.liste")}>
        {result.goals.map((g) => {
          const durum = t(durumAnahtari(g));
          return (
            <li key={g.id} className={styles.satir}>
              <span className={styles.satirMetin}>{t("sonuc.karne.satir", { hedef: t(`kurucu.hedef.${g.id}`, { n: duration }), detay: detay(g) })}</span>
              <span className={cx(styles.durum, g.met === true ? styles.tutturuldu : g.met === false ? styles.tutturulamadi : styles.belirsiz)}>
                {g.selected ? durum : t("sonuc.karne.secilmedi", { durum })}
              </span>
            </li>
          );
        })}
      </ul>
      {issizlik ? (
        <ul className={styles.satirlar} aria-label={t("sonuc.karne.issizlik_liste")}>
          <li className={styles.satir} data-karne="toplam_issizlik">
            <span className={styles.satirMetin}>{t("sonuc.karne.satir", { hedef: t("sonuc.karne.toplam_issizlik"), detay: toplam(issizlik.toplam) })}</span>
          </li>
          <li className={styles.satir} data-karne="tuketemeyen_npc">
            <span className={styles.satirMetin}>{t("sonuc.karne.satir", { hedef: t("sonuc.karne.tuketemeyen_npc"), detay: tuketemeyen(issizlik.tuketemeyen) })}</span>
          </li>
        </ul>
      ) : null}
      {iseAlim && (iseAlim.oyuncu || iseAlim.npcIstihdam) ? (
        <ul className={styles.satirlar} aria-label={t("sonuc.karne.ise_alim_liste")}>
          <li className={styles.satir} data-karne="oyuncu_artisi">
            <span className={styles.satirMetin}>
              {t("sonuc.karne.satir", {
                hedef: t("sonuc.karne.oyuncu_artisi"),
                detay: iseAlim.oyuncu ? t("sonuc.karne.oyuncu_artisi_detay", { ilk: num(iseAlim.oyuncu.ilk), son: num(iseAlim.oyuncu.son), yeni: num(iseAlim.oyuncu.yeni) }) : yok,
              })}
            </span>
          </li>
          <li className={styles.satir} data-karne="npc_istihdam">
            <span className={styles.satirMetin}>
              {t("sonuc.karne.satir", {
                hedef: t("sonuc.karne.npc_istihdam"),
                detay: iseAlim.npcIstihdam ? t("sonuc.karne.npc_istihdam_detay", { ilk: pct(iseAlim.npcIstihdam.ilk, 1), son: pct(iseAlim.npcIstihdam.son, 1) }) : yok,
              })}
            </span>
          </li>
        </ul>
      ) : null}
      {akis && akis.isBulma !== null ? (
        <ul className={styles.satirlar} aria-label={t("sonuc.karne.is_akislari")}>
          <li className={styles.satir} data-karne="is_akislari">
            <span className={styles.satirMetin}>
              {t("sonuc.karne.satir", {
                hedef: t("sonuc.karne.is_akislari"),
                detay: t("sonuc.karne.is_akislari_detay", { oran: pct(akis.isBulma, 1), sure: akis.sure === null ? "?" : num(akis.sure), alim: akis.alim === null ? "?" : num(akis.alim), ayrilma: akis.ayrilma === null ? "?" : num(akis.ayrilma) }),
              })}
            </span>
          </li>
        </ul>
      ) : null}
      {para ? (
        <ul className={styles.satirlar} aria-label={t("sonuc.karne.para_dagilimi")}>
          <li className={styles.satir} data-karne="para_dagilimi">
            <span className={styles.satirMetin}>
              {t("sonuc.karne.satir", {
                hedef: t("sonuc.karne.para_dagilimi"),
                detay: t("sonuc.karne.para_dagilimi_detay", {
                  hane: pay(para.hane), yerlesik: pay(para.yerlesik), oyuncu: pay(para.oyuncu), kasa: pay(para.kasa), lonca: pay(para.lonca),
                  hayalet: para.hayalet === null ? "?" : num(para.hayalet), kapanan: para.kapanan === null ? "?" : num(para.kapanan),
                }),
              })}
            </span>
          </li>
        </ul>
      ) : null}
      {kurulum && (kurulum.isletme || kurulum.doluluk || kurulum.acilis !== null || haneVar) ? (
        <ul className={styles.satirlar} aria-label={t("sonuc.karne.kurulum_liste")}>
          <li className={styles.satir} data-karne="isletme_sayisi">
            <span className={styles.satirMetin}>
              {t("sonuc.karne.satir", {
                hedef: t("sonuc.karne.isletme"),
                detay: kurulum.isletme ? t("sonuc.karne.isletme_detay", { ilk: num(kurulum.isletme.ilk), son: num(kurulum.isletme.son) }) : yok,
              })}
            </span>
          </li>
          {kurulum.doluluk ? (
            <li className={styles.satir} data-karne="kadro_doluluk">
              <span className={styles.satirMetin}>
                {t("sonuc.karne.satir", { hedef: t("sonuc.karne.doluluk"), detay: t("sonuc.karne.doluluk_detay", { ilk: pct(kurulum.doluluk.ilk, 0), son: pct(kurulum.doluluk.son, 0) }) })}
              </span>
            </li>
          ) : null}
          {kurulum.acilis !== null ? (
            <li className={styles.satir} data-karne="acilis_kadrosu">
              <span className={styles.satirMetin}>
                {t("sonuc.karne.satir", { hedef: t("sonuc.karne.acilis"), detay: t("sonuc.karne.acilis_detay", { n: num(kurulum.acilis) }) })}
              </span>
            </li>
          ) : null}
          {haneVar && isgucu ? (
            <li className={styles.satir} data-karne="isgucu">
              <span className={styles.satirMetin}>
                {t("sonuc.karne.satir", { hedef: t("sonuc.karne.isgucu"), detay: t("sonuc.karne.isgucu_detay", { oran: pct(isgucu.katilim, 0), n: num(isgucu.bagimli) }) })}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
