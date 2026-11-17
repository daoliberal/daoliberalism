import { cx } from "@/components/primitives/cx";
import { t } from "@/oyun/copy/t";
import { adlandirici, type Adlandirici } from "./adlar";
import { HARITA_STILI } from "./haritaStili";
import type { GorselDurum } from "./izoDurum";
import type { ParselTuru } from "./izoSahne";
import { lejantAdi } from "./lejant";
import styles from "./SehirHaritasi.module.css";
import { MEYDAN_REF, type HaritaRef, type Parsel, type SehirSahnesi } from "./tipler";

type Props = {
  sahne: SehirSahnesi;
  secili: HaritaRef | null;
  onSec(r: HaritaRef | null): void;
  adlar?: Adlandirici;
  /** "İşletme kur" hedefleri: verilirse (izo'da domino ankraj kimlikleri) `sahne.bosParseller` yerine bunlar listelenir. */
  bosParseller?: readonly Parsel[] | undefined;
  /** İzo sahnede işletme görsel durumları: üretimde olmayanın durumu adının yanına yazılır (renk/şekle ek metin). */
  durumlar?: ReadonlyMap<string, GorselDurum>;
  /** Kur hedefinin türü (izo: konut, park, boş arsa); verilmezse hepsi "Boş parsel". */
  parselTuru?: (parselId: string) => ParselTuru;
  /** Şehir kurumları (Liman, İhracat) salt-okunur satır olarak listelenir (klasik görünümde ve klavye/ekran okuyucu için de erişilebilir; panel paketin `kurumlar` alanından). */
  kurumlar?: boolean;
};
const VARSAYILAN = adlandirici();

/** Üretimdeki (ya da bilinmeyen) durum adı değiştirmez; diğerleri "Ad (durum)" olur. */
const durumMetni = (ad: string, d: GorselDurum | undefined): string => (d === undefined || d === "uretim" ? ad : `${ad} (${t(`harita.durum.${d}`)})`);

const ayni = (a: HaritaRef | null, b: HaritaRef): boolean => a !== null && a.kind === b.kind && a.ref === b.ref;

/** Tek şehrin erişilebilir listesi: şehir binası, işletmeler, loncalar, ahır, Ben satırı ve katman lejantı. Harita çizilemese de her şey buradan yapılır. */
export function HaritaTablosu({ sahne, secili, onSec, adlar = VARSAYILAN, bosParseller = sahne.bosParseller, durumlar, parselTuru, kurumlar = false }: Props) {
  const isletmeler = sahne.binalar.filter((b) => b.tur === "isletme");
  const loncalar = sahne.binalar.filter((b) => b.tur === "lonca");
  const liste = [...isletmeler].sort((a, b) => b.boyut - a.boyut || a.id.localeCompare(b.id)).slice(0, HARITA_STILI.tablo.isletmeSiniri);
  const benBina = sahne.ben ? [...sahne.binalar, sahne.sehirBinasi, sahne.ahir].find((b) => b.id === sahne.ben?.binaId) : undefined;
  const dugme = (ref: HaritaRef, ad: string) => (
    <button type="button" className={cx(styles.satirDugme, ayni(secili, ref) && styles.seciliSatir)} aria-pressed={ayni(secili, ref)} onClick={() => onSec(ref)}>
      {ad}
    </button>
  );
  const sehirAdi = adlar.bina(sahne.sehirBinasi);
  // Kur hedefleri türüne göre gruplanır: konut/park/arsa "Boş parsel" diye anılmaz.
  const gruplar = new Map<ParselTuru, { tur: ParselTuru; ilk: string; n: number }>();
  for (const p of bosParseller ?? []) {
    const tur = parselTuru?.(p.id) ?? "bos";
    const g = gruplar.get(tur);
    if (g) g.n++;
    else gruplar.set(tur, { tur, ilk: p.id, n: 1 });
  }
  const parselGruplari = (["bos", "arsa", "konut", "park"] as const).flatMap((x) => gruplar.get(x) ?? []);
  return (
    <div className={styles.tabloKutu} role="region" aria-label={t("harita.sehir_liste", { sehir: sehirAdi })}>
      {sahne.veriYok ? <p className={styles.not}>{t("harita.bina_yok")}</p> : null}
      <ul className={styles.liste}>
        <li>{dugme(sahne.sehirBinasi.ref, sehirAdi)}</li>
        <li>{dugme(sahne.ahir.ref, adlar.bina(sahne.ahir))}</li>
        {kurumlar ? <li data-kurum="liman">{dugme({ kind: "kurum", ref: "liman" }, t("harita.liman"))}</li> : null}
        {kurumlar ? <li data-kurum="ihracat">{dugme({ kind: "kurum", ref: "ihracat" }, t("harita.ihracat"))}</li> : null}
        <li data-meydan="">{dugme({ kind: "lonca", ref: MEYDAN_REF }, t("harita.meydan"))}</li>
        {parselGruplari.map((g) => (
          <li key={g.tur} data-bos-parsel="">{dugme({ kind: "parsel", ref: g.ilk }, g.tur === "bos" ? t("harita.bos_parsel", { n: g.n }) : t(`harita.parsel_grup.${g.tur}`, { n: g.n }))}</li>
        ))}
        {benBina ? <li data-ben="">{dugme(benBina.ref, `${t(sahne.ben!.neden === "isyeri" ? "harita.senin_isyerin" : sahne.ben!.neden === "isletme" ? "harita.senin_isletmen" : "harita.senin_yerin")}: ${adlar.bina(benBina)}`)}</li> : null}
      </ul>
      {sahne.katman.rozetler.map((r) => (
        <p key={r.hedef} className={styles.not}>{t(r.hedef === "sehir" ? "harita.rozet.sehir" : "harita.rozet.meydan", { n: r.sayi })}</p>
      ))}
      {sahne.katman.lejant.length > 0 ? (
        <ul className={styles.liste} aria-label={t("harita.lejand")}>
          {sahne.katman.lejant.map((l) => (
            <li key={l.anahtar}>{t("harita.lejant.adet", { ad: lejantAdi(l.anahtar), n: l.adet })}</li>
          ))}
        </ul>
      ) : null}
      {loncalar.length > 0 ? (
        <section aria-label={t("harita.lonca_baslik")}>
          <h3 className={styles.altBaslik}>{t("harita.lonca_baslik")}</h3>
          <ul className={styles.liste}>
            {loncalar.map((b) => (
              <li key={b.id}>{dugme(b.ref, adlar.bina(b))}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {isletmeler.length > 0 ? (
        <section aria-label={t("harita.isletmeler", { sehir: sehirAdi })}>
          <h3 className={styles.altBaslik}>
            {isletmeler.length > liste.length
              ? t("harita.isletme_baslik_kirpik", { sehir: sehirAdi, n: isletmeler.length, k: liste.length })
              : t("harita.isletme_baslik", { sehir: sehirAdi, n: isletmeler.length })}
          </h3>
          <ul className={styles.liste}>
            {liste.map((x) => (
              <li key={x.id}>{dugme(x.ref, durumMetni(adlar.bina(x), durumlar?.get(x.id)))}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
