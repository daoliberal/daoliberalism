"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { stilAcik } from "@/oyun/screens/stil/stilYardim";
import { binaAnahtari } from "@/oyun/ekran/useBinaResimleri";
import { KART_SIMGELERI, SUS_ALT, useGirisBinalari } from "@/oyun/ekran/girisBinalari";
import { cx } from "@/components/primitives/cx";
import { turGoruldu } from "@/oyun/screens/rehber/rehberDurumu";
import { loadLibrary } from "@/oyun/sim/library";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { BantEylemleri } from "@/oyun/ui/BantEylemleri";
import { KayitDugmesi } from "@/oyun/ui/KayitDugmesi";
import { ACIK_DEPO, YETENEKLER } from "@/oyun/yetenekler";
import styles from "./Baslangic.module.css";

/** Kart simgesi: haritanın gerçek bina çizimi (yüklenene dek boş kutu); süstür. */
function Simge({ k }: { k: keyof typeof KART_SIMGELERI }) {
  const [sablon, boy] = KART_SIMGELERI[k];
  const url = useGirisBinalari()[binaAnahtari(sablon, boy)];
  return (
    <div className={styles.simge} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob adresi, süs */}
      {url !== undefined ? <img src={url} alt={SUS_ALT} className={styles.simgeResim} /> : null}
    </div>
  );
}

/** Başlangıç başlığı: kaynak yüklenirken de görünür (OyunApp çizer). */
export function BaslangicBaslik() {
  return (
    <>
      <h1 className={styles.baslik}>{t("baslangic.baslik")}</h1>
      <p className={styles.altBaslik}>{t("baslangic.alt_baslik")}</p>
    </>
  );
}

/** Stil bağlantısı `#/stil` sayfasını açan koşulla (`stilAcik`) çizilir; ilk çizimde değil, bağlandıktan sonra (statik çıktıyla uyumlu). */
const stilGorunur = (): boolean => stilAcik();

const abonesiz = (): (() => void) => () => undefined;

/** Başlangıç (tam ekran giriş kabuğunun içinde): üç oyun kartı (Kurucu, DAO, Evren) ve alt sırada (kayıtlı koşu varsa) Koşular. Tema düğmesi kabuktadır. */
export function Baslangic() {
  const { go } = useHashRoute();
  const stilBaglantisi = useSyncExternalStore(abonesiz, stilGorunur, () => false);
  const source = useSimSource();
  // Kütüphanede kayıtlı koşu varsa (bu tarayıcıda) Koşular düğmesi de görünür.
  const [kosuVar, setKosuVar] = useState(() => loadLibrary().runs.length > 0);
  // Sunucuda açık bir DAO koşusu varsa (en yenisi) DAO kartında "Oyuna dön" görünür.
  const [daoKosu, setDaoKosu] = useState<string | null>(null);
  // Tur bu tarayıcıda görülmediyse (ya da depolama erişilemiyorsa) ilk oyun önerilir; ilk çizimde değil, bağlandıktan sonra (statik çıktıyla uyumlu).
  const oner = useSyncExternalStore(abonesiz, () => !turGoruldu(), () => false);
  useEffect(() => {
    let live = true;
    if (source.listRuns) {
      source.listRuns().then(
        (l) => {
          if (!live) return;
          if (l.length > 0) setKosuVar(true);
          setDaoKosu(l.filter((h) => h.state.mode === "dao" && h.state.status !== "failed").at(-1)?.runId ?? null);
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [source]);

  return (
    <section className={styles.baslangic}>
      <div className={styles.kartlar}>
        <div role="group" aria-labelledby="baslangic-kurucu" className={styles.kart}>
          <Simge k="kurucu" />
          <h2 id="baslangic-kurucu" className={styles.kartAd}>{t("baslangic.kurucu_ad")}</h2>
          <p className={styles.ac}>{t("baslangic.kurucu_ac")}</p>
          <div className={styles.dugmeler}>
            <Button variant="primary" onClick={() => go({ name: "kurucu" })}>
              {t("baslangic.kurucu_dugme")}
            </Button>
            <Button variant="secondary" onClick={() => go({ name: "kurucu", rehberli: true })}>
              {t("baslangic.rehberli")}
            </Button>
          </div>
          {oner ? <p className={styles.not}>{t("rehber.oner")}</p> : null}
        </div>
        <div role="group" aria-labelledby="baslangic-dao" className={styles.kart}>
          <Simge k="dao" />
          <h2 id="baslangic-dao" className={styles.kartAd}>{t("baslangic.dao_ad")}</h2>
          <p className={styles.ac}>{t("baslangic.dao_ac")}</p>
          <div className={styles.dugmeler}>
            <Button variant="primary" onClick={() => go({ name: "dao" })}>
              {t("baslangic.dao_dugme")}
            </Button>
            {daoKosu !== null ? (
              <Button variant="secondary" onClick={() => go({ name: "dao", runId: daoKosu })}>
                {t("baslangic.dao_devam")}
              </Button>
            ) : null}
          </div>
        </div>
        <div role="group" aria-labelledby="baslangic-evren" className={cx(styles.kart, styles.pasif)}>
          <Simge k="evren" />
          <h2 id="baslangic-evren" className={styles.kartAd}>{t("baslangic.evren_ad")}</h2>
          <p className={styles.ac}>{t("baslangic.evren_ac")}</p>
          <div className={styles.dugmeler}>
            <Button variant="secondary" disabled>
              {t("baslangic.yakinda")}
            </Button>
          </div>
        </div>
      </div>
      <div className={styles.altSira}>
        {kosuVar ? (
          <Button variant="secondary" size="sm" onClick={() => go({ name: "kosular" })}>
            {t("baslangic.kosular")}
          </Button>
        ) : null}
        <KayitDugmesi />
        {stilBaglantisi ? <a href="#/stil" className={styles.baglanti}>{t("baslangic.stil")}</a> : null}
      </div>
      {/* Tarayici kipi: acik kod bilgi satiri (sunucu/onizleme derlemesinde cizilmez). */}
      {YETENEKLER.yerelKayit ? (
        <p className={styles.not}>
          {t("acikkod.satir")}
          <BantEylemleri>
            <a href={ACIK_DEPO} target="_blank" rel="noopener noreferrer" className={styles.baglanti}>{t("acikkod.baglanti")}</a>
          </BantEylemleri>
        </p>
      ) : null}
    </section>
  );
}
