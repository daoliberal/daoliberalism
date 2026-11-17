import { describe, expect, it } from "vitest";
import { encodeRunId, parseRunId } from "@/oyun/sim/replay/runId";
import { makeIndex } from "../../helpers/replayFixture";

const idx = makeIndex();
const rec = { setId: "kapali", seedIndex: 2, changes: [{ week: 40, setId: "kurtarma" }, { week: 90, setId: "kisa" }], name: "Ğüşi/ ?#~", cityNames: ["Ada", "Çınar", "x y", "~", "Ö"] };

describe("runId", () => {
  it("gidis donus", () => {
    const id = encodeRunId(rec);
    expect(id.startsWith("kapali.2.40_kurtarma.90_kisa~")).toBe(true);
    expect(parseRunId(id, idx)).toEqual(rec);
    expect(parseRunId(encodeRunId({ ...rec, changes: [] }), idx)).toEqual({ ...rec, changes: [] });
  });
  it("bozuk girdi null", () => {
    const ok = encodeRunId(rec);
    expect(parseRunId("", idx)).toBeNull();
    expect(parseRunId("çöp", idx)).toBeNull();
    expect(parseRunId("kapali.2", idx)).toBeNull();
    expect(parseRunId("kapali.6~" + ok.split("~")[1], idx)).toBeNull();
    expect(parseRunId("yok.1~" + ok.split("~")[1], idx)).toBeNull();
    expect(parseRunId("kapali.1.40_yok~" + ok.split("~")[1], idx)).toBeNull();
    expect(parseRunId("kapali.1.50_kisa.50_kurtarma~" + ok.split("~")[1], idx)).toBeNull();
    expect(parseRunId("kapali.1.50_kisa.40_kurtarma~" + ok.split("~")[1], idx)).toBeNull();
    expect(parseRunId("kapali.1~%E0%A4%A", idx)).toBeNull();
    expect(parseRunId("kapali.1~" + encodeURIComponent('{"name":1,"cityNames":[]}'), idx)).toBeNull();
  });
});
