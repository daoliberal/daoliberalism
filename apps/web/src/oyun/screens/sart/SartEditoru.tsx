"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { t } from "@/oyun/copy/t";
import { numberText } from "@/oyun/sim/formatValue";
import type { Availability, Registry, RegistryCard, SettingAvail, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { ButceSirasi } from "./ButceSirasi";
import { CanliOzet, type OnizlemeBaglami } from "./CanliOzet";
import { DegisenSeridi } from "./DegisenSeridi";
import { FaizHesaplayici } from "./FaizHesaplayici";
import { FonUyarisi } from "./FonUyarisi";
import { DunyaHesabi } from "./DunyaHesabi";
import { NufusOzeti } from "./NufusOzeti";
import { GrupGezinme } from "./GrupGezinme";
import { Insanlar, senaryoAdi, type DunyaBaglami } from "@/oyun/screens/insanlar/Insanlar";
import { aktorGruplari, insanKartlari } from "@/oyun/screens/insanlar/insanlarMantik";
import { Piyasa, PIYASA_KATMANI, piyasaKartlari, type PiyasaVerisi } from "@/oyun/screens/piyasa/Piyasa";
import { nufusHesabi, NPC_KARTI } from "@/oyun/sim/nufus";
import { sekmeKimligi, sekmePaneliKimligi } from "@/oyun/ui/Sekmeler";
import { KatmanSekmeleri, type KatmanKimligi } from "./KatmanSekmeleri";
import { katmanAra } from "./aramaMantik";
import { KuralAra } from "./KuralAra";
import { KrediTurleri, type KrediVaryanti } from "./KrediTurleri";
import { kartKimligi, KuralListesi, type KartEki } from "./KuralListesi";
import { fonKapali, KURULUS_FONU_KARTI, KURULUS_KREDISI_KARTI, tutarlilikUyarilari } from "./ozelMantik";
import { SabitKalemler } from "./SabitKalemler";
import { TutarlilikUyarilari } from "./TutarlilikUyarilari";
import { degisebilir, gonderilebilirMi, isKural, KURAL_KATMANI, kartDurumu, sartFarki, sartGruplari, type KartDurumu, type SartKipi } from "./sartMantik";
import styles from "./Sart.module.css";

export type SartEditoruProps = {
  /** `builder`: Kurucu'da koşu başlarken; `live`: koşu ortasında (`start_only` kartlar kilitli). */
  mode: SartKipi;
  registry: Registry;
  /** Karşılaştırma tabanı: şablonun (ya da koşunun şu anki) değerleri; her kart için değer. */
  base: ValuesPatch;
  /** Taslağın tamamı (kart kimliği -> değer); eksik kart varsayılandadır. */
  draft: ValuesPatch;
  onDraft(next: ValuesPatch): void;
  context: { runId?: string; week?: number; durationWeeks: number };
  /** Kaynağın kart başına bildirdiği kilit nedenleri (`SourceInfo.settings`); verilmezse yalnız kayıttaki `apply` ve `status` geçerlidir. */
  settings?: SettingAvail[];
  /** Geçiş desteği kartının kullanılabilirlik bilgisi (Kurucu: kayıtsız birleşim uyarısı). */
  gecis?: { availability: Availability };
  /** Etki önizlemesi bağlamı (koşunun kimliği ve ortak değerler); verilmezse önizleme bu bağlamda kullanılamaz. */
  onizleme?: OnizlemeBaglami;
  /** B katmanı: dünya senaryosu (Şart'a girmez). Verilmezse insanlar salt okunur ve senaryo seçilemez. */
  dunya?: DunyaBaglami;
  /** C katmanı: koşunun başlangıç ve son piyasası; verilmezse "Koşu başlayınca görünür". */
  piyasa?: PiyasaVerisi;
  /** Dünya kuralları (Y) kartlarının koşudaki değerleri (ör. başlangıç dünyası); yoksa modelin varsayılanı yazılır. */
  yDegerler?: ValuesPatch;
  /** Açılışta ilgili kartı açıp odaklar (ör. rehberli oyunun "Bu kuralı değiştir" eylemi); kayıtta olmayan kimlik yok sayılır. */
  odakKart?: string;
  /** Uzman düzeyi (`level: "U"`) kartlar hiç gösterilmez (rehberli ilk oyun). */
  uzmanGizli?: boolean;
  /** Uzman ayarları açık başlar (sonuç ekranındaki "Uzman ayarlarını aç"). */
  uzmanAcik?: boolean;
};

/** D7 açılış kartları (deneysel, kuruluşta): bunlar kayıtta varsa canlı açılış hesabı gösterilir. */
const ACILIS_KARTLARI = ["baslangic_istihdami"] as const;
const NO_SETTINGS: SettingAvail[] = [];
const NO_VALUES: ValuesPatch = {};

/**
 * Şart editörü çekirdeği: A katmanı (Kurallar) kartları gruplara bölünmüş, aranabilir, değişenler şeritte.
 * Kurucu'da ve (W8'de) "Şartı değiştir" panelinde aynı bileşendir; durum dışarıdadır (`draft`/`onDraft`).
 */
export function SartEditoru({ mode, registry, base, draft, onDraft, context, settings = NO_SETTINGS, gecis, onizleme, dunya, piyasa, yDegerler = NO_VALUES, odakKart, uzmanGizli = false, uzmanAcik = false }: SartEditoruProps) {
  const uid = useId();
  const gruplar = useMemo(() => {
    const hepsi = sartGruplari(registry, t("sart.grup_diger"));
    return uzmanGizli ? hepsi.map((g) => ({ ...g, cards: g.cards.filter((c) => c.level !== "U") })).filter((g) => g.cards.length > 0) : hepsi;
  }, [registry, uzmanGizli]);
  const [grupId, setGrupId] = useState<string>(() => gruplar[0]?.id ?? "");
  const [uzman, setUzman] = useState(uzmanAcik && !uzmanGizli);
  const [query, setQuery] = useState("");
  const [secili, setSecili] = useState<string | null>(null);
  const [odak, setOdak] = useState<{ id: string; n: number } | null>(null);
  // Kendi kredi varyantı taslakları: modelde karşılığı yok; yalnız burada durur, taslağa ve koşuya hiç girmez.
  const [varyantlar, setVaryantlar] = useState<KrediVaryanti[]>([]);
  const [duyuru, setDuyuru] = useState("");
  const [katman, setKatman] = useState<KatmanKimligi>("kurallar");
  const [aktorId, setAktorId] = useState<string>("");
  const mevcutKatmanlar = useMemo<KatmanKimligi[]>(
    () => ["kurallar", ...(insanKartlari(registry).length > 0 ? (["insanlar"] as const) : []), ...(piyasaKartlari(registry).length > 0 ? (["piyasa"] as const) : [])],
    [registry],
  );

  const grup = gruplar.find((g) => g.id === grupId) ?? gruplar[0];
  const farklar = useMemo(
    () =>
      sartFarki(registry, base, draft).filter((d) => {
        const c = registry.cards.find((x) => x.id === d.id);
        return c !== undefined && isKural(c) && gonderilebilirMi(c, mode, settings.find((x) => x.id === d.id));
      }),
    [registry, base, draft, mode, settings],
  );
  const toplam = useMemo(() => gruplar.reduce((n, g) => n + g.cards.length, 0), [gruplar]);
  const degisenSayisi = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of gruplar) out[g.id] = g.cards.filter((c) => farklar.some((d) => d.id === c.id)).length;
    return out;
  }, [gruplar, farklar]);
  const arama = useMemo(() => katmanAra(registry, gruplar, query), [registry, gruplar, query]);
  const uyarilar = useMemo(() => tutarlilikUyarilari(registry, draft), [registry, draft]);
  const varyantEkle = useCallback((kaynakId: string) => {
    const kaynak = registry.cards.find((c) => c.id === kaynakId);
    if (!kaynak) return;
    const ad = t("sart.kredi.varyant_ad_varsayilan", { tur: kaynak.title });
    setVaryantlar((v) => [...v, { id: `v${v.length}-${kaynakId}-${Date.now()}`, kaynak: kaynakId, ad }]);
    setDuyuru(t("sart.kredi.varyant_eklendi", { ad }));
  }, [registry]);

  const git = (id: string) => {
    const hedef = registry.cards.find((c) => c.id === id);
    if (hedef && hedef.layer !== KURAL_KATMANI) {
      // dünyanın insanları (aktör sekmesi), dünya kuralları (Y) ya da piyasa: katmanı aç, sonra karta odaklan
      const aktor = aktorGruplari(registry).find((a) => a.cards.some((c) => c.id === id));
      setKatman(hedef.layer === PIYASA_KATMANI ? "piyasa" : "insanlar");
      if (aktor) setAktorId(aktor.id);
      setQuery("");
      setOdak((p) => ({ id, n: (p?.n ?? 0) + 1 }));
      return;
    }
    const g = gruplar.find((x) => x.cards.some((c) => c.id === id));
    const card = g?.cards.find((c) => c.id === id);
    if (!g || !card) return;
    setKatman("kurallar");
    setGrupId(g.id);
    if (card.level === "U") setUzman(true);
    setSecili(id);
    setQuery("");
    setOdak((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  };

  // Dışarıdan istenen kart: istek değişince (ilk çizimde de) o karta gidilir; çizim sırasında durum ayarı, `odak` etkisi kartı çizildikten sonra odaklar.
  const [istenenKart, setIstenenKart] = useState<string | undefined>(undefined);
  if (odakKart !== istenenKart) {
    setIstenenKart(odakKart);
    if (odakKart !== undefined) git(odakKart);
  }

  // Karta gidildiyse (arama ya da şerit) kart çizildikten sonra görünür kılınır ve odak alır.
  useEffect(() => {
    if (!odak) return;
    const el = document.getElementById(kartKimligi(uid, odak.id));
    if (!el) return;
    el.scrollIntoView?.({ block: "center" });
    // Odak kartın başlığına (adı ve rolü olan öğe) gider; ekran okuyucu kartı duyurur.
    const baslik = el.querySelector<HTMLElement>("h3, h4");
    (baslik ?? el).focus({ preventScroll: true });
  }, [odak, uid]);

  // Kilitli, pasif ve salt okunur kartın değeri taslağa hiç yazılmaz (denetim kapalı olsa da son savunma).
  const yazilabilir = (id: string): RegistryCard | null => {
    const card = registry.cards.find((c) => c.id === id);
    return card && degisebilir(kartDurumu(card, mode, settings.find((s) => s.id === id)), card) ? card : null;
  };
  const set = (id: string, v: UIValue) => {
    if (yazilabilir(id)) onDraft({ ...draft, [id]: v });
  };
  const reset = (id: string) => {
    const card = yazilabilir(id);
    if (card) onDraft({ ...draft, [id]: id in base ? base[id]! : card.default });
  };

  const fonUyarisiGoster = fonKapali(registry, draft) && registry.cards.some((c) => c.id === KURULUS_KREDISI_KARTI && gonderilebilirMi(c, mode, settings.find((s) => s.id === c.id)));
  /** Özel bölümlerin kart eklentisi: bütçe kalemleri üyelik listesi olarak çizilir. */
  const kartEki = (card: RegistryCard, _durum: KartDurumu, value: UIValue): KartEki | undefined => {
    const c = card.control;
    if (card.id === NPC_KARTI) {                      // D4: NPC kartında toplam oyuncu, NPC ve nüfus canlı hesaplanır (taslaktaki değerlerle)
      const n = nufusHesabi(registry, draft);
      return n ? { alt: <p className={styles.durum} role="status">{t("sart.nufus.hesap", { oyuncu: numberText(n.oyuncu), npc: numberText(n.npc), toplam: numberText(n.toplam) })}</p> } : undefined;
    }
    if (card.id !== "gider_onceligi" || (c.type !== "order" && c.type !== "multi")) return undefined;
    const liste = Array.isArray(value) ? value : [];
    return {
      kontrol: ({ disabled, labelledBy, describedBy }) => (
        <ButceSirasi kind={card.kind} control={c} value={liste} disabled={disabled} labelledBy={labelledBy} {...(describedBy ? { describedBy } : {})} onChange={(v) => set(card.id, v)} />
      ),
    };
  };
  const ortak = {
    uid, registry, base, draft, mode, settings, durationWeeks: context.durationWeeks, seciliId: secili, onChange: set, onReset: reset,
    ...(gecis ? { gecis } : {}),
  };
  const onek = `${uid}-katman`;
  const aktifKatman = mevcutKatmanlar.includes(katman) ? katman : "kurallar";
  const dunyaAdi = registry.scenarios.length > 0 ? senaryoAdi(registry, dunya?.scenarioId ?? null) : undefined;
  return (
    <section className={styles.editor} aria-label={t("sart.editor")}>
      <KatmanSekmeleri onek={onek} mevcut={mevcutKatmanlar} secili={aktifKatman} onSec={setKatman} />
      <div role="tabpanel" id={sekmePaneliKimligi(onek)} aria-labelledby={sekmeKimligi(onek, aktifKatman)} className={styles.panel}>
        <DegisenSeridi registry={registry} toplam={toplam} degisenler={farklar} onGit={git} {...(dunyaAdi ? { dunyaAdi, onDunya: () => setKatman("insanlar") } : {})} />
        <KuralAra query={query} onQuery={setQuery} results={arama.results} total={arama.total} onGit={git} />
        {aktifKatman === "insanlar" ? (
          <Insanlar registry={registry} sart={draft} kimlik={(id) => kartKimligi(uid, id)} aktorId={aktorId} onAktor={setAktorId} durationWeeks={context.durationWeeks} yDegerler={yDegerler} {...(dunya ? { dunya } : {})} />
        ) : aktifKatman === "piyasa" ? (
          <Piyasa registry={registry} kimlik={(id) => kartKimligi(uid, id)} {...(piyasa ? { veri: piyasa } : {})} />
        ) : (
        <>
        {grup ? (
          <>
            <GrupGezinme gruplar={gruplar} secili={grup.id} degisenSayisi={degisenSayisi} onSec={(id) => { setGrupId(id); setSecili(null); }} />
            <h3 className={styles.grupBaslik}>{t("sart.grup", { n: gruplar.indexOf(grup) + 1, ad: grup.title })}</h3>
            {grup.id === "para_faiz" ? <FaizHesaplayici registry={registry} draft={draft} /> : null}
            {grup.id === "kredi" ? (
              <KrediTurleri
                {...ortak} cards={uzman ? grup.cards : grup.cards.filter((c) => c.level !== "U")} varyantlar={varyantlar}
                onVaryantEkle={varyantEkle} onVaryantAd={(id, ad) => setVaryantlar((v) => v.map((x) => (x.id === id ? { ...x, ad } : x)))}
                onVaryantSil={(id) => setVaryantlar((v) => v.filter((x) => x.id !== id))}
                uzmanSayisi={grup.cards.filter((c) => c.level === "U").length} uzmanAcik={uzman} onUzman={() => setUzman((u) => !u)}
                ust={fonUyarisiGoster ? <FonUyarisi onGit={() => git(KURULUS_FONU_KARTI)} /> : undefined}
              />
            ) : grup.id === "sabit_kalemler" ? (
              <SabitKalemler uid={uid} cards={grup.cards} registry={registry} draft={draft} durationWeeks={context.durationWeeks} seciliId={secili} />
            ) : (
              <KuralListesi {...ortak} group={grup} uzmanAcik={uzman} onUzman={() => setUzman((u) => !u)} ek={kartEki} />
            )}
            {grup.id === "dunya" ? <NufusOzeti registry={registry} draft={draft} durationWeeks={context.durationWeeks} /> : null}
            {grup.id === "dunya" && mode === "builder" && onizleme && registry.cards.some((c) => c.id === ACILIS_KARTLARI[0]) ? <DunyaHesabi baglam={onizleme} farklar={farklar} /> : null}
            <p className={styles.durum} role="status">{duyuru}</p>
          </>
        ) : null}
        <CanliOzet
          registry={registry} draft={draft} farklar={farklar} durationWeeks={context.durationWeeks}
          {...(onizleme ? { onizleme } : {})}
        />
        {registry.consistency !== undefined ? <TutarlilikUyarilari uyarilar={uyarilar} onGit={git} /> : null}
        </>
        )}
      </div>
    </section>
  );
}
