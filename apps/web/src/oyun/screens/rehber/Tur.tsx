"use client";
import { useId } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { KartGosterimi } from "@/oyun/screens/sart/KuralListesi";
import { degisebilir, kartDurumu } from "@/oyun/screens/sart/sartMantik";
import type { Availability, Registry, SettingAvail, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import styles from "./Rehber.module.css";
import type { TurAdimi } from "./turAdimlari";

type Props = {
  registry: Registry;
  adimlar: TurAdimi[];
  /** Geçerli adım (0 tabanlı); durum Kurucu'dadır ki tur kapanıp açılınca kaldığı yerden sürsün. */
  adim: number;
  onAdim(i: number): void;
  /** Şablonun doldurduğu tam taban ve Şart taslağı: kartlar Kurucu taslağını doğrudan değiştirir. */
  base: ValuesPatch;
  draft: ValuesPatch;
  onDraft(next: ValuesPatch): void;
  settings: SettingAvail[];
  durationWeeks: number;
  availability: Availability;
  /** Turu bitirir (görüldü işaretlenir). */
  onBitir(): void;
  /** Son adımda "Şimdi oyna": turu bitirir ve başlatma adımına geçer. */
  onOyna(): void;
};

/**
 * Kural turu: katman girişleri ve kural kartları, her kart kendi denetimiyle (Kurucu taslağını değiştirir). Kart metni kayıttan gelir;
 * "Varsayılan kalsın" kartı tabana döndürüp ilerler, "Sonraki" seçili değeri koruyup ilerler. Adım değişince odak kutuya alınır.
 */
export function Tur({ registry, adimlar, adim, onAdim, base, draft, onDraft, settings, durationWeeks, availability, onBitir, onOyna }: Props) {
  const uid = useId();
  const i = Math.min(Math.max(adim, 0), adimlar.length - 1);
  const a = adimlar[i];
  if (a === undefined) return null;
  const son = i === adimlar.length - 1;
  const kart = a.tur === "kart" ? registry.cards.find((c) => c.id === a.cardId) : undefined;

  const yazilabilir = (id: string) => {
    const c = registry.cards.find((x) => x.id === id);
    return c !== undefined && degisebilir(kartDurumu(c, "builder", settings.find((s) => s.id === id)), c) ? c : null;
  };
  const sec = (id: string, v: UIValue): void => {
    if (yazilabilir(id)) onDraft({ ...draft, [id]: v });
  };
  const sifirla = (id: string): void => {
    const c = yazilabilir(id);
    if (c) onDraft({ ...draft, [id]: id in base ? base[id]! : c.default });
  };
  const grup = kart ? (registry.groups.find((g) => g.id === kart.group)?.title ?? "") : "";
  const baslik = a.tur === "giris" ? t(a.baslikKey) : kart ? (grup !== "" ? t("rehber.tur.baslik", { grup, kural: kart.title }) : kart.title) : "";

  return (
    <Diyalog baslik={baslik} onKapat={onBitir} kapatMetni={t("rehber.tur.bitir")} kapatSonda odakAnahtari={String(i)}>
      <div className={styles.tur}>
        <p className={styles.no}>{t("rehber.tur.no", { n: i + 1, toplam: adimlar.length })}</p>
        {a.tur === "giris" ? (
          <p className={styles.metin}>{t(a.textKey)}</p>
        ) : kart ? (
          <>
            <h3 className={styles.cerceve}>{t(a.textKey)}</h3>
            <KartGosterimi
              uid={uid} card={kart} registry={registry} base={base} draft={draft} mode="builder" settings={settings} durationWeeks={durationWeeks}
              seciliId={null} onChange={sec} onReset={sifirla} gecis={{ availability }}
            />
          </>
        ) : null}
        <div className={styles.dugmeler}>
          {son ? (
            <Button variant="primary" onClick={onOyna}>
              {t("rehber.tur.oyna")}
            </Button>
          ) : a.tur === "giris" ? (
            <Button variant="primary" onClick={() => onAdim(i + 1)}>
              {t("rehber.tur.ilerle")}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { if (kart) sifirla(kart.id); onAdim(i + 1); }}>
                {t("rehber.tur.varsayilan")}
              </Button>
              <Button variant="primary" onClick={() => onAdim(i + 1)}>
                {t("rehber.tur.sonraki")}
              </Button>
            </>
          )}
        </div>
      </div>
    </Diyalog>
  );
}
