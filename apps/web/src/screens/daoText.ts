import { splitKindOf, type Deployments } from "@/data/deployments";
import { isConfigurable, type Treasury } from "@/data/types";
import { formatBpsPercent, formatHoldDays } from "@/lib/format";

/** "7-day hold", with the same thousands grouping as everywhere else ("49,710-day hold"). */
export function holdWord(seconds: number): string {
  return `${formatHoldDays(seconds).replace(/ days?$/, "")}-day hold`;
}

/** "5% fee · 3% exp · 7-day hold · Equal" (C-05-DAOs R map); undefined when the treasury's rules cannot be read. */
export function ruleSummary(t: Treasury, d: Deployments): string | undefined {
  if (!isConfigurable(t)) return undefined;
  return [
    `${formatBpsPercent(t.config.feeBps)}% fee`,
    `${formatBpsPercent(t.config.expenseBps)}% exp`,
    holdWord(t.config.holdPeriod),
    splitKindOf(t.config.splitRule, d) === "equal" ? "Equal" : "Custom",
  ].join(" · ");
}
