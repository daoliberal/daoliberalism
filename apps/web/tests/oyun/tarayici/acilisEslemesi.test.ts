// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AkisSonucu } from "@/oyun/tarayici/kayit/akis";
import { acilisKarari, acilisSecimi, sureAraligi } from "@/oyun/tarayici/acilisEslemesi";
import { tahminiOynatma } from "@/oyun/tarayici/kayit/siniflandirma";

/** B8: kayit acilis sonucu -> secim ekrani eslemesi. Her sonuc turu icin anlasilir metin anahtari ve secenek kumesi; `durdu` sonrasi duz devam ASLA sunulmaz (K9). */
const TAHMIN = tahminiOynatma(20);
type Sonuc = Exclude<AkisSonucu, { sonuc: "tamam" }>;
const uyumsuz = (tur: "surum" | "guvensiz" | "bozuk"): Sonuc => ({ sonuc: "uyumsuz", tur, fark: {}, hedef: 20, tahmini: TAHMIN, secenekler: ["tariften_oynat", "disa_aktar", "sil"] });

describe("acilisSecimi", () => {
  it("uyumsuz_surum_tariften_oynat_disa_aktar_sil_ve_yeni_oyun_tahminle", () => {
    const s = acilisSecimi(uyumsuz("surum"));
    expect(s.baslik).toBe("acilis.uyumsuz.surum.baslik");
    expect(s.bilgi).toBe("acilis.uyumsuz.surum.bilgi");
    expect(s.secenekler).toEqual(["tariften_oynat", "disa_aktar", "sil", "yeni"]);
    expect(s.tahmini).toEqual(TAHMIN);
  });

  it("guvensiz_ve_bozuk_kendi_metinleriyle_ayni_secenekler", () => {
    expect(acilisSecimi(uyumsuz("guvensiz"))).toMatchObject({ baslik: "acilis.uyumsuz.guvensiz.baslik", bilgi: "acilis.uyumsuz.guvensiz.bilgi", secenekler: ["tariften_oynat", "disa_aktar", "sil", "yeni"] });
    expect(acilisSecimi(uyumsuz("bozuk"))).toMatchObject({ baslik: "acilis.uyumsuz.bozuk.baslik", bilgi: "acilis.uyumsuz.bozuk.bilgi", secenekler: ["tariften_oynat", "disa_aktar", "sil", "yeni"] });
  });

  it("tariften_gerek_iki_nedenle_ayri_metin_ve_tahmin", () => {
    const yok = acilisSecimi({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 20, tahmini: TAHMIN });
    expect(yok).toMatchObject({ baslik: "acilis.tariften.baslik", bilgi: "acilis.tariften.goruntu_yok", tahmini: TAHMIN });
    expect(yok.secenekler).toEqual(["tariften_oynat", "disa_aktar", "sil", "yeni"]);
    const eski = acilisSecimi({ sonuc: "tariften_gerek", neden: "goruntu_cok_eski", hedef: 50, tahmini: tahminiOynatma(50) });
    expect(eski.bilgi).toBe("acilis.tariften.goruntu_cok_eski");
  });

  it("durdu_dort_durum_icin_metin_tariften_oynat_ve_duz_devam_yok_K9", () => {
    for (const durum of ["reddedildi", "sapma", "takildi", "basarisiz"] as const) {
      const s = acilisSecimi({ sonuc: "durdu", durum, kosuId: "k", cekirdek: { durum, kosu_id: "k" } as never, kosuSilinebilir: true });
      expect(s.bilgi).toBe(`acilis.durdu.${durum}`);
      expect(s.baslik).toBe("acilis.durdu.baslik");
      expect(s.secenekler).toEqual(["disa_aktar", "sil", "yeni"]);
      expect(s.tahmini).toBeNull();
    }
  });

  it("hata_yeniden_yukle_disa_aktar_sil_yeni_kosu_yok_yalniz_yeni", () => {
    const s = acilisSecimi({ sonuc: "hata", tur: "ValueError", mesaj: "x" });
    expect(s).toMatchObject({ baslik: "acilis.hata.baslik", bilgi: "acilis.hata.bilgi", secenekler: ["yeniden_yukle", "disa_aktar", "sil", "yeni"] });
    expect(acilisSecimi({ sonuc: "hata", tur: "kosu_yok", mesaj: "kosu_yok" })).toMatchObject({ bilgi: "acilis.hata.kosu_yok", secenekler: ["yeni"] });
  });
});

describe("yeniden_yukle_gerek", () => {
  it("dogru_surum_yuklenemedi_metni_yeniden_yukle_disa_aktar_yeni_sil_sunulmaz", () => {
    const s = acilisSecimi({ sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" });
    expect(s).toMatchObject({ bilgi: "acilis.hata.surum", secenekler: ["yeniden_yukle", "disa_aktar", "yeni"] });
  });
});

describe("sureAraligi", () => {
  it("saniye_ve_dakika_metni", () => {
    expect(sureAraligi(tahminiOynatma(20))).toMatchObject({ enazDeger: 30, enaz: "tarayici.sure.sn", encokDeger: 2, encok: "tarayici.sure.dk" });
    expect(sureAraligi(tahminiOynatma(2))).toMatchObject({ enazDeger: 3, encokDeger: 12, enaz: "tarayici.sure.sn", encok: "tarayici.sure.sn" });
  });
});

describe("acilisKarari (K1/Y2: acilis akisi ve kayittanAc icin tek tablo)", () => {
  const kisa: Sonuc = { sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 20, tahmini: tahminiOynatma(20) };
  const uzun: Sonuc = { sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 40, tahmini: tahminiOynatma(40) };
  const eski: Sonuc = { sonuc: "tariften_gerek", neden: "goruntu_cok_eski", hedef: 20, tahmini: tahminiOynatma(20) };

  it("kisa_goruntusuz_ayni_model_otomatik_digerleri_secim", () => {
    expect(acilisKarari(kisa, { uyumlu: true })).toEqual({ tur: "otomatik" });
    expect(acilisKarari({ ...kisa, tahmini: { hafta: 25, enAzSn: 37.5, enCokSn: 150 } }, { uyumlu: true })).toEqual({ tur: "otomatik" });   // sinir dahil
    expect(acilisKarari(uzun, { uyumlu: true })).toEqual({ tur: "secim", sonuc: uzun });
    expect(acilisKarari(eski, { uyumlu: true })).toEqual({ tur: "secim", sonuc: eski });
  });

  it("Y2_model_farkliysa_kisa_bile_uyumsuz_surum_secimi_tahminle", () => {
    const k = acilisKarari(kisa, { uyumlu: false, fark: { model_sha256: ["a", "b"] } });
    expect(k).toMatchObject({ tur: "secim", sonuc: { sonuc: "uyumsuz", tur: "surum", hedef: 20, tahmini: kisa.tahmini, fark: { model_sha256: ["a", "b"] } } });
    expect(acilisSecimi((k as { sonuc: Sonuc }).sonuc).bilgi).toBe("acilis.uyumsuz.surum.bilgi");
  });

  it("uyumsuz_durdu_hata_her_zaman_secim", () => {
    for (const s of [uyumsuz("surum"), { sonuc: "durdu", durum: "sapma", kosuId: "k", cekirdek: {} as never, kosuSilinebilir: true } as Sonuc, { sonuc: "hata", tur: "X", mesaj: "m" } as Sonuc])
      expect(acilisKarari(s, { uyumlu: true })).toEqual({ tur: "secim", sonuc: s });
  });
});
