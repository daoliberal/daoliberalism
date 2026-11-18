import { EKRAN_STILI } from "./ekranStili";
import { t } from "../copy/t";
import stil from "./OlaySeridi.module.css";

export type OlayOgesi = { id: string | number; metin: string };

/** Şeridin yanındaki "Tüm olaylar" gibi bir kapı: tam listeyi açan düğme (açma işini dışarıdaki ekran yapar). */
export type OlayKapisi = { ad: string; onAc: () => void };

/**
 * Son olayların kısa şeridi (en yeni ilk). Boşsa çizilmez. `kapi` verilirse şeridin yanında tam listeyi açan düğme çıkar;
 * `kapiUstte` ile ayrı düğme yoktur: şeridin kendisi düğmedir (tüm şerit tıklanır, `aria-label` = kapı adı, ipucu `title`).
 */
export function OlaySeridi({ olaylar, kapi, kapiUstte = false }: { olaylar: OlayOgesi[]; kapi?: OlayKapisi; kapiUstte?: boolean }) {
  if (olaylar.length === 0) return null;
  const sarili = kapi !== undefined && kapiUstte;
  return (
    <div className={stil.kap}>
      <section role="log" aria-label={t("ekran.olay_baslik")} className={sarili ? `${stil.serit} ${stil.seritTik}` : stil.serit}>
        <ul className={stil.liste}>
          {olaylar.slice(0, EKRAN_STILI.olaySayisi).map((o) => (
            <li key={o.id}>{o.metin}</li>
          ))}
        </ul>
        {sarili ? <button type="button" className={stil.tumu} aria-label={kapi.ad} title={kapi.ad} onClick={kapi.onAc} /> : null}
      </section>
      {kapi && !kapiUstte ? (
        <button type="button" className={stil.kapi} onClick={kapi.onAc}>
          {kapi.ad}
        </button>
      ) : null}
    </div>
  );
}
