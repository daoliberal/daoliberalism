"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { Table } from "@/components/primitives/Table";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { num } from "@/oyun/lib/format";
import { oyuncuKimligi } from "@/oyun/lib/oyuncuKimligi";
import { DAO_UNVANLAR, daoUnvanMetni, type DaoUnvan } from "@/oyun/sim/dao";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { DunyaDetay, DunyaSkorSatiri } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { Yukleniyor } from "@/oyun/ui/Durum";
import styles from "./DaoEkrani.module.css";

type Yuk = { kod: string; durum: "yukleniyor" } | { kod: string; durum: "hata"; neden: CopyKey } | { kod: string; durum: "tamam"; dunya: DunyaDetay; skor: DunyaSkorSatiri[] };

function oynaHatasi(e: unknown): CopyKey {
  if (e instanceof SimUnsupported) {
    if (e.message === "eski_surum") return "dunya.eski_surum";
    if (e.message === "dunya_yok") return "dunya.yok";
    if (e.message === "too_many_runs") return "kurucu.baslat_hata_cok_kosu";
    if (e.message === "busy_preparing") return "kurucu.baslat_hata_mesgul";
  }
  return "dunya.oyna_hata";
}

const unvanMetni = (u: string): string => ((DAO_UNVANLAR as readonly string[]).includes(u) ? daoUnvanMetni(u as DaoUnvan) : u);

/** Paylaşılan dünya (`#/dao/d/<kod>`): ad, açıklama, oynanma sayısı, skor tablosu ve "Bu dünyada oyna". */
export function DaoDunya({ kod }: { kod: string }) {
  const source = useSimSource();
  const { go } = useHashRoute();
  const [yuk, setYuk] = useState<Yuk>({ kod, durum: "yukleniyor" });
  const [mesgul, setMesgul] = useState(false);
  const [oynaHata, setOynaHata] = useState<CopyKey | null>(null);
  const canli = source.kind === "live" && typeof source.dunyaGetir === "function" && typeof source.dunyaSkor === "function" && typeof source.dunyaOyna === "function";

  useEffect(() => {
    if (!canli || !source.dunyaGetir || !source.dunyaSkor) return;
    let live = true;
    Promise.all([source.dunyaGetir(kod), source.dunyaSkor(kod)]).then(
      ([dunya, skor]) => live && setYuk({ kod, durum: "tamam", dunya, skor }),
      (e: unknown) => live && setYuk({ kod, durum: "hata", neden: e instanceof SimUnsupported && e.message === "dunya_yok" ? "dunya.yok" : "dunya.hata" }),
    );
    return () => {
      live = false;
    };
  }, [source, kod, canli]);

  const oyna = (): void => {
    if (mesgul || !source.dunyaOyna) return;
    setMesgul(true);
    setOynaHata(null);
    source.dunyaOyna(kod, oyuncuKimligi()).then(
      (h) => go({ name: "dao", runId: h.runId }),
      (e: unknown) => {
        setOynaHata(oynaHatasi(e));
        setMesgul(false);
      },
    );
  };

  let govde;
  if (!canli) {
    govde = <Banner tone="crisis">{t("dao.sunucu_yok")}</Banner>;
  } else if (yuk.kod !== kod || yuk.durum === "yukleniyor") {
    govde = <Yukleniyor />;
  } else if (yuk.durum === "hata") {
    govde = <Banner tone="neutral">{t(yuk.neden)}</Banner>;
  } else {
    const { dunya, skor } = yuk;
    const eski = dunya.modelSurumu !== dunya.guncelSurum;
    govde = (
      <>
        <h2 className={styles.baslik}>{dunya.ad}</h2>
        {dunya.aciklama !== "" ? <p className={styles.bilgi}>{dunya.aciklama}</p> : null}
        <p className={styles.kucuk}>{t("dunya.oynanma", { n: dunya.oynanma })}</p>
        {eski ? <Banner tone="warn">{t("dunya.eski_surum")}</Banner> : null}
        <Stack gap="8" align="start">
          <Button variant="primary" disabled={mesgul || eski} onClick={oyna}>
            {mesgul ? t("dunya.oynaniyor") : t("dunya.oyna")}
          </Button>
          {oynaHata !== null ? <p role="alert" className={styles.hata}>{t(oynaHata)}</p> : null}
        </Stack>
        <section className={styles.panel} aria-labelledby="dunya-skor">
          <h3 id="dunya-skor" className={styles.altBaslik}>{t("dunya.skor")}</h3>
          {skor.length === 0 ? (
            <p className={styles.kucuk}>{t("dunya.skor_yok")}</p>
          ) : (
            <Table
              caption={t("dunya.skor")} columns="even4" minWidth="md" density="compact" align={["start", "end", "start", "end"]}
              header={[t("dunya.skor.ad"), t("dunya.skor.dilim"), t("dunya.skor.unvan"), t("dunya.skor.servet")]}
              rows={skor.map((s, i) => [
                `${i + 1}. ${s.ad ?? t("dunya.skor.adsiz")}`, t("dao.ben.dilim_deger", { n: s.dilim }), `${unvanMetni(s.unvan)}, ${t("dunya.skor.isletme", { n: s.isletme })}`, num(s.servet),
              ])}
            />
          )}
        </section>
      </>
    );
  }
  return <div className={styles.dao}>{govde}</div>;
}
