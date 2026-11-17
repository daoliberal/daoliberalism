import { describe, expect, it } from "vitest";
import { haritaModeli } from "@/oyun/harita/haritaModeli";
import { SEKTOR_TURLERI, sektorGrubu } from "@/oyun/harita/sektorGrubu";
import type { HaritaBaglami } from "@/oyun/harita/tipler";
import { dunyaYerlesimi, isletmeAlani, yerlestir } from "@/oyun/harita/yerlesim";
import { parseHarita } from "@/oyun/sim/live/wire";
import { haritaOf, packetOf } from "../helpers/fakeLiveServer";
import type { CityRow, HoldingsLonca, WeekPacket } from "@/oyun/sim/types";

const sehirSatiri = (index: number, employed = 100, unemployed = 10): CityRow => ({
  index, served: 0.9, employed, unemployed, cash: 0, firms_npc: 0, firms_player: 0, rent_pct: null, occupancy: null, tenants_per_house: null, migration_in: 0, migration_out: 0,
});
const lonca = (ref: string, members: number | null = 5): HoldingsLonca => ({ ref, owner: "player", members, fee: null, capital: null, deposits: null, credit_out: null, equity: null });

function paketOf(sehir: number, loncaSayisi = 2, ahirda = 3): WeekPacket {
  const p = packetOf("r", 20, 1);
  return {
    ...p,
    world: { ...p.world, players_in_ahir: ahirda },
    cities: Array.from({ length: sehir }, (_, i) => sehirSatiri(i, 100 + i, 10 + i)),
    holdings: { loncas: Array.from({ length: loncaSayisi }, (_, i) => lonca(`lonca${i}`)) } as WeekPacket["holdings"],
  };
}
const ctxOf = (sehir: number, ek: Partial<HaritaBaglami> = {}): HaritaBaglami => ({ runId: "kosu-1", sehirAdlari: Array.from({ length: sehir }, (_, i) => `Şehir ${i + 1}`), ...ek });
const verisi = (sehir: number) => ({ hafta: 20, firmalar: Array.from({ length: 8 * sehir }, (_, i) => haritaOf(20).firmalar[i % 12].map((v, k) => (k === 0 ? `f${i}` : k === 2 ? i % sehir : v))) as ReturnType<typeof haritaOf>["firmalar"] });

describe("haritaModeli", () => {
  it("test_ayni_paket_ayni_koordinat", () => {
    const p = paketOf(3);
    const a = haritaModeli(p, verisi(3), ctxOf(3));
    expect(haritaModeli(p, verisi(3), ctxOf(3))).toEqual(a);
    const b = haritaModeli(p, verisi(3), ctxOf(3, { runId: "kosu-2" }));
    const firma = (m: typeof a) => m.binalar.filter((x) => x.tur === "isletme").map((x) => [x.x, x.y]);
    expect(firma(b)).not.toEqual(firma(a));
  });

  it("test_konum_siradan_bagimsiz", () => {
    const p = paketOf(3);
    const v = verisi(3);
    const karisik = { ...v, firmalar: [...v.firmalar].reverse() };
    const konum = (m: ReturnType<typeof haritaModeli>) => Object.fromEntries(m.binalar.map((b) => [b.id, [b.x, b.y]]));
    expect(konum(haritaModeli(p, karisik, ctxOf(3)))).toEqual(konum(haritaModeli(p, v, ctxOf(3))));
  });

  it("test_isletme_gelip_gidince_otekiler_yerinde", () => {
    const p = paketOf(2);
    const v = verisi(2);
    const eksik = { ...v, firmalar: v.firmalar.slice(0, -3) };
    const tam = haritaModeli(p, v, ctxOf(2));
    const az = haritaModeli(p, eksik, ctxOf(2));
    const yerinde = az.binalar.filter((b) => b.tur === "isletme").filter((b) => {
      const o = tam.binalar.find((x) => x.id === b.id)!;
      return o.x === b.x && o.y === b.y;
    });
    // Yalnız çakışma çözümü bir iki komşuyu oynatabilir; çoğu sabit kalır.
    expect(yerinde.length).toBeGreaterThanOrEqual(az.ozet.isletme - 2);
  });

  it.each([3, 5])("test_sayimlar (%i şehir)", (n) => {
    const p = paketOf(n, 4);
    const v = verisi(n);
    const m = haritaModeli(p, v, ctxOf(n));
    expect(m.ozet.isletme).toBe(v.firmalar.length);
    expect(m.binalar.filter((b) => b.tur === "sehir")).toHaveLength(n);
    expect(m.bolgeler).toHaveLength(n);
    expect(m.binalar.filter((b) => b.tur === "lonca")).toHaveLength(4);
    expect(m.binalar.filter((b) => b.tur === "ahir")).toHaveLength(1);
    expect(m.ozet).toMatchObject({ sehir: n, isletme: v.firmalar.length, lonca: 4 });
  });

  it("test_ozet_nufus_paketten", () => {
    const m = haritaModeli(paketOf(3, 0, 7), null, ctxOf(3));
    expect(m.ozet).toMatchObject({ calisan: 100 + 101 + 102, issiz: 10 + 11 + 12, ahirda: 7 });
    expect(m.bolgeler.map((b) => [b.calisan, b.issiz])).toEqual([[100, 10], [101, 11], [102, 12]]);
  });

  it("test_issiz_havuz_dahil", () => {
    const p = paketOf(3, 0, 7);
    const m = haritaModeli({ ...p, cities: p.cities!.map((c, i) => ({ ...c, npc_pool: 100 * (i + 1) })) }, null, ctxOf(3));
    expect(m.bolgeler.map((b) => b.issiz)).toEqual([10 + 100, 11 + 200, 12 + 300]);
    expect(m.ozet.issiz).toBe(10 + 11 + 12 + 600);
  });

  it("test_binalar_bolge_icinde", () => {
    for (const n of [1, 3, 5, 9]) {
      const m = haritaModeli(paketOf(n), verisi(n), ctxOf(n));
      const y = dunyaYerlesimi(n);
      for (const b of m.binalar.filter((x) => x.tur === "isletme")) {
        const bolge = m.bolgeler.find((r) => r.sehir === b.sehir)!;
        expect(b.x).toBeGreaterThanOrEqual(bolge.x);
        expect(b.x).toBeLessThanOrEqual(bolge.x + bolge.genislik);
        expect(b.y).toBeGreaterThanOrEqual(bolge.y);
        expect(b.y).toBeLessThanOrEqual(bolge.y + bolge.yukseklik);
      }
      for (const b of m.binalar.filter((x) => x.tur === "lonca")) {
        expect(b.y).toBeGreaterThanOrEqual(y.lonca.y);
        expect(b.y).toBeLessThanOrEqual(y.lonca.y + y.lonca.yukseklik);
        expect(m.bolgeler.some((r) => b.x >= r.x && b.x <= r.x + r.genislik && b.y >= r.y && b.y <= r.y + r.yukseklik)).toBe(false);
      }
    }
  });

  it("test_yerlesim_bolgeler_ust_uste_binmez_ve_dunyada", () => {
    for (const n of [1, 2, 3, 4, 6, 7, 12]) {
      const { bolgeler, lonca } = dunyaYerlesimi(n);
      const hepsi = [...bolgeler, lonca];
      for (const r of hepsi) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.genislik).toBeLessThanOrEqual(1000);
        expect(r.y + r.yukseklik).toBeLessThanOrEqual(610);
      }
      hepsi.forEach((a, i) => hepsi.slice(i + 1).forEach((b) => {
        const kesisir = a.x < b.x + b.genislik && b.x < a.x + a.genislik && a.y < b.y + b.yukseklik && b.y < a.y + a.yukseklik;
        expect(kesisir).toBe(false);
      }));
      const satirlar = new Set(bolgeler.map((r) => r.y)).size;
      expect(satirlar).toBe(n <= 3 ? 1 : n <= 6 ? 2 : 3);
    }
  });

  it("test_yerlestir_cakismaz_makul_yogunlukta", () => {
    const alan = isletmeAlani(dunyaYerlesimi(2).bolgeler[0]);
    const istek = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, yaricap: 6 }));
    const konum = [...yerlestir(istek, alan, "r").values()];
    for (let i = 0; i < konum.length; i++) for (let j = i + 1; j < konum.length; j++) expect(Math.hypot(konum[i].x - konum[j].x, konum[i].y - konum[j].y)).toBeGreaterThanOrEqual(12);
  });

  it("test_grup_sekil_renk", () => {
    const m = haritaModeli(paketOf(2), haritaOf(20), ctxOf(2));
    expect(m.binalar.filter((b) => b.tur === "isletme").every((b) => b.grup !== undefined)).toBe(true);
    for (const tur of SEKTOR_TURLERI) expect(["hammadde", "imalat", "hizmet", "lojistik"]).toContain(sektorGrubu(tur));
    expect(new Set(SEKTOR_TURLERI.map(sektorGrubu)).size).toBe(4);
    expect(() => sektorGrubu("bilinmeyen_tur")).toThrow();
    // şekil yalnız haritaStili'nde tutulur, modelde yok
    expect(m.binalar.every((b) => !("sekil" in b))).toBe(true);
  });

  it("test_modelde_insan_alani_yok", () => {
    const m = haritaModeli(paketOf(3), haritaOf(20), ctxOf(3, { ben: { sehir: 0, firma: null, durum: "issiz" } }));
    const anahtarlar = new Set<string>([...Object.keys(m), ...Object.keys(m.ozet), ...m.binalar.flatMap((b) => Object.keys(b)), ...m.bolgeler.flatMap((b) => Object.keys(b))]);
    for (const k of anahtarlar) expect(k, k).not.toMatch(/nokta|insan|kisi|figur/i);
  });

  it("test_sahte_sunucu_turleri_bilinir", () => {
    const turler = new Set(haritaOf(10).firmalar.map((f) => f[1]));
    for (const t of turler) expect(SEKTOR_TURLERI).toContain(t);
  });

  it("test_boyut_esikleri", () => {
    const f = (n: number): [string, string, number, number, null, "npc", null, "uretim"] => [`b${n}`, "un", 0, n, null, "npc", null, "uretim"];
    const m = haritaModeli(paketOf(1), { hafta: 10, firmalar: [f(7), f(8), f(19), f(20), f(49), f(50)] }, ctxOf(1));
    expect(Object.fromEntries(m.binalar.filter((b) => b.tur === "isletme").map((b) => [b.id, b.boyut]))).toEqual({ b7: 1, b8: 2, b19: 2, b20: 3, b49: 3, b50: 4 });
  });

  describe("test_ben_vurgusu", () => {
    const p = paketOf(3);
    const v = verisi(3);
    const firmaId = v.firmalar[1][0];

    it("isyeri vurgusu o firmayı gösterir", () => {
      const m = haritaModeli(p, v, ctxOf(3, { ben: { sehir: 1, firma: firmaId, durum: "calisiyor" } }));
      expect(m.ben).toEqual({ binaId: firmaId, neden: "isyeri" });
      expect(m.binalar.find((b) => b.id === m.ben!.binaId)!.tur).toBe("isletme");
    });
    it("sahip kendi işletmesini gösterir", () => {
      expect(haritaModeli(p, v, ctxOf(3, { ben: { sehir: 1, firma: firmaId, durum: "sahip" } })).ben).toEqual({ binaId: firmaId, neden: "isletme" });
    });
    it("işsiz şehir binasını, ahırdaki ahırı gösterir", () => {
      expect(haritaModeli(p, v, ctxOf(3, { ben: { sehir: 2, firma: null, durum: "issiz" } })).ben).toEqual({ binaId: "sehir-2", neden: "sehir" });
      expect(haritaModeli(p, v, ctxOf(3, { ben: { sehir: 2, firma: null, durum: "ahir" } })).ben).toEqual({ binaId: "ahir", neden: "ahir" });
    });
    it("işyeri bina verisinde yoksa (eski anlık görüntü ya da veri yok) şehir binasına düşer", () => {
      expect(haritaModeli(p, v, ctxOf(3, { ben: { sehir: 1, firma: "yok", durum: "calisiyor" } })).ben).toEqual({ binaId: "sehir-1", neden: "sehir" });
      expect(haritaModeli(p, null, ctxOf(3, { ben: { sehir: 0, firma: firmaId, durum: "sahip" } })).ben).toEqual({ binaId: "sehir-0", neden: "sehir" });
    });
    it("Kurucu'da (ben yok) null; geçersiz şehirde null", () => {
      expect(haritaModeli(p, v, ctxOf(3)).ben).toBeNull();
      expect(haritaModeli(p, v, ctxOf(3, { ben: null })).ben).toBeNull();
      expect(haritaModeli(p, v, ctxOf(3, { ben: { sehir: 9, firma: null, durum: "issiz" } })).ben).toBeNull();
    });
  });

  it("test_harita_yok", () => {
    const m = haritaModeli(paketOf(4, 3), null, ctxOf(4));
    expect(m.binalar.filter((b) => b.tur === "isletme")).toHaveLength(0);
    expect(m.binalar).toHaveLength(4 + 3 + 1);
    expect(m.firmaHafta).toBeNull();
    expect(haritaModeli(paketOf(4), haritaOf(10), ctxOf(4)).firmaHafta).toBe(10);
  });

  it("test_degismez", () => {
    const p = paketOf(2);
    const v = verisi(2);
    const derin = <T,>(x: T): T => {
      if (typeof x === "object" && x !== null) for (const k of Object.values(x)) derin(k);
      return Object.freeze(x);
    };
    const kopya = JSON.stringify([p, v]);
    expect(() => haritaModeli(derin(p), derin(v), derin(ctxOf(2, { ben: { sehir: 0, firma: "f0", durum: "calisiyor" } })))).not.toThrow();
    expect(JSON.stringify([p, v])).toBe(kopya);
  });

  it("şehir sayısı pakette yoksa şehir adlarından türer; adı olmayan şehir numaralanır", () => {
    const p = { ...paketOf(0), cities: undefined };
    expect(haritaModeli(p, null, ctxOf(2)).bolgeler.map((b) => b.ad)).toEqual(["Şehir 1", "Şehir 2"]);
    expect(haritaModeli(paketOf(2), null, { runId: "r", sehirAdlari: [] }).bolgeler.map((b) => b.ad)).toEqual(["Şehir 1", "Şehir 2"]);
    // Kurucu'da şehir adı girilmemişse adlar boş dizedir: "Şehir N" yedeği
    expect(haritaModeli(paketOf(2), null, { runId: "r", sehirAdlari: ["", "  "] }).bolgeler.map((b) => b.ad)).toEqual(["Şehir 1", "Şehir 2"]);
    expect(haritaModeli(paketOf(2), null, { runId: "r", sehirAdlari: ["", "  "] }).binalar.filter((x) => x.tur === "sehir").map((x) => x.etiket)).toEqual(["Şehir 1", "Şehir 2"]);
  });

  it("haritaModeli_durumu_tasir_eski_paket_uretim", () => {
    const v = { hafta: 20, firmalar: [
      ["a", "market", 0, 5, null, "npc", null, "zayif"], ["b", "market", 0, 5, null, "npc", null, "kapali"], ["c", "market", 0, 5, null, "oyuncu", 18, "uretim"],
    ] } as ReturnType<typeof haritaOf>;
    const m = haritaModeli(paketOf(1), v, ctxOf(1));
    const durum = (id: string) => m.binalar.find((x) => x.id === id)?.durum;
    expect([durum("a"), durum("b"), durum("c")]).toEqual(["zayif", "kapali", "uretim"]);
    expect(m.binalar.find((x) => x.tur === "lonca")?.durum).toBeUndefined();
    // eski paket (6 elemanli satir) parseHarita ile uretim olur
    const eski = parseHarita({ hafta: 3, firmalar: [["x", "market", 0, 5, null, "npc"]] });
    expect(haritaModeli(paketOf(1), eski, ctxOf(1)).binalar.find((x) => x.id === "x")?.durum).toBe("uretim");
  });
  it("ozet_kapalilari_saymaz", () => {
    const v = { hafta: 20, firmalar: [
      ["a", "market", 0, 5, null, "npc", null, "uretim"], ["b", "market", 0, 5, null, "npc", null, "kapali"], ["c", "market", 0, 5, null, "npc", null, "issiz"],
    ] } as ReturnType<typeof haritaOf>;
    expect(haritaModeli(paketOf(1), v, ctxOf(1)).ozet.isletme).toBe(2);
  });
});
