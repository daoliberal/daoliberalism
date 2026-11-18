import { afterEach, describe, expect, it, vi } from "vitest";
import { tr } from "@/oyun/copy/tr";
import { tarayiciMetinleri } from "@/oyun/copy/tarayici";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("tarayici kipi metinleri (K5: motor/cekirdek hatasi 'sunucu' gibi gorunmez)", () => {
  it("her_anahtar_tr_de_var_ve_yer_tutucular_ayni_kalir_sunucu_kelimesi_gecmez", () => {
    for (const [k, v] of Object.entries(tarayiciMetinleri)) {
      expect(k in tr, k).toBe(true);
      const yer = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(yer(v as string), k).toEqual(yer(tr[k as keyof typeof tr]));
      expect(v as string, k).not.toMatch(/sunucu/i);
      expect(v as string, k).not.toMatch(/\d[A-Za-zÇĞİÖŞÜçğıöşü]/);
    }
  });

  it("bayrakli_derlemede_t_tarayici_karsiligini_bayraksizda_asil_metni_verir", async () => {
    vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", "tarayici");
    vi.resetModules();
    const a = await import("@/oyun/copy/t");
    expect(a.t("hata.sunucu_bozuk")).toBe(tarayiciMetinleri["hata.sunucu_bozuk"]);
    expect(a.t("kosular.kapat.metin", { ad: "X" })).toBe("X kapatılacak ve açık koşu sayısından düşecek. Kütüphanedeki kaydı silinmez; sonra Aç ile yeniden kurulabilir.");
    vi.stubEnv("NEXT_PUBLIC_OYUN_KAYNAK", "");
    vi.resetModules();
    const b = await import("@/oyun/copy/t");
    expect(b.t("hata.sunucu_bozuk")).toBe(tr["hata.sunucu_bozuk"]);
  });
});
