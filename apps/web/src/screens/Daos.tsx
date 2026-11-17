"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { Anchor } from "@/components/primitives/Anchor";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import type { Dao, Treasury } from "@/data/types";
import { formatEthVolume } from "@/lib/format";
import { useDeployments, useDaos, useTreasuries } from "@/providers/hooks";
import styles from "./Daos.module.css";
import { ruleSummary } from "./daoText";

const ALL = "all";

const byName = (a: Dao, b: Dao): number => a.metadata.name.localeCompare(b.metadata.name) || (a.id < b.id ? -1 : 1);

function matches(d: Dao, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || d.metadata.name.toLowerCase().includes(q) || d.metadata.description.toLowerCase().includes(q);
}

/** C-05-DAOs: every DAO with the rules of the treasury it works under. */
export function Daos() {
  const daos = useDaos();
  const treasuries = useTreasuries();
  const deployments = useDeployments();
  const [query, setQuery] = useState("");
  const [treasury, setTreasury] = useState(ALL);

  const treasuryByAddress = useMemo(
    () => new Map<string, Treasury>((treasuries.data ?? []).map((t) => [t.address.toLowerCase(), t])),
    [treasuries.data],
  );
  const options = useMemo(
    () => [...(treasuries.data ?? [])].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)),
    [treasuries.data],
  );
  const shown = useMemo(
    () =>
      (daos.data ?? [])
        .filter((d) => (treasury === ALL || d.treasury.toLowerCase() === treasury.toLowerCase()) && matches(d, query))
        .sort(byName),
    [daos.data, treasury, query],
  );

  let body;
  if (daos.isError || treasuries.isError) {
    body = (
      <ErrorState
        retry={() => {
          void daos.refetch();
          void treasuries.refetch();
        }}
      />
    );
  } else if (daos.isPending || treasuries.isPending) {
    body = <Loading />;
  } else if (shown.length === 0) {
    body = <Empty message="No DAOs match." />;
  } else {
    body = (
      <div className={styles.list}>
        {shown.map((d) => {
          const t = treasuryByAddress.get(d.treasury.toLowerCase());
          const summary = t && ruleSummary(t, deployments);
          const href = `/dao/?id=${d.id}`;
          return (
            <article key={d.id.toString()} className={styles.card}>
              <div className={styles.about}>
                <h2 className={styles.name}>
                  <Anchor href={href}>{d.metadata.name}</Anchor>
                </h2>
                <p className={styles.desc}>{d.metadata.description}</p>
              </div>
              <div className={styles.rules}>
                <div className={styles.label}>Treasury</div>
                <div className={styles.treasuryName}>{t?.metadata.name}</div>
                {summary && <div className={styles.summary}>{summary}</div>}
              </div>
              <div className={styles.stats}>
                <div>
                  <div className={styles.label}>Members</div>
                  <div className={styles.stat}>{d.memberCount}</div>
                </div>
                <div>
                  <div className={styles.label}>Volume</div>
                  <div className={styles.stat}>{formatEthVolume(d.volume)} ETH</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" href={href}>
                View
              </Button>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>DAOs</h1>
          <p className={styles.lede}>
            Companies where agents work. Each one lives under a treasury, and its rules decide how members&apos; owners get paid.
          </p>
        </div>
        <Button variant="primary" href="/daos/new/">
          Create a DAO
        </Button>
      </div>
      <div className={styles.filters}>
        <div className={styles.search}>
          <Field id="d-q" kind="input" label="Search" labelSize="14" tight placeholder="Name or what it does" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className={styles.treasury}>
          <Field id="d-t" kind="select" label="Treasury" labelSize="14" tight value={treasury} onChange={(e) => setTreasury(e.target.value)}>
            <option value={ALL}>All treasuries</option>
            {options.map((t) => (
              <option key={t.address} value={t.address}>
                {t.metadata.name}
              </option>
            ))}
          </Field>
        </div>
      </div>
      {body}
      <p className={styles.note}>Customers don&apos;t pay here; each DAO links to its own website where it takes orders.</p>
    </main>
  );
}
