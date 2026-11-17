"use client";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { Registry, RegistryCard, WorldEvent } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import styles from "./Rehber.module.css";

type Props = {
  olay: WorldEvent;
  registry: Registry | null;
  /** "Bu kuralı değiştir"in açacağı kart; olay bir karta çözülmüyorsa `null` ve düğme genel "Şartı değiştir" olur (editör hedefsiz açılır). */
  hedef: RegistryCard | null;
  /** Koşu sürüyorsa Şart değiştirilebilir; değilse düğme çıkmaz. */
  degistirilebilir: boolean;
  onDegistir(): void;
  onDevam(): void;
  /** Esc ve "Kapat": dünya durmuş kalır. */
  onKapat(): void;
};

/**
 * İlk kritik olayda dünya durunca açılan iletişim kutusu: olay, kayıtlı neden adımları (ya da olayı etkileyen kural kartları),
 * "Bu kuralı değiştir" ve "Devam et". Neden adımları yalnız olayın kendi kaydından gelir; kayıt yoksa uydurulmaz.
 */
export function DurduDiyalogu({ olay, registry, hedef, degistirilebilir, onDegistir, onDevam, onKapat }: Props) {
  const adimlar = olay.chain ?? [];
  const kurallar = adimlar.length > 0 ? [] : olay.rule_ids.flatMap((id) => registry?.cards.find((c) => c.id === id)?.title ?? []);
  return (
    <Diyalog baslik={t("rehber.durdu.baslik")} onKapat={onKapat} sayilir={false}>
      <div className={styles.tur}>
        <p className={styles.cerceve}>{t(olay.textKey, olay.params)}</p>
        {adimlar.length > 0 ? (
          <ol className={styles.liste} aria-label={t("canli.neden.adimlar")}>
            {adimlar.map((a, i) => (
              <li key={`${a.step}-${i}`} className={styles.adim}>{t(a.textKey, a.params)}</li>
            ))}
          </ol>
        ) : kurallar.length > 0 ? (
          <ul className={styles.liste} aria-label={t("canli.neden.kurallar")}>
            {kurallar.map((k) => (
              <li key={k} className={styles.adim}>{k}</li>
            ))}
          </ul>
        ) : null}
        <p className={styles.metin}>{t("rehber.durdu.not")}</p>
        {hedef && degistirilebilir ? <p className={styles.metin}>{t("rehber.durdu.acilacak", { kural: hedef.title })}</p> : null}
        <div className={styles.dugmeler}>
          {degistirilebilir ? (
            <Button variant="primary" onClick={onDegistir}>
              {t(hedef ? "rehber.durdu.degistir" : "degistir.dugme")}
            </Button>
          ) : null}
          <Button variant={degistirilebilir ? "secondary" : "primary"} onClick={onDevam}>
            {t("rehber.durdu.devam")}
          </Button>
        </div>
      </div>
    </Diyalog>
  );
}

/** İlk haftalarda tek tek çıkan ipucu; "Tamam" kapatır ve bir daha çıkmaz. */
export function Ipucu({ metin, onTamam }: { metin: string; onTamam(): void }) {
  return (
    <div role="status" className={styles.ipucu}>
      <p className={styles.ipucuMetin}>{metin}</p>
      <Button variant="secondary" size="sm" onClick={onTamam}>
        {t("rehber.ipucu.tamam")}
      </Button>
    </div>
  );
}
