// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

/**
 * Parite (son inceleme): aynı istek dizisi sahte sunucuya (`helpers/fakeLiveServer.ts`) ve gerçek `oyun_server --host-kind fake` sunucusuna gider;
 * yanıt ŞEKİLLERİ (alan adları ve türleri, `versions` içeriği, hata kodları ve alanları) karşılaştırılır. Sahte sunucunun gerçekten ayrıştığı
 * her yer (bu dalda dört kez: not, sürüm, bağlam kilidi, takvimli başlangıç) bu testte kırılır. Zamanlamaya bağlı alanlar (`buffering`,
 * `modelWeeksPerSec`, hazırlık sayacı...) yalnız varlık yönünden serbesttir; öteki her alan iki yanıtta da bulunmalıdır.
 */
const SERVER_ROOT = path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server");
const PYTHON = process.env.OYUN_PYTHON ?? "python3";

type Ver = { version: number; fromWeek: number; values: Record<string, unknown>; note?: string };
type St = {
  runId: string; status: string; week: number; version: number; values: Record<string, unknown>; versions: Ver[]; settingLocks?: { id: string; reason: string }[];
  preparing?: { done: number; total: number }; parentRunId?: string; forkWeek?: number;
};
/** Yanıt gövdesi: testin okuduğu alanların birleşimi (varlıkları ayrıca sınanır). */
type Body = {
  runId: string; jobId: string; status: string; state: St; accepted: boolean; capabilities: Record<string, boolean>; blocked: unknown;
  error: { code: string; fields: { id: string; reason: string }[] };
};
type Res = { status: number; body: Body };
type Caller = (method: string, p: string, body?: unknown) => Promise<Res>;

let proc: ChildProcess | null = null;
let tmp = "";
let real: Caller;
const fake = createFakeLiveServer({ computeMs: 1, autoFastForward: true });
fake.capabilities = { branch: true, seeds: false, compare: false, library: false, city: true, chain: true, jobs: true, rebuild: true, harita: true };

function startReal(): Promise<number> {
  tmp = mkdtempSync(path.join(os.tmpdir(), "oyun-parite-"));
  const env = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: SERVER_ROOT, PYTHONDONTWRITEBYTECODE: "1", OYUN_LOG_DIR: path.join(tmp, "log"), OYUN_RUNS_DIR: path.join(tmp, "kosular"),
  } as unknown as NodeJS.ProcessEnv;
  proc = spawn(PYTHON, ["-P", "-m", "oyun_server", "--port", "0", "--web", tmp, "--host-kind", "fake"], { cwd: SERVER_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`sunucu başlamadı: ${out}`)), 40_000);
    const onData = (d: Buffer): void => {
      out += d.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/oyun\//.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    proc!.stdout!.on("data", onData);
    proc!.stderr!.on("data", (d: Buffer) => { out += d.toString(); });
    proc!.on("exit", (c) => reject(new Error(`sunucu çıktı (${c}): ${out}`)));
  });
}

function httpCaller(port: number): Caller {
  return (method, p, body) =>
    new Promise((resolve, reject) => {
      const data = body === undefined && method === "GET" ? undefined : JSON.stringify(body ?? {});
      const req = http.request(
        { host: "127.0.0.1", port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}`, ...(data === undefined ? {} : { "Content-Type": "application/json", "X-Oyun-Istek": "1", "Content-Length": Buffer.byteLength(data) }) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            resolve({ status: res.statusCode ?? 0, body: (text === "" ? null : JSON.parse(text)) as Body });
          });
        },
      );
      req.on("error", reject);
      if (data !== undefined) req.write(data);
      req.end();
    });
}

const fakeCaller: Caller = async (method, p, body) => {
  const r = await fake.fetch(`http://127.0.0.1:8765${p}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, body: (text === "" ? null : JSON.parse(text)) as Body };
};

/** Sunucunun varsayılan koşu dizini (D1): testler oraya yazmamalı. */
const GERCEK_KOSULAR = path.resolve(SERVER_ROOT, "../kosular");
const listele = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort() : []);
let gercekOnce: string[] = [];

beforeAll(async () => {
  gercekOnce = listele(GERCEK_KOSULAR);
  real = httpCaller(await startReal());
}, 60_000);

afterAll(async () => {
  const p = proc;
  if (p && p.exitCode === null) {
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => p.kill("SIGKILL"), 8000);
      p.on("exit", () => { clearTimeout(kill); resolve(); });
      p.kill("SIGTERM");
    });
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const kindOf = (x: unknown): string => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
/** Zamanlamaya bağlı (varlığı serbest) durum alanları. */
const SERBEST = new Set(["buffering", "modelWeeksPerSec", "error", "endedReason", "preparing"]);
/** Değeri iki sunucuda birebir aynı olması gereken harita alanları (kart değerleri). */
const KESIN = new Set(["values", "worldScenarioValues"]);
const kanonik = (x: unknown): string => JSON.stringify(x, (_k, v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** İki yanıtın şekil farkları (boş = aynı): alan adları ve türleri; `KESIN` alanlar değeriyle; `series` yalnız tür. */
function sekilFarki(gercek: unknown, sahte: unknown, yol = "$", serbest: ReadonlySet<string> = SERBEST, nullable: ReadonlySet<string> = new Set()): string[] {
  const son = yol.split(".").pop() ?? "";
  const ka = kindOf(gercek), kb = kindOf(sahte);
  if (ka !== kb) return (ka === "null" || kb === "null") && nullable.has(son) ? [] : [`${yol}: gerçek ${ka} != sahte ${kb}`];
  if (KESIN.has(son) && ka === "object") return kanonik(gercek) === kanonik(sahte) ? [] : [`${yol}: değer ${JSON.stringify(gercek)} != ${JSON.stringify(sahte)}`];
  if (ka === "object") {
    const a = gercek as Record<string, unknown>, b = sahte as Record<string, unknown>;
    const out: string[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a) || !(k in b)) {
        if (!serbest.has(k)) out.push(`${yol}.${k}: yalnız ${k in a ? "gerçekte" : "sahtede"}`);
        continue;
      }
      out.push(...sekilFarki(a[k], b[k], `${yol}.${k}`, serbest, nullable));
    }
    return out;
  }
  if (ka === "array") {
    const a = gercek as unknown[], b = sahte as unknown[];
    if (yol.includes(".series.") || /\.series$/.test(yol)) return a.every((x) => typeof x === "number") && b.every((x) => typeof x === "number") ? [] : [`${yol}: sayı dizisi değil`];
    if (a.length !== b.length) return [`${yol}: uzunluk ${a.length} != ${b.length}`];
    return a.flatMap((x, i) => sekilFarki(x, b[i], `${yol}[${i}]`, serbest, nullable));
  }
  return [];
}

const CONFIG = { name: "Deneme", cityNames: ["A", "B", "C", "D", "E"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: {} };
const NOT = "Kasa eridi, destek açtım";

async function ikisi(method: string, p: string, body?: unknown): Promise<{ g: Res; s: Res }> {
  const [g, s] = await Promise.all([real(method, p, body), fakeCaller(method, p, body)]);
  return { g, s };
}

function ayni(etiket: string, r: { g: Res; s: Res }, status: number, opts: { serbest?: ReadonlySet<string>; nullable?: ReadonlySet<string> } = {}): void {
  expect(r.g.status, `${etiket}: gerçek durum ${JSON.stringify(r.g.body)}`).toBe(status);
  expect(r.s.status, `${etiket}: sahte durum ${JSON.stringify(r.s.body)}`).toBe(status);
  expect(sekilFarki(r.g.body, r.s.body, "$", opts.serbest ?? SERBEST, opts.nullable), etiket).toEqual([]);
}

/** Gerçek ve sahte koşuyu tek kimlikle izlemek için: kimlikler farklıdır, ikisine ayrı yol kurulur. */
async function ikiKosu(body: unknown): Promise<{ g: string; s: string; r: { g: Res; s: Res } }> {
  const r = await ikisi("POST", "/api/runs", body);
  return { g: r.g.body.runId, s: r.s.body.runId, r };
}
const kosuYolu = (k: { g: string; s: string }, sub = ""): { g: string; s: string } => ({ g: `/api/runs/${k.g}${sub}`, s: `/api/runs/${k.s}${sub}` });
async function ayriIstek(yol: { g: string; s: string }, method: string, body?: unknown): Promise<{ g: Res; s: Res }> {
  const [g, s] = await Promise.all([real(method, yol.g, body), fakeCaller(method, yol.s, body)]);
  return { g, s };
}
async function bekleAyri(k: { g: string; s: string }, kosul: (st: St) => boolean, etiket: string): Promise<{ g: St; s: St }> {
  const end = Date.now() + 30_000;
  for (;;) {
    const [g, s] = await Promise.all([real("GET", `/api/runs/${k.g}`), fakeCaller("GET", `/api/runs/${k.s}`)]);
    if (kosul(g.body.state) && kosul(s.body.state)) return { g: g.body.state, s: s.body.state };
    if (Date.now() > end) throw new Error(`${etiket}: koşul sağlanmadı: ${JSON.stringify({ g: g.body, s: s.body })}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("sahte sunucu == gerçek sunucu (aynı istek dizisi, yanıt şekilleri)", () => {
  it("hello_ve_yetenekler", async () => {
    const r = await ikisi("GET", "/api/hello");
    ayni("hello", r, 200, { nullable: new Set(["sec_per_week_p50"]) });
    expect(r.s.body.capabilities).toEqual(r.g.body.capabilities);
  }, 20_000);

  it("baslat_adim_notlu_canli_yama_dallan_durum_sil", async () => {
    const k = await ikiKosu({ config: CONFIG });
    ayni("başlat", k.r, 201);
    for (const st of [k.r.g.body.state, k.r.s.body.state]) {
      expect(st.version).toBe(1);
      expect(st.values).toEqual({ gecis_destegi: "kapali" });
      expect(st.versions).toEqual([{ version: 1, fromWeek: 0, values: { gecis_destegi: "kapali" } }]);
      expect(st).not.toHaveProperty("settingLocks");
    }
    const yol = kosuYolu(k);
    for (let i = 0; i < 3; i += 1) await ayriIstek({ g: `${yol.g}/control`, s: `${yol.s}/control` }, "POST", { action: "step", speed: 16 });
    await bekleAyri(k, (st) => st.week >= 2, "adım");

    // canlı yama + not
    const kabul = await ayriIstek({ g: `${yol.g}/changes`, s: `${yol.s}/changes` }, "POST", { from: "next_week", patch: { gecis_destegi: "kisa_sureli" }, note: `  ${NOT}  ` });
    ayni("yama", kabul, 200);
    expect(kabul.g.body.accepted).toBe(true);
    expect(kabul.s.body.accepted).toBe(true);
    const sonra = await ayriIstek(yol, "GET");
    ayni("yamadan sonra durum", sonra, 200);
    for (const st of [sonra.g.body.state, sonra.s.body.state]) {
      const notlu = st.versions.filter((v: Ver) => "note" in v);
      expect(notlu, JSON.stringify(st.versions)).toHaveLength(1);
      expect(notlu[0].note).toBe(NOT);                                       // kırpılmış, sürüm kaydında
      expect(notlu[0].values.gecis_destegi).toBe("kisa_sureli");
      expect(st.versions.filter((v: Ver) => !("note" in v)).every((v: Ver) => v.values.gecis_destegi === "kapali")).toBe(true);
    }

    // ret biçimleri (kod ve alanlar aynı)
    const ret = async (body: unknown) => ayriIstek({ g: `${yol.g}/changes`, s: `${yol.s}/changes` }, "POST", body);
    const startOnly = await ret({ from: "next_week", patch: { dunya_tohumu: 1 } });
    ayni("start_only", startOnly, 200);
    expect(startOnly.s.body).toEqual(startOnly.g.body);
    const kilit = await ret({ from: "next_week", patch: { dunya_tohumu: 1, dunya_sabit_kalemleri: 10 } });
    ayni("çoklu ret", kilit, 200);
    expect(kilit.s.body).toEqual(kilit.g.body);
    for (const [ad, body, alan] of [
      ["uzun not", { from: "next_week", patch: { gecis_destegi: "kapali" }, note: "x".repeat(501) }, "note"],
      ["sayı not", { from: "next_week", patch: { gecis_destegi: "kapali" }, note: 5 }, "note"],
      ["yanlış from", { from: "now", patch: { gecis_destegi: "kapali" } }, "from"],
      ["yama liste", { from: "next_week", patch: [] }, "patch"],
    ] as const) {
      const r = await ret(body);
      ayni(ad, r, 422);
      expect(r.g.body.error.code, ad).toBe("invalid_change");
      expect(r.s.body.error.code, ad).toBe("invalid_change");
      expect(r.s.body.error.fields, ad).toEqual(r.g.body.error.fields);
      expect(r.g.body.error.fields[0].id).toBe(alan);
    }
    const tam = await ret({ from: "next_week", patch: { ucret_stopaji: 12 }, note: "x".repeat(500) });
    expect(tam.g.body.accepted, JSON.stringify(tam.g.body)).toBe(true);
    expect(tam.s.body.accepted, JSON.stringify(tam.s.body)).toBe(true);

    // dallan
    const dal = await ayriIstek({ g: `${yol.g}/branch`, s: `${yol.s}/branch` }, "POST", { week: 1, patch: { ucret_stopaji: 15 } });
    ayni("dallan", dal, 201);
    const dalDurum = dal.g.body.state, dalSahte = dal.s.body.state;
    for (const [st, ebeveyn] of [[dalDurum, k.g], [dalSahte, k.s]] as const) {
      expect(st.parentRunId).toBe(ebeveyn);
      expect(st.forkWeek).toBe(1);
      expect(st.week).toBe(0);
      expect(st.status).toBe("paused");
      expect(st.preparing).toEqual({ done: 0, total: 1 });
      expect(st.version).toBe(1);
    }
    expect(dalSahte.versions.map((v: Ver) => [v.version, v.fromWeek])).toEqual(dalDurum.versions.map((v: Ver) => [v.version, v.fromWeek]));
    const dalYolu = { g: `/api/runs/${dal.g.body.runId}`, s: `/api/runs/${dal.s.body.runId}` };
    ayni("dal durumu", await ayriIstek(dalYolu, "GET"), 200);
    const yanlisDal = await ayriIstek({ g: `${yol.g}/branch`, s: `${yol.s}/branch` }, "POST", { week: 999 });
    ayni("geçersiz dal", yanlisDal, 422);
    expect(yanlisDal.s.body.error).toMatchObject({ code: yanlisDal.g.body.error.code, fields: yanlisDal.g.body.error.fields });

    // sil
    for (const y of [dalYolu, yol]) {
      const sil = await ayriIstek(y, "DELETE");
      expect([sil.g.status, sil.s.status]).toEqual([204, 204]);
      expect([sil.g.body, sil.s.body]).toEqual([null, null]);
      const yok = await ayriIstek(y, "GET");
      ayni("silinmiş koşu", yok, 404);
      expect(yok.s.body.error.code).toBe(yok.g.body.error.code);
    }
  }, 90_000);

  it("takvimli_baslat_surum_ve_degerler_yayimlanan_haftaya_gore", async () => {
    const takvim = [{ week: 0, patch: { ucret_stopaji: 12 } }, { week: 10, patch: { gecis_destegi: "kisa_sureli" } }, { week: 10, patch: { kurumlar_vergisi: 30 } }];
    const k = await ikiKosu({ config: CONFIG, schedule: takvim, fastForwardTo: 5 });
    ayni("takvimli başlat", k.r, 201);
    const bas = { ucret_stopaji: 12, gecis_destegi: "kapali" };
    for (const st of [k.r.g.body.state, k.r.s.body.state]) {
      expect(st.version, "yayımlanan sürüm (dikiş yayımlanana dek 1)").toBe(1);
      expect(st.values).toEqual(bas);
      expect(st.versions.map((v: Ver) => [v.version, v.fromWeek])).toEqual([[1, 0], [2, 10], [3, 10]]);
      expect(st.versions[0].values).toEqual(bas);
      expect(st.versions[2].values).toEqual({ ...bas, gecis_destegi: "kisa_sureli", kurumlar_vergisi: 30 });
      expect(st.preparing).toEqual({ done: 0, total: 5 });
    }
    const bitti = await bekleAyri(k, (st) => st.preparing === undefined && st.week === 5, "hazırlık");
    expect(bitti.g.version).toBe(1);
    expect(bitti.s.version).toBe(1);
    expect(bitti.s.values).toEqual(bitti.g.values);
    ayni("hazırlık sonrası", await ayriIstek(kosuYolu(k), "GET"), 200);
    await ayriIstek(kosuYolu(k), "DELETE");

    // dikiş yayımlandıktan sonra: sürüm ve değerler son paketin sürümünden
    const k2 = await ikiKosu({ config: CONFIG, schedule: takvim, fastForwardTo: 12 });
    const bitti2 = await bekleAyri(k2, (st) => st.preparing === undefined && st.week === 12, "hazırlık 12");
    expect(bitti2.g.version).toBe(3);
    expect(bitti2.s.version).toBe(3);
    expect(bitti2.s.values).toEqual(bitti2.g.values);
    expect(bitti2.g.values).toEqual({ ...bas, gecis_destegi: "kisa_sureli", kurumlar_vergisi: 30 });
    ayni("hazırlık sonrası 12", await ayriIstek(kosuYolu(k2), "GET"), 200);
    await ayriIstek(kosuYolu(k2), "DELETE");
  }, 90_000);

  it("baglam_kilidi_durum_ret_kullanilabilirlik_ve_dal", async () => {
    const k = await ikiKosu({ config: { ...CONFIG, templateId: "bos_sart" } });
    ayni("kilitli başlat", k.r, 201);
    for (const st of [k.r.g.body.state, k.r.s.body.state]) expect(st.settingLocks).toEqual([{ id: "gecis_destegi", reason: "no_cash_floor" }]);
    const yol = kosuYolu(k);
    for (let i = 0; i < 3; i += 1) await ayriIstek({ g: `${yol.g}/control`, s: `${yol.s}/control` }, "POST", { action: "step", speed: 16 });
    await bekleAyri(k, (st) => st.week >= 2, "adım");
    const ret = await ayriIstek({ g: `${yol.g}/changes`, s: `${yol.s}/changes` }, "POST", { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    ayni("bağlam reddi", ret, 200);
    expect(ret.g.body).toEqual({ accepted: false, fields: [{ id: "gecis_destegi", reason: "start_only" }] });
    expect(ret.s.body).toEqual(ret.g.body);
    // kullanılabilirlik: koşu bağlamında kilitli, başlangıçta serbest
    const [gA, sA] = [await real("POST", "/api/availability", { values: { gecis_destegi: "kurtarma_fonuyla" }, runId: k.g }), await fakeCaller("POST", "/api/availability", { values: { gecis_destegi: "kurtarma_fonuyla" }, runId: k.s })];
    ayni("kullanılabilirlik (koşu)", { g: gA, s: sA }, 200);
    expect(sA.body).toEqual(gA.body);
    expect(gA.body.blocked).toEqual([{ settingId: "gecis_destegi", option: "kurtarma_fonuyla", reason: "start_only" }]);
    const bas = await ikisi("POST", "/api/availability", { values: { gecis_destegi: "kurtarma_fonuyla" } });
    ayni("kullanılabilirlik (başlangıç)", bas, 200);
    expect(bas.s.body).toEqual(bas.g.body);
    // dal: ebeveynin kilidi sürer, kilitli yama reddedilir
    const dal = await ayriIstek({ g: `${yol.g}/branch`, s: `${yol.s}/branch` }, "POST", { week: 1 });
    ayni("yamasız dal", dal, 201);
    for (const st of [dal.g.body.state, dal.s.body.state]) expect(st.settingLocks).toEqual([{ id: "gecis_destegi", reason: "no_cash_floor" }]);
    const kilitliDal = await ayriIstek({ g: `${yol.g}/branch`, s: `${yol.s}/branch` }, "POST", { week: 1, patch: { gecis_destegi: "kurtarma_fonuyla" } });
    ayni("kilitli yamalı dal", kilitliDal, 422);
    expect(kilitliDal.g.body.error.code).toBe("invalid_branch");
    expect(kilitliDal.s.body.error).toMatchObject({ code: "invalid_branch", fields: kilitliDal.g.body.error.fields });
    for (const id of [dal.g.body.runId, k.g]) await real("DELETE", `/api/runs/${id}`);
    for (const id of [dal.s.body.runId, k.s]) await fakeCaller("DELETE", `/api/runs/${id}`);
    // kilitsiz bağlam: aynı şablon + kuruluş fonu açık
    const acik = await ikiKosu({ config: { ...CONFIG, templateId: "bos_sart", values: { kurulus_fonu: { acik: true, hedef: 50 } } } });
    for (const st of [acik.r.g.body.state, acik.r.s.body.state]) expect(st).not.toHaveProperty("settingLocks");
    await ayriIstek(kosuYolu(acik), "DELETE");
  }, 90_000);

  it("gecersiz_baslatma_hata_govdeleri", async () => {
    for (const [ad, config, alan] of [
      ["uzun ad", { ...CONFIG, name: "u".repeat(65) }, "name"],
      ["uzun şehir adı", { ...CONFIG, cityNames: ["a".repeat(65), "b", "c", "d", "e"] }, "cityNames"],
      ["altı şehir", { ...CONFIG, cityNames: ["a", "b", "c", "d", "e", "f"] }, "cityNames"],
    ] as const) {
      const r = await ikisi("POST", "/api/runs", { config });
      ayni(ad, r, 422);
      expect(r.g.body.error.code).toBe("invalid_config");
      expect(r.s.body.error.code).toBe("invalid_config");
      expect(r.s.body.error.fields, ad).toEqual(r.g.body.error.fields);
      expect(r.g.body.error.fields[0].id).toBe(alan);
    }
    const yok = await ikisi("POST", "/api/runs", {});
    ayni("config yok", yok, 422);
    expect(yok.s.body.error.fields).toEqual(yok.g.body.error.fields);
    const bilinmeyen = await ikisi("GET", "/api/runs/canli-00000000");
    ayni("bilinmeyen koşu", bilinmeyen, 404);
    expect(bilinmeyen.s.body.error.code).toBe(bilinmeyen.g.body.error.code);
    const lim = await ikisi("POST", "/api/runs", { config: { ...CONFIG, cityNames: ["a".repeat(64), "b", "c", "d", "e"], name: "u".repeat(64) } });
    ayni("sınırdaki adlar", lim, 201);
    await Promise.all([real("DELETE", `/api/runs/${lim.g.body.runId}`), fakeCaller("DELETE", `/api/runs/${lim.s.body.runId}`)]);
  }, 60_000);

  it("is_baslat_iptal_ve_onizleme_fromWeek_siniri", async () => {
    const baslat = await ikisi("POST", "/api/jobs", { kind: "seeds", recipe: { config: CONFIG } });
    ayni("iş başlat", baslat, 201);
    const yol = { g: `/api/jobs/${baslat.g.body.jobId}`, s: `/api/jobs/${baslat.s.body.jobId}` };
    const durum = await ayriIstek(yol, "GET");
    ayni("iş durumu", durum, 200, { serbest: new Set(["error", "series", "weeks"]) });
    const iptal = await ayriIstek(yol, "DELETE");
    ayni("iş iptal", iptal, 200, { serbest: new Set(["error", "series", "weeks"]) });
    expect(["cancelled", "done"]).toContain(iptal.g.body.status);
    expect(["cancelled", "done"]).toContain(iptal.s.body.status);
    const gecersiz = await ikisi("POST", "/api/jobs", { kind: "preview", base: { ...CONFIG, durationWeeks: 100 }, draft: { ...CONFIG, durationWeeks: 100 }, fromWeek: 100 });
    ayni("fromWeek süreyi aşar", gecersiz, 422);
    expect(gecersiz.g.body.error.code).toBe("invalid_job");
    expect(gecersiz.s.body.error.fields).toEqual(gecersiz.g.body.error.fields);
    expect(gecersiz.g.body.error.fields).toEqual([{ id: "fromWeek", reason: "invalid" }]);
    const yokIs = await ikisi("GET", "/api/jobs/job-00000000");
    ayni("bilinmeyen iş", yokIs, 404);
  }, 60_000);

  it("kosular_gecici_dizine_yazilir_gercek_kosular_dizinine_degil", () => {
    // önceki testler koşu başlattı: koşular OYUN_RUNS_DIR (geçici) altında, gerçek simulasyon/arayuz/kosular/ değişmedi
    expect(listele(path.join(tmp, "kosular")).length).toBeGreaterThan(0);
    expect(listele(GERCEK_KOSULAR)).toEqual(gercekOnce);
  });
});
