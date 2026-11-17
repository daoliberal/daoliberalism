"use client";
import { useId } from "react";
import { Field } from "@/components/primitives/Field";
import { t } from "@/oyun/copy/t";
import type { AramaYeri } from "./aramaMantik";
import { ARAMA_EN_AZ } from "./sartMantik";
import styles from "./Sart.module.css";

/** Arama kutusu (bütün katmanlar) ve sonuç listesi; sonuç, kartın grubunu ve (uzmansa) uzman ayarlarını açıp karta götürür. */
export function KuralAra({ query, onQuery, results, total, onGit }: { query: string; onQuery(q: string): void; results: AramaYeri[]; total: number; onGit(id: string): void }) {
  const uid = useId();
  const active = [...query.trim()].length >= ARAMA_EN_AZ;
  return (
    <div className={styles.ara}>
      <Field
        kind="input" id={`${uid}-q`} label={t("sart.ara")} type="search" value={query} placeholder={t("sart.ara_ornek")}
        autoComplete="off" onChange={(e) => onQuery(e.target.value)}
      />
      <p className={styles.durum} role="status">
        {active ? (total === 0 ? t("sart.ara_yok") : t("sart.ara_sonuc_sayisi", { n: total })) : null}
      </p>
      {results.length > 0 ? (
        <ul className={styles.sonuclar} aria-label={t("sart.ara_sonuclar")}>
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className={styles.sonuc} onClick={() => onGit(r.id)}>
                <strong>{r.baslik}</strong>
                <span className={styles.bilgi}>{r.yer}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
