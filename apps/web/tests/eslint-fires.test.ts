import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(__dirname, "..");

function lint(source: string) {
  const res = spawnSync(
    path.join(WEB, "node_modules/.bin/eslint"),
    ["--stdin", "--stdin-filename", "x.tsx", "--format", "json"],
    { cwd: WEB, input: source, encoding: "utf8" },
  );
  const report = JSON.parse(res.stdout) as { messages: { ruleId: string | null }[] }[];
  return { status: res.status, ruleIds: report.flatMap((r) => r.messages.map((m) => m.ruleId)) };
}

describe("eslint design bans", () => {
  it("forbid_dom_props_and_no_danger_fire", () => {
    const src = [
      "export function X() {",
      "  return (",
      "    <div>",
      "      <div style={{}} />",
      '      <div dangerouslySetInnerHTML={{ __html: "x" }} />',
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    const { status, ruleIds } = lint(src);
    expect(status).toBe(1);
    expect(ruleIds).toContain("react/forbid-dom-props");
    expect(ruleIds).toContain("react/no-danger");
  }, 60_000);

  it("clean_source_passes", () => {
    const { status, ruleIds } = lint(
      "export function X() {\n  return <div className=\"a\" />;\n}\n",
    );
    expect(ruleIds).toEqual([]);
    expect(status).toBe(0);
  }, 60_000);
});
