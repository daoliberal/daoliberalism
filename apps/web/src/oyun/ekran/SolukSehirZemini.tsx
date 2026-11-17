"use client";
import { binaAnahtari } from "./useBinaResimleri";
import { SUS_ALT, useGirisBinalari, ZEMIN_BINALARI } from "./girisBinalari";
import styles from "./SolukSehirZemini.module.css";

/** Döşeme sayısı: büyük ekranı da doldurur, fazlası kırpılır. */
const DOSEME_SAYISI = 260;
/** Her kaçıncı döşeme boş kalır (sokak/meydan hissi). */
const BOS_ARALIK = 4;

/** Döşeme `i` için çizim sırası (deterministik; komşular birbirini tekrar etmez). */
const sira = (i: number): number => (i * 5 + Math.floor(i / 7) * 3) % ZEMIN_BINALARI.length;

/**
 * Giriş ekranlarının zemini: haritanın gerçek bina çizimleri, bulanık ve soluk. Yalnız süstür:
 * ekran okuyuculardan gizli, tıklanmaz. Hareketi yoktur (azaltma tercihi için ayrıca bir şey gerekmez).
 */
export function SolukSehirZemini() {
  const resimler = useGirisBinalari();
  return (
    <div className={styles.zemin} aria-hidden="true" data-testid="soluk-sehir-zemini">
      <div className={styles.doseme}>
        {Array.from({ length: DOSEME_SAYISI }, (_, i) => {
          const [sablon, boy] = ZEMIN_BINALARI[sira(i)]!;
          const url = i % BOS_ARALIK === 3 ? undefined : resimler[binaAnahtari(sablon, boy)];
          return (
            <div key={i} className={styles.hucre}>
              {/* eslint-disable-next-line @next/next/no-img-element -- blob adresi, süs */}
              {url !== undefined ? <img src={url} alt={SUS_ALT} className={styles.bina} /> : null}
            </div>
          );
        })}
      </div>
      <div className={styles.ortu} />
    </div>
  );
}
