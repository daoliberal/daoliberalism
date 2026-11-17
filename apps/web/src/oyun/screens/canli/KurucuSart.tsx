import { t } from "@/oyun/copy/t";
import { formatValue } from "@/oyun/sim/formatValue";
import { same } from "@/oyun/sim/hints";
import type { Registry, RegistryCard, RunState, UIValue } from "@/oyun/sim/types";
import { senaryoAdi } from "@/oyun/screens/ortak/SartOkuyucu";
import { KosuEylemleri, type KosuEylemleriProps } from "./KosuEylemleri";
import stil from "./KurucuSart.module.css";

/** Sol panelde en çok bu kadar "varsayılandan farklı kural" listelenir; tamamı Şart okuyucusundadır. */
const KURAL_SINIRI = 8;

type Props = { state: RunState; registry: Registry | null; kosu: Omit<KosuEylemleriProps, "eylemler" | "state"> | null };

const degerOf = (c: RegistryCard, v: RunState["values"]): UIValue => (c.id in v ? v[c.id]! : c.default);

/** Sol panelin içeriği "Şart": koşunun sürümü, dünya senaryosu, süre ve varsayılandan farklı kurallar. Eylemler en altta. */
export function KurucuSart({ state, registry, kosu }: Props) {
  const farkli = registry === null ? [] : registry.cards.filter((c) => c.status !== "passive" && !same(c.kind, degerOf(c, state.values), c.default));
  const gorunen = farkli.slice(0, KURAL_SINIRI);
  const satir = (etiket: string, deger: string, alt?: string) => (
    <div key={etiket} className={stil.satir}>
      <dt className={stil.etiket}>
        {etiket}
        {alt ? <span className={stil.alt}>{alt}</span> : null}
      </dt>
      <dd className={stil.deger}>{deger}</dd>
    </div>
  );
  return (
    <div className={stil.kok}>
      <dl className={stil.liste} aria-label={t("kurucu.sart.ozet")}>
        {satir(t("kurucu.sart.surum"), t("kurucu.sart.surum_deger", { n: state.version }))}
        {satir(t("kurucu.sart.dunya"), senaryoAdi(state, registry))}
        {satir(t("kurucu.sart.sure"), t("kurucu.sart.sure_deger", { n: state.durationWeeks }))}
      </dl>
      <section aria-label={t("kurucu.sart.farkli")} className={stil.farkli}>
        <h3 className={stil.altBaslik}>{t("kurucu.sart.farkli")}</h3>
        {registry === null ? (
          <p className={stil.not}>{t("okuyucu.yukleniyor")}</p>
        ) : gorunen.length === 0 ? (
          <p className={stil.not}>{t("kurucu.sart.varsayilan")}</p>
        ) : (
          <dl className={stil.liste}>
            {gorunen.map((c) => satir(c.title, formatValue(c.control, degerOf(c, state.values), registry.units)))}
          </dl>
        )}
        {farkli.length > gorunen.length ? <p className={stil.not}>{t("kurucu.sart.daha", { n: farkli.length - gorunen.length })}</p> : null}
      </section>
      {kosu ? (
        <div className={stil.eylemler}>
          <KosuEylemleri {...kosu} state={state} eylemler={["degistir", "sart"]} />
        </div>
      ) : null}
    </div>
  );
}
