"use client";
import { useCallback, useMemo, useState } from "react";
import { same } from "@/oyun/sim/hints";
import type { Registry, SettingAvail, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { gonderilebilirMi, sartFarki, type SartKipi } from "./sartMantik";

export type SartTaslak = {
  /** Taban + elle değişenler (her kart için değer). */
  draft: ValuesPatch;
  set(id: string, v: UIValue): void;
  /** Kartı tabandaki değerine döndürür. */
  reset(id: string): void;
  diff(): { id: string; from: UIValue; to: UIValue }[];
  /** Elle değişenleri (yamayı) topluca değiştirir. */
  replace(next: ValuesPatch): void;
};

/**
 * Kontrolsüz kullanım için taslak durumu: `base` tam değer kümesidir (şablon + varsayılanlar); `set` tabana eşit değeri yama olarak tutmaz.
 * Kurucu kendi saklanan taslağını `SartEditoru`ya `draft`/`onDraft` ile verir; bu kanca koşu ortası değişikliği (Şartı değiştir) içindir.
 */
export function useSartTaslak(registry: Registry, base: ValuesPatch, initial: ValuesPatch = {}, opts: { mode?: SartKipi; settings?: SettingAvail[] } = {}): SartTaslak {
  const { mode = "builder", settings } = opts;
  const [patch, setPatch] = useState<ValuesPatch>(initial);
  const draft = useMemo(() => ({ ...base, ...patch }), [base, patch]);
  const kind = useCallback((id: string) => registry.cards.find((c) => c.id === id)?.kind ?? "", [registry]);
  const set = useCallback(
    (id: string, v: UIValue) =>
      setPatch((p) => {
        // Kilitli, pasif, doğrulanmamış ve salt okunur kartın değeri hiç yazılmaz (editörle aynı süzgeç).
        const card = registry.cards.find((c) => c.id === id);
        if (!card || !gonderilebilirMi(card, mode, settings?.find((x) => x.id === id))) return p;
        const next = { ...p };
        if (id in base && same(kind(id), base[id], v)) delete next[id];
        else next[id] = v;
        return next;
      }),
    [base, kind, registry, mode, settings],
  );
  const reset = useCallback(
    (id: string) =>
      setPatch((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      }),
    [],
  );
  const diff = useCallback(() => sartFarki(registry, base, draft), [registry, base, draft]);
  const replace = useCallback((next: ValuesPatch) => setPatch(next), []);
  return { draft, set, reset, diff, replace };
}
