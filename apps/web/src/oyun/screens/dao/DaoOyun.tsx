"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { useHashRoute, type SehirNo } from "@/oyun/hooks/useHashRoute";
import { HaritaKontrolleri } from "@/oyun/ekran/HaritaKontrolleri";
import { OyunEkrani, type SehirOzeti } from "@/oyun/ekran/OyunEkrani";
import { adlandirici } from "@/oyun/harita/adlar";
import type { KameraKomutu, OdakHedefi } from "@/oyun/harita/HaritaSahnesi";
import { haritaAcik, sonHarita } from "@/oyun/harita/haritaKaynagi";
import { HaritaAltSag, KatmanLejanti, KatmanSecici } from "@/oyun/harita/KatmanSecici";
import { oncekiPaket } from "@/oyun/harita/oncekiPaket";
import { parselTuruOf } from "@/oyun/harita/izoSahne";
import { sehirSahnesi } from "@/oyun/harita/sehirSahnesi";
import { SehirTuvaliKap } from "@/oyun/harita/SehirTuvaliKap";
import { PAYSIZ, type Pay } from "@/oyun/harita/gorunum";
import { useEtkinSahne } from "@/oyun/harita/useEtkinSahne";
import { useGorunumModu } from "@/oyun/harita/useGorunumModu";
import { useGorselDurumlari } from "@/oyun/harita/useGorselDurumlari";
import { useBalonlar } from "@/oyun/harita/useBalonlar";
import { useHaritaGecisleri } from "@/oyun/harita/useHaritaGecisleri";
import { useKaliciYerlesim, useOyuncuParseli } from "@/oyun/harita/useKaliciYerlesim";
import type { Gorunum, HaritaRef, Katman } from "@/oyun/harita/tipler";
import { Ayrintilar } from "@/oyun/screens/canli/Ayrintilar";
import { KARE_MS, markersOf } from "@/oyun/screens/canli/Canli";
import kabuk from "@/oyun/screens/canli/Kabuk.module.css";
import { KurucuMenu } from "@/oyun/screens/canli/KurucuMenu";
import { lastTwo } from "@/oyun/screens/canli/olaylar";
import { useThrottled } from "@/oyun/screens/canli/useThrottled";
import { Ipucu } from "@/oyun/screens/rehber/RehberBandi";
import type { Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { useRun } from "@/oyun/sim/useRun";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { Yukleniyor } from "@/oyun/ui/Durum";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { DaoBaglam, daoBaglamBasligi, type DaoSecimi, type SehirSekmesi } from "./DaoBaglam";
import { DaoBen } from "./DaoBen";
import { useDaoKarar } from "./DaoKararlar";
import { DaoKontrol } from "./DaoKontrol";
import { DaoBatisBildirimi, DaoIstenCikarmaBildirimi, DaoOlayListesi, daoOlayOgeleri } from "./DaoPaneller";
import { DaoSonuc } from "./DaoSonuc";
import { DaoUst } from "./DaoUst";
import { daoAdlari, daoHaritaBeni } from "./DaoYardim";
import { useDaoGozlem } from "./useDaoGozlem";
import styles from "./DaoEkrani.module.css";

const SEHIR_SAYISI = 5;

/** Koşu yok / yükleniyor / hata gibi kabuğun çizilmediği durumlar tam ekran kapta ortalanır. */
function Merkez({ children }: { children: ReactNode }) {
  return <div className={kabuk.merkez}>{children}</div>;
}

/**
 * DAO oyunu: tam ekran şehir kabuğu. Harita ekranı kaplar; üstünde oyuncu durumu, zaman kontrolleri, menü ve şehir seçici; solda Ben paneli,
 * sağda seçime göre bağlam eylemleri (ahırdan çık, işten ayrıl, taşın, işletme kur, mevduat ve para çek), altta olay şeridi.
 * Oyuncunun kararları her zaman açık düğmeyle verilir; hiçbir adım kendiliğinden olmaz. Süre bitince sonuç şehrin üstünde pencere olur.
 */
export function DaoOyun({ runId, tercih }: { runId: string; tercih?: Tercih }) {
  const { route, go, replace } = useHashRoute();
  const source = useSimSource();
  const run = useRun(runId);
  const { info, capabilities } = useSourceInfo();
  const { gozlem, hazirlaniyor, hata } = useDaoGozlem(runId, run.state, run.weeks);
  const state = run.state;
  /** Gözlem alınamıyorsa anlaşılır neden: koşu çöktü / sunucu ilk haftayı yayımlamadı / genel. */
  const gozlemHataMetni = hata === "kosu_coktu" ? t("dao.hata.kosu_coktu") : hata === "kosu_yanit_vermiyor" ? t("dao.hata.kosu_yanit_vermiyor") : t("dao.hata.gozlem");
  const sehirAdlari = useMemo(() => state?.cityNames ?? [], [state?.cityNames]);
  const ad = useMemo(() => daoAdlari(sehirAdlari, info), [sehirAdlari, info]);
  const adlar = useMemo(() => adlandirici(ad.sektor), [ad]);
  const olaylar = useMemo(() => run.weeks.flatMap((w) => w.dao?.olaylar ?? []), [run.weeks]);
  const bundle = useMemo(() => ({ weeks: run.weeks }), [run.weeks]);
  const { weeks } = useThrottled(bundle, KARE_MS);
  // Ekonomi penceresinin grafik işaretleri: DAO'da olay süzgeci yok (sehir: null); her renderda yeni dizi olmasın.
  const markers = useMemo(() => markersOf(run.events, null), [run.events]);
  const cur = weeks.length > 0 ? weeks[weeks.length - 1]! : null;

  const benSehir = gozlem?.ben.sehir;
  const sehirNo = route.name === "dao" && route.sehir !== undefined ? route.sehir : (benSehir ?? 0);
  /** Haritada seçili yer (sağ panel); şehir değişince geçersizdir. */
  const [secim, setSecim] = useState<DaoSecimi | null>(null);
  const [katman, setKatman] = useState<Katman>("yok");
  const [kamera, setKamera] = useState<Gorunum>({ x: 0, y: 0, olcek: 1 });
  const [komut, setKomut] = useState<KameraKomutu | null>(null);
  const [pay, setPay] = useState<Pay>(PAYSIZ);
  const [ipucuKapali, setIpucuKapali] = useState(false);
  const [sonucKapali, setSonucKapali] = useState(false);
  const [olaylarAcik, setOlaylarAcik] = useState(false);
  /** Ekonomi penceresi (Kurucu'nun Ayrıntılar'ı, salt okunur) açık mı. */
  const [ekonomiAcik, setEkonomiAcik] = useState(false);
  const { registry } = useRegistry();
  const [sekme, setSekme] = useState<SehirSekmesi>("sehir");
  /** Oyuncunun "Tamam" dediği batış bildirimleri. */
  const [batisKapatilan, setBatisKapatilan] = useState<ReadonlySet<string>>(() => new Set());
  const batisKapat = useCallback((a: string) => setBatisKapatilan((o) => new Set(o).add(a)), []);
  const [istenKapatilan, setIstenKapatilan] = useState<ReadonlySet<string>>(() => new Set());
  const istenKapat = useCallback((a: string) => setIstenKapatilan((o) => new Set(o).add(a)), []);
  const karar = useDaoKarar(runId, gozlem?.hafta ?? 0, state?.status === "failed" || state?.status === "ended");

  // Oyuncu başka şehre taşınınca ekran onu izler (hash'te şehir varsa güncellenir); seçim temizlenir.
  const oncekiBen = useRef<number | null>(null);
  useEffect(() => {
    if (benSehir === undefined) return;
    const once = oncekiBen.current;
    oncekiBen.current = benSehir;
    if (once === null || once === benSehir) return;
    setSecim(null);
    if (route.name === "dao" && route.sehir !== undefined && benSehir >= 0 && benSehir < SEHIR_SAYISI) replace({ name: "dao", runId, sehir: benSehir as SehirNo });
  }, [benSehir, replace, route, runId]);

  const harita0 = state?.harita0;
  // `harita0` hafta 0 haritasidir: yenilemeden sonra (hafta N>0, paket yok) guncel diye gosterilmez (B10 Y-yeni-1).
  const hafta0da = (state?.week ?? 0) === 0;
  const harita = useMemo(() => sonHarita(weeks) ?? (hafta0da ? (harita0 ?? (weeks.length === 0 ? { hafta: 0, firmalar: [] } : null)) : null), [weeks, harita0, hafta0da]);
  const onceki = useMemo(() => oncekiPaket(weeks, cur), [weeks, cur]);
  const ben = useMemo(() => daoHaritaBeni(gozlem), [gozlem]);
  const hazir = state !== null;
  // İş ararken ilan veren işletmeler (kendi şehrinde) haritada parlar.
  const ilanVeren = useMemo(
    () => (gozlem !== null && gozlem.ben.durum === "is_arayan" && gozlem.ben.sehir === sehirNo ? new Set(gozlem.ilanlar.map((i) => i.firma)) : undefined),
    [gozlem, sehirNo],
  );
  // Kalıcı yerleşim (K9): işletmeler koşu boyunca yerinde kalır; oyuncunun işletmesi kurarken seçtiği parselde (K8). Klasik ve izo ayrı tablolardır.
  const kurucuFirma = gozlem?.ben.durum === "kurucu" ? gozlem.ben.is.firma : null;
  const oyuncuParsel = useOyuncuParseli(runId, gozlem?.firmam?.ad ?? kurucuFirma);
  const yerKlasik = useKaliciYerlesim(runId, "klasik", sehirNo);
  const yerIzo = useKaliciYerlesim(runId, "izo", sehirNo);
  // Harita yokken (yenileme: hafta N>0, paket henuz yok) sahne KURULMAZ: bos firma listesiyle kurulursa kalici yerlesim tablosu (K9) silinir ve bos tablo yazilir (B10 Y-r2-1).
  const sahne = useMemo(
    () => (hazir && harita !== null ? sehirSahnesi(cur, harita, { runId, sehirAdlari, sehir: sehirNo, katman, oncekiPaket: onceki, ben, parselSecilebilir: true, yerlesim: yerKlasik.onceki(), sabitlemeler: oyuncuParsel.sabitlemeler.klasik, ...(ilanVeren ? { ilanVeren } : {}) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hazir, cur, harita, runId, sehirAdlari, sehirNo, katman, onceki, ben, ilanVeren, yerKlasik.anahtar, oyuncuParsel.sabitlemeler.klasik],
  );
  // Görünüm modu tek yerde çözülür; etkin sahne (klasik ya da izometrik) burada kurulur, `SehirTuvaliKap` manifest ya da görsel boy almaz.
  const gorunum = useGorunumModu();
  // Geçiş/boy hesabı yalnız izo çiziminde kullanılır: klasikte harita verilmez (hesap yapılmaz).
  const gecis = useHaritaGecisleri(gorunum.mod === "izo" ? harita : null, olaylar, runId);
  const durumlar = useGorselDurumlari(harita, gecis);
  const izoKaynak = useMemo(
    () => (hazir && harita !== null && gorunum.mod === "izo" ? sehirSahnesi(cur, harita, { runId, sehirAdlari, sehir: sehirNo, katman, oncekiPaket: onceki, ben, parselSecilebilir: true, izo: true, yerlesim: yerIzo.onceki(), sabitlemeler: oyuncuParsel.sabitlemeler.izo, ...(ilanVeren ? { ilanVeren } : {}) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hazir, gorunum.mod, cur, harita, runId, sehirAdlari, sehirNo, katman, onceki, ben, ilanVeren, yerIzo.anahtar, oyuncuParsel.sabitlemeler.izo],
  );
  const klasikTablo = sahne?.yerlesim;
  const izoTablo = izoKaynak?.yerlesim;
  const kaydetKlasik = yerKlasik.kaydet;
  const kaydetIzo = yerIzo.kaydet;
  useEffect(() => kaydetKlasik(klasikTablo), [kaydetKlasik, klasikTablo]);
  useEffect(() => kaydetIzo(izoTablo), [kaydetIzo, izoTablo]);
  const balonlar = useBalonlar(gecis.gecisler, olaylar, gozlem, izoKaynak);
  const etkin = useEtkinSahne({ mod: gorunum.mod, manifest: gorunum.manifest, klasik: sahne, izoKaynak, tohum: runId, gorselBoy: gecis.gorselBoy, spriteHatasiBildir: gorunum.spriteHatasiBildir, ...(durumlar ? { durumlar } : {}), gecisler: gecis.gecisler, balonlar });
  // Mod değişince eski yerleşimin parsel kimliği geçersiz olabilir: parsel seçimi temizlenir.
  const oncekiIzo = useRef(etkin.izoMu);
  useEffect(() => {
    if (oncekiIzo.current === etkin.izoMu) return;
    oncekiIzo.current = etkin.izoMu;
    setSecim((s) => (s?.ref.kind === "parsel" ? null : s));
  }, [etkin.izoMu]);
  // Hafta 0'da da kamera zorlanmaz: tuval ilk haritada şehri (ahır dahil) görünür alana bir kez sığdırır; sonrasında kamerayı oyuncu yönetir.
  const curHafta = cur?.week ?? 0;
  /** Ben panelindeki "İş ilanlarına bak": kendi şehrinin paneli ilanlar sekmesiyle açılır (oyuncu bastığında; kendiliğinden değil). */
  const ilanlaraBak = (): void => {
    if (benSehir === undefined) return;
    if (sehirNo !== benSehir) replace({ name: "dao", runId, sehir: benSehir as SehirNo });
    setSekme("ilanlar");
    setSecim({ ref: { kind: "city", ref: String(benSehir) }, hafta: curHafta, sehir: benSehir });
  };
  const sahneSec = useCallback((r: HaritaRef | null) => setSecim(r !== null ? { ref: r, hafta: curHafta, sehir: sehirNo } : null), [curHafta, sehirNo]);
  const komutVer = useCallback((tur: KameraKomutu["tur"], hedef?: OdakHedefi) => setKomut((k) => ({ n: (k?.n ?? 0) + 1, tur, ...(hedef ? { hedef } : {}) })), []);

  const yeni = (
    <Button variant="primary" onClick={() => go({ name: "dao" })}>
      {t("dao.yeni_oyun")}
    </Button>
  );
  if (run.error === "hata.kosu_bulunamadi") {
    return (
      <Merkez>
        <Stack gap="12" align="start">
          <Banner tone="neutral">{t("dao.kosu_yok")}</Banner>
          {yeni}
        </Stack>
      </Merkez>
    );
  }
  if (hata === "dao_degil") {
    return (
      <Merkez>
        <Stack gap="12" align="start">
          <Banner tone="neutral">{t("dao.dao_degil")}</Banner>
          {yeni}
        </Stack>
      </Merkez>
    );
  }
  if (state === null) return <Merkez>{run.error !== null ? <Banner tone="crisis">{t(run.error)}</Banner> : <Yukleniyor />}</Merkez>;
  if (state.status === "ended" && gozlem === null) return <Merkez>{hata !== null ? <Banner tone="crisis">{gozlemHataMetni}</Banner> : <Yukleniyor />}</Merkez>;

  const bitti = state.status === "ended";
  /** Koşu hafta 0'da duruyor: sunucunun ilk gözlemi için "1 hafta"ya basmak gerekir; "hazırlanıyor" yalnız gerçekten hazırlanırken. Oyuncu ahırda başlar. */
  const ilkHafta = state.week === 0 && state.status !== "running" && !state.computing && state.preparing === undefined;
  const ahirda = gozlem !== null ? gozlem.ben.durum === "ahir" : ilkHafta;
  const sehirSayisi = Math.max(SEHIR_SAYISI, sehirAdlari.length);
  const sehirler: SehirOzeti[] = Array.from({ length: sehirSayisi }, (_, i) => ({ id: i, ad: ad.sehir(i), ...(i === benSehir ? { ozet: t("dao.sehir.sen") } : {}) }));
  const sehirSec = (id: number): void => {
    setSecim(null);
    replace({ name: "dao", runId, sehir: id as SehirNo });
  };
  const secimGecerli = secim !== null && secim.sehir === sehirNo ? secim : null;
  const secilenParselTuru = secimGecerli?.ref.kind === "parsel" && etkin.sahne !== null ? parselTuruOf(etkin.sahne, secimGecerli.ref.ref) : "bos";
  /** "İşletmeni göster": kamera oyuncunun işletmesine (kimlikle) odaklanır; yalnız kendi şehrinde ve işletme sahnede varken. */
  const isletmeyiGoster = kurucuFirma !== null && benSehir === sehirNo && etkin.kaynak?.binalar.some((b) => b.id === kurucuFirma) ? () => komutVer("odak", { bina: kurucuFirma }) : undefined;
  const sagPanel =
    secimGecerli !== null && etkin.kaynak !== null
      ? {
          baslik: daoBaglamBasligi(secimGecerli, etkin.kaynak, adlar, secilenParselTuru),
          icerik: (
            <DaoBaglam
              runId={runId} secim={secimGecerli} sahne={etkin.kaynak} adlar={adlar} g={gozlem} ad={ad} cur={cur} sehir={sehirNo} sehirAdlari={sehirAdlari}
              sektorAdi={ad.sektor} karar={karar} ilkHafta={ilkHafta} sekme={sekme} onSekme={setSekme}
              parselTuru={secilenParselTuru} onKur={(parsel, sektor) => oyuncuParsel.kurIstendi(parsel, etkin.izoMu ? "izo" : "klasik", sektor)} {...(isletmeyiGoster ? { onIsletmeyiGoster: isletmeyiGoster } : {})}
            />
          ),
          onKapat: () => setSecim(null),
        }
      : null;
  const benIcerigi =
    gozlem !== null ? (
      <>
        {ilkHafta ? <p className={styles.kucuk} role="status">{t("dao.ilk_hafta_ipucu")}</p> : null}
        <DaoBen g={gozlem} ad={ad} onIlanlaraBak={ilanlaraBak} {...(isletmeyiGoster ? { onIsletmeyiGoster: isletmeyiGoster } : {})} />
      </>
    ) : (
      <p className={styles.kucuk} role="status">
        {hata !== null && !hazirlaniyor ? gozlemHataMetni : ilkHafta ? t("dao.ilk_hafta_ipucu") : hazirlaniyor ? t("dao.hazirlaniyor") : t("durum.yukleniyor")}
      </p>
    );
  const sonucPenceresi = bitti && gozlem !== null && !sonucKapali;
  const { prev } = lastTwo(weeks);
  /** Ekonomi: Kurucu'nun Ayrıntılar penceresi, salt okunur (kontrol yok). Sonuç ya da olay penceresi açılınca kapanır (iki modal üst üste durmaz). */
  const ekonomi = (
    <Ayrintilar
      salt kosuAnahtari={runId} state={state} cur={cur} prev={prev} weeks={weeks} tumHaftalar={run.weeks} events={run.events} tumOlaylar={run.events}
      markers={markers} total={state.durationWeeks} sehir={sehirNo} sehirAdlari={sehirAdlari} isLive={source.kind === "live"}
      sehirAcik={capabilities.city} zincirAcik={capabilities.chain} dunya={info?.world} sektorAdi={ad.sektor} registry={registry}
      baski={sonucPenceresi || olaylarAcik} onAcik={setEkonomiAcik}
    />
  );
  const olayOgeleri = daoOlayOgeleri([...olaylar, ...(gozlem?.olaylar ?? [])], ad, gozlem?.gecmis.firmalar);

  return (
    <OyunEkrani
      sehirler={sehirler} sehir={sehirNo} onSehir={sehirSec} onPay={setPay} tuvalKilitli={sonucPenceresi || olaylarAcik || ekonomiAcik} binaVerisiYok={!haritaAcik(capabilities)}
      tuval={
        sahne === null || etkin.sahne === null ? (
          <p className={kabuk.bekle}>{t("canli.dunya.bekleniyor")}</p>
        ) : (
          <SehirTuvaliKap kabuk sahne={etkin.sahne} tabloSahnesi={sahne} onSpriteHatasi={gorunum.spriteHatasiBildir} yukleniyor={gorunum.mod === "bekle"} dustu={gorunum.dustu} secili={secimGecerli?.ref ?? null} onSec={sahneSec} kamera={kamera} onKamera={setKamera} {...(komut ? { komut } : {})} adlar={adlar} pay={pay} />
        )
      }
      ustSol={<DaoUst g={gozlem} />}
      ustOrta={
        <div className={kabuk.ustOrta}>
          <DaoKontrol runId={runId} state={state} />
          <div className={kabuk.bantlar}>
            {run.error !== null ? <Banner tone="warn">{t(run.error)}</Banner> : null}
            {state.status === "failed" ? <Banner tone="crisis">{t(state.error?.messageKey ?? "durum.hata")}</Banner> : null}
            <DaoBatisBildirimi olaylar={gozlem?.olaylar ?? []} gecmis={gozlem?.gecmis.firmalar} ad={ad} kapatilan={batisKapatilan} onKapat={batisKapat} />
            <DaoIstenCikarmaBildirimi olaylar={gozlem?.olaylar ?? []} ad={ad} kapatilan={istenKapatilan} onKapat={istenKapat} />
            {karar.kabul !== null ? <Banner tone="neutral">{karar.kabul.metin}</Banner> : null}
          </div>
        </div>
      }
      menu={
        <KurucuMenu
          state={state} ayrintilar={ekonomi} {...(tercih ? { tercih } : {})} onKosular={() => go({ name: "kosular" })}
          ekler={(kapat) => (
            <>
              {bitti && gozlem !== null ? (
                <Button variant="secondary" size="sm" onClick={() => { kapat(); setSonucKapali(false); }}>
                  {t("dao.menu.sonuc")}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => { kapat(); go({ name: "dao" }); }}>
                {t("dao.yeni_oyun")}
              </Button>
            </>
          )}
        />
      }
      solPanel={{ baslik: t("dao.panel.ben"), icerik: benIcerigi }}
      sagPanel={sagPanel}
      olaylar={olayOgeleri}
      olayKapisi={{ ad: t("dao.olaylar.tumu"), onAc: () => setOlaylarAcik(true) }}
      haritaKontrolleri={
        <HaritaAltSag lejant={etkin.kaynak ? <KatmanLejanti veri={etkin.kaynak.katman} /> : null}>
          <HaritaKontrolleri onYaklas={() => komutVer("yakin")} onUzaklas={() => komutVer("uzak")} onSigdir={() => komutVer("sigdir")} ekler={<KatmanSecici katman={katman} onKatman={setKatman} />} />
        </HaritaAltSag>
      }
      ipucu={ahirda && !ipucuKapali ? <div className={kabuk.ipucu}><Ipucu metin={t("dao.ipucu.ahir")} onTamam={() => setIpucuKapali(true)} /></div> : null}
      pencere={
        <>
          {sonucPenceresi && gozlem !== null ? <DaoSonuc g={gozlem} state={state} ad={ad} onKapat={() => setSonucKapali(true)} /> : null}
          {olaylarAcik ? (
            <Diyalog baslik={t("dao.olaylar.baslik")} onKapat={() => setOlaylarAcik(false)} yuzen>
              <DaoOlayListesi olaylar={[...olaylar, ...(gozlem?.olaylar ?? [])]} ad={ad} gecmis={gozlem?.gecmis.firmalar} />
            </Diyalog>
          ) : null}
        </>
      }
    />
  );
}
