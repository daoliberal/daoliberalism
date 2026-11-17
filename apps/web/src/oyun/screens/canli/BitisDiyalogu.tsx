import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import type { WorldEvent } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { bitisMetni } from "./BitisKarti";
import type { Dallan } from "./useDallan";
import akis from "./Akis.module.css";
import styles from "./Canli.module.css";

/** Koşu bitti: çöküş haftası ve toparlanma birlikte; Sonucu gör, Bu haftadan dallan, Sıfırdan başlat, Kapat. */
export function BitisDiyalogu({ weeks, events, dallan, onSonuc, onSifirla, onKapat }: {
  weeks: number; events: WorldEvent[]; dallan: Dallan; onSonuc(): void; onSifirla(): void; onKapat(): void;
}) {
  const { metin, tone } = bitisMetni(events);
  return (
    <Diyalog baslik={t("bitis.baslik", { n: weeks })} kapatSonda onKapat={onKapat}>
      <Stack gap="10" align="start">
        <Banner tone={tone}>{metin}</Banner>
        <div className={styles.dugmeler}>
          <Button variant="primary" onClick={onSonuc}>
            {t("canli.bitis.sonuc")}
          </Button>
          <Button variant="secondary" disabled={!dallan.izinli || dallan.bekliyor} aria-describedby={dallan.izinli ? undefined : "bitis-dallan-neden"} onClick={() => dallan.baslat(weeks)}>
            {t("canli.dallan.dugme")}
          </Button>
          <Button variant="secondary" onClick={onSifirla}>
            {t("bitis.yeniden")}
          </Button>
        </div>
        {dallan.izinli ? null : <p id="bitis-dallan-neden" className={akis.sebep}>{t(dallan.neden)}</p>}
        {dallan.hata ? <p role="alert" className={akis.hata}>{t(dallan.hata)}</p> : null}
      </Stack>
    </Diyalog>
  );
}
