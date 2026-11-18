// B9: `uzun-<motor>.json` ham olcumunden 13 haftalik tablo satirlari uretir. Kullanim: node e2e/olcum/ozet.mjs <cikti-dizini> <motor>
import fs from "node:fs";
import path from "node:path";

const [dizin, motor] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(path.join(dizin, `uzun-${motor}.json`), "utf8"));
const MB = (x) => (x / 1048576).toFixed(0);
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const tick = d.tickHafta ?? {};
const satir = [];
let onceki = 0;
for (const s of d.satirlar) {
  const sureler = [];
  for (let h = onceki + 1; h <= s.hafta; h++) for (const v of tick[h] ?? []) sureler.push(v);
  onceki = s.hafta;
  const bekci = 180_000;
  satir.push(
    `| ${s.hafta} | ${med(sureler) === null ? "-" : (med(sureler) / 1000).toFixed(2)} / ${sureler.length ? (Math.max(...sureler) / 1000).toFixed(2) : "-"} | ${MB(s.bellek.yasayan)} | ${MB(s.bellek.yigin)} | ${s.goruntu ? `${s.goruntu.hafta}: ${MB(s.goruntu.ham)} / ${(s.goruntu.sikisik / 1048576).toFixed(1)}` : "-"} | ${s.depolama.usage === null ? "yok" : MB(s.depolama.usage)} | ${s.yazimKuyruguTepe ?? "yok"} | ${(s.enBuyukSessizlikMs / 1000).toFixed(1)} (${((s.enBuyukSessizlikMs / bekci) * 100).toFixed(1)}%) | ${s.jsYigin === null ? "yok" : MB(s.jsYigin)} | ${s.bellek.gc_ms.toFixed(0)} |`,
  );
}
console.log("| hf | hafta sn (ort./en buyuk) | yasayan MB | yigin MB | son goruntu hf: ham/sikisik MB | IDB MB | yazim kuyrugu tepe | en uzun sessizlik sn (bekci %) | JS yigin MB | gc ms |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
console.log(satir.join("\n"));
console.log("\nCAGRILAR", JSON.stringify(d.cagrilar));
console.log("GIDEN", JSON.stringify(d.giden));
console.log("TOPLAM sn", Math.round(d.toplamMs / 1000), "hata", d.hata ?? "yok", "konsol", JSON.stringify(d.konsol ?? []));
