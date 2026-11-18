// Derleme zamani: tarayicidaki Pyodide icin model paketi (deterministik zip) ve manifest.json uretir.
// Kullanim: node scripts/paketModel.mjs [--kok DEPO_KOKU] [--cikis DIZIN]   (varsayilan cikis: public/oyun)
// Yalniz Node yerlesikleri (fs, path, crypto, zlib). Python gerekmez.
//
// Paket yerlesimi depo koku duzenini korur (Pyodide'de /app altina acilir: config.REPO_ROOT = /app).
// `model_sha256`, simulasyon/arayuz/server/oyun_server/tarayici/goruntu.py `_model_sha256` ile AYNI algoritmadir:
// simkit/**/*.py + simbuild.py + model_mod.py, model kokune gore goreli yola gore sirali; her biri icin
// yol + \0 + sha256(icerik, CRLF -> LF) ozeti birlikte hashlenir.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

export const PYODIDE_SURUMU = "0.27.7";
export const MANIFEST_SURUMU = 1;

const MODEL = "simulasyon/kagit-ustu/modulerlestirme";
const SUNUCU = "simulasyon/arayuz/server";
const OYUN_SUNUCU = `${SUNUCU}/oyun_server`;
const GORUNTU_PY = `${OYUN_SUNUCU}/tarayici/goruntu.py`;
// oyun_server altinda tarayici yolunun icerik almadigi/okumadigi parcalar (dogrulama: gunluk/rapor).
const DISLANAN_DIZINLER = new Set(["__pycache__", "jobs", "dunyalar"]);
const DISLANAN_UST_DOSYALAR = new Set(["__main__.py"]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const bayt = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function yuru(kok, goreli, filtre) {
  const out = [];
  for (const e of readdirSync(path.join(kok, goreli), { withFileTypes: true })) {
    const yol = `${goreli}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "__pycache__") continue;
      out.push(...yurulan(kok, yol, filtre));
    } else if (e.isFile() && !e.name.endsWith(".pyc") && e.name !== ".DS_Store") out.push(yol);
  }
  return out;
}
function yurulan(kok, yol, filtre) {
  return filtre(yol) ? yuru(kok, yol, filtre) : [];
}

/**
 * `kok` bir git deposuysa (`.git` dizin ya da worktree dosyasi) yollari `git ls-files` ile kesistirir: izlenmeyen dosya (deneme betigi, dokum)
 * herkese acik pakete GIRMEZ. Git yoksa ya da depo degilse yollar aynen doner. Git calisip hata verirse derleme kirilir (sessiz gecmez).
 */
function izlenenlerle(kok, yollar) {
  if (!existsSync(path.join(kok, ".git"))) return yollar;
  const r = spawnSync("git", ["-C", kok, "ls-files", "-z", "--", "simulasyon/arayuz/server", "simulasyon/arayuz/registry", MODEL], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error && r.error.code === "ENOENT") return yollar; // git kurulu degil
  if (r.error || r.status !== 0) throw new Error(`paketModel: git ls-files basarisiz (${r.error?.message ?? r.stderr?.toString("utf-8").trim()})`);
  const izlenen = new Set(r.stdout.toString("utf-8").split("\0").filter(Boolean));
  return yollar.filter((y) => izlenen.has(y));
}

/** Pakete girecek goreli yollar (bayt sirali). */
export function paketYollari(kok) {
  const ustDizin = `${OYUN_SUNUCU}/`;
  // Filtre yalniz alt dizinlere uygulanir: ilk segment dislananlardan biriyse dizin pakete girmez.
  const oyun = yurulan(kok, OYUN_SUNUCU, (y) => !DISLANAN_DIZINLER.has(y.slice(ustDizin.length).split("/")[0]));
  const filtrelenmis = oyun.filter((y) => !DISLANAN_UST_DOSYALAR.has(y.slice(ustDizin.length)));
  const ek = [`${SUNUCU}/bench/decisions.json`, `${SUNUCU}/bench/results/bench-sonuc.json`];
  for (const e of readdirSync(path.join(kok, "simulasyon/arayuz/registry"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".json")) ek.push(`simulasyon/arayuz/registry/${e.name}`);
  }
  ek.push(...yurulan(kok, `${MODEL}/simkit`, () => true), `${MODEL}/simbuild.py`, `${MODEL}/model_mod.py`);
  return izlenenlerle(kok, [...new Set([...filtrelenmis, ...ek])].sort(bayt));
}

/** goruntu.py `_model_sha256` ile ayni hesap; `dosyalar`: [{yol (depo kokune gore), icerik}]. */
export function modelSha256(dosyalar) {
  const onek = `${MODEL}/`;
  const secili = [];
  for (const d of dosyalar) {
    if (!d.yol.startsWith(onek)) continue;
    const g = d.yol.slice(onek.length);
    if ((g.startsWith("simkit/") && g.endsWith(".py")) || g === "simbuild.py" || g === "model_mod.py") secili.push({ g, icerik: d.icerik });
  }
  secili.sort((a, b) => bayt(a.g, b.g));
  const h = createHash("sha256");
  for (const { g, icerik } of secili) {
    const lf = Buffer.from(icerik.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
    h.update(Buffer.concat([Buffer.from(g, "utf-8"), Buffer.from([0]), createHash("sha256").update(lf).digest()]));
  }
  return h.digest("hex");
}

/** Deterministik zip: sabit sira, sabit zaman damgasi (1980-01-01), sabit izin (0644), deflate seviye 9. */
export function zipYaz(dosyalar) {
  const parcalar = [];
  const merkez = [];
  let konum = 0;
  for (const { yol, icerik } of dosyalar) {
    const ad = Buffer.from(yol, "utf-8");
    const bayrak = ad.every((b) => b < 0x80) ? 0 : 0x0800;
    const sikisik = deflateRawSync(icerik, { level: 9 });
    const crc = crc32(icerik);
    const yerel = Buffer.alloc(30);
    yerel.writeUInt32LE(0x04034b50, 0);
    yerel.writeUInt16LE(20, 4);
    yerel.writeUInt16LE(bayrak, 6);
    yerel.writeUInt16LE(8, 8);
    yerel.writeUInt16LE(0, 10); // saat
    yerel.writeUInt16LE(0x0021, 12); // tarih 1980-01-01
    yerel.writeUInt32LE(crc, 14);
    yerel.writeUInt32LE(sikisik.length, 18);
    yerel.writeUInt32LE(icerik.length, 22);
    yerel.writeUInt16LE(ad.length, 26);
    yerel.writeUInt16LE(0, 28);
    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0);
    m.writeUInt16LE((3 << 8) | 20, 4); // Unix, 2.0
    m.writeUInt16LE(20, 6);
    m.writeUInt16LE(bayrak, 8);
    m.writeUInt16LE(8, 10);
    m.writeUInt16LE(0, 12);
    m.writeUInt16LE(0x0021, 14);
    m.writeUInt32LE(crc, 16);
    m.writeUInt32LE(sikisik.length, 20);
    m.writeUInt32LE(icerik.length, 24);
    m.writeUInt16LE(ad.length, 28);
    m.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    m.writeUInt32LE(konum, 42);
    merkez.push(m, ad);
    parcalar.push(yerel, ad, sikisik);
    konum += 30 + ad.length + sikisik.length;
  }
  const merkezBuf = Buffer.concat(merkez);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0);
  son.writeUInt16LE(dosyalar.length, 8);
  son.writeUInt16LE(dosyalar.length, 10);
  son.writeUInt32LE(merkezBuf.length, 12);
  son.writeUInt32LE(konum, 16);
  return Buffer.concat([...parcalar, merkezBuf, son]);
}

function pySabit(kok, ad) {
  const m = new RegExp(`^${ad}\\s*=\\s*(\\d+)\\b`, "m").exec(readFileSync(path.join(kok, GORUNTU_PY), "utf-8"));
  if (!m) throw new Error(`${GORUNTU_PY}: ${ad} bulunamadi`);
  return Number(m[1]);
}

/** Paketi ve manifesti `cikis` altina yazar; manifest nesnesini dondurur. */
export function paketle(kok, cikis) {
  const dosyalar = paketYollari(kok).map((yol) => ({ yol, icerik: readFileSync(path.join(kok, yol)) }));
  const zip = zipYaz(dosyalar);
  const zipSha = sha256(zip);
  const ad = `oyun-${zipSha.slice(0, 12)}.zip`;
  const manifest = {
    surum: MANIFEST_SURUMU,
    pyodide: PYODIDE_SURUMU,
    goruntu_sema: pySabit(kok, "SCHEMA"),
    host_sema: pySabit(kok, "HOST_SEMA"),
    model_sha256: modelSha256(dosyalar),
    paket: { ad, sha256: zipSha, boyut: zip.length },
    dosyalar: dosyalar.map((d) => ({ yol: d.yol, sha256: sha256(d.icerik), boyut: d.icerik.length })),
  };
  mkdirSync(cikis, { recursive: true });
  for (const e of readdirSync(cikis)) if (/^oyun-[0-9a-f]{12}\.zip$/.test(e) && e !== ad) rmSync(path.join(cikis, e));
  writeFileSync(path.join(cikis, ad), zip);
  writeFileSync(path.join(cikis, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function arg(ad, varsayilan) {
  const i = process.argv.indexOf(ad);
  return i >= 0 ? path.resolve(process.argv[i + 1]) : varsayilan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const burasi = path.dirname(fileURLToPath(import.meta.url));
  const m = paketle(arg("--kok", path.resolve(burasi, "../../..")), arg("--cikis", path.resolve(burasi, "../public/oyun")));
  console.log(`paketModel: ${m.paket.ad} ${m.paket.boyut} bayt, ${m.dosyalar.length} dosya, model_sha256=${m.model_sha256.slice(0, 12)}`);
}
