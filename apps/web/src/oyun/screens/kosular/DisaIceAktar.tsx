"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t, type CopyKey } from "@/oyun/copy/t";
import type { ImportError, ImportResult } from "@/oyun/sim/library";
import styles from "./Kosular.module.css";

const MAX_GOSTER = 3;

const ALAN: Record<string, CopyKey> = {
  id: "kosular.alan.id", name: "kosular.alan.name", recipe: "kosular.alan.recipe", savedAt: "kosular.alan.savedAt",
  source: "kosular.alan.source", parentId: "kosular.alan.parentId", forkWeek: "kosular.alan.forkWeek", week: "kosular.alan.week", cityNames: "kosular.alan.cityNames",
};

const hataMetni = (e: ImportError): string => {
  if (e.reason === "json" || e.reason === "shape" || e.reason === "size") return t(`kosular.ice.hata.${e.reason}`);
  if (e.reason === "long") return t("kosular.ice.hata.ad_uzun", { no: e.index });
  if (e.reason === "recipe") return t("kosular.ice.hata.recipe", { no: e.index });
  const k = ALAN[e.field];
  return t("kosular.ice.hata.field", { no: e.index, alan: k ? t(k) : e.field });
};

/** Dışa aktarılan JSON (salt okunur) ve içe aktarma: yapıştırılan metin doğrulanır, alan hataları Türkçe gösterilir. */
export function DisaIceAktar({ disa, onHepsi, onIce }: {
  /** Dışa aktarılan metin; yoksa `null` (alan gizli). */
  disa: { metin: string; hepsi: boolean } | null;
  onHepsi(): void;
  onIce(metin: string): ImportResult;
}) {
  const uid = useId();
  const [metin, setMetin] = useState("");
  const [sonuc, setSonuc] = useState<ImportResult | null>(null);
  const ice = (): void => {
    const r = onIce(metin);
    setSonuc(r);
    if (r.ok) setMetin("");
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.altBaslik}>{t("kosular.aktar.baslik")}</h3>
      {disa !== null ? <Field kind="textarea" id={`${uid}-disa`} label={t(disa.hepsi ? "kosular.disa.hepsi_etiket" : "kosular.disa.etiket")} labelSize="14" mono readOnly rows={5} value={disa.metin} onFocus={(e) => e.currentTarget.select()} /> : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" onClick={onHepsi}>{t("kosular.disa.hepsi")}</Button>
      </div>
      <Field kind="textarea" id={`${uid}-ice`} label={t("kosular.ice.etiket")} labelSize="14" mono rows={4} value={metin} onChange={(e) => setMetin(e.target.value)} />
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" onClick={ice}>{t("kosular.ice.dugme")}</Button>
      </div>
      <div role="status" aria-live="polite">
        {sonuc?.ok ? <p className={styles.tamam}>{sonuc.runs.length === 1 ? t("kosular.ice.tamam") : t("kosular.ice.tamam_cok", { n: sonuc.runs.length })}</p> : null}
      </div>
      {sonuc !== null && !sonuc.ok ? (
        <div role="alert">
          {sonuc.errors.slice(0, MAX_GOSTER).map((e, i) => (
            <p key={i} className={styles.hata}>{hataMetni(e)}</p>
          ))}
          {sonuc.errors.length > MAX_GOSTER ? <p className={styles.hata}>{t("kosular.ice.hata.daha", { n: sonuc.errors.length - MAX_GOSTER })}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
