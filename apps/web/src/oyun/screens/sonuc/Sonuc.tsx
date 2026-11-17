"use client";
import { useMemo } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { cx } from "@/components/primitives/cx";
import { t } from "@/oyun/copy/t";
import { numberText } from "@/oyun/sim/formatValue";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import type { RestoreStatus } from "@/oyun/hooks/useRestoreRun";
import { degistirAc } from "@/oyun/screens/canli/degistirDurumu";
import { KosuYok } from "@/oyun/screens/canli/KosuYok";
import { OLCULER } from "@/oyun/screens/canli/olcu";
import { tarifOf, taslakOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { kurucuTaslagiYaz } from "@/oyun/screens/kurucu/useKurucuTaslak";
import { senaryoAdi } from "@/oyun/screens/ortak/SartOkuyucu";
import { rehberKosuMu } from "@/oyun/screens/rehber/rehberDurumu";
import { kurulumDegerleri, paraDevriCelisiyor } from "@/oyun/sim/kurulumDegerleri";
import { akceMetni, nufusHesabi } from "@/oyun/sim/nufus";
import { computeResult, kasaTaban, kasaTabanUygulanir } from "@/oyun/sim/result";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { CopyKey } from "@/oyun/copy/t";
import type { RunState, WorldEvent } from "@/oyun/sim/types";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { useRun } from "@/oyun/sim/useRun";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Yukleniyor } from "@/oyun/ui/Durum";
import { AbKarsilastirma } from "./AbKarsilastirma";
import { AltiDunya } from "./AltiDunya";
import { HedefKarnesi } from "./HedefKarnesi";
import { SartiPaylas } from "./SartiPaylas";
import { Yayinla } from "./Yayinla";
import { useIsler } from "./useIsler";
import styles from "./Sonuc.module.css";

const olcu = (id: "karsilama" | "batan" | "kasa") => OLCULER.find((o) => o.id === id)!;

type Props = { runId: string; restore: { status: RestoreStatus } };

/** Sonuç: çöküş ya da "Çökmedi" başlığı, hedef karnesi, aynı şartı 6 dünyada koş, A/B karşılaştırma, şartı paylaş. */
export function Sonuc({ runId, restore }: Props) {
  const { go } = useHashRoute();
  if (restore.status === "missing") return <KosuYok go={() => go({ name: "kurucu" })} />;
  if (restore.status !== "ready") return <Yukleniyor />;
  return <Govde runId={runId} />;
}

function Govde({ runId }: { runId: string }) {
  const source = useSimSource();
  const { go } = useHashRoute();
  const { registry } = useRegistry();
  const { capabilities } = useSourceInfo();
  const run = useRun(runId);
  const isler = useIsler();
  const state: RunState | null = run.state;
  const result = useMemo(() => (state ? computeResult(run.weeks, state.goals, state.durationWeeks, run.events, kasaTaban(registry, state.values), kasaTabanUygulanir(registry, state.values)) : null), [run.weeks, run.events, state, registry]);
  if (state === null || result === null) return <Yukleniyor />;

  const live = state.runId;
  const kurulum = registry ? kurulumDegerleri(registry, state.values) : [];                  // D8: varsayılandan farklı seçilen dünya kurulumu ayarları
  const nufus = registry ? nufusHesabi(registry, state.values) : null;      // D4: nüfus kuruluşta belirlenir; Şart değerlerinden (yoksa kart varsayılanı) okunur
  const son = run.weeks[run.weeks.length - 1];
  const bitti = state.status === "ended" || state.status === "failed";
  const cokus: WorldEvent | undefined = run.events.find((e) => e.id.startsWith("cokus:"));
  const adimlar = cokus?.chain ?? [];
  const baslik = result.collapseWeek !== null
    ? t("sonuc.baslik.cokus", { n: result.collapseWeek })
    : result.over ? t("sonuc.baslik.ayakta", { n: result.week }) : t("sonuc.baslik.ara", { n: result.week, toplam: state.durationWeeks });
  const toparlanma: CopyKey | null = result.collapseWeek === null ? null : result.recoveryWeek !== null ? "sonuc.toparlanma.var" : result.over ? "sonuc.toparlanma.yok" : "sonuc.toparlanma.bekliyor";

  // Arka plan işleri: canlıda `jobs` yeteneği, kayıtta yalnız altı dünya (`seeds`) gerekir; A/B ve önizleme gerçek koşudur.
  const isDestek = source.kind === "live" ? capabilities.jobs && typeof source.startJob === "function" : capabilities.seeds && typeof source.startJob === "function";
  const abNeden: CopyKey | null = source.kind === "replay" ? "sonuc.ab.yok_kayit" : capabilities.jobs && typeof source.startJob === "function" && typeof source.listRuns === "function" ? null : "sonuc.is.yok_yetenek";
  /** Rehberli ilk oyunun çıkışı: koşunun şartı Kurucu'ya taslak olarak geçer ve uzman ayarları açık Şartı yaz adımı açılır (yeni koşu için). */
  const uzmanAc = (): void => {
    kurucuTaslagiYaz(taslakOf(tarifOf(state), state.values));
    go({ name: "kurucu", adim: "2", uzman: true });
  };
  const degistir = (): void => {
    degistirAc();
    go({ name: "canli", runId: live });
  };

  return (
    <div className={styles.sayfa}>
      <section className={styles.panel} aria-labelledby="sonuc-baslik">
        <p className={styles.ust}>
          {t("sonuc.ust", {
            ad: state.name !== "" ? state.name : t("ustcubuk.adsiz"), sart: t("ustcubuk.sart", { n: state.version }),
            hafta: t("ustcubuk.hafta", { n: state.week, toplam: state.durationWeeks }), dunya: t("ustcubuk.dunya", { ad: senaryoAdi(state, registry) }),
          })}
        </p>
        <h2 id="sonuc-baslik" className={cx(styles.baslik, result.collapseWeek !== null ? styles.kotu : result.over && styles.iyi)}>{baslik}</h2>
        {son ? (
          <p className={styles.metin}>
            {t(result.over ? "sonuc.ozet" : "sonuc.ozet.devam", { n: result.week, kar: olcu("karsilama").goster(son.world.served), batan: olcu("batan").goster(son.world.failed_total_cum ?? null), kasa: olcu("kasa").goster(son.world.city_cash_total) })}
          </p>
        ) : null}
        {nufus !== null && registry ? (
          <p className={styles.kucuk}>
            {t("sonuc.nufus", { oyuncu: numberText(nufus.oyuncu), npc: numberText(nufus.npc), toplam: numberText(nufus.toplam), kasa: akceMetni(registry, nufus.kasa) })}
          </p>
        ) : null}
        {kurulum.length > 0 ? (
          <div className={styles.kucuk} data-sonuc="kurulum">
            <p className={styles.kurulumBaslik}>{t("sonuc.kurulum")}</p>
            <ul className={styles.kurulumListe}>
              {kurulum.map((k) => (
                <li key={k.id}>{t("sonuc.kurulum.oge", { ad: k.ad, deger: k.deger })}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {paraDevriCelisiyor(state.values) ? <p className={styles.kucuk} data-sonuc="para-devri-notu">{t("sonuc.para_devri_notu")}</p> : null}
        {toparlanma !== null ? <p className={styles.metin}>{t(toparlanma, { n: result.recoveryWeek ?? 0 })}</p> : null}
        {result.collapseWeek !== null ? (
          <>
            <h3 className={styles.nedenBaslik}>{t("sonuc.neden")}</h3>
            {adimlar.length > 0 ? (
              <ol className={styles.adimlar} aria-label={t("sonuc.neden.adimlar")}>
                {adimlar.map((a) => (
                  <li key={a.step} className={styles.adim}>{t(a.textKey, a.params)}</li>
                ))}
              </ol>
            ) : (
              <p className={styles.kucuk}>{t("sonuc.neden.yok")}</p>
            )}
          </>
        ) : null}
        <Stack gap="8" direction="row" wrap>
          <Button variant="primary" onClick={() => go({ name: "canli", runId: live })}>
            {t("sonuc.canli")}
          </Button>
          <Button variant="secondary" disabled={bitti} aria-describedby={bitti ? "sonuc-degistir-neden" : undefined} onClick={degistir}>
            {t("sonuc.degistir")}
          </Button>
          {rehberKosuMu(live) ? (
            <Button variant="secondary" onClick={uzmanAc}>
              {t("rehber.uzman_ac")}
            </Button>
          ) : null}
        </Stack>
        {bitti ? <p id="sonuc-degistir-neden" className={styles.kucuk}>{t("sonuc.degistir.kapali")}</p> : null}
      </section>
      <div className={styles.izgara}>
        <HedefKarnesi result={result} duration={state.durationWeeks} weeks={run.weeks} />
        <AltiDunya state={state} registry={registry} isler={isler} neden={isDestek ? null : "sonuc.is.yok_yetenek"} kayit={source.kind === "replay"} />
      </div>
      <AbKarsilastirma state={state} registry={registry} isler={isler} neden={abNeden} />
      <SartiPaylas state={state} />
      <Yayinla state={state} />
    </div>
  );
}
