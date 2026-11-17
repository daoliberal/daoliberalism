"use client";
import { useId } from "react";
import { t } from "@/oyun/copy/t";
import { formatValue } from "@/oyun/sim/formatValue";
import type { Registry, RegistryCard, World } from "@/oyun/sim/types";
import styles from "./Piyasa.module.css";

export const PIYASA_KATMANI = "S";
/** Yıllık enflasyon yıl-üstü-yıl hesaplandığı için ilk bu kadar hafta ölçülmez (açılış dönemi). */
export const ENFLASYON_ACILIS_HAFTASI = 65;

export const piyasaKartlari = (registry: Registry): RegistryCard[] => registry.cards.filter((c) => c.layer === PIYASA_KATMANI);

export type PiyasaVerisi = {
  /** Koşunun ilk haftasının dünyası (başlangıç); yoksa henüz gelmedi. */
  baslangic: World | null;
  /** Son paketin dünyası; yoksa henüz gelmedi. */
  simdi: World | null;
  /** Son paketin haftası (açılış dönemi notu için). */
  week?: number;
};

/** Ölçülen oranlar kesirdir; kartın birimi yüzde ise yüzde sayısına çevrilir. Ölçülmeyen (`null`) değer için `null`. */
export function piyasaMetni(registry: Registry, card: RegistryCard, world: World | null): string | null {
  const alan = card.source_world_field as keyof World | null;
  if (!alan || world === null) return null;
  const v = world[alan];
  if (v === null || v === undefined) return null;
  const c = card.control;
  const yuzde = c.type === "number" && (c.unit === "yuzde" || c.unit === "yuzde_hafta");
  return formatValue(c, yuzde ? yuzdeSayisi(v) : v, registry.units);
}

/** Kesir (0,031) -> yüzde sayısı (3,1); en çok dört ondalık. */
export const yuzdeSayisi = (kesir: number): number => Math.round(kesir * 100 * 1e4) / 1e4;

/** "%3,1" biçiminde yüzde metni (kayıttaki `yuzde` birim şablonundan). */
export const yuzdeMetni = (registry: Registry, kesir: number): string => formatValue({ type: "number", min: 0, max: 1000, step: 0.01, unit: "yuzde", integer: false }, yuzdeSayisi(kesir), registry.units);

function Hucre({ metin, bekliyor }: { metin: string | null; bekliyor: boolean }) {
  if (bekliyor) return <span>{t("piyasa.kosu_baslayinca")}</span>;
  if (metin === null) {
    return (
      <>
        <span aria-hidden="true">{t("piyasa.yok_isareti")}</span>
        <span className={styles.gorunmez}>{t("piyasa.olculmuyor")}</span>
      </>
    );
  }
  return <>{metin}</>;
}

/**
 * C katmanı (Piyasa): oyuncunun seçmediği göstergeler (S kartları). Kurucu'da koşu olmadığı için değerler "Koşu başlayınca görünür";
 * canlıda başlangıç (ilk hafta) ve son paket yan yana. Ölçülmeyen değer "–" ve ekran okuyucuya "ölçülmüyor".
 */
export function Piyasa({ registry, veri, kimlik }: { registry: Registry; veri?: PiyasaVerisi; kimlik(id: string): string }) {
  const uid = useId();
  const kartlar = piyasaKartlari(registry);
  const var_ = veri !== undefined && (veri.baslangic !== null || veri.simdi !== null);
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      {var_ ? null : <p className={styles.not}>{t("piyasa.baslangic")}</p>}
      <h3 id={`${uid}-baslik`} className={styles.baslik}>{t("piyasa.baslik")}</h3>
      <p className={styles.giris}>{t(var_ ? "piyasa.giris_canli" : "piyasa.giris_kurucu")}</p>
      {kartlar.length === 0 ? (
        <p className={styles.not}>{t("piyasa.bos")}</p>
      ) : (
        <div className={styles.kaydir} role="region" aria-label={t("piyasa.tablo_bolge")} tabIndex={0}>
          <table className={styles.tablo}>
            <caption className={styles.gorunmez}>{t("piyasa.tablo")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("piyasa.sutun_deger")}</th>
                <th scope="col">{t("piyasa.sutun_baslangic")}</th>
                {var_ ? <th scope="col">{t("piyasa.sutun_simdi")}</th> : null}
                <th scope="col">{t("piyasa.sutun_nasil")}</th>
              </tr>
            </thead>
            <tbody>
              {kartlar.map((c) => {
                const acilis = c.source_world_field === "inflation_yoy" && veri?.simdi != null && veri.simdi.inflation_yoy === null && (veri.week ?? 0) <= ENFLASYON_ACILIS_HAFTASI;
                const faizinGordugu = acilis && veri?.simdi?.policy_inflation != null ? veri.simdi.policy_inflation : null;
                return (
                  <tr key={c.id} id={kimlik(c.id)} tabIndex={-1} aria-label={c.title} className={styles.satir}>
                    <th scope="row" className={styles.ad}>{c.title}</th>
                    <td className={styles.sayi}>
                      <Hucre metin={piyasaMetni(registry, c, veri?.baslangic ?? null)} bekliyor={!var_ || veri?.baslangic === null} />
                    </td>
                    {var_ ? (
                      <td className={styles.sayi}>
                        <Hucre metin={piyasaMetni(registry, c, veri?.simdi ?? null)} bekliyor={veri?.simdi === null} />
                        {acilis ? <span className={styles.ekle}>{t("piyasa.acilis_enflasyon", { hafta: ENFLASYON_ACILIS_HAFTASI + 1 })}</span> : null}
                        {faizinGordugu !== null ? <span className={styles.ekle}>{t("piyasa.faiz_enflasyonu", { n: yuzdeMetni(registry, faizinGordugu) })}</span> : null}
                      </td>
                    ) : null}
                    <td className={styles.nasil}>{c.what}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
