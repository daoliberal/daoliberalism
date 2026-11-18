// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEPOLAR, DepoHatasi, GOCLER, KayitDeposu, type GoruntuUstverisi, type KosuKaydi } from "@/oyun/tarayici/kayit/depo";
import { TEL_SEMA, type Yonetici } from "@/oyun/tarayici/kayit/tel";
import { ANAHTAR, birlestir, karar, ornekDeger, sart, tarifOrnek, yeniDepo, yeniIdb } from "./yardimci";

function yeniKayit(id: string, ek: Partial<KosuKaydi> = {}): Omit<KosuKaydi, "olusturma" | "guncelleme"> {
  return { kosuId: id, tarif: tarifOrnek(), modelAnahtari: ANAHTAR, ebeveyn: null, kaynak: "yerel", yayimlanan: 0, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0, ...ek };
}

function ust(id: string, kimlik: string, hafta: number, parca: number, zaman: number, yonetici?: Yonetici): GoruntuUstverisi {
  const y = (yonetici ?? ornekDeger(TEL_SEMA.yonetici)) as Yonetici;
  return { kosuId: id, goruntuKimligi: kimlik, zaman, hafta, yayimlanan: hafta, ham: 10, sikisik: 5, parca, anahtar: ANAHTAR, gunlukSira: 0, yonetici: { ...y, goruntu_kimligi: kimlik } };
}

function tampon(...b: number[]): ArrayBuffer {
  return new Uint8Array(b).buffer;
}

describe("depo semasi ve goc", () => {
  it("ilk_acilista_butun_depolar_ve_indeks_olusur", async () => {
    const idb = yeniIdb();
    const d = await yeniDepo(idb);
    expect(d.surum).toBe(GOCLER.length);
    expect(d.depoAdlari().sort()).toEqual([...DEPOLAR].sort());
    d.kapat();
  });

  it("goc_yalniz_eksik_surumlerde_calisir_ve_veri_korunur", async () => {
    const idb = yeniIdb();
    const d1 = await yeniDepo(idb);
    await d1.kosuOlustur(yeniKayit("k1"));
    await d1.gunlukYaz("k1", [karar(1, 0)]);
    d1.kapat();
    const cagri: number[] = [];
    const gocler = [
      ...GOCLER,
      (db: IDBDatabase, tx: IDBTransaction, eski: number) => {
        cagri.push(eski);
        tx.objectStore("kosular").createIndex("yayimlanan", "yayimlanan");
        void db;
      },
    ];
    const d2 = await KayitDeposu.ac(idb, { gocler });
    expect(cagri).toEqual([1]);
    expect(d2.surum).toBe(2);
    expect((await d2.kosuOku("k1"))?.kosuId).toBe("k1");
    expect(await d2.gunlukOku("k1")).toHaveLength(1);
    d2.kapat();
    cagri.length = 0;
    const d3 = await KayitDeposu.ac(idb, { gocler });
    expect(cagri).toEqual([]);
    d3.kapat();
  });

  it("daha_yeni_surumdeki_depo_acilmaz", async () => {
    const idb = yeniIdb();
    const d = await KayitDeposu.ac(idb, { gocler: [...GOCLER, () => undefined] });
    d.kapat();
    await expect(KayitDeposu.ac(idb)).rejects.toMatchObject({ kod: "depo_daha_yeni" });
  });

  it("goc_hatasi_acilisi_reddeder", async () => {
    const idb = yeniIdb();
    await expect(
      KayitDeposu.ac(idb, {
        gocler: [
          ...GOCLER,
          () => {
            throw new Error("x");
          },
        ],
      }),
    ).rejects.toBeInstanceOf(DepoHatasi);
  });
});

describe("istek duzeyi hata ve budama", () => {
  const benzersiz = [
    ...GOCLER,
    (_db: IDBDatabase, tx: IDBTransaction) => {
      tx.objectStore("parcalar").createIndex("tekil", "sira", { unique: true });
    },
  ];

  it("istek_duzeyi_hata_asil_hata_olarak_firlar_abort_error_degil_onceki_goruntu_saglam", async () => {
    const idb = yeniIdb();
    const d = await KayitDeposu.ac(idb, { gocler: benzersiz });
    await d.kosuOlustur(yeniKayit("k"));
    await d.goruntuYaz(ust("k", "g1", 13, 1, 1), [tampon(1)]);
    // iki parca, ayni `sira` degil ama baska goruntunun 0. parcasi ile cakisir: g2'nin 0. parcasi tekil indekste g1'inkiyle cakisir
    const hata = await d.goruntuYaz(ust("k", "g2", 26, 2, 2), [tampon(1), tampon(2)]).catch((e: unknown) => e);
    expect((hata as { name: string }).name).toBe("ConstraintError");
    expect((await d.kosuOku("k"))?.sonGoruntu?.kimlik).toBe("g1");
    expect(await d.parcaSayisi()).toBe(1);
    expect(await d.goruntuParcalari("k", "g2")).toBeNull();
  });

  it("paket_ve_gunluk_yazimlarinda_da_asil_hata", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await expect(d.haftalarYaz("k", [{ week: 1 }, { week: 1.5 }])).rejects.toMatchObject({ kod: "paket_hafta_gecersiz" });
    await expect(d.gunlukYaz("yok", [karar(1, 0)])).rejects.toMatchObject({ kod: "kosu_yok" });
  });

  it("budama_model_haftasina_gore_saat_geri_alinsa_da_dogru_goruntuler_kalir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.goruntuYaz(ust("k", "g1", 13, 1, 900), [tampon(1)]);
    await d.goruntuYaz(ust("k", "g2", 26, 1, 800), [tampon(2)]);
    await d.goruntuYaz(ust("k", "g3", 39, 1, 100), [tampon(3)]); // saat geri: zaman en kucuk
    expect((await d.goruntuleriListele("k")).map((g) => g.goruntuKimligi)).toEqual(["g3", "g2"]);
  });

  it("ayni_kimlik_yeniden_yazilinca_eski_fazla_parcalar_temizlenir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.goruntuYaz(ust("k", "g1", 13, 3, 1), [tampon(1), tampon(2), tampon(3)]);
    await d.goruntuYaz(ust("k", "g1", 13, 2, 2), [tampon(7), tampon(8)]);
    expect(await d.parcaSayisi()).toBe(2);
    expect(Array.from(await birlestir((await d.goruntuParcalari("k", "g1")) ?? []))).toEqual([7, 8]);
  });

  it("gunluk_kes_sonrasi_girisler_silinir_sayac_geri_gelir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.gunlukYaz("k", [karar(1, 0), karar(2, 1), karar(3, 2)]);
    expect(await d.gunlukKes("k", 1)).toBe(2);
    expect(await d.gunlukOku("k")).toEqual([karar(1, 0)]);
    expect((await d.kosuOku("k"))?.gunlukSira).toBe(1);
  });
});

describe("haftalar ve gunluk idempotent", () => {
  it("ayni_hafta_iki_kez_tek_kayit_ve_pencere_son_dort", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    for (let h = 1; h <= 6; h++) await d.haftalarYaz("k", [{ week: h, v: h }]);
    await d.haftalarYaz("k", [{ week: 3, v: 3 }, { week: 4, v: 4 }]);
    expect(await d.paketSayisi("k")).toBe(6);
    expect((await d.paketPenceresi("k", 6, 4)).map((p) => p.week)).toEqual([3, 4, 5, 6]);
    expect((await d.paketPenceresi("k", 2, 4)).map((p) => p.week)).toEqual([1, 2]);
    expect((await d.paketAraligi("k", 2, 4)).map((p) => p.week)).toEqual([2, 3, 4]);
    expect((await d.kosuOku("k"))?.yayimlanan).toBe(6);
  });

  it("baska_kosunun_paketleri_karismaz", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("a"));
    await d.kosuOlustur(yeniKayit("ab"));
    await d.haftalarYaz("a", [{ week: 1 }]);
    await d.haftalarYaz("ab", [{ week: 1 }, { week: 2 }]);
    expect(await d.paketSayisi("a")).toBe(1);
    expect((await d.paketAraligi("ab", 0, 9)).length).toBe(2);
  });

  it("gunluk_sira_ile_idempotent_ayni_icerik_atlanir_cakisma_ilk_korunur", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    expect(await d.gunlukYaz("k", [karar(1, 0), sart(2, 4)])).toEqual({ eklenen: 2, cakisan: [] });
    expect(await d.gunlukYaz("k", [karar(1, 0), sart(2, 4), karar(3, 5)])).toEqual({ eklenen: 1, cakisan: [] });
    const farkli = await d.gunlukYaz("k", [karar(3, 5, { baska: true })]);
    expect(farkli).toEqual({ eklenen: 0, cakisan: [3] });
    expect(await d.gunlukOku("k")).toEqual([karar(1, 0), sart(2, 4), karar(3, 5)]);
    expect(await d.gunlukOku("k", 2)).toEqual([karar(3, 5)]);
    expect((await d.kosuOku("k"))?.gunlukSira).toBe(3);
  });

  it("bilinmeyen_kosuya_yazim_reddedilir_ve_gecersiz_paket_hicbirini_yazmaz", async () => {
    const d = await yeniDepo();
    await expect(d.haftalarYaz("yok", [{ week: 1 }])).rejects.toMatchObject({ kod: "kosu_yok" });
    await d.kosuOlustur(yeniKayit("k"));
    await expect(d.haftalarYaz("k", [{ week: 1 }, { week: -1 }])).rejects.toMatchObject({ kod: "paket_hafta_gecersiz" });
    expect(await d.paketSayisi("k")).toBe(0);
  });

  it("kosu_olustur_idempotent_var_olan_korunur", async () => {
    const d = await yeniDepo(yeniIdb(), () => 5);
    const a = await d.kosuOlustur(yeniKayit("k", { yayimlanan: 7 }));
    const b = await d.kosuOlustur(yeniKayit("k", { yayimlanan: 1 }));
    expect(a.yayimlanan).toBe(7);
    expect(b.yayimlanan).toBe(7);
  });
});

describe("goruntu yazimi atomik", () => {
  it("parcalar_arraybuffer_olarak_saklanir_ve_sirayla_okunur", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.goruntuYaz(ust("k", "g1", 13, 3, 1), [tampon(1, 2), tampon(3), tampon(4, 5, 6)]);
    const p = await d.goruntuParcalari("k", "g1");
    expect(p?.length).toBe(3);
    expect(p?.every((x) => x instanceof ArrayBuffer)).toBe(true);
    expect(Array.from(await birlestir(p ?? []))).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await d.kosuOku("k"))?.sonGoruntu).toEqual({ kimlik: "g1", hafta: 13, yayimlanan: 13 });
  });

  it("yarim_yazim_klonlanamayan_yonetici_eski_goruntu_ve_isaretci_saglam", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.goruntuYaz(ust("k", "g1", 13, 2, 1), [tampon(1), tampon(2)]);
    const parcaOnce = await d.parcaSayisi();
    const bozuk = ust("k", "g2", 26, 2, 2);
    (bozuk.yonetici as unknown as Record<string, unknown>).islev = () => 1; // yapisal klon DataCloneError verir (parcalar zaten put edilmisti)
    await expect(d.goruntuYaz(bozuk, [tampon(7), tampon(8)])).rejects.toBeDefined();
    expect((await d.kosuOku("k"))?.sonGoruntu?.kimlik).toBe("g1");
    expect((await d.goruntuleriListele("k")).map((g) => g.goruntuKimligi)).toEqual(["g1"]);
    expect(await d.parcaSayisi()).toBe(parcaOnce); // yetim parca yok
    expect(Array.from(await birlestir((await d.goruntuParcalari("k", "g1")) ?? []))).toEqual([1, 2]);
    expect(await d.goruntuParcalari("k", "g2")).toBeNull();
  });

  it("parca_sayisi_tutarsizsa_hicbir_sey_yazilmaz", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await expect(d.goruntuYaz(ust("k", "g1", 13, 3, 1), [tampon(1)])).rejects.toMatchObject({ kod: "parca_sayisi_tutarsiz" });
    expect(await d.parcaSayisi()).toBe(0);
    expect((await d.kosuOku("k"))?.sonGoruntu).toBeNull();
  });

  it("son_iki_goruntu_tutulur_eskiler_parcalariyla_silinir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    for (const [i, h] of [13, 26, 39].entries()) await d.goruntuYaz(ust("k", "g" + (i + 1), h, 2, 100 + i), [tampon(i), tampon(i)]);
    expect((await d.goruntuleriListele("k")).map((g) => g.goruntuKimligi)).toEqual(["g3", "g2"]);
    expect(await d.parcaSayisi()).toBe(4);
    expect(await d.goruntuParcalari("k", "g1")).toBeNull();
    expect((await d.kosuOku("k"))?.sonGoruntu?.kimlik).toBe("g3");
  });

  it("goruntuleri_sil_gunluk_ve_paketler_kalir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.haftalarYaz("k", [{ week: 1 }]);
    await d.gunlukYaz("k", [karar(1, 0)]);
    await d.goruntuYaz(ust("k", "g1", 13, 1, 1), [tampon(1)]);
    expect(await d.goruntuleriSil("k")).toBe(1);
    expect(await d.goruntuleriListele("k")).toEqual([]);
    expect(await d.parcaSayisi()).toBe(0);
    expect((await d.kosuOku("k"))?.sonGoruntu).toBeNull();
    expect(await d.paketSayisi("k")).toBe(1);
    expect(await d.gunlukOku("k")).toHaveLength(1);
  });

  it("kosu_silince_bagli_her_sey_gider_baska_kosu_kalir", async () => {
    const d = await yeniDepo();
    await d.kosuOlustur(yeniKayit("k"));
    await d.kosuOlustur(yeniKayit("k2"));
    await d.haftalarYaz("k", [{ week: 1 }]);
    await d.haftalarYaz("k2", [{ week: 1 }]);
    await d.gunlukYaz("k", [karar(1, 0)]);
    await d.goruntuYaz(ust("k", "g1", 13, 1, 1), [tampon(1)]);
    await d.goruntuYaz(ust("k2", "g2", 13, 1, 1), [tampon(2)]);
    await d.kosuSil("k");
    expect(await d.kosuOku("k")).toBeNull();
    expect(await d.paketSayisi("k")).toBe(0);
    expect(await d.gunlukOku("k")).toEqual([]);
    expect(await d.goruntuleriListele("k")).toEqual([]);
    expect(await d.parcaSayisi()).toBe(1);
    expect(await d.paketSayisi("k2")).toBe(1);
  });
});

describe("tani ve meta", () => {
  it("tani_en_cok_sinirda_budanir", async () => {
    const d = await yeniDepo();
    for (let i = 0; i < 205; i++) await d.taniYaz({ tur: "t", ayrinti: { i } });
    const t = await d.taniOku();
    expect(t.length).toBe(200);
    expect((t[0]?.ayrinti as { i: number }).i).toBe(5);
  });

  it("meta_yaz_oku", async () => {
    const d = await yeniDepo();
    expect(await d.metaOku("x")).toBeNull();
    await d.metaYaz("x", { a: 1 });
    expect(await d.metaOku("x")).toEqual({ a: 1 });
  });
});

describe("depo kapat-ac", () => {
  it("kapatip_acinca_ayni_goruntu_gunluk_paket_ayni_baytlar", async () => {
    const idb = yeniIdb();
    const d1 = await yeniDepo(idb);
    await d1.kosuOlustur(yeniKayit("k"));
    await d1.haftalarYaz("k", [{ week: 1, v: "a" }]);
    await d1.gunlukYaz("k", [karar(1, 0)]);
    await d1.goruntuYaz(ust("k", "g1", 13, 2, 1), [tampon(9, 8), tampon(7)]);
    d1.kapat();
    const d2 = await yeniDepo(idb);
    expect(await d2.paketOku("k", 1)).toEqual({ week: 1, v: "a" });
    expect(await d2.gunlukOku("k")).toEqual([karar(1, 0)]);
    expect(Array.from(await birlestir((await d2.goruntuParcalari("k", "g1")) ?? []))).toEqual([9, 8, 7]);
  });
});
