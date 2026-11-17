"use client";
import { useEffect, useMemo, useRef } from "react";
import type { DaoGozlem, DaoOlay } from "../sim/dao";
import type { Gecis } from "./izoDurum";
import { balonlar, unvanDegisimi, type Balon } from "./izoOlay";
import type { SehirSahnesi } from "./tipler";

/**
 * Olay balonlarını türetir (yalnız sunum; model/olay şeması değişmez). Terfi, ardışık iki gözlemin unvanından çıkarılır: önceki gözlem commit'te
 * (`useEffect`) ref'e yazılır, render saf kalır. Terfi `kaynak`tan bağımsız hesaplanır (kaynak null iken gelen terfi kaybolmaz).
 * `kaynak` null (klasik görünüm) ise balon yoktur. İçerik (balon kimlikleri) aynıysa önceki dizi döner: sahne gereksiz yeniden kurulmaz.
 */
export function useBalonlar(gecisler: readonly Gecis[], olaylar: readonly DaoOlay[] | undefined, gozlem: DaoGozlem | null | undefined, kaynak: SehirSahnesi | null): readonly Balon[] {
  const onceki = useRef<DaoGozlem | null>(null);
  const son = useRef<{ imza: string; liste: readonly Balon[] }>({ imza: "", liste: [] });
  /* eslint-disable react-hooks/refs */
  const sonTerfi = useRef<{ u: NonNullable<ReturnType<typeof unvanDegisimi>>; hafta: number } | null>(null);
  // Aynı haftanın gözlemi yeni nesneyle gelirse (yenileme) o haftanın terfisi korunur.
  const terfi = useMemo(() => {
    if (!gozlem) return null;
    const u = unvanDegisimi(onceki.current, gozlem);
    if (u) sonTerfi.current = { u, hafta: gozlem.hafta };
    return u ?? (sonTerfi.current?.hafta === gozlem.hafta ? sonTerfi.current.u : null);
  }, [gozlem]);
  const yeni = useMemo((): readonly Balon[] => {
    if (kaynak === null) return [];
    const ids = new Set<string>([kaynak.sehirBinasi.id, ...kaynak.binalar.map((b) => b.id)]);
    if (kaynak.ahir) ids.add(kaynak.ahir.id);
    return balonlar(gecisler, olaylar ?? [], terfi, (id) => ids.has(id), undefined, kaynak.ben?.binaId ?? null, gozlem?.hafta ?? null);
  }, [gecisler, olaylar, gozlem, kaynak, terfi]);
  const imza = yeni.map((b) => `${b.id}|${b.ton}|${b.omur}|${b.metinAnahtari}`).join(";");
  if (imza !== son.current.imza) son.current = { imza, liste: yeni };
  const sonuc = son.current.liste;
  useEffect(() => {
    onceki.current = gozlem ?? null;
  }, [gozlem]);
  return sonuc;
  /* eslint-enable react-hooks/refs */
}
