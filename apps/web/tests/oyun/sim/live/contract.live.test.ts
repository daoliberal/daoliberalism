import { createLiveSource } from "@/oyun/sim/live";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";
import { contractSuite } from "../contractSuite";

// Tek sahte sunucu: "yenileme" testi aynı sunucuya ikinci bir kaynak bağlar.
const server = createFakeLiveServer();

contractSuite("LiveSource", async () => {
  const source = createLiveSource({ baseUrl: "", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  return {
    source,
    start: () => source.start({
      name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" },
    }),
    cleanup: () => source.dispose(),
  };
}, { refreshKeepsWeek: true });
