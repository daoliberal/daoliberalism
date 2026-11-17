"use client";
import { useRef, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import type { Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { cx } from "@/components/primitives/cx";
import { GirisBinalariBaglami, ISTENEN_BINALAR } from "./girisBinalari";
import renkler from "./ekranRenkleri.module.css";
import { SolukSehirZemini } from "./SolukSehirZemini";
import { useBinaResimleri } from "./useBinaResimleri";
import styles from "./GirisKabi.module.css";

/**
 * Giriş ekranlarının tam ekran kabuğu (Başlangıç, DAO girişi, Kurucu kurulumu): arkada soluk şehir, üstte küçük çubuk
 * (Geri ya da marka, tema düğmesi), ortada içerik. İçerik uzunsa kabuk kayar, zemin yerinde kalır.
 * `ust`: içerik yukarıdan başlar (uzun kurulum); yoksa dikey ortalanır.
 */
export function GirisKabi({ tercih, geri, ust, children }: { tercih: Tercih; geri?: boolean; ust?: boolean; children: ReactNode }) {
  const kok = useRef<HTMLDivElement>(null);
  const { go } = useHashRoute();
  const resimler = useBinaResimleri(kok, tercih.tema, ISTENEN_BINALAR);
  return (
    <div ref={kok} className={cx(renkler.kok, styles.kap)} data-giris-kabi>
      <GirisBinalariBaglami.Provider value={resimler}>
        <SolukSehirZemini />
        <header className={styles.cubuk}>
          {geri ? (
            <Button variant="secondary" size="sm" onClick={() => go({ name: "baslangic" })}>
              {t("giris.geri")}
            </Button>
          ) : (
            <span className={styles.marka}>{t("giris.marka")}</span>
          )}
          <div className={styles.tercihler}>
            <Button variant="toggle" size="sm" pressed={tercih.azalt} onClick={tercih.toggleAzalt}>
              {tercih.azalt ? t("ustcubuk.hareket_azaltildi") : t("ustcubuk.hareket_azalt")}
            </Button>
            <Button variant="secondary" size="sm" onClick={tercih.toggleTema}>
              {tercih.tema === "dark" ? t("ustcubuk.tema_acik") : t("ustcubuk.tema_koyu")}
            </Button>
          </div>
        </header>
        <main aria-label={t("app.ana")} className={styles.icerik}>
          <div className={cx(styles.merkez, ust && styles.ust)}>{ust ? <div className={styles.panel}>{children}</div> : children}</div>
        </main>
      </GirisBinalariBaglami.Provider>
    </div>
  );
}
