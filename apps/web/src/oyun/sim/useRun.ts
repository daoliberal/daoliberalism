"use client";

import { useEffect, useState } from "react";
import type { CopyKey } from "@/oyun/copy/t";
import { useSimSource } from "./SimSourceContext";
import { surumNo } from "./surum";
import type { RunState, SimEvent, WeekPacket, WorldEvent } from "./types";

type Acc = { key: string | null; state: RunState | null; weeks: WeekPacket[]; events: WorldEvent[]; error: CopyKey | null };
const EMPTY: Acc = { key: null, state: null, weeks: [], events: [], error: null };

/** Hafta numarasına göre tekilleştirilmiş, artan sıralı ekleme (yeni dizi döndürür). */
function addWeek(list: WeekPacket[], p: WeekPacket): WeekPacket[] {
  const last = list[list.length - 1];
  if (!last || p.week > last.week) return [...list, p];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.week < p.week) lo = mid + 1;
    else hi = mid;
  }
  const next = list.slice();
  if (list[lo]?.week === p.week) next[lo] = p;
  else next.splice(lo, 0, p);
  return next;
}

/** Aynı ya da daha yüksek numaralı eski sürüm olaylarını (aynı hafta ikinci değişiklik) düşürerek ekler. */
function addEvent(list: WorldEvent[], e: WorldEvent): WorldEvent[] {
  if (list.some((x) => x.id === e.id)) return list;
  const n = surumNo(e);
  const kept = n === null ? list : list.filter((x) => {
    const m = surumNo(x);
    return m === null || m < n;
  });
  return [...kept, e];
}

/** Yalnız okuma aboneliği. Abonelik, verilen `runId` ile kalır; `state.runId` değişse de sıfırlanmaz. */
export function useRun(runId: string | null): Omit<Acc, "key"> {
  const source = useSimSource();
  const [acc, setAcc] = useState<Acc>(EMPTY);

  useEffect(() => {
    if (runId === null) return;
    const off = source.subscribe(runId, (e: SimEvent) => {
      setAcc((prev) => {
        const a = prev.key === runId ? prev : { ...EMPTY, key: runId };
        switch (e.type) {
          case "state": return { ...a, state: e.state, error: null }; // kaynak hatası geçicidir: sonraki durum olayında silinir
          case "week": {
            const fresh = e.packet.events.filter((ev) => !a.events.some((x) => x.id === ev.id));
            return { ...a, weeks: addWeek(a.weeks, e.packet), events: fresh.length ? [...a.events, ...fresh] : a.events };
          }
          case "world_event":
            return { ...a, events: addEvent(a.events, e.event) };
          case "error": return { ...a, error: e.messageKey };
          case "ended": return a;
        }
      });
    });
    return off;
  }, [source, runId]);

  const cur = acc.key === runId ? acc : EMPTY;
  return { state: cur.state, weeks: cur.weeks, events: cur.events, error: cur.error };
}
