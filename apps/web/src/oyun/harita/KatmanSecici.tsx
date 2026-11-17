import type { ReactNode } from "react";
import { cx } from "@/components/primitives/cx";
import { t, type CopyKey } from "@/oyun/copy/t";
import { lejantAdi } from "./lejant";
import stil from "./KatmanSecici.module.css";
import type { Katman, KatmanVerisi } from "./tipler";

const KATMANLAR: readonly { id: Katman; ad: CopyKey }[] = [
  { id: "yok", ad: "harita.katman.yok" },
  { id: "talep", ad: "harita.katman.talep" },
  { id: "issizlik", ad: "harita.katman.issizlik" },
  { id: "fiyat", ad: "harita.katman.fiyat" },
];

type SeciciProps = { katman: Katman; onKatman: (k: Katman) => void };

/** Veri katmanı seçici: Yok, Talep, İşsizlik, Fiyat (`HaritaKontrolleri` `ekler` yuvasına konur). Harita türünü bilmez. */
export function KatmanSecici({ katman, onKatman }: SeciciProps) {
  return (
    <div role="group" aria-label={t("harita.katman.grup")} className={stil.grup}>
      <span className={stil.etiket}>{t("harita.katman.baslik")}</span>
      {KATMANLAR.map((k) => (
        <button key={k.id} type="button" className={cx(stil.dugme, katman === k.id && stil.secili)} aria-pressed={katman === k.id} onClick={() => onKatman(k.id)}>
          {t(k.ad)}
        </button>
      ))}
    </div>
  );
}

/** Açık katmanın lejantı: ton rengi + ad + işletme sayısı. Lejantı olmayan katmanda (Yok, İşsizlik) çizilmez. */
export function KatmanLejanti({ veri }: { veri: KatmanVerisi }) {
  if (veri.lejant.length === 0) return null;
  return (
    <ul className={stil.lejant} aria-label={t("harita.katman.lejant")}>
      {veri.lejant.map((l) => (
        <li key={l.anahtar} className={stil.lejantOge}>
          <span className={stil.ornek} data-ton={l.ton} aria-hidden="true" />
          {t("harita.lejant.adet", { ad: lejantAdi(l.anahtar), n: l.adet })}
        </li>
      ))}
    </ul>
  );
}

/** Sağ alt yuvanın düzeni: lejant yukarıda, kontroller aşağıda. */
export function HaritaAltSag({ lejant, children }: { lejant?: ReactNode; children: ReactNode }) {
  return (
    <div className={stil.kap}>
      {lejant}
      {children}
    </div>
  );
}
