"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@/oyun/copy/t";
import { pct } from "@/oyun/lib/format";
import { numberText } from "@/oyun/sim/formatValue";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunConfig, ValuesPatch, WorldPlan } from "@/oyun/sim/types";
import { Rozet } from "@/oyun/ui/Rozet";
import type { Degisen, OnizlemeBaglami } from "./CanliOzet";
import styles from "./SartOzel.module.css";

/** Son tuş vuruşundan bu kadar sonra istek gider (her vuruşta değil). */
export const HESAP_GECIKME_MS = 400;

/** `imza`: yanıtın hangi ayar imzasına ait olduğu; güncel imzadan farklıysa ekrandaki sonuç eskidir (istek bekleniyor ya da uçuşta). */
type Durum =
  | { tur: "bekliyor" }
  | { tur: "hazir"; secili: WorldPlan; varsayilan: WorldPlan | null; imza: string }
  | { tur: "gecersiz"; imza: string }
  | { tur: "hata"; imza: string };

/** Plan isteğinin gövdesi: önizlemeyle aynı kuralla (ortak değerler + taslakta değişen kural kartları). */
export function planYapilandirmasi(baglam: OnizlemeBaglami, farklar: Degisen[]): { varsayilan: RunConfig; secili: RunConfig } {
  const karar: ValuesPatch = Object.fromEntries(farklar.map((d) => [d.id, d.to]));
  return {
    varsayilan: { ...baglam.config, values: { ...baglam.baseValues } },
    secili: { ...baglam.config, values: { ...baglam.baseValues, ...karar } },
  };
}

const n0 = (x: number): string => numberText(Math.round(x));
const n1 = (x: number): string => numberText(Math.round(x * 10) / 10);

/**
 * Kurucu'nun Dünya grubunda canlı açılış hesabı (D8): nüfus, işgücü, ilk hafta kadrosu, işletme sayısı, tür başına kapasite ve tıkanan türler,
 * büyüme tavanı kuralı, konut stoku. Hesap sunucunun saf ucundan gelir (`worldPlan`); istemcide model mantığı yoktur.
 * İstek kısa bir gecikmeyle gider; yalnız son isteğin yanıtı gösterilir.
 */
export function DunyaHesabi({ baglam, farklar }: { baglam: OnizlemeBaglami; farklar: Degisen[] }) {
  const uid = useId();
  const source = useSimSource();
  const [durum, setDurum] = useState<Durum>({ tur: "bekliyor" });
  const sira = useRef(0);
  const varsayilanOnbellek = useRef<{ imza: string; plan: WorldPlan } | null>(null);
  const kullanilabilir = source.kind === "live" && typeof source.worldPlan === "function";

  /** Ne istendiğinin imzası: yalnız imza değişince yeni istek gider (üst bileşenin her çiziminde değil). */
  const imza = useMemo(() => {
    const c = planYapilandirmasi(baglam, farklar);
    return JSON.stringify([c.varsayilan, c.secili]);
  }, [baglam, farklar]);

  useEffect(() => {
    if (!kullanilabilir || imza === "" || !source.worldPlan) return;
    const [varsayilanCfg, seciliCfg] = JSON.parse(imza) as [RunConfig, RunConfig];
    const benim = ++sira.current;
    const gecerli = (): boolean => benim === sira.current;
    const zamanlayici = setTimeout(async () => {
      try {
        const hesapla = source.worldPlan!;
        const ayni = JSON.stringify(varsayilanCfg) === JSON.stringify(seciliCfg);
        const vImza = JSON.stringify(varsayilanCfg);
        const onbellek = varsayilanOnbellek.current;
        const varsayilanIstek = onbellek && onbellek.imza === vImza ? Promise.resolve(onbellek.plan) : hesapla.call(source, varsayilanCfg);
        const seciliIstek = ayni ? varsayilanIstek : hesapla.call(source, seciliCfg);
        const [v, s] = await Promise.all([varsayilanIstek, seciliIstek]);
        if (!gecerli()) return;                                  // daha yeni bir istek çıktı: eski yanıt yazılmaz
        varsayilanOnbellek.current = { imza: vImza, plan: v };
        setDurum({ tur: "hazir", secili: s, varsayilan: ayni ? null : v, imza });
      } catch (e) {
        if (!gecerli()) return;
        setDurum(e instanceof SimUnsupported && e.message === "invalid" ? { tur: "gecersiz", imza } : { tur: "hata", imza });
      }
    }, HESAP_GECIKME_MS);
    return () => clearTimeout(zamanlayici);
  }, [kullanilabilir, imza, source]);

  const istekte = durum.tur === "bekliyor" || durum.imza !== imza;                 // ekrandaki sonuç güncel ayara ait değil

  // Çıkışta uçuştaki yanıt yok sayılır.
  useEffect(() => () => { sira.current += 1; }, []);

  const baslik = (
    <h4 id={`${uid}-baslik`} className={styles.bolumBaslik}>
      {t("sart.hesap.baslik")} <Rozet kind="experimental" />
    </h4>
  );
  if (!kullanilabilir) {
    return (
      <section className={styles.bolum} aria-labelledby={`${uid}-baslik`} data-dunya-hesabi="yok">
        {baslik}
        <p className={styles.metin} role="status">{t("sart.hesap.canli_yok")}</p>
      </section>
    );
  }
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`} aria-busy={istekte} data-dunya-hesabi={durum.tur}>
      {baslik}
      <p className={styles.kucuk}>{t("sart.hesap.giris")}</p>
      {durum.tur === "bekliyor" ? <p className={styles.metin} role="status">{t("sart.hesap.bekliyor")}</p> : null}
      {durum.tur === "hata" ? <p className={styles.metin} role="status">{t("sart.hesap.hata")}</p> : null}
      {durum.tur === "gecersiz" ? <p className={styles.metin} role="status">{t("sart.hesap.gecersiz")}</p> : null}
      {durum.tur === "hazir" ? <HesapGovdesi uid={uid} p={durum.secili} v={durum.varsayilan} /> : null}
    </section>
  );
}

const KIP = { sabit: "sart.hesap.kip.sabit", otomatik: "sart.hesap.kip.otomatik", elle: "sart.hesap.kip.elle" } as const;

function HesapGovdesi({ uid, p, v }: { uid: string; p: WorldPlan; v: WorldPlan | null }) {
  /** Varsayılan dünyayla karşılaştırma: yalnız seçim varsayılandan farklıysa ve değer değiştiyse gösterilir. */
  const kars = (secili: number, varsayilan: number | undefined, bicim: (x: number) => string = n0): string =>
    v !== null && varsayilan !== undefined && Math.round(secili) !== Math.round(varsayilan) ? ` (${t("sart.hesap.karsilastir", { n: bicim(varsayilan) })})` : "";
  const npcCalisan = p.openingStaff.total;
  const tikananlar = p.kinds.filter((k) => k.blocked);
  const etiket = (kind: string): string => p.kinds.find((k) => k.kind === kind)?.label ?? kind;
  const tavanlar = p.kinds.map((k) => k.growthCeiling).filter((x) => Number.isFinite(x));
  const tavanAraligi = tavanlar.length > 0 ? { en_az: n0(Math.min(...tavanlar)), en_cok: n0(Math.max(...tavanlar)) } : { en_az: "0", en_cok: "0" };
  const konutKiraci = p.housing ? p.housing.tenants.reduce((a, b) => a + b, 0) : 0;
  const lf = p.laborForce;
  const isgucuToplam = lf ? lf.total : p.population.total;
  return (
    <div>
      <p className={styles.kucuk} role="status" aria-live="polite" data-hesap="ozet">
        {t("sart.hesap.ozet", { isgucu: n0(isgucuToplam), n: n0(npcCalisan), tikanan: tikananlar.length })}
      </p>
      <p className={styles.metin}>
        {t("sart.hesap.nufus", { toplam: n0(p.population.total), oyuncu: n0(p.population.players), npc: n0(p.population.npc) })}
      </p>
      <p className={styles.metin} data-hesap="isgucu">
        {lf
          ? lf.mode === "hane"
            ? t("sart.hesap.isgucu_hane", { toplam: n0(lf.total), oyuncu: n0(lf.players), npc: n0(lf.npc), bagimli: n0(lf.dependents), oran: pct(lf.participation, 0) })
            : t("sart.hesap.isgucu_tek", { toplam: n0(lf.total), oyuncu: n0(lf.players), npc: n0(lf.npc) })
          : t("sart.hesap.isgucu", { n: n0(p.population.total) })}
        {lf ? kars(lf.total, v?.laborForce?.total) : null}
      </p>
      <p className={styles.metin} data-hesap="acilis">
        {t("sart.hesap.acilis", { n: n0(npcCalisan), oran: pct(p.openingStaff.npcRate, 1), kalan: n0(Math.max(0, p.population.npc - npcCalisan)) })}
        {kars(npcCalisan, v?.openingStaff.total)}
      </p>
      <p className={styles.metin} data-hesap="isletme">
        {t("sart.hesap.isletme", { n: n0(p.firms.total), bin: n1(p.firms.per1000) })}
        {kars(p.firms.total, v?.firms.total)}
      </p>
      <p className={styles.metin}>{t("sart.hesap.kapasite_kipi", { kip: t(KIP[p.capMode]) })}</p>
      <p className={styles.metin} data-hesap="tikanan">
        {tikananlar.length === 0
          ? t("sart.hesap.tikanan_yok")
          : t("sart.hesap.tikanan", { n: tikananlar.length, liste: tikananlar.map((k) => k.label).join(", ") })}
        {kars(tikananlar.length, v?.blockedKinds.length)}
      </p>
      {tikananlar.length > 0 ? (
        <ul className={styles.liste} aria-label={t("sart.hesap.tur_baslik")}>
          {tikananlar.map((k) => (
            <li key={k.kind}>{t("sart.hesap.tur_ozet", { ad: etiket(k.kind), kapasite: n0(k.capacity), hedef: n0(k.target), sigmayan: n0(k.shortfall) })}</li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>{t("sart.hesap.tur_ac")}</summary>
        <table className={styles.tablo} aria-label={t("sart.hesap.tur_tablo")}>
          <thead>
            <tr>
              <th scope="col">{t("sart.hesap.sut.tur")}</th>
              <th scope="col">{t("sart.hesap.sut.isletme")}</th>
              <th scope="col">{t("sart.hesap.sut.kapasite")}</th>
              <th scope="col">{t("sart.hesap.sut.hedef")}</th>
              <th scope="col">{t("sart.hesap.sut.alinacak")}</th>
              <th scope="col">{t("sart.hesap.sut.durum")}</th>
            </tr>
          </thead>
          <tbody>
            {p.kinds.map((k) => (
              <tr key={`${uid}-${k.kind}`} data-tur={k.kind}>
                <th scope="row">{k.label}</th>
                <td className={styles.sayisal}>{n0(k.firms)}</td>
                <td className={styles.sayisal}>{n0(k.capacity)}</td>
                <td className={styles.sayisal}>{n0(k.target)}</td>
                <td className={styles.sayisal}>{n0(k.planned)}</td>
                <td>{k.blocked ? t("sart.hesap.durum.tikandi", { n: n0(k.shortfall) }) : t("sart.hesap.durum.rahat")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className={styles.metin} data-hesap="tavan">
        {p.capGrowth === "yok"
          ? t("sart.hesap.tavan.yok")
          : p.capGrowth === "acilis_kapasitesi"
            ? t("sart.hesap.tavan.acilis")
            : t("sart.hesap.tavan.sabit", tavanAraligi)}
      </p>
      <p className={styles.metin} data-hesap="konut">
        {p.housing ? t("sart.hesap.konut", { stok: n0(p.housing.total), kiraci: n0(konutKiraci) }) : t("sart.hesap.konut_yok")}
        {p.housing ? kars(p.housing.total, v?.housing?.total) : null}
      </p>
      {p.scale.employment !== 1 || p.scale.population !== 1 ? (
        <p className={styles.kucuk}>{t("sart.hesap.olcek", { istihdam: n1(p.scale.employment), nufus: n1(p.scale.population) })}</p>
      ) : null}
    </div>
  );
}
