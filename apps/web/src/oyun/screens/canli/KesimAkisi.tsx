import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import type { CopyKey } from "@/oyun/copy/t";
import type { Holdings } from "@/oyun/sim/types";
import { sayi } from "./bicim";
import styles from "./ParaSahiplik.module.css";

type Props = { holdings: Holdings | undefined; isLive: boolean };

/** Tabloda en çok bu kadar hücre yazılır (sunucu sınırı); kalanlar "öbür hücreler" satırındadır. */
export const AKIS_HUCRE_SINIRI = 18;

const KESIMLER = ["players", "npcs", "npc_firms", "player_firms", "public_firms", "city", "lonca", "found_fund", "insurance", "other", "mint"] as const;
/** Bilinmeyen kesim adı ham yazılmaz ("Diğer" olur). */
const kesimAdi = (id: string): string => t(((KESIMLER as readonly string[]).includes(id) ? `canli.kesim.ad.${id}` : "canli.kesim.ad.other") as CopyKey);

/** Kalan (toplu) satır: yeni kayıtta `rest/rest`, eski kayıtta `other/other` (kesim içi hücre yazılmadığından gerçek bir `other/other` akışı olamaz). */
const KALAN_KESIMLER = ["rest", "other"];
const topluMu = (f: { from: string; to: string }): boolean => f.from === f.to && KALAN_KESIMLER.includes(f.from);

/** Haftalık kesimden kesime para akışı: en büyük hücreler ve tek "öbür hücreler" satırı. */
export function KesimAkisi({ holdings, isLive }: Props) {
  const baslik = t("canli.kesim.baslik");
  const akis = holdings?.flows ?? null;
  const toplu = akis?.filter(topluMu) ?? [];
  const hucreler = (akis?.filter((f) => !topluMu(f)) ?? []).sort((a, b) => b.amount - a.amount).slice(0, AKIS_HUCRE_SINIRI);
  const satirlar = [
    ...hucreler.map((f) => [kesimAdi(f.from), kesimAdi(f.to), sayi(f.amount)]),
    ...(toplu.length > 0 ? [[t("canli.kesim.diger_satir"), "", sayi(toplu.reduce((n, f) => n + f.amount, 0))]] : []),
  ];
  return (
    <div className={styles.bolum}>
      <h3 className={styles.altBaslik}>{baslik}</h3>
      <p className={styles.tanim}>{t("canli.kesim.tanim")}</p>
      {satirlar.length === 0 ? (
        <p className={styles.tanim}>{t(isLive ? "canli.kesim.olculmuyor.live" : "canli.kesim.olculmuyor")}</p>
      ) : (
        <Table
          caption={baslik} columns="lead2" minWidth="md" density="compact" align={["start", "start", "end"]}
          header={[t("canli.kesim.kol_kaynak"), t("canli.kesim.kol_hedef"), t("canli.kesim.kol_tutar")]}
          rows={satirlar}
        />
      )}
    </div>
  );
}
