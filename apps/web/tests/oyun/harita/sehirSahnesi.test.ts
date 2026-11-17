import { describe, expect, it } from "vitest";
import { SEHIR_STILI } from "@/oyun/harita/haritaStili";
import { sehirSahnesi, type SehirSahnesiBaglami } from "@/oyun/harita/sehirSahnesi";
import type { HaritaFirmaSatiri, HaritaVerisi, SahneBina } from "@/oyun/harita/tipler";
import type { ChainNode, CityRow, HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const sehirSatiri = (index: number, unemployed = 10): CityRow => ({
  index, served: 0.9, employed: 100, unemployed, cash: 0, firms_npc: 0, firms_player: 0, rent_pct: null, occupancy: null, tenants_per_house: null, migration_in: 0, migration_out: 0,
});
const lonca = (ref: string, members = 5): HoldingsLonca => ({ ref, owner: "player", members, fee: null, capital: null, deposits: null, credit_out: null, equity: null });
const dugum = (sector: string, city: number, o: Partial<ChainNode> = {}): ChainNode => ({ sector, city, shortage: 0.05, price: 1, firms: 1, healthy: 1, demand: 1, output: 1, stock: 1, ...o });
const TURLER = ["market", "un", "maden_komur", "lojistik", "okul"];

function paketOf(loncaSayisi = 3, nodes: ChainNode[] | null = null): WeekPacket {
  const p = packetOf("r", 20, 1);
  return {
    ...p, cities: [sehirSatiri(0, 7), sehirSatiri(1, 5)],
    holdings: { loncas: Array.from({ length: loncaSayisi }, (_, i) => lonca(`lonca${i}`, 5 + i * 20)) } as WeekPacket["holdings"],
    ...(nodes ? { chain: { board: true, edges_rev: 1, sectors: [], nodes, scarce: null } } : {}),
  };
}
const firma = (i: number, sehir = 0): HaritaFirmaSatiri => [`f${i}`, TURLER[i % TURLER.length], sehir, 2 + ((i * 7) % 60), null, "npc", null, "uretim"];
const verisi = (n: number, sehir = 0): HaritaVerisi => ({ hafta: 20, firmalar: Array.from({ length: n }, (_, i) => firma(i, sehir)) });
const ctxOf = (ek: Partial<SehirSahnesiBaglami> = {}): SehirSahnesiBaglami => ({ runId: "kosu-1", sehirAdlari: ["A", "B"], sehir: 0, katman: "yok", ...ek });

const parselOf = (s: ReturnType<typeof sehirSahnesi>) => Object.fromEntries(s.binalar.filter((b) => b.tur === "isletme").map((b) => [b.id, b.parsel]));
const kutu = (b: SahneBina) => ({ x1: b.x - b.taban.g / 2, x2: b.x + b.taban.g / 2, y1: b.y - b.taban.d / 2, y2: b.y + b.taban.d / 2 });
const kesisir = (a: SahneBina, b: SahneBina): boolean => {
  const p = kutu(a); const q = kutu(b);
  return p.x1 < q.x2 && q.x1 < p.x2 && p.y1 < q.y2 && q.y1 < p.y2;
};

describe("sehirSahnesi", () => {
  it("test_determinizm_ve_tohum_etkisi", () => {
    const a = sehirSahnesi(paketOf(), verisi(20), ctxOf());
    expect(sehirSahnesi(paketOf(), verisi(20), ctxOf())).toEqual(a);
    const karisik = { ...verisi(20), firmalar: [...verisi(20).firmalar].reverse() };
    expect(parselOf(sehirSahnesi(paketOf(), karisik, ctxOf()))).toEqual(parselOf(a));
    expect(parselOf(sehirSahnesi(paketOf(), verisi(20), ctxOf({ runId: "kosu-2" })))).not.toEqual(parselOf(a));
  });

  it("test_isletme_gidince_hicbir_diger_tasinmaz", () => {
    const v = verisi(3);
    const tam = parselOf(sehirSahnesi(paketOf(), v, ctxOf()));
    for (let i = 0; i < 3; i++) {
      const az = parselOf(sehirSahnesi(paketOf(), { ...v, firmalar: v.firmalar.filter((_, k) => k !== i) }, ctxOf()));
      for (const [id, p] of Object.entries(az)) expect(p, `${id} (f${i} silindi)`).toBe(tam[id]);
    }
  });

  it("test_yogun_sehirde_silme_ortalama_kayma_azdir", () => {
    // Çakışma olan yuvada yalnız yuvayı kaybedenler taşınır (kaçınılmaz); ortalama düşük kalmalı.
    const v = verisi(10);
    const tam = parselOf(sehirSahnesi(paketOf(), v, ctxOf()));
    let toplam = 0;
    for (let i = 0; i < 10; i++) {
      const az = parselOf(sehirSahnesi(paketOf(), { ...v, firmalar: v.firmalar.filter((_, k) => k !== i) }, ctxOf()));
      toplam += Object.entries(az).filter(([id, p]) => tam[id] !== p).length;
    }
    expect(toplam / 10).toBeLessThanOrEqual(0.5);
  });

  it("test_kademe_0_dolulukta_silme_ortalama_kayma_azdir", () => {
    // Kademe 0 sınırında (~%80 dolu, gerekli parsel = ceil(n x 1.25) tüm parsellere yakın) tek silme.
    const kademe0 = sehirSahnesi(paketOf(), verisi(1), ctxOf()).parseller.length;
    let n = 1;
    while (sehirSahnesi(paketOf(), verisi(n + 1), ctxOf()).parseller.length === kademe0) n++;
    expect(n / kademe0).toBeGreaterThanOrEqual(0.7);
    const v = verisi(n);
    const tam = parselOf(sehirSahnesi(paketOf(), v, ctxOf()));
    let toplam = 0;
    for (let i = 0; i < n; i++) {
      const az = parselOf(sehirSahnesi(paketOf(), { ...v, firmalar: v.firmalar.filter((_, k) => k !== i) }, ctxOf()));
      toplam += Object.entries(az).filter(([id, p]) => tam[id] !== p).length;
    }
    // Ölçülen ortalama ~1.64 (n=14): doluluk %80 iken silinenin yuvasını isteyenler zincirle kayar; sınır regresyon bekçisi.
    expect(toplam / n).toBeLessThanOrEqual(2);
  });

  it("test_meydan_buyuyunce_yalniz_parseli_kaybolanlar_ve_zincir_tasinir", () => {
    const v = verisi(14);
    const az = sehirSahnesi(paketOf(3), v, ctxOf());
    const cok = sehirSahnesi(paketOf(30), v, ctxOf());
    expect(cok.meydan.yaricap).toBeGreaterThan(az.meydan.yaricap);
    const kalanParsel = new Set(cok.parseller.map((p) => p.id));
    const once = parselOf(az);
    const sonra = parselOf(cok);
    const kaybeden = Object.keys(once).filter((id) => !kalanParsel.has(once[id]!)).length;
    const tasinan = Object.keys(once).filter((id) => once[id] !== sonra[id]).length;
    expect(kaybeden).toBeGreaterThan(0);
    expect(tasinan).toBeLessThanOrEqual(2 * kaybeden);
  });

  it("test_izgara_kademesi_gecisinde_cogu_yerinde_kalir", () => {
    let n = 1;
    while (sehirSahnesi(paketOf(), verisi(n), ctxOf()).parseller.length === sehirSahnesi(paketOf(), verisi(n + 1), ctxOf()).parseller.length) n++;
    const once = sehirSahnesi(paketOf(), verisi(n), ctxOf());
    const sonra = sehirSahnesi(paketOf(), verisi(n + 1), ctxOf());
    expect(sonra.parseller.length).toBeGreaterThan(once.parseller.length);
    const o = parselOf(once);
    const y = parselOf(sonra);
    const kalan = Object.keys(o).filter((id) => o[id] === y[id]).length;
    expect(kalan / n).toBeGreaterThanOrEqual(0.8);
  });

  it("test_cakisma_yok_ve_her_bina_kendi_parselinde", () => {
    const s = sehirSahnesi(paketOf(8), verisi(60), ctxOf());
    const bs = s.binalar;
    const isletme = bs.filter((b) => b.tur === "isletme");
    expect(new Set(isletme.map((b) => b.parsel)).size).toBe(isletme.length);
    const hepsi = [...bs, s.sehirBinasi, s.ahir];
    for (let i = 0; i < hepsi.length; i++) for (let j = i + 1; j < hepsi.length; j++) expect(kesisir(hepsi[i], hepsi[j]), `${hepsi[i].id}/${hepsi[j].id}`).toBe(false);
    // Binalar sokağa taşmaz.
    for (const b of isletme) for (const k of s.sokaklar) {
      const q = kutu(b);
      expect(q.x1 < k.x + k.genislik && k.x < q.x2 && q.y1 < k.y + k.yukseklik && k.y < q.y2, `${b.id}/${k.id}`).toBe(false);
    }
  });

  it("test_parsel_yetmezse_izgara_buyur", () => {
    const kucuk = sehirSahnesi(paketOf(), verisi(10), ctxOf());
    const buyuk = sehirSahnesi(paketOf(), verisi(150), ctxOf());
    expect(buyuk.parseller.length).toBeGreaterThan(kucuk.parseller.length);
    expect(buyuk.genislik * buyuk.yukseklik).toBeGreaterThan(kucuk.genislik * kucuk.yukseklik);
    expect(buyuk.parseller.length).toBeGreaterThan(150);
    expect(new Set(buyuk.binalar.filter((b) => b.tur === "isletme").map((b) => b.parsel)).size).toBe(150);
  });

  it("test_meydan_ortada_ahir_kenarda_belediye_ve_ahir_parsel_almaz", () => {
    const s = sehirSahnesi(paketOf(), verisi(30), ctxOf());
    expect(s.meydan.x).toBeCloseTo(s.genislik / 2, 0);
    expect(s.meydan.y).toBeGreaterThan(SEHIR_STILI.ustBant);
    expect(s.meydan.y).toBeLessThan(s.yukseklik - SEHIR_STILI.altBant);
    const ahirKenar = Math.min(s.ahir.x, s.genislik - s.ahir.x, s.ahir.y, s.yukseklik - s.ahir.y);
    const meydanKenar = Math.min(s.meydan.x, s.genislik - s.meydan.x, s.meydan.y, s.yukseklik - s.meydan.y);
    expect(ahirKenar).toBeLessThan(meydanKenar);
    expect(s.ahir.parsel).toBeNull();
    expect(s.sehirBinasi.parsel).toBeNull();
    const parselIdleri = new Set(s.parseller.map((p) => p.id));
    expect(s.binalar.every((b) => b.parsel === null || parselIdleri.has(b.parsel))).toBe(true);
    // Loncalar meydan dairesinin içinde.
    for (const b of s.binalar.filter((x) => x.tur === "lonca")) expect(Math.hypot(b.x - s.meydan.x, b.y - s.meydan.y)).toBeLessThan(s.meydan.yaricap);
    // Parseller meydana girmez.
    for (const p of s.parseller) expect(Math.hypot(p.x - s.meydan.x, p.y - s.meydan.y)).toBeGreaterThan(s.meydan.yaricap * 0.8);
  });

  it("test_sokak_agi_ana_cadde_ve_ara_sokaklar", () => {
    const s = sehirSahnesi(paketOf(), verisi(5), ctxOf());
    expect(s.sokaklar.filter((k) => k.ana)).toHaveLength(2);
    expect(s.sokaklar.some((k) => !k.ana)).toBe(true);
    expect(s.sokaklar.some((k) => k.yon === "yatay")).toBe(true);
    expect(s.sokaklar.some((k) => k.yon === "dikey")).toBe(true);
  });

  it("test_talep_katmani_chain_nodes_tonlari", () => {
    const nodes = [dugum("market", 0, { shortage: 0.02 }), dugum("un", 0, { shortage: 0.2 }), dugum("maden_komur", 0, { shortage: 0.6 }), dugum("market", 1, { shortage: 0.9 })];
    const s = sehirSahnesi(paketOf(3, nodes), verisi(10), ctxOf({ katman: "talep" }));
    expect(s.katman.tur).toBe("talep");
    const ton = (sektor: string) => s.binalar.filter((b) => b.etiket === sektor).map((b) => s.katman.tonlar.get(b.id));
    expect(new Set(ton("market"))).toEqual(new Set(["iyi"]));
    expect(new Set(ton("un"))).toEqual(new Set(["orta"]));
    expect(new Set(ton("maden_komur"))).toEqual(new Set(["dar"]));
    expect(ton("okul").every((t) => t === undefined)).toBe(true);
    expect(s.katman.lejant.reduce((t, l) => t + l.adet, 0)).toBe(s.katman.tonlar.size);
  });

  it("test_fiyat_katmani_dort_hafta_degisim_esikleri", () => {
    const once = paketOf(1, [dugum("market", 0, { price: 100 }), dugum("un", 0, { price: 100 }), dugum("maden_komur", 0, { price: 100 }), dugum("lojistik", 0, { price: 100 })]);
    const simdi = paketOf(1, [dugum("market", 0, { price: 96 }), dugum("un", 0, { price: 100 }), dugum("maden_komur", 0, { price: 106 }), dugum("lojistik", 0, { price: 105 })]);
    const s = sehirSahnesi(simdi, verisi(10), ctxOf({ katman: "fiyat", oncekiPaket: once }));
    expect(s.katman.tur).toBe("fiyat");
    const ton = (sektor: string) => s.katman.tonlar.get(s.binalar.find((b) => b.etiket === sektor)!.id);
    expect(ton("market")).toBe("yatay");
    expect(ton("un")).toBe("yatay");
    expect(ton("maden_komur")).toBe("artan");
    expect(ton("lojistik")).toBe("artan");
    const dusuk = paketOf(1, [dugum("market", 0, { price: 90 })]);
    const d = sehirSahnesi(dusuk, verisi(3), ctxOf({ katman: "fiyat", oncekiPaket: once }));
    expect(d.katman.tonlar.get(d.binalar.find((b) => b.etiket === "market")!.id)).toBe("dusen");
  });

  it("test_fiyat_esikleri_tam_sinirda_kararli", () => {
    const once = paketOf(1, [dugum("market", 0, { price: 100 }), dugum("un", 0, { price: 100 })]);
    const simdi = paketOf(1, [dugum("market", 0, { price: 105 }), dugum("un", 0, { price: 95 })]);
    const s = sehirSahnesi(simdi, verisi(5), ctxOf({ katman: "fiyat", oncekiPaket: once }));
    const ton = (sektor: string) => s.katman.tonlar.get(s.binalar.find((b) => b.etiket === sektor)!.id);
    expect(ton("market")).toBe("artan");
    expect(ton("un")).toBe("dusen");
  });

  it("test_hicbir_isletme_eslesmezse_katman_yok", () => {
    const nodes = [dugum("okul", 1)];
    expect(sehirSahnesi(paketOf(1, nodes), verisi(5), ctxOf({ katman: "talep" })).katman.tur).toBe("yok");
  });

  it("test_sokak_ve_parseller_dondurulmus_ve_onbellekten_ayni_nesne", () => {
    const a = sehirSahnesi(paketOf(), verisi(5), ctxOf());
    const b = sehirSahnesi(paketOf(), verisi(6), ctxOf());
    expect(a.sokaklar).toBe(b.sokaklar);
    expect(a.parseller).toBe(b.parseller);
    expect(Object.isFrozen(a.sokaklar)).toBe(true);
    expect(Object.isFrozen(a.parseller)).toBe(true);
    expect(() => (a.parseller as unknown as { push: (x: unknown) => void }).push({})).toThrow();
  });

  it("test_katman_verisi_yoksa_yok", () => {
    expect(sehirSahnesi(paketOf(), verisi(5), ctxOf({ katman: "talep" })).katman.tur).toBe("yok");
    const nodes = [dugum("market", 0)];
    expect(sehirSahnesi(paketOf(1, nodes), verisi(5), ctxOf({ katman: "fiyat" })).katman.tur).toBe("yok");
    const yokSehir = { ...paketOf(), cities: [sehirSatiri(1)] };
    expect(sehirSahnesi(yokSehir, verisi(5), ctxOf({ katman: "issizlik" })).katman.tur).toBe("yok");
  });

  it("test_issizlik_binalari_tonlamaz_rozet_verir", () => {
    const s = sehirSahnesi(paketOf(), verisi(5), ctxOf({ katman: "issizlik" }));
    expect(s.katman.tur).toBe("issizlik");
    expect(s.katman.tonlar.size).toBe(0);
    expect(s.katman.rozetler).toEqual([{ hedef: "sehir", binaId: "sehir-0", sayi: 7 }, { hedef: "meydan", binaId: null, sayi: 12 }]);
  });

  it("test_kayit_kaynaginda_veriYok", () => {
    const s = sehirSahnesi(paketOf(), null, ctxOf());
    expect(s.veriYok).toBe(true);
    expect(s.binalar.filter((b) => b.tur === "isletme")).toHaveLength(0);
    expect(s.sokaklar.length).toBeGreaterThan(0);
    expect(s.binalar.filter((b) => b.tur === "lonca")).toHaveLength(3);
    expect(s.sehirBinasi.tur).toBe("sehir");
    expect(sehirSahnesi(paketOf(), verisi(3), ctxOf()).veriYok).toBe(false);
  });

  it("test_insan_alani_yok", () => {
    const s = sehirSahnesi(paketOf(), verisi(12), ctxOf({ katman: "issizlik" }));
    const anahtarlar = new Set<string>();
    const gez = (o: unknown): void => {
      if (o instanceof Map) o.forEach((v, k) => { anahtarlar.add(String(k)); gez(v); });
      else if (Array.isArray(o)) o.forEach(gez);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { anahtarlar.add(k); gez(v); }
    };
    gez({ ...s, katman: { ...s.katman, tonlar: {} } });
    expect([...anahtarlar].filter((k) => /insan|kisi|figur|oyuncu|human|person/i.test(k))).toEqual([]);
  });

  it("test_ben_vurgusu_bina_uzerinde", () => {
    const v = verisi(6);
    const calisan = sehirSahnesi(paketOf(), v, ctxOf({ ben: { sehir: 0, firma: "f2", durum: "calisiyor" } }));
    expect(calisan.ben).toEqual({ binaId: "f2", neden: "isyeri" });
    expect(sehirSahnesi(paketOf(), v, ctxOf({ ben: { sehir: 0, firma: null, durum: "ahir" } })).ben).toEqual({ binaId: "ahir", neden: "ahir" });
    expect(sehirSahnesi(paketOf(), v, ctxOf({ ben: { sehir: 1, firma: null, durum: "issiz" } })).ben).toBeNull();
    expect(sehirSahnesi(paketOf(), v, ctxOf({ ben: { sehir: 0, firma: null, durum: "issiz" } })).ben).toEqual({ binaId: "sehir-0", neden: "sehir" });
  });

  it("test_bos_parseller_yalniz_parsel_secilebilirken_dolu_parselsiz_gelir", () => {
    const kapali = sehirSahnesi(paketOf(), verisi(6), ctxOf());
    expect(kapali.bosParseller).toEqual([]);
    const acik = sehirSahnesi(paketOf(), verisi(6), ctxOf({ parselSecilebilir: true }));
    const dolu = new Set(acik.binalar.map((b) => b.parsel).filter((x): x is string => x !== null));
    expect(acik.bosParseller!.length).toBe(acik.parseller.length - 6);
    expect(acik.bosParseller!.every((p) => !dolu.has(p.id))).toBe(true);
  });

  it("test_paket_null_olabilir_loncasiz_katmansiz_sahne_kurulur", () => {
    const s = sehirSahnesi(null, { hafta: 0, firmalar: [] }, ctxOf({ katman: "issizlik", parselSecilebilir: true }));
    expect(s.binalar).toEqual([]);
    expect(s.katman.tur).toBe("yok");
    expect(s.veriYok).toBe(false);
    expect(s.bosParseller!.length).toBe(s.parseller.length);
    expect(s.sehirBinasi.id).toBe("sehir-0");
    expect(s.ahir.id).toBe("ahir");
  });
});


describe("ilan veren binalar (DAO)", () => {
  it("ilanVeren_yalniz_bu_sehirde_cizilen_isletmeleri_isaretler_baglam_yoksa_bos", () => {
    const harita = { hafta: 1, firmalar: [["f7", "firin", 0, 8, null, "npc"], ["f2", "market", 1, 5, null, "npc"]] } as unknown as Parameters<typeof sehirSahnesi>[1];
    const ctx = { runId: "r", sehirAdlari: ["A", "B"], sehir: 0, katman: "yok" as const };
    expect([...(sehirSahnesi(null, harita, { ...ctx, ilanVeren: new Set(["f7", "f2", "yok"]) }).ilanVeren ?? [])]).toEqual(["f7"]);
    expect([...(sehirSahnesi(null, harita, ctx).ilanVeren ?? [])]).toEqual([]);
  });

  it("belediye_ilan_verirse_sehir_binasi_parlar_baska_sehrin_belediyesi_degil", () => {
    const harita = { hafta: 1, firmalar: [["s0_belediye0", "belediye", 0, 4, null, "npc"]] } as unknown as Parameters<typeof sehirSahnesi>[1];
    const ctx = { runId: "r", sehirAdlari: ["A", "B"], sehir: 0, katman: "yok" as const };
    const s = sehirSahnesi(null, harita, { ...ctx, ilanVeren: new Set(["s0_belediye0"]) });
    expect([...(s.ilanVeren ?? [])]).toEqual([s.sehirBinasi.id]);
    expect([...(sehirSahnesi(null, harita, { ...ctx, ilanVeren: new Set(["s1_belediye0"]) }).ilanVeren ?? [])]).toEqual([]);
  });
});

describe("ahır ve belediye satırları (gerçek harita_of gönderir)", () => {
  it("tur_ahir_ve_belediye_satirlari_isletme_olmaz_tek_ahir_ve_tek_sehir_binasi", () => {
    const harita = { hafta: 0, firmalar: [["s0_ahir0", "ahir", 0, 3, null, "npc"], ["s0_belediye0", "belediye", 0, 4, null, "npc"], ["f7", "firin", 0, 8, null, "npc"]] } as unknown as HaritaVerisi;
    const s = sehirSahnesi(null, harita, { runId: "r", sehirAdlari: ["A"], sehir: 0, katman: "yok" });
    expect(s.binalar.map((b) => b.id)).toEqual(["f7"]);
    expect(s.ahir.id).toBe("ahir");
    expect(s.sehirBinasi.tur).toBe("sehir");
  });

  it("izo_verilmezse_sahne_degismedi", async () => {
    // Golden: izometrik değişiklikten ÖNCE üretildi (bkz. fikstur/sehirSahnesi.*.json); izo bağlamı yokken çıktı bayt bayt aynı kalmalı.
    const duz = (_: string, v: unknown): unknown => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
    const talep = [dugum("market", 0), dugum("un", 0, { shortage: 0.5 })];
    const kosullar: [string, ReturnType<typeof sehirSahnesi>][] = [
      ["kucuk", sehirSahnesi(paketOf(3), verisi(12), ctxOf({ parselSecilebilir: true, ilanVeren: new Set(["f1"]) }))],
      ["buyuk", sehirSahnesi(paketOf(8, talep), verisi(70), ctxOf({ katman: "talep", ben: { sehir: 0, firma: "f3", durum: "sahip" } }))],
      ["bos", sehirSahnesi(null, null, ctxOf())],
    ];
    for (const [ad, sahne] of kosullar) await expect(JSON.stringify(sahne, duz, 1)).toMatchFileSnapshot(`./fikstur/sehirSahnesi.${ad}.golden.json`);
  });

  it("kapali_parsel_tutar_ama_kur_hedefinde_degil", () => {
    const v = verisi(6);
    const kapali: HaritaVerisi = { ...v, firmalar: v.firmalar.map((f, i) => (i === 2 ? ([f[0], f[1], f[2], f[3], f[4], f[5], f[6], "kapali"] as HaritaFirmaSatiri) : f)) };
    const s = sehirSahnesi(paketOf(), kapali, ctxOf({ izo: true, parselSecilebilir: true }));
    const b = s.binalar.find((x) => x.id === "f2")!;
    expect(b.durum).toBe("kapali");
    expect(b.parsel).not.toBeNull();
    expect((s.bosParseller ?? []).some((p) => p.id === b.parsel)).toBe(false);
    expect(s.binalar.filter((x) => x.tur === "isletme").every((x) => x.durum !== undefined)).toBe(true);
  });
});

describe("sehirSahnesi kalici yerlesim (K9/K8)", () => {
  for (const izo of [false, true]) {
    it(`${izo ? "izo" : "klasik"}_firma_gelip_gidince_ote_firmalar_tasinmaz_ve_sahne_tabloyu_dondurur`, () => {
      const ctx = (yerlesim: ReadonlyMap<string, string> | null, ek: Partial<SehirSahnesiBaglami> = {}) => ctxOf({ izo: izo || undefined, yerlesim, ...ek } as Partial<SehirSahnesiBaglami>);
      const s0 = sehirSahnesi(paketOf(), verisi(20), ctx(null));
      expect(s0.yerlesim).toBeDefined();
      const eksik = { hafta: 21, firmalar: verisi(20).firmalar.filter((x) => x[0] !== "f3" && x[0] !== "f7") };
      const yeni = [...eksik.firmalar, firma(50), firma(51)];
      const s1 = sehirSahnesi(paketOf(), { hafta: 21, firmalar: yeni }, ctx(s0.yerlesim!));
      const p0 = parselOf(s0);
      const p1 = parselOf(s1);
      for (const id of Object.keys(p1)) if (p0[id]) expect(p1[id]).toBe(p0[id]);
      // yeniden hesap (yenileme: aynı tablo geri okunur) aynı düzen
      expect(parselOf(sehirSahnesi(paketOf(), { hafta: 21, firmalar: yeni }, ctx(s1.yerlesim!)))).toEqual(p1);
    });
    it(`${izo ? "izo" : "klasik"}_tablo_verilmezse_eski_davranis_ve_yerlesim_alani_yok`, () => {
      const s = sehirSahnesi(paketOf(), verisi(20), ctxOf(izo ? { izo: true } : {}));
      expect(s.yerlesim).toBeUndefined();
    });
    it(`${izo ? "izo" : "klasik"}_oyuncu_isletmesi_secilen_parsele_oturur`, () => {
      const s0 = sehirSahnesi(paketOf(), verisi(10), ctxOf({ izo: izo || undefined, yerlesim: null, parselSecilebilir: true } as Partial<SehirSahnesiBaglami>));
      const hedef = s0.bosParseller![0]!.id;
      const oyuncu: HaritaFirmaSatiri = ["fo", "market", 0, 3, null, "oyuncu", 20, "uretim"];
      const s1 = sehirSahnesi(paketOf(), { hafta: 21, firmalar: [...verisi(10).firmalar, oyuncu] }, ctxOf({ izo: izo || undefined, yerlesim: s0.yerlesim!, sabitlemeler: new Map([["fo", hedef]]) } as Partial<SehirSahnesiBaglami>));
      expect(parselOf(s1)["fo"]).toBe(hedef);
    });
  }
});
