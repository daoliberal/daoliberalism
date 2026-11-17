import { t } from "../copy/t";
import { EKRAN_STILI } from "./ekranStili";
import stil from "./OlaySeridi.module.css";

export type OlayOgesi = { id: string | number; metin: string };

/** Şeridin yanındaki "Tüm olaylar" gibi bir kapı: tam listeyi açan düğme (açma işini dışarıdaki ekran yapar). */
export type OlayKapisi = { ad: string; onAc: () => void };

/** Son olayların kısa şeridi (en yeni ilk). Boşsa çizilmez. `kapi` verilirse şeridin yanında tam listeyi açan düğme çıkar. */
export function OlaySeridi({ olaylar, kapi }: { olaylar: OlayOgesi[]; kapi?: OlayKapisi }) {
  if (olaylar.length === 0) return null;
  return (
    <div className={stil.kap}>
      <section role="log" aria-label={t("ekran.olay_baslik")} className={stil.serit}>
        <ul className={stil.liste}>
          {olaylar.slice(0, EKRAN_STILI.olaySayisi).map((o) => (
            <li key={o.id}>{o.metin}</li>
          ))}
        </ul>
      </section>
      {kapi ? (
        <button type="button" className={stil.kapi} onClick={kapi.onAc}>
          {kapi.ad}
        </button>
      ) : null}
    </div>
  );
}
