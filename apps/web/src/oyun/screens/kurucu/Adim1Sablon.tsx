"use client";
import { useId } from "react";
import { Grid } from "@/components/primitives/Grid";
import { Pill } from "@/components/primitives/Pill";
import { t, type CopyKey } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { GecisDestegiKarti, type GecisSecenegi } from "@/oyun/screens/ortak/GecisDestegiKarti";
import type { Availability, Registry, SourceInfo } from "@/oyun/sim/types";
import styles from "./Kurucu.module.css";

export type SablonKarti = { id: string; ad: string; aciklama: string; secilebilir: boolean; /** Kayıtta var ama başlatılamayan şablonun doğrulanmamış kartlarının adları. */ engelli: string[]; varsayim: string | null };

const metin = (anahtar: string): string | null => (anahtar in tr ? tr[anahtar as CopyKey] : null);

/**
 * Şablon kartları: kaynağın kayıtlı şablonları seçilebilir; kayıtta (`registry.templates`) olup kaynakta olmayanlar kilitli kalır.
 * Ad ve açıklama önce arayüz metninden (`sablon.<kimlik>.*`), yoksa kayıttan gelir; ikisi de yoksa kart çizilmez.
 */
export function sablonKartlari(info: SourceInfo, registry: Registry | undefined): SablonKarti[] {
  const kayitli = new Set(info.templates.map((x) => x.id));
  const kimlikler = [...(registry?.templates.map((x) => x.id) ?? []), ...info.templates.map((x) => x.id)].filter((id, i, a) => a.indexOf(id) === i);
  const out: SablonKarti[] = [];
  for (const id of kimlikler) {
    const reg = registry?.templates.find((x) => x.id === id);
    const ad = metin(`sablon.${id}.name`) ?? reg?.title;
    if (!ad) continue;
    const baslik = (kid: string): string => registry?.cards.find((c) => c.id === kid)?.title ?? kid;
    const engelli = reg?.startable === false ? (reg.blocked_by ?? []).map(baslik) : [];
    const degisen = (reg?.behavior_changes ?? []).map(baslik);
    out.push({
      id, ad, aciklama: metin(`sablon.${id}.desc`) ?? reg?.what ?? "",
      secilebilir: kayitli.has(id) && reg?.startable !== false, engelli,
      varsayim: degisen.length > 0 ? t("sablon.varsayim", { n: degisen.length, kartlar: degisen.join(", ") }) : null,
    });
  }
  return out;
}

type Props = {
  kartlar: SablonKarti[];
  seciliId: string | undefined;
  onSec(id: string): void;
  gecis: GecisSecenegi;
  onGecis(v: GecisSecenegi): void;
  availability: Availability;
  /** Kayıt kaynağında (canlıda değil) güncel kayda ait olmayan eski ölçüm notları da gösterilir. */
  eskiOlcum: boolean;
};

/** Adım 1: şablon kartları ve şablonun doldurduğu Geçiş desteği değeri. */
export function Adim1Sablon({ kartlar, seciliId, onSec, gecis, onGecis, availability, eskiOlcum }: Props) {
  const uid = useId();
  return (
    <>
      <section className={styles.bolum} aria-labelledby={`${uid}-sablon`}>
        <h3 id={`${uid}-sablon`} className={styles.baslik}>
          {t("kurucu.sablon_etiket")}
        </h3>
        <p className={styles.metin}>{t("kurucu.adim1.giris")}</p>
        <Grid minItem="280" gap="16">
          {kartlar.map((x, i) => {
            const on = x.id === seciliId;
            const descId = `${uid}-sablon-${x.id}`;
            const kilitId = `${descId}-kilit`;
            const olcum = metin(`sablon.${x.id}.olcum`);
            const olcumEski = eskiOlcum ? metin(`sablon.${x.id}.olcum_eski`) : null;
            const varsayim = x.varsayim;
            return (
              <div key={x.id} className={styles.sablon}>
                <span className={styles.sablonUst}>
                  {t("kurucu.sablon_no", { n: i + 1 })}
                  {on ? <span className={styles.secili}>{t("kurucu.secili")}</span> : null}
                </span>
                <Pill
                  tone={on ? "chipOn" : "chip"}
                  aria-pressed={on}
                  disabled={!x.secilebilir}
                  aria-describedby={x.secilebilir ? descId : `${descId} ${kilitId}`}
                  onClick={() => onSec(x.id)}
                >
                  {x.ad}
                </Pill>
                <p id={descId} className={styles.metin}>
                  {x.aciklama}
                </p>
                {x.secilebilir ? null : (
                  <p id={kilitId} className={styles.kucuk}>
                    {x.engelli.length > 0 ? t("kurucu.adim1.kilit_dogrulanmadi", { kartlar: x.engelli.join(", ") }) : t("kurucu.adim1.kilit_kayitsiz")}
                  </p>
                )}
                {olcum ? (
                  <p className={styles.kucuk}>
                    {t("sablon.olcum_on")} {olcum}
                  </p>
                ) : null}
                {olcumEski ? <p className={styles.kucuk}>{olcumEski}</p> : null}
                {varsayim ? <p className={styles.kucuk}>{varsayim}</p> : null}
              </div>
            );
          })}
        </Grid>
      </section>
      <GecisDestegiKarti value={gecis} onChange={onGecis} availability={availability} />
    </>
  );
}
