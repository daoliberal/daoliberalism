import { describe, expect, it } from "vitest";
import { FakeDao } from "../helpers/fakeDao";

describe("Sahte DAO sunucusu model sözleşmesini taklit eder: yeni olay türleri", () => {
  it("kurma_sartlari_ilk_tamamlandigi_haftada_kurabilir_oldu_yazilir_bir_kez", () => {
    const d = new FakeDao(520);
    d.nakit = 1000;
    d.durum = "calisan";
    d.calisilan = 12;
    d.hafta = 1;
    d.adim(); // 13 hafta çalışıldı: şartlar tamam
    expect(d.olaylar.map((o) => o.tur)).toContain("kurabilir_oldu");
    d.adim();
    expect(d.olaylar.map((o) => o.tur)).not.toContain("kurabilir_oldu");
  });

  it("uygulama_haftasinda_gecersiz_kalan_karar_karar_uygulanamadi_olur", () => {
    const d = new FakeDao(520);
    d.hafta = 3;
    d.durum = "is_arayan";
    d.karar({ tur: "goc", sehir: 1 });
    d.durum = "kurucu"; // karar kabul edildikten sonra durum değişti
    d.adim();
    expect(d.olaylar).toContainEqual({ tur: "karar_uygulanamadi", hafta: 4, karar: "goc", neden: "kurucu" });
    expect(d.sehir).toBe(0);
  });
});
