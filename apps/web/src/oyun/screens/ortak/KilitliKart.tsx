import { Button } from "@/components/primitives/Button";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { SettingCard, type SettingId } from "@/oyun/ui/SettingCard";

/** Kayıtta sabit olan kural: kontrol kapalı, neden görünür ve `aria-describedby` ile okunur. */
export function KilitliKart({ settingId, valueKey, valueText }: { settingId: SettingId; valueKey: CopyKey; valueText?: string }) {
  const live = useSimSource().kind === "live";
  return (
    <SettingCard id={settingId} state="locked" lockReason={live ? "lock.sabit.live" : "lock.sabit"}>
      {({ disabled, describedBy, labelledBy }) => (
        <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
          <Button variant="toggle" size="sm" pressed disabled={disabled}>
            {valueText ?? t(valueKey)}
          </Button>
        </div>
      )}
    </SettingCard>
  );
}
