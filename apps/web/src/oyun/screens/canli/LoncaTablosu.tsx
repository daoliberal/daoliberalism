import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import type { CopyKey } from "@/oyun/copy/t";
import type { Holdings, HoldingsLonca } from "@/oyun/sim/types";
import { goster, sayi } from "./bicim";
import styles from "./ParaSahiplik.module.css";

type Props = { holdings: Holdings | undefined; isLive: boolean; onAc?: (kind: string, ref: string) => void };

/** "lonca0" -> "Lonca 1" (sunucunun etiketiyle aynı kural: kimlik sıfırdan, görünen sıra birden başlar). */
export function loncaAdi(ref: string): string {
  const m = /^lonca(\d+)$/.exec(ref);
  return m ? t("canli.sahiplik.lonca.ad", { n: Number(m[1]) + 1 }) : ref;
}

const SAHIP: Record<NonNullable<HoldingsLonca["owner"]>, CopyKey> = { player: "cekmece.sahip.player", none: "cekmece.sahip.none", closed: "cekmece.sahip.closed" };

/** Loncalar tablosu (§4.2): satır başına sermaye, mevduat, verdiği kredi ve özkaynak. Lonca adına tıklamak lonca çekmecesini açar. Kişi kimliği yoktur (K1). */
export function LoncaTablosu({ holdings, isLive, onAc }: Props) {
  const baslik = t("canli.sahiplik.lonca.baslik");
  const satirlar = holdings?.loncas ?? [];
  return (
    <div className={styles.bolum}>
      <h3 className={styles.altBaslik}>{baslik}</h3>
      <p className={styles.tanim}>{t("canli.sahiplik.lonca.tanim")}</p>
      {satirlar.length === 0 ? (
        <p className={styles.tanim}>{t(isLive ? "canli.sahiplik.lonca.olculmuyor.live" : "canli.sahiplik.lonca.olculmuyor")}</p>
      ) : (
        <Table
          caption={baslik} columns="ledger7" minWidth="lg" density="compact" align={["start", "start", "end", "end", "end", "end", "end"]}
          header={[t("canli.sahiplik.lonca.kol_ad"), t("canli.sahiplik.lonca.kol_sahip"), t("canli.sahiplik.lonca.kol_uye"), t("canli.sahiplik.lonca.kol_sermaye"), t("canli.sahiplik.lonca.kol_mevduat"), t("canli.sahiplik.lonca.kol_kredi"), t("canli.sahiplik.lonca.kol_ozkaynak")]}
          rows={satirlar.map((l) => [
            onAc ? <button key={l.ref} type="button" className={styles.dugme} onClick={() => onAc("lonca", l.ref)}>{loncaAdi(l.ref)}</button> : loncaAdi(l.ref),
            l.owner ? t(SAHIP[l.owner]) : t("canli.gosterge.olculmuyor"),
            goster(l.members, sayi), goster(l.capital, sayi), goster(l.deposits, sayi), goster(l.credit_out, sayi), goster(l.equity, sayi),
          ])}
        />
      )}
    </div>
  );
}
