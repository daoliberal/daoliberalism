import { describe, expect, it } from "vitest";
import { parseMakro, parsePacket } from "@/oyun/sim/live/wire";
import { MAKRO_TEL, packetOf } from "../../helpers/fakeLiveServer";

/* eslint-disable @typescript-eslint/no-explicit-any -- tel biçimi örneği bozuk alanlarla oynanır: tür serbest */
const tel = (): Record<string, any> => structuredClone(MAKRO_TEL) as Record<string, any>;

describe("wire: makro bloğu", () => {
  it("test_iyi_blok_ayristirilir_ve_pakete_girer", () => {
    const m = parseMakro(tel())!;
    expect(m.fiyat.tuk).toBeCloseTo(1.042, 6);
    expect(m.uretim.nominal).toBe(319894);
    expect(m.para.stok).toBe(450000);
    expect(m.faiz.politika).toBeGreaterThan(0);
    expect(m.konut).not.toBeNull();
    expect(m.dagilim.gini_nakit).toBeGreaterThan(0);
    const p = parsePacket(packetOf("r", 3, 1, { makro: true }));
    expect(p.makro).toEqual(m);
    expect(parsePacket(packetOf("r", 3, 1)).makro).toBeUndefined();            // eski sunucu / kayıt: alan yok
  });

  it("test_negatif_deger_korunur_sonlu_olmayan_ve_tur_hatasi_null", () => {
    const t = tel();
    t.fiyat.enf = -0.25;
    t.faiz.gercek = -0.31;
    t.marj.npc = -0.15;
    t.uretim.buyume = Number.NaN;
    t.para.hiz = "0,4";
    t.dagilim.yoksul = Infinity;
    const m = parseMakro(t)!;
    expect([m.fiyat.enf, m.faiz.gercek, m.marj.npc]).toEqual([-0.25, -0.31, -0.15]);
    expect([m.uretim.buyume, m.para.hiz, m.dagilim.yoksul]).toEqual([null, null, null]);   // hiçbir şey 0'a çevrilmez
  });

  it("test_konut_null_ve_eksik_grup_null_alanli_nesne_nesne_degilse_atlanir", () => {
    const t = tel();
    t.konut = null;
    delete t.kredi;
    const m = parseMakro(t)!;
    expect(m.konut).toBeNull();
    expect(m.kredi).toEqual({ stok: null, buyume: null, temerrut: null });
    for (const x of [null, undefined, 5, "x", [1, 2]]) expect(parseMakro(x)).toBeUndefined();
    expect(parsePacket({ ...packetOf("r", 1, 1), makro: [1] }).makro).toBeUndefined();   // bozuk blok paketi düşürmez
  });
});
