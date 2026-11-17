import { useEffect, useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Pill } from "@/components/primitives/Pill";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { tarifKapaliNedeni, tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { abAdayiAl } from "@/oyun/sim/kosuBaglami";
import { jobResult } from "@/oyun/sim/result";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Registry, RunHandle, RunState } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { LineChart } from "@/oyun/ui/LineChart";
import { tarifNeden, yuzde } from "./AltiDunya";
import { farkSatirlari, isTarifi, nedenMetni } from "./sonucMantik";
import type { Isler } from "./useIsler";
import styles from "./Sonuc.module.css";

/**
 * A/B: bu koşu (A) ile açık başka bir koşu (B) aynı dünyada baştan sona yeniden koşulur; yalnız şartları farklıdır.
 * Fark tablosu yalnız değeri farklı olan ayarları listeler. Kayıt kaynağında karşılaştırma yoktur (gerçek koşu gerekir).
 */
export function AbKarsilastirma({ state, registry, isler, neden }: {
  state: RunState; registry: Registry | null; isler: Isler;
  /** Karşılaştırma bu kaynakta kapalıysa görünür neden; yoksa `null`. */
  neden: CopyKey | null;
}) {
  const uid = useId();
  const source = useSimSource();
  const [runs, setRuns] = useState<RunHandle[] | null>(null);
  // Koşular ekranında "Karşılaştır" ile açılan koşu B olarak önceden seçilir (bir kez).
  const [secili, setSecili] = useState<string | null>(abAdayiAl);
  const listeleyebilir = neden === null && typeof source.listRuns === "function";
  useEffect(() => {
    if (!listeleyebilir) return;
    let canli = true;
    source.listRuns!().then(
      (l) => canli && setRuns(l),
      () => canli && setRuns([]),
    );
    return () => {
      canli = false;
    };
  }, [source, listeleyebilir]);

  const adaylar = (runs ?? []).filter((h) => h.runId !== state.runId && h.state.runId !== state.runId && h.state.preparing === undefined);
  const b = adaylar.find((h) => h.runId === secili) ?? null;
  const d = isler.durum.ab;
  const calisiyor = d.tur === "calisiyor" || d.tur === "basliyor";
  const baskasi = isler.mesgul && !calisiyor;
  const bNeden = b === null ? null : tarifKapaliNedeni(b.state);
  const ozel: CopyKey | null = tarifNeden(state) ?? (bNeden === "ozel" ? "sonuc.ab.ozel" : bNeden === "surum" ? "sonuc.ab.surum" : null);
  const kapali: CopyKey | null = ozel ?? (baskasi ? "sonuc.is.mesgul" : null);
  const sonuc = d.tur === "bitti" && b !== null && d.imza === b.runId ? d.job : null;
  const r = sonuc ? jobResult(sonuc) : null;
  const a = r?.lines.find((l) => l.label === "a");
  const bLine = r?.lines.find((l) => l.label === "b");
  const fark = b !== null && registry !== null ? farkSatirlari(registry, state.values, b.state.values) : null;
  const ad = b?.state.name !== undefined && b.state.name !== "" ? b.state.name : t("ustcubuk.adsiz");

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.altBaslik}>{t("sonuc.ab.baslik")}</h3>
      {neden !== null ? (
        <p className={styles.kucuk}>{t(neden)}</p>
      ) : (
        <>
          <div className={styles.secenekler}>
            <span className={styles.etiket}>{t("sonuc.ab.b_etiket")}</span>
            <div role="group" aria-label={t("sonuc.ab.b_grup")} className={styles.secenekler}>
              {adaylar.map((h) => (
                <Pill key={h.runId} tone={h.runId === secili ? "chipOn" : "chip"} aria-pressed={h.runId === secili} onClick={() => setSecili(h.runId === secili ? null : h.runId)}>
                  {t("sonuc.ab.secenek", { ad: h.state.name !== "" ? h.state.name : t("ustcubuk.adsiz"), n: h.state.week })}
                </Pill>
              ))}
            </div>
          </div>
          {runs !== null && adaylar.length === 0 ? <p className={styles.kucuk}>{t("sonuc.ab.yok")}</p> : null}
          {adaylar.length > 0 ? (
            <>
              <p className={styles.kucuk}>{t("sonuc.ab.bilgi")}</p>
              <Stack gap="8" direction="row" wrap>
                <Button
                  variant="secondary" size="sm" disabled={b === null || kapali !== null || calisiyor} aria-describedby={kapali !== null ? `${uid}-neden` : undefined}
                  onClick={() => b !== null && isler.baslat("ab", { kind: "ab", a: isTarifi(tarifOf(state)), b: isTarifi(tarifOf(b.state)) }, b.runId)}
                >
                  {t("sonuc.ab.baslat")}
                </Button>
                {d.tur === "calisiyor" ? (
                  <Button variant="secondary" size="sm" onClick={() => isler.iptal("ab")}>
                    {t("sonuc.ab.iptal")}
                  </Button>
                ) : null}
              </Stack>
              {kapali !== null && b !== null ? <p id={`${uid}-neden`} className={styles.kucuk}>{t(kapali)}</p> : null}
              <div role="status" aria-live="polite">
                {d.tur === "calisiyor" ? (
                  <>
                    <p className={styles.metin}>{t("sonuc.ab.ilerleme", { n: yuzde(d.job) })}</p>
                    <progress className={styles.cubuk} max={100} value={yuzde(d.job)} aria-label={t("sonuc.ab.ilerleme_ad")} />
                  </>
                ) : null}
                {d.tur === "iptal" ? <p className={styles.kucuk}>{t("sonuc.is.iptal")}</p> : null}
                {d.tur === "hata" ? <Banner tone="warn" asItem>{t(d.anahtar)}</Banner> : null}
              </div>
              {r && r.lines.length === 0 ? <Banner tone="warn" asItem>{t("sonuc.is.bitmedi")}</Banner> : null}
              {r ? r.failed.map((f) => (
                <Banner key={f.label} tone="warn" asItem>
                  {t("sonuc.ab.uye_hata", { ad: t(f.label === "a" ? "sonuc.ab.a" : "sonuc.ab.b", { ad }), neden: t(nedenMetni(f.error)) })}
                </Banner>
              )) : null}
              {a || bLine ? (
                <LineChart
                  titleKey="sonuc.ab.grafik" yDomain={[0, 1]}
                  series={[
                    ...(a ? [{ id: "a", labelKey: "sonuc.ab.a" as const, values: a.served, styleIndex: 0 as const }] : []),
                    ...(bLine ? [{ id: "b", labelKey: "sonuc.ab.b" as const, label: t("sonuc.ab.b", { ad }), values: bLine.served, styleIndex: 1 as const }] : []),
                  ]}
                />
              ) : null}
              {fark !== null && fark.length > 0 ? (
                <div className={styles.kaydir}>
                  <table className={styles.tablo}>
                    <caption>{t("sonuc.ab.tablo")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("sonuc.ab.tablo")}</th>
                        <th scope="col">{t("sonuc.ab.sutun_a")}</th>
                        <th scope="col">{t("sonuc.ab.sutun_b")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fark.map((f) => (
                        <tr key={f.id}>
                          <td>{f.ad}</td>
                          <td>{f.a}</td>
                          <td>{f.b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {fark !== null && fark.length === 0 ? <p className={styles.kucuk}>{t("sonuc.ab.ayni")}</p> : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
