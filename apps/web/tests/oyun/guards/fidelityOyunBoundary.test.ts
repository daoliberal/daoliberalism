import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const DIR = path.resolve(__dirname, "../../../fidelity/oyun");
const ALLOWED = [/^\.\.\/prototype-render$/, /^\.\.\/copy-parity$/, /^\.\.\/helpers$/, /^\.\/[\w-]+$/, /^\.\/exceptions\/[\w-]+$/, /^@playwright\/test$/, /^node:/];

function specifiers(text: string): string[] {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("fidelity/oyun imports", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  it("has files", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`${f} imports only allowed modules`, () => {
      const bad = specifiers(fs.readFileSync(path.join(DIR, f), "utf8")).filter((s) => !ALLOWED.some((r) => r.test(s)));
      expect(bad).toEqual([]);
    });
  }
});
