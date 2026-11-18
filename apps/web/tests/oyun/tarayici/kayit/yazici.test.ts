// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import { KayitDeposu } from "@/oyun/tarayici/kayit/depo";
import { KotaYoneticisi } from "@/oyun/tarayici/kayit/kota";
import { KosuYazici, type HatirlatmaOlayi } from "@/oyun/tarayici/kayit/yazici";
import { SahteCekirdek, birlestir, karar, kosuyuKur, sart, yeniDepo, yeniIdb } from "./yardimci";

async function kurulum(o: { hatirlatma?: (o: HatirlatmaOlayi) => void; kota?: KotaYoneticisi | null; idb?: IDBFactory } = {}) {
  const depo = await yeniDepo(o.idb ?? yeniIdb(), () => 1000);
  const c = new SahteCekirdek();
  const yazici = new KosuYazici({ depo, cekirdek: c, kota: o.kota, hatirlatma: o.hatirlatma, zaman: () => 1000 });
  return { depo, c, yazici };
}

/** Bir haftalik dongu: cekirdek ilerler, paket yazilir, tick (gunluk + goruntu). */
async function oyna(k: Awaited<ReturnType<typeof kurulum>>, id: string, hafta: number) {
  for (let h = 0; h < hafta; h++) {
    const p = k.c.tick(id);
    await k.yazici.haftaOlayi(id, p);
    await k.yazici.tick(id);
  }
}

describe("kosu yazimi", () => {
  it("kosu_baslat_tarif_ve_model_anahtarini_kaydeder_idempotent", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    const a = await k.yazici.kosuBaslat("k");
    const b = await k.yazici.kosuBaslat("k");
    expect(a.modelAnahtari).toEqual(k.c.anahtar);
    expect(b.olusturma).toBe(a.olusturma);
    expect((await k.depo.kosulariListele()).length).toBe(1);
  });

  it("paketler_ve_gunluk_her_olayda_yazilir_kadans_dolunca_goruntu", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    await oyna(k, "k", 12);
    k.c.gunlugeEkle("k", karar(1, 11));
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "gerekmiyor" });
    await oyna(k, "k", 1);
    const g = await k.depo.goruntuleriListele("k");
    expect(g.map((x) => x.yayimlanan)).toEqual([13]);
    expect(await k.depo.paketSayisi("k")).toBe(13);
    expect(await k.depo.gunlukOku("k")).toEqual([karar(1, 11)]);
    expect(g[0]?.gunlukSira).toBe(1);
  });

  it("sink_baytlari_kopyalanir_arabellek_yeniden_kullanimi_goruntuyu_bozmaz", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    const s = await k.yazici.tick("k");
    expect(s.goruntu.durum).toBe("yazildi");
    const g = (await k.depo.goruntuleriListele("k"))[0];
    const metin = new TextDecoder().decode(await birlestir((await k.depo.goruntuParcalari("k", g?.goruntuKimligi ?? "")) ?? []));
    expect(JSON.parse(metin).released).toBe(13);
  });

  it("goruntu_yazimi_parcalar_birlestirilmeden_ayri_kayitlar", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    await k.yazici.tick("k");
    expect(await k.depo.parcaSayisi()).toBe(3);
  });

  it("gunluk_yeniden_ekleme_cift_kayit_uretmez_ayni_sira_ayni_icerik", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    k.c.gunlugeEkle("k", karar(1, 0));
    k.c.gunlugeEkle("k", sart(2, 3));
    await k.yazici.gunlukSenkronla("k");
    await k.yazici.gunlukSenkronla("k", 0); // devam sonrasi: ayni girisler tekrar gelir
    await k.yazici.gunlukSenkronla("k", 0);
    expect(await k.depo.gunlukOku("k")).toHaveLength(2);
    expect((await k.depo.taniOku()).filter((t) => t.tur === "gunluk_cakisma")).toEqual([]);
  });

  it("gunluk_cakismasi_tani_kaydi_birakir_ilk_giris_kalir", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    k.c.gunlugeEkle("k", karar(1, 0));
    await k.yazici.gunlukSenkronla("k");
    (k.c.kosular.get("k") as { gunluk: unknown[] }).gunluk[0] = karar(1, 0, { degisik: 1 });
    const s = await k.yazici.gunlukSenkronla("k", 0);
    expect(s.cakisan).toEqual([1]);
    expect(await k.depo.gunlukOku("k")).toEqual([karar(1, 0)]);
    expect((await k.depo.taniOku()).some((t) => t.tur === "gunluk_cakisma")).toBe(true);
  });
});

describe("goruntu hatalari", () => {
  it("goruntu_al_hata_verirse_gelen_parcalar_atilir_hicbir_sey_yazilmaz", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    k.c.goruntuHatasi = { tur: "TaninmayanReferans", kac: 1 };
    const s = await k.yazici.tick("k");
    expect(s.goruntu).toEqual({ durum: "durdu", tur: "TaninmayanReferans" });
    expect(await k.depo.parcaSayisi()).toBe(0);
    expect(await k.depo.goruntuleriListele("k")).toEqual([]);
  });

  it("kalici_hata_oncekini_korur_denemeyi_durdurur_ve_tani_tutar", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    await oyna(k, "k", 13);
    const once = (await k.depo.goruntuleriListele("k"))[0];
    expect(once).toBeDefined();
    k.c.goruntuHatasi = { tur: "TaninmayanLambda", kac: 99 };
    await oyna(k, "k", 13); // kadans yeniden doldu
    const cagri1 = k.c.cagrilar.filter((c) => c.yontem === "goruntuAl").length;
    await oyna(k, "k", 30);
    const cagri2 = k.c.cagrilar.filter((c) => c.yontem === "goruntuAl").length;
    expect(cagri2).toBe(cagri1); // her tick'te yeniden denenmez
    expect((await k.depo.goruntuleriListele("k")).map((g) => g.goruntuKimligi)).toEqual([once?.goruntuKimligi]);
    expect((await k.depo.kosuOku("k"))?.goruntuDurdu?.tur).toBe("TaninmayanLambda");
    const tani = (await k.depo.taniOku()).filter((t) => t.tur === "goruntu_kalici_hata");
    expect(tani).toHaveLength(1);
    expect(tani[0]?.ayrinti.hata).toBe("TaninmayanLambda");
    await k.yazici.goruntuDenemesiniAc("k");
    k.c.goruntuHatasi = null;
    expect((await k.yazici.tick("k")).goruntu.durum).toBe("yazildi");
  });

  it("gecici_hata_sonraki_tickte_yinelenir_durdurmaz", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    k.c.goruntuHatasi = { tur: "GoruntuHazirDegil", kac: 2 };
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "hazir_degil" });
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "hazir_degil" });
    expect((await k.yazici.tick("k")).goruntu.durum).toBe("yazildi");
    expect((await k.depo.kosuOku("k"))?.goruntuDurdu).toBeNull();
    expect((await k.depo.taniOku()).length).toBe(0);
  });

  it("bilinmeyen_hata_ust_uste_uc_kez_olursa_durdurur", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    k.c.goruntuHatasi = { tur: "RuntimeError", kac: 99 };
    for (let i = 0; i < 2; i++) expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "hata", tur: "RuntimeError" });
    await k.yazici.tick("k");
    expect((await k.depo.kosuOku("k"))?.goruntuDurdu).toBeNull(); // kalici degil
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "durdu", tur: "ardisik_hata" });
    // yeni oturum (yeni yazici): deneme yeniden acik
    const yeni = new KosuYazici({ depo: k.depo, cekirdek: k.c, zaman: () => 1000 });
    k.c.goruntuHatasi = null;
    expect((await yeni.tick("k")).goruntu.durum).toBe("yazildi");
  });

  it("tutarsiz_cekirdek_sonucu_yazilmaz", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    k.c.tutarsizKimlik = true;
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "tutarsiz" });
    expect(await k.depo.parcaSayisi()).toBe(0);
    expect((await k.depo.taniOku()).some((t) => t.tur === "goruntu_tutarsiz")).toBe(true);
    k.c.tutarsizKimlik = false;
    for (let i = 0; i < 13; i++) k.c.tick("k");
    // parca sayisi uyusmazligi: sink az parca verir
    const asil = k.c.goruntuAl.bind(k.c);
    k.c.goruntuAl = async (id, sink) => asil(id, (p) => void (p.length > 9999 && sink(p)));
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "tutarsiz" });
  });
});

describe("yazim hatasi ve kota", () => {
  it("yazim_hatasinda_onceki_goruntu_saglam_tani_kaydi", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    await oyna(k, "k", 13);
    const once = (await k.depo.goruntuleriListele("k")).map((g) => g.goruntuKimligi);
    const asil = k.c.goruntuAl.bind(k.c);
    k.c.goruntuAl = async (id, sink) => {
      const r = await asil(id, sink);
      (r.yonetici.overrides as Record<string, unknown>).islev = () => 1; // sema uyar (dict) ama yapisal klonlanamaz
      return r;
    };
    await oyna(k, "k", 13);
    expect((await k.depo.goruntuleriListele("k")).map((g) => g.goruntuKimligi)).toEqual(once);
    expect(await k.depo.parcaSayisi()).toBe(3);
    expect((await k.depo.taniOku()).some((t) => t.tur === "goruntu_yazim_hatasi")).toBe(true);
  });

  it("quota_exceeded_en_eski_kosunun_goruntuleri_silinip_yazim_yinelenir", async () => {
    const depo = await yeniDepo(yeniIdb(), () => 1000);
    const kota = new KotaYoneticisi({ depo, storage: null });
    const c = new SahteCekirdek();
    const yazici = new KosuYazici({ depo, cekirdek: c, kota, zaman: () => 1000 });
    for (const id of ["eski", "yeni"]) {
      await kosuyuKur(c, id, 13);
      await yazici.kosuBaslat(id);
      await yazici.tick(id);
      await new Promise((r) => setTimeout(r, 2)); // olusturma sirasi
    }
    expect((await depo.goruntuleriListele("eski")).length).toBe(1);
    // yeni kosuda ikinci goruntu: depo ilk yazimda QuotaExceededError verir
    for (let i = 0; i < 13; i++) c.tick("yeni");
    let denendi = 0;
    const asil = depo.goruntuYaz.bind(depo);
    depo.goruntuYaz = async (u, p) => {
      if (denendi++ === 0) throw Object.assign(new Error("dolu"), { name: "QuotaExceededError" });
      return asil(u, p);
    };
    const s = await yazici.tick("yeni");
    expect(s.goruntu.durum).toBe("yazildi");
    expect(denendi).toBe(2);
    expect(await depo.goruntuleriListele("eski")).toEqual([]);
    expect((await depo.goruntuleriListele("yeni")).length).toBe(2);
  });

  it("kota_dolu_ve_bosaltilacak_baska_kosu_yoksa_yazim_hatasi_kota", async () => {
    const depo = await yeniDepo(yeniIdb(), () => 1000);
    const kota = new KotaYoneticisi({ depo, storage: null });
    const c = new SahteCekirdek();
    const yazici = new KosuYazici({ depo, cekirdek: c, kota, zaman: () => 1000 });
    await kosuyuKur(c, "k", 13);
    await yazici.kosuBaslat("k");
    depo.goruntuYaz = async () => {
      throw Object.assign(new Error("dolu"), { name: "QuotaExceededError" });
    };
    expect((await yazici.tick("k")).goruntu).toEqual({ durum: "yazim_hatasi", tur: "kota" });
  });
});

describe("gunluk tutarliligi ve kilit", () => {
  it("tick_arasinda_kabul_edilen_karar_goruntuyle_ayni_anda_depoda_olur", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    const asil = k.c.goruntuAl.bind(k.c);
    k.c.goruntuAl = async (id, sink) => {
      k.c.gunlugeEkle(id, karar(1, 13)); // gunlukIc'ten sonra, goruntu alinirken kabul edilen karar
      return asil(id, sink);
    };
    const s = await k.yazici.tick("k");
    expect(s.goruntu.durum).toBe("yazildi");
    expect((await k.depo.gunlukOku("k")).map((g) => g.sira)).toEqual([1]);
    expect((await k.depo.goruntuleriListele("k"))[0]?.gunlukSira).toBe(1);
  });

  it("gunluk_alinamazsa_goruntu_yazilmaz_tutarsiz", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    const asil = k.c.goruntuAl.bind(k.c);
    k.c.goruntuAl = async (id, sink) => {
      k.c.gunlugeEkle(id, karar(1, 13));
      return asil(id, sink);
    };
    k.c.gunlukAl = async () => [];
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "tutarsiz" });
    expect(await k.depo.goruntuleriListele("k")).toEqual([]);
    expect((await k.depo.taniOku()).some((t) => t.tur === "goruntu_gunluk_eksik")).toBe(true);
  });

  it("durdu_sonrasi_kilitli_gunluk_kes_ile_acilir_yeni_kararlar_cakismadan_yazilir", async () => {
    const k = await kurulum();
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    for (const g of [karar(1, 1), karar(2, 2), karar(3, 3), karar(4, 4), karar(5, 5)]) k.c.gunlugeEkle("k", g);
    await k.yazici.gunlukSenkronla("k");
    k.yazici.kilitle("k");
    expect((await k.yazici.tick("k")).goruntu).toEqual({ durum: "kilitli" });
    expect(await k.yazici.gunlukSenkronla("k", 0)).toEqual({ eklenen: 0, cakisan: [] });
    expect(await k.yazici.goruntuAl("k")).toEqual({ durum: "kilitli" });
    expect(await k.yazici.gunlukKes("k", 3)).toBe(2);
    expect((await k.depo.gunlukOku("k")).map((g) => g.sira)).toEqual([1, 2, 3]);
    expect((await k.depo.kosuOku("k"))?.gunlukSira).toBe(3);
    (k.c.kosular.get("k") as { gunluk: unknown[] }).gunluk = [karar(1, 1), karar(2, 2), karar(3, 3), karar(4, 9, { yeni: true })];
    const s = await k.yazici.tick("k");
    expect(s.gunluk).toEqual({ eklenen: 1, cakisan: [] });
    expect((await k.depo.gunlukOku("k"))[3]).toEqual(karar(4, 9, { yeni: true }));
  });
});

describe("paket yazimi kotasi", () => {
  it("haftalarOlayi_kota_dolunca_en_eski_kosunun_goruntuleri_silinir_bir_kez_yinelenir", async () => {
    const depo = await yeniDepo(yeniIdb(), () => 1000);
    const kota = new KotaYoneticisi({ depo, storage: null });
    const c = new SahteCekirdek();
    const yazici = new KosuYazici({ depo, cekirdek: c, kota, zaman: () => 1000 });
    for (const id of ["eski", "yeni"]) {
      await kosuyuKur(c, id, 13);
      await yazici.kosuBaslat(id);
      await yazici.tick(id);
      await new Promise((r) => setTimeout(r, 2));
    }
    let n = 0;
    const asil = depo.haftalarYaz.bind(depo);
    depo.haftalarYaz = async (id, p) => {
      if (n++ === 0) throw Object.assign(new Error("dolu"), { name: "QuotaExceededError" });
      return asil(id, p);
    };
    await yazici.haftaOlayi("yeni", { week: 14 });
    expect(n).toBe(2);
    expect(await depo.goruntuleriListele("eski")).toEqual([]);
    expect(await depo.paketOku("yeni", 14)).toEqual({ week: 14 });
    // yine dolu ve bosaltilacak bir sey yoksa hata yukari cikar
    depo.haftalarYaz = async () => {
      throw Object.assign(new Error("dolu"), { name: "QuotaExceededError" });
    };
    await expect(yazici.haftaOlayi("yeni", { week: 15 })).rejects.toMatchObject({ name: "QuotaExceededError" });
  });
});

describe("52 hafta hatirlatmasi", () => {
  it("52_haftada_bir_olay_disa_aktarinca_sifirlanir", async () => {
    const olaylar: HatirlatmaOlayi[] = [];
    const k = await kurulum({ hatirlatma: (o) => olaylar.push(o) });
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    for (let h = 1; h <= 51; h++) await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar).toEqual([]);
    await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar).toEqual([{ kosuId: "k", hafta: 52 }]);
    for (let h = 53; h <= 103; h++) await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar).toHaveLength(1);
    await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar.map((o) => o.hafta)).toEqual([52, 104]);
    // ayni haftanin tekrar gelmesi (devam sonrasi yeniden oynatma) ikinci olay uretmez
    await k.yazici.haftaOlayi("k", { week: 104 });
    expect(olaylar).toHaveLength(2);
  });

  it("disa_aktarim_sayaci_ilerletir", async () => {
    const { disaAktar } = await import("@/oyun/tarayici/kayit/disaAktar");
    const olaylar: HatirlatmaOlayi[] = [];
    const k = await kurulum({ hatirlatma: (o) => olaylar.push(o) });
    k.c.kosuYarat("k");
    await k.yazici.kosuBaslat("k");
    for (let h = 1; h <= 40; h++) await k.yazici.haftaOlayi("k", k.c.tick("k"));
    await disaAktar(k.depo, "k");
    for (let h = 41; h <= 91; h++) await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar).toEqual([]); // 40'tan 91'e: 51 hafta
    await k.yazici.haftaOlayi("k", k.c.tick("k"));
    expect(olaylar).toEqual([{ kosuId: "k", hafta: 92 }]);
  });
});

describe("serilestirme", () => {
  it("ayni_kosunun_tick_ve_senkronu_sirayla_calisir", async () => {
    const k = await kurulum();
    await kosuyuKur(k.c, "k", 13);
    await k.yazici.kosuBaslat("k");
    const sonuclar = await Promise.all([k.yazici.tick("k"), k.yazici.tick("k")]);
    // ikinci tick, birincinin yazdigi goruntuyu gormez (cekirdek kadansi sifirladi): tek goruntu yazilir
    expect(sonuclar.map((s) => s.goruntu.durum)).toEqual(["yazildi", "gerekmiyor"]);
    expect((await k.depo.goruntuleriListele("k")).length).toBe(1);
  });
});

void KayitDeposu;
void CekirdekHatasi;
