// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KotaYoneticisi, kotaDoluHatasi, type DepolamaArayuzu } from "@/oyun/tarayici/kayit/kota";
import { KosuYazici } from "@/oyun/tarayici/kayit/yazici";
import { SahteCekirdek, karar, yeniDepo, yeniIdb } from "./yardimci";

async function kosuHazirla(depo: Awaited<ReturnType<typeof yeniDepo>>, c: SahteCekirdek, id: string, hafta: number, kota: KotaYoneticisi | null) {
  const yazici = new KosuYazici({ depo, cekirdek: c, kota, zaman: () => 1000 });
  c.kosuYarat(id);
  await yazici.kosuBaslat(id);
  c.gunlugeEkle(id, karar(1, 0));
  for (let h = 1; h <= hafta; h++) {
    await yazici.haftaOlayi(id, c.tick(id));
    await yazici.tick(id);
  }
  await new Promise((r) => setTimeout(r, 2)); // olusturma sirasi
  return yazici;
}

/** Depolama sahtesi: `oran` listesi sirayla dondurulur (son deger sabit). */
function sahteDepolama(oranlar: number[], persist: boolean | "hata" | "yok" = true, onceden = false): DepolamaArayuzu & { olcum: number } {
  const o = { olcum: 0 } as DepolamaArayuzu & { olcum: number };
  o.estimate = async () => {
    const oran = oranlar[Math.min(o.olcum++, oranlar.length - 1)] as number;
    return { usage: oran * 1000, quota: 1000 };
  };
  if (persist !== "yok") {
    o.persisted = async () => onceden;
    o.persist = async () => {
      if (persist === "hata") throw new Error("x");
      return persist;
    };
  }
  return o;
}

describe("persist", () => {
  it("sonuc_dondurulur_ve_meta_ya_yazilir", async () => {
    const depo = await yeniDepo(yeniIdb());
    const k = new KotaYoneticisi({ depo, storage: sahteDepolama([0.1], true), zaman: () => 7 });
    expect(await k.kalicilikIste()).toEqual({ durum: "verildi", onceden: false, zaman: 7 });
    expect(await k.kalicilikDurumu()).toEqual({ durum: "verildi", onceden: false, zaman: 7 });
  });

  it("verilmedi_onceden_verilmis_destek_yok_hata", async () => {
    const depo = await yeniDepo(yeniIdb());
    expect((await new KotaYoneticisi({ depo, storage: sahteDepolama([0.1], false) }).kalicilikIste()).durum).toBe("verilmedi");
    expect(await new KotaYoneticisi({ depo, storage: sahteDepolama([0.1], false, true) }).kalicilikIste()).toMatchObject({ durum: "verildi", onceden: true });
    expect((await new KotaYoneticisi({ depo, storage: sahteDepolama([0.1], "yok") }).kalicilikIste()).durum).toBe("desteklenmiyor");
    expect((await new KotaYoneticisi({ depo, storage: null }).kalicilikIste()).durum).toBe("desteklenmiyor");
    expect((await new KotaYoneticisi({ depo, storage: sahteDepolama([0.1], "hata") }).kalicilikIste()).durum).toBe("hata");
  });

  it("henuz_istenmediyse_durum_null", async () => {
    const depo = await yeniDepo(yeniIdb());
    expect(await new KotaYoneticisi({ depo }).kalicilikDurumu()).toBeNull();
  });
});

describe("kota denetimi", () => {
  it("esik_altinda_hicbir_sey_silinmez_olculemiyorsa_da", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "a", 13, null);
    expect((await new KotaYoneticisi({ depo, storage: sahteDepolama([0.5]) }).denetle()).bosaltilan).toEqual([]);
    expect((await new KotaYoneticisi({ depo, storage: null }).denetle())).toMatchObject({ olcum: null, yeterli: true, bosaltilan: [] });
    expect((await depo.goruntuleriListele("a")).length).toBe(1);
  });

  it("kota_dolunca_en_eski_kosunun_goruntuleri_silinir_gunluk_ve_paketler_kalir", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "eski", 26, null);
    await kosuHazirla(depo, c, "orta", 13, null);
    await kosuHazirla(depo, c, "yeni", 13, null);
    expect((await depo.goruntuleriListele("eski")).length).toBe(2);
    const k = new KotaYoneticisi({ depo, storage: sahteDepolama([0.95, 0.7]) });
    const s = await k.denetle("yeni");
    expect(s.bosaltilan).toEqual([{ kosuId: "eski", silinenGoruntu: 2 }]);
    expect(s.yeterli).toBe(true);
    expect(await depo.goruntuleriListele("eski")).toEqual([]);
    expect((await depo.kosuOku("eski"))?.sonGoruntu).toBeNull();
    expect(await depo.paketSayisi("eski")).toBe(26);
    expect((await depo.gunlukOku("eski")).length).toBe(1);
    expect((await depo.goruntuleriListele("orta")).length).toBe(1);
    expect((await depo.goruntuleriListele("yeni")).length).toBe(1);
    expect((await depo.taniOku()).some((t) => t.tur === "kota_bosaltma")).toBe(true);
  });

  it("yetmezse_siradaki_en_eski_kosuya_gecer_en_son_korunan_kosunun_yalniz_en_yeni_goruntusu_kalir", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "eski", 13, null);
    await kosuHazirla(depo, c, "yeni", 26, null);
    const k = new KotaYoneticisi({ depo, storage: sahteDepolama([0.99, 0.95, 0.9, 0.5]) });
    const s = await k.denetle("yeni");
    expect(s.bosaltilan.map((b) => b.kosuId)).toEqual(["eski", "yeni"]);
    expect((await depo.goruntuleriListele("yeni")).map((g) => g.yayimlanan)).toEqual([26]); // yalniz en yenisi
    expect(await depo.paketSayisi("yeni")).toBe(26);
  });

  it("bosaltma_yetmezse_yeterli_false_ve_sonsuz_donguye_girmez", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "a", 13, null);
    await kosuHazirla(depo, c, "b", 13, null);
    const s = await new KotaYoneticisi({ depo, storage: sahteDepolama([0.99]) }).denetle("b");
    expect(s.yeterli).toBe(false);
    expect(s.bosaltilan.map((x) => x.kosuId)).toEqual(["a"]); // b tek goruntu: en yenisi korunur
  });

  it("yazimdan_sonra_otomatik_denetim_yazici_kotayi_cagirir", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "eski", 13, null);
    const kota = new KotaYoneticisi({ depo, storage: sahteDepolama([0.95, 0.5]) });
    await kosuHazirla(depo, c, "yeni", 13, kota);
    expect(await depo.goruntuleriListele("eski")).toEqual([]);
    expect((await depo.goruntuleriListele("yeni")).length).toBe(1);
  });

  it("en_eski_son_kullanima_gore_asil_uzun_kosu_korunur", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    await kosuHazirla(depo, c, "asil", 13, null); // once acildi
    await kosuHazirla(depo, c, "deneme", 13, null);
    await new Promise((r) => setTimeout(r, 2));
    await depo.haftalarYaz("asil", [{ week: 14 }]); // asil kosu yakinda kullanildi
    const s = await new KotaYoneticisi({ depo, storage: sahteDepolama([0.95, 0.5]) }).denetle("zz");
    expect(s.bosaltilan.map((b) => b.kosuId)).toEqual(["deneme"]);
    expect((await depo.goruntuleriListele("asil")).length).toBe(1);
  });

  it("kota_dolu_hatasi_tanima", () => {
    expect(kotaDoluHatasi(Object.assign(new Error("x"), { name: "QuotaExceededError" }))).toBe(true);
    expect(kotaDoluHatasi(new Error("x"))).toBe(false);
    expect(kotaDoluHatasi(null)).toBe(false);
  });
});
