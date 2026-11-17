import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { Availability } from "@/oyun/sim/types";
import { Banner } from "@/oyun/ui/Banner";
import { SettingCard } from "@/oyun/ui/SettingCard";

export const GECIS_SECENEKLERI = ["kapali", "kisa_sureli", "kurtarma_fonuyla"] as const;
export type GecisSecenegi = (typeof GECIS_SECENEKLERI)[number];

export function isGecisSecenegi(v: unknown): v is GecisSecenegi {
  return (GECIS_SECENEKLERI as readonly unknown[]).includes(v);
}

type Props = {
  value: GecisSecenegi;
  onChange(v: GecisSecenegi): void;
  /** Çözülmüş (eşzamanlı) kullanılabilirlik: çağıran `source.availability(values)` sonucunu bekleyip verir. */
  availability: Availability;
  /** Bir değişiklik uygulanırken ikinci komut verilmesin (F3). */
  disabled?: boolean;
  /** Başlık düzeyi; Şart editöründe grup başlığının (h3) altında 4. */
  headingLevel?: 3 | 4;
};

/** Geçiş desteği kartı: Kurucu ve "Şartı değiştir" (F3) için ortak. */
export function GecisDestegiKarti({ value, onChange, availability, disabled = false, headingLevel = 3 }: Props) {
  const live = useSimSource().kind === "live";
  const block = availability.ok ? undefined : availability.blocked.find((b) => b.settingId === "gecis_destegi");
  return (
    <SettingCard id="gecis_destegi" state="active" badges={["server"]} headingLevel={headingLevel}>
      {({ labelledBy }) => (
        <Stack gap="10" align="start">
          <div role="group" aria-labelledby={labelledBy}>
            <Stack gap="8" direction="row" wrap>
              {GECIS_SECENEKLERI.map((o) => (
                <Button
                  key={o}
                  variant="toggle"
                  size="sm"
                  pressed={value === o}
                  disabled={disabled}
                  onClick={() => onChange(o)}
                >
                  {t(`setting.gecis_destegi.options.${o}` as CopyKey)}
                </Button>
              ))}
            </Stack>
          </div>
          {block ? (
            <Banner tone="warn" asItem>
              {block.reason === "locked" || block.reason === "start_only"
                ? t("lock.yeni_kosu")
                : block.reason === "unverified"
                  ? t("kart.dogrulanmadi")
                  : t(live ? "lock.kayitsiz.live" : "lock.kayitsiz")}
            </Banner>
          ) : null}
          {live ? null : <p>{t("setting.gecis_destegi.eski_olcum")}</p>}
        </Stack>
      )}
    </SettingCard>
  );
}
