import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");
const OYUN = path.join(SRC, "oyun");
const ALLOWED = [
  /^@\/components\/primitives\//,
  /^@\/components\/shell\/(Logo|useIsNarrow|useModalFocus)$/,
  /^@\/oyun\//,
  /^react$/,
  /^react\//,
  /^next\//,
  /^pixi\.js(\/unsafe-eval)?$/,
  /^@pixi\/react$/,
];

/** `react-dom` YALNIZ portal kullanan dosyalarda (B10: bildirim bantlari OyunEkrani yuvasina `createPortal` ile tasinir). */
const REACT_DOM_DOSYALARI = [path.join(OYUN, "OyunApp.tsx")];

export function specifiers(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const a = n.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.push(a.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string): string[] {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
      })
    : [];
}
const code = (f: string) => /\.tsx?$/.test(f);

describe("sınır denetimi kendi sınaması", () => {
  it("dört içe aktarma biçimini bulur", () => {
    const s = specifiers("x.ts", 'import a from "a"; export { b } from "b"; const c = import("c"); const d = require("d");');
    expect(s).toEqual(["a", "b", "c", "d"]);
  });
});

describe("sınırlar", () => {
  it("oyun_yalniz_izinli_onekleri_iceri_aktarir", () => {
    const bad: string[] = [];
    for (const f of walk(OYUN).filter(code))
      for (const s of specifiers(f, fs.readFileSync(f, "utf8"))) {
        if (s.startsWith(".")) {
          const target = path.resolve(path.dirname(f), s);
          if (!target.startsWith(OYUN)) bad.push(`${f}: ${s}`);
        } else if (s === "react-dom" ? !REACT_DOM_DOSYALARI.includes(f) : !ALLOWED.some((re) => re.test(s))) bad.push(`${f}: ${s}`);
      }
    expect(bad).toEqual([]);
  });

  it("site_kaynagi_oyunu_iceri_aktarmaz", () => {
    const bad: string[] = [];
    for (const d of ["components", "screens", "data", "providers", "lib", "app"]) {
      const dir = path.join(SRC, d);
      for (const f of walk(dir).filter(code)) {
        if (f.startsWith(path.join(SRC, "app", "oyun") + path.sep)) continue;
        for (const s of specifiers(f, fs.readFileSync(f, "utf8"))) if (/(^|\/)oyun(\/|$)/.test(s)) bad.push(`${f}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
