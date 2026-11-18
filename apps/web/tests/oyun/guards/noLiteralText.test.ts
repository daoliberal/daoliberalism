import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const LETTER = /\p{L}/u;
const TR_LETTER = /[çğıöşüÇĞİÖŞÜ]/;
const SPACE_LETTER = /\s\p{L}|\p{L}\s/u;
const TEXT_ATTRS = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-placeholder", "aria-valuetext", "title", "placeholder", "alt", "label", "caption"]);

/** Does the expression contain a text literal (string or template) as a possible result value? */
function hasLiteral(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return true;
  if (ts.isParenthesizedExpression(e)) return hasLiteral(e.expression);
  if (ts.isConditionalExpression(e)) return hasLiteral(e.whenTrue) || hasLiteral(e.whenFalse);
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken)
      return hasLiteral(e.left) || hasLiteral(e.right);
  }
  return false;
}

export function scanLiteralText(fileName: string, text: string): string[] {
  const isTs = fileName.endsWith(".ts");
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, isTs ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const found: string[] = [];
  const at = (n: ts.Node, what: string) => found.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${what}`);
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && LETTER.test(n.text)) at(n, "JSX metni");
    if (ts.isJsxExpression(n) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && hasLiteral(n.expression)) at(n, "JSX ifadesinde dize");
    if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf))) {
      const init = n.initializer;
      if (init && (ts.isStringLiteral(init) || (ts.isJsxExpression(init) && hasLiteral(init.expression)))) at(n, `${n.name.getText(sf)} dizesi`);
    }
    if (isTs && n.parent) {
      const isDirective = ts.isExpressionStatement(n.parent) && ts.isSourceFile(n.parent.parent) && ts.isStringLiteral(n);
      const isModule = (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) && n === n.parent.moduleSpecifier;
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !isDirective && !isModule && (TR_LETTER.test(n.text) || SPACE_LETTER.test(n.text))) at(n, "Türkçe/cümle dizesi");
      if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
        if (TR_LETTER.test(n.text) || SPACE_LETTER.test(n.text)) at(n, "Türkçe/cümle şablonu");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function walk(dir: string): string[] {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
      })
    : [];
}

describe("noLiteralText kural kendi sınaması", () => {
  const hit = (src: string, f = "x.tsx") => scanLiteralText(f, src).length > 0;
  it("yakalar", () => {
    expect(hit("const a = <p>Merhaba</p>;")).toBe(true);
    expect(hit('const a = <Button aria-label="Kapat"/>;')).toBe(true);
    expect(hit('const a = <Button aria-label={"x"}/>;')).toBe(true);
    expect(hit('const a = <p>{cond && "Hata"}</p>;')).toBe(true);
    expect(hit("const a = <p>{`Hafta ${n}`}</p>;")).toBe(true);
    expect(hit('const a = <p>{"Merhaba"}</p>;')).toBe(true);
    expect(hit('throw new Error("bir hata oldu");', "x.ts")).toBe(true);
    expect(hit('const a = "Şimdi";', "x.ts")).toBe(true);
  });
  it("yakalamaz", () => {
    expect(hit('const a = <p>{t("a.b")}</p>;')).toBe(false);
    expect(hit('const a = <span aria-hidden>●</span>;')).toBe(false);
    expect(hit('const a = <Button>{t("x")}</Button>;')).toBe(false);
    expect(hit('const a = "gecis_destegi";', "x.ts")).toBe(false);
    expect(hit("const a = <p className={styles.a}/>;")).toBe(false);
    expect(hit('"use client";\nexport const a = 1;', "x.ts")).toBe(false);
    expect(hit('import x from "next/navigation";', "x.ts")).toBe(false);
  });
});

describe("src/oyun merkezi metin", () => {
  it("copy_disinda_sabit_metin_yok", () => {
    const root = path.resolve(__dirname, "../../../src/oyun");
    // `tarayici/olcumKancasi.ts`: olcum betigindeki Python kaynak metni (`BELLEK_PY`, kullaniciya gosterilmez; B9 olcum kancasi, varsayilan kapali).
    // Istisna YALNIZ o bildirimin bulgusu icindir: dosyada baska bulgu cikarsa asagidaki denetim kirilir.
    const istisna = path.join(root, "tarayici", "olcumKancasi.ts");
    const files = walk(root).filter((f) => /\.tsx?$/.test(f) && f !== istisna && !f.startsWith(path.join(root, "copy") + path.sep));
    expect(files.length).toBeGreaterThan(0);
    const all = files.flatMap((f) => scanLiteralText(f, fs.readFileSync(f, "utf8")));
    expect(all).toEqual([]);
    const kaynak = fs.readFileSync(istisna, "utf8");
    const pySatiri = kaynak.slice(0, kaynak.indexOf("const BELLEK_PY")).split("\n").length;
    const bulgular = scanLiteralText(istisna, kaynak).filter((b) => !b.endsWith(`:${pySatiri} Türkçe/cümle dizesi`));
    expect(bulgular).toEqual([]);
  });
});
