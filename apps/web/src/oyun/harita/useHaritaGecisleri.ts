"use client";
import { useEffect, useMemo, useRef } from "react";
import type { DaoOlay } from "../sim/dao";
import { IZO_STILI } from "./haritaStili";
import { boyIlerlet, type BoyHaritasi } from "./izoBoy";
import { gecisler, type Gecis } from "./izoDurum";
import type { HaritaVerisi } from "./tipler";

type Boy = 1 | 2 | 3 | 4;
export type HaritaGecisleri = {
  /** Son güncellemede doğan geçişler (en çok `IZO_STILI.gecis.enCok`); aynı kimlik+tür ±1 hafta içinde ikinci kez gelmez. */
  gecisler: readonly Gecis[];
  /** Baseline'dan sonra ilk görülen kimliklerin ilk görülme haftası (NPC "kuruluyor" için). */
  ilkGorulme: ReadonlyMap<string, number>;
  /** Histerezisli görsel boy; haritada olmayan kimlikte ham boy. `izoSahneKur`a verilir. */
  gorselBoy: (id: string, hamBoy: Boy) => Boy;
};

/** Bir güncellemeden ötekine taşınan durum; hiçbir alanı yerinde değiştirilmez (her adım yeni nesne). */
export type GecisDurumu = {
  anahtar: string | undefined;
  onceki: HaritaVerisi | null;
  boy: BoyHaritasi;
  ilk: ReadonlyMap<string, number>;
  goruldu: readonly { id: string; tur: Gecis["tur"]; hafta: number }[];
};

const SAKLAMA_HAFTASI = 30;
const TOLERANS = 1;

const yeniCikti = (boy: BoyHaritasi, ilk: ReadonlyMap<string, number>, gec: readonly Gecis[]): HaritaGecisleri => ({
  gecisler: gec, ilkGorulme: ilk, gorselBoy: (id, ham) => boy.get(id)?.gorsel ?? ham,
});
const bosDurum = (anahtar: string | undefined): GecisDurumu => ({ anahtar, onceki: null, boy: new Map(), ilk: new Map(), goruldu: [] });

/**
 * Saf adım: önceki durum + girdi → yeni durum ve çıktı. Yeni haftada `boyIlerlet` bir kez çalışır; aynı hafta tekrarında yalnız yeni DAO olayları işlenir.
 * `anahtar` değişirse ya da hafta geriye giderse sıfırdan (baseline) başlar. Baseline'da olaylar geçiş olmaz, yalnız görülmüş sayılır.
 * Tekrar: aynı kimlik+tür ±1 hafta içinde görüldüyse düşer (DAO olayı ile harita farkı haftası bir kayabilir).
 */
export function haritaGecisleriIlerlet(
  d0: GecisDurumu | null, harita: HaritaVerisi | null, daoOlaylari: readonly DaoOlay[] | undefined, anahtar: string | undefined, onceCikti?: HaritaGecisleri,
): { durum: GecisDurumu; cikti: HaritaGecisleri } {
  let d = d0 !== null && d0.anahtar === anahtar && !(harita !== null && d0.onceki !== null && harita.hafta < d0.onceki.hafta) ? d0 : bosDurum(anahtar);
  const sifirlandi = d !== d0;
  const onceCik = !sifirlandi && onceCikti ? onceCikti : yeniCikti(d.boy, d.ilk, []);
  if (harita === null) return { durum: d, cikti: onceCik };

  const baseline = d.onceki === null;
  const yeniHafta = baseline || harita.hafta > d.onceki!.hafta;
  const boy = yeniHafta ? boyIlerlet(d.boy, harita.firmalar.map((f) => ({ id: f[0], calisan: f[3] })), harita.hafta) : d.boy;
  const olaylar = daoOlaylari ?? [];
  const hepsi = baseline
    ? olaylar.flatMap((o): Gecis[] => (o.tur === "kuruldu" ? [{ id: o.firma, hafta: o.hafta, tur: "kuruldu" }] : o.tur === "firma_batti" ? [{ id: o.firma, hafta: o.hafta, tur: "batti" }] : []))
    : gecisler(yeniHafta ? d.onceki : harita, harita, boy, olaylar);

  const goruldu = [...d.goruldu];
  const taze: Gecis[] = [];
  for (const g of hepsi) {
    if (goruldu.some((x) => x.id === g.id && x.tur === g.tur && Math.abs(x.hafta - g.hafta) <= TOLERANS)) continue;
    goruldu.push({ id: g.id, tur: g.tur, hafta: g.hafta });
    if (!baseline) taze.push(g);
  }
  const kirpik = taze.slice(-IZO_STILI.gecis.enCok);

  if (!yeniHafta) {
    d = { ...d, goruldu };
    return { durum: d, cikti: kirpik.length > 0 ? { ...onceCik, gecisler: kirpik } : onceCik };
  }
  const ilk = new Map(d.ilk);
  if (d.onceki !== null) {
    const eski = new Set(d.onceki.firmalar.map((f) => f[0]));
    for (const f of harita.firmalar) if (!eski.has(f[0]) && f[7] !== "kapali" && !ilk.has(f[0])) ilk.set(f[0], harita.hafta);
  }
  const var_ = new Set(harita.firmalar.map((f) => f[0]));
  for (const id of [...ilk.keys()]) if (!var_.has(id)) ilk.delete(id);
  const durum: GecisDurumu = { anahtar, onceki: harita, boy, ilk, goruldu: goruldu.filter((x) => x.hafta >= harita.hafta - SAKLAMA_HAFTASI) };
  return { durum, cikti: yeniCikti(boy, ilk, kirpik) };
}

/**
 * Hafta hafta gelen haritadan geçişleri, ilk görülmeleri ve görsel boyu türetir. Render saftır: çıktı, ref'teki işlenmiş (commit edilmiş)
 * durumdan `useMemo` ile hesaplanır; durum yalnız `useEffect`te (commit) ilerler, böylece atılan bir render geçiş kaybettirmez.
 * Atlanan haftalar (Kurucu 10 haftalık tam harita, hızlı oynatma) tek farktan birleşir; çıktı `IZO_STILI.gecis.enCok` ile kırpılır.
 * `anahtar` (koşu/şehir) değişince ya da hafta geriye gidince sıfırlanır.
 */
export function useHaritaGecisleri(harita: HaritaVerisi | null, daoOlaylari?: readonly DaoOlay[], anahtar?: string): HaritaGecisleri {
  const ref = useRef<{ durum: GecisDurumu | null; cikti: HaritaGecisleri | undefined }>({ durum: null, cikti: undefined });
  // Durum bilerek ref'te tutulur ve render sırasında okunur (saf adım; commit'te `useEffect` ilerletir): bkz. yukarıdaki açıklama.
  /* eslint-disable react-hooks/refs */
  const sonuc = useMemo(
    () => haritaGecisleriIlerlet(ref.current.durum, harita, daoOlaylari, anahtar, ref.current.cikti),
    [harita, daoOlaylari, anahtar],
  );
  /* eslint-enable react-hooks/refs */
  useEffect(() => {
    ref.current = { durum: sonuc.durum, cikti: sonuc.cikti };
  }, [sonuc]);
  return sonuc.cikti;
}
