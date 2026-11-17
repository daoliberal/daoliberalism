"use client";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { Adlandirici } from "@/oyun/harita/adlar";
import type { ParselTuru } from "@/oyun/harita/izoSahne";
import { MEYDAN_REF, type HaritaRef, type SehirSahnesi } from "@/oyun/harita/tipler";
import { baglamBasligi, KurucuBaglam } from "@/oyun/screens/canli/KurucuBaglam";
import { belediyeKimligi, type DaoAdlar, type DaoGozlem } from "@/oyun/sim/dao";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { WeekPacket } from "@/oyun/sim/types";
import { useDiyalogAcik } from "@/oyun/ui/Diyalog";
import { Sekmeler, sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { IlanListesi, IsletmeIlani } from "./DaoIlanlar";
import { AhirdanCikEylemi, AyrilEylemi, GocEylemi, IsletmeKurEylemi, KararRet, LoncaKurEylemi, LoncaSecEylemi, MevduatEylemi, ParaCekEylemi, SermayeEkleEylemi, type KararDurumu } from "./DaoKararlar";
import { DaoLoncalar, DaoLoncam, DaoPiyasa } from "./DaoPaneller";
import styles from "./DaoEkrani.module.css";

/** Seçili yer: harita başvurusu, seçildiği anın yayımlanmış haftası (ayrıntı isteği bu haftayı sorar) ve hangi şehirde seçildiği. */
/** Şehir panelinin sekmeleri (kendi şehrinde). */
export type SehirSekmesi = "sehir" | "ilanlar";
const SEKME_ONEK = "dao-sehir";

export type DaoSecimi = { ref: HaritaRef; hafta: number; sehir: number };

/** Sağ panelin başlığı: Kurucu ile aynı (işletme sektörü, meydan, şehir adı, ahır); boş parselin kendi başlığı var. */
export function daoBaglamBasligi(secim: DaoSecimi, sahne: SehirSahnesi, adlar: Adlandirici, parselTuru: ParselTuru = "bos"): string {
  if (secim.ref.kind === "parsel") return t(parselTuru === "bos" ? "dao.baglam.parsel" : `dao.baglam.parsel_${parselTuru}`);
  return baglamBasligi(secim, sahne, adlar);
}

type Props = {
  runId: string;
  secim: DaoSecimi;
  sahne: SehirSahnesi;
  adlar: Adlandirici;
  /** Oyuncunun güncel gözlemi; hafta 0'da (ilk paket yok) null. */
  g: DaoGozlem | null;
  ad: DaoAdlar;
  cur: WeekPacket | null;
  sehir: number;
  sehirAdlari: string[];
  sektorAdi(id: string): string;
  karar: KararDurumu;
  /** Hafta 0: oyuncu ahırda başlar; gözlem gelene dek bu bilgi geçerlidir. */
  ilkHafta: boolean;
  /** Kendi şehrinin paneli: açık sekme (Ben panelindeki "İş ilanlarına bak" ilanlar sekmesini açar). */
  sekme: SehirSekmesi;
  onSekme(s: SehirSekmesi): void;
  /** Seçili kur hedefinin türü (konut/park/boş arsa/boş); notu buna göre yazılır. */
  parselTuru?: ParselTuru;
  /** İşletme kur kabul edilince çağrılır (K8: seçilen parsel oyuncunun işletmesi için sabitlenir). */
  onKur?(parsel: string, sektor: string): void;
  /** "İşletmeni göster": kamerayı oyuncunun işletmesine odaklar (yalnız kendi işletmen seçiliyken). */
  onIsletmeyiGoster?(): void;
};

/**
 * Sağ panelin içeriği: seçilene göre bağlam eylemleri. Şehir kurumu (Liman, İhracat): yalnız bilgi. Ahır: Ahırdan çık. Kendi işyerin/işletmen: İşten ayrıl. Meydan: mevduat ve para çek (loncalar dünya geneli,
 * her şehirde aynı liste). Başka şehrin binası: Bu şehre taşın. Boş parsel: İşletme kur. Bütün eylemler açık düğmeyle; hiçbiri kendiliğinden olmaz.
 */
export function DaoBaglam({ runId, secim, sahne, adlar, g, ad, cur, sehir, sehirAdlari, sektorAdi, karar, ilkHafta, sekme, onSekme, parselTuru = "bos", onKur, onIsletmeyiGoster }: Props) {
  const source = useSimSource();
  const diyalogAcik = useDiyalogAcik();
  const { kind, ref } = secim.ref;
  const benSehir = g?.ben.sehir ?? null;
  const ayrintiVar = typeof source.drawer === "function";
  const yok = <p className={styles.kucuk}>{t("dao.baglam.gozlem_yok")}</p>;
  let govde;
  if (kind === "sector") {
    // Ahır: gözlem varsa durumdan, yoksa (hafta 0) oyunun başlangıcından: oyuncu ahırda başlar.
    govde = <AhirdanCikEylemi ahirda={g !== null ? g.ben.durum === "ahir" : ilkHafta} k={karar} />;
  } else if (kind === "lonca") {
    govde = g === null ? yok : (
      <>
        <DaoLoncalar g={g} />
        <DaoLoncam g={g} />
        <LoncaKurEylemi g={g} k={karar} />
        <MevduatEylemi g={g} k={karar} />
        <ParaCekEylemi k={karar} />
        {ref !== MEYDAN_REF && cur !== null ? <KurucuBaglam runId={runId} secim={secim} sahne={sahne} adlar={adlar} cur={cur} sehir={sehir} sehirAdlari={sehirAdlari} sektorAdi={sektorAdi} /> : null}
      </>
    );
  } else if (kind === "city") {
    const kendi = g !== null && benSehir === sehir;
    // Belediye şehir binasıdır: orada çalışan insanın işyeri bu binadır, "İşten ayrıl" burada da çıkar.
    const belediyede = kendi && g.ben.durum === "calisan" && g.ben.is.firma === belediyeKimligi(sehir);
    const sehirIcerigi = (
      <>
        {g === null ? null : kendi ? (
          <>
            <p className={styles.kucuk}>{t("dao.sehir.burada")}</p>
            {belediyede ? (
              <>
                <p className={styles.kucuk}>{t("dao.isyeri.not")}</p>
                <AyrilEylemi g={g} k={karar} />
              </>
            ) : null}
          </>
        ) : (
          <GocEylemi hedef={sehir} kurucu={g.ben.durum === "kurucu"} ad={ad} k={karar} />
        )}
        {cur !== null ? <KurucuBaglam runId={runId} secim={secim} sahne={sahne} adlar={adlar} cur={cur} sehir={sehir} sehirAdlari={sehirAdlari} sektorAdi={sektorAdi} /> : null}
        {g !== null && kendi ? <DaoPiyasa g={g} ad={ad} /> : null}
      </>
    );
    govde = g !== null && kendi ? (
      <>
        <Sekmeler
          etiket={t("dao.ilan.sekmeler")} onek={SEKME_ONEK} secili={sekme} onSec={(id) => onSekme(id as SehirSekmesi)}
          sekmeler={[{ id: "sehir", baslik: t("dao.ilan.sekme_sehir") }, { id: "ilanlar", baslik: t("dao.ilan.sekme_ilanlar") }]}
        />
        <div role="tabpanel" id={sekmePaneliKimligi(SEKME_ONEK)} aria-labelledby={sekmeKimligi(SEKME_ONEK, sekme)} className={styles.baglam}>
          {sekme === "ilanlar" ? <IlanListesi g={g} ad={ad} k={karar} /> : sehirIcerigi}
        </div>
      </>
    ) : sehirIcerigi;
  } else if (kind === "kurum") {
    // Şehir kurumu (Liman, İhracat): oyuncu kararı yok, yalnız bilgi paneli; gözlem gerekmez (veri paketin `kurumlar` alanından).
    govde = cur !== null ? <KurucuBaglam runId={runId} secim={secim} sahne={sahne} adlar={adlar} cur={cur} sehir={sehir} sehirAdlari={sehirAdlari} sektorAdi={sektorAdi} /> : yok;
  } else if (kind === "parsel") {
    govde = g === null ? yok : benSehir !== sehir ? (
      <p className={styles.kucuk}>{t("dao.parsel.baska_sehir")}</p>
    ) : (
      <>
        <p className={styles.kucuk}>{t(parselTuru === "bos" ? "dao.parsel.not" : `dao.parsel.not_${parselTuru}`)}</p>
        <IsletmeKurEylemi g={g} ad={ad} k={karar} parsel={ref} {...(onKur ? { onKur } : {})} />
      </>
    );
  } else {
    // İşletme: kendi işyerin ya da işletmen mi?
    const benim = g !== null && (g.ben.durum === "calisan" || g.ben.durum === "kurucu") && g.ben.is.firma === ref && benSehir === sehir;
    govde = (
      <>
        {benim ? (
          <>
            <p className={styles.kucuk}>{t(g.ben.durum === "kurucu" ? "dao.isletme.not" : "dao.isyeri.not")}</p>
            {g.ben.durum === "kurucu" && onIsletmeyiGoster ? (
              <div className={styles.dugmeler}>
                <Button variant="secondary" size="sm" onClick={onIsletmeyiGoster}>{t("dao.karar.isletmeni_goster")}</Button>
              </div>
            ) : null}
            {g.ben.durum === "kurucu" ? <SermayeEkleEylemi k={karar} /> : null}
            {g.ben.durum === "kurucu" ? <LoncaSecEylemi g={g} k={karar} /> : null}
            {g.ben.durum === "kurucu" ? <LoncaKurEylemi g={g} k={karar} /> : null}
            <AyrilEylemi g={g} k={karar} />
          </>
        ) : (
          <p className={styles.kucuk}>{t("dao.baska_isletme")}</p>
        )}
        {g !== null && benSehir === sehir && !benim ? <IsletmeIlani firma={ref} g={g} ad={ad} k={karar} /> : null}
        {ayrintiVar && cur !== null ? <KurucuBaglam runId={runId} secim={secim} sahne={sahne} adlar={adlar} cur={cur} sehir={sehir} sehirAdlari={sehirAdlari} sektorAdi={sektorAdi} /> : null}
      </>
    );
  }
  return (
    <div className={styles.baglam} data-dao-baglam={kind}>
      {govde}
      {diyalogAcik ? null : <KararRet k={karar} />}
    </div>
  );
}
