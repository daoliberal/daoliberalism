"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { randomNames } from "@/oyun/lib/names";
import { sablonKartlari } from "@/oyun/screens/kurucu/Adim1Sablon";
import { DAO_SURE } from "@/oyun/sim/dao";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { Hata, Yukleniyor } from "@/oyun/ui/Durum";
import { Sekmeler, sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { YETENEKLER } from "@/oyun/yetenekler";
import { Dunyalarim } from "./Dunyalarim";
import styles from "./DaoEkrani.module.css";
import giris from "./DaoGiris.module.css";

function baslatHatasi(e: unknown): CopyKey {
  if (e instanceof SimUnsupported) {
    if (e.message === "too_many_runs") return "kurucu.baslat_hata_cok_kosu";
    if (e.message === "busy_preparing") return "kurucu.baslat_hata_mesgul";
  }
  return "dao.baslat_hata";
}

/** DAO girişi: sunucunun dünyalarından biri seçilir, "Başla" 520 haftalık tek oyunculu koşuyu kurar. */
export function DaoGiris() {
  const source = useSimSource();
  const { go } = useHashRoute();
  const uid = useId();
  const { info, error, retry } = useSourceInfo();
  const [adlar] = useState(() => randomNames());
  const [secim, setSecim] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState<CopyKey | null>(null);
  const [sekme, setSekme] = useState<"oyna" | "dunyalarim">("oyna");
  const canli = source.kind === "live" && typeof source.daoKarar === "function";

  const baslat = async (templateId: string, seedIndex: number): Promise<void> => {
    if (mesgul) return;
    setMesgul(true);
    setHata(null);
    try {
      const h = await source.start({ name: adlar.world, cityNames: adlar.cities, templateId, durationWeeks: DAO_SURE, seedIndex, values: {}, mode: "dao" });
      go({ name: "dao", runId: h.runId });
    } catch (e) {
      setHata(baslatHatasi(e));
      setMesgul(false);
    }
  };

  let govde;
  if (!canli) {
    govde = <Banner tone="crisis">{t("dao.sunucu_yok")}</Banner>;
  } else if (error) {
    govde = <Hata retry={retry} />;
  } else if (info === null) {
    govde = <Yukleniyor />;
  } else {
    const kartlar = sablonKartlari(info, info.registry).filter((k) => k.secilebilir);
    const secili = kartlar.find((k) => k.id === secim) ?? kartlar[0];
    govde = (
      <div className={giris.govde}>
        {kartlar.length > 1 ? (
          <div role="group" aria-labelledby={`${uid}-dunya`} className={giris.dunyalar}>
            <h3 id={`${uid}-dunya`} className={giris.gizli}>{t("dao.giris.dunya")}</h3>
            {kartlar.map((k) => (
              <button key={k.id} type="button" aria-pressed={k.id === secili?.id} disabled={mesgul} className={giris.dunya} onClick={() => setSecim(k.id)}>
                <span className={giris.dunyaAd}>{k.ad}</span>
                {k.aciklama !== "" ? <span className={giris.dunyaAciklama}>{k.aciklama}</span> : null}
              </button>
            ))}
          </div>
        ) : secili && secili.aciklama !== "" ? (
          <p className={giris.kucuk}>{secili.aciklama}</p>
        ) : null}
        <Button variant="primary" size="lg" disabled={mesgul || secili === undefined} onClick={() => secili && void baslat(secili.id, info.seeds[0]?.index ?? 0)}>
          {mesgul ? t("dao.baslatiliyor") : t("dao.baslat")}
        </Button>
        {hata !== null ? <p role="alert" className={styles.hata}>{t(hata)}</p> : null}
        <p className={giris.kucuk}>{t("dao.giris.sure", { n: DAO_SURE })}</p>
        <p className={giris.kucuk}>{t("dao.kayit_notu")}</p>
      </div>
    );
  }
  const sekmeli = YETENEKLER.paylasilanDunyalar && canli && typeof source.dunyalarim === "function";
  return (
    <div className={giris.kok}>
      <h2 className={giris.baslik}>{t("dao.giris.baslik")}</h2>
      <p className={giris.altBaslik}>{t("dao.giris.giris")}</p>
      {sekmeli ? (
        <>
          <Sekmeler etiket={t("dao.giris.sekmeler")} onek="dao-giris" sekmeler={[{ id: "oyna", baslik: t("dao.giris.sekme_oyna") }, { id: "dunyalarim", baslik: t("dunyalarim.baslik") }]} secili={sekme} onSec={(id) => setSekme(id === "dunyalarim" ? "dunyalarim" : "oyna")} />
          <div role="tabpanel" className={giris.panel} id={sekmePaneliKimligi("dao-giris")} aria-labelledby={sekmeKimligi("dao-giris", sekme)}>
            {sekme === "oyna" ? govde : <Dunyalarim />}
          </div>
        </>
      ) : govde}
    </div>
  );
}
