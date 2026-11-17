"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import renk from "@/oyun/ekran/ekranRenkleri.module.css";
import { SartOkuyucu } from "@/oyun/screens/ortak/SartOkuyucu";
import type { Registry, RunState, WeekPacket, WorldEvent, WorldInfo } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import type { ChartMarker } from "@/oyun/ui/LineChart";
import { Sekmeler, sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { SEKMELER, type SekmeKimligi } from "./ayrintilarEslemesi";
import { BitisKarti } from "./BitisKarti";
import { BuHaftaSeridi } from "./BuHaftaSeridi";
import { DunyaKurulumuPaneli } from "./DunyaKurulumuPaneli";
import { Gostergeler } from "./Gostergeler";
import { IseAlimPaneli } from "./IseAlimPaneli";
import { IsgucuAkislariPaneli } from "./IsgucuAkislariPaneli";
import { IssizlikPaneli } from "./IssizlikPaneli";
import { KararGunlugu } from "./KararGunlugu";
import { KosuEylemleri } from "./KosuEylemleri";
import { NedenSonuc } from "./NedenSonuc";
import { NeOlmuyor } from "./NeOlmuyor";
import { NufusPaneli } from "./NufusPaneli";
import { OlayAkisi, type SuzgecKipi } from "./OlayAkisi";
import { ParaDagilimiPaneli } from "./ParaDagilimiPaneli";
import { PiyasaPaneli } from "./PiyasaPaneli";
import { SaglikBasligi } from "./SaglikBasligi";
import { TuketimPaneli } from "./TuketimPaneli";
import { IsletmeIsgucuPaneli } from "./IsletmeIsgucuPaneli";
import { MakroPaneli } from "./MakroPaneli";
import { OyuncuDilimleri } from "./OyuncuDilimleri";
import type { SurumSatiri } from "./olaylar";
import type { Dallan } from "./useDallan";
import { ZamanCizgisi } from "./ZamanCizgisi";
import { ZincirGorunumu } from "./zincir/ZincirGorunumu";
import akis from "./Akis.module.css";
import canli from "./Canli.module.css";
import styles from "./Ayrintilar.module.css";

type Kapsam = "dunya" | number;
const SEHIRLER = [0, 1, 2, 3, 4] as const;
const ONEK = "ayrintilar";
/** Kapsam seçicisi yalnız şehir süzgeci olan sekmelerde (göstergeler, işsizlik) görünür. */
const KAPSAMLI: readonly SekmeKimligi[] = ["genel", "piyasa", "tuketim", "isletmeler"];
/** Koşuyu yöneten sekmeler: salt okunur kipte (DAO "Ekonomi") yoktur. */
const KOSU_SEKMELERI: readonly SekmeKimligi[] = ["zaman", "kosu"];

/** Koşuyu yöneten yüzeyler (Zaman çizgisi, Koşu ve kararlar); salt okunur kipte (DAO "Ekonomi") yoktur. */
export type AyrintilarKosuProps = {
  salt?: false;
  /** Koşu sürerken Şartı değiştir panelini açar; bittiyse/çöktüyse `undefined`. */
  onDegistir?(): void;
  onSifirla(): void;
  onSonuc(): void;
  /** Bitiş diyaloğunu açar; yalnız koşu bittiğinde bitiş kartı çizilir. */
  onBitisAc(): void;
  dallan: Dallan;
  satirlar: SurumSatiri[];
  /** Hata, hesaplanıyor ve dikiş bantları (kabukta da çizilen aynı düğüm). */
  bantlar: ReactNode;
};

/** Salt okunur kip: yalnız göstergeler, grafikler ve tablolar; şart değiştirme, dallanma, sıfırlama ve koşu kontrolleri yoktur. */
export type AyrintilarSaltProps = { salt: true };

export type AyrintilarProps = (AyrintilarKosuProps | AyrintilarSaltProps) & {
  /** Koşu anahtarı: değişince (başka koşuya geçilince) olay süzgeci sıfırlanır ve pencere kapanır. */
  kosuAnahtari: string;
  state: RunState;
  cur: WeekPacket | null;
  prev: WeekPacket | null;
  /** Çizim hızıyla sınırlanmış haftalar ve olaylar; zincir ve zaman çizgisi sınırsız `tumHaftalar`'ı kullanır. */
  weeks: WeekPacket[];
  tumHaftalar: WeekPacket[];
  events: WorldEvent[];
  tumOlaylar: WorldEvent[];
  markers: ChartMarker[];
  total: number;
  /** Başlangıç kapsamı: şehir numarası ya da `null` (dünya). */
  sehir: number | null;
  sehirAdlari: string[];
  isLive: boolean;
  sehirAcik: boolean;
  zincirAcik: boolean;
  dunya: WorldInfo | undefined;
  sektorAdi(sektor: string): string;
  /** Çekmece yoksa (kayıt kaynağı) bağlantılar düz metindir. */
  ac?(kind: string, ref: string): void;
  registry: Registry | null;
  /** Başka bir katman (sıfırlama, bitiş, dal hazırlığı) açılınca pencere kapanır; durumu (sekme, süzgeç) korunur, katman kapanınca kendiliğinden açılmaz. */
  baski?: boolean;
  /** Dal isteği sürerken "Hesaplanıyor" diyaloğu pencerenin yerine geçer; istek hata ile dönerse pencere (ve hata notu) yerinde bulunur. */
  bekle?: boolean;
  /** Başlangıç durumu (eski görünüm rotaları): açık mı ve hangi sekme. */
  ilk?: { acik?: boolean; sekme?: SekmeKimligi };
  onAcik?(acik: boolean): void;
  /** Dışarıdan açma komutu (ör. olay şeridindeki "Tüm olaylar"): `n` her komutta artar, pencere o sekmede açılır. */
  komut?: { n: number; sekme: SekmeKimligi } | null;
};

/**
 * Ayrıntılar: Kurucu'nun eski sayfa yüzeylerinin hepsi, menüden açılan sekmeli pencerede (eşleme: `ayrintilarEslemesi.ts`).
 * Düğme + pencere birlikte çizilir (menü yuvasına konur). Çekmece, şart paneli ve diyaloglar pencerenin üstüne değil yerine açılır
 * (pencere kapanır, durumu saklanır): iki modal üst üste durmaz.
 */
export function Ayrintilar(p: AyrintilarProps) {
  const [acik, setAcik] = useState(p.ilk?.acik ?? false);
  const [sekme, setSekme] = useState<SekmeKimligi>(p.ilk?.sekme ?? "genel");
  /** Oyuncunun seçtiği kapsam; seçmediyse sayfanın şehir görünümü (rota) belirler. */
  const [kapsamTercih, setKapsam] = useState<Kapsam | null>(null);
  const [kip, setKip] = useState<SuzgecKipi>("onemli");
  const [olayHaftasi, setOlayHaftasi] = useState<number | null>(null);
  const [seciliOlay, setSeciliOlay] = useState<string | null>(null);
  const [okuyucu, setOkuyucu] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [sonKomut, setSonKomut] = useState(p.komut?.n ?? 0);
  if (p.komut && p.komut.n !== sonKomut) {
    setSonKomut(p.komut.n);
    setAcik(true);
    setSekme(p.komut.sekme);
  }
  const [anahtar, setAnahtar] = useState(p.kosuAnahtari);
  if (anahtar !== p.kosuAnahtari) {
    setAnahtar(p.kosuAnahtari);
    setAcik(false);
    setOkuyucu(false);
    setKapsam(null);
    setPick(null);
    setSeciliOlay(null);
    setOlayHaftasi(null);
  }
  // Başka bir katman (sıfırlama, bitiş, dal hazırlığı) açılırken pencere kapanır; katman kapanınca kendiliğinden geri açılmaz.
  if (p.baski && acik) setAcik(false);
  const { onAcik } = p;
  useEffect(() => onAcik?.(acik), [acik, onAcik]);

  const kapat = () => setAcik(false);
  /** Pencerenin dışında açılan bir şeyi (çekmece, şart paneli, diyalog) açmadan önce pencereyi kapatır. */
  const kapatVe = <A extends unknown[]>(f: ((...a: A) => void) | undefined): ((...a: A) => void) | undefined =>
    f ? (...a) => { setAcik(false); f(...a); } : undefined;
  const ac = kapatVe(p.ac);
  const kuralDegistir = kapatVe(p.salt ? undefined : p.onDegistir);
  const sekmeler = p.salt ? SEKMELER.filter((s) => !KOSU_SEKMELERI.includes(s.id)) : SEKMELER;

  const etkinKapsam: Kapsam = p.sehirAcik ? (kapsamTercih ?? p.sehir ?? "dunya") : "dunya";
  const sehirNo = etkinKapsam === "dunya" ? null : etkinKapsam;
  const acOpt = ac ? { ac } : {};

  const govde = (() => {
    switch (sekme) {
      case "genel":
        return (
          <>
            <SaglikBasligi cur={p.cur} sehirAdlari={p.sehirAdlari} sektorAdi={p.sektorAdi} {...acOpt} />
            <BuHaftaSeridi cur={p.cur} prev={p.prev} />
            <Gostergeler weeks={p.weeks} total={p.total} cur={p.cur} sehir={sehirNo} sehirAdlari={p.sehirAdlari} markers={p.markers} isLive={p.isLive} />
          </>
        );
      case "piyasa":
        return (
          <>
            <PiyasaPaneli weeks={p.weeks} cur={p.cur} />
            <IssizlikPaneli weeks={p.weeks} cur={p.cur} sehir={sehirNo} sehirAdlari={p.sehirAdlari} isLive={p.isLive} />
            <IseAlimPaneli weeks={p.weeks} cur={p.cur} isLive={p.isLive} />
          </>
        );
      case "tuketim":
        return <TuketimPaneli weeks={p.weeks} cur={p.cur} sehir={sehirNo} sehirAdlari={p.sehirAdlari} isLive={p.isLive} runId={p.state.runId} />;
      case "isletmeler":
        return <IsletmeIsgucuPaneli weeks={p.weeks} cur={p.cur} sehir={sehirNo} sehirAdlari={p.sehirAdlari} sektorAdi={p.sektorAdi} isLive={p.isLive} runId={p.state.runId} />;
      case "makro":
        return <MakroPaneli weeks={p.weeks} cur={p.cur} />;
      case "nufus":
        return (
          <>
            <NufusPaneli weeks={p.weeks} cur={p.cur} isLive={p.isLive} />
            <IsgucuAkislariPaneli weeks={p.weeks} cur={p.cur} isLive={p.isLive} />
            <ParaDagilimiPaneli weeks={p.weeks} cur={p.cur} isLive={p.isLive} onAc={ac} />
            <OyuncuDilimleri cur={p.cur} />
            <DunyaKurulumuPaneli weeks={p.weeks} cur={p.cur} isLive={p.isLive} />
          </>
        );
      case "zincir":
        return p.zincirAcik ? (
          <ZincirGorunumu cur={p.cur} weeks={p.tumHaftalar} dunya={p.dunya} sektorAdi={p.sektorAdi} {...acOpt} />
        ) : (
          <p className={canli.kucuk}>{t(p.isLive ? "canli.dunya.kilit_zincir.live" : "canli.dunya.kilit_zincir")}</p>
        );
      case "olaylar":
        return (
          <>
            <div className={akis.izgara}>
              <OlayAkisi events={p.events} kip={kip} onKip={setKip} hafta={olayHaftasi} onHaftaTemizle={() => setOlayHaftasi(null)} secili={seciliOlay} onSec={setSeciliOlay} />
              <NedenSonuc olay={p.events.find((e) => e.id === seciliOlay) ?? null} registry={p.registry} {...(kuralDegistir ? { onDegistir: kuralDegistir } : {})} />
            </div>
            <NeOlmuyor tanilar={p.cur?.diagnostics} canli={p.isLive} {...(kuralDegistir ? { onDegistir: kuralDegistir } : {})} />
          </>
        );
      case "zaman":
        return p.salt ? null : (
          <ZamanCizgisi
            hafta={p.state.week} weeks={p.tumHaftalar} surumler={p.satirlar} dallan={p.dallan} secim={{ pick, onPick: setPick }}
            onOlaylar={(w) => { setKip("tumu"); setOlayHaftasi(w); setSekme("olaylar"); }}
          />
        );
      case "kosu":
        return p.salt ? null : (
          <>
            {p.bantlar}
            {p.state.status === "ended" ? <BitisKarti weeks={p.state.week} events={p.tumOlaylar} ac={() => { setAcik(false); p.onBitisAc(); }} /> : null}
            <section aria-label={t("ayrintilar.kosu.islemler")} className={canli.bolum}>
              <h2 className={canli.baslik}>{t("ayrintilar.kosu.islemler")}</h2>
              <div className={canli.dugmeler}>
                <KosuEylemleri
                  eylemler={["sart", "degistir", "sifirla", "sonuc"]} state={p.state} {...(kuralDegistir ? { onDegistir: () => kuralDegistir() } : {})}
                  onSart={() => { setAcik(false); setOkuyucu(true); }} onSifirla={() => { setAcik(false); p.onSifirla(); }}
                  onSonuc={() => { setAcik(false); p.onSonuc(); }} onGunluk={() => undefined}
                />
              </div>
            </section>
            <section aria-label={t("ustcubuk.gunluk")} className={canli.bolum}>
              <h2 className={canli.baslik}>{t("ustcubuk.gunluk")}</h2>
              <KararGunlugu state={p.state} events={p.tumOlaylar} registry={p.registry} />
            </section>
          </>
        );
    }
  })();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setAcik(true)}>
        {t(p.salt ? "ekonomi.dugme" : "ayrintilar.dugme")}
      </Button>
      {acik && !p.baski && !p.bekle ? (
        <div className={renk.kok}>
          <Diyalog baslik={t(p.salt ? "ekonomi.baslik" : "ayrintilar.baslik")} onKapat={kapat} yuzen>
            <Sekmeler
              etiket={t("ayrintilar.sekmeler")} onek={ONEK} secili={sekme} onSec={(id) => setSekme(id as SekmeKimligi)}
              sekmeler={sekmeler.map((s) => ({ id: s.id, baslik: t(s.baslik) }))}
            />
            {p.sehirAcik && KAPSAMLI.includes(sekme) ? (
              <div role="group" aria-label={t("ayrintilar.kapsam")} className={styles.kapsam}>
                <Button variant="toggle" size="sm" pressed={etkinKapsam === "dunya"} onClick={() => setKapsam("dunya")}>
                  {t("ayrintilar.kapsam_dunya")}
                </Button>
                {SEHIRLER.map((i) => (
                  <Button key={i} variant="toggle" size="sm" pressed={etkinKapsam === i} onClick={() => setKapsam(i)}>
                    {cityDisplayName(p.sehirAdlari[i] ?? "", i)}
                  </Button>
                ))}
              </div>
            ) : null}
            {p.salt && p.cur === null ? <p role="status" className={canli.kucuk}>{t("ekonomi.ilk_hafta_notu")}</p> : null}
            <div role="tabpanel" id={sekmePaneliKimligi(ONEK)} aria-labelledby={sekmeKimligi(ONEK, sekme)} className={styles.panel}>
              <Stack gap="24">{govde}</Stack>
            </div>
          </Diyalog>
        </div>
      ) : null}
      {okuyucu && !acik ? <SartOkuyucu state={p.state} onKapat={() => setOkuyucu(false)} /> : null}
    </>
  );
}
