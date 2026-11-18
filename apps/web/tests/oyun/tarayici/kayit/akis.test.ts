// @vitest-environment node
import { describe, expect, it } from "vitest";
import { azamiHaftaSec, DevamAkisi, enYakinGoruntu } from "@/oyun/tarayici/kayit/akis";
import { CekirdekHatasi, type DevamGirdisi } from "@/oyun/tarayici/kayit/cekirdek";
import { tahminiOynatma } from "@/oyun/tarayici/kayit/siniflandirma";
import { KosuYazici } from "@/oyun/tarayici/kayit/yazici";
import { SahteCekirdek, birlestir, karar, sart, tarifOrnek, yeniDepo, yeniIdb } from "./yardimci";

interface Oturum {
  idb: IDBFactory;
  c: SahteCekirdek;
  depo: Awaited<ReturnType<typeof yeniDepo>>;
  yazici: KosuYazici;
  akis: DevamAkisi;
  chunklar: Uint8Array[][];
}

async function oturum(idb = yeniIdb(), c = new SahteCekirdek()): Promise<Oturum> {
  const depo = await yeniDepo(idb, () => 1000);
  const yazici = new KosuYazici({ depo, cekirdek: c, zaman: () => 1000 });
  const akis = new DevamAkisi({ depo, cekirdek: c, yazici, zaman: () => 1000 });
  const chunklar: Uint8Array[][] = [];
  const asil = c.goruntuAl.bind(c);
  c.goruntuAl = async (id, sink) => {
    const bu: Uint8Array[] = [];
    chunklar.push(bu);
    return asil(id, (p) => {
      bu.push(p.slice());
      sink(p);
    });
  };
  return { idb, c, depo, yazici, akis, chunklar };
}

/** `hafta` hafta oynanir; `gunluk[h]` o hafta eklenecek girisler (hafta sonundan once). */
async function oyna(o: Oturum, id: string, hafta: number, gunluk: Record<number, ReturnType<typeof karar>[]> = {}): Promise<void> {
  if (!o.c.kosular.has(id)) {
    o.c.kosuYarat(id);
    await o.yazici.kosuBaslat(id);
  }
  const bas = (o.c.kosular.get(id) as { released: number }).released;
  for (let h = bas + 1; h <= hafta; h++) {
    for (const g of gunluk[h] ?? []) o.c.gunlugeEkle(id, g);
    await o.yazici.haftaOlayi(id, o.c.tick(id));
    await o.yazici.tick(id);
  }
}

const GUNLUK = { 3: [karar(1, 2)], 11: [karar(2, 10)], 21: [karar(3, 20)] };

async function yeniOturumAyniDepo(onceki: Oturum, c = new SahteCekirdek()): Promise<Oturum> {
  onceki.depo.kapat();
  return oturum(onceki.idb, c);
}

describe("en yakin goruntu ve 12 hafta siniri", () => {
  it("enYakinGoruntu_hedefi_asmayan_en_yeni_yayimlanani_secer", () => {
    const g = (y: number, h = y) => ({ yayimlanan: y, hafta: h, zaman: 0 }) as never;
    expect(enYakinGoruntu([g(13), g(26)], 30)).toMatchObject({ yayimlanan: 26 });
    expect(enYakinGoruntu([g(13), g(26)], 25)).toMatchObject({ yayimlanan: 13 });
    expect(enYakinGoruntu([g(13), g(26)], 12)).toBeNull();
    expect(enYakinGoruntu([g(26, 28)], 26, { dal: true })).toBeNull(); // host > dal haftasi
    expect(enYakinGoruntu([g(26, 28)], 26)).not.toBeNull();
  });

  it("azamiHaftaSec_12_normal_26ya_dek_genisler_sonra_izin_yok", () => {
    expect(azamiHaftaSec(12)).toEqual({ izin: true, azami: 12, genisletilmis: false });
    expect(azamiHaftaSec(13)).toEqual({ izin: true, azami: 13, genisletilmis: true });
    expect(azamiHaftaSec(26)).toEqual({ izin: true, azami: 26, genisletilmis: true });
    expect(azamiHaftaSec(27).izin).toBe(false);
  });

  it("devam_en_yakin_goruntuyu_paket_penceresi_ve_tam_gunlukle_yukler", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 30, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    const ilerleme: number[] = [];
    const s = await o2.akis.devamEt("k", { ilerleme: (h) => ilerleme.push(h) });
    expect(s).toMatchObject({ sonuc: "tamam", kosuId: "k", hafta: 30, uygulanan: 4, kaynak: "goruntu", goruntuHaftasi: 26, genisletilmis: false });
    const c = o2.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as Record<string, unknown>;
    expect(c.paketHaftalari).toEqual([23, 24, 25, 26]); // son <= 4 yayimlanmis hafta, goruntu haftasina dek
    expect(c.gunlukSiralari).toEqual([1, 2, 3]); // cekirdek sira > gunluk_sira olani kendisi secer
    expect(c.azami).toBe(12);
    expect(c.kosuId).toBeNull();
    expect(ilerleme).toEqual([27, 28, 29, 30]);
  });

  it("hedef_ilk_goruntuden_once_ise_eski_goruntu_secilir", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 30);
    const o2 = await yeniOturumAyniDepo(o1);
    const s = await o2.akis.devamEt("k", { hedef: 20 });
    expect(s).toMatchObject({ sonuc: "tamam", hafta: 20, goruntuHaftasi: 13, uygulanan: 7 });
  });

  it("12_hafta_siniri_yayimlanandan_olculur_host_ileride_olsa_da", async () => {
    const o = await oturum();
    o.c.kosuYarat("k");
    await o.yazici.kosuBaslat("k");
    (o.c.kosular.get("k") as { onde: number }).onde = 2; // Kurucu: host yayimdan ileride
    await oyna(o, "k", 13);
    const g = (await o.depo.goruntuleriListele("k"))[0];
    expect(g).toMatchObject({ yayimlanan: 13, hafta: 15 });
    const o2 = await yeniOturumAyniDepo(o);
    // hedef = yayimlanan + 12: host'tan olculseydi 10 olurdu; yayimlanandan 12 -> genisletme yok
    const s = await o2.akis.devamEt("k", { hedef: 25 });
    expect(s).toMatchObject({ sonuc: "tamam", genisletilmis: false });
    expect((o2.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as { azami: number }).azami).toBe(12);
  });

  it("12_ile_26_arasi_bosluk_azami_genisler_26dan_fazlasi_tariften_gerek", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 13);
    const o2 = await yeniOturumAyniDepo(o1);
    expect(await o2.akis.devamEt("k", { hedef: 30 })).toMatchObject({ sonuc: "tamam", genisletilmis: true, hafta: 30 });
    expect((o2.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as { azami: number }).azami).toBe(17);
    const o3 = await yeniOturumAyniDepo(o2);
    expect(await o3.akis.devamEt("k", { hedef: 40 })).toEqual({ sonuc: "tariften_gerek", neden: "goruntu_cok_eski", hedef: 40, tahmini: tahminiOynatma(40) });
  });

  it("goruntu_yoksa_tariften_gerek_sessiz_oynatma_yok", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 5);
    const o2 = await yeniOturumAyniDepo(o1);
    expect(await o2.akis.devamEt("k")).toEqual({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 5, tahmini: tahminiOynatma(5) });
    expect(o2.c.cagrilar).toEqual([]);
    expect(await o2.akis.devamEt("yok")).toMatchObject({ sonuc: "hata", tur: "kosu_yok" });
  });

  it("depo_kapat_ac_ayni_goruntu_gunluk_paket_cekirdege_bayt_bayt_ayni_gider", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const verilen = o1.chunklar.at(-1) as Uint8Array[];
    const o2 = await yeniOturumAyniDepo(o1);
    let alinan: DevamGirdisi | null = null;
    const asil = o2.c.devam.bind(o2.c);
    o2.c.devam = async (g) => {
      alinan = g;
      return asil(g);
    };
    await o2.akis.devamEt("k");
    const g = alinan as unknown as DevamGirdisi;
    expect(g.goruntu.parcalar.length).toBe(verilen.length);
    g.goruntu.parcalar.forEach((p, i) => expect(Array.from(new Uint8Array(p))).toEqual(Array.from(verilen[i] as Uint8Array)));
    expect(Array.from(await birlestir(g.goruntu.parcalar))).toEqual(Array.from(await birlestir(verilen.map((v) => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer))));
    expect(g.gunluk).toEqual([karar(1, 2), karar(2, 10), karar(3, 20)]);
    expect(g.paketler?.map((p) => p.deger)).toEqual([23 * 7, 24 * 7, 25 * 7, 26 * 7]);
    expect(g.goruntu.yonetici.released).toBe(26);
  });

  it("devam_sonrasi_oynatilan_gunluk_cift_kayit_uretmez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    await o2.akis.devamEt("k", { hedef: 28 });
    await o2.akis.devamEt("k", { hedef: 28 }).catch(() => undefined);
    expect(await o2.depo.gunlukOku("k")).toEqual([karar(1, 2), karar(2, 10), karar(3, 20)]);
    expect((await o2.depo.taniOku()).filter((t) => t.tur === "gunluk_cakisma")).toEqual([]);
  });

  it("reddedilen_karar_durdu_sonucu_ve_kosu_silme_secenegi", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    // goruntu (hf26) sonrasi giris: sira 4, dikis 27 (devamda oynatilir)
    o1.c.gunlugeEkle("k", karar(4, 27));
    await o1.yazici.gunlukSenkronla("k");
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.reddet = 4;
    const s = await o2.akis.devamEt("k", { hedef: 28 });
    expect(s).toMatchObject({ sonuc: "durdu", durum: "reddedildi", kosuId: "k", kosuSilinebilir: true });
    await o2.akis.kosuSil("k");
    expect(o2.c.kosular.has("k")).toBe(false);
    expect(await o2.depo.kosuOku("k")).not.toBeNull(); // kayit korunur
    await o2.akis.kosuSil("k", { kayitlaBirlikte: true });
    expect(await o2.depo.kosuOku("k")).toBeNull();
  });
});

describe("ikinci goruntu geri dususu", () => {
  it("en_yeni_bozuksa_ikinci_goruntuden_devam_edilir", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    const asil = o2.c.devam.bind(o2.c);
    o2.c.devam = async (g) => {
      if (g.goruntu.yonetici.released === 26) throw new CekirdekHatasi("UyumsuzGoruntu", "x", { bozuk: ["EOFError", "kesik"] });
      return asil(g);
    };
    const s = await o2.akis.devamEt("k");
    expect(s).toMatchObject({ sonuc: "tamam", hafta: 28, goruntuHaftasi: 13, genisletilmis: true });
    const t = (await o2.depo.taniOku()).filter((x) => x.tur === "uyumsuz_goruntu");
    expect(t).toHaveLength(1);
    expect(t[0]?.ayrinti).toMatchObject({ alt: "bozuk", goruntuHaftasi: 26 });
  });

  it("en_yeni_eksik_parcali_ikinci_saglamsa_ondan_devam", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    const asil = o2.depo.goruntuParcalari.bind(o2.depo);
    o2.depo.goruntuParcalari = async (id, kimlik) => ((await o2.depo.goruntuleriListele(id))[0]?.goruntuKimligi === kimlik ? null : asil(id, kimlik));
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "tamam", goruntuHaftasi: 13 });
  });

  it("ikisi_de_bozuksa_uyumsuz_bozuk_sessiz_tariften_yok", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.devam = async () => {
      throw new CekirdekHatasi("GuvensizGoruntu", "x", { guvensiz: ["os", "system"] });
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "uyumsuz", tur: "guvensiz" });
    expect(o2.c.cagrilar.some((x) => x.yontem === "tariftenOynat")).toBe(false);
  });

  it("surum_farkinda_ikinci_goruntu_denenmez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.devam = async () => {
      throw new CekirdekHatasi("UyumsuzGoruntu", "x", { schema: [1, 2] });
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "uyumsuz", tur: "surum" });
    expect((await o2.depo.taniOku()).filter((x) => x.tur === "uyumsuz_goruntu")).toHaveLength(1);
  });

  it("eslesmeyen_goruntu_yonetici_value_error_bozuk_akisi", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    const asil = o2.c.devam.bind(o2.c);
    o2.c.devam = async (g) => {
      if (g.goruntu.yonetici.released === 26) throw new CekirdekHatasi("ValueError", "görüntü ile yönetici durumu eşleşmiyor (kimlik/hafta/hedef)");
      return asil(g);
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "tamam", goruntuHaftasi: 13 });
  });

  it("dal_icin_de_ikinci_goruntu_denenir", async () => {
    const o = await oturum();
    await oyna(o, "k", 30, GUNLUK);
    const asil = o.c.devam.bind(o.c);
    o.c.devam = async (g) => {
      if (g.goruntu.yonetici.released === 26) throw new CekirdekHatasi("UyumsuzGoruntu", "x", { bozuk: ["EOFError", "x"] });
      return asil(g);
    };
    expect(await o.akis.dalOlustur({ kosuId: "k", hafta: 28, yeniKosuId: "d", ilkGoruntu: false })).toMatchObject({ sonuc: "tamam", goruntuHaftasi: 13 });
  });
});

describe("dal ve silme ayrintilari", () => {
  it("dal_kaydi_hatirlatma_sayacini_ebeveynden_devralir_ilk_pakette_hatirlatma_yok", async () => {
    const o = await oturum();
    await oyna(o, "k", 60);
    await o.depo.kosuGuncelle("k", (x) => ({ ...x, sonDisaAktarim: 55, sonHatirlatma: 55 }));
    await o.akis.dalOlustur({ kosuId: "k", hafta: 58, yeniKosuId: "d", ilkGoruntu: false });
    const d = await o.depo.kosuOku("d");
    expect(d).toMatchObject({ sonDisaAktarim: 55, sonHatirlatma: 55 });
    const s = await o.depo.haftalarYaz("d", [{ week: 59 }]);
    expect(s.hatirlatma).toBe(false);
  });

  it("kayitlaBirlikte_cekirdekte_yok_404_olsa_da_depo_silinir_aksi_halde_hata_yukari", async () => {
    const o = await oturum();
    await oyna(o, "k", 5);
    o.c.kosuSil = async () => {
      throw new CekirdekHatasi("UnknownRun", "kosu_yok");
    };
    await expect(o.akis.kosuSil("k")).rejects.toThrow("kosu_yok");
    expect(await o.depo.kosuOku("k")).not.toBeNull();
    await o.akis.kosuSil("k", { kayitlaBirlikte: true });
    expect(await o.depo.kosuOku("k")).toBeNull();
  });

  it("B8 Y1: cekirdek baska bir hatayla silemezse kayitlaBirlikte bile hata yukari cikar ve kayit silinmez", async () => {
    const o = await oturum();
    await oyna(o, "k", 5);
    o.c.kosuSil = async () => {
      throw new CekirdekHatasi("HttpHatasi", "durum_500");
    };
    await expect(o.akis.kosuSil("k", { kayitlaBirlikte: true })).rejects.toThrow("durum_500");
    expect(await o.depo.kosuOku("k")).not.toBeNull();
  });

  it("durdu_sonrasi_yazici_kilitlenir_gunluk_kes_ile_acilir", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    o1.c.gunlugeEkle("k", karar(4, 27));
    await o1.yazici.gunlukSenkronla("k");
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.reddet = 4;
    const s = await o2.akis.devamEt("k", { hedef: 28 });
    expect(s).toMatchObject({ sonuc: "durdu", durum: "reddedildi" });
    expect(o2.yazici.kilitliMi("k")).toBe(true);
    expect((await o2.yazici.tick("k")).goruntu).toEqual({ durum: "kilitli" });
    await o2.yazici.gunlukKes("k", 3);
    expect(o2.yazici.kilitliMi("k")).toBe(false);
    expect((await o2.depo.gunlukOku("k")).map((g) => g.sira)).toEqual([1, 2, 3]);
  });
});

describe("kilit ve paket penceresi (tur 2)", () => {
  it("kilitli_kimlik_basarili_devamdan_sonra_gunluk_yazar", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.yazici.kilitle("k");
    expect(await o2.akis.devamEt("k", { hedef: 28 })).toMatchObject({ sonuc: "tamam" });
    expect(o2.yazici.kilitliMi("k")).toBe(false);
    o2.c.gunlugeEkle("k", karar(4, 28));
    expect((await o2.yazici.gunlukSenkronla("k")).eklenen).toBe(1);
  });

  it("dal_durdu_olunca_kaydi_olmayan_kimlik_kilitlenmez_sonra_basarili_dal_yazar", async () => {
    const o = await oturum();
    await oyna(o, "k", 30, GUNLUK);
    o.c.reddet = 3;
    const s = await o.akis.dalOlustur({ kosuId: "k", hafta: 22, yeniKosuId: "d", ilkGoruntu: false });
    expect(s).toMatchObject({ sonuc: "durdu" });
    expect(o.yazici.kilitliMi("d")).toBe(false);
    await o.c.kosuSil("d"); // koprü dogrudan siler
    o.c.reddet = null;
    expect(await o.akis.dalOlustur({ kosuId: "k", hafta: 22, yeniKosuId: "d", ilkGoruntu: false })).toMatchObject({ sonuc: "tamam" });
    expect((await o.depo.gunlukOku("d")).map((g) => g.sira)).toEqual([1, 2, 3]);
  });

  it("delikli_paket_penceresi_ardisik_son_ek_ile_sinirlanir_hic_yoksa_bos", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const d = await o1.depo.paketPenceresi("k", 26, 4);
    expect(d.map((p) => p.week)).toEqual([23, 24, 25, 26]);
    // hafta 25 paketini sil: pencere 23, 24, 26 -> ardisik son ek yalniz [26]
    const o2 = await yeniOturumAyniDepo(o1);
    const asil = o2.depo.paketPenceresi.bind(o2.depo);
    o2.depo.paketPenceresi = async (id, h, n) => (await asil(id, h, n)).filter((p) => p.week !== 25);
    await o2.akis.devamEt("k");
    expect((o2.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as { paketHaftalari: number[] }).paketHaftalari).toEqual([26]);
    // goruntu haftasinin paketi yoksa bos
    const o3 = await yeniOturumAyniDepo(o2);
    const asil3 = o3.depo.paketPenceresi.bind(o3.depo);
    o3.depo.paketPenceresi = async (id, h, n) => (await asil3(id, h, n)).filter((p) => p.week !== 26);
    await o3.akis.devamEt("k");
    expect((o3.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as { paketHaftalari: number[] }).paketHaftalari).toEqual([]);
  });

  it("cekirdek_delikli_pencereyi_reddeder_akis_yine_de_hata_vermez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    const asil = o2.c.devam.bind(o2.c);
    o2.c.devam = async (g) => {
      const w = (g.paketler ?? []).map((p) => p.week);
      if (w.some((x, i) => i > 0 && x !== (w[i - 1] as number) + 1) || (w.length && w.at(-1) !== g.goruntu.yonetici.released)) throw new CekirdekHatasi("ValueError", "paketler_ardisik_degil");
      return asil(g);
    };
    o2.depo.paketPenceresi = async () => [{ week: 23 }, { week: 25 }, { week: 26 }];
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "tamam" });
  });
});

describe("dal", () => {
  it("dal_goruntu_haftasi_dal_haftasini_asmaz_gunlukten_yalniz_dikis_kucuk_esit_ebeveyn_kopyasi", async () => {
    const o = await oturum();
    await oyna(o, "k", 30, GUNLUK);
    const s = await o.akis.dalOlustur({ kosuId: "k", hafta: 22, yeniKosuId: "d", ilkGoruntu: false });
    expect(s).toMatchObject({ sonuc: "tamam", kosuId: "d", hafta: 22, kaynak: "goruntu", goruntuHaftasi: 13 });
    const c = o.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as Record<string, unknown>;
    expect(c.kosuId).toBe("d");
    expect(c.ebeveyn).toEqual(["k", 22]);
    expect(c.gunlukSiralari).toEqual([1, 2, 3]); // dikis <= 22: 2, 10, 20
    expect(c.hedef).toBe(22);
    const kayit = await o.depo.kosuOku("d");
    expect(kayit?.ebeveyn).toEqual(["k", 22]);
    expect(kayit?.tarif.parent_id).toBe("k");
    expect(kayit?.tarif.fork_week).toBe(22);
    // goruntu oncesi (sira <= 2) kopyalandi; sira 3 cekirdegin yeniden oynatmasindan yazildi
    expect((await o.depo.gunlukOku("d")).map((g) => g.sira)).toEqual([1, 2, 3]);
    expect((await o.depo.kosuOku("k"))?.yayimlanan).toBe(30); // ebeveyn degismedi
  });

  it("dal_haftasindan_sonraki_gunluk_girisi_dala_verilmez", async () => {
    const o = await oturum();
    await oyna(o, "k", 30, GUNLUK);
    await o.akis.dalOlustur({ kosuId: "k", hafta: 15, yeniKosuId: "d", ilkGoruntu: false });
    const c = o.c.cagrilar.find((x) => x.yontem === "devam")?.girdi as Record<string, unknown>;
    expect(c.gunlukSiralari).toEqual([1, 2]); // dikis 20 > 15 elenir
    expect((await o.depo.gunlukOku("d")).map((g) => g.sira)).toEqual([1, 2]);
  });

  it("host_dal_haftasindan_ileride_olan_goruntu_secilmez_goruntu_yoksa_ebeveyn_tarifiyle_oynatilir", async () => {
    const o = await oturum();
    o.c.kosuYarat("k");
    await o.yazici.kosuBaslat("k");
    (o.c.kosular.get("k") as { onde: number }).onde = 3;
    await oyna(o, "k", 13, { 4: [karar(1, 3)] });
    expect((await o.depo.goruntuleriListele("k"))[0]).toMatchObject({ yayimlanan: 13, hafta: 16 });
    const s = await o.akis.dalOlustur({ kosuId: "k", hafta: 13, yeniKosuId: "d", ilkGoruntu: false });
    expect(s).toMatchObject({ sonuc: "tamam", kosuId: "d", kaynak: "tarif", goruntuHaftasi: null });
    expect(o.c.cagrilar.some((x) => x.yontem === "devam")).toBe(false);
    const t = o.c.cagrilar.find((x) => x.yontem === "tariftenOynat")?.girdi as { tarif: { parent_id: string; fork_week: number }; gunlukSiralari: number[]; kosuId: string };
    expect(t.tarif).toMatchObject({ parent_id: "k", fork_week: 13 });
    expect(t.gunlukSiralari).toEqual([1]);
    expect(t.kosuId).toBe("d");
    expect((await o.depo.gunlukOku("d")).map((g) => g.sira)).toEqual([1]);
  });

  it("dal_sonrasi_ilk_goruntu_denenir_dal_hemen_devam_edilebilir", async () => {
    const o = await oturum();
    await oyna(o, "k", 20);
    await o.akis.dalOlustur({ kosuId: "k", hafta: 15, yeniKosuId: "d" });
    expect((await o.depo.goruntuleriListele("d")).length).toBe(1);
  });

  it("dal_hatalari_var_olan_kimlik_gecersiz_hafta_bilinmeyen_kosu", async () => {
    const o = await oturum();
    await oyna(o, "k", 14);
    expect(await o.akis.dalOlustur({ kosuId: "k", hafta: 5, yeniKosuId: "k" })).toMatchObject({ sonuc: "hata", tur: "kosu_var" });
    expect(await o.akis.dalOlustur({ kosuId: "k", hafta: -1, yeniKosuId: "x" })).toMatchObject({ sonuc: "hata", tur: "dal_haftasi_gecersiz" });
    expect(await o.akis.dalOlustur({ kosuId: "yok", hafta: 5, yeniKosuId: "x" })).toMatchObject({ sonuc: "hata", tur: "kosu_yok" });
  });
});

describe("surum uyumsuzlugu ve hata ayrimi", () => {
  it("acilista_model_anahtari_farkli_surum_uyumsuz_goruntu_cekirdege_gitmez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const c2 = new SahteCekirdek();
    c2.anahtar = { ...c2.anahtar, model_sha256: "b".repeat(64), pyodide: "0.28.0" };
    const o2 = await yeniOturumAyniDepo(o1, c2);
    expect(await o2.akis.uyumlulukDurumu("k")).toMatchObject({ uyumlu: false });
    const s = await o2.akis.devamEt("k");
    expect(s).toMatchObject({ sonuc: "uyumsuz", tur: "surum", hedef: 28, secenekler: ["tariften_oynat", "disa_aktar", "sil"] });
    if (s.sonuc !== "uyumsuz") throw new Error("x");
    expect(Object.keys(s.fark).sort()).toEqual(["model_sha256", "pyodide"]);
    expect(s.tahmini).toEqual({ hafta: 28, enAzSn: 42, enCokSn: 168 });
    expect(c2.cagrilar.some((x) => x.yontem === "devam")).toBe(false); // pickle'a hic dokunulmadi
    const t = (await o2.depo.taniOku()).filter((x) => x.tur === "uyumsuz_goruntu");
    expect(t).toHaveLength(1);
    expect(t[0]?.ayrinti).toMatchObject({ alt: "surum", kaynak: "on_denetim", goruntuHaftasi: 26, hedef: 28 });
  });

  it("uc_hata_turu_ayri_sonuc_ayri_tani_kaydi", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const hata = [
      new CekirdekHatasi("UyumsuzGoruntu", "x", { schema: [1, 2] }),
      new CekirdekHatasi("GuvensizGoruntu", "x", { guvensiz: ["os", "system"] }),
      new CekirdekHatasi("UyumsuzGoruntu", "x", { bozuk: ["EOFError", "kesik"] }),
      new CekirdekHatasi("UyumsuzGoruntu", "x", { yukleme: ["KeyError", "z"] }),
      new CekirdekHatasi("UyumsuzGoruntu", "x", { bicim: ["onek_json", "bozuk"] }),
    ];
    const beklenen = ["surum", "guvensiz", "bozuk", "bozuk", "bozuk"];
    let o = o1;
    for (const [i, h] of hata.entries()) {
      o = await yeniOturumAyniDepo(o);
      o.c.devam = async () => {
        throw h;
      };
      const s = await o.akis.devamEt("k");
      expect(s).toMatchObject({ sonuc: "uyumsuz", tur: beklenen[i] });
    }
    const t = (await o.depo.taniOku()).filter((x) => x.tur === "uyumsuz_goruntu");
    // bozuk/guvensiz: iki goruntu de denenir (iki tani); surum farki: tek deneme
    expect(t.map((x) => x.ayrinti.alt)).toEqual(["surum", "guvensiz", "guvensiz", "bozuk", "bozuk", "bozuk", "bozuk", "bozuk", "bozuk"]);
    expect(t.every((x) => x.ayrinti.kaynak === "cekirdek" && typeof (x.ayrinti.simdiAnahtar as { model_sha256: string }).model_sha256 === "string")).toBe(true);
    expect(t[1]?.ayrinti.fark).toEqual({ guvensiz: ["os", "system"] });
  });

  it("hata_turu_mesajdan_da_taninir_python_koprusu_tur_tasimazsa", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.devam = async () => {
      throw new Error("PythonError: GuvensizGoruntu: izin listesi disi");
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "uyumsuz", tur: "guvensiz" });
  });

  it("eksik_parca_bozuk_sayilir_cekirdege_gitmez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.depo.goruntuParcalari = async () => null;
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "uyumsuz", tur: "bozuk" });
    expect(o2.c.cagrilar.length).toBe(0);
  });

  it("value_error_ve_too_many_runs_hata_sonucu_bilinmeyen_hata_tanili_hata_sonucu", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.devam = async () => {
      throw new CekirdekHatasi("ValueError", "devam_cok_uzun");
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "hata", tur: "ValueError", mesaj: "devam_cok_uzun" });
    o2.c.devam = async () => {
      throw new CekirdekHatasi("TooManyRuns", "dolu");
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "hata", tur: "TooManyRuns" });
    o2.c.devam = async () => {
      throw new CekirdekHatasi("RuntimeError", "beklenmeyen");
    };
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "hata", tur: "RuntimeError", mesaj: "beklenmeyen" });
    expect((await o2.depo.taniOku()).some((t) => t.tur === "cekirdek_hatasi")).toBe(true);
  });

  it("tariften_bastan_tam_gunluk_ilerleme_yeni_anahtar_eski_goruntuler_silinir", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const c2 = new SahteCekirdek();
    c2.anahtar = { ...c2.anahtar, model_sha256: "c".repeat(64) };
    const o2 = await yeniOturumAyniDepo(o1, c2);
    const ilerleme: number[] = [];
    const s = await o2.akis.tariftenBastan("k", { ilerleme: (h) => ilerleme.push(h) });
    expect(s).toMatchObject({ sonuc: "tamam", kosuId: "k", hafta: 28, uygulanan: 28, kaynak: "tarif" });
    expect(ilerleme.length).toBe(28);
    const t = o2.c.cagrilar.find((x) => x.yontem === "tariftenOynat")?.girdi as { gunlukSiralari: number[]; hedef: number; kosuId: string };
    expect(t).toMatchObject({ gunlukSiralari: [1, 2, 3], hedef: 28, kosuId: "k" }); // TAM gunluk
    const k = await o2.depo.kosuOku("k");
    expect(k?.modelAnahtari.model_sha256).toBe("c".repeat(64));
    expect(await o2.depo.goruntuleriListele("k")).toEqual([]);
    expect(k?.sonGoruntu).toBeNull();
    expect(await o2.depo.paketSayisi("k")).toBe(28); // paketler kalir
    expect((await o2.akis.uyumlulukDurumu("k")).uyumlu).toBe(true);
    expect((await o2.depo.taniOku()).some((x) => x.tur === "tariften_oynatildi")).toBe(true);
  });

  it("tariften_bastan_reddedilen_kararda_durur_ve_kayit_degismez", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const c2 = new SahteCekirdek();
    c2.anahtar = { ...c2.anahtar, model_sha256: "c".repeat(64) };
    c2.reddet = 2;
    const o2 = await yeniOturumAyniDepo(o1, c2);
    const s = await o2.akis.tariftenBastan("k");
    expect(s).toMatchObject({ sonuc: "durdu", durum: "reddedildi", kosuSilinebilir: true });
    expect((await o2.depo.kosuOku("k"))?.modelAnahtari.model_sha256).toBe("a".repeat(64));
    expect((await o2.depo.goruntuleriListele("k")).length).toBe(2);
  });

  describe("B7 R2-1: kaydin anahtari asagi yazilmaz", () => {
    async function eskiPaketOturumu(guncel: () => Promise<string | null>) {
      const o1 = await oturum();
      await oyna(o1, "k", 28, GUNLUK); // kayit "a" modeliyle
      const c2 = new SahteCekirdek();
      c2.anahtar = { ...c2.anahtar, model_sha256: "c".repeat(64) }; // yuklu (eski) paket "c"
      const o2 = await yeniOturumAyniDepo(o1, c2);
      const akis = new DevamAkisi({ depo: o2.depo, cekirdek: c2, yazici: o2.yazici, zaman: () => 1000, guncelModel: guncel });
      return { o2, c2, akis };
    }

    it("kayit_guncel_modelde_yuklu_paket_eskiyse_yeniden_yukle_gerek_doner_cekirdege_gidilmez_kayit_ayni", async () => {
      const { o2, c2, akis } = await eskiPaketOturumu(async () => "a".repeat(64));
      expect(await akis.tariftenBastan("k")).toEqual({ sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" });
      expect(c2.cagrilar.map((c) => c.yontem)).not.toContain("tariftenOynat");
      expect((await o2.depo.kosuOku("k"))?.modelAnahtari.model_sha256).toBe("a".repeat(64));
      expect((await o2.depo.goruntuleriListele("k")).length).toBe(2);
    });

    it("yuklu_paket_guncelse_ya_da_guncel_bilinmiyorsa_eski_davranis_(tariften_oynatir)", async () => {
      for (const guncel of [async () => "c".repeat(64), async () => null, () => Promise.reject(new Error("ag"))]) {
        const { o2, akis } = await eskiPaketOturumu(guncel);
        expect(await akis.tariftenBastan("k")).toMatchObject({ sonuc: "tamam" });
        expect((await o2.depo.kosuOku("k"))?.modelAnahtari.model_sha256).toBe("c".repeat(64));
      }
    });

    it("R3-2: oturum_eski_paketli_ve_kayit_yuklu_modelden_farkliysa_(guncel_baska_bir_surum_olsa_da)_yeniden_yukle_gerek", async () => {
      const { o2, c2, akis } = await eskiPaketOturumu(async () => "d".repeat(64)); // kayit "a", yuklu "c", guncel "d"
      expect(await akis.tariftenBastan("k")).toEqual({ sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" });
      expect(c2.cagrilar.map((c) => c.yontem)).not.toContain("tariftenOynat");
      expect((await o2.depo.kosuOku("k"))?.modelAnahtari.model_sha256).toBe("a".repeat(64));
    });

    it("R3-2: eski_paketli_oturumda_kayit_yuklu_modelle_ayniysa_tariften_oynatir_(yenileme_yok)", async () => {
      const o1 = await oturum();
      await oyna(o1, "k", 28, GUNLUK); // kayit "a"; yuklu da "a", guncel "d"
      const c2 = new SahteCekirdek();
      const o2 = await yeniOturumAyniDepo(o1, c2);
      const akis = new DevamAkisi({ depo: o2.depo, cekirdek: c2, yazici: o2.yazici, zaman: () => 1000, guncelModel: async () => "d".repeat(64) });
      expect(await akis.tariftenBastan("k")).toMatchObject({ sonuc: "tamam" });
    });

    it("R3-2_dongu_yok: yenilemeden_sonra_guncel_paketle_acilan_oturumda_yeniden_yukle_gerek_olusmaz_kayit_guncele_tasinir", async () => {
      const o1 = await oturum();
      await oyna(o1, "k", 28, GUNLUK); // kayit "a"
      const c2 = new SahteCekirdek();
      c2.anahtar = { ...c2.anahtar, model_sha256: "d".repeat(64) }; // yenileme sonrasi: yuklu = guncel = "d" (kaydin paketi SW'de yok)
      const o2 = await yeniOturumAyniDepo(o1, c2);
      const akis = new DevamAkisi({ depo: o2.depo, cekirdek: c2, yazici: o2.yazici, zaman: () => 1000, guncelModel: async () => "d".repeat(64) });
      expect(await akis.tariftenBastan("k")).toMatchObject({ sonuc: "tamam" });
      expect((await o2.depo.kosuOku("k"))?.modelAnahtari.model_sha256).toBe("d".repeat(64));
    });
  });

  it("tariften_bastan_ilk_cekirdekte_zaten_var_olan_kimlik_hata_sonucu", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 5);
    // ayni cekirdek: kosu bellekte
    expect(await o1.akis.tariftenBastan("k")).toMatchObject({ sonuc: "hata", tur: "ValueError" });
  });

  it("sapma_ve_takildi_durdu_sonucu", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 28, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    o2.c.devam = async (g) => ({ durum: "sapma", kosu_id: g.goruntu.yonetici.id, hafta: 26, uygulanan: 0, kalan: 2, neden: "sira", beklenen: 4, gercek: 5 });
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "durdu", durum: "sapma", kosuSilinebilir: true });
    o2.c.devam = async (g) => ({ durum: "takildi", kosu_id: g.goruntu.yonetici.id, hafta: 26, uygulanan: 0, kalan: 2 });
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "durdu", durum: "takildi" });
    o2.c.devam = async (g) => ({ durum: "basarisiz", kosu_id: g.goruntu.yonetici.id, hafta: 26, uygulanan: 0, kalan: 2, neden: "model_coktu" });
    expect(await o2.akis.devamEt("k")).toMatchObject({ sonuc: "durdu", durum: "basarisiz" });
  });

  it("tahmini_sure_hafta_basina_1_5_ile_6_sn", () => {
    expect(tahminiOynatma(10)).toEqual({ hafta: 10, enAzSn: 15, enCokSn: 60 });
    expect(tahminiOynatma(-3)).toEqual({ hafta: 0, enAzSn: 0, enCokSn: 0 });
  });
});

void sart;
void tarifOrnek;

describe("B8 devamOnizleme", () => {
  it("goruntu_varsa_yalniz_aradaki_haftalar_tahmin_edilir_uzaksa_genisletilmis", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 30, GUNLUK);
    const o2 = await yeniOturumAyniDepo(o1);
    expect(await o2.akis.devamOnizleme("k")).toEqual({ kaynak: "goruntu", oynatilacak: 4, tahmini: tahminiOynatma(4), genisletilmis: false });
    expect(await o2.akis.devamOnizleme("k", 39)).toMatchObject({ kaynak: "goruntu", oynatilacak: 13, genisletilmis: true });
  });

  it("goruntu_yoksa_tariften_ve_hedef_kadar_hafta_bilinmeyen_kosuda_null", async () => {
    const o1 = await oturum();
    await oyna(o1, "k", 8);
    const o2 = await yeniOturumAyniDepo(o1);
    expect(await o2.akis.devamOnizleme("k")).toEqual({ kaynak: "tarif", oynatilacak: 8, tahmini: tahminiOynatma(8), genisletilmis: false });
    expect(await o2.akis.devamOnizleme("yok")).toBeNull();
  });
});
