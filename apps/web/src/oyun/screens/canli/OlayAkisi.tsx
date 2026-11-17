import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { degerMetni } from "@/oyun/screens/sart/sartMantik";
import type { Registry, WorldEvent } from "@/oyun/sim/types";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { Banner, type BannerTone } from "@/oyun/ui/Banner";
import { Bos } from "@/oyun/ui/Durum";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";
import { eventWeek, onemliOlay } from "./olaylar";

const TONE: Record<WorldEvent["kind"], BannerTone> = { good: "ok", warn: "warn", bad: "warn", neutral: "neutral" };

/** Sürüm olayının alt satırları: "{ad}: {eski} → {yeni}" (eski değer yoksa yalnız yeni; hafta yalnız başlıkta). Kayıtta olmayan ayar atlanır. */
export function surumSatirlari(e: WorldEvent, registry: Registry | null): string[] {
  if (e.textKey !== "event.version" || registry === null) return [];
  const out: string[] = [];
  for (const c of e.changes ?? []) {
    const card = registry.cards.find((x) => x.id === c.id);
    if (!card) continue;
    const yeni = degerMetni(registry, card, c.to);
    out.push(c.from === null ? t("event.version_satir_yeni", { ad: card.title, yeni }) : t("event.version_satir", { ad: card.title, eski: degerMetni(registry, card, c.from), yeni }));
  }
  return out;
}

export type SuzgecKipi = "onemli" | "tumu";

type Props = {
  events: WorldEvent[];
  kip: SuzgecKipi;
  onKip(k: SuzgecKipi): void;
  /** Zaman çizgisinden gelen tek hafta süzgeci. */
  hafta: number | null;
  onHaftaTemizle(): void;
  secili: string | null;
  onSec(id: string): void;
};

/**
 * Yeni olay üstte; kritik olay `crisis` bandı. Süzgeç: yalnız önemli olaylar ya da tümü; zaman çizgisinden gelen hafta süzgeci
 * ("Tümünü göster" temizler). Olay metni bir düğmedir: seçilince neden-sonuç zinciri açılır. Sürüm olayı değişen ayarları alt satır olarak sayar.
 */
export function OlayAkisi({ events, kip, onKip, hafta, onHaftaTemizle, secili, onSec }: Props) {
  const { registry } = useRegistry();
  const ordered = [...events].reverse().filter((e) => (hafta !== null ? eventWeek(e) === hafta : kip === "tumu" || onemliOlay(e)));
  return (
    <section aria-labelledby="olay-akisi" className={styles.bolum}>
      <div className={styles.baslikSatir}>
        <h2 id="olay-akisi" className={styles.baslik}>
          {t("canli.olay_akisi")}
        </h2>
        <div role="group" aria-label={t("canli.olay.suzgec")} className={akis.suzgec}>
          <Button variant="toggle" size="sm" pressed={kip === "onemli"} onClick={() => onKip("onemli")}>
            {t("canli.olay.onemli")}
          </Button>
          <Button variant="toggle" size="sm" pressed={kip === "tumu"} onClick={() => onKip("tumu")}>
            {t("canli.olay.tumu")}
          </Button>
        </div>
      </div>
      {hafta !== null ? (
        <div className={akis.hafta}>
          <span>{t("canli.olay.hafta_olaylari", { n: hafta })}</span>
          <Button variant="secondary" size="sm" onClick={onHaftaTemizle}>
            {t("canli.olay.tumunu_goster")}
          </Button>
        </div>
      ) : null}
      {events.length === 0 ? (
        <Bos messageKey="canli.olay_bos" />
      ) : ordered.length === 0 ? (
        <Bos messageKey="canli.olay.suzgec_bos" />
      ) : (
        <ol className={styles.liste}>
          {ordered.map((e) => {
            const satirlar = surumSatirlari(e, registry);
            return (
              <li key={e.id} className={styles.oge}>
                <Stack gap="4">
                  <Banner asItem tone={e.critical ? "crisis" : TONE[e.kind]}>
                    <button type="button" className={akis.olayDugme} aria-pressed={secili === e.id} onClick={() => onSec(e.id)}>
                      {t(e.textKey, e.params)}
                    </button>
                  </Banner>
                  {satirlar.length > 0 ? (
                    <ul className={styles.altSatirlar}>
                      {satirlar.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  ) : null}
                </Stack>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
