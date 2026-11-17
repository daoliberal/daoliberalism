import { degistirKutuphane, kayitSorunuOku, kayitSorunuYaz } from "@/oyun/sim/library";
import type { RunHandle, RunState, SimSource } from "@/oyun/sim/types";
import { girdiOf } from "./kosularMantik";

/** Yalnız hafta ilerlediğinde (başka bir değişiklik yokken) yazma aralığı: oynatma sırasında her hafta depolamaya yazılmaz. */
export const HAFTA_YAZMA_MS = 1000;

/**
 * Canlı kaynağın koşularını Koşular kütüphanesine kendiliğinden yazan sarmalayıcı (sahip isteği: "her koşu otomatik kaydedilsin").
 * - `start` ve `branch` ile açılan koşu açıldığı anda girdi olur (ad = dünya adı, boşsa "Adsız dünya"; dal koşusu `parentId`/`forkWeek` ile ağaçta yerini alır).
 * - Girdi koşu ilerledikçe güncellenir: yeni şart sürümü (tarif + takvim), hafta ve bitiş. Koşu kimliği değişirse (`applyChange`) girdi ve çocukları yeni kimliğe taşınır.
 * - Yazmaz: DAO koşuları (`state.mode === "dao"`), iş üyeleri (`startJob`; sunucu tarafında kurulur, `start`/`branch`'ten geçmez), kayıt kaynağı koşuları (sarmalanmaz) ve kütüphanede girdisi olmayan açılmış koşular.
 * - Kullanıcı girdiyi Koşular'dan silince koşu girdiyi yeniden yaratmaz (yaratma yalnız başlatma anındadır).
 * Yazma yolu tektir: `degistirKutuphane`. Hiçbir hata koşuyu etkilemez (depolama kapalıysa koşu yine başlar).
 */
export function otomatikKayitli(inner: SimSource): SimSource {
  if (inner.kind !== "live") return inner;
  /** Başlatma anında girdisi yazılamayanlar (ör. dal hazırlanırken sürüm listesi eksik): ilk yazılabilir durumda girdi olur. */
  const yeniler = new Set<string>();
  /** Abonelik/başlatma kimliği -> girdideki güncel kimlik. */
  const kimlik = new Map<string, string>();
  const imza = new Map<string, string>();
  const yazilanHafta = new Map<string, number>();
  const zamanlayici = new Map<string, { id: ReturnType<typeof setTimeout>; state: RunState }>();

  const yaz = (altId: string, state: RunState): void => {
    const eski = kimlik.get(altId) ?? altId;
    degistirKutuphane((runs) => {
      const mevcut = runs.find((r) => r.id === state.runId) ?? runs.find((r) => r.id === eski);
      const yeniMi = yeniler.has(altId) || yeniler.has(state.runId);
      if (mevcut === undefined && !yeniMi) return runs;
      const g = girdiOf(state, "live", new Date(), mevcut);
      if (!g.ok) {
        if (g.neden === "buyuk") kayitSorunuYaz("buyuk");
        return runs;
      }
      if (kayitSorunuOku() === "buyuk") kayitSorunuYaz(null);
      // Koşu hazırlanırken (Aç / dal hızlı ileri sarma) sunucu haftası 0'dan sayar: kayıtlı hafta geriye yazılmaz.
      const run = state.preparing !== undefined && mevcut?.week !== undefined ? { ...g.run, week: mevcut.week } : g.run;
      yeniler.delete(altId);
      yeniler.delete(state.runId);
      kimlik.set(altId, state.runId);
      yazilanHafta.set(state.runId, run.week ?? state.week);
      if (mevcut === undefined) return [...runs, run];
      return runs.map((r) => (r.id === mevcut.id ? run : r.parentId === mevcut.id && mevcut.id !== state.runId ? { ...r, parentId: state.runId } : r));
    });
  };

  const gozle = (altId: string, state: RunState): void => {
    const eski = kimlik.get(altId) ?? altId;
    // Tarifi etkileyen her alan imzadadır; hafta ayrıdır (yalnız hafta değişince yazma seyreltilir).
    const sig = `${state.runId}|${state.status}|${state.version}|${state.name}|${state.preparing ? 1 : 0}|${JSON.stringify(state.versions ?? state.values)}|${JSON.stringify(state.worldScenarioValues ?? null)}`;
    const ayniAlan = imza.get(state.runId) === sig && eski === state.runId;
    const bekleyen = zamanlayici.get(state.runId);
    if (ayniAlan && state.week === yazilanHafta.get(state.runId)) return;
    if (ayniAlan && state.status !== "ended") {
      if (bekleyen !== undefined) {
        bekleyen.state = state;
        return;
      }
      const z = { id: setTimeout(() => {
        zamanlayici.delete(state.runId);
        try { yaz(altId, z.state); } catch { /* koşu etkilenmez */ }
      }, HAFTA_YAZMA_MS), state };
      zamanlayici.set(state.runId, z);
      return;
    }
    if (bekleyen !== undefined) {
      clearTimeout(bekleyen.id);
      zamanlayici.delete(state.runId);
    }
    imza.set(state.runId, sig);
    yaz(altId, state);
  };

  const anlik = (altId: string, state: RunState): void => {
    if (state.mode === "dao") return; // DAO oyunu tarifle yeniden kurulamaz (kararlar kayıtlıdır): Koşular kütüphanesine yazılmaz
    try {
      gozle(altId, state);
    } catch {
      /* depolama/ayrıştırma hatası koşuyu etkilemez */
    }
  };

  const yeniKosu = (h: RunHandle): RunHandle => {
    yeniler.add(h.runId);
    anlik(h.runId, h.state);
    return h;
  };

  const bosalt = (): void => {
    for (const [id, z] of zamanlayici) {
      clearTimeout(z.id);
      zamanlayici.delete(id);
      try { yaz(id, z.state); } catch { /* sessiz */ }
    }
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", bosalt);

  const sarilmis: SimSource = {
    ...inner,
    async start(config) {
      return yeniKosu(await inner.start(config));
    },
    dispose() {
      // Bekleyen hafta yazmaları atılır (kaynak kapandı), dinleyici bırakılır.
      for (const z of zamanlayici.values()) clearTimeout(z.id);
      zamanlayici.clear();
      if (typeof window !== "undefined") window.removeEventListener("pagehide", bosalt);
      inner.dispose();
    },
    subscribe(runId, listener) {
      return inner.subscribe(runId, (e) => {
        if (e.type === "state") anlik(runId, e.state);
        listener(e);
      });
    },
  };
  if (inner.branch) {
    const branch = inner.branch.bind(inner);
    sarilmis.branch = async (runId, week, patch) => yeniKosu(await branch(runId, week, patch));
  }
  return sarilmis;
}
