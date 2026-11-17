import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import { parseDaoGozlem } from "@/oyun/sim/live/wire";
import type { RunConfig } from "@/oyun/sim/types";
import DAO_KARAR from "../../helpers/daoKarar.json";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

/**
 * Sahte sunucu, gerçek sunucunun örnek yanıtlarından (`wire_contract.json`) ayrışmasın (A7b incelemesi, L4).
 * DK-15 (tel toleransı): gerçek sunucu yeni alan ekleyebilir; bu yüzden fikstür bu testte ALT KÜME olarak denetlenir:
 * web'in bugün tükettiği çekirdek anahtarlar hem fikstürde hem sahte yanıtta bulunur ve eşittir; fikstürdeki ek anahtarlar serbesttir.
 */
const STATE_CORE = ["runId", "status", "week", "durationWeeks", "speed", "computing", "version", "seedIndex", "values", "scenarioId", "name", "cityNames"];
const CHANGE_CORE = ["accepted", "runId", "mode", "scenarioId", "seamWeek", "version"];
const hasAll = (obj: Record<string, unknown>, keys: string[]): void => {
  for (const k of keys) expect(Object.keys(obj), `anahtar: ${k}`).toContain(k);
};
const includesById = (actual: unknown, expected: unknown): void => {
  const have = new Map((actual as { id?: string; settingId?: string }[]).map((x) => [x.id ?? x.settingId, x]));
  for (const e of expected as { id?: string; settingId?: string }[]) expect(have.get(e.id ?? e.settingId)).toMatchObject(e as object);
};

const FILE = path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json");
type Fix = {
  availability_ok: unknown;
  info: { fixedRules: unknown; settings: unknown; seeds: unknown; templates: unknown };
  state_ready: Record<string, unknown>;
  change_accepted: Record<string, unknown>;
  change_rejected_multi: unknown;
  version_event: { changes: { id: string; from: unknown; to: unknown }[] };
  state_note_version: { versions: { version: number; fromWeek: number; values: Record<string, unknown>; note?: string }[] };
  state_setting_locks: { settingLocks: { id: string; reason: string }[] };
  dao_gozlem: Record<string, unknown> & { ben: Record<string, unknown>; kurabilir: Record<string, unknown>; sehir: Record<string, unknown>; gecmis: Record<string, unknown>; sektorler: Record<string, unknown>[]; loncalar: Record<string, unknown>[]; firmam: Record<string, unknown>; olaylar: { tur: string }[] };
  state_dao: Record<string, unknown>;
  enums: { controlActions: string[] };
};
const FIX = JSON.parse(readFileSync(FILE, "utf-8")) as Fix;
const cfg: RunConfig = { name: "Deneme", cityNames: ["A", "B", "C", "D", "E"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };

async function raw<T = Record<string, unknown>>(server: ReturnType<typeof createFakeLiveServer>, method: string, p: string, body?: unknown): Promise<T> {
  const r = await server.fetch(`http://127.0.0.1:8765/api${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await r.json()) as T;
}

describe("sahte sunucu == wire_contract.json", () => {
  it("availability_ok_ayni", async () => {
    const s = createFakeLiveServer();
    expect(await raw(s, "POST", "/availability", { values: { gecis_destegi: "kapali" } })).toEqual(FIX.availability_ok);
  });

  it("info_sabit_kurallar_ve_ayarlar_ayni", async () => {
    const s = createFakeLiveServer();
    const info = await raw<Fix["info"]>(s, "GET", "/info");
    includesById(info.fixedRules, FIX.info.fixedRules);
    includesById(info.settings, FIX.info.settings);
    includesById(info.templates, FIX.info.templates);
    expect(info.seeds).toEqual(expect.arrayContaining(FIX.info.seeds as unknown[]));
  });

  it("kosu_durumu_sablon_kimligi_ve_ayni_anahtarlar", async () => {
    const s = createFakeLiveServer();
    const h = await raw<{ runId: string; state: Record<string, unknown> }>(s, "POST", "/runs", { config: cfg });
    expect(h.state.scenarioId).toBe(cfg.templateId);
    expect(h.state.scenarioId).toBe(FIX.state_ready.scenarioId);
    hasAll(FIX.state_ready, STATE_CORE);
    hasAll(h.state, STATE_CORE);
    for (const k of ["status", "week", "version", "durationWeeks", "scenarioId"]) expect(h.state[k], k).toEqual(FIX.state_ready[k]);
  });

  it.each([["too_many_runs", 429, "error_too_many_runs"], ["busy_preparing", 409, "error_busy_preparing"]] as const)("start_%s_yaniti_ayni", async (code, status, key) => {
    const s = createFakeLiveServer();
    s.startFailWith = code;
    const r = await s.fetch("http://127.0.0.1:8765/api/runs", { method: "POST", body: JSON.stringify({ config: cfg }) });
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual((FIX as unknown as Record<string, unknown>)[key]);
  });

  it("notlu_surum_ve_baglam_kilidi_fikstur_ile_ayni", async () => {
    const s = createFakeLiveServer();
    const note = FIX.state_note_version.versions[1]!.note!;
    const h = await raw<{ runId: string }>(s, "POST", "/runs", { config: cfg });
    await raw(s, "POST", `/runs/${h.runId}/control`, { action: "step" });
    await raw(s, "POST", `/runs/${h.runId}/changes`, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" }, note });
    const st = (await raw<{ state: { versions: Fix["state_note_version"]["versions"] } }>(s, "GET", `/runs/${h.runId}`)).state;
    expect(st.versions.map((v) => ("note" in v ? v.note : undefined))).toEqual([undefined, note]);
    expect(Object.keys(st.versions[1]!).sort()).toEqual(Object.keys(FIX.state_note_version.versions[1]!).sort());
    const k = await raw<{ state: Record<string, unknown> }>(s, "POST", "/runs", { config: { ...cfg, templateId: "bos_sart" } });
    expect(k.state.settingLocks).toEqual(FIX.state_setting_locks.settingLocks);
    const a = await raw<{ state: Record<string, unknown> }>(s, "POST", "/runs", { config: cfg });
    expect(a.state).not.toHaveProperty("settingLocks");
  });

  it("degisiklik_kabulu_ayni_alanlar", async () => {
    const s = createFakeLiveServer();
    const h = await raw<{ runId: string }>(s, "POST", "/runs", { config: cfg });
    await raw(s, "POST", `/runs/${h.runId}/control`, { action: "step" });
    const r = await raw(s, "POST", `/runs/${h.runId}/changes`, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    hasAll(FIX.change_accepted, CHANGE_CORE);
    hasAll(r, CHANGE_CORE);
    expect(r.scenarioId).toBe(cfg.templateId);
    expect(r.mode).toBe("live");
  });

  it("cok_ayarli_yama_atomik_ret_ayni_ve_kabulde_changes_biçimi_ayni", async () => {
    const s = createFakeLiveServer();
    const h = await raw<{ runId: string }>(s, "POST", "/runs", { config: { ...cfg, values: { gecis_destegi: "kapali", ucret_stopaji: 10 } } });
    await raw(s, "POST", `/runs/${h.runId}/control`, { action: "step" });
    // Bir geçersiz ayar bütün yamayı reddeder; ret her geçersiz ayarı kendi nedeniyle yama sırasıyla sayar.
    const ret = await raw(s, "POST", `/runs/${h.runId}/changes`, { from: "next_week", patch: { dunya_tohumu: 1, dunya_sabit_kalemleri: 10 } });
    expect(ret).toEqual(FIX.change_rejected_multi);
    const karma = await raw(s, "POST", `/runs/${h.runId}/changes`, { from: "next_week", patch: { gecis_destegi: "kisa_sureli", dunya_tohumu: 1 } });
    expect(karma).toEqual({ accepted: false, fields: [{ id: "dunya_tohumu", reason: "start_only" }] });
    const durum = await raw<{ state: { version: number; values: Record<string, unknown> } }>(s, "GET", `/runs/${h.runId}`);
    expect(durum.state.version).toBe(1);                                                        // koşu değişmedi
    expect(durum.state.values.gecis_destegi).toBe("kapali");
    const kabul = await raw(s, "POST", `/runs/${h.runId}/changes`, { from: "next_week", patch: { gecis_destegi: "kisa_sureli", ucret_stopaji: 12.5 } });
    hasAll(kabul, CHANGE_CORE);
    const ev = s.run(h.runId)!.versionEvents[0]!;
    expect(Object.keys(ev.changes![0]!).sort()).toEqual(Object.keys(FIX.version_event.changes[0]!).sort());
    expect(ev.changes).toEqual([{ id: "gecis_destegi", from: "kapali", to: "kisa_sureli" }, { id: "ucret_stopaji", from: 10, to: 12.5 }]);
  });

  it("bilinmeyen_govde_alanlari_yok_sayilir_bilinenler_yankilanir_ve_yetenekler_kapali", async () => {
    const s = createFakeLiveServer();
    const hello = await raw<{ capabilities: Record<string, boolean> }>(s, "GET", "/hello");
    expect(Object.values(hello.capabilities).every((v) => v === false)).toBe(true);
    const h = await raw<{ runId: string; state: Record<string, unknown> }>(s, "POST", "/runs", {
      config: { ...cfg, worldScenarioId: "ozel", worldScenarioValues: { x: 1 }, goals: ["alive"], yeniAlan: 1 }, ek: true,
    });
    expect(h.state.scenarioId).toBe(cfg.templateId);
    expect(h.state).toMatchObject({ worldScenarioId: "ozel", worldScenarioValues: { x: 1 }, goals: ["alive"] });     // gerçek sunucu gibi (W10)
    expect(h.state).not.toHaveProperty("yeniAlan");
  });

  it("canli_kaynak_ayni_kilit_metnini_gorur", async () => {
    const s = createFakeLiveServer();
    const src = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: s.fetch, eventSourceImpl: s.EventSource });
    const info = await src.info();
    expect(info.fixedRules.every((x) => x.valueKey === `lock.deger.${x.settingId}` && typeof x.valueText === "string")).toBe(true);
    src.dispose();
  });

  // Gerçek sunucu (`runs/routes.py create`) takvimi ve ileri sarmayı yalnız gövdenin üst düzeyinde okur; `config` içindekiler yok sayılır.
  // Sahte sunucu da öyle davranır: ilk W11'de istemci bunları config içinde gönderiyordu ve bu hata testte görünmüyordu.
  it("start_reads_schedule_and_fast_forward_only_at_the_body_top_level_like_the_real_server", async () => {
    const server = createFakeLiveServer();
    const cfg = { name: "A", cityNames: [], templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 0, values: {} };
    const sched = [{ week: 10, patch: { x: 1 } }];
    const post = async (body: unknown) => (await (await server.fetch("http://x/api/runs", { method: "POST", body: JSON.stringify(body) })).json()) as { state: { preparing?: unknown; versions?: unknown[] } };
    const icinde = await post({ config: { ...cfg, schedule: sched, fastForwardTo: 10 } });
    expect(icinde.state.preparing).toBeUndefined();
    expect(icinde.state.versions).toHaveLength(1);            // config içindeki takvim yok sayılır; gerçek sunucu her zaman `versions` yayımlar
    const ustte = await post({ config: cfg, schedule: sched, fastForwardTo: 10 });
    expect(ustte.state.preparing).toEqual({ done: 0, total: 10 });
    expect(ustte.state.versions).toHaveLength(2);
  });

  it("holdings_blogu_ayni_bolumler_ve_lonca_satiri_ayni_anahtarlar", async () => {
    const s = createFakeLiveServer();
    s.capabilities.city = true;
    const h = await raw<{ runId: string }>(s, "POST", "/runs", { config: cfg });
    await raw(s, "POST", `/runs/${h.runId}/control`, { action: "step" });
    const [pk] = await raw<{ holdings: Record<string, unknown> }[]>(s, "GET", `/runs/${h.runId}/weeks?from=1&to=1`) as unknown as { holdings: Record<string, unknown> }[];
    const fix = (JSON.parse(readFileSync(FILE, "utf-8")) as { packet: { holdings: Record<string, unknown> } }).packet.holdings;
    expect(Object.keys(pk!.holdings).sort()).toEqual(Object.keys(fix).sort());
    expect(Object.keys((pk!.holdings.loncas as object[])[0]!).sort()).toEqual(Object.keys((fix.loncas as object[])[0]!).sort());
    expect(Object.keys(pk!.holdings.money as object).sort()).toEqual(Object.keys(fix.money as object).sort());
    const d = await raw<{ fields: Record<string, unknown>; stale: boolean }>(s, "GET", `/runs/${h.runId}/drawer/lonca/lonca1?week=1`);
    expect(d.stale).toBe(false);
    expect(Object.keys(d.fields).sort()).toEqual(["capital", "credit_out", "deposits", "equity", "fee", "members", "owner"]);
  });

  it("isletme_cekmecesi_ve_harita_sikligi_gercek_isciyle_ayni", async () => {
    const s = createFakeLiveServer();
    s.capabilities.city = true;
    s.capabilities.harita = true;
    const h = await raw<{ runId: string }>(s, "POST", "/runs", { config: cfg });
    for (let i = 0; i < 3; i++) await raw(s, "POST", `/runs/${h.runId}/control`, { action: "step" });
    const d = await raw<{ fields: Record<string, unknown> }>(s, "GET", `/runs/${h.runId}/drawer/firm/fk0?week=2`);
    for (const k of ["product", "price", "wage_avg", "sold_week", "profit_hist"]) expect(d.fields).toHaveProperty(k);
    const pk = await raw<{ week: number; harita?: unknown; haritaFark?: { taban: number } }[]>(s, "GET", `/runs/${h.runId}/weeks?from=1&to=3`);
    expect(pk.map((p) => "harita" in p)).toEqual([true, false, false]);      // Kurucu: tam harita 1. hafta ve 10'un katlarında,
    expect(pk.map((p) => p.haritaFark?.taban ?? null)).toEqual([null, 1, 1]);      // aradaki haftalarda son tam haftaya göre fark
  });

  it("start_refuses_a_name_longer_than_the_servers_limit", async () => {
    const server = createFakeLiveServer();
    const r = await server.fetch("http://x/api/runs", { method: "POST", body: JSON.stringify({ config: { name: "u".repeat(65), cityNames: [], templateId: "t", durationWeeks: 100, seedIndex: 0, values: {} } }) });
    expect(r.status).toBe(422);
  });

  describe("DAO uç noktaları", () => {
    const dao: RunConfig = { ...cfg, durationWeeks: 520, mode: "dao" };
    const anahtarlar = (o: Record<string, unknown>): string[] => Object.keys(o).sort();
    const baslat = async () => {
      const s = createFakeLiveServer();
      const h = await raw<{ runId: string; state: Record<string, unknown> }>(s, "POST", "/runs", { config: dao });
      return { s, id: h.runId, state: h.state };
    };

    it("dao_kosusunun_durumu_mode_ve_sureyi_fikstur_gibi_tasir", async () => {
      const { state } = await baslat();
      expect(state.mode).toBe(FIX.state_dao.mode);
      expect(state.durationWeeks).toBe(FIX.state_dao.durationWeeks);
      hasAll(state, STATE_CORE);
    });

    it("get_dao_gozlemi_fikstur_ile_ayni_anahtarlar", async () => {
      const { s, id } = await baslat();
      await raw(s, "POST", `/runs/${id}/control`, { action: "step" });
      const g = await raw<typeof FIX.dao_gozlem>(s, "GET", `/runs/${id}/dao`);
      const f = FIX.dao_gozlem;
      expect(anahtarlar(g)).toEqual(anahtarlar(f));
      for (const k of ["ben", "kurabilir", "sehir", "gecmis"] as const) expect(anahtarlar(g[k]), k).toEqual(anahtarlar(f[k]));
      expect(anahtarlar(g.ben.mevduat as Record<string, unknown>)).toEqual(anahtarlar(f.ben.mevduat as Record<string, unknown>));
      expect(anahtarlar(g.ben.is as Record<string, unknown>)).toEqual(anahtarlar(f.ben.is as Record<string, unknown>));
      expect(anahtarlar(g.sektorler[0]!)).toEqual(anahtarlar(f.sektorler[0]!));
      expect(anahtarlar(g.loncalar[0]!)).toEqual(anahtarlar(f.loncalar[0]!));
      expect(anahtarlar((g.tercih as Record<string, unknown>))).toEqual(anahtarlar(f.tercih as Record<string, unknown>));
    });

    it("paketin_dao_alani_get_dao_ile_ayni_ve_olay_alanlari_fikstur_turlerinden", async () => {
      const { s, id } = await baslat();
      await raw(s, "POST", `/runs/${id}/control`, { action: "step" });
      const g = await raw(s, "GET", `/runs/${id}/dao`);
      const p = await raw<{ dao: unknown }[]>(s, "GET", `/runs/${id}/weeks?from=1&to=1`);
      expect(p[0]!.dao).toEqual(g);
      expect(() => parseDaoGozlem(g)).not.toThrow();
    });

    it("kontrol_eylemleri_olay_dahil_ve_olay_hizi_16_yapar", async () => {
      const { s, id } = await baslat();
      expect(FIX.enums.controlActions).toContain("olay");
      const st = await raw<Record<string, unknown>>(s, "POST", `/runs/${id}/control`, { action: "olay" });
      expect(st.speed).toBe(16);
    });

    it("karar_202_kabul_ve_ret_govdesi_hata_biçimi_error_code_fields_id_reason", async () => {
      const { s, id } = await baslat();
      const r = await s.fetch(`http://127.0.0.1:8765/api/runs/${id}/dao/karar`, { method: "POST", body: JSON.stringify({ tur: "cek", miktar: 2 }) });
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual(DAO_KARAR.kabul);
      const ret = await s.fetch(`http://127.0.0.1:8765/api/runs/${id}/dao/karar`, { method: "POST", body: JSON.stringify({ tur: "uzay" }) });
      expect(ret.status).toBe(422);
      const b = (await ret.json()) as { error: { code: string; message: string; fields: { id: string; reason: string }[] } };
      expect(b.error.code).toBe("karar_gecersiz");
      expect(b).toEqual(DAO_KARAR.ret_422);
    });

    it("karar_belirsiz_504_ayni_hata_govdesi_biçimiyle", async () => {
      const { s, id } = await baslat();
      s.daoKararBelirsiz = true;
      const r = await s.fetch(`http://127.0.0.1:8765/api/runs/${id}/dao/karar`, { method: "POST", body: JSON.stringify({ tur: "ayril" }) });
      expect(r.status).toBe(504);
      const b = (await r.json()) as { error: { code: string; fields: unknown[] } };
      expect(b).toEqual(DAO_KARAR.belirsiz_504);
    });
  });
});
