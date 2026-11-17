import { describe, expect, expectTypeOf, it } from "vitest";
import type { RunState, SourceInfo } from "@/oyun/sim/types";
import { createContractFake } from "../helpers/fakeSource";
import { contractSuite } from "./contractSuite";

contractSuite("fakeSource", async () => {
  const source = createContractFake({ weeks: 6 });
  return {
    source,
    start: () => source.start({
      name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "t", durationWeeks: 6, seedIndex: 0, values: { gecis_destegi: "kapali" },
    }),
    advance: () => source.advance(),
    cleanup: () => source.dispose(),
  };
}, { refreshKeepsWeek: false });

describe("C1 tür eklemeleri (yalnız isteğe bağlı alanlar)", () => {
  it("RunState.buffering?/modelWeeksPerSec?; fixedRules[].valueText?", () => {
    expectTypeOf<RunState["buffering"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<RunState["modelWeeksPerSec"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SourceInfo["fixedRules"][number]["valueText"]>().toEqualTypeOf<string | undefined>();
    const r: SourceInfo["fixedRules"] = [{ settingId: "x", valueKey: "lock.sabit" }, { settingId: "y", valueKey: "lock.sabit", valueText: "%10" }];
    expect(r).toHaveLength(2);
  });
});
