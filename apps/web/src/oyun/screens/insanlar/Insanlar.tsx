"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t, type CopyKey } from "@/oyun/copy/t";
import type { Registry, ValuesPatch } from "@/oyun/sim/types";
import { Sekmeler, sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { Aktor } from "./Aktor";
import { DunyaKurallari } from "./DunyaKurallari";
import { aktorBasligi, aktorGruplari, DUNYA_KURALI_KATMANI, GERCEKCI_SENARYO, OZEL_SENARYO, senaryoOf } from "./insanlarMantik";
import { SenaryoDiyalogu } from "./SenaryoDiyalogu";
import styles from "./Insanlar.module.css";

/** Dünya senaryosunun bağlamı: seçimi ve Özel yaması dışarıdadır (Kurucu taslağı); `kilit` seçimin neden kapalı olduğunu söyler. */
export type DunyaBaglami = {
  scenarioId: string | null;
  values: ValuesPatch;
  onChange(next: { scenarioId: string; values: ValuesPatch }): void;
  kilit?: CopyKey;
};

export const senaryoAdi = (registry: Registry, id: string | null): string => senaryoOf(registry, id)?.title ?? id ?? t("senaryo.gercekci_ad");

/**
 * B katmanı (Dünyanın insanları): aktöre göre salt okunur dünya varsayımları (DK-9). Değiştirmek Dünya senaryosu seçmektir;
 * Özel'de `scenario_editable` kartların kilidi açılır. Senaryo Şart'a girmez.
 */
export function Insanlar({ registry, sart, durationWeeks, dunya, yDegerler, kimlik, aktorId, onAktor }: { registry: Registry; sart: ValuesPatch; durationWeeks: number; dunya?: DunyaBaglami; yDegerler: ValuesPatch; kimlik(id: string): string; aktorId: string; onAktor(id: string): void }) {
  const uid = useId();
  const gruplar = aktorGruplari(registry);
  const [acik, setAcik] = useState(false);
  const grup = gruplar.find((g) => g.id === aktorId) ?? gruplar[0];
  const scenarioId = dunya?.scenarioId ?? null;
  const ad = senaryoAdi(registry, scenarioId);
  const olcumsuz = scenarioId !== null && scenarioId !== GERCEKCI_SENARYO;
  const yKartlari = registry.cards.filter((c) => c.layer === DUNYA_KURALI_KATMANI);
  const onek = `${uid}-aktor`;
  return (
    <div className={styles.bolum}>
      <h3 className={styles.baslik}>{t("insanlar.baslik")}</h3>
      <p className={styles.giris}>{t("insanlar.giris")}</p>
      <div className={styles.satir}>
        <p className={styles.not} role="status">
          <strong>{t("insanlar.senaryo_satiri", { ad })}</strong>
          {olcumsuz ? <> <span>{t("insanlar.olculmedi_kisa")}</span></> : null}
        </p>
        {dunya && registry.scenarios.length > 0 ? (
          <Button variant="primary" size="sm" disabled={dunya.kilit !== undefined} aria-describedby={dunya.kilit ? `${uid}-kilit` : undefined} onClick={() => setAcik(true)}>
            {t("insanlar.senaryo_dugme")}
          </Button>
        ) : null}
      </div>
      {dunya?.kilit ? <p id={`${uid}-kilit`} className={styles.not}>{t(dunya.kilit)}</p> : null}
      {grup ? (
        <>
          <Sekmeler etiket={t("insanlar.aktorlar")} onek={onek} sekmeler={gruplar.map((g) => ({ id: g.id, baslik: t(aktorBasligi(g.id)) }))} secili={grup.id} onSec={onAktor} />
          <div role="tabpanel" id={sekmePaneliKimligi(onek)} aria-labelledby={sekmeKimligi(onek, grup.id)} className={styles.panel}>
            <Aktor
              registry={registry} cards={grup.cards} scenarioId={scenarioId} ozelDegerler={dunya?.values ?? {}} sart={sart} durationWeeks={durationWeeks}
              kimlik={kimlik} onOzel={(values) => dunya?.onChange({ scenarioId: OZEL_SENARYO, values })}
            />
          </div>
        </>
      ) : (
        <p className={styles.not}>{t("insanlar.bos")}</p>
      )}
      <DunyaKurallari registry={registry} cards={yKartlari} degerler={yDegerler} kimlik={kimlik} />
      {acik && dunya ? (
        <SenaryoDiyalogu
          registry={registry} secili={scenarioId}
          onSec={(id) => {
            dunya.onChange({ scenarioId: id, values: dunya.values });
            setAcik(false);
          }}
          onKapat={() => setAcik(false)}
        />
      ) : null}
    </div>
  );
}
