import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplaySource } from "@/oyun/sim/replay";
import { fakeTimer } from "../../helpers/replayFixture";

const root = path.resolve(process.cwd(), "public/oyun-kayit");
const fetchImpl = (async (url: string) => {
  try {
    return new Response(readFileSync(path.join(root, url.replace(/^\/oyun-kayit\//, ""))), { status: 200 });
  } catch {
    return new Response("", { status: 404 });
  }
}) as unknown as typeof fetch;

async function modeAt(target: string, seam: number): Promise<string> {
  const timer = fakeTimer();
  const src = createReplaySource({ baseUrl: "/oyun-kayit", fetchImpl, timer, computeMs: 10 });
  const h = await src.start({ name: "A", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } });
  for (let i = 0; i < seam; i++) await src.control(h.runId, { action: "step" });
  const p = src.applyChange(h.runId, { from: "next_week", patch: { gecis_destegi: target } });
  for (let i = 0; i < 200; i++) await Promise.resolve();
  timer.advance(10);
  const r = await p;
  src.dispose();
  if (!r.accepted) throw new Error(JSON.stringify(r));
  return r.mode;
}

describe("gercek kayit: dikis modu", () => {
  it.each([[8, "exact"], [26, "exact"], [27, "nearest"]])("kapali -> kurtarma, seam %i -> %s", async (seam, mode) => {
    expect(await modeAt("kurtarma_fonuyla", seam)).toBe(mode);
  });
  it.each([[26, "exact"], [27, "exact"], [28, "nearest"]])("kapali -> kisa, seam %i -> %s", async (seam, mode) => {
    expect(await modeAt("kisa_sureli", seam)).toBe(mode);
  });
});
