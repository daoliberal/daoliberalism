import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import type { UIValue } from "@/oyun/sim/types";

type Option = { value: string | number | boolean; label: string };

/** Seçenek düğmeleri (açık/kapalı dahil): basılı olan `aria-pressed`; grup `role="group"`. */
export function SecenekGrubu({ options, value, disabled, labelledBy, describedBy, onChange }: {
  options: Option[];
  value: UIValue;
  disabled: boolean;
  labelledBy: string;
  describedBy?: string;
  onChange(v: string | number | boolean): void;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <Stack gap="8" direction="row" wrap>
        {options.map((o) => (
          <Button key={String(o.value)} variant="toggle" size="sm" pressed={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </Button>
        ))}
      </Stack>
    </div>
  );
}
