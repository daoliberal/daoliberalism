import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAvailability, parseChange, parseDaoGozlem, parseDaoYaniti, parseDrawer, CEKMECE_TURLERI, parseEnded, parseEvent, parseHandle, parseHello, parseInfo, parseIsletmeCekmecesi, parsePacket, parsePackets, parseServerError, parseState,
} from "@/oyun/sim/live/wire";

/**
 * DK-15 (tel toleransı): sunucu yeni alan/anahtar ekleyebilir; bu testler fikstürü ALT KÜME olarak denetler
 * (beklenen kimlikler ⊆ gerçek), tam eşitlik aramaz. Yeni alanı katı ayrıştırma onu tüketen W görevinin işidir.
 * Sunucu (Python, A7b) ile ortak örnekler: `simulasyon/arayuz/server/tests/fixtures/wire_contract.json`.
 * Python tarafı (`tests/test_wire_contract.py`) gerçek yanıtların biçimini bu örneklerle karşılaştırır;
 * burada aynı örnekler `wire.ts` ayrıştırıcılarından geçer. Bir taraf sapınca bir test kırılır.
 */
const FILE = path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json");
const FIX = JSON.parse(readFileSync(FILE, "utf-8")) as Record<string, unknown>;
const at = (k: string): unknown => {
  if (!(k in FIX)) throw new Error(`örnek yok: ${k}`);
  return FIX[k];
};

describe("holdings bloğu (PLAN-TAKIP T5)", () => {
  const paket = () => structuredClone(at("packet")) as Record<string, unknown> & { holdings: Record<string, unknown> };

  it("yeni_sozlesme_blogu_ayristirir_ve_kimlik_tasimaz", () => {
    const p = parsePacket(at("packet"));
    expect(p.holdings).toBeDefined();
    const h = p.holdings!;
    expect(h.money).toMatchObject({ deposits_players: 901, lonca_cash_net: -149, credit_out: 2000, bonds_out: 40 });
    expect(h.loncas).toHaveLength(6);
    expect(h.loncas.map((l) => l.owner)).toEqual(["none", "player", "none", "none", "none", "closed"]);
    expect(Object.keys(h.loncas[0]!).sort()).toEqual(["capital", "credit_out", "deposits", "equity", "fee", "members", "owner", "ref"]);
    expect(h.groups.player.lonca_owner).toEqual({ n: 10, cash: 1001, deposits: 0 });
    expect(h.groups.npc.pool).toEqual({ n: 53, cash: 2001 });
    expect(h.wealth).toMatchObject({ b50: 0.05, t1: 0.201, n: 1500 });
    expect(h.flows?.[0]).toEqual({ from: "players", to: "npc_firms", amount: 88000 });
    expect(h.flows).toHaveLength(6);
    expect(JSON.stringify(h)).not.toMatch(/flow_kinds/);
  });

  it("eski_sozlesme_blok_yok_alan_da_yok", () => {
    const p = paket();
    delete (p as Record<string, unknown>).holdings;
    expect("holdings" in parsePacket(p)).toBe(false);
  });

  it("eski_web_yeni_kaydi_yok_sayar_yeni_web_bilinmeyen_alani_yok_sayar", () => {
    const p = paket();
    p.holdings.yeni_bolum = { x: 1 };
    (p.holdings.money as Record<string, unknown>).yeni_alan = 5;
    (p.holdings.loncas as Record<string, unknown>[])[0]!.kisi = "gizli";
    const h = parsePacket(p).holdings!;
    expect(JSON.stringify(h)).not.toMatch(/yeni_bolum|yeni_alan|gizli/);
  });

  it("bozuk_blok_undefined_sayi_olmayan_deger_null_bozuk_satir_duser", () => {
    const p = paket();
    expect(parsePacket({ ...p, holdings: "bozuk" }).holdings).toBeUndefined();
    expect(parsePacket({ ...p, holdings: [1] }).holdings).toBeUndefined();
    expect(parsePacket({ ...p, holdings: null }).holdings).toBeUndefined();
    (p.holdings.money as Record<string, unknown>).bonds_out = "x";
    (p.holdings.money as Record<string, unknown>).found_fund = Number.NaN;
    p.holdings.loncas = [{ ref: 5 }, { ref: "lonca0", owner: "belirsiz", members: "a" }];
    p.holdings.flows = [["a", "b"], ["players", "npcs", "x"], ["players", "npcs", 7]];
    const h = parsePacket(p).holdings!;
    expect(h.money.bonds_out).toBeNull();
    expect(h.money.found_fund).toBeNull();
    expect(h.loncas).toEqual([expect.objectContaining({ ref: "lonca0", owner: null, members: null })]);
    expect(h.flows).toEqual([{ from: "players", to: "npcs", amount: 7 }]);
  });

  it("akis_yoksa_null", () => {
    const p = paket();
    delete p.holdings.flows;
    expect(parsePacket(p).holdings!.flows).toBeNull();
  });
});

describe("wire sözleşmesi (sunucu örnekleri)", () => {
  it("hello", () => {
    expect(parseHello(at("hello"))).toEqual({ serverVersion: "0.1.0", modelVersion: "v13.3", defaultsHash: "0123456789abcdef", secPerWeekP50: 0.98 });
  });

  it("info: canlı kaynak, ayarlar, kilitli kurallar (valueText), şablon, tohum", () => {
    const info = parseInfo(at("info"));
    expect(info.kind).toBe("live");
    expect(info.durationWeeks).toBe(200);
    expect(info.modelNote).toBe("v13.3");
    expect(info.settings.map((s) => s.id)).toEqual(expect.arrayContaining(["gecis_destegi", "dunya_tohumu"]));
    expect(info.fixedRules.every((r) => typeof r.valueText === "string" && r.valueKey === `lock.deger.${r.settingId}`)).toBe(true);
    expect(info.templates[0]?.id).toBe("dayanikli_taban");
    expect(info.seeds[0]).toEqual({ index: 0 }); // sunucunun "Dünya N" etiketi taşınmaz: ad kartın seçeneklerinden gelir
    expect(info.seeds).toHaveLength(6);
  });

  it("info koşu ortası bağlamı: yalnız apply=live ayarlar açık, öteki locked", () => {
    const info = parseInfo(at("info_run"));
    const by = Object.fromEntries(info.settings.map((x) => [x.id, x.options]));
    expect(by.gecis_destegi?.every((o) => o.available && o.reason === undefined)).toBe(true);
    expect(by.dunya_tohumu?.every((o) => !o.available && o.reason === "locked")).toBe(true);
  });

  it("durum: notlu sürüm ve bağlam kilitleri (son inceleme I1/I2)", () => {
    const n = parseState(at("state_note_version"));
    expect(n.versions?.[0]).not.toHaveProperty("note");
    expect(n.versions?.[1]).toMatchObject({ version: 2, fromWeek: 3, note: "Kasa eridi, destek açtım" });
    const k = parseState(at("state_setting_locks"));
    expect(k.settingLocks).toEqual([{ id: "gecis_destegi", reason: "no_cash_floor" }]);
    expect(parseState(at("state_running")).settingLocks).toBeUndefined();
    // tolerans: bilinmeyen neden düşer (durum yine ayrışır)
    expect(parseState({ ...(at("state_setting_locks") as object), settingLocks: [{ id: "x", reason: "yeni_neden" }] }).settingLocks).toEqual([]);
  });

  it("availability", () => {
    expect(parseAvailability(at("availability_ok"))).toEqual({ ok: true, scenarioId: "canli", blocked: [] });
    expect(parseAvailability(at("availability_blocked"))).toEqual({
      ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "yok", reason: "locked" }],
    });
  });

  it("handle ve durumlar", () => {
    const h = parseHandle(at("handle"));
    expect(h.state.status).toBe("paused");           // gerçek sunucu hafta 0'da duraklatılmış bildirir (parite testi aynı değeri sınar)
    expect(h.state.week).toBe(0);
    expect(parseState(at("state_ready"))).toMatchObject(h.state);
    expect(parseState(at("state_running"))).toMatchObject({ status: "running", buffering: false, modelWeeksPerSec: 2.5 });
    expect(parseState(at("state_ended"))).toMatchObject({ status: "ended", week: 200, endedReason: "duration" });
    expect(parseState(at("state_failed"))).toMatchObject({ status: "failed", error: { messageKey: "hata.model_coktu", week: 8 } });
  });

  it("hafta paketi ve aralık", () => {
    const p = parsePacket(at("packet"));
    expect(p).toMatchObject({ v: 1, week: 1, version: 1, events: [] });
    expect(parsePackets(at("weeks")).map((w) => w.week)).toEqual(expect.arrayContaining([1, 2]));
  });

  it("süreler 520 dahil; DAO koşusunun durumu ve paketi tolere edilir (mode, dao)", () => {
    expect(parseInfo(at("info")).durations).toEqual([100, 200, 500, 520]);
    const st = parseState(at("state_dao"));
    expect(st).toMatchObject({ status: "paused", week: 0, durationWeeks: 520 });
    expect(parseHandle(at("handle_dao")).state.durationWeeks).toBe(520);
    const dao = at("packet_dao") as { week: number; dao: { hafta: number; ben: { servet_dilimi: number }; olaylar: { tur: string }[] } };
    expect(parsePacket(dao)).toMatchObject({ v: 1, week: dao.week, version: 1 }); // `dao` alanını tüketen kaynak T7'dir; ayrıştırıcı bilinmeyen alana takılmaz
    expect(dao.dao.hafta).toBe(dao.week);
    expect(dao.dao.ben.servet_dilimi).toBeGreaterThanOrEqual(1);
    expect(dao.dao.ben.servet_dilimi).toBeLessThanOrEqual(5);
    expect(dao.dao.olaylar.map((o) => o.tur)).toEqual(["ayrildi", "ise_girdi", "cekildi", "goc_etti", "kurulamadi", "ahirdan_cikti", "basvuru_kabul", "basvuru_red"]);
  });

  it("state.dao0 (DAO hafta 0 gözlemi) ayrıştırılır; bozuksa durum düşmez, alan düşer", () => {
    const st = { ...(at("state_dao") as Record<string, unknown>), dao0: undefined };
    expect(parseState(at("state_dao")).dao0?.hafta).toBe(0);                   // sunucu örneği (ready sonrası DAO durumu) dao0 taşır
    expect(parseState({ ...st, dao0: { bozuk: 1 } }).dao0).toBeUndefined();
    expect(parseState(st).dao0).toBeUndefined();
  });

  it("state.harita0 (DAO hafta 0) ayrıştırılır; bozuksa durum düşmez, alan düşer", () => {
    const st = { ...(at("state_dao") as Record<string, unknown>), harita0: undefined };
    expect(parseState(at("state_dao")).harita0?.hafta).toBe(0);              // sunucu örneği (ready sonrası DAO durumu) harita0 taşır
    const h = { hafta: 0, alanlar: ["id", "tur", "sehir", "calisan", "lonca", "sahip"], turler: ["firin"], loncalar: [], sahipler: ["npc"], firmalar: [[7, 0, 0, 8, -1, 0]] };
    expect(parseState({ ...st, harita0: h }).harita0?.firmalar).toEqual([["s0_firin7", "firin", 0, 8, null, "npc", null, "uretim"]]);
    expect(parseState({ ...st, harita0: { bozuk: 1 } }).harita0).toBeUndefined();
    expect(parseState(st).harita0).toBeUndefined();
  });

  it("DAO gözlemi: kurulamadi.neden = bekleme, kurabilir.bekleyen ve sektorler[].bekleme kabul edilir (ENTRY_COOLDOWN)", () => {
    const ham = structuredClone(at("dao_gozlem")) as { olaylar: { tur: string; neden?: string }[]; kurabilir: Record<string, unknown>; sektorler: Record<string, unknown>[] };
    const ol = ham.olaylar.find((o) => o.tur === "kurulamadi")!;
    ol.neden = "bekleme";
    ham.kurabilir.bekleyen = ["firin"];
    ham.sektorler[0]!.bekleme = 7;
    const g = parseDaoGozlem(ham);
    expect(g.olaylar.find((o) => o.tur === "kurulamadi")).toMatchObject({ neden: "bekleme" });
    expect(g.kurabilir.bekleyen).toEqual(["firin"]);
    expect(g.sektorler[0]!.bekleme).toBe(7);
    expect(parseDaoGozlem(at("dao_gozlem")).kurabilir.bekleyen).toBeUndefined();    // alan yoksa yok (ENTRY_COOLDOWN = 0)
  });

  it("DAO gözlemi: GET /dao gövdesi, paketin dao alanı ve bitmiş koşu (gözlemin kendisi ya da sarmal) ayrıştırılır", () => {
    const g = parseDaoGozlem(at("dao_gozlem"));
    expect(g).toMatchObject({ hafta: 1, ben: { durum: "calisan", unvan: "cirak", servet_dilimi: 3 }, firmam: { ad: "s0_un7", yas: 2 }, kurabilir: { evet: false, eksikler: ["calisma"] } });
    expect(g.olaylar.map((o) => o.tur)).toEqual(["ayrildi", "ise_girdi", "cekildi", "goc_etti", "kurulamadi", "ahirdan_cikti", "basvuru_kabul", "basvuru_red"]);
    expect(g.ilanlar).toEqual([{ firma: "fk0", ad: "fk0", sektor: "un", acik: 2, ucret: 101.5, maas_odeyemedi: false, kasa_gucu: "orta" }, { firma: "fk1", ad: "fk1", sektor: "firin", acik: 1, ucret: 84, maas_odeyemedi: false, kasa_gucu: "orta" }]);
    expect(g.olaylar.at(-1)).toEqual({ tur: "basvuru_red", hafta: 1, firma: "fk1", neden: "ilan_kapandi" });
    expect(g.loncalar.map((l) => l.ad)).toEqual(["lonca0", "lonca1", "lonca5"]);
    // Bitmiş koşuda sunucu gözlemin kendisini döner (sarmal yok); web sarmalı da tolere eder.
    expect(parseDaoYaniti(at("dao_gozlem"))).toEqual(g);
    expect(parseDaoYaniti({ daoSonuc: at("dao_gozlem") })).toEqual(g);
    const paket = parsePacket(at("packet_dao"));
    expect(paket.dao).toEqual(parseDaoGozlem((at("packet_dao") as { dao: unknown }).dao));
    expect(paket.dao?.hafta).toBe(paket.week);
  });

  it("DAO oyunu durumu mode taşır; dao_gozlem eksik alanla bozuk sayılır", () => {
    expect(parseState(at("state_dao")).mode).toBe("dao");
    const bozuk = structuredClone(at("dao_gozlem")) as Record<string, unknown>;
    delete bozuk.ben;
    expect(() => parseDaoGozlem(bozuk)).toThrow();
  });

  it("10. haftanın paketi harita taşır (satır: id, tür, şehir, çalışan, lonca|null, sahip, doğum|null, durum)", () => {
    const p = parsePacket(at("packet_harita"));
    expect(p.week).toBe(10);
    expect(p.harita?.hafta).toBe(10);
    expect(p.harita?.firmalar).toEqual([["fk0", "un", 0, 8, "lonca0", "npc", null, "uretim"], ["fk1", "un", 1, 8, null, "oyuncu", null, "uretim"], ["s2_un7", "un", 2, 5, "lonca2", "dao", null, "uretim"]]);      // sıkıştırılmış tel biçiminden (sayı kimlik kalıba iner)
    expect(parsePacket(at("packet")).harita?.hafta).toBe(1);      // Kurucu: 1. hafta da harita taşır
  });

  it("aradaki haftanın paketi haritaFark taşır (tam harita yok)", () => {
    const p = parsePacket(at("packet_harita_fark"));
    expect(p.harita).toBeUndefined();
    expect(p.haritaFark).toEqual({
      hafta: 12, taban: 10, degisen: [["fk3", "kapali", 0]],
      yeni: [["s1_firin2", "firin", 1, 5, "lonca2", "oyuncu", 11, "uretim"], ["s1_firin3", "firin", 1, 5, null, "npc", null, "uretim"]], kapanan: ["fk9"],
    });
  });

  it("kontrol eylemleri: olay dahil", () => {
    const enums = at("enums") as { controlActions: string[] };
    expect(enums.controlActions).toEqual(["play", "pause", "step", "olay"]);
  });

  it("ekonomi bloğu fikstürden ayrışır ve çekmece türleri sunucuyla aynı", () => {
    const p = parsePacket(at("packet"));
    const { v: _v, ...tel } = (at("packet") as { ekonomi: { v: number; tuketim: Record<string, unknown> } }).ekonomi;
    const { ucret: ucretTel, ...tuketimTel } = tel.tuketim as { ucret: { dunya: number[]; sehir: number[][] } } & Record<string, unknown>;
    expect(p.ekonomi).toMatchObject({ ...tel, tuketim: tuketimTel });
    expect(p.ekonomi?.tuketim.ucret?.dunya).toEqual({ ucret: ucretTel.dunya[0], fiyat: ucretTel.dunya[1], net: ucretTel.dunya[2], oran: ucretTel.dunya[3] });   // satır [ücret endeksi, fiyat endeksi, net ücret, oran]
    expect(p.ekonomi?.tuketim.ucret?.sehir).toHaveLength(ucretTel.sehir.length);
    expect(p.ekonomi?.tuketim.hane.ise).toEqual({ n: 4600, karsilanma: 0.82, sepet: 290.5 });
    expect(p.ekonomi?.isletme.sehir[0]).toMatchObject({ sehir: 0, ozel_calisan: 300, boy: [20, 8, 3, 1] });
    expect(p.ekonomi?.tuketim.urunler?.map((u) => u.urun)).toEqual(["sut", "un", "ekmek"]);
    expect([...CEKMECE_TURLERI]).toEqual((at("enums") as { drawerKinds: string[] }).drawerKinds);
    expect(parseDrawer(at("drawer_urun"))).toMatchObject({ kind: "urun", ref: "un", stale: false });
  });

  it("makro bloğu fikstürden ayrışır (negatif değer korunur, ölçülmeyen null)", () => {
    const tel = (at("packet") as { makro: Record<string, Record<string, number | null> | null> }).makro;
    const p = parsePacket(at("packet"));
    expect(p.makro?.fiyat).toEqual(tel.fiyat);
    expect(p.makro?.uretim).toEqual(tel.uretim);
    expect(p.makro?.para).toEqual(tel.para);
    expect(p.makro?.faiz).toEqual(tel.faiz);
    expect(p.makro?.marj).toEqual(tel.marj);
    expect(p.makro?.konut).toEqual(tel.konut);
    expect(p.makro?.dagilim).toEqual(tel.dagilim);
    expect(p.makro?.kredi).toEqual(tel.kredi);
    for (const k of ["packet_dao", "packet_harita", "packet_harita_fark"]) expect(parsePacket(at(k)).makro, k).toBeDefined();
  });

  it("sürüm olayı tam alanlarla (P-01) ve bitiş", () => {
    expect(parseEvent(at("version_event"))).toMatchObject(at("version_event") as object);
    expect(parseEnded(at("ended"))).toEqual({ reason: "duration", week: 200 });
  });

  it("değişiklik sonucu: kabul ve ret (fields: *)", () => {
    expect(parseChange(at("change_accepted"))).toMatchObject({ accepted: true, mode: "live", seamWeek: 5, version: 2 });
    expect(parseChange(at("change_rejected"))).toEqual({ accepted: false, fields: [{ id: "*", reason: "invalid" }] });
  });

  it("değişiklik reddi: kilitli ayar ve bitmiş koşu", () => {
    expect(parseChange(at("change_locked"))).toEqual({ accepted: false, fields: [{ id: "dunya_sabit_kalemleri", reason: "locked" }] });
    // Yalnız yeni koşuda değişen kart ayrı neden alır (arayüz "Yeni koşu olarak başlat" önerir).
    expect(parseChange(at("change_start_only"))).toEqual({ accepted: false, fields: [{ id: "dunya_tohumu", reason: "start_only" }] });
    expect(parseChange(at("change_ended"))).toEqual({ accepted: false, fields: [{ id: "*", reason: "ended" }] });
  });

  it("hata gövdesi: alan hataları ayrıştırılır, bilinmeyen sebep invalid olur", () => {
    expect(parseChange(at("error_422"))).toEqual({ accepted: false, fields: [{ id: "durationWeeks", reason: "invalid" }] });
    const e404 = at("error_404") as { error: { code: string; fields: unknown[] } };
    expect(e404.error.code).toBe("not_found");
    expect(e404.error.fields).toEqual([]);
    const tooMany = at("error_too_many_runs") as { error: { code: string; fields: unknown[] } };
    expect(tooMany.error.code).toBe("too_many_runs");
    expect(tooMany.error.fields).toEqual([]);
    const busy = at("error_busy_preparing") as { error: { code: string; fields: unknown[] } };
    expect(busy.error.code).toBe("busy_preparing");
    expect(busy.error.fields).toEqual([]);
    expect(parseServerError({ message_key: "hata.model_coktu" })).toBe("hata.model_coktu");
  });
});

describe("işletme penceresi verisi (T0s)", () => {
  it("sehir_satiri_nufus_ve_ahirdaki_oyuncu_alanlarini_ayristirir", () => {
    const p = parsePacket(at("packet"));
    for (const c of p.cities ?? []) {
      expect(c.population).toBeGreaterThan(0);
      expect(c.players_in_ahir).toBeGreaterThanOrEqual(0);
    }
  });

  it("sehir_satiri_eski_sunucuda_yeni_alanlar_yok", () => {
    const pk = structuredClone(at("packet")) as { cities: Record<string, unknown>[] };
    for (const c of pk.cities) { delete c.population; delete c.players_in_ahir; }
    const p = parsePacket(pk);
    expect("population" in p.cities![0]!).toBe(false);
  });

  it("isletme_cekmecesi_alanlari", () => {
    const d = at("drawer_firm") as { fields: Record<string, unknown> };
    const f = parseIsletmeCekmecesi(d.fields);
    expect(f).toEqual({ product: "un", price: 1.27, wage_avg: 14.5, sold_week: 42, profit_hist: [1.5, 1.6] });
  });

  it("isletme_cekmecesi_eski_sunucu_ve_bozuk_deger_toleransi", () => {
    expect(parseIsletmeCekmecesi({})).toEqual({ product: null, price: null, wage_avg: null, sold_week: null, profit_hist: [] });
    const f = parseIsletmeCekmecesi({ price: "x", profit_hist: Array.from({ length: 15 }, (_, i) => (i === 3 ? "y" : i)) });
    expect(f.price).toBeNull();
    expect(f.profit_hist).toHaveLength(12);
    expect(f.profit_hist.at(-1)).toBe(14);
  });
});
