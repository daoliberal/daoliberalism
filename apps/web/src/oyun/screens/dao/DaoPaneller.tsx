"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import { num, pct } from "@/oyun/lib/format";
import { daoOlayMetni, firmaBatisMetni, kasaEgilimMetni, type DaoAdlar, type DaoGozlem, type DaoOlay } from "@/oyun/sim/dao";
import { Banner } from "@/oyun/ui/Banner";
import { loncaAdi } from "@/oyun/screens/canli/LoncaTablosu";
import type { OlayOgesi } from "@/oyun/ekran/OlaySeridi";
import styles from "./DaoEkrani.module.css";

/** Piyasa panelinde varsayılan görünen sektör sayısı. */
const PIYASA_ILK = 8;
const ondalik = (x: number): string => x.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

/** Piyasa bölümü (şehir bağlam paneli): insanın şehrindeki sektörler (fiyat, işletme sayısı, açık talep) ve şehir özeti. */
export function DaoPiyasa({ g, ad }: { g: DaoGozlem; ad: DaoAdlar }) {
  const [hepsi, setHepsi] = useState(false);
  // Varsayılan: en çok eksik olan sektörler (eksik azalan, sonra fiyat azalan); hepsi isteğe bağlı.
  const sirali = [...g.sektorler].sort((a, b) => b.eksik - a.eksik || b.fiyat - a.fiyat);
  const gorunen = hepsi ? sirali : sirali.slice(0, PIYASA_ILK);
  return (
    <>
      <DefinitionList
        columns={2}
        items={[
          { term: t("dao.piyasa.talep"), detail: pct(g.sehir.talep_karsilama, 0) },
          { term: t("dao.piyasa.is_arayan"), detail: t("dao.piyasa.kisi", { n: num(g.sehir.is_arayan) }) },
        ]}
      />
      <Table
        caption={t("dao.piyasa.tablo")} columns="even5" minWidth="sm" density="compact" align={["start", "end", "end", "end", "end"]}
        header={[t("dao.piyasa.sektor"), t("dao.piyasa.fiyat"), t("dao.piyasa.firma"), t("dao.piyasa.eksik"), t("dao.piyasa.disaridan")]}
        rows={gorunen.map((s) => {
          const egilim = kasaEgilimMetni(s.kasa_egilim);
          return [
            egilim === null ? ad.sektor(s.sektor) : <>{ad.sektor(s.sektor)} <small className={styles.kucuk}>{egilim}</small></>,
            ondalik(s.fiyat),
            s.firma_sayisi_13hf == null ? num(s.firma) : <>{num(s.firma)} <small className={styles.kucuk}>{t("dao.piyasa.onceki_firma", { n: num(s.firma_sayisi_13hf) })}</small></>,
            num(s.eksik),
            s.disaridan == null ? "—" : num(s.disaridan),
          ];
        })}
      />
      {sirali.length > PIYASA_ILK ? (
        <div className={styles.dugmeler}>
          <Button variant="secondary" size="sm" aria-expanded={hepsi} onClick={() => setHepsi(!hepsi)}>
            {hepsi ? t("dao.piyasa.az") : t("dao.piyasa.hepsi", { n: sirali.length })}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Loncalar (meydan paneli): dar panelde yatay kaydırma olmasın diye her lonca bir satır kartı; haftalık faiz, toplam mevduat, açık/kapalı. */
export function DaoLoncalar({ g }: { g: DaoGozlem }) {
  return (
    <ul aria-label={t("dao.lonca.tablo")} className={styles.loncalar}>
      {g.loncalar.map((l) => (
        <li key={l.ad} className={styles.lonca}>
          <strong>{loncaAdi(l.ad)}</strong>
          <span className={styles.kucuk}>{t("dao.lonca.faiz")}: {pct(l.mevduat_faizi, 2)}</span>
          <span className={styles.kucuk}>{t("dao.lonca.mevduat")}: {num(l.mevduat)}</span>
          <span className={styles.kucuk}>{t(l.kapali ? "dao.lonca.kapali" : "dao.lonca.acik")}</span>
        </li>
      ))}
    </ul>
  );
}

/** F3: insanın sahibi olduğu lonca özeti (HUMAN_LONCA; yoksa görünmez). */
export function DaoLoncam({ g }: { g: DaoGozlem }) {
  const l = g.ben.loncam;
  if (l === undefined || l === null) return null;
  return (
    <section className={styles.bolum} aria-label={t("dao.loncam.baslik")}>
      <h3 className={styles.altBaslik}>{t("dao.loncam.baslik")}: {loncaAdi(l.ad)}</h3>
      <span className={styles.kucuk}>{t("dao.loncam.sermaye")}: {num(l.sermaye)}</span>
      {l.odenen_sermaye !== undefined ? <span className={styles.kucuk}>{t("dao.loncam.odenen")}: {num(l.odenen_sermaye)}</span> : null}
      <span className={styles.kucuk}>{t("dao.loncam.kasa")}: {num(l.kasa)}</span>
      <span className={styles.kucuk}>{t("dao.loncam.uye")}: {num(l.uye_sayisi)}</span>
      <span className={styles.kucuk}>{l.durum === "tehlikede" ? t("dao.loncam.tehlikede") : t("dao.loncam.acik")}</span>
    </section>
  );
}

/** Tüm olaylar penceresinde en çok bu kadar olay. */
const SON = 30;
const anahtar = (o: DaoOlay): string => `${o.hafta}:${JSON.stringify(o)}`;

/** Paketlerle gelen olaylar: yinelenenler atılır, yeniden eskiye sıralanır (en çok `SON`). */
export function daoOlaylari(olaylar: DaoOlay[]): DaoOlay[] {
  const gorulen = new Set<string>();
  const tekil = olaylar.filter((o) => {
    const k = anahtar(o);
    if (gorulen.has(k)) return false;
    gorulen.add(k);
    return true;
  });
  return tekil.slice(-SON).reverse();
}

/** Olay şeridinin satırları (kabuğun `olaylar` yuvası): en yeni ilk; şerit en çok `EKRAN_STILI.olaySayisi` tanesini gösterir. */
export function daoOlayOgeleri(olaylar: DaoOlay[], ad: DaoAdlar, gecmis?: DaoGozlem["gecmis"]["firmalar"]): OlayOgesi[] {
  return daoOlaylari(olaylar).map((o) => ({ id: anahtar(o), metin: t("dao.olaylar.satir", { hafta: o.hafta, metin: daoOlayMetni(o, ad, gecmis) }) }));
}

/** "Tüm olaylar" penceresinin listesi: şimdiye kadar paketlerle gelen olaylar, yeniden eskiye (en çok 30). */
export function DaoOlayListesi({ olaylar, ad, gecmis }: { olaylar: DaoOlay[]; ad: DaoAdlar; gecmis?: DaoGozlem["gecmis"]["firmalar"] }) {
  const ogeler = daoOlayOgeleri(olaylar, ad, gecmis);
  if (ogeler.length === 0) return <p className={styles.kucuk}>{t("dao.olaylar.bos")}</p>;
  return (
    <ul className={styles.olaylar}>
      {ogeler.map((o) => (
        <li key={o.id}>{o.metin}</li>
      ))}
    </ul>
  );
}

/** Batış bildiriminin kimliği (kapatılanı ayırt eder). */
export const batisAnahtari = (o: Extract<DaoOlay, { tur: "firma_batti" }>): string => `${o.hafta}:${o.firma}`;

/**
 * İşletmen battı: `firma_batti` olayları belirgin bir bantta (işletme adı, neden, yaş). Gözlem yalnız son haftanın olaylarını taşır; görülen batışlar burada
 * yerel durumda tutulur ve oyuncu "Tamam" diyene dek (hafta ilerlese de) kalır. Olay şeridine ek olarak gösterilir.
 */
export function DaoBatisBildirimi({ olaylar, ad, kapatilan, onKapat, gecmis }: { olaylar: DaoOlay[]; ad: DaoAdlar; kapatilan: ReadonlySet<string>; onKapat(anahtar: string): void; /** `gozlem.gecmis.firmalar`: yeni kodlar varsa bant kartla aynı cümleyi söyler. */ gecmis?: DaoGozlem["gecmis"]["firmalar"] }) {
  const [gorulen, setGorulen] = useState<Extract<DaoOlay, { tur: "firma_batti" }>[]>([]);
  const yeniler = olaylar.filter((o): o is Extract<DaoOlay, { tur: "firma_batti" }> => o.tur === "firma_batti" && !gorulen.some((g) => batisAnahtari(g) === batisAnahtari(o)));
  if (yeniler.length > 0) setGorulen([...gorulen, ...yeniler]);
  const batanlar = [...gorulen, ...yeniler].filter((o) => !kapatilan.has(batisAnahtari(o)));
  if (batanlar.length === 0) return null;
  return (
    <>
      {batanlar.map((o) => (
        <div key={batisAnahtari(o)} data-dao-batis={o.firma} aria-label={t("dao.batis.bildirim_etiket")}>
          <Banner tone="crisis">
            <span>{firmaBatisMetni(ad.firma(o.firma), o.neden, o.yas, gecmis?.find((f) => f.ad === o.firma))}</span> <Button variant="secondary" size="sm" onClick={() => onKapat(batisAnahtari(o))}>{t("dao.batis.kapat")}</Button>
          </Banner>
        </div>
      ))}
    </>
  );
}

type IstenOlayi = Extract<DaoOlay, { tur: "isten_cikarildi" }>;
/** İşten çıkarma bildiriminin kimliği (kapatılanı ayırt eder). */
export const istenAnahtari = (o: IstenOlayi): string => `${o.hafta}:${o.firma}:isten`;

/**
 * İşten çıkarıldın: `isten_cikarildi` olayları (ahırdan ayrılış hariç) belirgin bir bantta, nedeniyle. Aynı hafta başvurusu kabul edilmişse bunu da söyler
 * (kabul ile çıkarılma tek haftada olunca olay şeridinde kaybolur). Gözlem yalnız son haftanın olaylarını taşır; görülenler yerel durumda tutulur ve
 * oyuncu "Tamam" diyene dek (hafta ilerlese de) kalır.
 */
export function DaoIstenCikarmaBildirimi({ olaylar, ad, kapatilan, onKapat }: { olaylar: DaoOlay[]; ad: DaoAdlar; kapatilan: ReadonlySet<string>; onKapat(anahtar: string): void }) {
  const [gorulen, setGorulen] = useState<{ o: IstenOlayi; ayniHafta: boolean }[]>([]);
  const istenler = olaylar.filter((o): o is IstenOlayi => o.tur === "isten_cikarildi" && ad.firma(o.firma) !== ad.sektor("ahir"));
  const yeniler = istenler
    .filter((o) => !gorulen.some((g) => istenAnahtari(g.o) === istenAnahtari(o)))
    .map((o) => ({ o, ayniHafta: olaylar.some((x) => x.tur === "basvuru_kabul" && x.hafta === o.hafta && x.firma === o.firma) }));
  if (yeniler.length > 0) setGorulen([...gorulen, ...yeniler]);
  const liste = [...gorulen, ...yeniler].filter((g) => !kapatilan.has(istenAnahtari(g.o)));
  if (liste.length === 0) return null;
  return (
    <>
      {liste.map(({ o, ayniHafta }) => (
        <div key={istenAnahtari(o)} data-dao-isten={o.firma} aria-label={t("dao.isten.bildirim_etiket")}>
          <Banner tone="crisis">
            <span>{t("dao.olaylar.satir", { hafta: o.hafta, metin: daoOlayMetni(o, ad) })}</span> {ayniHafta ? <span>{t("dao.isten.ayni_hafta")}</span> : null} <Button variant="secondary" size="sm" onClick={() => onKapat(istenAnahtari(o))}>{t("dao.isten.kapat")}</Button>
          </Banner>
        </div>
      ))}
    </>
  );
}
