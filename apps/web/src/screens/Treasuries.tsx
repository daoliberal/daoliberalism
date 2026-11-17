"use client";
import { useState, type ChangeEvent } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Pill } from "@/components/primitives/Pill";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { useIsNarrow } from "@/components/shell/useIsNarrow";
import { isConfigurable, type Address, type ConfigurableTreasury } from "@/data/types";
import { useDeployments, useTreasuries } from "@/providers/hooks";
import { amountOf, filterTreasuries, sortTreasuries, type TreasuryFilter, type TreasurySort } from "@/lib/treasuryView";
import { CompareTable } from "./CompareTable";
import { TreasuryCard, TreasuryCardNarrow } from "./TreasuryCard";
import styles from "./Treasuries.module.css";

const DEFAULT_AMOUNT = "1.00";
/** C-02-Treasuries: these two start selected for comparison. */
const PRESELECTED = ["Commonwealth", "Meritline"];

const FILTERS: { key: TreasuryFilter; label: string; short: string }[] = [
  { key: "all", label: "All", short: "All" },
  { key: "open", label: "Seats open", short: "Seats open" },
  { key: "short", label: "Short hold (≤ 7 days)", short: "Hold ≤ 7 d" },
  { key: "equal", label: "Equal split", short: "Equal split" },
];

const SORTS: { key: TreasurySort; label: string }[] = [
  { key: "name", label: "Name A–Z" },
  { key: "owners", label: "Most to owners" },
  { key: "hold", label: "Shortest hold" },
  { key: "seats", label: "Most seats open" },
];

const isSort = (v: string): v is TreasurySort => SORTS.some((s) => s.key === v);

/** C-02-Treasuries on a desktop viewport, C-M1-Treasuries (cards only, no comparison) at 720px and below. */
export function Treasuries() {
  const narrow = useIsNarrow();
  const query = useTreasuries();
  const deployments = useDeployments();
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [view, setView] = useState<"cards" | "compare">("cards");
  const [filter, setFilter] = useState<TreasuryFilter>("all");
  const [sort, setSort] = useState<TreasurySort>("name");
  const [chosen, setChosen] = useState<ReadonlySet<Address> | null>(null);

  const amount = amountOf(amountText);
  // Explorer 1b lists the configurable treasuries only; external ones have no rulebook of their own to compare.
  const all = (query.data ?? []).filter(isConfigurable);
  const picked: ReadonlySet<Address> = chosen ?? new Set(all.filter((t) => PRESELECTED.includes(t.metadata.name)).map((t) => t.address));
  const toggle = (t: ConfigurableTreasury) => {
    const next = new Set(picked);
    if (!next.delete(t.address)) next.add(t.address);
    setChosen(next);
  };

  const onAmount = (e: ChangeEvent<HTMLInputElement>) => setAmountText(e.target.value);
  const shown = sortTreasuries(filterTreasuries(all, filter, deployments), narrow ? "name" : sort);

  let body;
  if (query.isPending) body = <Loading />;
  else if (query.isError) body = <ErrorState retry={() => void query.refetch()} />;
  else body = null;
  const loaded = body === null;

  if (narrow) {
    return (
      <main className={styles.mMain}>
        <h1 className={styles.mTitle}>Choose the economy your agent works in</h1>
        <div className={styles.mCalc}>
          <Field kind="input" id="m1-amt" label="If a customer pays" phone mono suffixMono fontSize="18" suffix="ETH" inputMode="decimal" value={amountText} onChange={onAmount} />
        </div>
        <div className={styles.mChips}>
          {FILTERS.map((f) => (
            <Pill key={f.key} tone={filter === f.key ? "mChipOn" : "mChip"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.short}
            </Pill>
          ))}
        </div>
        {body}
        {loaded && (
          <>
            <p className={styles.mCount}>{shown.length} treasuries · sorted by name · no ranking</p>
            {shown.length === 0 && <Empty message="No treasuries match this filter." />}
            {shown.map((t) => (
              <TreasuryCardNarrow key={t.address} t={t} amount={amount} />
            ))}
          </>
        )}
      </main>
    );
  }

  const pickedAll = all.filter((t) => picked.has(t.address));
  const pickedShown = shown.filter((t) => picked.has(t.address));
  return (
    <>
      <main className={styles.main}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.title}>Choose the economy your agent works in</h1>
            <p className={styles.lede}>
              Every treasury publishes its rules as code. Same question for each: if a customer pays, how much reaches the owners, and when?
            </p>
          </div>
          <div className={styles.calc}>
            <Field
              kind="input"
              id="t-amt"
              label="If a customer pays"
              large
              mono
              suffixMono
              fontSize="22"
              width="100"
              gap="10"
              suffix="ETH"
              hint="every treasury below recalculates"
              hintPlacement="inline"
              inputMode="decimal"
              value={amountText}
              onChange={onAmount}
            />
          </div>
        </div>

        <div className={styles.controls}>
          <div role="group" aria-label="View" className={styles.views}>
            <Button variant="toggle" pressed={view === "cards"} onClick={() => setView("cards")}>
              Cards
            </Button>
            <Button variant="toggle" pressed={view === "compare"} onClick={() => setView("compare")}>
              Side by side ({pickedAll.length})
            </Button>
          </div>
          {FILTERS.map((f) => (
            <Pill key={f.key} tone={filter === f.key ? "chipOn" : "chip"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </Pill>
          ))}
          <div className={styles.sort}>
            <Field kind="select" id="t-sort" label="Sort" compact fontSize="14" labelPlacement="inline" value={sort} onChange={(e) => isSort(e.target.value) && setSort(e.target.value)}>
              {SORTS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Field>
          </div>
        </div>

        {loaded ? (
          <>
            <p className={styles.count}>
              {shown.length} of {all.length} treasuries · Sort is your choice. The platform doesn&apos;t rank or recommend.
            </p>
            {view === "cards" ? (
              <div className={styles.list}>
                {shown.length === 0 ? (
                  <Empty message="No treasuries match this filter." />
                ) : (
                  <Grid minItem="520" gap="20">
                    {shown.map((t) => (
                      <TreasuryCard key={t.address} t={t} amount={amount} picked={picked.has(t.address)} onToggle={() => toggle(t)} />
                    ))}
                  </Grid>
                )}
              </div>
            ) : (
              <div className={styles.compare}>
                <CompareTable treasuries={pickedShown} amountText={amountText} amount={amount} />
                {pickedShown.length < 2 && <p className={styles.tooFew}>Select at least two treasuries in the card view to compare them side by side.</p>}
              </div>
            )}
          </>
        ) : (
          <div className={styles.list}>{body}</div>
        )}

        <p className={styles.footnote}>
          Values come straight from each contract. Phase 1 rules can&apos;t be changed once deployed. Want to write your own model? <Anchor href="/treasuries/new/">Deploy a treasury</Anchor>.
        </p>
      </main>

      {loaded && view === "cards" && pickedAll.length > 0 && (
        <div className={styles.trayWrap}>
          <div className={styles.tray}>
            <span className={styles.trayCount}>{pickedAll.length} selected</span>
            <span className={styles.trayNames}>{pickedAll.map((t) => t.metadata.name).join(" · ")}</span>
            <div className={styles.trayAction}>
              <Button variant="panelLight" size="sm" onClick={() => setView("compare")}>
                Compare side by side
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
