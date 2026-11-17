"use client";
import { useEffect, useState } from "react";
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
import { Banner } from "@/oyun/ui/Banner";
import { Yukleniyor } from "@/oyun/ui/Durum";
import durum from "@/oyun/ui/durum.module.css";
import sayfa from "@/oyun/OyunApp.module.css";

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
export type Chosen = { source: SimSource | null; missing?: boolean; secPerWeekP50?: number | null };

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
export async function chooseSource(loc: Loc, alive: () => boolean = () => true): Promise<Chosen> {
  const forced = new URLSearchParams(loc.search).get("kaynak");
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
  const [source, setSource] = useState<SimSource | null>(null);
  const [missing, setMissing] = useState(false);
  const [hiz, setHiz] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let made: SimSource | null = null;
    void chooseSource(window.location, () => alive).then((r) => {
      if (!alive) {
        r.source?.dispose();
        return;
      }
      made = r.source;
      setMissing(r.missing === true);
      setHiz(r.secPerWeekP50 ?? null);
      // Canlı koşular Koşular kütüphanesine kendiliğinden yazılır (kayıt kaynağı koşuları yazılmaz).
      setSource(r.source === null ? null : otomatikKayitli(r.source));
    });
    return () => {
      alive = false;
      made?.dispose();
      setSource(null);
      setMissing(false);
      setHiz(null);
    };
  }, []);

  const kaynakGovdesi =
    missing ? (
      <SunucuYok />
    ) : source === null ? (
      <Yukleniyor />
    ) : (
      <SimSourceProvider source={source}>
        <HizBilgisiProvider secPerWeekP50={hiz}>
          <Ekranlar tercih={tercih} />
        </HizBilgisiProvider>
      </SimSourceProvider>
    );
  if (giris) {
    return (
      <div lang="tr" className={`${durum.kok} ${sayfa.giris}`} data-hareket={tercih.etkinAzalt ? "azalt" : undefined}>
        <GirisKabi tercih={tercih} geri={route.name !== "baslangic"} ust={route.name === "kurucu"}>
          {route.name === "baslangic" ? <BaslangicBaslik /> : <h1 className={sayfa.gizli}>{route.name === "dao" ? t("dao.sayfa_baslik") : t("app.baslik")}</h1>}
          {kaynakGovdesi}
        </GirisKabi>
      </div>
    );
  }
  return (
    <div lang="tr" className={`${durum.kok} ${tamEkran ? sayfa.tamEkran : sayfa.sayfa}`} data-hareket={tercih.etkinAzalt ? "azalt" : undefined}>
      <Stack gap="16">
        {/* Şehir ekranında logo ve başlık görsel olarak gizlidir; logo bağlantısı tab sırasında durak olmaması için inert (kabuk kendi başlığını taşır). */}
        <div className={tamEkran ? sayfa.gizli : undefined} inert={tamEkran}>
          <Logo />
        </div>
        {route.name === "stil" ? null : <h1 className={tamEkran ? sayfa.gizli : undefined}>{route.name === "dao" ? t("dao.sayfa_baslik") : t("app.baslik")}</h1>}
        {route.name === "stil" ? (
          // Stil önizleme sim kaynağı gerektirmez: sunucu yokken ya da kaynak seçilirken de açılır.
          <main aria-label={t("app.ana")}>
            <StilOnizleme />
          </main>
        ) : missing ? (
          <main aria-label={t("app.ana")}>
            <SunucuYok />
          </main>
        ) : source === null ? (
          <main aria-label={t("app.ana")}>
            <Yukleniyor />
          </main>
        ) : (
          <SimSourceProvider source={source}>
            <HizBilgisiProvider secPerWeekP50={hiz}>
              <Ekranlar tercih={tercih} />
            </HizBilgisiProvider>
          </SimSourceProvider>
        )}
      </Stack>
    </div>
  );
}
