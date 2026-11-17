import { t, type CopyKey } from "@/oyun/copy/t";
import { tarifKapaliNedeni, tarifOf, taslakOf } from "@/oyun/screens/canli/SifirdanBaslat";
import type { KurucuTaslak } from "@/oyun/screens/kurucu/useKurucuTaslak";
import { decodeRecipe, encodeRecipe, recipeToConfig } from "@/oyun/sim/recipe";
import { KOSU_AD_UZUNLUK, type SavedRun } from "@/oyun/sim/library";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import type { RunConfig, RunState, ValuesPatch } from "@/oyun/sim/types";

/**
 * Açık koşudan kütüphane girdisi: tarif tek kaynaktan (`tarifOf`, recipe.ts). Tarif kurulamıyorsa (eski sunucu: özel dünya değerleri ya da
 * sürümler durumda yok) `kapali`, 8 KB'ı aşıyorsa `buyuk`. Kimlik koşu kimliğidir (aynı koşu yeniden kaydedilince girdi güncellenir: `onceki` verilirse kullanıcının verdiği ad ve
 * durumda olmayan dal bilgisi korunur). Ad 64 karakteri aşıyorsa `ad_uzun` (kırpılmaz).
 */
export function girdiOf(state: RunState, source: "live" | "replay", now: Date, onceki?: SavedRun): { ok: true; run: SavedRun } | { ok: false; neden: "kapali" | "buyuk" | "ad_uzun" } {
  if (tarifKapaliNedeni(state) !== null) return { ok: false, neden: "kapali" };
  const ad = onceki?.name ?? (state.name.trim() === "" ? t("ustcubuk.adsiz") : state.name);
  if (ad.length > KOSU_AD_UZUNLUK) return { ok: false, neden: "ad_uzun" };
  const kod = encodeRecipe(tarifOf(state));
  const dec = kod.ok ? decodeRecipe(kod.code) : null;
  if (dec === null || !dec.ok) return { ok: false, neden: "buyuk" };
  return {
    ok: true,
    run: {
      id: state.runId, name: ad, recipe: dec.recipe, savedAt: onceki?.savedAt ?? now.toISOString(), source, week: state.week,
      ...(state.cityNames.length > 0 && state.cityNames.length <= 5 && state.cityNames.every((c) => c.length <= KOSU_AD_UZUNLUK) ? { cityNames: state.cityNames } : {}),
      // Durumda dal bilgisi yoksa (yeniden kurulmuş dal koşusu) mevcut girdinin üst koşusu ve dallanma haftası korunur.
      ...((state.parentRunId ?? onceki?.parentId) !== undefined ? { parentId: (state.parentRunId ?? onceki?.parentId)! } : {}),
      ...((state.forkWeek ?? onceki?.forkWeek) !== undefined ? { forkWeek: (state.forkWeek ?? onceki?.forkWeek)! } : {}),
    },
  };
}

/** Tarifin en son şart değerleri: başlangıç değerlerinin üstüne takvimdeki yamalar sırayla biner. */
export function guncelDegerler(run: SavedRun): ValuesPatch {
  return (run.recipe.schedule ?? []).reduce<ValuesPatch>((acc, e) => ({ ...acc, ...e.patch }), { ...run.recipe.values });
}

/**
 * Canlıda yeniden kurma tarifi: kütüphanedeki tarif + takvim + (varsa) şehir adları. Sunucu koşuyu pacer'sız `fastForwardTo` haftasına
 * kadar hesaplar: kayıtta `week` varsa o hafta (süreyi aşmaz), yoksa (eski kayıt) takvimdeki son şart değişikliğinin haftası; ikisi de
 * 0 ise hiç gönderilmez.
 */
export function yenidenKurmaTarifi(run: SavedRun): RunConfig {
  const cfg = recipeToConfig(run.recipe, run.name, run.cityNames ?? []);
  const last = Math.max(0, ...(run.recipe.schedule ?? []).map((e) => e.week));
  const ff = Math.min(run.week ?? last, run.recipe.durationWeeks);
  return { ...cfg, ...(ff > 0 ? { fastForwardTo: ff } : {}) };
}

/** "Şartı kopyala": Kurucu taslağı, koşunun güncel şartıyla; ad, şablon, süre, başlangıç dünyası ve hedefler tariften (`taslakOf`). */
export function kopyaTaslagi(run: SavedRun): KurucuTaslak {
  return taslakOf(recipeToConfig(run.recipe, run.name, run.cityNames ?? []), guncelDegerler(run));
}

/** "Aç" hatasının nedeni: sınır ve meşguliyet W9b'nin metinleriyle, gerisi genel. */
export function acmaHatasi(e: unknown): CopyKey {
  if (e instanceof SimUnsupported && (e.message === "too_many_runs" || e.message === "busy_preparing")) return `canli.dallan.hata.${e.message}`;
  if (e instanceof SimUnsupported && e.message === "hata.sunucu_yok") return "hata.sunucu_yok";
  return "kosular.ac.hata";
}
