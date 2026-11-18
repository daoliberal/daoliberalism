"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Stack } from "@/components/primitives/Stack";
import { Logo } from "@/components/shell/Logo";
import { useIsNarrow } from "@/components/shell/useIsNarrow";
import { t } from "@/oyun/copy/t";
import { kanonikHash, girisRotasi, parseHash, sehirRotasi, useHashRoute } from "@/oyun/hooks/useHashRoute";
import { useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { Baslangic, BaslangicBaslik } from "@/oyun/screens/baslangic/Baslangic";
import { Canli } from "@/oyun/screens/canli/Canli";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { Kosular } from "@/oyun/screens/kosular/Kosular";
import { otomatikKayitli } from "@/oyun/screens/kosular/otomatikKayit";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { StilOnizleme } from "@/oyun/screens/stil/StilOnizleme";
import { Sonuc } from "@/oyun/screens/sonuc/Sonuc";
import { UstCubuk, type Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { sonKosuYaz } from "@/oyun/sim/kosuBaglami";
import { createLiveSource, probeLive } from "@/oyun/sim/live";
import { createReplaySource } from "@/oyun/sim/replay";
import { HizBilgisiProvider } from "@/oyun/sim/hizBilgisi";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { SimSource } from "@/oyun/sim/types";
import { GirisKabi } from "@/oyun/ekran/GirisKabi";
import { Button } from "@/components/primitives/Button";
import { Banner } from "@/oyun/ui/Banner";
import { BantEylemleri } from "@/oyun/ui/BantEylemleri";
import { Yukleniyor } from "@/oyun/ui/Durum";
import { MotorEkrani, YuklemeEkrani, YuklemeHatasiEkrani } from "@/oyun/ui/YuklemeEkrani";
import { rotaPaketKarari } from "@/oyun/tarayici/rotaPaket";
import { YeniSurumBandi } from "@/oyun/ui/YeniSurumBandi";
import { CihazUyarisi } from "@/oyun/ui/CihazUyarisi";
import { SafariSeridi } from "@/oyun/ui/SafariSeridi";
import { DurumRozeti } from "@/oyun/ui/DurumRozeti";
import { KayitPaneli } from "@/oyun/ui/KayitPaneli";
import { KayitBaglamiSaglayici } from "@/oyun/ui/KayitBaglami";
import { BildirimYuvaSaglayici } from "@/oyun/ui/BildirimYuvasi";
import { dosyaIndir } from "@/oyun/ui/indir";
import { dokunmatikDarMi, gercekCihazOrtami, webkitMi } from "@/oyun/ui/cihaz";
import type { KayitHizmetleri } from "@/oyun/tarayici/hizmetler";
import type { KonteynerYuzu, SwKaydi, YeniSurumDurumu } from "@/oyun/tarayici/swKayit";
import type { AcilisDurumu } from "@/oyun/tarayici/kaynak";
import type { Uyari } from "@/oyun/tarayici/kopru";
import durum from "@/oyun/ui/durum.module.css";
import sayfa from "@/oyun/OyunApp.module.css";

type KalicilikUyarisi = Extract<Uyari, { tur: "kayit_acilamadi" | "kayit_yazilamadi" }>;
type AcilisUyarisi = Extract<Uyari, { tur: "acilis_suruyor" }>;

/** Kaynak kurulduktan sonra rotayı ekrana ve koşuya bağlar. */
function Ekranlar({ tercih }: { tercih: Tercih }) {
  const { route } = useHashRoute();
  // Eski görünüm rotaları yeni yerlerine yönlenir: `/sehir-<n>` -> `/<n>`, `/dunya` ve `/harita` -> şehir ekranı (geçmişe yeni kayıt eklenmez).
  const { replace } = useHashRoute();
  useEffect(() => {
    const yeni = kanonikHash(window.location.hash);
    if (yeni !== null) replace(parseHash(yeni));
  }, [route, replace]);
  const { status, adopt, handle } = useRestoreRun(route.name === "canli" || route.name === "sonuc" ? route.runId : null);
  // Koşular ekranının "Kaydet" ve "Karşılaştır" eylemleri için son bakılan koşu (açılmış koşunun gerçek kimliği).
  const sonId = status === "ready" ? (handle?.runId ?? null) : null;
  useEffect(() => {
    if (sonId !== null) sonKosuYaz(sonId);
  }, [sonId]);
  // Giriş ekranları (Başlangıç, Kurucu kurulumu, DAO girişi) tam ekran giriş kabuğunda çizilir; kabuk kendi çubuğunu ve `main`ini taşır.
  if (girisRotasi(route)) {
    return route.name === "baslangic" ? <Baslangic /> : route.name === "kurucu" ? <Kurucu adopt={adopt} /> : route.name === "dao" ? <DaoEkrani route={route} tercih={tercih} /> : null;
  }
  return (
    <>
      {/* Şehir ekranları (Kurucu canli, DAO koşusu) kendi üst şeridini ve menüsünü taşır; üst çubuk yalnız Sonuç, Koşular ve paylaşılan DAO dünyasında. */}
      {sehirRotasi(route) ? null : <UstCubuk route={route} tercih={tercih} kosuHazir={route.name !== "sonuc" || status === "ready"} />}
      <main aria-label={t("app.ana")}>
        {route.name === "canli" ? (
          <Canli runId={route.runId} restore={{ status }} tercih={tercih} />
        ) : route.name === "sonuc" ? (
          <Sonuc runId={route.runId} restore={{ status }} />
        ) : route.name === "dao" ? (
          <DaoEkrani route={route} tercih={tercih} />
        ) : (
          <Kosular />
        )}
      </main>
    </>
  );
}

type Loc = { hostname: string; port: string; origin: string; search: string; hash: string };
export type Chosen = {
  source: SimSource | null;
  missing?: boolean;
  secPerWeekP50?: number | null;
  kapat?: () => Promise<void>;
  /** B7: yeni surum uygulamasindan once kayit tamamlama (tarayici kaynagi). `false` = uygulama yapilmamali. */
  kayitTamamla?: () => Promise<boolean>;
  surdur?: () => void;
  kosuUyumsuz?: (kosuId: string) => Promise<boolean>;
  /** B7: oturum onceki model paketiyle acildi; yeni oyun (Kurucu/DAO) oncesi sayfa guncel paketle yeniden yuklenir. */
  eskiPaket?: boolean;
  /** B8: kayit hizmetleri (depolama, kayitli oyunlar, disa/ice aktarma, silme); yalniz tarayici kaynaginda. */
  hizmetler?: KayitHizmetleri;
};

/** `NEXT_PUBLIC_OYUN_KAYNAK=tarayici`: model oyuncunun tarayicisinda (Worker + Pyodide) kosar. Derleme zamani sabitidir ve BU modulde yerel tanimlidir (modul disi `export const` degeri derleyicide katlanmaz): bayraksiz derlemede `TARAYICI &&` dallari (panel, cihaz uyarisi, tarayici kaynagi) budanir. */
const TARAYICI = process.env.NEXT_PUBLIC_OYUN_KAYNAK === "tarayici";

/**
 * Tarayici modulleri (Worker + yukleyici + kopru): YALNIZ bayrakli derlemede ice aktarilir. Bayrak derleme zamani sabiti oldugu icin bu kosul
 * bayraksiz derlemede budanir: ilgili parcalar (Worker dahil) cikti dizinine hic yazilmaz.
 */
async function tarayiciModulleri(): Promise<[typeof import("@/oyun/tarayici/kaynak"), typeof import("@/oyun/tarayici/isciUret")]> {
  if (process.env.NEXT_PUBLIC_OYUN_KAYNAK === "tarayici") return Promise.all([import("@/oyun/tarayici/kaynak"), import("@/oyun/tarayici/isciUret")]);
  throw new Error("tarayici_kapali");
}

/** Service Worker modulu: tarayici modulleri gibi YALNIZ bayrakli derlemede ice aktarilir (bayraksiz derlemede budanir, SW kodu cikti dizinine girmez). */
async function swModulu(): Promise<typeof import("@/oyun/tarayici/swKayit")> {
  if (process.env.NEXT_PUBLIC_OYUN_KAYNAK === "tarayici") return import("@/oyun/tarayici/swKayit");
  throw new Error("tarayici_kapali");
}

/** B7: sayfa yenilemeden once kayit KESIN tamamlanir (askidaki gunluk/hafta yazimlari); tamamlanamazsa yenilenmez, oyun surer. */
let yenileme: Promise<boolean> | null = null;
/** B8: surum nedeniyle yenileme beklenirken (kayit tamamlanana ve sayfa yenilenene dek) notr "dogru surum yukleniyor" ekrani gosterilir; form girisi ya da oyun o sirada acik kalmaz. */
type YenilemeNedeni = "surum" | "acma";
let yenilemeBekliyor: YenilemeNedeni | null = null;
const yenilemeDinleyicileri = new Set<() => void>();
function yenilemeYaz(b: YenilemeNedeni | null): void {
  if (yenilemeBekliyor === b) return;
  yenilemeBekliyor = b;
  for (const d of [...yenilemeDinleyicileri]) d();
}
const yenilemeAbone = (d: () => void): (() => void) => {
  yenilemeDinleyicileri.add(d);
  return () => {
    yenilemeDinleyicileri.delete(d);
  };
};
/** TEKILLESTIRILMIS: ayni anda tek yenileme (rota effect'i ile 409 yolu birlikte tetiklese de kayitTamamla/surdur/reload bir kez calisir). `bekle`: notr ekran gosterilir. `oncesi`: yalniz kayit TAMAMLANIRSA, yenilemeden hemen once (ör. hash yazimi). Doner: yenileme baslatildi mi. */
function guvenliYenile(k: Pick<Chosen, "kayitTamamla" | "surdur"> | null, bekle: YenilemeNedeni | false = "surum", oncesi?: () => void): Promise<boolean> {
  if (yenileme) return yenileme;
  if (bekle) yenilemeYaz(bekle);
  yenileme = (async () => {
    let yenilendi = false;
    try {
      const tamam = k?.kayitTamamla ? await k.kayitTamamla().catch(() => false) : true;
      if (tamam) {
        yenilendi = true;
        oncesi?.();
        window.location.reload();
        // Ö9: tarayici "sayfadan ayril" onayi reddedilirse (Kal) yenileme olmaz; notr ekran kalici kalmasin.
        setTimeout(() => yenilemeYaz(null), YENILEME_VAZGECME_MS);
      } else k?.surdur?.();
      return yenilendi;
    } finally {
      yenileme = null;
      if (!yenilendi) yenilemeYaz(null);
    }
  })();
  return yenileme;
}
/** Yenileme bu surede gerceklesmezse (kullanici ayrilmayi reddetti) notr ekran kapanir. */
const YENILEME_VAZGECME_MS = 5000;

/** Tarayici kaynaginin acilisinda arayuzle konusma (ilerleme/secim) ve rota yazimi. */
export type TarayiciArayuzu = {
  durum: (d: AcilisDurumu) => void;
  /** Baska sekme devraldi. */
  baskaSekme?: () => void;
  /** Worker dustu / yanit vermiyor. */
  dustu?: (e: unknown) => void;
  uyari?: (u: Uyari) => void;
  /** Koşular/#/sonuc/#/dao yolundan acma icin kayit tamamlanamadi: "oyun acilamadi" bandi. */
  acmaHatasi?: () => void;
  /** 52 haftada bir "kaydi disa aktar" hatirlatmasi. */
  hatirlatma?: (o: { kosuId: string; hafta: number }) => void;
};

/** Depolama kotasi yoklama araligi (ms). */
const KOTA_YOKLAMA_MS = 600_000;

const abonesiz = (): (() => void) => () => undefined;

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
/** Python sunucusunun kendi portu: sayfa oradan sunuluyorsa aynı köken yoklanır. */
const LIVE_PORT = "8765";
/** Sahibin yerel model sunucusu (yalnız 127.0.0.1). */
const LIVE_ORIGIN = `http://127.0.0.1:${LIVE_PORT}`;
/** `canli.sh --dev` ile izinli geliştirme portları; derleme zamanı `NEXT_PUBLIC_OYUN_CANLI_PORTLARI` (virgüllü) ile değişir. */
const DEV_PORTS = (process.env.NEXT_PUBLIC_OYUN_CANLI_PORTLARI ?? "3000").split(",").map((x) => x.trim()).filter(Boolean);
/** Canlı koşu kimlikleri bu önekle başlar; kayıt tarifleri başlamaz (M2). */
const LIVE_PREFIX = "canli-";

const replaySource = (): SimSource => createReplaySource({ baseUrl: "/oyun-kayit/" });

/**
 * B8 (K1): tarayici kipinde kayit/onizleme kaynagi YOKTUR. `?kaynak=kayit` ve `canli-` ile baslamayan kimlikli rotalar (`#/canli/<kimlik>`, `#/sonuc/<kimlik>`)
 * kayit baglantisidir: `kayit: true` ve Baslangic'a temizlenmis konum doner (arayuz bilgi gosterir). Diger her konum aynen doner.
 */
export function kayitBaglantisiniAyikla(loc: Loc): { kayit: boolean; loc: Loc } {
  const forced = new URLSearchParams(loc.search).get("kaynak");
  const m = /^#\/(?:canli|sonuc)\/([^/]+)/.exec(loc.hash);
  const kimlikKayit = m !== null && !(m[1] ?? "").startsWith(LIVE_PREFIX);
  if (forced !== "kayit" && !kimlikKayit) return { kayit: false, loc };
  return { kayit: true, loc: { ...loc, search: forced === "kayit" ? "" : loc.search, hash: "#/" } };
}

/**
 * Yoklanacak tek hedef (aynı köken `""` ya da `127.0.0.1:8765`); hedef yoksa `null` (sıfır istek). Sayfa Python sunucusundan
 * sunuluyorsa (8765 ya da `canli.sh --port N` ile başka kapı + `?kaynak=canli`) aynı köken; dev portundan `127.0.0.1:8765`.
 */
function target(loc: Loc, forced: string | null): string | null {
  if (!LOCAL_HOSTS.includes(loc.hostname)) return null;
  if (loc.port === LIVE_PORT) return "";
  if (DEV_PORTS.includes(loc.port)) return LIVE_ORIGIN;
  return forced === "canli" ? "" : null;
}

/**
 * Kaynak seçimi. En çok bir istek: yalnız yerel konakta; sayfa 8765'teyse (ya da başka kapıda `?kaynak=canli` ile) aynı köken,
 * dev portundaysa `127.0.0.1:8765`; başka her port ve uzak konak sıfır istek, kayıt kaynağı. `?kaynak=kayit` yoklamadan kayıt kaynağını zorlar;
 * `canli` zorlanıp sunucu yoksa `missing` döner. Hash'teki koşu kimliği `canli-` ile başlamıyorsa kayıt kaynağı kullanılır.
 * `alive` false ise (bileşen kalktı) hiçbir kaynak kurulmaz.
 */
export async function chooseSource(loc: Loc, alive: () => boolean = () => true, tarayici?: TarayiciArayuzu): Promise<Chosen> {
  const forced = new URLSearchParams(loc.search).get("kaynak");
  // B8 (K1): tarayici kipinde kayit/onizleme kaynagi yoktur; kayit baglantilari `OyunApp` tarafindan `kayitBaglantisiniAyikla` ile Baslangic'a yonlendirilir.
  if (TARAYICI && tarayici !== undefined) return chooseTarayici(loc, alive, tarayici);
  if (forced === "kayit") return { source: replaySource() };
  const none = (): Chosen => (forced === "canli" ? { source: null, missing: true } : { source: replaySource() });
  const base = target(loc, forced);
  if (base === null) return none();
  const r = await probeLive(base);
  if (!alive()) return { source: null };
  if (!r.ok) return none();

  const hashId = loc.hash.startsWith("#/canli/") ? loc.hash.slice("#/canli/".length) : "";
  if (forced !== "canli" && hashId !== "" && !hashId.startsWith(LIVE_PREFIX)) return { source: replaySource() };
  return { source: createLiveSource({ baseUrl: base }), secPerWeekP50: r.hello.secPerWeekP50 };
}

/**
 * Tarayici kaynagi: Worker + Pyodide yuklenir, kayit katmani acilir, varsa kayittan devam edilir. `LiveSource` ayni kalir; HTTP/SSE koprusu enjekte edilir.
 * Yukleme hatasi `YuklemeHatasi` olarak firlar (arayuz `YuklemeHatasiEkrani` gosterir).
 */
async function chooseTarayici(loc: Loc, alive: () => boolean, arayuz: TarayiciArayuzu): Promise<Chosen> {
  const [{ tarayiciKaynagiKur }, { gercekWorkerUret }] = await tarayiciModulleri();
  let kaynak: Pick<Chosen, "kayitTamamla" | "surdur" | "hizmetler"> | null = null;
  const k = await tarayiciKaynagiKur({
    workerUret: gercekWorkerUret,
    origin: loc.origin,
    idb: indexedDB,
    storage: typeof navigator !== "undefined" ? navigator.storage : null,
    hash: loc.hash,
    fetch: (girdi) => fetch(girdi),
    hashYaz: (h) => {
      window.location.hash = h;
    },
    durum: arayuz.durum,
    iptalEdildi: () => !alive(),
    hata: (kaynak, e) => console.warn("oyun-tarayici", kaynak, e),
    dustu: (e) => {
      console.warn("oyun-tarayici dustu", e);
      arayuz.dustu?.(e);
    },
    uyari: arayuz.uyari,
    hatirlatma: arayuz.hatirlatma,
    yenile: () => window.location.reload(),
    baskaSekme: arayuz.baskaSekme,
    // Yalniz yeni oyun (POST /api/runs 409) yolu: Kurucu'da acilir.
    yeniOyunIcinYenile: () => {
      window.location.hash = "#/kurucu";
      void guvenliYenile(kaynak);
    },
    // R3-1: kayitli kosu bu paketle acilamaz: hash KORUNUR (kaynak gerekirse kosunun rotasini yazar), kayit tamamlanip ayni rota ile yeniden yuklenir.
    kayitIcinYenile: () => {
      void guvenliYenile(kaynak);
    },
    // K1: Koşular/#/sonuc/#/dao yolundan acilan kayit secim ekrani gerektiriyor: hash o kosunun rotasina (DAO ise #/dao) yazilir, kayit tamamlanip sayfa yeniden yuklenir.
    // Doner: yenileme baslatildi mi (kayit tamamlanamazsa `false`: koprü tekrar denemeye izin verir, oyuncuya bant gosterilir).
    kayitSecimiIcin: async (kosuId) => {
      const kosu = await kaynak?.hizmetler?.kosular().then((l) => l.find((x) => x.kosuId === kosuId)).catch(() => undefined);
      const basladi = await guvenliYenile(kaynak, "acma", () => {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${kosu?.tur === "dao" ? "#/dao/" : "#/canli/"}${kosuId}`);
      });
      if (!basladi) arayuz.acmaHatasi?.();
      return basladi;
    },
  });
  kaynak = k;
  if (!alive()) {
    await k.kapat();
    return { source: null };
  }
  // `/hello` ilk tick'in arkasinda bekleyebilir (hafta adimi 3-6 sn): zaman asimi uzun.
  const r = await probeLive("", { fetchImpl: k.kopru.fetch, timeoutMs: 60_000 });
  const source = createLiveSource({ baseUrl: "", fetchImpl: k.kopru.fetch, eventSourceImpl: k.kopru.eventSource });
  return { source, secPerWeekP50: r.ok ? r.hello.secPerWeekP50 : null, kapat: k.kapat, kayitTamamla: k.kayitTamamla, surdur: k.surdur, kosuUyumsuz: k.kosuUyumsuz, eskiPaket: k.eskiPaket, hizmetler: k.hizmetler };
}

/** Canlı zorlanıp sunucu yokken: Türkçe hata ve kayıt kaynağına bağlantı. */
function SunucuYok() {
  return (
    <Stack gap="10" align="start">
      <Banner tone="crisis">{t("canli.sunucu_yok")}</Banner>
      <p>{t("kaynak.canli_degil_bilgi")}</p>
      <a href="?kaynak=kayit">{t("kaynak.kayitla_ac")}</a>
    </Stack>
  );
}

/** Çıplak çerçevede oyun kökü. Kaynak effect içinde (yoklamadan sonra) kurulur; iptal edilen effect kaynak kurmaz. */
export function OyunApp() {
  useIsNarrow();
  const tercih = useOyunTercihleri(); // useIsNarrow'dan sonra: eşik geçişinde tercih yeniden uygulanır
  const { route } = useHashRoute();
  const tamEkran = sehirRotasi(route);
  const giris = girisRotasi(route);
  const [yuva, setYuva] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<SimSource | null>(null);
  const [missing, setMissing] = useState(false);
  const [hiz, setHiz] = useState<number | null>(null);
  // Tarayici kaynagi (derleme bayragi): yukleme asamasi/secim ve yukleme hatasi. Bayraksiz derlemede hep bos kalir.
  const [acilis, setAcilis] = useState<AcilisDurumu | null>(null);
  const [yuklemeHatasi, setYuklemeHatasi] = useState<string | null>(null);
  const [deneme, setDeneme] = useState(0);
  // Motor bu sekmede durdu: baska sekme devraldi ya da Worker dustu; kalicilik uyarisi (bant).
  const [motor, setMotor] = useState<"devredildi" | "motor_durdu" | null>(null);
  const [uyari, setUyari] = useState<KalicilikUyarisi | null>(null);
  const [acilisUyari, setAcilisUyari] = useState<AcilisUyarisi | null>(null);
  // B8: kayit hizmetleri + panel, 52 hafta hatirlatmasi, durum gostergeleri, kayit baglantisi bilgisi, cihaz/Safari.
  const [hizmetler, setHizmetler] = useState<KayitHizmetleri | null>(null);
  const [panelAcik, setPanelAcik] = useState(false);
  const [hatirlatma, setHatirlatma] = useState<{ kosuId: string; hafta: number } | null>(null);
  const [hesaplaniyor, setHesaplaniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kayitKilitli, setKayitKilitli] = useState<string | null>(null);
  const [acmaHatasi, setAcmaHatasi] = useState(false);
  const [kayitBekliyor, setKayitBekliyor] = useState(false);
  const [kayitBilgisi, setKayitBilgisi] = useState(false);
  const [kotaYuzde, setKotaYuzde] = useState<number | null>(null);
  // Cihaz/tarayici turu yalniz istemcide okunur (sunucu ciktisi hep `false`: hidrasyon uyumlu).
  const cihaz = useSyncExternalStore(abonesiz, () => TARAYICI && dokunmatikDarMi(gercekCihazOrtami()), () => false);
  const webkit = useSyncExternalStore(abonesiz, () => TARAYICI && webkitMi(navigator.userAgent), () => false);
  const yenilemeNedeni = useSyncExternalStore(yenilemeAbone, () => yenilemeBekliyor, () => null);
  // B8: depolama kotasi esigi (0,85) asilirsa uyari bandi; acilista ve her 10 dakikada bir olculur (olculemezse sessiz).
  useEffect(() => {
    if (!TARAYICI || hizmetler === null) return;
    let canli = true;
    const olc = (): void => {
      void hizmetler.depolama().then(
        (d) => canli && setKotaYuzde(d.kotaUyarisi && d.olcum !== null ? Math.round(d.olcum.oran * 100) : null),
        () => undefined,
      );
    };
    olc();
    const aralik = setInterval(olc, KOTA_YOKLAMA_MS);
    return () => {
      canli = false;
      clearInterval(aralik);
    };
  }, [hizmetler]);
  // B7: yeni surum hazir bandi. SW yalniz oyun yuklendikten sonra kaydedilir; surum kullanici onayiyla uygulanir.
  const [surum, setSurum] = useState<YeniSurumDurumu>("yok");
  /** "Sonra": bu oturumda bant gizli (durum burada: bant yuva/sabit sutun arasinda yeniden kurulsa da korunur). */
  const [surumSonra, setSurumSonra] = useState(false);
  const swOnay = useRef<(() => void) | null>(null);
  const [eskiPaket, setEskiPaket] = useState(false);
  // B7: onceki model paketiyle acilmis oturumda yeni oyun yolu (Kurucu, DAO) acilinca sayfa guncel paketle yeniden yuklenir (yeni kayit eski modelle yazilmaz).
  const secilen = useRef<Chosen | null>(null);
  useEffect(() => {
    // Eski paketli oturumda: YENI oyun rotalari (runId'siz Kurucu/DAO) ve yuklu paketten FARKLI modelle yazilmis baska bir kosuya gecis sayfayi (kayit
    // tamamlandiktan sonra) yeniden yukler; yenilemeden sonra rotaPaketKarari o kosunun paketini secer. Ayni kosunun alt gorunumleri yenilemez.
    if (!eskiPaket) return;
    const karar = rotaPaketKarari(window.location.hash);
    const sec = secilen.current;
    if (karar.tur === "yeni_oyun") void guvenliYenile(sec);
    else if (karar.tur === "kosu" && sec?.kosuUyumsuz) void sec.kosuUyumsuz(karar.kosuId).then((u) => (u ? guvenliYenile(sec) : undefined));
  }, [eskiPaket, route]);
  useEffect(() => {
    let alive = true;
    let made: SimSource | null = null;
    let kapat: (() => Promise<void>) | undefined;
    let sw: SwKaydi | null = null;
    let abonelik: (() => void) | null = null;
    const swBagla = async (r: Chosen): Promise<void> => {
      const { swBaslat } = await swModulu();
      const k = await swBaslat({
        etkin: process.env.NODE_ENV === "production",
        konteyner: (typeof navigator !== "undefined" ? (navigator.serviceWorker as unknown as KonteynerYuzu | undefined) : undefined) ?? null,
        guvenliBaglam: window.isSecureContext,
        yol: window.location.pathname,
        yenidenYukle: () => window.location.reload(),
        hata: (e) => console.warn("oyun-sw", e),
      });
      if (k === null) return;
      if (!alive) {
        k.kapat();
        return;
      }
      sw = k;
      swOnay.current = () => void k.uygula(r.kayitTamamla ?? (async () => true), r.surdur ?? (() => undefined));
      abonelik = k.abone(setSurum);
    };
    // B8 (K1): kayit/onizleme baglantilari tarayici kipinde acilamaz: konum Baslangic'a temizlenir, bilgi gosterilir.
    const ayiklanan = TARAYICI ? kayitBaglantisiniAyikla(window.location) : null;
    if (ayiklanan?.kayit) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${ayiklanan.loc.search}${ayiklanan.loc.hash}`);
      window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState bildirimsizdir: rota kancasi yeni konumu okusun
    }
    const secim = chooseSource(ayiklanan?.loc ?? window.location, () => alive, TARAYICI
        ? {
            durum: (d) => alive && setAcilis(d),
            baskaSekme: () => alive && setMotor("devredildi"),
            dustu: () => alive && setMotor("motor_durdu"),
            hatirlatma: (o) => alive && setHatirlatma(o),
            acmaHatasi: () => alive && setAcmaHatasi(true),
            uyari: (u) => {
              if (!alive) return;
              // Kalicilik durumu (kayit_*) ile acilis ilerlemesi (acilis_*) AYRI yuvalarda: biri digerini silmez.
              if (u.tur === "hesaplaniyor") setHesaplaniyor(u.mesgul);
              else if (u.tur === "kaydediliyor") setKaydediliyor(u.mesgul);
              else if (u.tur === "kayit_kilitli") setKayitKilitli((o) => (u.kilitli ? u.kosuId : o === u.kosuId ? null : o));
              else if (u.tur === "kayit_bekliyor") setKayitBekliyor(u.bekliyor);
              else if (u.tur === "acilis_suruyor") setAcilisUyari(u);
              else if (u.tur === "acilis_bitti") setAcilisUyari(null);
              else if (u.tur === "kayit_duzeldi") setUyari((o) => (o !== null && o.kosuId === u.kosuId ? null : o));
              else setUyari(u);
            },
          }
        : undefined).then((r) => {
      if (!alive) {
        r.source?.dispose();
        void r.kapat?.();
        return;
      }
      made = r.source;
      kapat = r.kapat;
      setMissing(r.missing === true);
      setHiz(r.secPerWeekP50 ?? null);
      setEskiPaket(r.eskiPaket === true);
      setHizmetler(r.hizmetler ?? null);
      setKayitBilgisi(ayiklanan?.kayit === true);
      secilen.current = r;
      // Canlı koşular Koşular kütüphanesine kendiliğinden yazılır (kayıt kaynağı koşuları yazılmaz).
      setSource(r.source === null ? null : otomatikKayitli(r.source));
      if (TARAYICI && r.source !== null) void swBagla(r).catch((e: unknown) => console.warn("oyun-sw", e));
    });
    // Yalniz tarayici kaynaginda yukleme hatasi arayuze yazilir; bayraksiz yol eskisi gibi (yakalanmayan) kalir.
    void (TARAYICI
      ? secim.catch((e: unknown) => {
          if (alive) setYuklemeHatasi(typeof (e as { kod?: unknown } | null)?.kod === "string" ? (e as { kod: string }).kod : "genel");
        })
      : secim);
    return () => {
      alive = false;
      abonelik?.();
      sw?.kapat();
      swOnay.current = null;
      secilen.current = null;
      made?.dispose();
      void kapat?.();
      setSource(null);
      setMissing(false);
      setHiz(null);
      setAcilis(null);
      setYuklemeHatasi(null);
      setMotor(null);
      setUyari(null);
      setAcilisUyari(null);
      setSurum("yok");
      setEskiPaket(false);
      setHizmetler(null);
      setPanelAcik(false);
      setHatirlatma(null);
      setHesaplaniyor(false);
      setKaydediliyor(false);
      setKayitKilitli(null);
      setKayitBekliyor(false);
    };
  }, [deneme]);

  const bekleme =
    TARAYICI && yuklemeHatasi !== null ? (
      <YuklemeHatasiEkrani kod={yuklemeHatasi} yeniden={() => setDeneme((n) => n + 1)} />
    ) : TARAYICI ? (
      <YuklemeEkrani durum={acilis} />
    ) : (
      <Yukleniyor />
    );

  const bant = (u: KalicilikUyarisi | AcilisUyarisi): ReactNode =>
    u.tur === "acilis_suruyor" ? (
      <Banner tone="warn">{t("tarayici.uyari.acilis_suruyor", { hafta: u.hafta, hedef: u.hedef })}</Banner>
    ) : (
      <Banner tone="crisis">{t(u.tur === "kayit_acilamadi" ? "tarayici.uyari.kayit_acilamadi" : "tarayici.uyari.kayit_yazilamadi")}</Banner>
    );
  const uyariBandi = TARAYICI && (uyari !== null || acilisUyari !== null) ? (
    <>
      {uyari !== null ? bant(uyari) : null}
      {acilisUyari !== null ? bant(acilisUyari) : null}
    </>
  ) : null;
  // B8: tam ekran oyunun akisini bozmamak icin alt bilgilendirme sutunu (sabit konumlu): cihaz, Safari, kayit baglantisi, 52 hafta hatirlatmasi, kayit durumu, yeni surum.
  const kayitAc = (kosuId: string, tur: "kurucu" | "dao"): void => {
    setPanelAcik(false);
    setAcmaHatasi(false);
    // Kayit TAMAMLANIRSA hash o kosunun rotasina (kurucu `#/canli`, DAO `#/dao`) yazilir ve sayfa yenilenir; tamamlanamazsa hash degismez ve bilgi cikar.
    void guvenliYenile(secilen.current, "acma", () => {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${tur === "dao" ? "#/dao/" : "#/canli/"}${kosuId}`);
    }).then((basladi) => {
      if (!basladi) setAcmaHatasi(true);
    });
  };
  // Ö10: hatirlatmadaki "Simdi disa aktar" o koşuyu DOGRUDAN indirir (basarisizsa paneli acar).
  const hatirlatmaDisaAktar = (kosuId: string): void => {
    setHatirlatma(null);
    void (hizmetler?.disaAktar(kosuId).then((d) => void dosyaIndir(d.ad, d.metin)) ?? Promise.reject(new Error("hizmet_yok"))).catch(() => setPanelAcik(true));
  };
  // Ö7: kilit bandi yalniz kilitli koşunun rotasinda (ya da bir koşu rotasinda olunmayan ekranlarda) gorunur.
  const kayitRotaKosusu = route.name === "canli" || route.name === "sonuc" || route.name === "dao" ? route.runId : undefined;
  const bildirimIcerik = TARAYICI ? (
    <>
      <CihazUyarisi gorunur={cihaz} />
      <SafariSeridi webkit={webkit} />
      {kayitBilgisi ? (
        <Banner tone="neutral">
          {t("tarayici.acilamaz.kayit")}
          <BantEylemleri>
            <Button variant="secondary" size="sm" onClick={() => setKayitBilgisi(false)}>
              {t("tarayici.acilamaz.kapat")}
            </Button>
          </BantEylemleri>
        </Banner>
      ) : null}
      {hatirlatma !== null ? (
        <Banner tone="warn">
          {t("kayit.hatirlatma.metin", { hafta: hatirlatma.hafta })}
          <BantEylemleri>
            <Button
              variant="primary"
              size="sm"
              onClick={() => hatirlatmaDisaAktar(hatirlatma.kosuId)}
            >
              {t("kayit.hatirlatma.disa")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setHatirlatma(null)}>
              {t("kayit.hatirlatma.sonra")}
            </Button>
          </BantEylemleri>
        </Banner>
      ) : null}
      {kotaYuzde !== null ? (
        <Banner tone="warn">
          {t("kayit.depolama.uyari", { yuzde: kotaYuzde })}
          <BantEylemleri>
            <Button variant="secondary" size="sm" onClick={() => setPanelAcik(true)}>
              {t("kayit.dugme")}
            </Button>
          </BantEylemleri>
        </Banner>
      ) : null}
      {kayitKilitli !== null && (kayitRotaKosusu === undefined || kayitRotaKosusu === kayitKilitli) ? <Banner tone="crisis">{t("kayit.durum.kilitli")}</Banner> : null}
      {acmaHatasi ? <Banner tone="warn">{t("kayit.durum.acma_hata")}</Banner> : null}
      {kayitBekliyor ? <Banner tone="neutral">{t("kayit.durum.bekliyor")}</Banner> : null}
      <YeniSurumBandi durum={surum} onayla={() => swOnay.current?.()} sonra={surumSonra} onSonra={() => setSurumSonra(true)} />
    </>
  ) : null;
  // Tam ekran oyunda yuva (OyunEkrani alt-sol sutunu) varsa bantlar oraya; yoksa eski sabit sutun.
  const bildirimler = bildirimIcerik === null ? null : yuva !== null ? createPortal(bildirimIcerik, yuva) : <div className={sayfa.bildirimler}>{bildirimIcerik}</div>;
  const kayitBaglami = TARAYICI && hizmetler !== null ? { paneliAc: () => setPanelAcik(true) } : null;
  const ekKatman = TARAYICI ? (
    <>
      {bildirimler}
      {yuva !== null ? createPortal(<DurumRozeti hesaplaniyor={hesaplaniyor} kaydediliyor={kaydediliyor} yuvada />, yuva) : <DurumRozeti hesaplaniyor={hesaplaniyor} kaydediliyor={kaydediliyor} />}
      {panelAcik && hizmetler !== null ? (
        <KayitPaneli hizmetler={hizmetler} aktifKosuId={route.name === "canli" || route.name === "sonuc" ? route.runId : null} webkit={webkit} onKapat={() => setPanelAcik(false)} onAc={kayitAc} indir={(ad, metin) => void dosyaIndir(ad, metin)} />
      ) : null}
    </>
  ) : null;
  // Yazilamayan hafta varken sekme kapanirsa ilerleme kaybolabilir: tarayici onayi.
  const yazimBekliyor = TARAYICI && uyari?.tur === "kayit_yazilamadi";
  useEffect(() => {
    if (!yazimBekliyor) return;
    const f = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [yazimBekliyor]);
  // B8: surum nedeniyle yenileme beklenirken notr "dogru surum yukleniyor" (form/oyun acik kalmaz); motor durduysa motor ekrani.
  const motorEkrani = TARAYICI && yenilemeNedeni !== null ? <YuklemeEkrani durum={{ tur: "surum_yukleniyor", neden: yenilemeNedeni }} /> : TARAYICI && motor !== null ? <MotorEkrani neden={motor} yenidenYukle={() => window.location.reload()} /> : null;

  const kaynakGovdesi =
    motorEkrani ? (
      motorEkrani
    ) : missing ? (
      <SunucuYok />
    ) : source === null ? (
      bekleme
    ) : (
      <SimSourceProvider source={source}>
        <HizBilgisiProvider secPerWeekP50={hiz}>
          <Ekranlar tercih={tercih} />
        </HizBilgisiProvider>
      </SimSourceProvider>
    );
  if (giris) {
    return (
      <div lang="tr" className={`${durum.kok} ${sayfa.yaziOlcek} ${sayfa.giris}`} data-hareket={tercih.etkinAzalt ? "azalt" : undefined}>
        <KayitBaglamiSaglayici value={kayitBaglami}>
        <BildirimYuvaSaglayici value={TARAYICI ? setYuva : null}>
        <GirisKabi tercih={tercih} geri={route.name !== "baslangic"} ust={route.name === "kurucu"}>
          {route.name === "baslangic" ? <BaslangicBaslik /> : <h1 className={sayfa.gizli}>{route.name === "dao" ? t("dao.sayfa_baslik") : t("app.baslik")}</h1>}
          {uyariBandi}
          {kaynakGovdesi}
        </GirisKabi>
        {ekKatman}
        </BildirimYuvaSaglayici>
        </KayitBaglamiSaglayici>
      </div>
    );
  }
  return (
    <div lang="tr" className={`${durum.kok} ${sayfa.yaziOlcek} ${tamEkran ? sayfa.tamEkran : sayfa.sayfa}`} data-hareket={tercih.etkinAzalt ? "azalt" : undefined}>
      <KayitBaglamiSaglayici value={kayitBaglami}>
      <BildirimYuvaSaglayici value={TARAYICI ? setYuva : null}>
      <Stack gap="16">
        {/* Şehir ekranında logo ve başlık görsel olarak gizlidir; logo bağlantısı tab sırasında durak olmaması için inert (kabuk kendi başlığını taşır). */}
        <div className={tamEkran ? sayfa.gizli : undefined} inert={tamEkran}>
          <Logo />
        </div>
        {route.name === "stil" ? null : <h1 className={tamEkran ? sayfa.gizli : undefined}>{route.name === "dao" ? t("dao.sayfa_baslik") : t("app.baslik")}</h1>}
        {uyariBandi}
        {route.name === "stil" ? (
          // Stil önizleme sim kaynağı gerektirmez: sunucu yokken ya da kaynak seçilirken de açılır.
          <main aria-label={t("app.ana")}>
            <StilOnizleme />
          </main>
        ) : motorEkrani ? (
          <main aria-label={t("app.ana")} className={TARAYICI && tamEkran ? sayfa.tamEkranBilgi : undefined}>{motorEkrani}</main>
        ) : missing ? (
          <main aria-label={t("app.ana")} className={TARAYICI && tamEkran ? sayfa.tamEkranBilgi : undefined}>
            <SunucuYok />
          </main>
        ) : source === null ? (
          <main aria-label={t("app.ana")} className={TARAYICI && tamEkran ? sayfa.tamEkranBilgi : undefined}>{bekleme}</main>
        ) : (
          <SimSourceProvider source={source}>
            <HizBilgisiProvider secPerWeekP50={hiz}>
              <Ekranlar tercih={tercih} />
            </HizBilgisiProvider>
          </SimSourceProvider>
        )}
      </Stack>
      {ekKatman}
      </BildirimYuvaSaglayici>
      </KayitBaglamiSaglayici>
    </div>
  );
}
