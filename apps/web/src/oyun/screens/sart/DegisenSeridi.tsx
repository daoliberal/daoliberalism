"use client";
import { t } from "@/oyun/copy/t";
import type { Registry, UIValue } from "@/oyun/sim/types";
import { degerMetni } from "./sartMantik";
import styles from "./Sart.module.css";

export type Degisen = { id: string; from: UIValue; to: UIValue };

/**
 * "Kurallar: n · değiştirdiğin: m" şeridi ve değişen kuralların "eski → yeni" listesi. Liste öğeleri ilgili karta götürür.
 * Sayaç canlı bölgededir; ekran okuyucu her değişiklikte güncel sayıyı duyar.
 */
export function DegisenSeridi({ registry, toplam, degisenler, onGit, dunyaAdi, onDunya }: { registry: Registry; toplam: number; degisenler: Degisen[]; onGit(id: string): void; dunyaAdi?: string; onDunya?(): void }) {
  return (
    <div className={styles.serit}>
      <p className={styles.sayac} role="status">
        <strong>{t("sart.serit", { n: toplam, m: degisenler.length })}</strong>
        {dunyaAdi ? <span>{t("sart.serit_dunya", { ad: dunyaAdi })}</span> : null}
      </p>
      {dunyaAdi && onDunya ? (
        <p className={styles.bilgi}>
          <button type="button" className={styles.fark} onClick={onDunya}>{t("sart.senaryoyu_degistir")}</button>
        </p>
      ) : null}
      {degisenler.length === 0 ? (
        <p className={styles.bilgi}>{t("sart.degisen_yok")}</p>
      ) : (
        <ul className={styles.farklar} aria-label={t("sart.degisenler")}>
          {degisenler.map((d) => {
            const card = registry.cards.find((c) => c.id === d.id);
            if (!card) return null;
            return (
              <li key={d.id}>
                <button type="button" className={styles.fark} onClick={() => onGit(d.id)}>
                  {t("sart.fark", { ad: card.title, eski: degerMetni(registry, card, d.from), yeni: degerMetni(registry, card, d.to) })}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
