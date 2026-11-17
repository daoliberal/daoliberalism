"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { OLCULER } from "@/oyun/screens/canli/olcu";
import { num, pct } from "@/oyun/lib/format";
import { hintVisible } from "@/oyun/sim/hints";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Job, JobMember, JobSeriesKey, Registry, RunConfig, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { LineChart } from "@/oyun/ui/LineChart";
import { degerMetni } from "./sartMantik";
import styles from "./SartOzel.module.css";

export const ONIZLEME_HAFTA = 52;
const YOKLAMA_MS = 1000;

/** Önizlemenin hangi taslak için çalıştığını belirler: gösterilen sonuç her zaman gösterilen şarta ait olsun. */
const imzaOf = (baglam: OnizlemeBaglami, farklar: Degisen[]): string => JSON.stringify([baglam.config, baglam.baseValues, baglam.kosuOrtasi ?? null, farklar.map((d) => [d.id, d.to])]);

export type Degisen = { id: string; from: UIValue; to: UIValue };

/** Önizleme bağlamı: koşunun kimliği (şablon dahil) ve iki tarafta da aynı kalan değerler; taslak tarafa değişenler eklenir. */
export type OnizlemeBaglami = {
  config: Omit<RunConfig, "values">; baseValues: ValuesPatch;
  /** Koşu ortası: koşunun kendi takvimi (sürümlerden) ve şimdiki hafta; taslak kararı `fromWeek + 1`'den başlar. */
  kosuOrtasi?: { fromWeek: number; schedule: { week: number; patch: ValuesPatch }[] };
};

type Durum =
  | { tur: "bosta" }
  | { tur: "basliyor" }
  | { tur: "calisiyor"; jobId: string; job: Job | null; imza: string }
  | { tur: "bitti"; job: Job; imza: string }
  | { tur: "iptal" }
  | { tur: "hata"; anahtar: CopyKey };

const SERILER: { key: JobSeriesKey; etiket: CopyKey; goster(v: number | null): string }[] = [
  { key: "served", etiket: "canli.sk.karsilama", goster: (v) => OLCULER.find((o) => o.id === "karsilama")!.goster(v) },
  { key: "unemployment_rate_all", etiket: "seri.issiz_toplam", goster: (v) => pct(v, 1) },
  { key: "failed_total_cum", etiket: "canli.sk.batan", goster: (v) => (v === null ? t("canli.gosterge.olculmuyor") : num(v)) },
  { key: "city_cash_total", etiket: "canli.sk.kasa", goster: (v) => OLCULER.find((o) => o.id === "kasa")!.goster(v) },
  { key: "gini", etiket: "canli.sk.gini", goster: (v) => OLCULER.find((o) => o.id === "gini")!.goster(v) },
];
const son = (m: JobMember | undefined, k: JobSeriesKey): number | null => {
  const s = m?.series[k] ?? [];
  return s.length > 0 ? (s[s.length - 1] ?? null) : null;
};

/** Üye hatasının neden kodu oyuncu diline çevrilir; bilinmeyen kod ham gösterilmez. */
const NEDEN: Record<string, CopyKey> = { model_error: "sart.ozet.hata.model_error" };

function OnizlemeBolumu({ baglam, farklar }: { baglam: OnizlemeBaglami; farklar: Degisen[] }) {
  const source = useSimSource();
  const { capabilities } = useSourceInfo();
  const [durum, setDurum] = useState<Durum>({ tur: "bosta" });
  const aktif = useRef<string | null>(null);
  /** İptal ya da yeni başlatma yoklamayı geçersiz kılar (uçuştaki bir yanıt iptalin üstüne yazmasın). */
  const donem = useRef(0);
  const bagli = useRef(true);
  const imza = imzaOf(baglam, farklar);

  const jobId = durum.tur === "calisiyor" ? durum.jobId : null;
  const calisanImza = durum.tur === "calisiyor" ? durum.imza : "";
  useEffect(() => {
    if (jobId === null) return;
    let canli = true;
    const benim = donem.current;
    const gecerli = (): boolean => canli && benim === donem.current;
    const timer = setTimeout(async () => {
      try {
        const job = await source.job!(jobId);
        if (!gecerli()) return;
        if (job.status === "queued" || job.status === "running") setDurum({ tur: "calisiyor", jobId, job, imza: calisanImza });
        else if (job.status === "cancelled") setDurum({ tur: "iptal" });
        else setDurum({ tur: "bitti", job, imza: calisanImza });
      } catch {
        if (gecerli()) setDurum({ tur: "hata", anahtar: "sart.ozet.onizleme_sunucu" });
      }
    }, YOKLAMA_MS);
    return () => {
      canli = false;
      clearTimeout(timer);
    };
  }, [jobId, durum, source, calisanImza]);

  // Ayrılırken süren iş iptal edilir (sunucuda aynı anda tek iş çalışır; yetim iş başka işleri engellemesin).
  useEffect(() => {
    bagli.current = true;
    return () => {
      bagli.current = false;
      const id = aktif.current;
      if (id) void source.cancelJob?.(id).catch(() => undefined);
    };
  }, [source]);
  useEffect(() => {
    aktif.current = durum.tur === "calisiyor" ? durum.jobId : null;
  }, [durum]);

  let neden: CopyKey | null = null;
  if (source.kind === "replay") neden = "sart.ozet.onizleme_yok_kayit";
  else if (!capabilities.jobs || !source.startJob) neden = "sart.ozet.onizleme_yok_yetenek";
  else if (farklar.length === 0) neden = "sart.ozet.onizleme_yok_degisiklik";

  const baslat = async (): Promise<void> => {
    if (neden !== null || !source.startJob) return;
    donem.current += 1;
    setDurum({ tur: "basliyor" });
    const karar: ValuesPatch = Object.fromEntries(farklar.map((d) => [d.id, d.to]));
    const orta = baglam.kosuOrtasi;
    try {
      const id = await source.startJob(
        orta
          ? {
              kind: "preview", weeks: ONIZLEME_HAFTA, fromWeek: orta.fromWeek,
              base: { ...baglam.config, values: { ...baglam.baseValues }, schedule: orta.schedule },
              draft: { ...baglam.config, values: { ...baglam.baseValues }, schedule: [...orta.schedule, { week: orta.fromWeek, patch: karar }] },
            }
          : {
              kind: "preview", weeks: ONIZLEME_HAFTA,
              base: { ...baglam.config, values: { ...baglam.baseValues } },
              draft: { ...baglam.config, values: { ...baglam.baseValues, ...karar } },
            },
      );
      if (!bagli.current) {
        // Başlatma yanıtı ayrıldıktan sonra geldi: iş kimliği sahipsiz kalmasın, hemen iptal edilir.
        void source.cancelJob?.(id).catch(() => undefined);
        return;
      }
      aktif.current = id;
      setDurum({ tur: "calisiyor", jobId: id, job: null, imza });
    } catch (e) {
      const mesgul = e instanceof SimUnsupported && e.message === "job_running";
      setDurum({ tur: "hata", anahtar: mesgul ? "sart.ozet.onizleme_mesgul" : e instanceof SimUnsupported && e.message === "invalid_job" ? "sart.ozet.onizleme_hata" : "sart.ozet.onizleme_sunucu" });
    }
  };
  const iptal = async (): Promise<void> => {
    if (durum.tur !== "calisiyor") return;
    const id = durum.jobId;
    donem.current += 1;
    try {
      await source.cancelJob?.(id);
    } catch {
      /* iş zaten bitmiş ya da sunucu yok: yoklama durumu düzeltir */
    }
    setDurum({ tur: "iptal" });
  };

  const calisiyor = durum.tur === "calisiyor" || durum.tur === "basliyor";
  // Sonuç, çalıştırıldığı taslağa aittir; taslak değişmişse gösterilmez.
  const bayat = (durum.tur === "bitti" || durum.tur === "calisiyor") && durum.imza !== imza;
  const sonuc = durum.tur === "bitti" && !bayat ? durum.job : null;
  const taban = sonuc?.members.find((m) => m.label === "base");
  const taslak = sonuc?.members.find((m) => m.label === "draft");
  const hatali = sonuc ? sonuc.members.filter((m) => m.status === "failed") : [];
  const isHata = sonuc !== null && sonuc.status === "failed" && hatali.length === 0;
  return (
    <Stack gap="8">
      <h4 className={styles.altBaslik}>{t("sart.ozet.onizleme")}</h4>
      <p className={styles.kucuk}>{baglam.kosuOrtasi ? t("sart.ozet.onizleme_bilgi_ortasi", { n: ONIZLEME_HAFTA }) : t("sart.ozet.onizleme_bilgi", { n: ONIZLEME_HAFTA })}</p>
      <Stack gap="8" direction="row" wrap>
        <Button variant="secondary" size="sm" disabled={neden !== null || calisiyor} onClick={() => void baslat()}>
          {t("sart.ozet.onizleme_baslat")}
        </Button>
        {durum.tur === "calisiyor" ? (
          <Button variant="secondary" size="sm" onClick={() => void iptal()}>
            {t("sart.ozet.onizleme_iptal")}
          </Button>
        ) : null}
      </Stack>
      {neden !== null ? <p className={styles.kucuk}>{t(neden)}</p> : null}
      <div role="status" aria-live="polite">
        {durum.tur === "calisiyor" && durum.job ? (
          <p className={styles.ilerleme}>{t("sart.ozet.onizleme_ilerleme", { done: durum.job.progress.done, total: durum.job.progress.total })}</p>
        ) : null}
        {bayat ? <p className={styles.kucuk}>{t(durum.tur === "calisiyor" ? "sart.ozet.onizleme_bayat_calisan" : "sart.ozet.onizleme_bayat")}</p> : null}
        {durum.tur === "iptal" ? <p className={styles.kucuk}>{t("sart.ozet.onizleme_iptal_edildi")}</p> : null}
        {durum.tur === "hata" ? <Banner tone="warn" asItem>{t(durum.anahtar)}</Banner> : null}
      </div>
      {isHata ? <Banner tone="warn" asItem>{t("sart.ozet.onizleme_is_hata")}</Banner> : null}
      {hatali.map((m) => (
        <Banner key={m.label} tone="warn" asItem>
          {t("sart.ozet.uye_hata", { ad: t(m.label === "base" ? "sart.ozet.uye.base" : "sart.ozet.uye.draft"), neden: t(NEDEN[m.error ?? ""] ?? "sart.ozet.hata.diger") })}
        </Banner>
      ))}
      {sonuc && !isHata && taban && taslak && taban.status === "done" && taslak.status === "done" ? (
        <>
          <p className={styles.metin}>{baglam.kosuOrtasi ? t("sart.ozet.onizleme_bitti_ortasi", { n: ONIZLEME_HAFTA, w: Math.min(taban.weeks, taslak.weeks) }) : t("sart.ozet.onizleme_bitti", { n: Math.min(taban.weeks, taslak.weeks) })}</p>
          <LineChart
            titleKey="sart.onizleme.grafik" titleParams={{ n: ONIZLEME_HAFTA }} yDomain={[0, 1]}
            series={[
              { id: "base", labelKey: "sart.ozet.uye.base", values: taban.series.served, styleIndex: 0 },
              { id: "draft", labelKey: "sart.ozet.uye.draft", values: taslak.series.served, styleIndex: 1 },
            ]}
          />
          <table className={styles.tablo}>
            <caption className={styles.kucuk}>{t("sart.ozet.tablo")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("sart.ozet.olcu")}</th>
                <th scope="col">{t("sart.ozet.uye.base")}</th>
                <th scope="col">{t("sart.ozet.uye.draft")}</th>
              </tr>
            </thead>
            <tbody>
              {SERILER.map((s) => (
                <tr key={s.key}>
                  <th scope="row">{t(s.etiket)}</th>
                  <td className={styles.sayisal}>{s.goster(son(taban, s.key))}</td>
                  <td className={styles.sayisal}>{s.goster(son(taslak, s.key))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Stack>
  );
}

/**
 * Canlı özet: değiştirdiğin kurallar ("eski → yeni") ve her biri için ölçüm durumu ("ölçüldü" / "bu değer ölçülmedi").
 * Etki için TAHMİN ÜRETİLMEZ; gerçek etki, aynı dünyada iki gerçek koşu yapan etki önizlemesiyle (S3 `preview` işi) görülür.
 */
export function CanliOzet({ registry, draft, farklar, durationWeeks, onizleme }: {
  registry: Registry;
  draft: ValuesPatch;
  farklar: Degisen[];
  durationWeeks: number;
  /** Verilmezse etki önizlemesi bu bağlamda kullanılamaz (neden yazılır). */
  onizleme?: OnizlemeBaglami;
}) {
  const uid = useId();
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.bolumBaslik}>{t("sart.ozet.baslik")}</h3>
      {farklar.length === 0 ? (
        <p className={styles.kucuk}>{t("sart.ozet.degisen_yok")}</p>
      ) : (
        <ul className={styles.liste} aria-label={t("sart.ozet.liste")}>
          {farklar.map((d) => {
            const card = registry.cards.find((c) => c.id === d.id);
            if (!card) return null;
            const olculdu = hintVisible(registry, card, draft, durationWeeks);
            return (
              <li key={d.id} className={styles.oge}>
                <span className={styles.ogeAd}>
                  {t("sart.ozet.satir", { ad: card.title, eski: degerMetni(registry, card, d.from), yeni: degerMetni(registry, card, d.to) })}
                </span>
                <span className={styles.etiket}>{t(olculdu ? "sart.ozet.olculdu" : "sart.ozet.olculmedi")}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.kucuk}>{t("sart.ozet.tahmin_yok")}</p>
      {onizleme ? (
        <OnizlemeBolumu baglam={onizleme} farklar={farklar} />
      ) : (
        <Stack gap="8">
          <h4 className={styles.altBaslik}>{t("sart.ozet.onizleme")}</h4>
          <Button variant="secondary" size="sm" disabled onClick={() => {}}>
            {t("sart.ozet.onizleme_baslat")}
          </Button>
          <p className={styles.kucuk}>{t("sart.ozet.onizleme_yok_baglam")}</p>
        </Stack>
      )}
    </section>
  );
}
