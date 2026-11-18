// Derleme zamani: npm paketi pyodide@0.27.7'nin YALNIZ cekirdek dosyalarini public/pyodide/0.27.7/ altina kopyalar (bayt bayt).
// Kullanim: node scripts/pyodideKopyala.mjs [--cikis DIZIN]
// Ek Python paketi yok (model saf stdlib); pyodide-lock.json yukleyici tarafindan okunur.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const PYODIDE_SURUMU = "0.27.7";
export const CEKIRDEK_DOSYALARI = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

export function npmDizini() {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve("pyodide/package.json"));
}

export function kopyala(cikis) {
  const kaynak = npmDizini();
  const surum = JSON.parse(readFileSync(path.join(kaynak, "package.json"), "utf-8")).version;
  if (surum !== PYODIDE_SURUMU) throw new Error(`pyodide ${surum} kurulu, ${PYODIDE_SURUMU} bekleniyordu`);
  mkdirSync(cikis, { recursive: true });
  for (const d of CEKIRDEK_DOSYALARI) copyFileSync(path.join(kaynak, d), path.join(cikis, d));
  return { kaynak, cikis, dosyalar: CEKIRDEK_DOSYALARI };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--cikis");
  const cikis = i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/pyodide", PYODIDE_SURUMU);
  const r = kopyala(cikis);
  console.log(`pyodideKopyala: ${r.dosyalar.length} dosya -> ${path.relative(process.cwd(), cikis) || "."}`);
}
