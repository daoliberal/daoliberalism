"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { num } from "@/oyun/lib/format";
import { kasaGucuMetni, tecrubeSaymaz, type DaoAdlar, type DaoGozlem, type DaoIlan } from "@/oyun/sim/dao";
import type { KararDurumu } from "./DaoKararlar";
import styles from "./DaoEkrani.module.css";

/** Başvuru neden yapılamıyor (metin) ya da yapılabiliyor (null). Çalışan oyuncu başvurabilir (alınırsa eski işinden ayrılıp geçer, alınmazsa işi sürer); ahırdaki ve işletme sahibi başvuramaz. */
export function ilanEngeli(g: DaoGozlem): string | null {
  if (g.ben.durum === "ahir") return t("dao.ilan.ahirda");
  if (g.ben.durum === "kurucu") return t("dao.ilan.kurucu");
  return null;
}

/** İlan sırası: kasası zayıf ilanlar sona (kendi içinde sunucunun ücret sırası korunur). */
export function ilanSirasi(ilanlar: readonly DaoIlan[]): DaoIlan[] {
  return [...ilanlar.filter((i) => i.kasa_gucu !== "zayif"), ...ilanlar.filter((i) => i.kasa_gucu === "zayif")];
}

/** Tek ilan: işletme, sektör, ücret, açık kadro, kasa gücü (zayıf da gösterilir) ve açık "Başvur" düğmesi. */
export function IlanKarti({ ilan, g, ad, k }: { ilan: DaoIlan; g: DaoGozlem; ad: DaoAdlar; k: KararDurumu }) {
  const engel = ilanEngeli(g);
  const firma = ad.firma(ilan.ad, ilan.sektor);
  const sirada = k.sirada?.tur === "basvur" ? k.sirada : null;
  const [onayda, setOnayda] = useState(false);
  const zayif = ilan.kasa_gucu === "zayif";
  const gonder = (): void => { setOnayda(false); void k.gonder({ tur: "basvur", firma: ilan.firma }); };
  return (
    <div className={styles.ilan} data-ilan={ilan.firma} data-kasa-gucu={ilan.kasa_gucu}>
      <strong>{firma}</strong>
      <span className={styles.kucuk}>{t("dao.ilan.ucret", { n: num(ilan.ucret) })}</span>
      <span className={styles.kucuk}>{t("dao.ilan.acik", { n: num(ilan.acik) })}</span>
      <span className={ilan.kasa_gucu === "zayif" ? styles.uyari : styles.kucuk}>{t("dao.ilan.kasa", { durum: kasaGucuMetni(ilan.kasa_gucu) })}</span>
      {ilan.maas_odeyemedi ? <span className={styles.uyari}>{t("dao.ilan.maas_odeyemedi")}</span> : null}
      {ilan.kasa_gucu === "zayif" ? <span className={styles.kucuk}>{t("dao.ilan.zayif_uyari")}</span> : null}
      {tecrubeSaymaz(ilan.sektor) ? <span className={styles.kucuk} data-tecrube-saymaz={ilan.sektor}>{t("dao.ilan.tecrube_saymaz")}</span> : null}
      {engel !== null ? <span className={styles.kucuk}>{engel}</span> : null}
      {engel === null && g.ben.durum === "calisan" ? <span className={styles.kucuk}>{t("dao.ilan.calisiyorsun")}</span> : null}
      {sirada !== null && sirada.firma === ilan.firma ? <span className={styles.kucuk} role="status">{t("dao.ilan.sirada", { hafta: sirada.hafta })}</span> : null}
      {onayda && zayif ? <span className={styles.uyari} role="alert">{t("dao.ilan.zayif_onay")}</span> : null}
      <div className={styles.dugmeler}>
        {onayda && zayif ? (
          <>
            <Button variant="primary" size="sm" disabled={k.kapali || engel !== null || sirada !== null} onClick={gonder}>{t("dao.ilan.zayif_onayla")}</Button>
            <Button variant="secondary" size="sm" onClick={() => setOnayda(false)}>{t("dao.ilan.zayif_vazgec")}</Button>
          </>
        ) : (
          <Button variant="primary" size="sm" disabled={k.kapali || engel !== null || sirada !== null} aria-label={t("dao.ilan.basvur_etiket", { firma })} onClick={() => (zayif ? setOnayda(true) : gonder())}>
            {t("dao.ilan.basvur")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** "İş ilanları" sekmesi: şehirdeki açık ilanlar (ücrete göre azalan; kasası zayıf olanlar sona); dar panelde kart listesi. */
export function IlanListesi({ g, ad, k }: { g: DaoGozlem; ad: DaoAdlar; k: KararDurumu }) {
  if (g.ilanlar.length === 0) return <p className={styles.kucuk}>{g.hafta === 0 ? t("dao.ilan.bos_hafta0") : t("dao.ilan.bos")}</p>;
  return (
    <ul aria-label={t("dao.ilan.liste")} className={styles.ilanlar}>
      {ilanSirasi(g.ilanlar).map((i) => (
        <li key={i.firma}><IlanKarti ilan={i} g={g} ad={ad} k={k} /></li>
      ))}
    </ul>
  );
}

/** İlan veren binaya tıklayınca: o işletmenin ilanı ve "Başvur"; ilanı yoksa kısa not. */
export function IsletmeIlani({ firma, g, ad, k }: { firma: string; g: DaoGozlem; ad: DaoAdlar; k: KararDurumu }) {
  const ilan = g.ilanlar.find((i) => i.firma === firma);
  if (ilan === undefined) return null;
  return (
    <section className={styles.bolum} aria-label={t("dao.ilan.baslik")}>
      <h3 className={styles.altBaslik}>{t("dao.ilan.baslik")}</h3>
      <IlanKarti ilan={ilan} g={g} ad={ad} k={k} />
    </section>
  );
}
