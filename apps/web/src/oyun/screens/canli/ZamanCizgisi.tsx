import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { goster, issizOrani, oran0 } from "./bicim";
import type { Dallan } from "./useDallan";
import type { SurumSatiri } from "./olaylar";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";

type Props = {
  /** Yayımlanmış son hafta; seçilebilecek geçmiş hafta 0..bu. */
  hafta: number;
  weeks: WeekPacket[];
  surumler: SurumSatiri[];
  dallan: Dallan;
  /** Seçili haftanın olaylarını olay akışında süzer. */
  onOlaylar(hafta: number): void;
  /** Seçili geçmiş hafta dışarıdan tutulabilir (pencere kapanıp açılınca korunur); verilmezse bileşen kendisi tutar. */
  secim?: { pick: number | null; onPick(w: number | null): void };
};

/** Zaman çizgisi: sürüm satırları, geçmiş hafta seçici, seçilen haftanın kutusu ("Bu haftadan dallan", "Bu haftanın olayları"). */
export function ZamanCizgisi({ hafta, weeks, surumler, dallan, onOlaylar, secim }: Props) {
  const [kendiPick, setKendiPick] = useState<number | null>(null);
  const pick = secim ? secim.pick : kendiPick;
  const setPick = secim ? secim.onPick : setKendiPick;
  const uid = useId();
  const p = pick === null ? undefined : weeks.find((x) => x.week === pick);
  const nedenId = `${uid}-neden`;
  return (
    <section aria-labelledby="zaman" className={styles.bolum}>
      <h2 id="zaman" className={styles.baslik}>
        {t("canli.zaman_cizgisi")}
      </h2>
      <ol className={styles.liste}>
        {surumler.map((r) => (
          <li key={`${r.n}-${r.a}`} className={styles.surum}>
            {t("canli.surum_satir", r)}
          </li>
        ))}
      </ol>
      <div className={akis.aralik}>
        <label htmlFor={`${uid}-hafta`} className={styles.etiket}>
          {t("canli.zaman.hafta_etiket")}
        </label>
        <input
          id={`${uid}-hafta`} className={akis.aralikGirdi} type="range" min={0} max={Math.max(0, hafta)} step={1} value={Math.min(pick ?? hafta, hafta)}
          onChange={(e) => setPick(Number(e.currentTarget.value))}
        />
      </div>
      {pick !== null ? (
        <div className={akis.kutu}>
          <p className={akis.kutuMetin}>
            {p
              ? t("canli.zaman.kutu", { n: pick, kar: goster(p.world.served, oran0), issiz: goster(p.world.unemployment_rate_all ?? null, oran0) })
              : t("canli.zaman.kutu_yok", { n: pick })}
          </p>
          <Button variant="primary" size="sm" disabled={!dallan.izinli || dallan.bekliyor} aria-describedby={dallan.izinli ? undefined : nedenId} onClick={() => dallan.baslat(pick)}>
            {t("canli.dallan.dugme")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { onOlaylar(pick); setPick(null); }}>
            {t("canli.zaman.olaylar")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPick(null)}>
            {t("canli.zaman.kapat")}
          </Button>
          {dallan.izinli ? null : <p id={nedenId} className={akis.sebep}>{t(dallan.neden)}</p>}
          {dallan.hata ? <p role="alert" className={akis.hata}>{t(dallan.hata)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
