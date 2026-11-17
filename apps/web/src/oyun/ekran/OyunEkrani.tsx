import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../copy/t";
import { AltSayfa } from "./AltSayfa";
import renk from "./ekranRenkleri.module.css";
import { OlaySeridi, type OlayKapisi, type OlayOgesi } from "./OlaySeridi";
import { EKRAN_STILI } from "./ekranStili";
import stil from "./OyunEkrani.module.css";
import { SehirSecici } from "./SehirSecici";
import { useEkranBoyutu } from "./useEkranBoyutu";
import { YuzenPanel } from "./YuzenPanel";

export type SehirOzeti = { id: number; ad: string; ozet?: string };

export type SolPanel = { baslik: string; icerik: ReactNode };
/** Sağ panel yalnız seçimde verilir (`null`/`undefined` iken kapalıdır). */
export type SagPanel = { baslik: string; icerik: ReactNode; onKapat: () => void };

export type OyunEkraniProps = {
  /** Tam ekran harita tuvali (kabuk haritanın türünü bilmez). */
  tuval: ReactNode;
  sehirler: SehirOzeti[];
  sehir: number;
  onSehir: (id: number) => void;
  ustSol?: ReactNode;
  ustOrta?: ReactNode;
  /** Sağ üstte şehir seçicinin yanındaki menü yuvası. */
  menu?: ReactNode;
  solPanel?: SolPanel | null;
  sagPanel?: SagPanel | null;
  olaylar?: OlayOgesi[];
  /** Olay şeridinin yanındaki "Tüm olaylar" kapısı. */
  olayKapisi?: OlayKapisi;
  /** Sağ altta yüzen harita kontrolleri (ör. `HaritaKontrolleri`). */
  haritaKontrolleri?: ReactNode;
  /** Kayıt kaynağında bina verisi yoktur; notu gösterir (K3). */
  binaVerisiYok?: boolean;
  /** Tuval etkileşime kapalı (`inert`): üstte bir pencere açıkken şehir tıklamaları, sürükleme ve odak kapalıdır. */
  tuvalKilitli?: boolean;
  /** Olay şeridinin üstünde duran kısa ipucu (rehber). */
  ipucu?: ReactNode;
  /** Şehrin üstünde açılan pencereler (örn. oyun sonucu); `ekran` takma adları bu bölgenin içinde çözülür. */
  pencere?: ReactNode;
  /**
   * Yüzen öğelerin (üst şerit, açık paneller, alt şerit/alt sayfa) kabuğun kenarlarından kapladığı yer, GERÇEK kutulardan ölçülür
   * (boyut ya da panel durumu değişince yeniden bildirilir). Harita bu payların dışındaki serbest alana sığdırılır.
   */
  onPay?: (pay: { ust: number; alt: number; sol: number; sag: number }) => void;
};

type Pay = { ust: number; alt: number; sol: number; sag: number };

/**
 * Ortak oyun kabuğu (OyunApp zaten `main` taşır, bu yüzden bölge olarak çizilir): tam ekran tuval + üstünde yüzen yuvalar ve paneller.
 * Masaüstü: sol panel daraltılabilir (≤1280 px kapalı başlar), sağ panel yalnız seçimde. Telefon (≤720 px): paneller alt sayfa.
 * Kaplama tıklamayı geçirir; yalnız yuvalar ve paneller tıklamayı tutar.
 */
export function OyunEkrani({
  tuval,
  sehirler,
  sehir,
  onSehir,
  ustSol,
  ustOrta,
  menu,
  solPanel,
  sagPanel,
  olaylar = [],
  olayKapisi,
  haritaKontrolleri,
  binaVerisiYok = false,
  tuvalKilitli = false,
  ipucu,
  pencere,
  onPay,
}: OyunEkraniProps) {
  const { telefon, dar } = useEkranBoyutu();
  // null: oyuncu dokunmadı, varsayılan genişliğe göre (masaüstünde açık, ≤1280 px kapalı).
  const [solTercih, setSolTercih] = useState<boolean | null>(null);
  const solAcik = solTercih ?? !dar;
  // Telefon alt sayfasının durumu masaüstü sol panel tercihinden ayrıdır (pencere büyüyünce sızmaz).
  const [altSayfaAcik, setAltSayfaAcik] = useState(false);
  const altSayfaId = useId();
  const alanRef = useRef<HTMLElement>(null);
  const sonPay = useRef("");
  const sonOnPay = useRef(onPay);
  useEffect(() => {
    sonOnPay.current = onPay;
  });
  /** Yüzen öğelerin gerçek kutularından pay ölçer. */
  const olc = useCallback(() => {
    const el = alanRef.current;
    if (el === null) return;
    const a = el.getBoundingClientRect();
    const p: Pay = { ust: 0, alt: 0, sol: 0, sag: 0 };
    let altUst = Infinity;
    for (const e of Array.from(el.querySelectorAll("[data-pay]"))) {
      const r = e.getBoundingClientRect();
      switch (e.getAttribute("data-pay")) {
        case "ust": p.ust = Math.max(p.ust, r.bottom - a.top); break;
        case "sol": p.sol = Math.max(p.sol, r.right - a.left); break;
        case "sag": p.sag = Math.max(p.sag, a.right - r.left); break;
        case "alt": altUst = Math.min(altUst, r.top); break;
      }
    }
    if (altUst !== Infinity) p.alt = Math.max(0, a.bottom - altUst);
    const a8 = EKRAN_STILI.payAralik;
    const sonuc: Pay = { ust: p.ust + a8, alt: p.alt > 0 ? p.alt + a8 : 0, sol: p.sol > 0 ? p.sol + a8 : 0, sag: p.sag > 0 ? p.sag + a8 : 0 };
    const anahtar = JSON.stringify(sonuc);
    if (anahtar === sonPay.current) return;
    sonPay.current = anahtar;
    sonOnPay.current?.(sonuc);
  }, []);
  useLayoutEffect(() => {
    olc(); // her çizimde (panel açılıp kapanması, telefon alt sayfası); değişmediyse bildirmez
  });
  useEffect(() => {
    const el = alanRef.current;
    if (el === null) return;
    window.addEventListener("resize", olc);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => olc());
    ro?.observe(el);
    for (const e of Array.from(el.querySelectorAll("[data-pay]"))) ro?.observe(e);
    return () => {
      window.removeEventListener("resize", olc);
      ro?.disconnect();
    };
  });
  const seciliAd = sehirler.find((s) => s.id === sehir)?.ad ?? "";

  return (
    <section ref={alanRef} aria-label={t("ekran.ana")} className={`${renk.kok} ${stil.alan}`}>
      <div className={stil.tuval} inert={tuvalKilitli}>
        {tuval}
      </div>
      <h2 className={stil.gizli}>{seciliAd}</h2>
      <div className={stil.kaplama}>
        <div className={stil.ustSerit} data-pay="ust">
          {ustSol ? <div className={stil.ustSol}>{ustSol}</div> : null}
          <div className={stil.ustOrta}>{ustOrta}</div>
          <div className={stil.ustSag}>
            {menu}
            <SehirSecici sehirler={sehirler} sehir={sehir} onSehir={onSehir} />
          </div>
        </div>

        {!telefon && solPanel ? (
          <div className={stil.panelSol} data-pay="sol" data-daraltilmis={!solAcik}>
            <YuzenPanel baslik={solPanel.baslik} acik={solAcik} onAcikDegis={setSolTercih}>
              {solPanel.icerik}
            </YuzenPanel>
          </div>
        ) : null}
        {!telefon && sagPanel ? (
          <div className={stil.panelSag} data-pay="sag">
            <YuzenPanel baslik={sagPanel.baslik} onKapat={sagPanel.onKapat}>
              {sagPanel.icerik}
            </YuzenPanel>
          </div>
        ) : null}

        <div className={stil.alt}>
          <div className={stil.altSol} data-pay="alt">
            {binaVerisiYok ? (
              <p role="status" className={stil.not}>
                {t("harita.bina_yok")}
              </p>
            ) : null}
            {telefon && solPanel && !sagPanel ? (
              <button type="button" className={stil.panelDugme} aria-expanded={altSayfaAcik} aria-controls={altSayfaAcik ? altSayfaId : undefined} onClick={() => setAltSayfaAcik((a) => !a)}>
                {t("ekran.panel_goster")}
              </button>
            ) : null}
            {ipucu}
            <OlaySeridi olaylar={olaylar} {...(olayKapisi ? { kapi: olayKapisi } : {})} />
          </div>
          {haritaKontrolleri ? <div className={stil.altSag} data-pay="alt">{haritaKontrolleri}</div> : null}
        </div>

        {telefon && sagPanel ? (
          <AltSayfa baslik={sagPanel.baslik} onKapat={sagPanel.onKapat}>
            {sagPanel.icerik}
          </AltSayfa>
        ) : null}
        {telefon && !sagPanel && solPanel && altSayfaAcik ? (
          <AltSayfa id={altSayfaId} baslik={solPanel.baslik} onKapat={() => setAltSayfaAcik(false)}>
            {solPanel.icerik}
          </AltSayfa>
        ) : null}
      </div>
      {pencere}
    </section>
  );
}
