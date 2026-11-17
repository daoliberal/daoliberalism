"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { Stepper } from "@/components/primitives/Stepper";
import { t, type CopyKey } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { codePoints, MAX_CITY_NAME, MAX_WORLD_NAME, normalizeName, type Rng } from "@/oyun/lib/names";
import { isGecisSecenegi, type GecisSecenegi } from "@/oyun/screens/ortak/GecisDestegiKarti";
import { rehberKosuIsaretle, turGoruldu, turGorulduYaz } from "@/oyun/screens/rehber/rehberDurumu";
import { Tur } from "@/oyun/screens/rehber/Tur";
import { turAdimlari } from "@/oyun/screens/rehber/turAdimlari";
import { degerMetni, gonderilebilirMi, isKural, sartFarki, sartTabani, taslagiSuz } from "@/oyun/screens/sart/sartMantik";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Availability, GoalId, RunHandle, ValuesPatch } from "@/oyun/sim/types";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { Hata, Yukleniyor } from "@/oyun/ui/Durum";
import type { SettingId } from "@/oyun/ui/SettingCard";
import { Adim0Adlandir } from "./Adim0Adlandir";
import { Adim1Sablon, sablonKartlari } from "./Adim1Sablon";
import { GERCEKCI_SENARYO, OZEL_SENARYO, ozelGonderilecek } from "@/oyun/screens/insanlar/insanlarMantik";
import { senaryoAdi } from "@/oyun/screens/insanlar/Insanlar";
import { Adim2Sart } from "./Adim2Sart";
import { Adim3SureHedef, HEDEFLER, type SureSecenegi } from "./Adim3SureHedef";
import { Adim4Baslat } from "./Adim4Baslat";
import { useKurucuTaslak } from "./useKurucuTaslak";
import styles from "./Kurucu.module.css";

const AVAIL_GECIKME_MS = 200;
const PENDING: Availability = { ok: true, scenarioId: null, blocked: [] };
const ADIMLAR = ["kurucu.adim0.ad", "kurucu.adim1.ad", "kurucu.adim2.ad", "kurucu.adim3.ad", "kurucu.adim4.ad"] as const satisfies readonly CopyKey[];

/** Rehberli ilk oyunda yalnız üç adım var (şablon, tur, başlat); sayılar `ADIMLAR` sırasıdır. */
const TAM_SIRA: readonly number[] = [0, 1, 2, 3, 4];
const REHBER_SIRA: readonly number[] = [1, 2, 4];
const REHBER_ADIMLAR: Record<number, CopyKey> = { 1: "rehber.adim.sablon", 2: "rehber.adim.tur", 4: "rehber.adim.oynat" };

/** Prototipin koşu süreleri (520: DAO oyununun süresi); kaynağın kendi süresi listede yoksa ona eklenir. */
const SURELER = [100, 200, 500, 520] as const;

const isSettingId = (id: string): id is SettingId => `setting.${id}.name` in tr;

type Phase = "idle" | "busy" | "error";

/** Başlat'ın sunucudan aldığı reddin metni: koşu sayısı sınırı ve meşgul sunucu ayrı, gerisi genel. */
function baslatHataAnahtari(e: unknown): CopyKey {
  if (e instanceof SimUnsupported && e.message === "too_many_runs") return "kurucu.baslat_hata_cok_kosu";
  if (e instanceof SimUnsupported && e.message === "too_big") return "kurucu.baslat_hata_cok_buyuk";
  if (e instanceof SimUnsupported && e.message === "busy_preparing") return "kurucu.baslat_hata_mesgul";
  return "kurucu.baslat_hata";
}

/** Kurucu: adım 0 ad ve şehir profili, 1 şablon, 2 Şartı yaz (Şart editörü), 3 süre, başlangıç dünyası ve hedefler, 4 özet; Başlat her adımda. */
export function Kurucu({ adopt, randomSource }: { adopt(handle: RunHandle): void; randomSource?: Rng }) {
  const source = useSimSource();
  const isLive = source.kind === "live";
  const { go, route } = useHashRoute();
  const uid = useId();
  const { info, error: infoFailed, retry } = useSourceInfo();
  const { taslak, guncelle, temizle } = useKurucuTaslak();
  const rehberli = route.name === "kurucu" && route.rehberli === true;
  const uzmanAcik = route.name === "kurucu" && route.uzman === true;
  const sira = rehberli ? REHBER_SIRA : TAM_SIRA;
  const adimAdi = (n: number): CopyKey => (rehberli ? REHBER_ADIMLAR[n] : undefined) ?? ADIMLAR[n]!;
  // "Yeni koşu olarak başlat" (Şartı değiştir) taslağı Özet adımında, "Şartı kopyala" (Koşular) Şartı yaz adımında açar.
  const [adimSecimi, setStep] = useState(() => (route.name === "kurucu" && route.adim === "4" ? ADIMLAR.length - 1 : route.name === "kurucu" && route.adim === "2" ? 2 : rehberli ? 1 : 0));
  /** Rehberli kipte listede olmayan adım (Rehberi atla'dan önce kalan 0 ya da 3) ilk adıma düşer. */
  const step = sira.includes(adimSecimi) ? adimSecimi : sira[0]!;
  const konum = sira.indexOf(step);
  const [turAdim, setTurAdim] = useState<number | null>(null);
  const [turOnerildi, setTurOnerildi] = useState(false);
  const [avail, setAvail] = useState<{ for: string; a: Availability } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hataAnahtari, setHataAnahtari] = useState<CopyKey>("kurucu.baslat_hata");
  const alive = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const kartlar = info ? sablonKartlari(info, info.registry) : [];
  const secilebilir = kartlar.filter((k) => k.secilebilir);
  const seciliKart = secilebilir.find((x) => x.id === taslak.templateId) ?? secilebilir[0];
  const template = info?.templates.find((x) => x.id === seciliKart?.id);
  const registry = info?.registry;
  const ayarlar = info?.settings;
  const turListesi = useMemo(() => (registry ? turAdimlari(registry) : []), [registry]);
  // Rehberli kipte Şartı yaz adımına ilk gelişte tur kendiliğinden açılır (görülmemişse); sonra "Turu başlat" düğmesi vardır.
  if (rehberli && step === 2 && !turOnerildi && turListesi.length > 0) {
    setTurOnerildi(true);
    if (!turGoruldu()) setTurAdim(0);
  }
  // Saklanan taslak kaynağa göre tek süzgeçten geçer (kayıtta olmayan ve düzenlenemeyen kart düşer); yoksa kayıt yokken olduğu gibi kalır.
  const suzulmus = registry ? taslagiSuz(registry, "builder", ayarlar ?? [], taslak.values) : { kept: taslak.values, dropped: [] as string[] };
  const degerler = { ...(template?.values ?? {}), ...suzulmus.kept };
  const gecis: GecisSecenegi = isGecisSecenegi(degerler.gecis_destegi) ? degerler.gecis_destegi : "kapali";
  const seeds = info?.seeds ?? [];
  const dunyaKarti = info?.registry?.cards.find((c) => c.id === "dunya_tohumu");
  const dunyaEtiket = (index: number): string => {
    const o = dunyaKarti?.control.type === "options" ? dunyaKarti.control.options.find((x) => x.value === index) : undefined;
    return o?.label ?? t("kurucu.dunya_ad", { n: index + 1 });
  };
  // Saklanan dünya kaynakta yoksa (eski oturum) ilk dünyaya düşülür.
  const dunyalar = seeds.map((x) => ({ index: x.index, ad: dunyaEtiket(x.index) }));
  const seedIndex = seeds.some((s) => s.index === taslak.seedIndex) ? (taslak.seedIndex as number) : (seeds[0]?.index ?? 0);
  // Süre: kayıt kaynağında yalnız kaydın süresi (`durations` yok), canlıda sunucunun listesi; saklanan süre kaynakta yoksa kaynağın süresine düşülür.
  const kaynakSureleri = info?.durations ?? (info ? [info.durationWeeks] : []);
  const sureSecenekleri: SureSecenegi[] = [...new Set<number>([...SURELER, ...(info ? [info.durationWeeks] : [])])]
    .sort((a, b) => a - b)
    .map((hafta) => ({
      hafta,
      neden: kaynakSureleri.includes(hafta) ? null : info?.durations || isLive ? t("kurucu.adim3.sure_kilit_model") : t("kurucu.adim3.sure_kilit_kayit", { n: info?.durationWeeks ?? 0 }),
    }));
  const sure = sureSecenekleri.some((x) => x.hafta === taslak.durationWeeks && x.neden === null) ? (taslak.durationWeeks as number) : (info?.durationWeeks ?? 0);
  // Kayıt kaynağı hedefleri izlemez: seçim nedenli kilitli, Özet'te seçilmiş görünmez, Başlat'a gitmez.
  const hedefKilit = isLive ? undefined : t("kurucu.adim3.hedef_kilit_kayit");
  const hedefler = hedefKilit ? [] : HEDEFLER.filter((g) => taslak.goals.includes(g));
  // Dünya senaryosu (DK-9): kayıtta olmayan, başlatılamayan ya da kayıt kaynağında saklı kalmış seçim gerçekçiye düşer; Şart'a girmez.
  const senaryolar = registry?.scenarios ?? [];
  const secilenSenaryo = !isLive ? undefined : senaryolar.find((x) => x.id === taslak.worldScenarioId && x.startable !== false);
  const dunyaSenaryosu = secilenSenaryo && secilenSenaryo.id !== GERCEKCI_SENARYO ? secilenSenaryo.id : null;
  const ozelDunya = dunyaSenaryosu === OZEL_SENARYO && registry ? ozelGonderilecek(registry, taslak.worldScenarioValues) : {};
  const taban = registry ? sartTabani(registry, template?.values ?? {}) : null; // her çizimde yeniden hesaplanır (React Compiler etkin değil); ucuzdur
  // Başlat'a ve kullanılabilirlik denetimine giden değerler: şeritle aynı süzgeç (DK-17). Şablonun kilitli kart değerlerini sunucu `templateId` ile kendisi uygular.
  const gonderilecek = Object.fromEntries(
    Object.entries({ ...degerler, gecis_destegi: gecis }).filter(([id]) => {
      if (!registry) return true;
      const c = registry.cards.find((x) => x.id === id);
      return c !== undefined && gonderilebilirMi(c, "builder", ayarlar?.find((x) => x.id === id));
    }),
  ) as ValuesPatch;
  const gonderilecekAnahtar = JSON.stringify(gonderilecek);

  useEffect(() => {
    let live = true;
    const settle = (a: Availability) => {
      if (live) setAvail({ for: gonderilecekAnahtar, a });
    };
    // Başlat'a gidecek değerlerin tamamıyla denetlenir (şablon başka ayar da doldurabilir).
    // Her tuşta değil, kısa bir gecikmeyle sorulur.
    const timer = setTimeout(() => {
      source.availability(JSON.parse(gonderilecekAnahtar) as ValuesPatch).then(settle, () => settle({ ok: false, scenarioId: null, blocked: [] }));
    }, AVAIL_GECIKME_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, gonderilecekAnahtar]);

  const current = avail?.for === gonderilecekAnahtar ? avail.a : null;
  const unrecorded = current !== null && !current.ok;

  const cleanName = normalizeName(taslak.name);
  const cleanCities = taslak.cities.map(normalizeName);
  const invalid = codePoints(cleanName) > MAX_WORLD_NAME || cleanCities.some((c) => codePoints(c) > MAX_CITY_NAME);

  let reason: CopyKey | null = null;
  if (phase === "busy") reason = "kurucu.baslat_bekle";
  else if (cleanName === "") reason = "kurucu.baslat_neden";
  else if (invalid) reason = "kurucu.baslat_neden_gecersiz";
  else if (info !== null && !template) reason = "kurucu.baslat_neden_sablon"; // seçilebilir şablon yoksa `templateId: ""` gitmez
  else if (unrecorded) reason = isLive ? "kurucu.baslat_neden_kayitsiz.live" : "kurucu.baslat_neden_kayitsiz";
  const reasonId = `${uid}-neden`;

  // Son adımda "Devam" kalkınca odak sayfa gövdesine düşmesin: Geri düğmesine taşınır.
  const sonAdim = konum === sira.length - 1;
  useEffect(() => {
    if (sonAdim && document.activeElement === document.body) document.getElementById(`${uid}-geri`)?.focus();
  }, [sonAdim, uid]);

  const run = async () => {
    if (busy.current || reason !== null) return;
    busy.current = true;
    setPhase("busy");
    try {
      const handle = await source.start({
        name: cleanName,
        cityNames: cleanCities,
        templateId: template?.id ?? "",
        durationWeeks: sure,
        seedIndex,
        values: gonderilecek,
        goals: hedefler,
        ...(dunyaSenaryosu ? { worldScenarioId: dunyaSenaryosu, ...(dunyaSenaryosu === OZEL_SENARYO ? { worldScenarioValues: ozelDunya } : {}) } : {}),
      });
      if (!alive.current) return;
      temizle();
      rehberKosuIsaretle(handle.runId, rehberli);
      adopt(handle);
      go({ name: "canli", runId: handle.runId });
    } catch (e) {
      if (alive.current) {
        setHataAnahtari(baslatHataAnahtari(e));
        setPhase("error");
      }
    } finally {
      busy.current = false;
    }
  };

  if (infoFailed) return <Hata retry={retry} />;
  if (info === null) return <Yukleniyor />;

  const rules = registry ? [] : info.fixedRules.filter((r) => isSettingId(r.settingId));
  // Editör tabandan farklı değerleri yama olarak saklar; editörün düzenlemediği (kural olmayan) kayıtlı değerler korunur.
  const kuralDegil = (id: string): boolean => !registry?.cards.some((c) => c.id === id && isKural(c));
  const sartTaslagi = taban ? { ...taban, ...suzulmus.kept } : null;
  const sartaYaz = (next: ValuesPatch) => {
    if (!registry || !taban) return;
    // Yalnız kural kartlarının farkı yazılır; kural dışı (şablonun B/C/Y) değerlere dokunulmaz.
    // Süzülen kural kartı değerleri de korunur (bilgi bandındaki sayı değişmez; yalnız "Süzülenleri at" düşürür).
    const korunan = Object.fromEntries(Object.entries(taslak.values).filter(([id]) => kuralDegil(id) || suzulmus.dropped.includes(id)));
    const yeni = Object.fromEntries(sartFarki(registry, taban, next).filter((d) => !kuralDegil(d.id)).map((d) => [d.id, d.to]));
    guncelle({ values: { ...korunan, ...yeni } });
  };
  // Özet: şablondan farklı kural kartları (süzülenler gönderilmediği için sayılmaz).
  const ozetKurallari = registry && taban
    ? sartFarki(registry, taban, { ...taban, ...suzulmus.kept }).flatMap((d) => {
        const c = registry.cards.find((x) => x.id === d.id);
        return c && isKural(c) ? [{ id: c.id, ad: c.title, deger: degerMetni(registry, c, d.to) }] : [];
      })
    : [];
  const sonraki = konum < sira.length - 1 ? adimAdi(sira[konum + 1]!) : null;
  const turuBitir = (): void => {
    turGorulduYaz();
    setTurAdim(null);
  };
  const rehberiAtla = (): void => {
    setStep(0);
    setTurAdim(null);
    go({ name: "kurucu" });
  };
  const kartMetni = dunyaKarti ? [dunyaKarti.what, dunyaKarti.changes].filter((x) => x) : [];
  const dunyaMetni = kartMetni.length > 0 ? kartMetni : [t("kurucu.dunya_ipucu")];

  return (
    <Stack gap="24">
      <Stack gap="8" direction="row" wrap align="center">
        <h2 className={styles.baslik}>{t(rehberli ? "rehber.baslik" : "kurucu.baslik")}</h2>
        {rehberli ? (
          <Button variant="secondary" size="sm" onClick={rehberiAtla}>
            {t("rehber.atla")}
          </Button>
        ) : null}
      </Stack>
      {rehberli ? <Banner tone="neutral">{t("rehber.bilgi")}</Banner> : null}
      <Banner tone="neutral">{t(isLive ? "kurucu.kayit_notu.live" : "kurucu.kayit_notu.replay")}</Banner>

      <nav aria-label={t("kurucu.adim.nav")}>
        <Stepper
          steps={sira.map((n, i) => ({
            label: t(adimAdi(n)),
            state: n === step ? "current" : i < konum ? "done" : "todo",
            onSelect: () => setStep(n),
          }))}
        />
      </nav>

      {step === 0 ? <Adim0Adlandir taslak={taslak} guncelle={guncelle} randomSource={randomSource} {...(info.world ? { world: info.world } : {})} canli={isLive} /> : null}
      {step === 1 && rehberli ? <Adim0Adlandir taslak={taslak} guncelle={guncelle} randomSource={randomSource} {...(info.world ? { world: info.world } : {})} canli={isLive} /> : null}
      {step === 1 ? (
        <Adim1Sablon
          kartlar={kartlar}
          seciliId={seciliKart?.id}
          onSec={(id) => guncelle({ templateId: id, values: {} })}
          gecis={gecis}
          onGecis={(v) => guncelle({ values: { ...taslak.values, gecis_destegi: v } })}
          availability={current ?? PENDING}
          eskiOlcum={!isLive}
        />
      ) : null}
      {step === 2 ? (
        <>
          <p className={styles.metin}>{t(registry ? "sart.giris" : "kurucu.adim2.giris_kilitli")}</p>
          {!isLive && taslak.worldScenarioId !== null && taslak.worldScenarioId !== GERCEKCI_SENARYO ? <Banner tone="neutral">{t("karar.senaryo_dustu")}</Banner> : null}
          {suzulmus.dropped.length > 0 ? (
            <Stack gap="8" align="start">
              <Banner tone="warn">{t("sart.suzulen", { n: suzulmus.dropped.length })}</Banner>
              <Button variant="secondary" size="sm" onClick={() => guncelle({ values: suzulmus.kept })}>
                {t("sart.suzulen_at")}
              </Button>
            </Stack>
          ) : null}
          {registry && taban && sartTaslagi && turListesi.length > 0 && turAdim === null ? (
            <Button variant="secondary" size="sm" onClick={() => setTurAdim(0)}>
              {t("rehber.tur.baslat")}
            </Button>
          ) : null}
          {registry && taban && sartTaslagi ? (
            <Adim2Sart uzmanGizli={rehberli} uzmanAcik={uzmanAcik} registry={registry} base={taban} draft={sartTaslagi} onDraft={sartaYaz} settings={info.settings} durationWeeks={sure} availability={current ?? PENDING}
              onizleme={{
                config: {
                  name: cleanName, cityNames: cleanCities, templateId: template?.id ?? "", durationWeeks: sure, seedIndex,
                  ...(dunyaSenaryosu ? { worldScenarioId: dunyaSenaryosu, ...(dunyaSenaryosu === OZEL_SENARYO ? { worldScenarioValues: ozelDunya } : {}) } : {}),
                },
                baseValues: Object.fromEntries(Object.entries(gonderilecek).filter(([id]) => kuralDegil(id))) as ValuesPatch,
              }}
              dunya={{
                scenarioId: dunyaSenaryosu, values: taslak.worldScenarioValues,
                onChange: (n) => guncelle({ worldScenarioId: n.scenarioId, worldScenarioValues: n.values }),
                ...(isLive ? {} : { kilit: "insanlar.kilit_kayit" as const }),
              }}
              yDegerler={{ dunya_tohumu: seedIndex }} />
          ) : null}
        </>
      ) : null}
      {step === 3 ? (
        <Adim3SureHedef
          sureler={sureSecenekleri} sure={sure} onSure={(hafta) => guncelle({ durationWeeks: hafta })}
          dunyalar={dunyalar} dunya={seedIndex} onDunya={(index) => guncelle({ seedIndex: index })} dunyaMetni={dunyaMetni}
          hedefler={hedefler} onHedefler={(v: GoalId[]) => guncelle({ goals: v })} {...(hedefKilit ? { hedefKilit } : {})}
        />
      ) : null}
      {step === 4 ? (
        <Adim4Baslat
          kurallar={ozetKurallari} sablon={seciliKart?.ad ?? ""} senaryo={registry ? senaryoAdi(registry, dunyaSenaryosu) : t("senaryo.gercekci_ad")}
          sure={sure} dunya={dunyaEtiket(seedIndex)} hedefler={hedefKilit ? [hedefKilit] : hedefler.map((g) => t(`kurucu.hedef.${g}`, { n: sure }))}
          suzulen={suzulmus.dropped.length} sabitKurallar={rules} canli={isLive}
        />
      ) : null}

      {rehberli && sonAdim ? <p className={styles.metin}>{t("rehber.baslat_not")}</p> : null}

      <Stack gap="8" direction="row" wrap>
        <Button id={`${uid}-geri`} variant="secondary" disabled={konum === 0} onClick={() => setStep(sira[Math.max(0, konum - 1)]!)}>
          {t("kurucu.geri")}
        </Button>
        {sonraki !== null ? (
          <Button variant="secondary" onClick={() => setStep(sira[konum + 1]!)}>
            {t("kurucu.devam", { ad: t(sonraki) })}
          </Button>
        ) : null}
      </Stack>

      <Stack gap="10" align="start">
        <Button variant="primary" disabled={reason !== null} aria-describedby={reason !== null ? reasonId : undefined} onClick={() => void run()}>
          {t("kurucu.baslat")}
        </Button>
        {reason !== null ? (
          <p id={reasonId} className={styles.neden}>
            {t(reason)}
          </p>
        ) : null}
        {phase === "error" ? (
          <div role="alert">
            <Hata retry={() => void run()} messageKey={hataAnahtari} />
          </div>
        ) : null}
      </Stack>
      {turAdim !== null && registry && taban && sartTaslagi && turListesi.length > 0 ? (
        <Tur
          registry={registry} adimlar={turListesi} adim={turAdim} onAdim={setTurAdim} base={taban} draft={sartTaslagi} onDraft={sartaYaz}
          settings={info.settings} durationWeeks={sure} availability={current ?? PENDING}
          onBitir={turuBitir} onOyna={() => { turuBitir(); setStep(4); }}
        />
      ) : null}
    </Stack>
  );
}
