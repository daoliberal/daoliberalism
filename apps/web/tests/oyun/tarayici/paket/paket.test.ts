// @vitest-environment node
// B6: model paketi (deterministik zip + manifest) ve Pyodide cekirdek dosyalari (derleme zamani).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../../../..");
const KOK = path.resolve(WEB, "../..");
const BETIK = (ad: string) => path.join(WEB, "scripts", ad);
const MUTLAK = ["/Us", "ers/"].join(""); // betik/paket mutlak kullanici yolu tasimamali (acik depo taramasi bu dizgiyi aratir)
const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

interface Manifest {
  surum: number;
  pyodide: string;
  goruntu_sema: number;
  host_sema: number;
  model_sha256: string;
  paket: { ad: string; sha256: string; boyut: number };
  dosyalar: { yol: string; sha256: string; boyut: number }[];
}

/** Merkez dizinden girdileri okuyan en kucuk zip okuyucu (ad, yontem, zaman, izin, icerik). */
function zipOku(zip: Buffer) {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = zip.readUInt16LE(eocd + 10);
  let o = zip.readUInt32LE(eocd + 16);
  const out: { ad: string; yontem: number; saat: number; tarih: number; izin: number; icerik: Buffer }[] = [];
  for (let i = 0; i < n; i++) {
    expect(zip.readUInt32LE(o)).toBe(0x02014b50);
    const yontem = zip.readUInt16LE(o + 10);
    const saat = zip.readUInt16LE(o + 12);
    const tarih = zip.readUInt16LE(o + 14);
    const csize = zip.readUInt32LE(o + 20);
    const nlen = zip.readUInt16LE(o + 28);
    const izin = zip.readUInt32LE(o + 38) >>> 16;
    const yerel = zip.readUInt32LE(o + 42);
    const ad = zip.subarray(o + 46, o + 46 + nlen).toString("utf-8");
    const veriBas = yerel + 30 + zip.readUInt16LE(yerel + 26) + zip.readUInt16LE(yerel + 28);
    const icerik = inflateRawSync(zip.subarray(veriBas, veriBas + csize));
    out.push({ ad, yontem, saat, tarih, izin, icerik });
    o += 46 + nlen;
  }
  return out;
}

let tmp: string;
let paketA: string;
let paketB: string;
let pyodideDizin: string;
let ma: Manifest;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "b6-"));
  paketA = path.join(tmp, "a");
  paketB = path.join(tmp, "b");
  pyodideDizin = path.join(tmp, "pyodide");
  execFileSync("node", [BETIK("paketModel.mjs"), "--cikis", paketA]);
  execFileSync("node", [BETIK("paketModel.mjs"), "--cikis", paketB]);
  execFileSync("node", [BETIK("pyodideKopyala.mjs"), "--cikis", pyodideDizin]);
  ma = JSON.parse(readFileSync(path.join(paketA, "manifest.json"), "utf-8")) as Manifest;
}, 120_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("model paketi: deterministiklik", () => {
  it("iki_derleme_ayni_zip_adi_ayni_bayt_ayni_manifest", () => {
    const a = readdirSync(paketA).sort();
    expect(a).toEqual(readdirSync(paketB).sort());
    expect(a).toHaveLength(2);
    for (const f of a) expect(sha256(readFileSync(path.join(paketA, f)))).toBe(sha256(readFileSync(path.join(paketB, f))));
  });

  it("eski_zip_temizlenir_tek_zip_kalir", () => {
    const sahte = path.join(paketA, "oyun-000000000000.zip");
    writeFileSync(sahte, "eski");
    execFileSync("node", [BETIK("paketModel.mjs"), "--cikis", paketA]);
    expect(readdirSync(paketA).filter((f) => f.endsWith(".zip"))).toEqual([ma.paket.ad]);
  });

  it("zip_sabit_zaman_izin_deflate", () => {
    const girdiler = zipOku(readFileSync(path.join(paketA, ma.paket.ad)));
    for (const g of girdiler) {
      expect([g.yontem, g.saat, g.tarih, g.izin]).toEqual([8, 0, 0x0021, 0o100644]);
    }
    const adlar = girdiler.map((g) => g.ad);
    expect(adlar).toEqual([...adlar].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))));
  });
});

describe("model paketi: manifest", () => {
  it("paket_adi_ve_ozeti_zip_baytlarindan", () => {
    const zip = readFileSync(path.join(paketA, ma.paket.ad));
    expect(ma.paket.sha256).toBe(sha256(zip));
    expect(ma.paket.boyut).toBe(zip.length);
    expect(ma.paket.ad).toBe(`oyun-${ma.paket.sha256.slice(0, 12)}.zip`);
    expect(ma.pyodide).toBe("0.27.7");
    expect(ma.surum).toBe(1);
  });

  it("dosya_listesi_zip_ve_kaynakla_ayni", () => {
    const girdiler = zipOku(readFileSync(path.join(paketA, ma.paket.ad)));
    expect(girdiler.map((g) => g.ad)).toEqual(ma.dosyalar.map((d) => d.yol));
    ma.dosyalar.forEach((d, i) => {
      expect(sha256(girdiler[i]!.icerik)).toBe(d.sha256);
      expect(girdiler[i]!.icerik.length).toBe(d.boyut);
      expect(sha256(readFileSync(path.join(KOK, d.yol)))).toBe(d.sha256);
    });
  });

  it("icerik_kumesi_beklenen_dislananlar_yok", () => {
    const yollar = ma.dosyalar.map((d) => d.yol);
    const oyun = "simulasyon/arayuz/server/oyun_server/";
    for (const gerekli of [
      `${oyun}tarayici/cekirdek.py`,
      `${oyun}tarayici/tel_b4.json`,
      `${oyun}http.py`,
      `${oyun}static.py`,
      `${oyun}sse.py`,
      "simulasyon/arayuz/server/bench/decisions.json",
      "simulasyon/arayuz/server/bench/results/bench-sonuc.json",
      "simulasyon/arayuz/registry/templates.json",
      "simulasyon/kagit-ustu/modulerlestirme/simbuild.py",
      "simulasyon/kagit-ustu/modulerlestirme/model_mod.py",
    ]) expect(yollar).toContain(gerekli);
    expect(yollar.some((y) => y.startsWith(`${oyun}jobs/`) || y.startsWith(`${oyun}dunyalar/`))).toBe(false);
    expect(yollar).not.toContain(`${oyun}__main__.py`);
    expect(yollar.some((y) => y.includes("__pycache__") || y.endsWith(".pyc") || y.includes("/spike/"))).toBe(false);
    expect(yollar.every((y) => /^[\x20-\x7e]+$/.test(y) && !y.includes(MUTLAK))).toBe(true);
    expect(JSON.stringify(ma)).not.toContain(MUTLAK);
  });

  it("model_sha256_python_uyumluluk_anahtari_ile_birebir_ayni", (ctx) => {
    const py = `
import json, sys
sys.path.insert(0, "simulasyon/arayuz/server")
from oyun_server.tarayici import goruntu
print(json.dumps(goruntu.uyumluluk_anahtari("simulasyon/kagit-ustu/modulerlestirme", "0.27.7")))`;
    const r = spawnSync("python3", ["-c", py], { cwd: KOK, env: { ...process.env, PYTHONHASHSEED: "0" }, encoding: "utf-8" });
    if (r.status !== 0) return ctx.skip(); // CI'da Python yoksa atlanir (yerelde kosulur)
    const anahtar = JSON.parse(r.stdout) as { model_sha256: string; schema: number; host_sema: number };
    expect(ma.model_sha256).toBe(anahtar.model_sha256);
    expect(ma.goruntu_sema).toBe(anahtar.schema);
    expect(ma.host_sema).toBe(anahtar.host_sema);
  });
});

describe("pyodide cekirdek dosyalari", () => {
  const BEKLENEN = ["pyodide-lock.json", "pyodide.asm.js", "pyodide.asm.wasm", "pyodide.mjs", "python_stdlib.zip"];

  it("yalniz_cekirdek_ve_npm_paketiyle_bayt_bayt_ayni", () => {
    expect(readdirSync(pyodideDizin).sort()).toEqual(BEKLENEN);
    const npm = path.join(WEB, "node_modules/pyodide");
    expect(JSON.parse(readFileSync(path.join(npm, "package.json"), "utf-8")).version).toBe("0.27.7");
    for (const f of BEKLENEN) expect(sha256(readFileSync(path.join(pyodideDizin, f)))).toBe(sha256(readFileSync(path.join(npm, f))));
  });

  it("package_json_surumu_sabit", () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf-8")) as { devDependencies: Record<string, string>; scripts: Record<string, string> };
    expect(pkg.devDependencies.pyodide).toBe("0.27.7");
    expect(pkg.scripts.prebuild).toContain("pyodideKopyala.mjs");
    expect(pkg.scripts.prebuild).toContain("paketModel.mjs");
  });
});

describe("pyodide duman testi (Node)", () => {
  it("paket_acilir_cekirdek_2_hafta_anahtar_manifestle_ayni", () => {
    const r = spawnSync("node", [BETIK("pyodideDuman.mjs"), "--pyodide", pyodideDizin, "--paket", paketA], { encoding: "utf-8", maxBuffer: 1 << 26 });
    expect(r.status, r.stderr.slice(-2000)).toBe(0);
    const o = JSON.parse(r.stdout.trim().split("\n").pop()!) as { esit: boolean; yayimlanan: number; hash_randomization: number; anahtar: { model_sha256: string; pyodide: string } };
    expect(o.esit).toBe(true);
    expect(o.anahtar.model_sha256).toBe(ma.model_sha256);
    expect(o.anahtar.pyodide).toBe("0.27.7");
    expect(o.yayimlanan).toBeGreaterThanOrEqual(2);
    expect(o.hash_randomization).toBe(0);
  }, 240_000);
});

describe("Ö3: paket yalniz git'in izledigi dosyalari alir", () => {
  const modul = import(/* @vite-ignore */ path.join(WEB, "scripts/paketModel.mjs")) as Promise<{ paketYollari(kok: string): string[] }>;
  const yaz = (kok: string, yol: string, icerik: string) => {
    mkdirSync(path.dirname(path.join(kok, yol)), { recursive: true });
    writeFileSync(path.join(kok, yol), icerik);
  };
  const MODEL = "simulasyon/kagit-ustu/modulerlestirme";
  function mini(): string {
    const kok = mkdtempSync(path.join(tmpdir(), "o3-"));
    yaz(kok, "simulasyon/arayuz/server/oyun_server/a.py", "a");
    yaz(kok, "simulasyon/arayuz/server/bench/decisions.json", "{}");
    yaz(kok, "simulasyon/arayuz/server/bench/results/bench-sonuc.json", "{}");
    yaz(kok, "simulasyon/arayuz/registry/r.json", "{}");
    yaz(kok, `${MODEL}/simkit/k.py`, "k");
    yaz(kok, `${MODEL}/simbuild.py`, "b");
    yaz(kok, `${MODEL}/model_mod.py`, "m");
    return kok;
  }

  it("izlenmeyen gecici dosya pakete girmez; izlenenler aynen kalir; git yoksa mevcut davranis", async () => {
    const { paketYollari } = await modul;
    const kok = mini();
    try {
      const git = (...a: string[]) => execFileSync("git", ["-C", kok, ...a], { stdio: "pipe" });
      git("init", "-q");
      git("add", "-A");
      yaz(kok, "simulasyon/arayuz/server/oyun_server/gecici_deneme.py", "x");
      yaz(kok, `${MODEL}/simkit/yerel_not.py`, "y");
      yaz(kok, "simulasyon/arayuz/registry/yerel.json", "{}");
      const yollar = paketYollari(kok);
      expect(yollar.some((y) => y.includes("gecici_deneme") || y.includes("yerel_not") || y.endsWith("registry/yerel.json"))).toBe(false);
      expect(yollar).toContain("simulasyon/arayuz/server/oyun_server/a.py");
      expect(yollar).toContain(`${MODEL}/simkit/k.py`);
      expect(yollar).toHaveLength(7);
      // git deposu degil: izlenmeyen dosyalar da (mevcut davranis) listelenir
      rmSync(path.join(kok, ".git"), { recursive: true, force: true });
      expect(paketYollari(kok).some((y) => y.includes("gecici_deneme"))).toBe(true);
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  });
});
