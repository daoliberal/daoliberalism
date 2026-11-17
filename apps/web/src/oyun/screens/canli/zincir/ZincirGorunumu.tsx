import { cx } from "@/components/primitives/cx";
import { t } from "@/oyun/copy/t";
import type { WeekPacket, WorldInfo } from "@/oyun/sim/types";
import { KitHalkalar } from "./KitHalkalar";
import { chainKenarlari, type Kenar } from "./kenarlar";
import styles from "./Zincir.module.css";

const KOLON = 190;
const SATIR = 64;
const KENAR_Y = 24;
const MAX_BASAMAK = 12;

/** Her sektörün basamağı: girdisizler 0, sonrakiler en uzun girdi yolu + 1 (döngüye karşı sınırlı). */
export function basamaklar(sektorler: string[], kenarlar: Kenar[]): Map<string, number> {
  const d = new Map(sektorler.map((s) => [s, 0]));
  for (let tur = 0; tur < MAX_BASAMAK; tur += 1) {
    let degisti = false;
    for (const [a, b] of kenarlar) {
      const da = d.get(a);
      const db = d.get(b);
      if (da === undefined || db === undefined) continue;
      if (da + 1 > db && da + 1 <= MAX_BASAMAK) {
        d.set(b, da + 1);
        degisti = true;
      }
    }
    if (!degisti) break;
  }
  return d;
}

type Props = { cur: WeekPacket | null; weeks: WeekPacket[]; dunya: WorldInfo | undefined; sektorAdi(s: string): string; ac?(kind: string, ref: string): void };

/** Zincir görünümü: sektör düğümleri basamaklara dizilir; çizgiler tarif kenarlarıdır (kenar kümesi paketlerden 1. haftadan kurulur). */
export function ZincirGorunumu({ cur, weeks, dunya, sektorAdi, ac }: Props) {
  const chain = cur?.chain ?? null;
  if (chain === null) return <p className={styles.not}>{t("canli.sehir.sektor_yok")}</p>;
  const temel: Kenar[] = (dunya?.chain?.edges ?? []).map((e) => [e.from, e.to, e.product]);
  const kenarlar = chainKenarlari(weeks, cur?.week ?? 0, temel);
  const ids = chain.sectors.map((s) => s.sector);
  const kit = new Map((chain.scarce ?? []).map((s, i) => [s.sector, i]));
  const sev = basamaklar(ids, kenarlar);
  const sutunSayisi = Math.max(1, ...[...sev.values()].map((v) => v + 1));
  const siradaki = new Map<number, number>();
  const konum = new Map<string, { x: number; y: number; b: number }>();
  for (const id of ids) {
    const b = sev.get(id) ?? 0;
    const k = siradaki.get(b) ?? 0;
    siradaki.set(b, k + 1);
    konum.set(id, { x: b * KOLON + KOLON / 2, y: k * SATIR + SATIR / 2, b });
  }
  const satirSayisi = Math.max(1, ...siradaki.values());
  const gen = sutunSayisi * KOLON;
  const yuk = satirSayisi * SATIR;
  const durumOf = (s: string): "kit" | "normal" | "olculmuyor" => (!chain.board ? "olculmuyor" : kit.has(s) ? "kit" : "normal");
  const durumMetin = { kit: t("canli.zincir.durum_kit"), normal: t("canli.zincir.durum_normal"), olculmuyor: t("canli.zincir.durum_olculmuyor") };
  const glif = { kit: "▲", normal: "✓", olculmuyor: "–" };
  return (
    <section aria-label={t("canli.zincir.baslik")} className={styles.alan}>
      <h2 className={styles.baslik}>{t("canli.zincir.baslik")}</h2>
      <p className={styles.not}>{t("canli.zincir.bilgi")}</p>
      <div role="region" aria-label={t("canli.zincir.grup")} tabIndex={0} className={styles.kaydir}>
        <svg viewBox={`0 0 ${gen} ${yuk}`} className={styles.svg} role="group" aria-label={t("canli.zincir.sema")}>
          <g aria-hidden="true">
            {kenarlar.map(([a, b, urun]) => {
              const p = konum.get(a);
              const q = konum.get(b);
              if (!p || !q) return null;
              const kitKenar = durumOf(a) === "kit";
              return <line key={`${a}>${b}>${urun}`} data-kenar={`${a}>${b}`} data-kit={kitKenar ? "1" : undefined} className={cx(styles.kenar, kitKenar && styles.kenarKit)} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
            })}
          </g>
          {ids.map((id) => {
            const p = konum.get(id)!;
            const durum = durumOf(id);
            const ad = sektorAdi(id);
            const olay = ac ? { role: "button", tabIndex: 0, "aria-label": t("canli.zincir.dugum_aria", { ad, durum: durumMetin[durum] }), onClick: () => ac("sector", id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ac("sector", id); } } } : {};
            return (
              <g key={id} data-dugum={id} data-durum={durum} className={cx(styles.dugum, styles[durum])} {...olay}>
                <circle cx={p.x} cy={p.y} r={KENAR_Y / 2} className={styles.daire} />
                <text x={p.x} y={p.y + KENAR_Y} textAnchor="middle" className={styles.etiket}>
                  {ad}
                </text>
                <text x={p.x} y={p.y + KENAR_Y + 16} textAnchor="middle" className={styles.durumYazi}>
                  {glif[durum]} {durumMetin[durum]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul aria-label={t("canli.zincir.kenar_liste")} className={styles.gizli}>
        {kenarlar.flatMap(([a, b, urun]) => (konum.has(a) && konum.has(b) ? [<li key={`${a}>${b}>${urun}`}>{t("canli.zincir.kenar_satir", { a: sektorAdi(a), b: sektorAdi(b) })}</li>] : []))}
      </ul>
      <p className={styles.not}>{t("canli.zincir.lejant")}</p>
      {kenarlar.length === 0 ? <p className={styles.not}>{t("canli.zincir.kenar_yok")}</p> : null}
      <KitHalkalar chain={chain} sektorAdi={sektorAdi} {...(ac ? { ac } : {})} />
    </section>
  );
}
