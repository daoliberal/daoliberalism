import { t } from "@/oyun/copy/t";
import { daoUnvanMetni, type DaoGozlem } from "@/oyun/sim/dao";
import stil from "@/oyun/screens/canli/KurucuUst.module.css";

/**
 * DAO üst sol: yalnız Unvan (etiket + değer) tek kompakt düğme; basınca Ben paneli açılır (nakit, mevduat, durum panelde).
 * Gözlem yoksa (hafta 0) "ölçülmüyor", değer uydurulmaz.
 */
export function DaoUst({ g, acik, panelId, onAc }: { g: DaoGozlem | null; acik: boolean; panelId: string; onAc: () => void }) {
  const deger = g ? daoUnvanMetni(g.ben.unvan) : t("canli.gosterge.olculmuyor");
  return (
    <button type="button" className={stil.unvanDugme} aria-expanded={acik} aria-controls={acik ? panelId : undefined} aria-label={t("dao.ust.unvan_dugme", { deger })} data-ust="unvan" onClick={onAc}>
      <span className={stil.etiket}>{t("dao.ust.unvan")}</span>
      <span className={stil.deger}>{deger}</span>
    </button>
  );
}
