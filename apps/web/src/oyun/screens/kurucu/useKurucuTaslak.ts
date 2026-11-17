"use client";
import { useCallback, useEffect, useState } from "react";
import type { ValuesPatch } from "@/oyun/sim/types";

export const CITY_COUNT = 5;
const KEY = "oyun.kurucu.taslak";

/**
 * Kurucu taslağı: tüm adımların tek durumu. Adımlar arası korunur ve sekme oturumunda `sessionStorage`'da tutulur.
 * `values` şablonun doldurduktan sonra elle değişen Şart değerleridir (şablonun değerlerinin üstüne biner).
 * `scenarioId`, `durationWeeks`, `goals` sonraki adımlar (W6, W7) içindir; bu görev yalnız saklar.
 */
export type KurucuTaslak = {
  name: string;
  cities: string[];
  templateId: string | null;
  values: ValuesPatch;
  scenarioId: string | null;
  /** Dünya senaryosu (DK-9): Şart'a girmez; `null` = gerçekçi. `worldScenarioValues` yalnız Özel'de anlamlıdır (varsayılandan farklı değerler). */
  worldScenarioId: string | null;
  worldScenarioValues: ValuesPatch;
  durationWeeks: number | null;
  seedIndex: number | null;
  goals: string[];
};

export const bosTaslak = (): KurucuTaslak => ({
  name: "", cities: Array.from({ length: CITY_COUNT }, () => ""), templateId: null, values: {}, scenarioId: null, worldScenarioId: null, worldScenarioValues: {}, durationWeeks: null, seedIndex: null, goals: [],
});

const isStr = (v: unknown): v is string => typeof v === "string";

/** Saklanan metni doğrular; bozuk ya da eksik her alan boş değere döner. */
export function parseTaslak(raw: string | null): KurucuTaslak {
  const d = bosTaslak();
  if (raw === null) return d;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o === null || typeof o !== "object") return d;
    const cities = Array.isArray(o.cities) && o.cities.length === CITY_COUNT && o.cities.every(isStr) ? (o.cities as string[]) : d.cities;
    const values = o.values !== null && typeof o.values === "object" && !Array.isArray(o.values) ? (o.values as ValuesPatch) : d.values;
    return {
      name: isStr(o.name) ? o.name : d.name,
      cities,
      templateId: isStr(o.templateId) ? o.templateId : null,
      values,
      scenarioId: isStr(o.scenarioId) ? o.scenarioId : null,
      worldScenarioId: isStr(o.worldScenarioId) ? o.worldScenarioId : null,
      worldScenarioValues: o.worldScenarioValues !== null && typeof o.worldScenarioValues === "object" && !Array.isArray(o.worldScenarioValues) ? (o.worldScenarioValues as ValuesPatch) : d.worldScenarioValues,
      durationWeeks: typeof o.durationWeeks === "number" ? o.durationWeeks : null,
      seedIndex: typeof o.seedIndex === "number" ? o.seedIndex : null,
      goals: Array.isArray(o.goals) ? o.goals.filter(isStr) : [],
    };
  } catch {
    return d;
  }
}

function read(): KurucuTaslak {
  try {
    return parseTaslak(typeof window === "undefined" ? null : window.sessionStorage.getItem(KEY));
  } catch {
    return bosTaslak();
  }
}

export function useKurucuTaslak(): { taslak: KurucuTaslak; guncelle(patch: Partial<KurucuTaslak>): void; temizle(): void } {
  const [taslak, setTaslak] = useState<KurucuTaslak>(read);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(taslak));
    } catch {
      /* saklama kapalı: taslak yalnız bellekte kalır */
    }
  }, [taslak]);
  const guncelle = useCallback((patch: Partial<KurucuTaslak>) => setTaslak((p) => ({ ...p, ...patch })), []);
  const temizle = useCallback(() => {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* yok say */
    }
  }, []);
  return { taslak, guncelle, temizle };
}

/** Taslağı doğrudan saklar ("Yeni koşu olarak başlat": Kurucu açılınca bu taslağı okur). */
export function kurucuTaslagiYaz(taslak: KurucuTaslak): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(taslak));
  } catch {
    /* saklama kapalı: Kurucu boş taslakla açılır */
  }
}
