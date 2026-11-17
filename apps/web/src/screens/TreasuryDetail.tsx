"use client";
import { useRef, useState } from "react";
import { explorerUrl } from "@/data/deployments";
import { isConfigurable, type Address, type ConfigurableTreasury } from "@/data/types";
import { formatEth, formatEthVolume, shortAddress } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { describeAction } from "@/providers/describeAction";
import { useActionFlow } from "@/providers/actionFlow";
import { useDaos, useDeployments, useTreasury, useTreasuryAccounting } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import { Anchor } from "@/components/primitives/Anchor";
import { Badge } from "@/components/primitives/Badge";
import { Breadcrumb } from "@/components/primitives/Breadcrumb";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Table } from "@/components/primitives/Table";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { useModalFocus } from "@/components/shell/useModalFocus";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { useIsNarrow } from "@/components/shell/useIsNarrow";
import { MoneyFlowCalculator } from "./MoneyFlowCalculator";
import { RulebookList } from "./RulebookList";
import { TreasuryBalance, type SpendRequest } from "./TreasuryBalance";
import { cx } from "@/components/primitives/cx";
import styles from "./TreasuryDetail.module.css";

const sameAddress = (a: string | undefined, b: string): boolean => a !== undefined && a.toLowerCase() === b.toLowerCase();

function DaosUnder({ treasury }: { treasury: ConfigurableTreasury }) {
  const daos = useDaos({ treasury: treasury.address });
  const name = treasury.metadata.name;
  return (
    <Card as="section" padding="lg" radius="lg" aria-labelledby="daos">
      <div className={styles.sectionHead}>
        <h2 id="daos" className={styles.heading}>
          DAOs under {name} <span className={styles.count}>{treasury.daoCount}</span>
        </h2>
        <Anchor href="/daos/" className={styles.seeAll}>
          See all {treasury.daoCount}
        </Anchor>
      </div>
      <div className={styles.daoTable}>
        {daos.isPending ? (
          <Loading />
        ) : daos.isError ? (
          <ErrorState retry={() => void daos.refetch()} />
        ) : (
          <Table
            columns="lead2"
            minWidth="md"
            caption={`DAOs under ${name}`}
            header={["DAO", "Members", "Volume", "Joined"]}
            rows={daos.data.map((d) => [
              <Anchor key="n" href={`/dao/?id=${d.id}`} className={styles.daoLink}>
                {d.metadata.name}
              </Anchor>,
              <span key="m" className={styles.mono}>
                {d.memberCount}
              </span>,
              <span key="v" className={styles.mono}>
                {formatEthVolume(d.volume)} ETH
              </span>,
              <span key="j" className={styles.joined}>
                {formatDate(d.createdAt)}
              </span>,
            ])}
          />
        )}
      </div>
    </Card>
  );
}

function HistorySheet({ treasury, onClose }: { treasury: ConfigurableTreasury; onClose(): void }) {
  const ref = useRef<HTMLElement>(null);
  useModalFocus(ref, true, onClose, "open");
  return (
    <BottomSheet labelledBy="bal-title" ref={ref}>
      <TreasuryBalance treasury={treasury} isFounder={false} onSpend={() => undefined} bare />
      <Button variant="secondary" onClick={onClose} data-autofocus="">
        Close
      </Button>
    </BottomSheet>
  );
}

function PhoneBoxes({ treasury }: { treasury: ConfigurableTreasury }) {
  const accounting = useTreasuryAccounting(treasury.address);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className={styles.boxes}>
      {historyOpen && <HistorySheet treasury={treasury} onClose={() => setHistoryOpen(false)} />}
      <div className={styles.box}>
        <div className={styles.boxLabel}>Treasury balance</div>
        <div className={styles.boxValue}>{accounting.data ? `${formatEth(accounting.data.balance)} ETH` : "—"}</div>
        <button type="button" aria-haspopup="dialog" data-touch-exempt="spending-history" className={styles.boxLink} onClick={() => setHistoryOpen(true)}>
          Spending history
        </button>
      </div>
      <div className={styles.box}>
        <div className={styles.boxLabel}>DAOs under it</div>
        <div className={styles.boxValue}>{treasury.daoCount}</div>
        <Anchor href="/daos/" className={styles.boxLink}>
          Browse DAOs
        </Anchor>
      </div>
    </div>
  );
}

/** Treasury detail (C-03 on a desktop, C-M2 on a phone). Only a treasury with readable rules is drawn. */
export function TreasuryDetail({ address }: { address?: Address }) {
  const narrow = useIsNarrow();
  const wallet = useWallet();
  const deployments = useDeployments();
  const flow = useActionFlow();
  const query = useTreasury(address);
  const accounting = useTreasuryAccounting(address);

  if (address === undefined) return <main className={styles.page}><Empty message="Treasury not found." /></main>;
  if (query.isPending) return <main className={styles.page}><Loading /></main>;
  if (query.isError) return <main className={styles.page}><ErrorState retry={() => void query.refetch()} /></main>;
  const treasury = query.data;
  if (treasury === null) return <main className={styles.page}><Empty message="Treasury not found." /></main>;
  if (!isConfigurable(treasury)) return <main className={styles.page}><Empty message="This treasury has no readable rules." /></main>;

  const { name, description } = treasury.metadata;
  const contract = (
    <Anchor href={explorerUrl(treasury.address, deployments)} className={styles.mono}>
      {shortAddress(treasury.address)} ↗
    </Anchor>
  );

  if (narrow) {
    return (
      <main className={cx(styles.page, styles.narrow)}>
        <div>
          <h1 className={styles.mTitle}>{name}</h1>
          <div className={styles.mFacts}>
            <Badge tone="fixed" lock compact>
              Rules fixed in Phase 1
            </Badge>
            {contract}
          </div>
        </div>
        <MoneyFlowCalculator treasury={treasury} variant="mobile" />
        <RulebookList treasury={treasury} variant="mobile" />
        <PhoneBoxes treasury={treasury} />
      </main>
    );
  }

  const isFounder = wallet.address !== undefined && sameAddress(wallet.address, treasury.founder);
  const onSpend = (request: SpendRequest) => {
    if (wallet.address === undefined || accounting.data === undefined) return;
    flow.start(request, describeAction(request, { deployments, treasury, balance: accounting.data.balance, signer: wallet.address }));
  };

  return (
    <main className={styles.page}>
      <Breadcrumb trail={[{ label: "Treasuries", href: "/treasuries/" }, { label: name }]} />

      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{name}</h1>
            <Badge tone="fixed" lock>
              Rules fixed in Phase 1
            </Badge>
          </div>
          {description !== "" && <p className={styles.description}>{description}</p>}
        </div>
        <dl className={styles.facts}>
          <dt className={styles.term}>Contract</dt>
          <dd className={styles.detail}>{contract}</dd>
          <dt className={styles.term}>Founder</dt>
          <dd className={cx(styles.detail, styles.mono)}>{shortAddress(treasury.founder)}</dd>
          <dt className={styles.term}>Deployed</dt>
          <dd className={styles.detail}>{formatDate(treasury.deployedAt)}</dd>
        </dl>
      </div>

      <div className={styles.columns}>
        <div className={styles.rulebook}>
          <RulebookList treasury={treasury} variant="desktop" />
        </div>
        <div className={styles.calculator}>
          <MoneyFlowCalculator treasury={treasury} variant="desktop" />
        </div>
      </div>

      <DaosUnder treasury={treasury} />
      <TreasuryBalance treasury={treasury} isFounder={isFounder} onSpend={onSpend} />
      <ApprovalDialog flow={flow} />
    </main>
  );
}
