import { describe, expect, it } from "vitest";
import { COPY_EXCEPTIONS, type CopyException } from "../../fidelity/exceptions";
import { missingLines, prototypeFile, requirePrototypeLines } from "../../fidelity/copy-parity";

const none: CopyException[] = [];

describe("missingLines", () => {
  it("reports_nothing_when_every_prototype_line_is_on_the_page", () => {
    expect(missingLines("Cancel\nSign spend", "Cancel Sign spend", "C-09-Approval", none)).toEqual([]);
  });

  it("lists_each_prototype_line_the_page_lacks", () => {
    expect(missingLines("Cancel\nSign spend\nDone", "Cancel", "C-09-Approval", none)).toEqual(["Sign spend", "Done"]);
  });

  it("ignores_whitespace_and_line_breaks_when_matching", () => {
    const page = "Signing as\n0x91c4…a4F2\n\nNetwork   fee shown in your wallet";
    expect(missingLines("Signing as 0x91c4…a4F2\nNetwork fee shown in your wallet", page, "C-09-Approval", none)).toEqual([]);
  });

  it("is_exact_about_every_other_character", () => {
    expect(missingLines("Fee 5% · 0.05", "Fee 5% · 0.050", "C-Mobile", none)).toEqual([]);
    expect(missingLines("Fee 5% · 0.05", "Fee 6% · 0.05", "C-Mobile", none)).toEqual(["Fee 5% · 0.05"]);
    expect(missingLines("Atlas‑7", "Atlas-7", "C-Mobile", none)).toEqual(["Atlas‑7"]);
  });

  it("excuses_a_line_listed_for_that_screen_only", () => {
    const ex: CopyException[] = [{ screen: "C-09-Approval", kind: "omitted", line: "Join DAO", reason: "tab strip" }];
    expect(missingLines("Join DAO", "", "C-09-Approval", ex)).toEqual([]);
    expect(missingLines("Join DAO", "", "C-03-Treasury", ex)).toEqual(["Join DAO"]);
  });

  it("excuses_lines_by_pattern", () => {
    const ex: CopyException[] = [{ screen: "C-09-Approval", kind: "omitted", line: /^Transaction 0x\w+…\w+ ↗$/, reason: "mock tx hash" }];
    expect(missingLines("Transaction 0x6b0e…9d24 ↗", "", "C-09-Approval", ex)).toEqual([]);
  });

  it("does_not_treat_documented_additions_as_excuses", () => {
    const ex: CopyException[] = [{ screen: "C-05-DAOs", kind: "added", text: "Paper Lantern Translation", reason: "seventh row" }];
    expect(missingLines("Paper Lantern Translation", "", "C-05-DAOs", ex)).toEqual(["Paper Lantern Translation"]);
  });
});

describe("prototypeFile", () => {
  it("accepts_the_screen_name_with_or_without_the_extension", () => {
    expect(prototypeFile("C-09-Approval")).toMatch(/prototype\/C-09-Approval\.dc\.html$/);
    expect(prototypeFile("C-09-Approval.dc.html")).toMatch(/prototype\/C-09-Approval\.dc\.html$/);
  });

  it("rejects_names_that_could_leave_the_prototype_folder", () => {
    expect(() => prototypeFile("../package.json")).toThrow();
  });
});

describe("COPY_EXCEPTIONS", () => {
  it("every_entry_has_a_screen_and_a_reason", () => {
    for (const e of COPY_EXCEPTIONS) {
      expect(e.screen).toMatch(/^C-/);
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });

  it("is_sorted_by_screen_so_parallel_edits_merge_cleanly", () => {
    const screens = COPY_EXCEPTIONS.map((e) => e.screen);
    expect(screens).toEqual([...screens].sort());
  });

  it("seeds_the_owner_approved_and_contract_naming_deviations", () => {
    const has = (screen: string, kind: string, needle: string) =>
      COPY_EXCEPTIONS.some((e) => e.screen === screen && e.kind === kind && JSON.stringify([(e as { line?: unknown }).line?.toString(), (e as { text?: string }).text]).includes(needle));
    expect(has("C-09-Approval", "omitted", "Prototype · preview action")).toBe(true);
    expect(has("C-09-Approval", "omitted", "DAO registry")).toBe(true);
    expect(has("C-09-Approval", "omitted", "Lean Guild 0x8c11…02ab")).toBe(true);
    expect(has("C-05-DAOs", "added", "Paper Lantern Translation")).toBe(true);
    expect(has("C-07-Agents", "added", "Name")).toBe(true);
  });
});

describe("requirePrototypeLines", () => {
  it("throws_when_the_prototype_render_is_empty", () => {
    expect(() => requirePrototypeLines("", "C-09-Approval", { k: "typo" })).toThrow(/rendered no text/);
    expect(() => requirePrototypeLines(" \n\n  ", "C-09-Approval")).toThrow(/rendered no text/);
  });

  it("returns_the_text_when_there_is_at_least_one_line", () => {
    expect(requirePrototypeLines("\nCancel\n", "C-09-Approval")).toBe("\nCancel\n");
  });
});
