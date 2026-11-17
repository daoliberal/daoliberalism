import { t } from "@/oyun/copy/t";
import { num } from "@/oyun/lib/format";
import { daoDurumMetni, daoUnvanMetni, type DaoGozlem } from "@/oyun/sim/dao";
import stil from "@/oyun/screens/canli/KurucuUst.module.css";

const akce = (x: number): string => t("canli.gosterge.akce", { n: num(x) });

/** DAO üst sol şeridi: nakit, mevduat, durum, unvan. Gözlem yoksa (hafta 0) "ölçülmüyor", sayı uydurulmaz. */
export function DaoUst({ g }: { g: DaoGozlem | null }) {
  const yok = t("canli.gosterge.olculmuyor");
  const olcular: { id: string; etiket: string; deger: string }[] = [
    { id: "nakit", etiket: t("dao.ust.nakit"), deger: g ? akce(g.ben.nakit) : yok },
    { id: "mevduat", etiket: t("dao.ust.mevduat"), deger: g ? akce(g.ben.mevduat.tutar) : yok },
    { id: "durum", etiket: t("dao.ust.durum"), deger: g ? daoDurumMetni(g.ben.durum) : yok },
    { id: "unvan", etiket: t("dao.ust.unvan"), deger: g ? daoUnvanMetni(g.ben.unvan) : yok },
  ];
  return (
    <dl className={stil.serit} aria-label={t("dao.ust.baslik")}>
      {olcular.map((o) => (
        <div key={o.id} className={stil.olcu} data-ust={o.id}>
          <dt className={stil.etiket}>{o.etiket}</dt>
          <dd className={stil.deger}>{o.deger}</dd>
        </div>
      ))}
    </dl>
  );
}
