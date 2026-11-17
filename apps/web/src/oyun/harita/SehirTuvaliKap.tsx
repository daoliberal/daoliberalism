"use client";
import dynamic from "next/dynamic";
import { cx } from "@/components/primitives/cx";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/oyun/copy/t";
import type { Adlandirici } from "./adlar";
import type { Pay } from "./gorunum";
import type { KameraKomutu } from "./HaritaSahnesi";
import { etkinSehirSahnesi, parselTuruOf, type IzoSahne } from "./izoSahne";
import { HaritaTablosu } from "./HaritaTablosu";
import styles from "./SehirHaritasi.module.css";
import type { Gorunum, HaritaRef, SehirSahnesi } from "./tipler";
import { useWebgl } from "./useWebgl";

const SehirTuvali = dynamic(() => import("./HaritaSahnesi").then((m) => ({ default: m.SehirTuvali })), { ssr: false });

type Props = {
  /** Etkin sahne (tuvalde çizilen): klasik ya da izometrik. Manifest ve görsel boy burada yoktur: sahneyi üst bileşen kurar. */
  sahne: SehirSahnesi | IzoSahne;
  /** Tablo her zaman klasik sahneden listelenir; yalnız "İşletme kur" hedefleri etkin sahneden gelir. */
  tabloSahnesi: SehirSahnesi;
  secili: HaritaRef | null;
  onSec(r: HaritaRef | null): void;
  kamera: Gorunum;
  onKamera(g: Gorunum): void;
  komut?: KameraKomutu | null;
  adlar?: Adlandirici;
  /** Oyun kabuğunda: tuval kaba tam oturur; tablo klavye odağıyla beliren yüzen panel (tuval yokken tam alan) olur. */
  kabuk?: boolean;
  /** Yüzen öğelerin kenar payları (sığdırma bu payların içine yapılır). */
  pay?: Pay;
  /** İzo çiziminde sprite/manifest hatası: üst bileşen klasik görünüme döner. */
  onSpriteHatasi?(): void;
  /** Manifest yükleniyor (`useGorunumModu` "bekle"): klasik çizim sürer, "Şehir yükleniyor" notu görünür. */
  yukleniyor?: boolean;
  /** Şehir (izo) görünümü istenmişti ama sprite/manifest hatasıyla sade görünüme düşüldü: kısa not. */
  dustu?: boolean;
};

/** Çizim atarsa tabloya düşer. */
class Sinir extends Component<{ children: ReactNode; onHata(): void }, { patladi: boolean }> {
  override state = { patladi: false };
  static getDerivedStateFromError(): { patladi: boolean } {
    return { patladi: true };
  }
  override componentDidCatch(): void {
    this.props.onHata();
  }
  override render(): ReactNode {
    return this.state.patladi ? null : this.props.children;
  }
}

/**
 * Tek şehir: tuval (WebGL varsa) ve her zaman erişilebilir liste. Kademeli yedek: izo çizim hatası (doku, manifest ya da çizim/render atması)
 * `onSpriteHatasi` ile bir kez yukarı bildirilir ve üst bileşen klasik sahneyi verir; klasik çizim de atarsa (ya da WebGL yoksa)
 * `harita.hata` notuyla liste açık kalır.
 */
export function SehirTuvaliKap({ sahne, tabloSahnesi, secili, onSec, kamera, onKamera, komut, adlar, kabuk = false, pay, onSpriteHatasi, yukleniyor = false, dustu = false }: Props) {
  const webgl = useWebgl();
  const [patladi, setPatladi] = useState(false);
  const tuvalde = webgl && !patladi;
  const izo = "kaynak" in sahne;
  const bildirildi = useRef(false);
  useEffect(() => {
    if (!izo) bildirildi.current = false;
  }, [izo]);
  // İzo çizim hatası: üst bileşen klasiğe döner (tek sefer); aksi halde (klasik çizim ya da bildirici yok) tablo yedeği açılır.
  const tuvalHata = useCallback(() => {
    if (izo && onSpriteHatasi) {
      if (bildirildi.current) return;
      bildirildi.current = true;
      onSpriteHatasi();
    } else setPatladi(true);
  }, [izo, onSpriteHatasi]);
  const ozet = useMemo(
    () => t("harita.aria_ozet", { sehir: tabloSahnesi.ad, isletme: tabloSahnesi.binalar.filter((b) => b.tur === "isletme").length, lonca: tabloSahnesi.binalar.filter((b) => b.tur === "lonca").length }),
    [tabloSahnesi],
  );
  // Durum renge/şekle ek olarak metinle de verilir: izo sahnede işletme durumları tabloda yazılır.
  const durumlar = useMemo(() => ("kaynak" in sahne ? new Map(sahne.binalar.filter((b) => b.tur === "isletme").map((b) => [b.id, b.durum] as const)) : undefined), [sahne]);
  return (
    <div className={cx(styles.tekSehir, kabuk && styles.kabuk)} role="region" aria-label={ozet}>
      {tuvalde ? (
        <Sinir key={izo ? "izo" : "klasik"} onHata={tuvalHata}>
          <SehirTuvali sahne={sahne} secili={secili} onSec={onSec} kamera={kamera} onKamera={onKamera} onHata={tuvalHata} {...(onSpriteHatasi ? { onSpriteHatasi } : {})} {...(komut ? { komut } : {})} {...(adlar ? { adlar } : {})} {...(pay ? { pay } : {})} />
        </Sinir>
      ) : null}
      {/* Sabit canlı bölge: metin içinde değişir (sonradan eklenen live region bazı okuyucularda okunmaz). */}
      <div role="status" className={styles.durumKap}>
        {patladi ? <p className={cx(styles.not, kabuk && styles.kabukNot)}>{t("harita.hata")}</p> : null}
        {tuvalde && yukleniyor ? <p className={cx(styles.not, kabuk && styles.kabukNot)}>{t("harita.yukleniyor")}</p> : null}
        {tuvalde && !yukleniyor && dustu ? <p className={cx(styles.not, kabuk && styles.kabukNot)}>{t("harita.sprite_hata")}</p> : null}
      </div>
      <details className={cx(styles.detay, kabuk && (tuvalde ? styles.detayYuzen : styles.detayTam))} open={!tuvalde}>
        <summary className={styles.ozetBaslik}>{t("harita.tablo")}</summary>
        <HaritaTablosu sahne={tabloSahnesi} {...(durumlar ? { durumlar } : {})} secili={secili} onSec={onSec} kurumlar bosParseller={etkinSehirSahnesi(sahne).bosParseller} parselTuru={(id) => parselTuruOf(sahne, id)} {...(adlar ? { adlar } : {})} />
      </details>
    </div>
  );
}
