"use client";
import type { OnizlemeBaglami } from "@/oyun/screens/sart/CanliOzet";
import type { DunyaBaglami } from "@/oyun/screens/insanlar/Insanlar";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import type { Availability, Registry, SettingAvail, ValuesPatch } from "@/oyun/sim/types";

type Props = {
  registry: Registry;
  /** Şablonun doldurduğu tam taban (her kart için değer). */
  base: ValuesPatch;
  draft: ValuesPatch;
  onDraft(next: ValuesPatch): void;
  settings: SettingAvail[];
  durationWeeks: number;
  availability: Availability;
  /** Etki önizlemesi bağlamı: seçili şablon ve ad/şehir/dünya; iki tarafta da aynı kalan değerler. */
  onizleme: OnizlemeBaglami;
  /** Dünya senaryosu (B katmanı); Şart'a girmez. */
  dunya: DunyaBaglami;
  /** Dünya kuralları (Y) kartlarının şu anki değerleri (ör. seçili başlangıç dünyası). */
  yDegerler: ValuesPatch;
  /** Rehberli ilk oyunda uzman kartlar gizlidir; sonuç ekranından gelen "Uzman ayarlarını aç" yolunda açık başlar. */
  uzmanGizli?: boolean;
  uzmanAcik?: boolean;
};

/** Adım 2 (Şartı yaz): Kurucu kipinde Şart editörü; `start_only` kartlar açık, `unknown` kartlar kilitli. */
export function Adim2Sart({ registry, base, draft, onDraft, settings, durationWeeks, availability, onizleme, dunya, yDegerler, uzmanGizli = false, uzmanAcik = false }: Props) {
  return <SartEditoru mode="builder" registry={registry} base={base} draft={draft} onDraft={onDraft} settings={settings} context={{ durationWeeks }} gecis={{ availability }} onizleme={onizleme} dunya={dunya} yDegerler={yDegerler} uzmanGizli={uzmanGizli} uzmanAcik={uzmanAcik} />;
}
