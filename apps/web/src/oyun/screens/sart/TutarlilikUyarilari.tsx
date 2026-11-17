"use client";
import { useId } from "react";
import { t } from "@/oyun/copy/t";
import { Banner } from "@/oyun/ui/Banner";
import type { Uyari } from "./ozelMantik";
import styles from "./SartOzel.module.css";

/**
 * Tutarlılık uyarıları (kayıttaki kurallardan): her uyarı ilgili karta götürür. Sayaç canlı bölgededir.
 * Kayıt kural yayımlamıyorsa (`kurallar === false`) bölüm hiç çizilmez; kural var ve uyarı yoksa "Çelişen kural yok." yazar.
 */
export function TutarlilikUyarilari({ uyarilar, onGit }: { uyarilar: Uyari[]; onGit(kart: string): void }) {
  const uid = useId();
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.bolumBaslik}>{t("sart.tutarlilik.baslik")}</h3>
      <p className={styles.kucuk} role="status">{uyarilar.length === 0 ? t("sart.tutarlilik.yok") : t("sart.tutarlilik.sayi", { n: uyarilar.length })}</p>
      {uyarilar.length > 0 ? (
        <ul className={styles.liste}>
          {uyarilar.map((u) => (
            <li key={u.id}>
              <Banner tone="warn" asItem>
                {u.text}
              </Banner>
              <button type="button" className={styles.uyariDugme} onClick={() => onGit(u.kart)}>
                {t("sart.tutarlilik.git_dugme", { ad: u.kartAd })}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
