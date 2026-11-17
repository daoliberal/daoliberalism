import { afterEach, describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import type { RunConfig, SimEvent, SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

const dao: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 520, seedIndex: 0, values: {}, mode: "dao" };
const kurucu: RunConfig = { ...dao, durationWeeks: 200, mode: undefined };
let toDispose: SimSource[] = [];
afterEach(() => { toDispose.forEach((s) => s.dispose()); toDispose = []; });
function mk() {
  const server = createFakeLiveServer();
  const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  toDispose.push(source);
  return { server, source };
}
const kod = async (p: Promise<unknown>): Promise<string> => p.then(() => "kabul", (e: unknown) => (e instanceof SimUnsupported ? e.message : "baska"));

describe("LiveSource DAO", () => {
  it("start_mode_dao_gonderir_ve_durum_mode_tasir", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    expect((server.requests.at(-1)!.body as { config: RunConfig }).config.mode).toBe("dao");
    expect(h.state).toMatchObject({ mode: "dao", durationWeeks: 520 });
    const k = await source.start(kurucu);
    expect(k.state.mode).toBeUndefined();
  });

  it("daoGozlem_okur", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    const g = await source.daoGozlem!(h.runId);
    expect(server.requests.at(-1)).toMatchObject({ method: "GET", path: expect.stringMatching(new RegExp(`/api/runs/${h.runId}/dao$`)) });
    expect(g.ben.durum).toBe("ahir");
    expect(g.kurabilir.evet).toBe(false);
  });

  it("kurucu_kosusunda_dao_degil_hazirlaniyor_ve_bilinmeyen_kosu", async () => {
    const { server, source } = mk();
    const k = await source.start(kurucu);
    expect(await kod(source.daoGozlem!(k.runId))).toBe("dao_degil");
    expect(await kod(source.daoKarar!(k.runId, { tur: "ayril" }))).toBe("dao_degil");
    const h = await source.start(dao);
    server.daoHazirlaniyor = true;
    expect(await kod(source.daoGozlem!(h.runId))).toBe("hazirlaniyor");
    expect(await kod(source.daoGozlem!("yok"))).toBe("unknown_run");
  });

  it("karar_kabul_uygulama_haftasini_doner_ve_govdeyi_oldugu_gibi_yollar", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    const k = { tur: "mevduat", lonca: "lonca0", oran: 0.5 } as const;
    expect(await source.daoKarar!(h.runId, k)).toEqual({ kabul: true, hafta: 1 });
    const req = server.requests.at(-1)!;
    expect(req).toMatchObject({ method: "POST", body: k });
    expect(req.path).toMatch(new RegExp(`/api/runs/${h.runId}/dao/karar$`));
    await source.control(h.runId, { action: "step" });
    expect(await source.daoKarar!(h.runId, { tur: "cek", miktar: 5 })).toEqual({ kabul: true, hafta: 2 });
  });

  it.each([
    ["ayni_hafta", [{ tur: "goc", sehir: 1 }, { tur: "cek", miktar: 1 }]],
    ["karar_gecersiz", [{ tur: "ayril" }]],
    ["karar_gecersiz", [{ tur: "basvur", firma: "f1" }]],
    ["karar_gecersiz", [{ tur: "uzay" }]],
    ["karar_gecersiz", [{ tur: "mevduat", lonca: "lonca0", oran: 1.5 }]],
    ["karar_gecersiz", [{ tur: "goc", sehir: 9 }]],
  ] as const)("ret_%s", async (beklenen, kararlar) => {
    const { source } = mk();
    const h = await source.start(dao);
    let son = "kabul";
    for (const k of kararlar) son = await kod(source.daoKarar!(h.runId, k as never));
    expect(son).toBe(beklenen);
  });

  it("kosu_bitti_ve_once_cek_ve_kurucuyken_goc", async () => {
    const { server, source } = mk();
    const h = await source.start({ ...dao, durationWeeks: 3 });
    await source.daoKarar!(h.runId, { tur: "mevduat", lonca: "lonca0", oran: 1 });
    server.run(h.runId)!.dao!.mevduat = { lonca: "lonca0", tutar: 50 };
    expect(await kod(source.daoKarar!(h.runId, { tur: "mevduat", lonca: "lonca1", oran: 1 }))).toBe("once_cek");
    server.run(h.runId)!.dao!.durum = "kurucu";
    expect(await kod(source.daoKarar!(h.runId, { tur: "goc", sehir: 2 }))).toBe("kurucuyken_goc");
    for (let i = 0; i < 3; i++) await source.control(h.runId, { action: "step" });
    expect(await kod(source.daoKarar!(h.runId, { tur: "ayril" }))).toBe("kosu_bitti");
  });

  it("olay_eylemi_olay_olana_kadar_oynar_ve_durur", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    await source.daoKarar!(h.runId, { tur: "ahirdan_cik" });
    const olaylar: SimEvent[] = [];
    source.subscribe(h.runId, (e) => olaylar.push(e));
    const s = await source.control(h.runId, { action: "olay" });
    expect(server.requests.at(-1)!.body).toEqual({ action: "olay" });
    expect(s).toMatchObject({ status: "paused", week: 1 });
    const g = await source.daoGozlem!(h.runId);
    expect(g.olaylar.map((o) => o.tur)).toEqual(["ahirdan_cikti"]);
  });

  it("olay_olmazsa_sure_bitince_biter", async () => {
    const { source } = mk();
    const h = await source.start({ ...dao, durationWeeks: 4 });
    const s = await source.control(h.runId, { action: "olay" });
    expect(s).toMatchObject({ status: "ended", week: 4 });
  });

  it("dao_kosusunda_kural_degistirme_403", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    expect((await source.applyChange(h.runId, { from: "next_week", patch: { gecis_destegi: "kapali" } })).accepted).toBe(false);
    const r = await server.fetch(`http://127.0.0.1:8765/api/runs/${h.runId}/branch`, { method: "POST", body: JSON.stringify({ week: 1 }) });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("dao_kural_degistiremez");
  });

  it("paketler_dao_alani_tasir", async () => {
    const { source } = mk();
    const h = await source.start(dao);
    await source.control(h.runId, { action: "step" });
    const w = await source.weeks(h.runId, 1, 1);
    expect(w[0]!.dao?.hafta).toBe(1);
  });

  it("agi_olmayan_sunucuda_hata_anahtari", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    server.failWith = "network";
    expect(await kod(source.daoKarar!(h.runId, { tur: "ayril" }))).toBe("hata.sunucu_yok");
    server.failWith = 500;
    expect(await kod(source.daoGozlem!(h.runId))).toBe("hata.sunucu_bozuk");
  });

  it("karar_belirsiz_504_kodu_tasinir_ve_yeniden_denenmez", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    server.daoKararBelirsiz = true;
    const once = server.requests.length;
    expect(await kod(source.daoKarar!(h.runId, { tur: "ayril" }))).toBe("karar_belirsiz");
    expect(server.requests.length).toBe(once + 1); // kör yeniden deneme yok
    server.failWith = 500;
    expect(await kod(source.daoKarar!(h.runId, { tur: "ayril" }))).toBe("hata.sunucu_bozuk"); // öbür 5xx gövdesiz bozuk sayılır
  });

  it("kodsuz_ya_da_json_olmayan_504_karar_belirsiz_sayilir", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    const gercek = server.fetch;
    const yanit = (govde: string) => (async (u: RequestInfo | URL, i?: RequestInit) => (String(u).endsWith("/dao/karar") ? new Response(govde, { status: 504 }) : gercek(u, i))) as typeof fetch;
    for (const govde of ["<html>Gateway Timeout</html>", "", "{}"]) {
      const s2 = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: yanit(govde), eventSourceImpl: server.EventSource });
      toDispose.push(s2);
      expect(await kod(s2.daoKarar!(h.runId, { tur: "ayril" }))).toBe("karar_belirsiz");
    }
  });

  it("yanittaki_hafta_oldugu_gibi_doner_yayimlanan_hafta_arti_iki_olabilir", async () => {
    const { server, source } = mk();
    const h = await source.start(dao);
    server.daoHaftaSapmasi = 1;
    expect(await source.daoKarar!(h.runId, { tur: "cek", miktar: 1 })).toEqual({ kabul: true, hafta: 2 });
  });

  it("olay_hizi_16_yapar_ve_pause_speed_ile_onceki_hiz_geri_yuklenir", async () => {
    const { source } = mk();
    const h = await source.start(dao);
    await source.daoKarar!(h.runId, { tur: "ahirdan_cik" });
    const s = await source.control(h.runId, { action: "olay" });
    expect(s.speed).toBe(16);
    const geri = await source.control(h.runId, { action: "pause", speed: 1 });
    expect(geri).toMatchObject({ speed: 1, status: "paused" });
  });

  it("bitmis_kosuda_get_dao_gozlemin_kendisini_doner", async () => {
    const { source } = mk();
    const h = await source.start({ ...dao, durationWeeks: 2 });
    await source.control(h.runId, { action: "olay" });
    const g = await source.daoGozlem!(h.runId);
    expect(g.hafta).toBe(2);
  });
});
