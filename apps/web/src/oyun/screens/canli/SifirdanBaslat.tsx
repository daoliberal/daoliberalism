import { useId, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { bosTaslak, CITY_COUNT, type KurucuTaslak } from "@/oyun/screens/kurucu/useKurucuTaslak";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunConfig, RunState, ValuesPatch } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { OZEL_SENARYO } from "../insanlar/insanlarMantik";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";

/**
 * Koşunun kuruluş tarifi (DK-11: `RunConfig` + sürüm takvimi): başlangıç değerleri ilk sürümden, sonraki her sürüm (`fromWeek > 0`)
 * önceki sürümle farkıyla `{week, patch}` olarak. Sürümler TAM değer kümesidir; tam küme gönderilmez (`start_only` anahtarlar
 * W>0'da reddedilir). Fark boşsa o sürüm takvime girmez. Sürüm kaydı yoksa o anki değerler başlangıç olur.
 */
export function tarifOf(s: RunState): RunConfig {
  const vs = [...(s.versions ?? [])].sort((a, b) => a.version - b.version);
  const ilk = vs[0]?.values ?? s.values;
  const schedule = vs.slice(1).flatMap((v, i) => {
    if (v.fromWeek <= 0) return [];
    const onceki = vs[i]!.values;
    const patch = Object.fromEntries(Object.entries(v.values).filter(([k, x]) => JSON.stringify(onceki[k]) !== JSON.stringify(x)));
    return Object.keys(patch).length > 0 ? [{ week: v.fromWeek, patch }] : [];
  });
  return {
    name: s.name, cityNames: s.cityNames, templateId: s.scenarioId, durationWeeks: s.durationWeeks, seedIndex: s.seedIndex, values: ilk,
    ...(s.goals ? { goals: s.goals } : {}),
    ...(s.worldScenarioId ? { worldScenarioId: s.worldScenarioId } : {}),
    ...(s.worldScenarioValues ? { worldScenarioValues: s.worldScenarioValues } : {}),
    ...(schedule.length > 0 ? { schedule } : {}),
  };
}

/**
 * Kurucu'ya devredilen taslak (tek yol): koşunun tarifi (`tarifOf` ya da kayıtlı tarifin `recipeToConfig`'i) + `values` olarak devredilecek değerler.
 * Şablon (`templateId`), dünya senaryosu ve özel dünya değerleri, tohum, süre ve hedefler tariften olduğu gibi gelir; böylece "Yeni koşu olarak
 * başlat", Sonuç'ta "uzman ayarlarını aç" ve Koşular'da "Şartı kopyala" aynı dünyayı kurar. Şehir adları beşse taşınır, değilse boş bırakılır.
 */
export function taslakOf(tarif: RunConfig, values: ValuesPatch): KurucuTaslak {
  return {
    ...bosTaslak(), name: tarif.name, cities: tarif.cityNames.length === CITY_COUNT ? [...tarif.cityNames] : bosTaslak().cities, templateId: tarif.templateId ?? null,
    values: { ...values }, seedIndex: tarif.seedIndex, durationWeeks: tarif.durationWeeks, goals: tarif.goals ?? [],
    worldScenarioId: tarif.worldScenarioId ?? null, worldScenarioValues: { ...(tarif.worldScenarioValues ?? {}) },
  };
}

/**
 * Dünya senaryosu "Özel" (`OZEL_SENARYO`, tek sabit): değerleri sunucu durumda veriyorsa tarife girer; vermeyen (eski) sunucuda aynı tarif kurulamaz.
 * "Aynı şartla" tarifi bu koşudan güvenle kurulamıyorsa nedeni: `ozel` (özel dünya değerleri durumda yok: eski sunucu),
 * `surum` (şart değişmiş ama sürüm takvimi durumda yok: eski sunucu; tarif güncel değerleri 0. haftadan koşardı).
 */
export function tarifKapaliNedeni(s: RunState): "ozel" | "surum" | null {
  if (s.worldScenarioId === OZEL_SENARYO && s.worldScenarioValues === undefined) return "ozel";
  if (s.version > 1 && (s.versions === undefined || s.versions.length === 0)) return "surum";
  return null;
}

/** "Sıfırdan başlat": aynı şartla yeni koşu (0. haftadan) ya da Ekonomi Kurucu'ya dönüş. Koşu Koşular'da kalır. */
export function SifirdanBaslat({ state, onKapat, onYeni, onKurucu }: { state: RunState; onKapat(): void; onYeni(runId: string): void; onKurucu(): void }) {
  const source = useSimSource();
  const [hata, setHata] = useState<CopyKey | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const busy = useRef(false);
  const nedenId = useId();
  const kapali = tarifKapaliNedeni(state);
  const ayni = (): void => {
    if (busy.current || kapali !== null) return;
    busy.current = true;
    setBekliyor(true);
    setHata(null);
    source.start(tarifOf(state)).then(
      (h) => onYeni(h.runId),
      (e: unknown) => setHata(e instanceof SimUnsupported && (e.message === "too_many_runs" || e.message === "busy_preparing") ? `canli.dallan.hata.${e.message}` : "canli.sifirla.hata"),
    ).finally(() => {
      busy.current = false;
      setBekliyor(false);
    });
  };
  return (
    <Diyalog baslik={t("canli.sifirla.baslik")} kapatMetni={t("canli.sifirla.vazgec")} kapatSonda onKapat={onKapat}>
      <Stack gap="10" align="start">
        <p className={styles.kucuk}>{t("canli.sifirla.metin", { n: state.week })}</p>
        <div className={styles.dugmeler}>
          <Button variant="primary" disabled={bekliyor || kapali !== null} aria-describedby={kapali !== null ? nedenId : undefined} onClick={ayni}>
            {t("canli.sifirla.ayni")}
          </Button>
          <Button variant="secondary" onClick={onKurucu}>
            {t("canli.sifirla.kurucu")}
          </Button>
        </div>
        {kapali !== null ? <p id={nedenId} className={akis.sebep}>{t(kapali === "ozel" ? "canli.sifirla.kapali_ozel" : "canli.sifirla.kapali_surum")}</p> : null}
        {hata ? <p role="alert" className={akis.hata}>{t(hata)}</p> : null}
      </Stack>
    </Diyalog>
  );
}
