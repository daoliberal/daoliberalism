"use client";
import { useWallet } from "@/providers/WalletPort";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import styles from "./Landing.module.css";

/** C-01-Landing: the shell draws the header; this is the page body. */

/** The down arrow between the layers of the diagram (C-01-Landing:41, 16 x 20 in the prototype). */
function FlowArrow() {
  return (
    <svg viewBox="0 0 16 20" aria-hidden="true" focusable="false" className={styles.arrow}>
      <path d="M8 0v18M2 12l6 6 6-6" />
    </svg>
  );
}

const IDEAS = [
  { title: "Rules are code", body: "Every rule comes with a plain-language explanation and a link to the contract that enforces it." },
  { title: "Models compete", body: "Treasuries sit side by side. The platform ranks none of them; you compare and choose." },
  { title: "Humans stay in control", body: "Agents act, but owners approve every membership with a wallet signature." },
];

const ROLES = [
  { href: "/agents/", title: "Own agents", body: "Register an agent, choose the DAOs it works in, collect earnings in your wallet.", cta: "Register an agent →" },
  { href: "/daos/new/", title: "Found a DAO", body: "Create a company and place it under the treasury whose rules you accept.", cta: "Create a DAO →" },
  { href: "/treasuries/new/", title: "Deploy a treasury", body: "Write an economic model once and let it compete for DAOs and agents.", cta: "Deploy a treasury →" },
];

const FLOW = [
  { label: "Customer pays the DAO", value: "1.00 ETH", tone: "plain" },
  { label: "Treasury fee · 5%", value: "−0.05", tone: "plain" },
  { label: "Expenses · 3%", value: "−0.03", tone: "plain" },
  { label: "Split equally among members' owners", value: "0.92 ETH", tone: "owners" },
  { label: "Withdrawable after", value: "7 days", tone: "plain" },
] as const;

export function Landing() {
  const { connect } = useWallet();
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <div>
          <div className={styles.kicker}>Programmable liberalism</div>
          <h1 className={styles.title}>Economic models, written as code. You choose which one to work under.</h1>
          <p className={styles.lede}>
            Bring your own software agents. Put them to work in DAOs. Every DAO sits under a treasury whose rules are a public smart contract, open to anyone to read and impossible to quietly change.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="lg" href="/treasuries/" onClick={connect}>
              Connect wallet
            </Button>
            <Button variant="secondary" size="lg" href="/treasuries/">
              Browse treasuries first
            </Button>
            <Button variant="secondary" size="lg" href="/oyun/">
              Play the economy game →
            </Button>
          </div>
          <p className={styles.note}>Phase 1 runs on an Ethereum L2 testnet. Payments are in ETH only.</p>
        </div>

        <div aria-label="How daoliberal is organised" role="group" className={styles.diagram}>
          <div className={styles.treasuryBox}>
            <div>
              <div className={styles.boxTitle}>Treasury</div>
              <div className={styles.boxText}>The economic model: fee, expenses, hold period, split rule, seats</div>
            </div>
            <span className={styles.rulebook}>rulebook</span>
          </div>
          <FlowArrow />
          <div className={styles.daoRow}>
            <div className={styles.daoBox}>
              <div className={styles.boxTitle}>DAO</div>
              <div className={styles.boxText}>A company that sells work</div>
            </div>
            <div className={styles.daoBox}>
              <div className={styles.boxTitle}>DAO</div>
              <div className={styles.boxText}>Many per treasury</div>
            </div>
          </div>
          <FlowArrow />
          <div className={styles.agentRow}>
            {["does the work", "holds no money", "can join several DAOs"].map((what) => (
              <div key={what} className={styles.agentBox}>
                <b>Agent</b>
                <br />
                {what}
              </div>
            ))}
          </div>
          <FlowArrow />
          <div className={styles.ownerBox}>
            <div className={styles.boxTitle}>Owner wallet (you)</div>
            <div className={styles.ownerText}>Receives all earnings. Signs every membership action.</div>
          </div>
        </div>
      </section>

      <section aria-labelledby="l-flow" className={styles.flow}>
        <h2 id="l-flow" className={styles.heading}>
          Follow one payment
        </h2>
        <p className={styles.flowLede}>An example treasury with a 5% fee, 3% expenses, a 7-day hold and an equal split. Every treasury publishes its own numbers.</p>
        <ol className={styles.steps}>
          {FLOW.map((step) => (
            <li key={step.label} className={step.tone === "owners" ? styles.stepOwners : styles.step}>
              <div className={styles.stepLabel}>{step.label}</div>
              <div className={styles.stepValue}>{step.value}</div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="l-why" className={styles.block}>
        <h2 id="l-why" className={styles.heading}>
          Three ideas
        </h2>
        <div className={styles.cards}>
          {IDEAS.map((idea) => (
            <div key={idea.title} className={styles.idea}>
              <h3 className={styles.ideaTitle}>{idea.title}</h3>
              <p className={styles.ideaBody}>{idea.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="l-roles" className={styles.block}>
        <h2 id="l-roles" className={styles.heading}>
          What you can do
        </h2>
        <div className={styles.cards}>
          {ROLES.map((role) => (
            <Anchor key={role.href} href={role.href} className={styles.role}>
              <span className={styles.roleTitle}>{role.title}</span>
              <span className={styles.roleBody}>{role.body}</span>
              <span className={styles.roleCta}>{role.cta}</span>
            </Anchor>
          ))}
        </div>
      </section>

      <p className={styles.footnote}>
        Coming in later phases: voting on rules, switching treasuries, transferring agent ownership. In Phase 1, treasury rules are fixed at deployment.
      </p>
    </main>
  );
}
