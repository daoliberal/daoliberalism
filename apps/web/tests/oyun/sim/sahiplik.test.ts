import { describe, expect, it } from "vitest";
import { loncaKirilimi, mevduatSahipleri, sahiplikGorunumu } from "@/oyun/sim/sahiplik";
import type { Holdings, World } from "@/oyun/sim/types";
import { holdingsOrnek, worldOrnek } from "../helpers/sahiplikVeri";

const satir = (g: NonNullable<ReturnType<typeof sahiplikGorunumu>>, id: string) => g.satirlar.find((s) => s.id === id)?.deger;

describe("sahiplik görünümü (§4.1 formülü)", () => {
  it("sahiplik_toplami_para_stokuna_esit", () => {
    const g = sahiplikGorunumu(worldOrnek(), holdingsOrnek())!;
    expect(g.toplam).not.toBeNull();
    expect(g.hesapToplami).toBe(447450);
    expect(Math.abs(g.toplam! - g.hesapToplami!)).toBeLessThanOrEqual(9);
  });

  it("satirlar_formulle_hesaplanir", () => {
    const h = holdingsOrnek();
    const w = worldOrnek();
    const g = sahiplikGorunumu(w, h)!;
    expect(satir(g, "hane_nakdi")).toBe(w.money_households);
    expect(satir(g, "hane_mevduat")).toBe(h.money.deposits_players);
    expect(satir(g, "sigorta")).toBe(h.money.insurance_reserve! + h.money.deposits_insurance!);
    expect(satir(g, "yerlesik")).toBe(w.money_npc_firms);
    expect(satir(g, "oyuncu_isletme")).toBe(w.money_player_firms);
    expect(satir(g, "kamu")).toBe(w.money_city! + h.money.found_fund!);
    expect(satir(g, "lonca_kasa")).toBe(h.money.lonca_cash_net);
    expect(satir(g, "diger")).toBe(w.money_other);
  });

  it("negatif_lonca_kasasinda_kredi_disarida_yazilir_pozitifte_null", () => {
    const neg = sahiplikGorunumu(worldOrnek({ money_lonca: 4400 }), holdingsOrnek({ lonca_cash_net: -2000 }))!   // 4400 = -2000 + 900 + 100 + 5000 + 400;
    expect(satir(neg, "lonca_kasa")).toBe(-2000);
    expect(neg.krediDisarida).toBe(2040);          // credit_out 2000 + bonds_out 40
    expect(Math.abs(neg.toplam! - neg.hesapToplami!)).toBeLessThanOrEqual(9);
    const poz = sahiplikGorunumu(worldOrnek(), holdingsOrnek())!;
    expect(poz.krediDisarida).toBeNull();
  });

  it("eksik_girdi_toplami_null_yapar_uydurma_yok", () => {
    const h = holdingsOrnek();
    const g = sahiplikGorunumu(worldOrnek({ money_city: null }), h)!;
    expect(satir(g, "kamu")).toBeNull();
    expect(g.toplam).toBeNull();
    expect(g.hesapToplami).toBeNull();
    const h2: Holdings = { ...h, money: { ...h.money, found_fund: null } };
    expect(satir(sahiplikGorunumu(worldOrnek(), h2)!, "kamu")).toBeNull();
  });

  it("blok_ya_da_dunya_yoksa_null", () => {
    expect(sahiplikGorunumu(worldOrnek(), undefined)).toBeNull();
    expect(sahiplikGorunumu(null, holdingsOrnek())).toBeNull();
    expect(sahiplikGorunumu({} as World, holdingsOrnek())!.toplam).toBeNull();
  });
});

describe("lonca kırılımı ve mevduat sahipleri (kapanış)", () => {
  it("lonca_kirilimi_dort_satir_money_lonca_ile_kapanir", () => {
    const k = loncaKirilimi(holdingsOrnek())!;
    expect(k.satirlar.map((r) => r.id)).toEqual(["mevduat", "fon", "rezerv", "kasa"]);
    expect(k.toplam).toBe(worldOrnek().money_lonca);
    expect(loncaKirilimi(holdingsOrnek({ lonca_cash_net: -2000 }))!.toplam).toBe(900 + 100 + 5000 + 400 - 2000);      // net kasa eksiyken de dört satır toplanır
  });

  it("lonca_kirilimi_biri_olculmediyse_toplam_null", () => {
    expect(loncaKirilimi(holdingsOrnek({ found_fund: null }))!.toplam).toBeNull();
    expect(loncaKirilimi(undefined)).toBeNull();
  });

  it("mevduat_sahipleri_toplami_oyuncu_ve_sigorta_mevduatina_esit", () => {
    const h = holdingsOrnek();
    const m = mevduatSahipleri(h)!;
    expect(m.satirlar).toHaveLength(10);
    expect(m.toplam).toBe(h.money.deposits_players! + h.money.deposits_insurance!);
  });

  it("bilinmeyen_mevduat_grubu_diger_satirina_katilir_ham_anahtar_yazilmaz", () => {
    const h = holdingsOrnek();
    const g = mevduatSahipleri({ ...h, deposits: { by_group: { ...h.deposits.by_group, gizli_grup: 70 } } })!;
    expect(g.satirlar.find((r) => r.id === "other")?.deger).toBe(120);
    expect(g.satirlar.some((r) => r.id === "gizli_grup")).toBe(false);
    expect(g.toplam).toBe(1070);
  });

  it("eksik_grup_toplami_null_yapar", () => {
    const h = holdingsOrnek();
    const kalan = { ...h.deposits.by_group };
    delete kalan.student;
    expect(mevduatSahipleri({ ...h, deposits: { by_group: kalan } })!.toplam).toBeNull();
    expect(mevduatSahipleri(undefined)).toBeNull();
  });
});
