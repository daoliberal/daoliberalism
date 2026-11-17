import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import { Diyalog } from "@/oyun/ui/Diyalog";
import styles from "./Hesaplaniyor.module.css";

/**
 * "Simülasyon hesaplanıyor": dal koşusu kurulurken ilerleme diyaloğu. `ilerleme` yoksa istek yanıt bekliyor (iptal kapalı);
 * varsa hazır hafta sayısı gösterilir ve "İptal et" dal koşusunu atar (üst koşu değişmez).
 */
export function Hesaplaniyor({ ilerleme, hafta, yeniden, onIptal }: { ilerleme?: { done: number; total: number }; hafta?: number; /** Dal değil, Koşular'da tariften yeniden kurma: kendi metni. */ yeniden?: boolean; onIptal?(): void }) {
  return (
    <Diyalog baslik={t("canli.dallan.baslik")} kapatMetni={t("canli.dallan.iptal")} disabled={onIptal === undefined} onKapat={onIptal ?? (() => {})}>
      <Stack gap="10">
        {ilerleme ? (
          <>
            <p className={styles.metin}>{yeniden ? t("kosular.yeniden.metin", { n: hafta ?? ilerleme.total }) : t("canli.dallan.metin", { n: hafta ?? ilerleme.total })}</p>
            <progress className={styles.cubuk} aria-label={t(yeniden ? "kosular.yeniden.ilerleme_ad" : "canli.dallan.ilerleme_ad")} value={Math.min(ilerleme.done, ilerleme.total)} max={Math.max(1, ilerleme.total)} />
            <p className={styles.metin}>{t("canli.dallan.ilerleme", { done: ilerleme.done, total: ilerleme.total })}</p>
          </>
        ) : (
          <p className={styles.metin} role="status">{t(yeniden ? "kosular.yeniden.baslatiliyor" : "canli.dallan.baslatiliyor")}</p>
        )}
      </Stack>
    </Diyalog>
  );
}
