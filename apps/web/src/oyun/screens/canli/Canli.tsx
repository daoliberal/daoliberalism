"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/oyun/copy/t";
import { useHashRoute, type CanliGorunum, type SehirNo } from "@/oyun/hooks/useHashRoute";
import { cityDisplayName } from "@/oyun/lib/names";
import type { RestoreStatus } from "@/oyun/hooks/useRestoreRun";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { useRun } from "@/oyun/sim/useRun";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { ChangeResult, WorldEvent } from "@/oyun/sim/types";
import { DurduDiyalogu, Ipucu } from "@/oyun/screens/rehber/RehberBandi";
import { rehberKosuDevral } from "@/oyun/screens/rehber/rehberDurumu";
import { degistirHedefi } from "@/oyun/screens/rehber/turAdimlari";
import { useRehber } from "@/oyun/screens/rehber/useRehber";
import { Banner } from "@/oyun/ui/Banner";
import { Hata, Yukleniyor } from "@/oyun/ui/Durum";
import type { ChartMarker } from "@/oyun/ui/LineChart";
import { BitisDiyalogu } from "./BitisDiyalogu";
import { BitisKarti } from "./BitisKarti";
import { adlandirici } from "@/oyun/harita/adlar";
import { guncelHarita, haritaAcik } from "@/oyun/harita/haritaKaynagi";
import { HaritaAltSag, KatmanLejanti, KatmanSecici } from "@/oyun/harita/KatmanSecici";
import { oncekiPaket } from "@/oyun/harita/oncekiPaket";
import { sehirSahnesi } from "@/oyun/harita/sehirSahnesi";
import { SehirTuvaliKap } from "@/oyun/harita/SehirTuvaliKap";
import type { KameraKomutu } from "@/oyun/harita/HaritaSahnesi";
import type { Gorunum, HaritaRef, Katman } from "@/oyun/harita/tipler";
import { HaritaKontrolleri } from "@/oyun/ekran/HaritaKontrolleri";
import { OyunEkrani, type SehirOzeti } from "@/oyun/ekran/OyunEkrani";
import type { OlayOgesi } from "@/oyun/ekran/OlaySeridi";
import { SartOkuyucu } from "@/oyun/screens/ortak/SartOkuyucu";
import type { Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { Ayrintilar } from "./Ayrintilar";
import { Cekmece } from "./Cekmece";
import { KararGunlugu } from "./KararGunlugu";
import { KurucuBaglam, baglamBasligi, type BaglamSecimi } from "./KurucuBaglam";
import { KurucuMenu } from "./KurucuMenu";
import { KurucuSart } from "./KurucuSart";
import { KurucuUst } from "./KurucuUst";
import { Hesaplaniyor } from "./Hesaplaniyor";
import { KosuYok } from "./KosuYok";
import { SaatCubugu } from "./SaatCubugu";
import { degistirAc, degistirKapat, useDegistirAcik } from "./degistirDurumu";
import { SartiDegistir } from "./SartiDegistir";
import { SifirdanBaslat } from "./SifirdanBaslat";
import { sifirlaAc, sifirlaKapat, useSifirlaAcik } from "./sifirlaDurumu";
import { useDallan } from "./useDallan";
import { eventWeek, lastTwo, onemliOlay, surumler } from "./olaylar";
import { useThrottled } from "./useThrottled";
import { issizOrani, oran0, sayi } from "./bicim";
import { EKRAN_STILI } from "@/oyun/ekran/ekranStili";
import { sektorOkunurAd } from "@/oyun/lib/sektorAdlari";
import { PAYSIZ, type Pay } from "@/oyun/harita/gorunum";
import { useEtkinSahne } from "@/oyun/harita/useEtkinSahne";
import { useGorunumModu } from "@/oyun/harita/useGorunumModu";
import { useGorselDurumlari } from "@/oyun/harita/useGorselDurumlari";
import { useBalonlar } from "@/oyun/harita/useBalonlar";
import { useHaritaGecisleri } from "@/oyun/harita/useHaritaGecisleri";
import { useKaliciYerlesim } from "@/oyun/harita/useKaliciYerlesim";
import kabuk from "./Kabuk.module.css";

/** Çizim en çok 10 kare/sn. */
export const KARE_MS = 100;

type Dikis = { week: number; mode: "exact" | "nearest" | "live" };

/** Son `event.version` olayından dikiş haftası ve kip. */
function dikisOf(events: WorldEvent[], yerel: Dikis | null): Dikis | null {
  // Bu oturumda uygulanan değişiklik her zaman en yenisidir (0. haftadaki değişikliğin olayı yoktur, eski dikişi geçersiz kılar).
  if (yerel) return yerel;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.textKey !== "event.version") continue;
    const mod = e.params.mod;
    return { week: eventWeek(e), mode: mod === "nearest" ? "nearest" : mod === "live" ? "live" : "exact" };
  }
  return null;
}

/** Dikiş bandı metni: canlı kaynakta model önden çalıştığı için her zaman canlı metin (gerçek dikiş haftasıyla). */
function dikisKey(mode: Dikis["mode"], isLive: boolean): "degistir.dikis_live" | "degistir.dikis_exact" | "degistir.dikis_nearest" {
  if (isLive || mode === "live") return "degistir.dikis_live";
  return mode === "exact" ? "degistir.dikis_exact" : "degistir.dikis_nearest";
}

export function markersOf(events: WorldEvent[], dikis: Dikis | null): ChartMarker[] {
  const out: ChartMarker[] = [];
  for (const e of events) {
    if (dikis && e.textKey === "event.version" && e.week === dikis.week) continue; // dikiş iğnesi aynı haftadaki sürüm iğnesinin yerini alır
    if (e.id.startsWith("cokus:")) out.push({ week: e.week, kind: "collapse", labelKey: "seri.isaret_cokus" });
    else if (e.id.startsWith("toparlanma:")) out.push({ week: e.week, kind: "recovery", labelKey: "seri.isaret_toparlanma" });
    else if (e.textKey === "event.version") out.push({ week: e.week, kind: "version", labelKey: "seri.isaret_surum" });
    else if (e.critical) out.push({ week: e.week, kind: "event", labelKey: "seri.isaret_olay" });
  }
  if (dikis) out.push({ week: dikis.week, kind: "seam", labelKey: "seri.isaret_dikis" });
  return out;
}

type Props = { runId: string; restore: { status: RestoreStatus }; tercih?: Tercih };

/** Koşu yok / yükleniyor / hata gibi kabuğun çizilmediği durumlar tam ekran kapta ortalanır. */
function Merkez({ children }: { children: ReactNode }) {
  return <div className={kabuk.merkez}>{children}</div>;
}

/** Kurucu şehir ekranı. Koşu `useRestoreRun` ile açılır (kök ekran); kayıp koşu "kurulamadı" bandı gösterir. `tercih` (tema, hareket) menüye bağlanır. */
export function Canli({ runId, restore, tercih }: Props) {
  const { go } = useHashRoute();
  const toKurucu = () => go({ name: "kurucu" });
  if (restore.status === "missing") return <Merkez><KosuYok go={toKurucu} /></Merkez>;
  if (restore.status !== "ready") return <Merkez><Yukleniyor /></Merkez>;
  return <Govde runId={runId} toKurucu={toKurucu} {...(tercih ? { tercih } : {})} />;
}

function Govde({ runId, toKurucu, tercih }: { runId: string; toKurucu(): void; tercih?: Tercih }) {
  const source = useSimSource();
  const { route, go, replace } = useHashRoute();
  const { info, capabilities } = useSourceInfo();
  const panel = useDegistirAcik();
  const setPanel = (v: boolean): void => (v ? degistirAc() : degistirKapat());
  const [yerelDikis, setDikis] = useState<Dikis | null>(null);
  /** Kabul edilen değişikliğin yeni kimliği (`to`) ve kabul edildiği rota (`from`): hash'e yalnız canlı `state.runId` ona eşit olunca ve hâlâ o rotadayken yazılır. */
  const [yeniKimlik, setYeniKimlik] = useState<{ from: string; to: string } | null>(null);
  /** Açık ayrıntı çekmecesi: istek anındaki yayımlanmış hafta sabit kalır (model ilerleyince "eski hafta" notu çıkar). */
  const [cekmece, setCekmece] = useState<{ kind: string; ref: string; hafta: number } | null>(null);
  /** Haritada seçili bina/meydan/şehir/ahır (sağ panel); şehir değişince ya da koşu değişince geçersizdir. */
  const [secim, setSecim] = useState<(BaglamSecimi & { sehir: number }) | null>(null);
  const [katman, setKatman] = useState<Katman>("yok");
  const [kamera, setKamera] = useState<Gorunum>({ x: 0, y: 0, olcek: 1 });
  const [komut, setKomut] = useState<KameraKomutu | null>(null);
  /** Yüzen öğelerin ölçülen payları (kabuk bildirir): harita bunların dışındaki serbest alana sığdırılır. */
  const [pay, setPay] = useState<Pay>(PAYSIZ);
  /** Kabuk düzeyindeki iki küçük diyalog: Şart okuyucusu ve Karar günlüğü. */
  const [okuyucuAcik, setOkuyucuAcik] = useState(false);
  const [gunlukAcik, setGunlukAcik] = useState(false);
  /** "Tüm olaylar" kapısı: Ayrıntılar penceresini Olaylar sekmesinde açar. */
  const [ayrintiKomutu, setAyrintiKomutu] = useState<{ n: number; sekme: "olaylar" } | null>(null);
  /** Ayrıntılar penceresi açık mı (rehber diyalogları açıkken bekletilir). */
  const [ayrintilarAcik, setAyrintilarAcik] = useState(false);
  /** Bitiş diyaloğu açık mı (kapatılınca özet kartı kalır). Yalnız koşu bu oturumda bitiş anına geçince açılır; biten koşu açılınca kapalıdır. */
  const [bitisAcik, setBitisAcik] = useState(false);
  const sifirlaAcik = useSifirlaAcik();
  // Ekrandan ayrılınca "Sıfırdan başlat" diyaloğu kapanır (paylaşılan dış durum, sonraki açılışta açık kalmasın).
  useEffect(() => sifirlaKapat, []);
  const { registry } = useRegistry();
  // Abonelik anahtarı: hash'e `replace` ile yazılan yeni tarif aboneliği ve `weeks`'i sıfırlamaz.
  /** `tohum`: şehrin düzeni (parsel ataması) için sabit kimlik; Şart değişikliği yeni koşu kimliği verse de düzen kaymasın. */
  const [track, setTrack] = useState({ prop: runId, sub: runId, tohum: runId });
  const run = useRun(track.sub);
  const live = run.state?.runId ?? track.sub;
  if (track.prop !== runId) {
    if (runId === live || runId === track.sub) setTrack({ ...track, prop: runId });
    else {
      setTrack({ prop: runId, sub: runId, tohum: runId });
      setSecim(null);
      setOkuyucuAcik(false);
      setGunlukAcik(false);
      setDikis(null);
      setYeniKimlik(null);
      setPanel(false);
      setCekmece(null);
      setBitisAcik(false);
      sifirlaKapat();
    }
  }

  useEffect(() => {
    // Bildirimsiz `replace`: `hashchange` yok, `open` yok; abonelik ve `weeks` korunur (Canli yukarıdaki kuralla).
    // Yalnız değişikliğin kabul edildiği rotadayken: başka koşuya geçilmişse (Sıfırdan başlat, dallan, Koşular) eski kimlik hash'e geri yazılmaz.
    if (yeniKimlik !== null && live === yeniKimlik.to && route.name === "canli" && route.runId === yeniKimlik.from) replace({ name: "canli", runId: yeniKimlik.to, ...(route.name === "canli" && route.view ? { view: route.view } : {}) });
  }, [yeniKimlik, live, replace, route]);

  const applied = (r: Extract<ChangeResult, { accepted: true }>) => {
    rehberKosuDevral(runId, r.runId);
    setDikis({ week: r.seamWeek, mode: r.mode });
    setPanel(false);
    setYeniKimlik({ from: runId, to: r.runId });
  };

  // Dikiş bandı kaydın sürüm olayından türer (yenilemeden sonra da); 0. haftadaki değişikliğin olayı yoktur, yerel durum yedektir.
  const dikis = useMemo(() => dikisOf(run.events, yerelDikis), [run.events, yerelDikis]);
  const bundle = useMemo(() => ({ weeks: run.weeks, events: run.events }), [run.weeks, run.events]);
  const { weeks, events } = useThrottled(bundle, KARE_MS);
  const { cur, prev } = useMemo(() => lastTwo(weeks), [weeks]);

  const state = run.state;
  /** Bitiş diyaloğu: aynı koşu bu oturumda bitmeyen bir durumdan `ended`'e geçince açılır (açılışta zaten bitmiş koşuda açılmaz). */
  const oncekiDurum = useRef<{ runId: string; status: string } | null>(null);
  const simdiRun = state?.runId;
  const simdiDurum = state?.status;
  useEffect(() => {
    if (simdiRun === undefined || simdiDurum === undefined) return;
    const once = oncekiDurum.current;
    if (once !== null && once.runId === simdiRun && once.status !== "ended" && simdiDurum === "ended") setBitisAcik(true);
    oncekiDurum.current = { runId: simdiRun, status: simdiDurum };
  }, [simdiRun, simdiDurum]);
  const total = state?.durationWeeks ?? 200;
  const dallan = useDallan(live, total, capabilities.branch);
  const markers = useMemo(() => markersOf(events, dikis), [events, dikis]);
  const sehirNo: SehirNo = route.name === "canli" && route.view?.startsWith("sehir-") ? (Number(route.view.slice(6)) as SehirNo) : 0;
  const dunyaBilgi = info?.world;
  const sektorAdi = useMemo(() => {
    const etiketler = new Map((dunyaBilgi?.chain?.sectors ?? []).map((x) => [x.sector, x.label]));
    return (id: string): string => etiketler.get(id) ?? sektorOkunurAd(id);
  }, [dunyaBilgi]);
  const adlar = useMemo(() => adlandirici(sektorAdi), [sektorAdi]);
  const sehirAdlariHam = state?.cityNames;
  const harita = useMemo(() => guncelHarita(weeks), [weeks]);
  const onceki = useMemo(() => oncekiPaket(weeks, cur), [weeks, cur]);
  // Kalıcı yerleşim (K9): işletmeler koşu boyunca yerinde kalır; klasik ve izo ayrı tablolardır.
  const yerKlasik = useKaliciYerlesim(track.tohum, "klasik", sehirNo);
  const yerIzo = useKaliciYerlesim(track.tohum, "izo", sehirNo);
  const sahne = useMemo(
    () => (cur === null ? null : sehirSahnesi(cur, harita, { runId: track.tohum, sehirAdlari: sehirAdlariHam ?? [], sehir: sehirNo, katman, oncekiPaket: onceki, ben: null, yerlesim: yerKlasik.onceki() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur, harita, track.tohum, sehirAdlariHam, sehirNo, katman, onceki, yerKlasik.anahtar],
  );
  // Görünüm modu tek yerde çözülür; etkin sahne (klasik ya da izometrik) burada kurulur, `SehirTuvaliKap` manifest ya da görsel boy almaz.
  const gorunum = useGorunumModu();
  // Geçiş/boy hesabı yalnız izo çiziminde kullanılır: klasikte harita verilmez (hesap yapılmaz).
  const gecis = useHaritaGecisleri(gorunum.mod === "izo" ? harita : null, undefined, track.tohum);
  const durumlar = useGorselDurumlari(harita, gecis);
  const izoKaynak = useMemo(
    () => (cur === null || gorunum.mod !== "izo" ? null : sehirSahnesi(cur, harita, { runId: track.tohum, sehirAdlari: sehirAdlariHam ?? [], sehir: sehirNo, katman, oncekiPaket: onceki, ben: null, izo: true, yerlesim: yerIzo.onceki() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur, harita, gorunum.mod, track.tohum, sehirAdlariHam, sehirNo, katman, onceki, yerIzo.anahtar],
  );
  const kaydetKlasik = yerKlasik.kaydet;
  const kaydetIzo = yerIzo.kaydet;
  const klasikTablo = sahne?.yerlesim;
  const izoTablo = izoKaynak?.yerlesim;
  useEffect(() => kaydetKlasik(klasikTablo), [kaydetKlasik, klasikTablo]);
  useEffect(() => kaydetIzo(izoTablo), [kaydetIzo, izoTablo]);
  const balonlar = useBalonlar(gecis.gecisler, undefined, null, izoKaynak);
  const etkin = useEtkinSahne({ mod: gorunum.mod, manifest: gorunum.manifest, klasik: sahne, izoKaynak, tohum: track.tohum, gorselBoy: gecis.gorselBoy, spriteHatasiBildir: gorunum.spriteHatasiBildir, ...(durumlar ? { durumlar } : {}), gecisler: gecis.gecisler, balonlar });
  // Mod değişince eski yerleşimin parsel kimliği geçersiz olabilir: parsel seçimi temizlenir.
  const oncekiIzo = useRef(etkin.izoMu);
  useEffect(() => {
    if (oncekiIzo.current === etkin.izoMu) return;
    oncekiIzo.current = etkin.izoMu;
    setSecim((s) => (s?.ref.kind === "parsel" ? null : s));
  }, [etkin.izoMu]);
  const curHafta = cur?.week ?? null;
  const sahneSec = useCallback((r: HaritaRef | null) => setSecim(r !== null && curHafta !== null ? { ref: r, hafta: curHafta, sehir: sehirNo } : null), [curHafta, sehirNo]);
  const komutVer = useCallback((tur: KameraKomutu["tur"]) => setKomut((k) => ({ n: (k?.n ?? 0) + 1, tur })), []);
  const rehber = useRehber(source, live, state, run.events, (cur?.diagnostics?.length ?? 0) > 0, panel || sifirlaAcik || cekmece !== null || bitisAcik || dallan.bekliyor || ayrintilarAcik);

  // Koşu sunucuda yok (örn. sunucu yeniden başladı): ölü grafik yerine "kurulamadı" ve yeni koşu eylemi.
  if (run.error === "hata.kosu_bulunamadi") return <Merkez><KosuYok go={toKurucu} /></Merkez>;
  // Kaynak hatası: durum yoksa (bilinmeyen koşu) hata ekranı; koşu varsa yalnız uyarı bandı, ekran yerinde kalır.
  if (state === null) {
    return <Merkez>{run.error !== null ? <Hata messageKey={run.error} retry={() => void source.open(track.sub).catch(() => {})} /> : <Yukleniyor />}</Merkez>;
  }
  const sehirAcik = capabilities.city;
  const zincirAcik = capabilities.chain;
  // Eski görünüm rotaları yeni yerlerine yönlenir: dunya/harita -> şehir ekranı (OyunApp bağlantıyı yeniden yazar), zincir -> Ayrıntılar > Zincir (aşağıda `ilk`),
  // sehir-N -> N. şehir. Kayıt kaynağında bina verisi olmadığından şehir ekranı sokak, meydan ve kamu binalarıyla açılır (`binaVerisiYok`).
  const istenen: CanliGorunum = route.name === "canli" ? (route.view ?? "dunya") : "dunya";
  const haritaVar = haritaAcik(capabilities);
  /** Ayrıntılar'ın başlangıç kapsamı: rotada şehir varsa o şehir, yoksa dünya. */
  const ayrintiKapsami = istenen.startsWith("sehir-") ? sehirNo : null;
  const sehirAdlari = state.cityNames;
  const ac = typeof source.drawer === "function" && cur ? (kind: string, ref: string): void => setCekmece({ kind, ref, hafta: cur.week }) : undefined;
  const failed = state.status === "failed";
  /** Bitiş diyaloğu: kapatılmadıysa ve başka bir diyalog (sıfırlama, dal hazırlığı) açık değilse. */
  const bitisGoster = state.status === "ended" && bitisAcik && !sifirlaAcik && !dallan.bekliyor && state.preparing === undefined;
  /** "Ayarı değiştir" yalnız koşu sürerken; zincir ve tanı panelleri aynı paneli açar. */
  const kuralDegistir = state.status === "ended" || failed ? undefined : degistirAc;
  /** Dal hazırlığını iptal: koşu atılır, üst koşuya (silinmişse Kurucu'ya) dönülür. */
  const iptalEt = async (): Promise<void> => {
    const ust = state.parentRunId;
    try {
      await source.discard?.(live);
    } catch {
      // atılamadıysa da kullanıcı üst koşuya döner
    }
    const h = ust !== undefined ? await source.open(ust).catch(() => null) : null;
    if (h) go({ name: "canli", runId: h.runId });
    else toKurucu();
  };
  const isLive = source.kind === "live";
  // Canlı koşuda çöken model aynı `failed` durumunu döndürür: "Yeniden dene" ölü düğme olurdu, net eylem yeni koşu.
  const crash = isLive ? (
    <Hata messageKey={state.error?.messageKey ?? "durum.hata"} retry={toKurucu} retryKey="canli.yeni_kosu" />
  ) : (
    <Hata messageKey={state.error?.messageKey ?? "durum.hata"} retry={() => void source.open(live).catch(() => {})} />
  );
  // Hiç hafta gelmeden duran koşuda yalnız hata; haftalar varsa önceki haftalar grafikte kalır (model çöktü, koşu durdu).
  if (failed && run.weeks.length === 0) return <Merkez>{crash}</Merkez>;
  const satirlar = surumler(events, state.week, state.version);
  const sonSurum = satirlar[satirlar.length - 1];
  const ayniSurum = state.version > 1 && sonSurum !== undefined && sonSurum.a === state.week;

  const hataBandi = run.error !== null ? <Banner tone="warn">{t(run.error)}</Banner> : null;
  const durumBandi = state.computing ? (
    <Banner tone="warn">{t(isLive ? "degistir.hesaplaniyor.live" : "degistir.hesaplaniyor.replay")}</Banner>
  ) : dikis ? (
    <Banner tone="neutral">{t(dikisKey(dikis.mode, isLive), { n: dikis.week })}</Banner>
  ) : null;
  /** Aynı bantlar Ayrıntılar > Koşu sekmesinde de çizilir (eşleme: ayrintilarEslemesi.ts). */
  const bantlar = (
    <>
      {hataBandi}
      {failed ? crash : null}
      {durumBandi}
    </>
  );
  /** Eski `#/canli/<id>/zincir` bağlantısı: Zincir artık Ayrıntılar penceresinin sekmesi; pencere o sekmede açılır (ilk çizimde). */
  const ilk = istenen === "zincir" ? { acik: true, sekme: "zincir" as const } : undefined;

  const ayrintilar = (
    <Ayrintilar
      kosuAnahtari={track.sub} state={state} cur={cur} prev={prev} weeks={weeks} tumHaftalar={run.weeks} events={events} tumOlaylar={run.events}
      markers={markers} total={total} sehir={ayrintiKapsami} sehirAdlari={sehirAdlari} isLive={isLive} sehirAcik={sehirAcik} zincirAcik={zincirAcik}
      dunya={dunyaBilgi} sektorAdi={sektorAdi} {...(ac ? { ac } : {})} registry={registry} {...(kuralDegistir ? { onDegistir: kuralDegistir } : {})}
      onSifirla={sifirlaAc} onSonuc={() => go({ name: "sonuc", runId: live })} onBitisAc={() => setBitisAcik(true)} dallan={dallan} satirlar={satirlar}
      bantlar={bantlar} baski={sifirlaAcik || bitisGoster || state.preparing !== undefined} bekle={dallan.bekliyor}
      ilk={ilk} onAcik={setAyrintilarAcik} komut={ayrintiKomutu}
    />
  );
  /** Koşu eylemleri: menü, Şart paneli ve Ayrıntılar > Koşu aynı işlevleri kullanır. Ayrıntılar açıkken dışarıdaki örnekler çizilmez (aynı yüzeyde aynı ad iki kez olmaz). */
  const kosu = {
    ...(kuralDegistir ? { onDegistir: kuralDegistir } : {}),
    onSart: () => setOkuyucuAcik(true),
    onSifirla: sifirlaAc,
    onSonuc: () => go({ name: "sonuc", runId: live }),
    onGunluk: () => setGunlukAcik(true),
  };
  const sehirSec = (id: number): void => {
    setSecim(null);
    replace({ name: "canli", runId: live, view: `sehir-${id}` as CanliGorunum });
  };
  const sehirler: SehirOzeti[] = (sehirAdlari.length > 0 ? sehirAdlari : ["", "", "", "", ""]).map((ad, i) => {
    const c = cur?.cities?.find((x) => x.index === i);
    const issiz = c ? issizOrani(c.employed, c.unemployed) : null;
    return {
      id: i,
      ad: cityDisplayName(ad, i),
      ...(c ? { ozet: t("kurucu.sehir.ozet", { isletme: sayi(c.firms_total ?? c.firms_npc + c.firms_player), issiz: issiz === null ? t("canli.gosterge.olculmuyor") : oran0(issiz), talep: c.served === null ? t("canli.gosterge.olculmuyor") : oran0(c.served) }) } : {}),
    };
  });
  const olaylar: OlayOgesi[] = [...events]
    .reverse()
    .filter(onemliOlay)
    .slice(0, EKRAN_STILI.olaySayisi)
    .map((e) => ({ id: e.id, metin: t("kurucu.olay_satir", { hafta: eventWeek(e), metin: t(e.textKey, e.params) }) }));
  const secimGecerli = secim !== null && secim.sehir === sehirNo ? secim : null;
  const sagPanel =
    secimGecerli !== null && etkin.kaynak !== null && cur !== null
      ? {
          baslik: baglamBasligi(secimGecerli, etkin.kaynak, adlar),
          icerik: <KurucuBaglam runId={live} secim={secimGecerli} sahne={etkin.kaynak} adlar={adlar} cur={cur} sehir={sehirNo} sehirAdlari={sehirAdlari} sektorAdi={sektorAdi} />,
          onKapat: () => setSecim(null),
        }
      : null;
  const bitisKarti = state.status === "ended" && !bitisGoster ? <BitisKarti weeks={state.week} events={run.events} ac={() => setBitisAcik(true)} /> : null;

  return (
    <>
      <OyunEkrani
        sehirler={sehirler} sehir={sehirNo} onSehir={sehirSec} onPay={setPay} tuvalKilitli={ayrintilarAcik} binaVerisiYok={!haritaVar}
        tuval={
          sahne === null || etkin.sahne === null ? (
            <p className={kabuk.bekle}>{t("canli.dunya.bekleniyor")}</p>
          ) : (
            <SehirTuvaliKap kabuk sahne={etkin.sahne} tabloSahnesi={sahne} onSpriteHatasi={gorunum.spriteHatasiBildir} yukleniyor={gorunum.mod === "bekle"} dustu={gorunum.dustu} secili={secimGecerli?.ref ?? null} onSec={sahneSec} kamera={kamera} onKamera={setKamera} {...(komut ? { komut } : {})} adlar={adlar} pay={pay} />
          )
        }
        ustSol={<KurucuUst cur={cur} sehir={sehirNo} />}
        ustOrta={
          <div className={kabuk.ustOrta}>
            <SaatCubugu runId={live} state={state} onDegistir={degistirAc} panelAcik={panel} />
            {ayrintilarAcik ? null : (
              <div className={kabuk.bantlar}>
                {bantlar}
                {bitisKarti}
              </div>
            )}
          </div>
        }
        menu={<KurucuMenu state={state} ayrintilar={ayrintilar} {...(tercih ? { tercih } : {})} kosu={kosu} kosuGizli={ayrintilarAcik} onKosular={() => go({ name: "kosular" })} />}
        solPanel={{ baslik: t("kurucu.sart.baslik"), icerik: <KurucuSart state={state} registry={registry} kosu={ayrintilarAcik ? null : { ...kosu, odakDonusu: true }} /> }}
        sagPanel={sagPanel}
        olaylar={olaylar}
        olayKapisi={{ ad: t("kurucu.olay_tumu"), onAc: () => setAyrintiKomutu((k) => ({ n: (k?.n ?? 0) + 1, sekme: "olaylar" })) }}
        haritaKontrolleri={
          <HaritaAltSag lejant={etkin.kaynak ? <KatmanLejanti veri={etkin.kaynak.katman} /> : null}>
            <HaritaKontrolleri onYaklas={() => komutVer("yakin")} onUzaklas={() => komutVer("uzak")} onSigdir={() => komutVer("sigdir")} ekler={<KatmanSecici katman={katman} onKatman={setKatman} />} />
          </HaritaAltSag>
        }
        ipucu={rehber.ipucu ? <div className={kabuk.ipucu}><Ipucu metin={t(rehber.ipucu.metin)} onTamam={rehber.ipucuTamam} /></div> : null}
      />
      {panel && state.status !== "ended" ? (
        <SartiDegistir
          runId={live}
          state={state}
          weeks={run.weeks}
          sameVersion={ayniSurum}
          onClose={() => setPanel(false)}
          onApplied={applied}
        />
      ) : null}
      {okuyucuAcik ? <SartOkuyucu state={state} onKapat={() => setOkuyucuAcik(false)} /> : null}
      {gunlukAcik ? (
        <Diyalog baslik={t("ustcubuk.gunluk")} onKapat={() => setGunlukAcik(false)}>
          <KararGunlugu state={state} events={run.events} registry={registry} />
        </Diyalog>
      ) : null}
      {rehber.durdu ? (
        <DurduDiyalogu
          olay={rehber.durdu} registry={registry} hedef={degistirHedefi(registry, rehber.durdu.rule_ids)} degistirilebilir={kuralDegistir !== undefined}
          onDegistir={() => {
            const hedef = degistirHedefi(registry, rehber.durdu?.rule_ids ?? []);
            rehber.kapat();
            degistirAc(hedef?.id); // olay karta çözülmüyorsa hedefsiz açılır
          }}
          onDevam={rehber.devam} onKapat={rehber.kapat}
        />
      ) : null}
      {bitisGoster ? (
        <BitisDiyalogu
          weeks={state.week} events={run.events} dallan={dallan}
          onSonuc={() => go({ name: "sonuc", runId: live })}
          onSifirla={() => { setBitisAcik(false); sifirlaAc(); }}
          onKapat={() => setBitisAcik(false)}
        />
      ) : null}
      {sifirlaAcik ? (
        <SifirdanBaslat
          state={state} onKapat={sifirlaKapat}
          onYeni={(id) => { sifirlaKapat(); go({ name: "canli", runId: id }); }}
          onKurucu={() => { sifirlaKapat(); toKurucu(); }}
        />
      ) : null}
      {dallan.bekliyor ? <Hesaplaniyor /> : state.preparing ? <Hesaplaniyor ilerleme={state.preparing} yeniden={state.forkWeek === undefined} hafta={state.forkWeek ?? state.preparing.total} onIptal={() => void iptalEt()} /> : null}
      {cekmece ? (
        <Cekmece
          runId={live} hafta={cekmece.hafta} kind={cekmece.kind} refId={cekmece.ref} sehirAdlari={sehirAdlari}
          onAc={(kind, ref) => setCekmece({ kind, ref, hafta: cekmece.hafta })} onKapat={() => setCekmece(null)}
        />
      ) : null}
    </>
  );
}
