import { describe, expect, it } from "vitest";
import { parseEkonomi, parsePacket } from "@/oyun/sim/live/wire";
import { EKONOMI_TEL, packetOf } from "../../helpers/fakeLiveServer";

const tel = (): Record<string, any> => structuredClone(EKONOMI_TEL) as Record<string, any>;

describe("wire: ekonomi bloğu", () => {
  it("test_iyi_blok_ayristirilir", () => {
    const e = parseEkonomi(tel())!;
    expect(e.tuketim.hane.ise).toEqual({ n: 4600, karsilanma: 0.82, sepet: 290.5 });
    expect(e.tuketim.hane.npc?.dis.n).toBe(510);
    expect(e.tuketim.hane.npc_issiz_parasiz).toBe(120.5);
    expect(e.tuketim.hane.sehir).toHaveLength(5);
    expect(e.tuketim.hane.sehir[1]!.harcama).toEqual({ oyuncu: 20103, npc: 80503 });
    expect(e.tuketim.harcama).toEqual({ npc: 402503, oyuncu: 100503, toplam: 503006 });
    expect(e.isletme.istihdam).toEqual({ oyuncu: 610, npc: 1150, ozel: 1500, kamu: 260 });
    expect(e.isletme.hareket).toEqual({ kurulan: 2, buyuyen: 9, kuculen: 4, batan: 1 });
    expect(e.isletme.sehir).toHaveLength(5);
    expect(e.isletme.sehir[0]).toMatchObject({ ozel_calisan: 300, kamu_calisan: 40, calisan_oyuncu: 120, calisan_npc: 220, isgucu_disi: 15 });
    expect(e.para!.oyuncu_ust10).toBe(900000);
    const p = parsePacket(packetOf("r", 3, 1, { ekonomi: true }));
    expect(p.ekonomi).toEqual(e);
  });

  it("test_ucret_blogu_ayristirilir_bozuk_satir_null", () => {
    const e = parseEkonomi(tel())!;
    expect(e.tuketim.ucret!.dunya).toEqual({ ucret: 1.2, fiyat: 1.1, net: 75.6, oran: 1.5 });
    expect(e.tuketim.ucret!.sehir).toHaveLength(5);
    expect(e.tuketim.ucret!.sehir[1]).toEqual({ ucret: 1.21, fiyat: 1.11, net: 76.6, oran: 1.55 });
    const t = tel();
    t.tuketim.ucret.dunya = [1, 2, 3];
    t.tuketim.ucret.sehir[0] = [1.5, null, Number.NaN, -1];
    const b = parseEkonomi(t)!.tuketim.ucret!;
    expect(b.dunya).toEqual({ ucret: null, fiyat: null, net: null, oran: null });
    expect(b.sehir[0]).toEqual({ ucret: 1.5, fiyat: null, net: null, oran: null });
    delete t.tuketim.ucret;
    expect(parseEkonomi(t)!.tuketim.ucret).toBeNull();
  });

  it("test_blok_nesne_degilse_atlanir_paket_dusmez", () => {
    for (const bozuk of ["x", 5, [1], true]) {
      const p = parsePacket({ ...packetOf("r", 7, 1), ekonomi: bozuk });
      expect(p.ekonomi).toBeUndefined();
      expect(p.week).toBe(7);
    }
    expect(parsePacket({ ...packetOf("r", 7, 1), ekonomi: null }).ekonomi).toBeUndefined();
    expect(parsePacket(packetOf("r", 7, 1)).ekonomi).toBeUndefined();
  });

  it("test_bozuk_sehir_satiri_atlanir", () => {
    const t = tel();
    t.isletme.sehir.splice(1, 0, "bozuk", { sehir: "x", boy: [1, 1, 1, 1] }, null);
    t.tuketim.hane.sehir.splice(0, 0, { sehir: -1 }, 7);
    const e = parseEkonomi(t)!;
    expect(e.isletme.sehir.map((s) => s.sehir)).toEqual([0, 1, 2, 3, 4]);
    expect(e.tuketim.hane.sehir.map((s) => s.sehir)).toEqual([0, 1, 2, 3, 4]);
  });

  it("test_sonlu_olmayan_sayi_null", () => {
    const t = tel();
    t.tuketim.hane.ise.n = Number.NaN;
    t.tuketim.hane.ise.karsilanma = Number.POSITIVE_INFINITY;
    t.tuketim.harcama.toplam = Number.NaN;
    t.isletme.sehir[0].ozel_calisan = Number.POSITIVE_INFINITY;
    const e = parseEkonomi(t)!;
    expect(e.tuketim.hane.ise).toEqual({ n: null, karsilanma: null, sepet: 290.5 });
    expect(e.tuketim.harcama!.toplam).toBeNull();
    expect(e.isletme.sehir[0]!.ozel_calisan).toBeNull();
    expect(e.tuketim.harcama!.npc).toBe(402503);
  });

  it("test_boy_dort_elemanli_degilse_satir_atlanir", () => {
    const t = tel();
    t.isletme.sehir[0].boy = [1, 2, 3];
    t.isletme.sehir[1].boy = [1, 2, 3, 4, 5];
    t.isletme.sehir[2].boy = [1, "x", 3, 4];
    t.isletme.sehir[3].boy = "yok";
    expect(parseEkonomi(t)!.isletme.sehir.map((s) => s.sehir)).toEqual([4]);
  });

  it("test_negatif_sayi_null_ya_da_atlanir", () => {
    const t = tel();
    t.tuketim.hane.issiz.n = -5;
    t.isletme.istihdam.oyuncu = -1;
    t.isletme.sehir[0].calisan_npc = -3;
    t.isletme.sehir[1].boy = [1, -2, 3, 4];
    t.tuketim.urunler[0].stok = -1;
    const e = parseEkonomi(t)!;
    expect(e.tuketim.hane.issiz.n).toBeNull();
    expect(e.isletme.istihdam.oyuncu).toBeNull();
    expect(e.isletme.sehir[0]!.calisan_npc).toBeNull();
    expect(e.isletme.sehir.map((s) => s.sehir)).not.toContain(1);
    expect(e.tuketim.urunler!.map((u) => u.urun)).toEqual(["un", "ekmek"]);
  });

  it("test_urunler_null_korunur", () => {
    const t = tel();
    t.tuketim.urunler = null;
    expect(parseEkonomi(t)!.tuketim.urunler).toBeNull();
    t.tuketim.urunler = [];
    expect(parseEkonomi(t)!.tuketim.urunler).toEqual([]);
    t.tuketim.urunler = "x";
    expect(parseEkonomi(t)!.tuketim.urunler).toBeNull();
  });

  it("test_olculmeyen_hane_null_korunur_sifira_donmez", () => {
    const t = tel();
    t.tuketim.hane.issiz = { n: 0, karsilanma: null, sepet: null };
    t.tuketim.hane.ise = { n: null, karsilanma: null, sepet: null };
    t.tuketim.harcama = null;
    t.isletme.hareket = null;
    t.tuketim.hane.npc_issiz_parasiz = null;
    const e = parseEkonomi(t)!;
    expect(e.tuketim.hane.issiz).toEqual({ n: 0, karsilanma: null, sepet: null });
    expect(e.tuketim.hane.ise.n).toBeNull();
    expect(e.tuketim.harcama).toBeNull();
    expect(e.isletme.hareket).toBeNull();
    expect(e.tuketim.hane.npc_issiz_parasiz).toBeNull();
  });
});
