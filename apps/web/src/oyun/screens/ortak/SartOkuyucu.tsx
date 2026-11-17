"use client";
import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { cx } from "@/components/primitives/cx";
import { t } from "@/oyun/copy/t";
import { formatValue } from "@/oyun/sim/formatValue";
import { same } from "@/oyun/sim/hints";
import type { Registry, RegistryCard, RunState, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { Banner } from "@/oyun/ui/Banner";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { Rozet } from "@/oyun/ui/Rozet";
import styles from "./SartOkuyucu.module.css";

/** Sözleşme: `versions[].values` TAM değer kümesidir (yama değil); eksik kart yine de varsayılanda okunur. */
type Surum = { version: number; fromWeek: number; values: ValuesPatch };

const esit = (c: RegistryCard, a: UIValue, b: UIValue): boolean => same(c.kind, a, b);

const degerOf = (c: RegistryCard, v: ValuesPatch): UIValue => (c.id in v ? v[c.id]! : c.default);

/** Satır başına canlılık rozeti metni (kartın `apply`'ından): canlı, yeni koşuda, doğrulanmadı, modelde yok. */
function canlilik(c: RegistryCard): string {
  if (c.status === "passive") return t("rozet.passive");
  switch (c.apply) {
    case "live":
    case "live_sync": return t("okuyucu.rozet_live");
    case "start_only": return t("okuyucu.rozet_start_only");
    case "passive": return t("rozet.passive");
    case "unknown": return t("okuyucu.rozet_unknown");
  }
}

/** `no`: kataloğun tam sırasındaki 1 tabanlı numara (boş grup süzülse de kaymaz); "Diğer" ve prototipin `gi < 14` sınırı dışı numarasız başlık alır. */
type Bolum = { id: string; baslik: string; kartlar: RegistryCard[]; no: number; basliktaNo: boolean };
const NUMARALI_GRUP_SINIRI = 14;
/** Kartlar kayıttaki grup sırasıyla; grubu bilinmeyen kartlar sona "Diğer" altına. */
function bolumler(reg: Registry): Bolum[] {
  const gruplar = [...reg.groups].sort((a, b) => a.order - b.order);
  const out: Bolum[] = gruplar.map((g, i) => ({ id: g.id, baslik: g.title, kartlar: reg.cards.filter((c) => c.group === g.id), no: i + 1, basliktaNo: i < NUMARALI_GRUP_SINIRI }));
  const bilinen = new Set(gruplar.map((g) => g.id));
  const artik = reg.cards.filter((c) => !bilinen.has(c.group));
  if (artik.length > 0) out.push({ id: "diger", baslik: t("okuyucu.diger"), kartlar: artik, no: gruplar.length + 1, basliktaNo: false });
  return out.filter((b) => b.kartlar.length > 0);
}

/** Koşunun dünya senaryosunun adı: kayıttaki başlık, yoksa kimlik, o da yoksa "varsayılan". */
export function senaryoAdi(state: RunState, registry: Registry | null): string {
  const id = state.worldScenarioId;
  if (id === undefined) return t("ustcubuk.dunya_varsayilan");
  return registry?.scenarios.find((x) => x.id === id)?.title ?? id;
}

/** Şart okuyucusu: sürüm seç, değerleri oku, önceki sürümle farkı göster. Veri `RunState.versions`'tan gelir. */
export function SartOkuyucu({ state, onKapat }: { state: RunState; onKapat(): void }) {
  const { registry, error } = useRegistry();
  const surumler: Surum[] = state.versions && state.versions.length > 0 ? state.versions : [{ version: state.version, fromWeek: 0, values: state.values }];
  const [secili, setSecili] = useState<number>(state.version);
  const [fark, setFark] = useState(false);
  const idx = Math.max(0, surumler.findIndex((s) => s.version === secili));
  const cur = surumler[idx]!;
  const onceki = idx > 0 ? surumler[idx - 1]! : null;
  const farkAcik = fark && onceki !== null;

  const baslik = t("okuyucu.baslik", { ad: state.name === "" ? t("ustcubuk.adsiz") : state.name, n: cur.version, hafta: cur.fromWeek });

  /** Değerin yürürlüğe girdiği hafta: sürüm zincirinde son değişiklik. */
  const yururluk = (c: RegistryCard): number => {
    let w = surumler[0]!.fromWeek;
    for (let i = 1; i <= idx; i += 1) if (!esit(c, degerOf(c, surumler[i]!.values), degerOf(c, surumler[i - 1]!.values))) w = surumler[i]!.fromWeek;
    return w;
  };

  return (
    <Diyalog baslik={baslik} onKapat={onKapat}>
      <div className={styles.ust}>
        <span className={styles.etiket}>{t("okuyucu.surum")}</span>
        <div role="group" aria-label={t("okuyucu.surum_grup")} className={styles.grup}>
          {surumler.map((s) => (
            <Button key={s.version} variant="toggle" size="sm" pressed={s.version === cur.version} onClick={() => setSecili(s.version)}>
              {t("okuyucu.surum_dugme", { n: s.version })}
            </Button>
          ))}
        </div>
        <Button variant="toggle" size="sm" pressed={farkAcik} disabled={onceki === null} onClick={() => setFark(!fark)}>
          {onceki === null ? t("okuyucu.ilk_surum") : farkAcik ? t("okuyucu.tam_metin") : t("okuyucu.fark_ac", { a: onceki.version, b: cur.version })}
        </Button>
      </div>
      <Banner tone="neutral">{t("okuyucu.senaryo", { ad: senaryoAdi(state, registry) })}</Banner>
      {error ? <Banner tone="warn">{t("okuyucu.hata")}</Banner> : registry === null ? <p role="status">{t("okuyucu.yukleniyor")}</p> : farkAcik && onceki ? (
        <FarkListesi registry={registry} cur={cur} onceki={onceki} />
      ) : (
        <Stack gap="16">
          {bolumler(registry).map((b) => (
            <section key={b.id} className={styles.bolum} aria-labelledby={`okuyucu-${b.id}`}>
              <h3 id={`okuyucu-${b.id}`} className={styles.bolumBaslik}>
                {b.basliktaNo ? t("okuyucu.grup", { n: b.no, ad: b.baslik }) : b.baslik}
              </h3>
              <ul className={styles.liste}>
                {b.kartlar.map((c, k) => {
                  const degisen = !esit(c, degerOf(c, cur.values), c.default);
                  return (
                    <li key={c.id} className={cx(styles.satir, degisen && styles.degisen)}>
                      <span>
                        <span className={styles.not}>{t("okuyucu.no", { g: b.no, k: k + 1 })}</span> {c.title}
                        {degisen ? <span className={styles.etiketDegisen}>{t("okuyucu.degisen")}</span> : null}
                        {c.status === "experimental" ? <> <Rozet kind="experimental" /></> : null}
                      </span>
                      <span className={styles.deger}>{formatValue(c.control, degerOf(c, cur.values), registry.units)}</span>
                      <span className={styles.not}>
                        <span className={styles.canlilik}>{canlilik(c)}</span> {t("okuyucu.yururluk", { hafta: yururluk(c) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Stack>
      )}
    </Diyalog>
  );
}

function FarkListesi({ registry, cur, onceki }: { registry: Registry; cur: Surum; onceki: Surum }) {
  const degisenler = registry.cards.filter((c) => !esit(c, degerOf(c, cur.values), degerOf(c, onceki.values)));
  return (
    <section className={styles.bolum} aria-labelledby="okuyucu-fark">
      <h3 id="okuyucu-fark" className={styles.bolumBaslik}>
        {t("okuyucu.fark_baslik", { a: onceki.version, b: cur.version, hafta: cur.fromWeek })}
      </h3>
      {degisenler.length === 0 ? (
        <p className={styles.bilgi}>{t("okuyucu.fark_yok")}</p>
      ) : (
        <ul className={styles.liste}>
          {degisenler.map((c, k) => (
            <li key={c.id} className={cx(styles.satir, styles.degisen)}>
              <span>
                <span className={styles.not}>{t("okuyucu.fark_no", { n: k + 1 })}</span> {c.title}
              </span>
              <span className={styles.deger}>{t("okuyucu.fark_deger", { eski: formatValue(c.control, degerOf(c, onceki.values), registry.units), yeni: formatValue(c.control, degerOf(c, cur.values), registry.units) })}</span>
              <span className={styles.not}>{t("okuyucu.hafta_kisa", { hafta: cur.fromWeek })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
