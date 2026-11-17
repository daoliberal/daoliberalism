"use client";
import { useState } from "react";

/**
 * Step state for a wizard of `total` steps (1..total). Forward moves need every step before the target to be valid,
 * so an invalid step can't be skipped even through the stepper (the prototype's stepper allows it).
 */
export function useWizard(total: number, isStepValid: (step: number) => boolean) {
  const [step, setStep] = useState(1);

  const allValidBefore = (k: number): boolean => {
    for (let s = 1; s < k; s++) if (!isStepValid(s)) return false;
    return true;
  };

  return {
    step,
    go(k: number) {
      if (!Number.isInteger(k) || k < 1 || k > total) return;
      if (k > step && !allValidBefore(k)) return;
      setStep(k);
    },
    next() {
      if (step < total && isStepValid(step)) setStep(step + 1);
    },
    back() {
      setStep((s) => Math.max(1, s - 1));
    },
    canSign: allValidBefore(total + 1),
  };
}
