import { t } from "@/oyun/copy/t";
import type { ChainPacket } from "@/oyun/sim/types";
import { goster, oran1 } from "../bicim";
import styles from "./Zincir.module.css";

type Props = { chain: ChainPacket; sektorAdi(s: string): string; ac?(kind: string, ref: string): void };

/** En kıt 5 halka (sunucunun panosu): her satır sektör çekmecesine bağlanır. Pano kapalıysa neden gösterilir. */
export function KitHalkalar({ chain, sektorAdi, ac }: Props) {
  return (
    <section aria-labelledby="kit-baslik" className={styles.kitKutu}>
      <h3 id="kit-baslik" className={styles.altBaslik}>
        {t("canli.zincir.kit_baslik")}
      </h3>
      {!chain.board || chain.scarce === null ? (
        <p className={styles.not}>{t("canli.zincir.pano_kapali")}</p>
      ) : chain.scarce.length === 0 ? (
        <p className={styles.not}>{t("canli.zincir.kit_yok")}</p>
      ) : (
        <ol aria-label={t("canli.zincir.kit_liste")} className={styles.kitListe}>
          {chain.scarce.slice(0, 5).map((s) => {
            const metin = t("canli.zincir.kit_satir", { ad: sektorAdi(s.sector), kit: goster(s.shortage, oran1), sur: goster(s.persist, oran1) });
            return (
              <li key={s.sector} data-kit={s.sector}>
                {ac ? (
                  <button type="button" className={styles.kitDugme} onClick={() => ac("sector", s.sector)}>
                    {metin}
                  </button>
                ) : (
                  metin
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
