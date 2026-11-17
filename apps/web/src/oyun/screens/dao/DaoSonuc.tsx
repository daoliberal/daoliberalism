"use client";
import { Button } from "@/components/primitives/Button";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { daoDurumMetni, daoUnvanMetni, type DaoAdlar, type DaoGozlem } from "@/oyun/sim/dao";
import type { RunState } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { AdSor } from "./AdSor";
import styles from "./DaoEkrani.module.css";

/**
 * Oyun sonu penceresi (şehir ekranının üstünde yüzer; şehir kenarlarda görünür): başlangıç ve son servet dilimi, unvan, son durum ve kurulan işletmeler.
 * "Şehre dön" pencereyi kapatır (şehir ekranı kalır; menüden yeniden açılır), "Yeni oyun" giriş ekranına götürür.
 */
export function DaoSonuc({ g, state, ad, onKapat }: { g: DaoGozlem; state: RunState; ad: DaoAdlar; onKapat: () => void }) {
  const { go } = useHashRoute();
  return (
    <Diyalog baslik={t("dao.sonuc.baslik")} onKapat={onKapat} kapatMetni={t("dao.sonuc.kapat")} kapatSonda yuzen>
      <p className={styles.bilgi}>{t("dao.sonuc.ozet", { n: state.week })}</p>
      <DefinitionList
        columns={2}
        items={[
          { term: t("dao.sonuc.baslangic"), detail: t("dao.ben.dilim_deger", { n: g.gecmis.dilim0 }) },
          { term: t("dao.sonuc.son"), detail: t("dao.ben.dilim_deger", { n: g.ben.servet_dilimi }) },
          { term: t("dao.sonuc.unvan"), detail: daoUnvanMetni(g.ben.unvan) },
          { term: t("dao.sonuc.durum"), detail: daoDurumMetni(g.ben.durum) },
        ]}
      />
      <section aria-labelledby="dao-sonuc-isletmeler">
        <h3 id="dao-sonuc-isletmeler" className={styles.altBaslik}>{t("dao.sonuc.isletmeler")}</h3>
        {g.gecmis.firmalar.length === 0 ? (
          <p className={styles.kucuk}>{t("dao.sonuc.isletme_yok")}</p>
        ) : (
          <Table
            caption={t("dao.sonuc.isletmeler")} columns="even4" minWidth="md" density="compact" align={["start", "start", "end", "start"]}
            header={[t("dao.sonuc.ad"), t("dao.sonuc.sektor"), t("dao.sonuc.yas"), t("dao.sonuc.ayakta_mi")]}
            rows={g.gecmis.firmalar.map((f) => [ad.firma(f.ad, f.sektor), ad.sektor(f.sektor), t("dao.sonuc.yas_deger", { n: f.yas }), t(f.ayakta ? "dao.sonuc.ayakta" : "dao.sonuc.kapandi")])}
          />
        )}
      </section>
      {state.dunyaKodu !== undefined ? <AdSor runId={state.runId} /> : null}
      <div className={styles.dugmeler}>
        <Button variant="primary" onClick={() => go({ name: "dao" })}>
          {t("dao.yeni_oyun")}
        </Button>
      </div>
    </Diyalog>
  );
}
