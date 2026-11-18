// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DOSYA_BICIMI, DOSYA_SURUMU, IceAktarmaHatasi, YASAK_ANAHTARLAR, disaAktar, dosyaMetni, dosyayiDogrula, iceAktar, iceAktarVeOynat } from "@/oyun/tarayici/kayit/disaAktar";
import { KosuYazici } from "@/oyun/tarayici/kayit/yazici";
import { SahteCekirdek, ANAHTAR, karar, sart, tarifOrnek, yeniDepo, yeniIdb } from "./yardimci";

async function kaynak(hafta = 28) {
  const idb = yeniIdb();
  const depo = await yeniDepo(idb, () => 5);
  const c = new SahteCekirdek();
  const yazici = new KosuYazici({ depo, cekirdek: c, zaman: () => 5 });
  c.kosuYarat("k", tarifOrnek({ config: { oyun: "x", nested: { a: [1, 2] } }, takvim: [{ week: 2, patch: { p: 1 } }], dunya_kodu: "D1", oyuncu: "oyuncu1" }));
  await yazici.kosuBaslat("k");
  for (let h = 1; h <= hafta; h++) {
    if (h === 3) c.gunlugeEkle("k", karar(1, 2));
    if (h === 11) c.gunlugeEkle("k", sart(2, 10));
    await yazici.haftaOlayi("k", c.tick("k"));
    await yazici.tick("k");
  }
  return { idb, depo, c, yazici };
}

let sayac = 0;
const kimlik = () => "ice" + ++sayac;

function gecerliDosya() {
  return {
    bicim: DOSYA_BICIMI,
    surum: DOSYA_SURUMU,
    olusturma: 1,
    modelAnahtari: ANAHTAR,
    kosu: { tarif: tarifOrnek(), ebeveyn: null, yayimlanan: 10 },
    gunluk: [karar(1, 2), sart(2, 5)],
  };
}

describe("disa aktarma", () => {
  it("dosya_tarif_gunluk_meta_ve_model_anahtari_icerir_goruntu_icermez", async () => {
    const k = await kaynak();
    expect((await k.depo.goruntuleriListele("k")).length).toBe(2);
    const d = await disaAktar(k.depo, "k");
    expect(Object.keys(d).sort()).toEqual(["bicim", "gunluk", "kosu", "modelAnahtari", "olusturma", "surum"]);
    expect(d.kosu.yayimlanan).toBe(28);
    expect(d.modelAnahtari).toEqual(k.c.anahtar);
    expect(d.gunluk).toEqual([karar(1, 2), sart(2, 10)]);
    const metin = dosyaMetni(d);
    for (const a of YASAK_ANAHTARLAR) expect(metin).not.toContain('"' + a + '"');
    expect(metin).not.toContain("released"); // yonetici durumu yok
    expect(d.paketler).toBeUndefined();
  });

  it("paketler_istenirse_gorsellestirme_icin_eklenir", async () => {
    const k = await kaynak(6);
    const d = await disaAktar(k.depo, "k", { paketler: true });
    expect(d.paketler?.map((p) => p.week)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("disa_aktarma_52_hafta_sayacini_sifirlar", async () => {
    const k = await kaynak(40);
    await disaAktar(k.depo, "k");
    expect((await k.depo.kosuOku("k"))?.sonDisaAktarim).toBe(40);
  });

  it("bilinmeyen_kosu_hata", async () => {
    const k = await kaynak(2);
    await expect(disaAktar(k.depo, "yok")).rejects.toMatchObject({ kod: "kosu_yok" });
  });
});

describe("ice aktarma atomikligi ve kimlik", () => {
  it("kimlik_cakisirsa_yeni_kimlik_denenir_var_olan_kosu_degismez", async () => {
    const k = await kaynak(6);
    const metin = dosyaMetni(await disaAktar(k.depo, "k"));
    const onceki = await k.depo.gunlukOku("k");
    const kimlikler = ["k", "k", "yeni1"];
    const s = await iceAktar(k.depo, metin, { kimlikUret: () => kimlikler.shift() as string });
    expect(s.kosuId).toBe("yeni1");
    expect(await k.depo.gunlukOku("k")).toEqual(onceki);
    expect((await k.depo.kosuOku("k"))?.kaynak).toBe("yerel");
  });

  it("surekli_cakisma_hata_ve_yazim_yok", async () => {
    const k = await kaynak(3);
    const metin = dosyaMetni(await disaAktar(k.depo, "k"));
    await expect(iceAktar(k.depo, metin, { kimlikUret: () => "k" })).rejects.toMatchObject({ kod: "kimlik_uretilemedi" });
  });

  it("yazim_yarida_kalirsa_bos_kayit_kalmaz_tek_islem", async () => {
    const depo = await yeniDepo(yeniIdb());
    const d = gecerliDosya();
    const orijinal = depo.iceAktarimYaz.bind(depo);
    depo.iceAktarimYaz = async (kayit, gunluk, paketler, y) => {
      (gunluk[1] as unknown as Record<string, unknown>).islev = () => 1; // klonlanamaz
      return orijinal(kayit, gunluk, paketler, y);
    };
    await expect(iceAktar(depo, JSON.stringify(d), { kimlikUret: kimlik })).rejects.toBeDefined();
    expect(await depo.kosulariListele()).toEqual([]);
  });
});

describe("ice aktarma guvenligi", () => {
  it("gidis_donus_tarif_ve_gunluk_ayni_yeni_kosu_goruntusuz", async () => {
    const k = await kaynak();
    const metin = dosyaMetni(await disaAktar(k.depo, "k", { paketler: true }));
    const hedefDepo = await yeniDepo(yeniIdb());
    const s = await iceAktar(hedefDepo, metin, { kimlikUret: kimlik });
    expect(s.kosuId).not.toBe("k");
    expect(s.hedef).toBe(28);
    expect(s.paketSayisi).toBe(28);
    expect(s.kayit.kaynak).toBe("ice_aktarma");
    expect(s.kayit.tarif).toEqual((await k.depo.kosuOku("k"))?.tarif);
    expect(await hedefDepo.gunlukOku(s.kosuId)).toEqual(await k.depo.gunlukOku("k"));
    expect(await hedefDepo.goruntuleriListele(s.kosuId)).toEqual([]);
    expect(await hedefDepo.parcaSayisi()).toBe(0);
    expect(await hedefDepo.paketSayisi(s.kosuId)).toBe(28);
    // yeniden disa aktarinca ayni icerik
    const tekrar = await disaAktar(hedefDepo, s.kosuId);
    expect(tekrar.gunluk).toEqual((await disaAktar(k.depo, "k")).gunluk);
    expect(tekrar.kosu.tarif).toEqual((await disaAktar(k.depo, "k")).kosu.tarif);
  });

  it("goruntu_iceren_dosya_reddedilir_her_yapisal_duzeyde", () => {
    const hedefler: [string, (d: Record<string, unknown>) => void][] = [
      ["kok", (d) => (d.goruntu = { parcalar: ["AAAA"], yonetici: {} })],
      ["kok_parcalar", (d) => (d.parcalar = ["AAAA"])],
      ["kok_yonetici", (d) => (d.yonetici = {})],
      ["kosu", (d) => ((d.kosu as Record<string, unknown>).goruntuler = [])],
      ["tarif", (d) => (((d.kosu as { tarif: Record<string, unknown> }).tarif).pickle = "gASV")],
      ["gunluk", (d) => ((d.gunluk as Record<string, unknown>[])[0]!.snapshot = "x")],
    ];
    for (const [ad, uygula] of hedefler) {
      const d = gecerliDosya() as unknown as Record<string, unknown>;
      uygula(d);
      expect(() => dosyayiDogrula(JSON.stringify(d)), ad).toThrowError(IceAktarmaHatasi);
      try {
        dosyayiDogrula(d);
      } catch (e) {
        expect((e as IceAktarmaHatasi).kod, ad).toBe("goruntu_iceriyor");
      }
    }
    expect(() => dosyayiDogrula(JSON.stringify(gecerliDosya()))).not.toThrow();
  });

  it("goruntulu_dosya_cekirdege_hicbir_sey_gondermeden_reddedilir_depoya_yazilmaz", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    const d = { ...gecerliDosya(), goruntu: { parcalar: ["AAAA"], yonetici: {} } };
    await expect(iceAktarVeOynat({ depo, cekirdek: c, kimlikUret: kimlik }, JSON.stringify(d))).rejects.toMatchObject({ kod: "goruntu_iceriyor" });
    expect(c.cagrilar).toEqual([]);
    expect(await depo.kosulariListele()).toEqual([]);
  });

  it("gecerli_dosya_tariften_oynat_ile_oynar_cekirdege_goruntu_parametresi_gitmez", async () => {
    const depo = await yeniDepo(yeniIdb());
    const c = new SahteCekirdek();
    const ilerleme: number[] = [];
    const { ice, akis } = await iceAktarVeOynat({ depo, cekirdek: c, kimlikUret: kimlik }, JSON.stringify(gecerliDosya()), { ilerleme: (h) => ilerleme.push(h) });
    expect(akis).toMatchObject({ sonuc: "tamam", hafta: 10, kaynak: "tarif" });
    expect(c.cagrilar.map((x) => x.yontem)).toEqual(["tariftenOynat"]);
    const t = c.cagrilar[0]?.girdi as Record<string, unknown>;
    expect(Object.keys(t).sort()).toEqual(["azami", "gunlukSiralari", "hedef", "kosuId", "tarif"]);
    expect(t.gunlukSiralari).toEqual([1, 2]);
    expect(t.kosuId).toBe(ice.kosuId);
    expect(ilerleme.length).toBe(10);
    expect((await depo.kosuOku(ice.kosuId))?.modelAnahtari).toEqual(ANAHTAR);
  });

  it("sema_ve_yapi_hatalari_reddedilir", () => {
    const hata = (f: (d: Record<string, unknown>) => void) => {
      const d = gecerliDosya() as unknown as Record<string, unknown>;
      f(d);
      try {
        dosyayiDogrula(JSON.stringify(d));
        return null;
      } catch (e) {
        return (e as IceAktarmaHatasi).kod;
      }
    };
    expect(hata((d) => (d.bicim = "baska"))).toBe("bicim_gecersiz");
    expect(hata((d) => (d.surum = 2))).toBe("surum_desteklenmiyor");
    expect(hata((d) => (d.modelAnahtari = { model_sha256: 1 }))).toBe("sema");
    expect(hata((d) => delete (d.kosu as Record<string, unknown>).tarif)).toBe("sema");
    expect(hata((d) => ((d.kosu as Record<string, unknown>).yayimlanan = -1))).toBe("sema");
    expect(hata((d) => ((d.kosu as Record<string, unknown>).yayimlanan = 1.5))).toBe("sema");
    expect(hata((d) => ((d.kosu as Record<string, unknown>).ebeveyn = ["a"]))).toBe("sema");
    expect(hata((d) => (d.gunluk = "x"))).toBe("sema");
    expect(hata((d) => ((d.gunluk as Record<string, unknown>[])[0]!.tur = "baska"))).toBe("sema");
    expect(hata((d) => ((d.gunluk as Record<string, unknown>[])[1]!.sira = 5))).toBe("gunluk_sira_bitisik_degil");
    expect(hata((d) => ((d.gunluk as Record<string, unknown>[])[0]!.dikis = -2))).toBe("sema");
    expect(hata((d) => ((d.gunluk as Record<string, unknown>[])[1]!.surum = "x"))).toBe("sema");
    expect(hata((d) => (d.paketler = [{ week: "x" }]))).toBe("paket_gecersiz");
    expect(hata((d) => (d.paketler = "x"))).toBe("sema");
    expect(hata((d) => (d.olusturma = "x"))).toBe("sema");
    expect(hata(() => undefined)).toBeNull();
  });

  it("bozuk_json_dev_dosya_proto_kirletme_asiri_derinlik_reddedilir", () => {
    expect(() => dosyayiDogrula("{")).toThrowError(IceAktarmaHatasi);
    expect(() => dosyayiDogrula("x".repeat(65 * 1024 * 1024))).toThrowError(expect.objectContaining({ kod: "cok_buyuk" }));
    const proto = '{"bicim":"daoliberal-kayit","surum":1,"olusturma":1,"modelAnahtari":{"model_sha256":"a","pyodide":null,"schema":2,"host_sema":1},"kosu":{"tarif":{"config":{"__proto__":{"x":1}},"takvim":[],"parent_id":null,"fork_week":null,"dunya_kodu":null,"oyuncu":null},"ebeveyn":null,"yayimlanan":1},"gunluk":[]}';
    expect(() => dosyayiDogrula(proto)).toThrowError(expect.objectContaining({ kod: "anahtar_yasak" }));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    let derin: unknown = {};
    for (let i = 0; i < 80; i++) derin = { a: derin };
    const d = gecerliDosya();
    (d.kosu.tarif as unknown as { config: unknown }).config = derin;
    expect(() => dosyayiDogrula(JSON.stringify(d))).toThrowError(expect.objectContaining({ kod: "cok_derin" }));
    expect(() => dosyayiDogrula(null)).toThrowError(IceAktarmaHatasi);
    expect(() => dosyayiDogrula([])).toThrowError(IceAktarmaHatasi);
  });

  it("sayilar_sonlu_olmali_nesne_girdisi_de_dogrulanir", () => {
    const d = gecerliDosya();
    (d.kosu.tarif.config as Record<string, unknown>).x = Infinity;
    expect(() => dosyayiDogrula(d)).toThrowError(expect.objectContaining({ kod: "sayi_gecersiz" }));
  });

  it("fazla_alanlar_kopyaya_alinmaz_yalniz_bilinen_alanlar", () => {
    const d = gecerliDosya() as unknown as { kosu: { tarif: Record<string, unknown> }; gunluk: Record<string, unknown>[]; ekstra?: unknown };
    d.kosu.tarif.casus = "x";
    d.gunluk[0]!.casus = "y";
    d.ekstra = 1;
    const t = dosyayiDogrula(d);
    expect(Object.keys(t.kosu.tarif).sort()).toEqual(["config", "dunya_kodu", "fork_week", "oyuncu", "parent_id", "takvim"]);
    expect(Object.keys(t.gunluk[0] as object).sort()).toEqual(["dikis", "karar", "sira", "tur"]);
    expect("ekstra" in t).toBe(false);
  });

  it("alinan_nesne_girdinin_kopyasidir_sonradan_degisiklik_etkilemez", () => {
    const d = gecerliDosya();
    const t = dosyayiDogrula(d);
    (d.kosu.tarif.config as Record<string, unknown>).oyun = "degisti";
    expect(t.kosu.tarif.config.oyun).toBe("deneme");
  });
});
