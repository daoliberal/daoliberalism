import { Table } from "@/components/primitives/Table";
import { t, type CopyKey } from "@/oyun/copy/t";
import { loncaKirilimi, mevduatSahipleri, type LoncaAltSatirId } from "@/oyun/sim/sahiplik";
import type { Holdings } from "@/oyun/sim/types";
import { goster, oran1, sayi, sonlu } from "./bicim";
import canli from "./Canli.module.css";
import styles from "./ParaSahiplik.module.css";

type Props = { holdings: Holdings | undefined; isLive: boolean };

const akce = (x: number): string => t("canli.gosterge.akce", { n: sayi(x) });
const olculmuyor = (isLive: boolean) => <p className={styles.tanim}>{t(isLive ? "canli.sahiplik.blok.olculmuyor.live" : "canli.sahiplik.blok.olculmuyor")}</p>;

/** Başlık, değer ve tanımıyla tek ölçü kutusu (Kime ait satırlarıyla aynı görünüm). */
function Kutu({ id, etiket, tanim, deger }: { id: string; etiket: CopyKey; tanim: CopyKey; deger: string }) {
  return (
    <div className={styles.satir} data-para={id}>
      <dt className={canli.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{deger}</dd>
      <dd className={styles.tanim}>{t(tanim)}</dd>
    </div>
  );
}

/** Mevduat sahipleri: grup başına tutar ve toplamdaki pay (K1: yalnız grup). Sigortacılar ayrı satırdır; bilinmeyen grup "Diğer"e katılır. */
export function MevduatSahipleriBolumu({ holdings, isLive }: Props) {
  const baslik = t("canli.sahiplik.mevduat.baslik");
  const m = mevduatSahipleri(holdings);
  return (
    <div className={styles.bolum} data-para="mevduat_sahipleri">
      <h3 className={styles.altBaslik}>{baslik}</h3>
      <p className={styles.tanim}>{t("canli.sahiplik.mevduat.tanim")}</p>
      {!m ? olculmuyor(isLive) : (
        <Table
          caption={baslik} columns="lead2" minWidth="md" density="compact" align={["start", "end", "end"]}
          header={[t("canli.sahiplik.mevduat.kol_grup"), t("canli.sahiplik.mevduat.kol_tutar"), t("canli.sahiplik.mevduat.kol_pay")]}
          rows={[
            ...m.satirlar.map((r) => [
              t((r.id === "insurance" ? "canli.sahiplik.sahip.sigorta" : `canli.nufus.grup.p.${r.id}`) as CopyKey),
              goster(r.deger, akce),
              sonlu(r.deger) && m.toplam !== null && m.toplam > 0 ? oran1(r.deger / m.toplam) : t("canli.gosterge.olculmuyor"),
            ]),
            [t("canli.sahiplik.mevduat.toplam"), goster(m.toplam, akce), m.toplam !== null && m.toplam > 0 ? oran1(1) : t("canli.gosterge.olculmuyor")],
          ]}
        />
      )}
    </div>
  );
}

/** Kredi ve tahvil stoku: loncaların açık kredisi, kuruluş fonunun kredisi, tahvil ve toplam özkaynak (haftanın sonundaki stok). */
export function KrediTahvilStoku({ holdings, isLive }: Props) {
  const m = holdings?.money;
  return (
    <div className={styles.bolum} data-para="kredi_stoku">
      <h3 className={styles.altBaslik}>{t("canli.sahiplik.kredi.baslik")}</h3>
      <p className={styles.tanim}>{t("canli.sahiplik.kredi.tanim")}</p>
      {!m ? olculmuyor(isLive) : (
        <dl className={styles.satirlar}>
          <Kutu id="kredi_lonca" etiket="canli.sahiplik.kredi.lonca" tanim="canli.sahiplik.kredi.lonca_tanim" deger={goster(m.credit_out, akce)} />
          <Kutu id="kredi_fon" etiket="canli.sahiplik.kredi.fon" tanim="canli.sahiplik.kredi.fon_tanim" deger={goster(m.fund_credit_out, akce)} />
          <Kutu id="kredi_tahvil" etiket="canli.sahiplik.kredi.tahvil" tanim="canli.sahiplik.kredi.tahvil_tanim" deger={goster(m.bonds_out, akce)} />
          <Kutu id="kredi_ozkaynak" etiket="canli.sahiplik.kredi.ozkaynak" tanim="canli.sahiplik.kredi.ozkaynak_tanim" deger={goster(m.lonca_equity, akce)} />
        </dl>
      )}
    </div>
  );
}

/** Firma sahipliği: dört sayı (oyuncu işletmesi, sahip, çok işletmeli sahip, nakdin üst %10 payı). */
export function FirmaSahipligi({ holdings, isLive }: Props) {
  const f = holdings?.firms;
  return (
    <div className={styles.bolum} data-para="firma_sahipligi">
      <h3 className={styles.altBaslik}>{t("canli.sahiplik.firma.baslik")}</h3>
      <p className={styles.tanim}>{t("canli.sahiplik.firma.tanim")}</p>
      {!f ? olculmuyor(isLive) : (
        <dl className={styles.satirlar}>
          <Kutu id="firma_adet" etiket="canli.sahiplik.firma.adet" tanim="canli.sahiplik.firma.adet_tanim" deger={goster(f.player_count, sayi)} />
          <Kutu id="firma_sahip" etiket="canli.sahiplik.firma.sahip" tanim="canli.sahiplik.firma.sahip_tanim" deger={goster(f.owners, sayi)} />
          <Kutu id="firma_coklu" etiket="canli.sahiplik.firma.coklu" tanim="canli.sahiplik.firma.coklu_tanim" deger={goster(f.multi_owners, sayi)} />
          <Kutu id="firma_nakit10" etiket="canli.sahiplik.firma.nakit10" tanim="canli.sahiplik.firma.nakit10_tanim" deger={goster(f.cash_top10_share, oran1)} />
        </dl>
      )}
    </div>
  );
}

const ALT: Record<LoncaAltSatirId, [CopyKey, CopyKey]> = {
  mevduat: ["canli.sahiplik.hesap.lonca.mevduat", "canli.sahiplik.hesap.lonca.mevduat_tanim"],
  fon: ["canli.sahiplik.hesap.lonca.fon", "canli.sahiplik.hesap.lonca.fon_tanim"],
  rezerv: ["canli.sahiplik.hesap.lonca.rezerv", "canli.sahiplik.hesap.lonca.rezerv_tanim"],
  kasa: ["canli.sahiplik.hesap.lonca.kasa", "canli.sahiplik.hesap.lonca.kasa_tanim"],
};

/** "Hangi hesapta" görünümünde Loncalar kesiminin içi: mevduat, kuruluş fonu, sigorta rezervi ve loncaların net kasası. */
export function LoncaHesapKirilimi({ holdings, isLive }: Props) {
  const k = loncaKirilimi(holdings);
  return (
    <div className={styles.altKirilim} data-para="lonca_kirilim">
      <h4 className={styles.kirilimBaslik}>{t("canli.sahiplik.hesap.lonca_baslik")}</h4>
      <p className={styles.tanim}>{t("canli.sahiplik.hesap.lonca_tanim")}</p>
      {!k ? olculmuyor(isLive) : (
        <dl className={styles.satirlar}>
          {k.satirlar.map((r) => <Kutu key={r.id} id={`lonca_${r.id}`} etiket={ALT[r.id][0]} tanim={ALT[r.id][1]} deger={goster(r.deger, akce)} />)}
          <Kutu id="lonca_toplam" etiket="canli.sahiplik.hesap.lonca.toplam" tanim="canli.sahiplik.hesap.lonca.toplam_tanim" deger={goster(k.toplam, akce)} />
        </dl>
      )}
    </div>
  );
}
