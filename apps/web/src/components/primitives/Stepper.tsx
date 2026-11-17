import { Pill } from "./Pill";
import styles from "./Stepper.module.css";

type Step = { label: string; state: "todo" | "current" | "done"; onSelect(): void };

const TONE = { todo: "step", current: "stepCurrent", done: "stepDone" } as const;

export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol aria-label="Steps" className={styles.list}>
      {steps.map((step, i) => (
        <li key={i}>
          <Pill
            tone={TONE[step.state]}
            aria-current={step.state === "current" ? "step" : undefined}
            onClick={step.onSelect}
          >
            <span className={`${styles.dot} ${styles[step.state]}`}>{step.state === "done" ? "✓" : i + 1}</span>
            {step.label}
          </Pill>
        </li>
      ))}
    </ol>
  );
}
