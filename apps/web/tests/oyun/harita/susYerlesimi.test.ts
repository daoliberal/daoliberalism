import { describe, expect, it } from "vitest";
import { SUS_STILI } from "@/oyun/harita/haritaStili";
import { sehirSahnesi } from "@/oyun/harita/sehirSahnesi";
import { SUS_KATALOGU } from "@/oyun/harita/susKatalogu";
import { susYerlestir, type SusGirdisi } from "@/oyun/harita/susYerlesimi";
import type { HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import { packetOf } from "../helpers/fakeLiveServer";

const parselleri = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: 100 + 70 * (i % 10), y: 100 + 60 * Math.floor(i / 10), genislik: 64, yukseklik: 56, kademe: 0 }));
const girdi = (ek: Partial<SusGirdisi> = {}): SusGirdisi => ({
  runId: "k1", sehir: 0, parseller: parselleri(100), dolu: new Set(), meydan: { x: 400, y: 300, yaricap: 92 }, ahir: { x: 700, y: 650, g: 100, d: 42 }, ...ek,
});

describe("susYerlestir", () => {
  it("test_deterministik_ve_tohuma_bagli", () => {
    expect(susYerlestir(girdi())).toEqual(susYerlestir(girdi()));
    const a = susYerlestir(girdi()).filter((s) => s.id.startsWith("sus-")).map((s) => s.id);
    const b = susYerlestir(girdi({ runId: "k2" })).filter((s) => s.id.startsWith("sus-")).map((s) => s.id);
    expect(b).not.toEqual(a);
  });

  it("test_yalniz_bos_parsellerin_bir_kismi_sus_alir", () => {
    const dolu = new Set(parselleri(100).slice(0, 50).map((p) => p.id));
    const s = susYerlestir(girdi({ dolu })).filter((x) => x.id.startsWith("sus-"));
    for (const x of s) expect(dolu.has(x.id.slice(4)), x.id).toBe(false);
    // 50 boş parselin yaklaşık bosOran'ı (kimlik tabanlı karma: geniş tolerans)
    expect(s.length).toBeGreaterThan(50 * SUS_STILI.bosOran * 0.4);
    expect(s.length).toBeLessThan(50 * SUS_STILI.bosOran * 1.8);
    expect(new Set(s.map((x) => x.tur))).toEqual(new Set(["agac-kumesi", "park"]));
    // süs ayak izi parsele sığar
    for (const x of s) expect(x.taban.g).toBeLessThanOrEqual(64);
  });

  it("test_baska_parsel_dolunca_digerlerinin_susu_degismez", () => {
    const tam = susYerlestir(girdi()).filter((s) => s.id.startsWith("sus-"));
    const kaybolan = tam[0]!.id.slice(4);
    const az = susYerlestir(girdi({ dolu: new Set([kaybolan]) })).filter((s) => s.id.startsWith("sus-"));
    expect(az.map((s) => s.id)).toEqual(tam.slice(1).map((s) => s.id));
  });

  it("test_meydan_dosemesi_meydanin_altinda_ve_meydani_kapsar", () => {
    const m = susYerlestir(girdi()).filter((s) => s.tur === "meydan-dosemesi");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ x: 400, y: 300 });
    expect(m[0]!.taban.g).toBeGreaterThanOrEqual(92 * Math.SQRT2); // meydana yazılı kare
  });

  it("test_cit_ahirin_onunde_ve_ahiri_kapsar", () => {
    const g = girdi();
    const cit = susYerlestir(g).filter((s) => s.tur === "cit");
    const k = SUS_KATALOGU.cit.taban.g;
    expect(cit).toHaveLength(Math.ceil(g.ahir.g / k));
    const x1 = Math.min(...cit.map((c) => c.x - k / 2));
    const x2 = Math.max(...cit.map((c) => c.x + k / 2));
    expect(x1).toBeLessThanOrEqual(g.ahir.x - g.ahir.g / 2);
    expect(x2).toBeGreaterThanOrEqual(g.ahir.x + g.ahir.g / 2);
    for (const c of cit) expect(c.y).toBeGreaterThanOrEqual(g.ahir.y + g.ahir.d / 2 + SUS_STILI.citBosluk);
  });

  it("test_sus_kimlikleri_benzersiz", () => {
    const ids = susYerlestir(girdi()).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("sehirSahnesi susler", () => {
  const firma = (i: number): HaritaFirmaSatiri => [`f${i}`, "market", 0, 5, null, "npc", null, "uretim"];
  const harita: HaritaVerisi = { hafta: 1, firmalar: Array.from({ length: 12 }, (_, i) => firma(i)) };
  const ctx = { runId: "k1", sehirAdlari: ["A"], sehir: 0, katman: "yok" as const };

  it("test_sahne_susleri_tasir_ve_sus_isletme_parselinde_degildir", () => {
    const s = sehirSahnesi(packetOf("r", 1, 1), harita, ctx);
    expect(s.susler.length).toBeGreaterThan(0);
    const dolu = new Set(s.binalar.map((b) => b.parsel));
    for (const x of s.susler) if (x.id.startsWith("sus-")) expect(dolu.has(x.id.slice(4))).toBe(false);
    expect(s.susler.some((x) => x.tur === "meydan-dosemesi")).toBe(true);
    expect(s.susler.some((x) => x.tur === "cit")).toBe(true);
  });

  it("test_sus_secilemez_katmana_girmez", () => {
    const s = sehirSahnesi(packetOf("r", 1, 1), harita, { ...ctx, katman: "talep" });
    for (const x of s.susler) {
      expect(s.katman.tonlar.has(x.id)).toBe(false);
      expect([...s.binalar, s.sehirBinasi, s.ahir].some((b) => b.id === x.id || b.ref.ref === x.id)).toBe(false);
    }
  });

  it("test_veri_yokken_da_susler_var", () => {
    const s = sehirSahnesi(packetOf("r", 1, 1), null, ctx);
    expect(s.veriYok).toBe(true);
    expect(s.susler.length).toBeGreaterThan(0);
  });
});
