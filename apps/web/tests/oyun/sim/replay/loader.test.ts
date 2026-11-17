import { describe, expect, it } from "vitest";
import { createLoader, RecordingError } from "@/oyun/sim/replay/loader";
import { allFiles, makeFetch, runJson } from "../../helpers/replayFixture";
import fs from "node:fs";
import path from "node:path";

const mk = (files: Record<string, string>) => createLoader({ baseUrl: "/k", fetchImpl: makeFetch(files) });
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof RecordingError ? e.code : "other"));

describe("loader", () => {
  it("acar ve onbellekler", async () => {
    const f = makeFetch(allFiles());
    const l = createLoader({ baseUrl: "/k", fetchImpl: f });
    const run = await l.loadRun("kapali", 1);
    expect(run.weeks).toBe(200);
    expect(run.cols.served).toHaveLength(200);
    await l.loadRun("kapali", 1);
    await l.loadIndex();
    expect(f.calls.filter((u) => u.endsWith("pm1.json"))).toHaveLength(1);
    expect(f.calls.filter((u) => u.endsWith("index.json"))).toHaveLength(1);
  });
  it("404 http", async () => {
    const files = allFiles();
    delete files["/k/kapali/pm0.json"];
    expect(await code(mk(files).loadRun("kapali", 0))).toBe("http");
    expect(await code(mk({}).loadIndex())).toBe("http");
  });
  it("bozuk json ve sekil", async () => {
    const files = allFiles();
    files["/k/kapali/pm0.json"] = "{bozuk";
    expect(await code(mk(files).loadRun("kapali", 0))).toBe("json");
    files["/k/kapali/pm1.json"] = runJson("kapali", 1, () => ({}), 199);
    expect(await code(mk(files).loadRun("kapali", 1))).toBe("shape");
    expect(await code(mk(allFiles()).loadRun("yok", 0))).toBe("shape");
    expect(await code(mk(allFiles()).loadRun("kapali", 6))).toBe("shape");
    expect(new RecordingError("json").message).toBe("json");
  });
  it("paketlere acar, eksik ve NaN null", async () => {
    const files = allFiles();
    const r = JSON.parse(files["/k/kapali/pm0.json"]!);
    r.cols.served[4] = null;
    r.cols.gini[5] = "x";
    files["/k/kapali/pm0.json"] = JSON.stringify(r);
    const l = mk(files);
    const p = (await import("@/oyun/sim/replay/loader")).toPackets(await l.loadRun("kapali", 0), "r");
    expect(p).toHaveLength(200);
    expect(p[0]!.week).toBe(1);
    expect(p[4]!.world.served).toBeNull();
    expect(p[5]!.world.gini).toBeNull();
    expect(p[0]!.world.price_index).toBeNull();
    expect(p[0]!.world.served).toBe(1);
  });
  it("gercek V2 dosyasi", async () => {
    const root = path.resolve(__dirname, "../../../../public/oyun-kayit");
    const files: Record<string, string> = {};
    files["/oyun-kayit/index.json"] = fs.readFileSync(path.join(root, "index.json"), "utf8");
    files["/oyun-kayit/kapali/pm0.078.json"] = fs.readFileSync(path.join(root, "kapali/pm0.078.json"), "utf8");
    const l = createLoader({ fetchImpl: makeFetch(files) });
    const idx = await l.loadIndex();
    expect(idx.sets.map((s) => s.id)).toEqual(["kapali", "kisa", "kurtarma"]);
    const { toPackets } = await import("@/oyun/sim/replay/loader");
    const p = toPackets(await l.loadRun("kapali", 0), "r");
    expect(p).toHaveLength(200);
    expect(p[199]!.world.served).not.toBeNull();
  });
});
