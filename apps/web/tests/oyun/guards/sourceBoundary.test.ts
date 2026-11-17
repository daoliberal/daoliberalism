import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPEC = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']([^"']+)["']/g;
const specifiers = (_f: string, text: string): string[] => [...text.matchAll(SPEC)].map((m) => m[1]!);
const hitsReplay = (s: string): boolean => /(^|\/)sim\/replay(\/|$)/.test(s);
const hitsLive = (s: string): boolean => /(^|\/)sim\/live(\/|$)/.test(s) || /^\.\/live(\/|$)/.test(s);

const OYUN = path.resolve(__dirname, "../../../src/oyun");
function walk(dir: string): string[] {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
      })
    : [];
}

describe("kaynak sınırı", () => {
  it("denetim kendi sınaması", () => {
    expect(specifiers("x.ts", 'import a from "@/oyun/sim/replay/x"; const b = import("../sim/replay");').filter(hitsReplay)).toHaveLength(2);
    expect(hitsReplay("@/oyun/sim/SimSource")).toBe(false);
  });

  it("screens_sim_replay_iceri_aktarmaz", () => {
    const bad: string[] = [];
    for (const f of walk(path.join(OYUN, "screens")).filter((x) => /\.tsx?$/.test(x))) {
      for (const s of specifiers(f, fs.readFileSync(f, "utf8"))) {
        if (hitsReplay(s)) bad.push(`${f} -> ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("canlı kaynak sınırı", () => {
  it("denetim kendi sınaması", () => {
    expect(specifiers("x.ts", 'import a from "@/oyun/sim/live"; const b = import("../sim/live/probe");').filter(hitsLive)).toHaveLength(2);
    expect(hitsLive("@/oyun/sim/SimSource")).toBe(false);
  });

  it("sim_live_yalniz_OyunApp_tarafindan_iceri_aktarilir", () => {
    const bad: string[] = [];
    const liveDir = path.join(OYUN, "sim/live");
    for (const f of walk(OYUN).filter((x) => /\.tsx?$/.test(x))) {
      if (f.startsWith(liveDir + path.sep) || path.basename(f) === "OyunApp.tsx") continue;
      for (const s of specifiers(f, fs.readFileSync(f, "utf8"))) {
        if (hitsLive(s)) bad.push(`${f} -> ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("OyunApp_sim_live_iceri_aktarir", () => {
    const text = fs.readFileSync(path.join(OYUN, "OyunApp.tsx"), "utf8");
    expect(specifiers("OyunApp.tsx", text).some(hitsLive)).toBe(true);
  });

  it("src_disinda_replay_gibi_live_da_screens_icinde_yok", () => {
    const bad: string[] = [];
    for (const f of walk(path.join(OYUN, "screens")).filter((x) => /\.tsx?$/.test(x))) {
      for (const s of specifiers(f, fs.readFileSync(f, "utf8"))) if (hitsLive(s)) bad.push(`${f} -> ${s}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("zamanlayici sarmali", () => {
  it("replay_icinde_setTimeout_yalniz_timer_ts", () => {
    const bad: string[] = [];
    for (const f of walk(path.join(OYUN, "sim/replay")).filter((x) => /\.tsx?$/.test(x) && path.basename(x) !== "timer.ts")) {
      const text = fs.readFileSync(f, "utf8");
      if (/(?<!\.)\bsetTimeout\(/.test(text) || /(?<!\.)\bclearTimeout\(/.test(text)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
