// Pyodide duman testi (Node): uretilen model paketini Pyodide 0.27.7'ye acar, TarayiciCekirdegi kurar, 2 hafta ilerletir,
// uyumluluk anahtarini manifest ile karsilastirir. Pyodide, kopyalanan cekirdek dosyalarindan (indexURL) yuklenir.
// Kullanim: node scripts/pyodideDuman.mjs --pyodide DIZIN --paket DIZIN   (cikti: tek satir JSON; hata: cikis kodu 1)
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (ad) => {
  const i = process.argv.indexOf(ad);
  if (i < 0) throw new Error(`${ad} gerekli`);
  return path.resolve(process.argv[i + 1]);
};
const pyodideDizin = arg("--pyodide");
const paketDizin = arg("--paket");
const manifest = JSON.parse(readFileSync(path.join(paketDizin, "manifest.json"), "utf-8"));
const zip = new Uint8Array(readFileSync(path.join(paketDizin, manifest.paket.ad))); // Buffer degil: Pyodide Buffer turunu tanimaz

const { loadPyodide } = await import(pathToFileURL(path.join(pyodideDizin, "pyodide.mjs")).href);
const t0 = Date.now();
const py = await loadPyodide({ indexURL: pyodideDizin, env: { PYTHONHASHSEED: "0" } });
const yukleMs = Date.now() - t0;
py.unpackArchive(zip, "zip", { extractDir: "/app" });
const kod = `
import json, sys, time
sys.path.insert(0, "/app/simulasyon/arayuz/server")
from oyun_server.tarayici.cekirdek import TarayiciCekirdegi
c = TarayiciCekirdegi()
cfg = {"name": "Duman", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban", "seedIndex": 0, "values": {}, "mode": "dao"}
r = c.istek("POST", "/api/runs", {"config": cfg})
rid = r["body"]["runId"]
for _ in range(2):
    c.istek("POST", "/api/runs/%s/control" % rid, {"action": "step", "speed": 16})
son = time.monotonic() + 300
while c.manager.stats(rid)["released"] < 2 and time.monotonic() < son:
    c.tick()
json.dumps({"anahtar": c.uyumluluk_anahtari(), "yayimlanan": c.manager.stats(rid)["released"], "hash_randomization": sys.flags.hash_randomization})
`;
const t1 = Date.now();
const sonuc = JSON.parse(await py.runPythonAsync(kod));
const cikti = { pyodide: py.version, yukle_ms: yukleMs, calistir_ms: Date.now() - t1, ...sonuc, manifest_model_sha256: manifest.model_sha256, esit: sonuc.anahtar.model_sha256 === manifest.model_sha256 };
console.log(JSON.stringify(cikti));
process.exit(cikti.esit && sonuc.yayimlanan >= 2 && sonuc.anahtar.pyodide === manifest.pyodide && sonuc.anahtar.schema === manifest.goruntu_sema ? 0 : 1);
