"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { MAX_NOT_UZUNLUK } from "@/oyun/lib/sinirlar";
import { useDegistirHedef } from "./degistirDurumu";
import { taslakOf, tarifOf } from "./SifirdanBaslat";
import { kurucuTaslagiYaz } from "@/oyun/screens/kurucu/useKurucuTaslak";
import type { OnizlemeBaglami } from "@/oyun/screens/sart/CanliOzet";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { baglamKilitleri, degerMetni, gonderilebilirMi, isKural, sartFarki, sartTabani, sartYamasi } from "@/oyun/screens/sart/sartMantik";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Availability, ChangeResult, Registry, RunState, SettingAvail, ValuesPatch, WeekPacket } from "@/oyun/sim/types";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { Yukleniyor } from "@/oyun/ui/Durum";
import styles from "./SartiDegistir.module.css";

type Accepted = Extract<ChangeResult, { accepted: true }>;
type Reddedilen = { id: string; reason: Extract<ChangeResult, { accepted: false }>["fields"][number]["reason"] };
type Props = {
  runId: string;
  state: RunState;
  /** Koşunun yayımlanmış haftaları (Piyasa katmanı başlangıç ve şimdiki dünyayı bunlardan okur). */
  weeks: WeekPacket[];
  /** Değişiklik bu sürümün dikiş haftasındayken (aynı hafta ikinci karar) sonuç yine bu sürüm olur. */
  sameVersion: boolean;
  onClose(): void;
  onApplied(result: Accepted): void;
};

/**
 * Etki önizlemesi için koşunun kendi tarifi: ilk sürümün değerleri + sonraki sürümlerin yamaları (takvim). Koşu ortasında (hafta > 0 ve en az bir
 * sürüm kaydı) taslak karar `fromWeek + 1`'den başlar; aksi hâlde önizleme baştan koşar (koşu henüz başlamadıysa ya da sürümler bilinmiyorsa).
 */
export function onizlemeTarifi(state: RunState): Pick<OnizlemeBaglami, "baseValues" | "kosuOrtasi"> {
  const vs = [...(state.versions ?? [])].sort((a, b) => a.version - b.version);
  const ilk = vs[0];
  if (state.week === 0 || ilk === undefined) return { baseValues: { ...state.values } };
  const anahtarlar = Object.keys(state.values);
  const pick = (v: ValuesPatch): ValuesPatch => Object.fromEntries(anahtarlar.filter((k) => k in v).map((k) => [k, v[k]!]));
  const schedule = vs.slice(1).flatMap((v, i) => {
    const onceki = vs[i]!.values;
    const patch = Object.fromEntries(Object.entries(pick(v.values)).filter(([k, x]) => JSON.stringify(onceki[k]) !== JSON.stringify(x)));
    return Object.keys(patch).length > 0 ? [{ week: v.fromWeek, patch }] : [];
  });
  return { baseValues: pick(ilk.values), kosuOrtasi: { fromWeek: Math.min(state.week, state.durationWeeks - 1), schedule } };   // sunucu: önizleme `fromWeek` koşu süresinden küçük olmalı
}

const PENDING: Availability = { ok: true, scenarioId: null, blocked: [] };

/**
 * "Şartı değiştir": koşu duraklatılmışken Şart editörü (aynı bileşen, canlı kip) ve değişenlerin "eski → yeni" listesi.
 * Değişen bütün ayarlar tek yamayla gider (sunucuda atomik): kısmi kabul yoktur, ret nedenleri kart başına gösterilir.
 */
export function SartiDegistir(props: Props) {
  const { info } = useSourceInfo();
  const { state, onClose } = props;
  const registry = info?.registry;
  /** Diyalogun kendi "Kapat" düğmesi ve Esc de içerideki onay kuralından geçer. */
  const kapatRef = useRef<() => void>(onClose);
  const kapatBaslik = () => kapatRef.current();
  return (
    <Diyalog baslik={props.sameVersion ? t("degistir.baslik_ayni", { a: state.version }) : t("degistir.baslik", { a: state.version, b: state.version + 1 })} onKapat={kapatBaslik} kapatMetni={t("degistir.kapat")} disabled={state.computing}>
      {info === null ? (
        <Yukleniyor />
      ) : registry === undefined ? (
        <Banner tone="warn">{t("sart.degistir.kayit_yok")}</Banner>
      ) : (
        <Icerik {...props} kapatRef={kapatRef} registry={registry} settings={info.settings} templateId={info.templates[0]?.id ?? ""} />
      )}
    </Diyalog>
  );
}

function Icerik({ runId, state, weeks, onClose, onApplied, registry, settings: kaynakAyarlari, templateId, kapatRef }: Props & { registry: Registry; settings: SettingAvail[]; templateId: string; kapatRef: { current: () => void } }) {
  const source = useSimSource();
  /** Koşunun kuruluş bağlamından kapalı kartlar (sunucu bildirir) ayarlara işlenir: kart kilitli ve nedenli görünür, yamaya girmez. */
  const settings = useMemo(() => baglamKilitleri(kaynakAyarlari, state.settingLocks), [kaynakAyarlari, state.settingLocks]);
  const { go } = useHashRoute();
  const uid = useId();
  const hedefKart = useDegistirHedef();
  const alive = useRef(false);
  const busy = useRef(false);
  const live = source.kind === "live";
  const base = useMemo(() => sartTabani(registry, state.values), [registry, state.values]);
  const [yama, setYama] = useState<ValuesPatch>({});
  const draft = useMemo(() => ({ ...base, ...yama }), [base, yama]);
  const [note, setNote] = useState("");
  const [onay, setOnay] = useState(false);
  const [avail, setAvail] = useState<{ for: string; a: Availability } | null>(null);
  const [reddedilen, setReddedilen] = useState<Reddedilen[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);

  /** Değişenler "eski → yeni" olarak editörün "değiştirdiğin" şeridinde listelenir (aynı süzgeç). */
  const farklar = useMemo(
    () =>
      sartFarki(registry, base, draft).filter((d) => {
        const c = registry.cards.find((x) => x.id === d.id);
        return c !== undefined && isKural(c) && gonderilebilirMi(c, "live", settings.find((x) => x.id === d.id) ?? undefined);
      }),
    [registry, base, draft, settings],
  );
  const gonderilecek = useMemo(() => Object.fromEntries(farklar.map((d) => [d.id, d.to])) as ValuesPatch, [farklar]);
  const anahtar = JSON.stringify(gonderilecek);
  const degisti = farklar.length > 0;
  const locked = state.computing || sending;

  useEffect(() => {
    alive.current = true;
    // Diyalog açılınca koşu duraklar.
    if (state.status === "running") source.control(runId, { action: "pause" }).catch(() => {});
    return () => {
      alive.current = false;
    };
    // yalnız açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!degisti) return;
    let on = true;
    const settle = (a: Availability) => {
      if (on) setAvail({ for: anahtar, a });
    };
    source.availability(JSON.parse(anahtar) as ValuesPatch, runId).then(settle, () => settle({ ok: false, scenarioId: null, blocked: [] }));
    return () => {
      on = false;
    };
  }, [source, anahtar, runId, degisti]);

  const availability: Availability = degisti && avail?.for === anahtar ? avail.a : PENDING;
  const disabled = locked || !degisti || !availability.ok;
  const noDiffId = `${uid}-fark-yok`;

  const istekKapat = () => {
    if (locked) return;
    if (degisti || note.trim() !== "") setOnay(true);
    else onClose();
  };

  useEffect(() => {
    kapatRef.current = istekKapat;
  });

  const uygula = async () => {
    if (busy.current || disabled) return;
    busy.current = true;
    setSending(true);
    setFailed(false);
    setReddedilen(null);
    try {
      const n = note.trim();
      const r = await source.applyChange(runId, { from: "next_week", patch: gonderilecek, ...(n === "" ? {} : { note: n }) });
      if (!alive.current) return;
      if (r.accepted) onApplied(r);
      else if (r.fields.length > 0) setReddedilen(r.fields);
      else setFailed(true);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  };

  const yeniKosu = () => {
    kurucuTaslagiYaz(taslakOf(tarifOf(state), { ...state.values, ...gonderilecek }));
    go({ name: "kurucu", adim: "4" });
  };

  const kartAdi = (id: string): string => registry.cards.find((c) => c.id === id)?.title ?? "";
  const baslangic = state.week === 0;
  const startOnlyVar = live && registry.cards.some((c) => isKural(c) && c.apply === "start_only");
  const sonHafta = weeks[weeks.length - 1];
  const ortaBaglam = onizlemeTarifi(state);

  return (
    <>
      <p className={styles.bilgi}>{t("degistir.bilgi", { n: state.week })}</p>
      {baslangic ? <Banner tone="neutral">{t("sart.degistir.baslangic_sarti")}</Banner> : null}
      {degisti ? (
        <ul className={styles.farklar} aria-label={t("sart.degistir.fark_baslik")}>
          {farklar.map((d) => {
            const c = registry.cards.find((x) => x.id === d.id)!;
            return (
              <li key={d.id} className={styles.fark}>
                {t("degistir.fark", { ad: c.title, eski: degerMetni(registry, c, d.from), yeni: degerMetni(registry, c, d.to) })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p id={noDiffId} className={styles.bilgi}>
          {t("degistir.fark_yok")}
        </p>
      )}
      <SartEditoru
        mode="live" registry={registry} base={base} draft={draft} {...(hedefKart !== null ? { odakKart: hedefKart } : {})} onDraft={(next) => !locked && setYama(sartYamasi(registry, base, next))}
        settings={settings} context={{ runId, week: state.week, durationWeeks: state.durationWeeks }} gecis={{ availability }}
        onizleme={{
          config: {
            name: state.name, cityNames: state.cityNames, templateId, durationWeeks: state.durationWeeks, seedIndex: state.seedIndex,
            ...(state.worldScenarioId ? { worldScenarioId: state.worldScenarioId } : {}),
          },
          ...ortaBaglam,
        }}
        dunya={{ scenarioId: state.worldScenarioId ?? null, values: {}, onChange: () => {}, kilit: "insanlar.kilit_kosu" }}
        piyasa={{ baslangic: weeks[0]?.world ?? null, simdi: sonHafta?.world ?? null, ...(sonHafta ? { week: sonHafta.week } : {}) }}
        yDegerler={{ dunya_tohumu: state.seedIndex }}
      />
      <Field
        id={`${uid}-not`} kind="textarea" label={t("sart.degistir.not_etiket")} value={note} disabled={locked}
        onChange={(e) => setNote(e.target.value)} rows={2} maxLength={MAX_NOT_UZUNLUK}
      />
      {startOnlyVar ? (
        <div className={styles.bolum}>
          <p className={styles.bilgi}>{t("sart.degistir.yeni_kosu_bilgi")}</p>
          <div className={styles.alt}>
            <Button variant="secondary" size="sm" disabled={locked} onClick={yeniKosu}>
              {t("sart.degistir.yeni_kosu")}
            </Button>
          </div>
        </div>
      ) : null}
      {reddedilen ? (
        <Banner tone="warn">
          <p>{t("sart.degistir.red_baslik")}</p>
          <ul className={styles.redler}>
            {reddedilen.map((f, i) => {
              const neden = t(`sart.degistir.red.${f.reason}` as CopyKey);
              return <li key={`${f.id}-${i}`}>{kartAdi(f.id) === "" ? neden : t("sart.degistir.red_kart", { ad: kartAdi(f.id), neden })}</li>;
            })}
          </ul>
        </Banner>
      ) : null}
      {failed ? <Banner tone="warn">{t("degistir.hata_genel")}</Banner> : null}
      {onay ? (
        <Banner tone="warn">
          <p>{t("sart.degistir.kapat_onay")}</p>
          <div className={styles.alt}>
            <Button variant="primary" size="sm" onClick={onClose}>
              {t("sart.degistir.kapat_at")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOnay(false)}>
              {t("sart.degistir.kapat_don")}
            </Button>
          </div>
        </Banner>
      ) : null}
      <div className={styles.alt}>
        <Button variant="primary" size="sm" disabled={disabled} aria-describedby={degisti ? undefined : noDiffId} onClick={() => void uygula()}>
          {t(live ? "degistir.uygula_live" : "degistir.uygula", { n: state.week + 1 })}
        </Button>
      </div>
    </>
  );
}
