import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { kodNoktasinaKes } from "@/oyun/lib/names";
import { oyuncuKimligi } from "@/oyun/lib/oyuncuKimligi";
import { tarifKapaliNedeni, tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { decodeRecipe, encodeRecipe } from "@/oyun/sim/recipe";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import type { RunState } from "@/oyun/sim/types";
import styles from "./Sonuc.module.css";

const AD_EN_COK = 60;
const ACIKLAMA_EN_COK = 280;

function yayinHatasi(e: unknown): CopyKey {
  if (e instanceof SimUnsupported) {
    if (e.message === "sinir") return "yayinla.hata_sinir";
    if (e.message === "karar_gecersiz" || e.message === "invalid_config") return "yayinla.hata_gecersiz";
  }
  return "yayinla.hata";
}

/** Dünyayı yayınla: koşunun tarifi (ad ve şehir adları hariç) sunucuya konur, `/d/<kod>` bağlantısı verilir. Yalnız bitmiş koşuda, canlı kaynakta ve tarifi kurulabilen koşuda görünür. */
export function Yayinla({ state }: { state: RunState }) {
  const source = useSimSource();
  const { info } = useSourceInfo();
  const uid = useId();
  const [acik, setAcik] = useState(false);
  const [ad, setAd] = useState(kodNoktasinaKes(state.name, AD_EN_COK));
  const [aciklama, setAciklama] = useState("");
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<CopyKey | null>(null);
  const [yayin, setYayin] = useState<{ kod: string; baglanti: string } | null>(null);
  const [kopya, setKopya] = useState<"bosta" | "kopyalandi" | "elle">("bosta");
  const busy = useRef(false);
  const kapali = tarifKapaliNedeni(state);
  const tarif = useMemo(() => {
    if (kapali !== null) return null;
    const kod = encodeRecipe(tarifOf(state));
    if (!kod.ok) return null;
    const c = decodeRecipe(kod.code);
    return c.ok ? c.recipe : null;
  }, [state, kapali]);
  if (source.kind !== "live" || typeof source.dunyaYayinla !== "function" || state.mode === "dao" || state.status !== "ended" || kapali !== null || tarif === null) return null;
  const yayinla = source.dunyaYayinla.bind(source);
  const baglantiId = `${uid}-baglanti`;
  const tamBaglanti = yayin === null ? "" : new URL(yayin.baglanti, source.sunucuKoku?.() ?? window.location.origin).href;

  const gonder = (): void => {
    if (busy.current) return;
    busy.current = true;
    setMesgul(true);
    setHata(null);
    yayinla(tarif, ad.trim(), aciklama.trim(), oyuncuKimligi()).then(
      (y) => setYayin(y),
      (e: unknown) => setHata(yayinHatasi(e)),
    ).finally(() => {
      busy.current = false;
      setMesgul(false);
    });
  };
  const kopyala = async (): Promise<void> => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("pano yok");
      await navigator.clipboard.writeText(tamBaglanti);
      setKopya("kopyalandi");
    } catch {
      const el = document.getElementById(baglantiId) as HTMLInputElement | null;
      el?.focus();
      el?.select();
      setKopya("elle");
    }
  };

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.altBaslik}>{t("yayinla.dugme")}</h3>
      <p className={styles.kucuk}>{t("yayinla.bilgi")}</p>
      {yayin !== null ? (
        <div className={styles.kodSatiri}>
          <div className={styles.kodAlani}>
            <Field kind="input" id={baglantiId} label={t("yayinla.baglanti")} mono readOnly value={tamBaglanti} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => void kopyala()}>
            {t(kopya === "kopyalandi" ? "yayinla.kopyalandi" : "yayinla.kopyala")}
          </Button>
        </div>
      ) : acik ? (
        <Stack gap="10" align="start">
          <Field kind="input" id={`${uid}-ad`} label={t("yayinla.ad")} value={ad} onChange={(e) => setAd(kodNoktasinaKes(e.currentTarget.value, AD_EN_COK))} />
          <Field kind="textarea" id={`${uid}-aciklama`} label={t("yayinla.aciklama")} value={aciklama} rows={3} onChange={(e) => setAciklama(kodNoktasinaKes(e.currentTarget.value, ACIKLAMA_EN_COK))} />
          <Button variant="primary" disabled={mesgul || ad.trim() === ""} onClick={gonder}>
            {mesgul ? t("yayinla.gonderiliyor") : t("yayinla.gonder")}
          </Button>
        </Stack>
      ) : (
        <Stack gap="8" align="start">
          <Button variant="secondary" onClick={() => setAcik(true)}>{t("yayinla.dugme")}</Button>
        </Stack>
      )}
      {info?.dunyalarKalici === false ? <p className={styles.kucuk}>{t("yayinla.kalici_degil")}</p> : null}
      {hata !== null ? <p role="alert" className={styles.kotu}>{t(hata)}</p> : null}
      <div role="status" aria-live="polite">
        {kopya === "elle" ? <p className={styles.kucuk}>{t("yayinla.elle")}</p> : null}
      </div>
    </section>
  );
}
