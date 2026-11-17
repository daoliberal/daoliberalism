"use client";
import { Anchor } from "@/components/primitives/Anchor";
import { Breadcrumb } from "@/components/primitives/Breadcrumb";
import { Card } from "@/components/primitives/Card";
import { Grid } from "@/components/primitives/Grid";
import { Table } from "@/components/primitives/Table";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { safeHref, displayHost, sanitizeText } from "@/data/metadata";
import { explorerUrl, splitKindOf } from "@/data/deployments";
import { isConfigurable, type ActionRequest, type Dao, type DaoMember, type Treasury } from "@/data/types";
import { formatBpsPercent, formatEthFlow, formatEthVolume, formatHoldDays, shortAddress } from "@/lib/format";
import { distributableOf, eachOwnerMin, ONE_ETH } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { useActionFlow } from "@/providers/actionFlow";
import { describeAction } from "@/providers/describeAction";
import { useDao, useDaoMembers, useDeployments, useMyAgents, useTreasury } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import styles from "./DaoDetail.module.css";
import { JoinPanel, JoinUnavailable } from "./JoinPanel";

function Frame({ children }: { children: React.ReactNode }) {
  return <main className={styles.main}>{children}</main>;
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Website({ uri }: { uri: string }) {
  const href = safeHref(uri);
  return href ? (
    <Anchor href={href}>{displayHost(uri)} ↗</Anchor>
  ) : (
    <>{sanitizeText(uri, 200)}</>
  );
}

function WorksUnder({ dao, treasury }: { dao: Dao; treasury: Treasury }) {
  const deployments = useDeployments();
  const href = `/treasury/?a=${treasury.address}`;
  const titleId = `works-${dao.id}`;
  return (
    <Card as="section" radius="lg" padding="md" gap="16" aria-labelledby={titleId}>
      <div className={styles.workHead}>
        <div>
          <h2 id={titleId} className={styles.workTitle}>
            Works under <Anchor href={href}>{treasury.metadata.name}</Anchor>
          </h2>
          <div className={styles.address}>{shortAddress(treasury.address)}</div>
        </div>
        <Anchor href={href} className={styles.full}>
          Full rulebook
        </Anchor>
      </div>
      {isConfigurable(treasury) && <Rules dao={dao} treasury={treasury} deployments={deployments} />}
      <p className={styles.phase}>In Phase 1 a DAO stays under the treasury it chose at creation. Switching by member vote comes later.</p>
    </Card>
  );
}

function Rules({ dao, treasury, deployments }: { dao: Dao; treasury: Extract<Treasury, { kind: "configurable" }>; deployments: ReturnType<typeof useDeployments> }) {
  const { feeBps, expenseBps, holdPeriod, maxAgents, splitRule } = treasury.config;
  const equal = splitKindOf(splitRule, deployments) === "equal";
  const distributable = distributableOf(ONE_ETH, feeBps, expenseBps);
  const owners = dao.memberCount;
  const cells: [string, string, boolean][] = [
    ["Treasury fee", `${formatBpsPercent(feeBps)}%`, true],
    ["Expenses", `${formatBpsPercent(expenseBps)}%`, true],
    ["Hold", formatHoldDays(holdPeriod), true],
    ["Split", equal ? "Equal" : "Custom", false],
    ["Seats", `${treasury.seatsUsed}/${maxAgents}`, true],
  ];
  return (
    <>
      <Grid minItem="130" gap="10">
        {cells.map(([label, value, mono]) => (
          <div key={label} className={styles.cell}>
            <div className={styles.cellLabel}>{label}</div>
            <div className={mono ? styles.cellValue : styles.cellText}>{value}</div>
          </div>
        ))}
      </Grid>
      <div className={styles.flow}>
        <span>Per 1 ETH order:</span>
        <span className={styles.flowNumber}>{formatEthFlow(distributable)}</span>
        {equal ? (
          <>
            <span>to {owners === 1 ? "1 member owner" : `${owners} member owners`}</span>
            <span className={styles.flowNumber}>≈ {formatEthFlow(eachOwnerMin(distributable, owners))}</span>
            <span>each, after {formatHoldDays(holdPeriod)}</span>
          </>
        ) : (
          <span>to members&apos; owners, after {formatHoldDays(holdPeriod)}</span>
        )}
      </div>
    </>
  );
}

function Members({ members }: { members: DaoMember[] }) {
  const deployments = useDeployments();
  const rows = members.map((m) => [
    <span key="n" className={styles.agentName}>
      {m.name}
      {m.isFounder && (
        <>
          {" "}
          <span className={styles.tag}>founder</span>
        </>
      )}
    </span>,
    <span key="k" className={styles.key}>
      {shortAddress(m.agentKey)}
    </span>,
    <Anchor key="o" href={explorerUrl(m.owner, deployments)} className={`${styles.key} ${styles.linkLike}`}>
      {shortAddress(m.owner)} ↗
    </Anchor>,
    <span key="j" className={styles.joined}>
      {formatDate(m.joinedAt)}
    </span>,
  ]);
  return (
    <Card as="section" radius="lg" padding="md" aria-labelledby="members">
      <h2 id="members" className={styles.membersTitle}>
        Members{" "}
        <span className={styles.count}>
          {members.length} {members.length === 1 ? "agent" : "agents"}
        </span>
      </h2>
      <Table columns="triple12" minWidth="md" density="compact" caption="Members" label="Agents table" header={["Agent", "Agent key", "Owner wallet", "Joined"]} rows={rows} />
    </Card>
  );
}

/** C-05b-DAO: one DAO, the treasury rules it works under, its members, and the join panel. */
export function DaoDetail({ id }: { id?: bigint }) {
  const dao = useDao(id);
  const treasury = useTreasury(dao.data?.treasury);
  const members = useDaoMembers(id);
  const agents = useMyAgents();
  const wallet = useWallet();
  const deployments = useDeployments();
  const flow = useActionFlow();

  if (id === undefined || dao.data === null) {
    return (
      <Frame>
        <Empty message="DAO not found." />
      </Frame>
    );
  }
  if (dao.isError || treasury.isError || members.isError || treasury.data === null) {
    return (
      <Frame>
        <ErrorState
          retry={() => {
            void dao.refetch();
            void treasury.refetch();
            void members.refetch();
          }}
        />
      </Frame>
    );
  }
  if (!dao.data || !treasury.data || !members.data) {
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  }

  const d = dao.data;
  const t = treasury.data;
  const list = members.data;
  // names (and their "Agent #<id>" fallback) come from the data layer; the founder is always in the member list
  const founder = list.find((m) => m.agentId === d.founderAgentId)?.name;

  const join = (agentId: bigint) => {
    const agent = agents.data?.find((a) => a.id === agentId);
    if (!agent || wallet.address === undefined || !isConfigurable(t)) return;
    const request: ActionRequest = { kind: "joinDao", daoId: d.id, agentId };
    flow.start(
      request,
      describeAction(request, { deployments, treasury: t, dao: d, agentName: agent.profile.name, memberCountAfter: d.memberCount + 1, signer: wallet.address }),
    );
  };

  return (
    <Frame>
      <Breadcrumb trail={[{ label: "DAOs", href: "/daos/" }, { label: d.metadata.name }]} />
      <div className={styles.columns}>
        <div className={styles.primary}>
          <div>
            <h1 className={styles.title}>{d.metadata.name}</h1>
            <p className={styles.desc}>{d.metadata.description}</p>
            <dl className={styles.facts}>
              {d.metadata.website && (
                <Fact term="Website">
                  <Website uri={d.metadata.website} />
                </Fact>
              )}
              <Fact term="DAO contract">
                <Anchor href={explorerUrl(d.address, deployments)} className={`${styles.mono} ${styles.linkLike}`}>
                  {shortAddress(d.address)} ↗
                </Anchor>
              </Fact>
              {founder !== undefined && <Fact term="Founder agent">{founder}</Fact>}
              <Fact term="Founded">{formatDate(d.createdAt)}</Fact>
              <Fact term="Volume">
                <span className={styles.mono}>{formatEthVolume(d.volume)} ETH</span>
              </Fact>
            </dl>
          </div>
          <WorksUnder dao={d} treasury={t} />
          <Members members={list} />
        </div>
        {isConfigurable(t) ? <JoinPanel dao={d} treasury={t} members={list} onJoin={join} /> : <JoinUnavailable />}
      </div>
      <ApprovalDialog flow={flow} />
    </Frame>
  );
}
