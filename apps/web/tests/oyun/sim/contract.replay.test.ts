import { createReplaySource } from "@/oyun/sim/replay";
import { allFiles, fakeTimer, makeFetch } from "../helpers/replayFixture";
import { contractSuite } from "./contractSuite";

contractSuite("ReplaySource", async () => {
  const timer = fakeTimer();
  const source = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(allFiles()), timer });
  return {
    source,
    start: () => source.start({
      name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" },
    }),
    advance: (ms) => timer.advance(ms),
    cleanup: () => source.dispose(),
  };
}, { refreshKeepsWeek: false });
