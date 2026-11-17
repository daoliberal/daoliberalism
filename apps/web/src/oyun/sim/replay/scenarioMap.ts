import type { ValuesPatch } from "../types";
import type { RecordingIndex } from "./loader";

const SETTING = "gecis_destegi";

/** Seçimi kayıt kümesine çevirir; eksik değer `kapali`; kayıtsız değer `null`. */
export function scenarioFor(values: ValuesPatch, index: RecordingIndex): string | null {
  const v = values[SETTING] ?? "kapali";
  return index.sets.find((s) => s.values[SETTING] === v)?.id ?? null;
}

/** MVP'de kayıtsız seçenek yok; kilit yalnız kilitli bağlam kartlarındadır. */
export function lockedOptions(index?: RecordingIndex): { settingId: string; option: string }[] {
  void index;
  return [];
}

export const SETTING_ID = SETTING;
