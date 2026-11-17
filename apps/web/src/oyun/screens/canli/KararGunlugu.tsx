import { t } from "@/oyun/copy/t";
import { degerMetni, sartFarki } from "@/oyun/screens/sart/sartMantik";
import { surumNo } from "@/oyun/sim/surum";
import type { Registry, RunState, UIValue, WorldEvent } from "@/oyun/sim/types";
import { eventWeek } from "./olaylar";
import styles from "./KararGunlugu.module.css";

type Satir = { id: string; ad: string; eski: string | null; yeni: string };
type Giris = { n: number; hafta: number; satirlar: Satir[]; not?: string };

function satirOf(registry: Registry | null, id: string, from: UIValue | null, to: UIValue): Satir | null {
  const c = registry?.cards.find((x) => x.id === id);
  if (!c) return null;
  return { id, ad: c.title, eski: from === null ? null : degerMetni(registry!, c, from), yeni: degerMetni(registry!, c, to) };
}

/** Sürümler: kaynak `versions` bildiriyorsa (tam değer kümeleri, not dahil) onlardan; yoksa `event.version` olaylarının `changes` satırlarından. */
export function kararlar(state: RunState, events: WorldEvent[], registry: Registry | null): Giris[] {
  const vs = [...(state.versions ?? [])].sort((a, b) => a.version - b.version);
  if (vs.length > 0) {
    return vs.map((v, i) => {
      const prev = vs[i - 1];
      const satirlar =
        prev && registry
          ? sartFarki(registry, prev.values, v.values).map((d) => satirOf(registry, d.id, d.from, d.to)).filter((x): x is Satir => x !== null)
          : [];
      return { n: v.version, hafta: v.fromWeek, satirlar, ...(v.note ? { not: v.note } : {}) };
    });
  }
  const byN = new Map<number, Giris>();
  for (const e of events) {
    const n = surumNo(e);
    if (n === null) continue;
    byN.set(n, { n, hafta: eventWeek(e), satirlar: (e.changes ?? []).map((c) => satirOf(registry, c.id, c.from, c.to)).filter((x): x is Satir => x !== null) });
  }
  return [{ n: 1, hafta: 0, satirlar: [] }, ...[...byN.values()].sort((a, b) => a.n - b.n)];
}

/** Karar günlüğü: her sürüm (hafta, değişenler "eski → yeni", varsa not). Henüz değişiklik yoksa tek "Başlangıç şartı". */
export function KararGunlugu({ state, events, registry }: { state: RunState; events: WorldEvent[]; registry: Registry | null }) {
  const girisler = kararlar(state, events, registry);
  const yok = girisler.length <= 1;
  return (
    <div className={styles.kok}>
      {yok ? <p className={styles.not}>{t("ustcubuk.gunluk_bos")}</p> : null}
      <ol className={styles.liste}>
        {[...girisler].reverse().map((g) => (
          <li key={g.n} className={styles.giris}>
            <h3 className={styles.baslik}>{g.hafta === 0 ? t("karar.baslangic", { n: g.n }) : t("karar.surum", { n: g.n, hafta: g.hafta })}</h3>
            {g.satirlar.length > 0 ? (
              <ul className={styles.satirlar}>
                {g.satirlar.map((s) => (
                  <li key={s.id}>{s.eski === null ? t("event.version_satir_yeni", { ad: s.ad, yeni: s.yeni }) : t("karar.fark", { ad: s.ad, eski: s.eski, yeni: s.yeni })}</li>
                ))}
              </ul>
            ) : g.hafta === 0 ? null : (
              <p className={styles.not}>{t("karar.fark_yok")}</p>
            )}
            {g.not ? <p className={styles.not}>{t("karar.not", { not: g.not })}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
