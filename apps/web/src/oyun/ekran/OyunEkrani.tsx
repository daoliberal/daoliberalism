import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../copy/t";
import { AltSayfa } from "./AltSayfa";
import renk from "./ekranRenkleri.module.css";
import { OlaySeridi, type OlayKapisi, type OlayOgesi } from "./OlaySeridi";
import { EKRAN_STILI } from "./ekranStili";
import stil from "./OyunEkrani.module.css";
import { BildirimYuvasi, useBildirimYuvasiVarMi } from "../ui/BildirimYuvasi";
import { SehirSecici } from "./SehirSecici";
import { useEkranBoyutu } from "./useEkranBoyutu";
import { YuzenPanel } from "./YuzenPanel";

export type SehirOzeti = { id: number; ad: string; ozet?: string };

/**
 * `kontrol` verilirse sol panel dışarıdan yönetilir (DAO: Unvan düğmesi açar): yalnız `acik` iken çizilir, başlıkta ✕ kapat ikonu ve Esc `onKapat`ı çağırır,
 * daralt ve telefondaki "Paneli göster" düğmeleri yoktur; `id` açan düğmenin `aria-controls` hedefidir.
 */
export type SolPanel = { baslik: string; icerik: ReactNode; kontrol?: { acik: boolean; onKapat: () => void; id: string } };
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
  /** DAO: olay şeridi sol üstte (Unvan düğmesinin ve Ben panelinin altında) durur ve şeridin kendisi "Tüm olaylar" düğmesidir; alt-sol sütunda çizilmez. */
  olayUstte?: boolean;
  /** Alt ortada duran denetim (DAO: hafta ilerletme); masaüstünde ve telefonda aynı yer. */
  altOrta?: ReactNode;
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

/** Yan panellerin alt kenari (CSS: `--space-140` + n x `--space-48`): sutun yuksekligi bu tabani asinca 48 px'lik basamakla yukselir. */
const ALT_TABAN_PX = 140;
const ALT_ADIM_PX = 48;
const ALT_SEVIYE_EN_COK = 8;

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
  olayUstte = false,
  altOrta,
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
  const yuvaVar = useBildirimYuvasiVarMi();
  const [altSeviye, setAltSeviye] = useState(0);
  const yuvaVarRef = useRef(yuvaVar);
  const sonPay = useRef("");
  const sonOnPay = useRef(onPay);
  useEffect(() => {
    sonOnPay.current = onPay;
    yuvaVarRef.current = yuvaVar;
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
      if (r.width === 0 && r.height === 0) continue; // `display: contents` (telefon alt sütunu) kutu üretmez: ölçüye katılmaz
      switch (e.getAttribute("data-pay")) {
        case "ust": p.ust = Math.max(p.ust, r.bottom - a.top); break;
        case "sol": p.sol = Math.max(p.sol, r.right - a.left); break;
        case "sag": p.sag = Math.max(p.sag, a.right - r.left); break;
        case "alt": altUst = Math.min(altUst, r.top); break;
      }
    }
    if (altUst !== Infinity) p.alt = Math.max(0, a.bottom - altUst);
    // Alt sutunun (bantlar + ipucu + olay seridi) yuksekligi 140 px'i asarsa yan paneller bunun ustunde biter (B10 Ö-yeni-2): 48 px'lik basamaklar (satir ici stil yasak).
    const seviye = !yuvaVarRef.current ? 0 : Math.min(ALT_SEVIYE_EN_COK, Math.max(0, Math.ceil((p.alt + EKRAN_STILI.payAralik - ALT_TABAN_PX) / ALT_ADIM_PX)));
    setAltSeviye((o) => (o === seviye ? o : seviye));
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
          {olayUstte && olaylar.length > 0 ? (
            <div className={stil.olayKutu}>
              <OlaySeridi olaylar={olaylar} kapiUstte {...(olayKapisi ? { kapi: olayKapisi } : {})} />
            </div>
          ) : null}
          <div className={stil.ustOrta}>{ustOrta}</div>
          <div className={stil.ustSag}>
            {menu}
            <SehirSecici sehirler={sehirler} sehir={sehir} onSehir={onSehir} />
          </div>
        </div>

        {!telefon && solPanel && solPanel.kontrol === undefined ? (
          <div className={stil.panelSol} data-pay="sol" data-daraltilmis={!solAcik} data-alt-seviye={yuvaVar ? altSeviye : undefined}>
            <YuzenPanel baslik={solPanel.baslik} acik={solAcik} onAcikDegis={setSolTercih}>
              {solPanel.icerik}
            </YuzenPanel>
          </div>
        ) : null}
        {!telefon && solPanel?.kontrol?.acik ? (
          <div className={stil.panelSol} data-pay="sol" data-olay={olayUstte && olaylar.length > 0 ? "var" : undefined} data-alt-seviye={yuvaVar ? altSeviye : undefined}>
            <YuzenPanel id={solPanel.kontrol.id} baslik={solPanel.baslik} onKapat={solPanel.kontrol.onKapat} kapatIkon>
              {solPanel.icerik}
            </YuzenPanel>
          </div>
        ) : null}
        {!telefon && sagPanel ? (
          <div className={stil.panelSag} data-pay="sag" data-alt-seviye={yuvaVar ? altSeviye : undefined}>
            <YuzenPanel baslik={sagPanel.baslik} onKapat={sagPanel.onKapat} kapatIkon>
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
            {telefon && solPanel && solPanel.kontrol === undefined && !sagPanel ? (
              <button type="button" className={stil.panelDugme} aria-expanded={altSayfaAcik} aria-controls={altSayfaAcik ? altSayfaId : undefined} onClick={() => setAltSayfaAcik((a) => !a)}>
                {t("ekran.panel_goster")}
              </button>
            ) : null}
            <BildirimYuvasi />
            {ipucu}
            {olayUstte ? null : <OlaySeridi olaylar={olaylar} {...(olayKapisi ? { kapi: olayKapisi } : {})} />}
          </div>
          {haritaKontrolleri ? <div className={stil.altSag} data-pay="alt">{haritaKontrolleri}</div> : null}
          {altOrta ? <div className={stil.altOrta} data-pay="alt">{altOrta}</div> : null}
        </div>

        {telefon && sagPanel ? (
          <AltSayfa baslik={sagPanel.baslik} onKapat={sagPanel.onKapat}>
            {sagPanel.icerik}
          </AltSayfa>
        ) : null}
        {telefon && !sagPanel && solPanel?.kontrol?.acik ? (
          <AltSayfa id={solPanel.kontrol.id} baslik={solPanel.baslik} onKapat={solPanel.kontrol.onKapat} kapatIkon>
            {solPanel.icerik}
          </AltSayfa>
        ) : null}
        {telefon && !sagPanel && solPanel && solPanel.kontrol === undefined && altSayfaAcik ? (
          <AltSayfa id={altSayfaId} baslik={solPanel.baslik} onKapat={() => setAltSayfaAcik(false)}>
            {solPanel.icerik}
          </AltSayfa>
        ) : null}
      </div>
      {pencere}
    </section>
  );
}
