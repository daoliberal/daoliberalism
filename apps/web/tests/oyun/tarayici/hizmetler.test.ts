// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import { kayitKatmaniAc } from "@/oyun/tarayici/kayit/index";
import { AZAMI_DOSYA_KARAKTERI, dosyayiDogrula } from "@/oyun/tarayici/kayit/disaAktar";
import { kayitHizmetleri } from "@/oyun/tarayici/hizmetler";
import { SahteCekirdek, tarifOrnek, yeniIdb } from "./kayit/yardimci";

/** B8: arayuzun kayit hizmetleri (depolama durumu, kayit listesi, disa/ice aktarma, silme). Arayuz bunlari yalniz bu yuzden gorur. */
async function kur(depolama?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean>; estimate?: () => Promise<{ usage?: number; quota?: number }> }) {
  const idb = yeniIdb();
  const cekirdek = new SahteCekirdek();
  const k = await kayitKatmaniAc({ idb, cekirdek, storage: depolama ?? null, zaman: () => 1000 });
  cekirdek.kosuYarat("kosu-a", tarifOrnek({ config: { oyun: "deneme", name: "Ilk oyun" } as never }));
  await k.yazici.kosuBaslat("kosu-a");
  for (let h = 1; h <= 4; h++) {
    await k.yazici.haftaOlayi("kosu-a", cekirdek.tick("kosu-a"));
    await k.yazici.tick("kosu-a");
  }
  let n = 0;
  const hizmet = kayitHizmetleri(k, { kimlikUret: () => `ice-${++n}` });
  return { k, cekirdek, hizmet, idb };
}

describe("kayitHizmetleri.kosular", () => {
  it("kayitli_kosulari_ad_hafta_ve_disa_aktarim_bilgisiyle_listeler_en_yeni_ustte", async () => {
    const { hizmet } = await kur();
    const l = await hizmet.kosular();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kosuId: "kosu-a", hafta: 4, ad: "Ilk oyun", kaynak: "yerel" });
  });

  it("adi_olmayan_kosuda_kisaltilmis_kimlik_kullanilir", async () => {
    const { hizmet, k, cekirdek } = await kur();
    cekirdek.kosuYarat("kosu-uzun-kimlik-9999", tarifOrnek());
    await k.yazici.kosuBaslat("kosu-uzun-kimlik-9999");
    const l = await hizmet.kosular();
    expect(l.find((x) => x.kosuId === "kosu-uzun-kimlik-9999")?.ad).toBe("9999");
  });
});

describe("kayitHizmetleri.depolama", () => {
  it("kullanim_kota_oran_ve_persist_sonucunu_dondurur_esik_asilinca_uyari_isaretler", async () => {
    const { hizmet, k } = await kur({ persist: async () => false, persisted: async () => false, estimate: async () => ({ usage: 90, quota: 100 }) });
    await k.kota.kalicilikIste();
    const d = await hizmet.depolama();
    expect(d.olcum).toEqual({ kullanim: 90, kota: 100, oran: 0.9 });
    expect(d.kotaUyarisi).toBe(true);
    expect(d.kalicilik?.durum).toBe("verilmedi");
  });

  it("esik_altinda_uyari_yok_ve_olcum_yoksa_olcum_null", async () => {
    const a = await kur({ estimate: async () => ({ usage: 10, quota: 100 }) });
    expect((await a.hizmet.depolama()).kotaUyarisi).toBe(false);
    const b = await kur();
    const d = await b.hizmet.depolama();
    expect(d.olcum).toBeNull();
    expect(d.kotaUyarisi).toBe(false);
    expect(d.kalicilik).toBeNull();
  });
});

describe("kayitHizmetleri.disaAktar / iceAktar", () => {
  it("disa_aktarilan_dosya_dogrulanir_ve_ad_kosu_adindan_uretilir", async () => {
    const { hizmet } = await kur();
    const d = await hizmet.disaAktar("kosu-a");
    expect(d.ad).toMatch(/^daoliberal-kayit-.*\.json$/);
    expect(d.ad).not.toMatch(/[ /\\]/);
    expect(dosyayiDogrula(d.metin).kosu.yayimlanan).toBe(4);
  });

  it("ice_aktarma_yeni_kimlikle_kaydeder_ve_haftayi_dondurur", async () => {
    const a = await kur();
    const metin = (await a.hizmet.disaAktar("kosu-a")).metin;
    const b = await kur();
    const r = await b.hizmet.iceAktar({ size: metin.length, text: async () => metin });
    expect(r).toEqual({ kosuId: "ice-1", hafta: 4, tur: "kurucu" });
    expect((await b.hizmet.kosular()).map((x) => x.kosuId).sort()).toEqual(["ice-1", "kosu-a"]);
  });

  it("dosya_boyutu_asiliyorsa_metin_HIC_okunmadan_reddedilir", async () => {
    const { hizmet } = await kur();
    const oku = vi.fn(async () => "{}");
    await expect(hizmet.iceAktar({ size: AZAMI_DOSYA_KARAKTERI + 1, text: oku })).rejects.toMatchObject({ kod: "cok_buyuk" });
    expect(oku).not.toHaveBeenCalled();
  });

  it("gecersiz_ve_goruntu_iceren_dosya_anlasilir_kodla_reddedilir", async () => {
    const { hizmet } = await kur();
    await expect(hizmet.iceAktar({ size: 3, text: async () => "xyz" })).rejects.toMatchObject({ kod: "json_gecersiz" });
    const goruntulu = JSON.stringify({ bicim: "daoliberal-kayit", surum: 1, olusturma: 1, goruntu: "AAAA" });
    await expect(hizmet.iceAktar({ size: goruntulu.length, text: async () => goruntulu })).rejects.toMatchObject({ kod: "goruntu_iceriyor" });
  });
});

describe("kayitHizmetleri.sil", () => {
  it("kaydi_ve_cekirdek_kosusunu_siler_cekirdekte_yoksa_da_kayit_silinir", async () => {
    const { hizmet, cekirdek } = await kur();
    const sil = vi.spyOn(cekirdek, "kosuSil").mockRejectedValue(new CekirdekHatasi("UnknownRun", "kosu_yok"));
    await hizmet.sil("kosu-a");
    expect(sil).toHaveBeenCalled();
    expect(await hizmet.kosular()).toEqual([]);
  });
});
