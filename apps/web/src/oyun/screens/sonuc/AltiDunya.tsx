import { useId } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { tarifKapaliNedeni, tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { jobResult } from "@/oyun/sim/result";
import type { Job, Registry, RunState } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { dunyaAdi, dunyaOzeti, isTarifi, nedenMetni, ondalik } from "./sonucMantik";
import type { Isler } from "./useIsler";
import styles from "./Sonuc.module.css";

/** Tarif kurulamıyorsa görünür neden (eski sunucu: özel dünya değerleri ya da sürüm takvimi durumda yok). */
export const tarifNeden = (s: RunState): CopyKey | null => {
  const n = tarifKapaliNedeni(s);
  return n === "ozel" ? "sonuc.is.ozel" : n === "surum" ? "sonuc.is.surum" : null;
};

/** İşin yüzde ilerlemesi (sayaç bitişte `total`'in altında kalabilir; bitiş durumdan okunur, bu yalnız gösterge). */
export const yuzde = (job: Job | null): number => (job && job.progress.total > 0 ? Math.min(100, Math.floor((job.progress.done / job.progress.total) * 100)) : 0);

/** Aynı şartı başlangıç dünyalarının hepsinde koşar; kayıt kaynağında kayıtlı koşulardan okunur. */
export function AltiDunya({ state, registry, isler, neden, kayit }: {
  state: RunState; registry: Registry | null; isler: Isler;
  /** Başlatma kapalıysa görünür neden; yoksa `null`. */
  neden: CopyKey | null;
  kayit: boolean;
}) {
  const uid = useId();
  const d = isler.durum.seeds;
  const calisiyor = d.tur === "calisiyor" || d.tur === "basliyor";
  const baskasi = isler.mesgul && !calisiyor;
  const kapaliNeden: CopyKey | null = neden ?? (tarifNeden(state) ?? (baskasi ? "sonuc.is.mesgul" : null));
  const sonuc = d.tur === "bitti" ? jobResult(d.job) : null;
  const ozet = sonuc && sonuc.lines.length > 0 ? dunyaOzeti(sonuc.lines) : null;
  const dunya = (i: number): string => dunyaAdi(registry, i, (n) => t("sonuc.dunya.dunya_adi", { n }));
  const seriler: ChartSeries[] = (sonuc?.lines ?? []).map((l) => ({
    id: `dunya-${l.seedIndex}`, labelKey: "sonuc.dunya.cizgi", label: t(l.seedIndex === state.seedIndex ? "sonuc.dunya.cizgi_bu" : "sonuc.dunya.cizgi", { ad: dunya(l.seedIndex) }),
    values: l.served, styleIndex: (l.seedIndex % 6) as ChartSeries["styleIndex"],
  }));
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.altBaslik}>{t("sonuc.dunya.baslik")}</h3>
      <p className={styles.kucuk}>{t("sonuc.dunya.bilgi")}</p>
      {kayit ? <p className={styles.kucuk}>{t("sonuc.dunya.kayit")}</p> : null}
      <Stack gap="8" direction="row" wrap>
        <Button variant="secondary" size="sm" disabled={kapaliNeden !== null || calisiyor} aria-describedby={kapaliNeden !== null ? `${uid}-neden` : undefined} onClick={() => isler.baslat("seeds", { kind: "seeds", recipe: isTarifi(tarifOf(state)) }, "")}>
          {t("sonuc.dunya.baslat")}
        </Button>
        {d.tur === "calisiyor" ? (
          <Button variant="secondary" size="sm" onClick={() => isler.iptal("seeds")}>
            {t("sonuc.dunya.iptal")}
          </Button>
        ) : null}
      </Stack>
      {kapaliNeden !== null ? <p id={`${uid}-neden`} className={styles.kucuk}>{t(kapaliNeden)}</p> : null}
      <div role="status" aria-live="polite">
        {d.tur === "calisiyor" ? (
          <>
            <p className={styles.metin}>{t("sonuc.dunya.ilerleme", { n: yuzde(d.job) })}</p>
            <progress className={styles.cubuk} max={100} value={yuzde(d.job)} aria-label={t("sonuc.dunya.ilerleme_ad")} />
          </>
        ) : null}
        {d.tur === "iptal" ? <p className={styles.kucuk}>{t("sonuc.is.iptal")}</p> : null}
        {d.tur === "hata" ? <Banner tone="warn" asItem>{t(d.anahtar)}</Banner> : null}
      </div>
      {sonuc && sonuc.lines.length === 0 ? <Banner tone="warn" asItem>{t("sonuc.is.bitmedi")}</Banner> : null}
      {sonuc && sonuc.lines.length > 0
        ? sonuc.failed.map((f) => (
            <Banner key={f.label} tone="warn" asItem>
              {t("sonuc.dunya.uye_hata", { ad: dunya(f.seedIndex), neden: t(nedenMetni(f.error)) })}
            </Banner>
          ))
        : null}
      {ozet ? (
        <>
          <LineChart series={seriler} yDomain={[0, 1]} titleKey="sonuc.dunya.grafik" />
          <p className={styles.metin}>
            {ozet.c > 0
              ? t("sonuc.dunya.ozet", { n: ozet.n, c: ozet.c, w: ozet.hafta, m: ondalik(ozet.medyan ?? 0), e: ozet.enErken ?? 0 })
              : t("sonuc.dunya.ozet_yok", { n: ozet.n, w: ozet.hafta })}
          </p>
          <p className={styles.kucuk}>{t("sonuc.dunya.not")}</p>
        </>
      ) : null}
    </section>
  );
}
