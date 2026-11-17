import { t, type CopyKey } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { GOSTERGELER, type Kaynak } from "./Gostergeler";
import stil from "./KurucuUst.module.css";

/** Üst sol şeritteki göstergeler (sıra maketteki gibi): seçili şehrin talep karşılaması, kasası, işsizliği; Gini dünya ölçüsüdür. */
const UST_GOSTERGELER = ["karsilama", "kasa", "issiz", "gini"] as const;

const ETIKET = { karsilama: "kurucu.ust.karsilama", kasa: "kurucu.ust.kasa", issiz: "kurucu.ust.issiz", gini: "kurucu.ust.gini" } as const satisfies Record<(typeof UST_GOSTERGELER)[number], CopyKey>;

type Props = { cur: WeekPacket | null; sehir: number };

/** Kurucu bilgi şeridi: seçili şehir için dört ölçü. Değer yoksa "ölçülmüyor" (uydurma sayı yok). */
export function KurucuUst({ cur, sehir }: Props) {
  const kaynak: Kaynak | null = cur ? { w: cur.world, c: cur.cities?.find((c) => c.index === sehir) ?? null } : null;
  return (
    <dl className={stil.serit} aria-label={t("kurucu.ust.baslik")}>
      {UST_GOSTERGELER.map((id) => {
        const g = GOSTERGELER.find((x) => x.id === (id === "issiz" ? "issiz_oyuncu" : id))!      // şehir satırı yalnız oyuncuları sayar: oyuncu oranı;
        return (
          <div key={id} className={stil.olcu} data-ust={id}>
            <dt className={stil.etiket}>{t(ETIKET[id])}</dt>
            <dd className={stil.deger}>{kaynak ? g.metin(kaynak) : t("canli.gosterge.olculmuyor")}</dd>
          </div>
        );
      })}
    </dl>
  );
}
