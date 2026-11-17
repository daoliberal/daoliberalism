"use client";
import { useEffect, useRef, useState } from "react";

/** Değeri en çok `ms` aralıkla günceller (en son değer kazanır). 100 ms = saniyede en çok 10 kare. */
export function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const latest = useRef(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = value;
    if (timer.current !== null) return;
    const wait = Math.max(0, last.current + ms - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      setOut(latest.current);
    }, wait);
  }, [value, ms]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return out;
}
