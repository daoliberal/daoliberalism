// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashKosuKimligi, tarayiciKaynagiKur, type AcilisDurumu, type KaynakSecenek, type TarayiciKaynagi } from "@/oyun/tarayici/kaynak";
import { KayitDeposu } from "@/oyun/tarayici/kayit/depo";
import { SahteCekirdek, tarifOrnek, yeniIdb } from "./kayit/yardimci";
import { SahteCalisanWorker, SahteIsci, SahteKilitler, SahteYayin, ertele } from "./yardimci";
import type { SekmeOrtami } from "@/oyun/tarayici/sekmeKilidi";

/** Kilit koruması olmayan ortam (tek sekme testleri). */
const SEKME_YOK: SekmeOrtami = { locks: null, kanalUret: null, bekle: async () => undefined };

const acik: TarayiciKaynagi[] = [];
afterEach(async () => {
  for (const k of acik.splice(0)) await k.kapat().catch(() => undefined);
});

interface Oturum {
  worker: SahteCalisanWorker;
  cekirdek: SahteCekirdek;
  isci: SahteIsci;
  durumlar: AcilisDurumu[];
  hashlar: string[];
  secenek: KaynakSecenek;
}

/** Bir sayfa oturumu: taze cekirdek/isci (Python bellegi bos), AYNI IndexedDB. */
function oturum(idb: IDBFactory, hash: string, o: Partial<KaynakSecenek> = {}, cekirdekAyar?: (c: SahteCekirdek) => void): Oturum {
  const cekirdek = new SahteCekirdek();
  cekirdekAyar?.(cekirdek);
  const isci = new SahteIsci(cekirdek);
  const worker = new SahteCalisanWorker(cekirdek, isci);
  const durumlar: AcilisDurumu[] = [];
  const hashlar: string[] = [];
  const secenek: KaynakSecenek = {
    workerUret: () => worker,
    origin: "http://h",
    idb,
    storage: null,
    hash,
    hashYaz: (h) => hashlar.push(h),
    durum: (d) => durumlar.push(d),
    sekme: SEKME_YOK,
    ...o,
  };
  return { worker, cekirdek, isci, durumlar, hashlar, secenek };
}

/** Cekirdegin yarattigi kosularin tarifi DAO modunda (kayit tarif.config.mode === "dao"). */
const daoKosuKur = (c: SahteCekirdek): void => {
  const asil = c.kosuYarat.bind(c);
  c.kosuYarat = (id: string) => asil(id, tarifOrnek({ config: { mode: "dao" } }));
};

async function ac(o: Oturum): Promise<TarayiciKaynagi> {
  const k = await tarayiciKaynagiKur(o.secenek);
  acik.push(k);
  return k;
}

async function oyna(k: TarayiciKaynagi, hafta: number): Promise<string> {
  const r = await k.kopru.fetch("/api/runs", { method: "POST", body: JSON.stringify({ config: {} }) });
  const id = ((await r.json()) as { runId: string }).runId;
  await k.kopru.fetch(`/api/runs/${id}/control`, { method: "POST", body: JSON.stringify({ action: "play" }) });
  const son = Date.now() + 3000;
  while ((await k.kayit.depo.kosuOku(id))!.yayimlanan < hafta) {
    if (Date.now() > son) throw new Error("hafta_gelmedi");
    await new Promise((c) => setTimeout(c, 2));
  }
  await k.kopru.durdur();
  return id;
}

describe("hashKosuKimligi", () => {
  it("yalniz_canli_rotasi_gorunum_soneki_atilir", () => {
    expect(hashKosuKimligi("#/canli/canli-ab12")).toBe("canli-ab12");
    expect(hashKosuKimligi("#/canli/canli-ab12/3")).toBe("canli-ab12");
    expect(hashKosuKimligi("#/canli/")).toBeNull();
    expect(hashKosuKimligi("#/kurucu")).toBeNull();
    expect(hashKosuKimligi("")).toBeNull();
    // B8 K1: sonuc ve DAO rotalari da koşu kimligi tasir; paylasilan dunya (`#/dao/d/<kod>`) tasimaz
    expect(hashKosuKimligi("#/sonuc/canli-ab12")).toBe("canli-ab12");
    expect(hashKosuKimligi("#/dao/canli-ab12")).toBe("canli-ab12");
    expect(hashKosuKimligi("#/dao/canli-ab12/2")).toBe("canli-ab12");
    expect(hashKosuKimligi("#/dao/d/KOD")).toBeNull();
    expect(hashKosuKimligi("#/dao")).toBeNull();
  });
});

describe("acilis: yukleme -> kayit -> devam -> dongu", () => {
  it("kayit_yokken_soru_yok_asamalar_sirasi_dongu_basladi_Worker_hazir", async () => {
    const o = oturum(yeniIdb(), "#/kurucu");
    const k = await ac(o);
    const asamalar = o.durumlar.map((d) => (d.tur === "yukleme" ? d.asama : d.tur));
    expect(asamalar).toEqual(["indirme", "kayit"]);
    expect(o.durumlar.some((d) => d.tur === "secim" || d.tur === "devam")).toBe(false);
    expect(k.kopru.calisiyor).toBe(true);
    expect(o.worker.mesajlar[0]).toMatchObject({ t: "yukle" });
  });

  it("yukleme_hatasi_YuklemeHatasi_olarak_firlar", async () => {
    const o = oturum(yeniIdb(), "#/kurucu");
    o.worker.yuklemeHatasi = { kod: "sha_uyusmuyor" };
    await expect(tarayiciKaynagiKur(o.secenek)).rejects.toMatchObject({ kod: "sha_uyusmuyor" });
  });

  it("yukleme_sirasinda_iptal_Worker_sonlandirilir", async () => {
    const o = oturum(yeniIdb(), "#/kurucu");
    o.worker.yuklemeBekle = ertele();
    let iptal = false;
    o.secenek.iptalEdildi = () => iptal;
    const p = tarayiciKaynagiKur(o.secenek);
    iptal = true;
    await expect(p).rejects.toMatchObject({ kod: "iptal_edildi" });
    expect(o.worker.sonlandi).toBeGreaterThan(0);
  });
});

describe("kayittan devam (sayfa yenileme)", () => {
  it("hash_kayitli_kosuyu_gosterir_goruntu_yoksa_tariften_bastan_hafta_kaybolmaz_abone_acilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 5);
    const yay = (await k1.kayit.depo.kosuOku(id))!.yayimlanan;
    expect(yay).toBeGreaterThanOrEqual(5);
    await k1.kapat();

    const o2 = oturum(idb, `#/canli/${id}`);
    const k2 = await ac(o2);
    const devamlar = o2.durumlar.filter((d) => d.tur === "devam");
    expect(devamlar.length).toBeGreaterThan(0);
    expect(o2.isci.cagrilar.some((c) => c.y === "istek" && (c.a as { yol: string }).yol === `/api/runs/${id}/events`)).toBe(true);   // hemen abone
    expect(o2.cekirdek.kosular.get(id)?.released).toBe(yay);          // Python tarafi ayni haftaya geldi
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).toContain("tariftenOynat");   // ilk 13 haftada goruntu yok (kadans)
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).not.toContain("devam");
    expect((await k2.kayit.depo.kosuOku(id))!.yayimlanan).toBe(yay);
    expect(o2.hashlar).toEqual([]);                                   // hash zaten dogru
    expect(k2.kopru.calisiyor).toBe(true);
  });

  it("goruntu_varsa_en_yakin_goruntuden_devam_edilir", async () => {
    const idb = yeniIdb();
    const o1 = oturum(idb, "#/kurucu", {}, (c) => (c.kadans = 2));
    const k1 = await ac(o1);
    const id = await oyna(k1, 5);
    expect((await k1.kayit.depo.goruntuleriListele(id)).length).toBeGreaterThan(0);
    await k1.kapat();
    const o2 = oturum(idb, `#/canli/${id}`);
    await ac(o2);
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).toContain("devam");
  });

  it("ev_rotasinda_kayit_varsa_secim_sorulur_yeni_secilirse_devam_edilmez", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const o2 = oturum(idb, "#/");
    const p = ac(o2);
    const secim = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    expect(secim).toMatchObject({ tur: "secim", kosuId: id });
    if (secim.tur === "secim") secim.yeni();
    await p;
    expect(o2.cekirdek.kosular.size).toBe(0);
    expect(o2.hashlar).toEqual([]);
  });

  it("Y1: DAO kosusu ev rotasindan devam edilirse hash #/dao/ rotasina yazilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/dao", {}, daoKosuKur));
    const id = await oyna(k1, 3);
    await k1.kapat();
    expect(((await (await KayitDeposu.ac(idb)).kosuOku(id))!.tarif.config as { mode?: string }).mode).toBe("dao");
    const o2 = oturum(idb, "");
    const p = ac(o2);
    const secim = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    if (secim.tur === "secim") secim.devam();
    await p;
    expect(o2.hashlar).toEqual([`#/dao/${id}`]);
  });

  it("ev_rotasinda_devam_secilirse_kosu_yuklenir_ve_hash_yazilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const o2 = oturum(idb, "");
    const p = ac(o2);
    const secim = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    if (secim.tur === "secim") secim.devam();
    await p;
    expect(o2.hashlar).toEqual([`#/canli/${id}`]);
    expect(o2.cekirdek.kosular.has(id)).toBe(true);
  });

  it("kurucu_gibi_ev_olmayan_rotada_soru_sorulmaz", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    await oyna(k1, 3);
    await k1.kapat();
    const o2 = oturum(idb, "#/kurucu");
    await ac(o2);
    expect(o2.durumlar.some((d) => d.tur === "secim")).toBe(false);
    expect(o2.cekirdek.kosular.size).toBe(0);
  });

  it("hic_hafta_yayimlamamis_kayit_secimde_onerilmez", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    await k1.kopru.fetch("/api/runs", { method: "POST", body: "{}" });           // yayimlanan 0
    await k1.kapat();
    const o2 = oturum(idb, "#/");
    await ac(o2);
    expect(o2.durumlar.some((d) => d.tur === "secim")).toBe(false);
  });

  it("cekirdek_reddederse_devam_olmadi_gosterilir_yeni_oyun_secilene_dek_bekler_hash_temizlenir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kayit.depo.gunlukYaz(id, [{ sira: 1, tur: "karar", dikis: 1, karar: { alan: "x" } }]);
    await k1.kapat();
    // Cekirdek 1. gunluk girisini reddeder (reddedilen karar): akis `durdu` sonucu verir; sessiz yeniden oynatma/silme yok.
    const o2 = oturum(idb, `#/canli/${id}`, {}, (c) => {
      c.reddet = 1;
    });
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const s = o2.durumlar.find((x) => x.tur === "devam_olmadi");
      if (!s) throw new Error("yok");
      return s;
    });
    expect(d.tur === "devam_olmadi" && d.sonuc.sonuc).toBe("durdu");
    let bitti = false;
    void p.then(() => (bitti = true));
    await new Promise((c) => setTimeout(c, 20));
    expect(bitti).toBe(false);                      // kullanici "yeni oyun" diyene dek bekler
    if (d.tur === "devam_olmadi") d.yeni();
    await p;
    expect(o2.hashlar).toEqual(["#/"]);
  });
});

describe("tek sekme (Ö1)", () => {
  const ortam = (locks: SahteKilitler, yayin: SahteYayin): SekmeOrtami => ({ locks, kanalUret: yayin.uret, bekle: async () => undefined });

  it("ikinci_sekme_dolu_gorur_Worker_baslamaz_devral_deyince_ilk_sekme_duzgun_kapanir_ve_haberdar_edilir", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const idb = yeniIdb();
    let ilkHaberdar = 0;
    const o1 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin), baskaSekme: () => ilkHaberdar++ });
    const k1 = await ac(o1);
    const id = await oyna(k1, 2);
    expect(k1.kopru.calisiyor).toBe(false);                 // oyna() durdurdu; devralma kapatmayi yine de temiz yapmali

    const o2 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin) });
    const p = ac(o2);
    const dolu = await vi.waitFor(() => {
      const d = o2.durumlar.find((x) => x.tur === "baska_sekme");
      if (!d) throw new Error("yok");
      return d;
    });
    expect(o2.worker.mesajlar).toEqual([]);                  // Worker hic baslatilmadi (Pyodide indirilmedi)
    if (dolu.tur === "baska_sekme") dolu.devral();
    const k2 = await p;
    expect(k2.kopru.calisiyor).toBe(true);
    expect(o2.worker.mesajlar[0]).toMatchObject({ t: "yukle" });
    await vi.waitFor(() => expect(ilkHaberdar).toBe(1));
    expect(o1.worker.sonlandi).toBeGreaterThan(0);          // ilk sekmenin Worker'i kapandi
    void id;
  });

  it("kilit_alinabilirse_soru_yok", async () => {
    const o = oturum(yeniIdb(), "#/kurucu", { sekme: ortam(new SahteKilitler(), new SahteYayin()) });
    await ac(o);
    expect(o.durumlar.some((d) => d.tur === "baska_sekme")).toBe(false);
  });

  it("baska_sekme_sorusu_beklerken_bilesen_kalkarsa_iptal_edildi", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    await ac(oturum(yeniIdb(), "#/kurucu", { sekme: ortam(locks, yayin) }));
    let iptal = false;
    const o2 = oturum(yeniIdb(), "#/kurucu", { sekme: ortam(locks, yayin), iptalEdildi: () => iptal });
    const p = tarayiciKaynagiKur(o2.secenek);
    await vi.waitFor(() => expect(o2.durumlar.some((d) => d.tur === "baska_sekme")).toBe(true));
    iptal = true;
    await expect(p).rejects.toMatchObject({ kod: "iptal_edildi" });
  });

  it("secim_beklerken_bilesen_kalkarsa_Worker_kapatilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    await oyna(k1, 2);
    await k1.kapat();
    let iptal = false;
    const o2 = oturum(idb, "#/", { iptalEdildi: () => iptal });
    const p = tarayiciKaynagiKur(o2.secenek);
    await vi.waitFor(() => expect(o2.durumlar.some((d) => d.tur === "secim")).toBe(true));
    iptal = true;
    await expect(p).rejects.toMatchObject({ kod: "iptal_edildi" });
    expect(o2.worker.sonlandi).toBeGreaterThan(0);
  });

  it("Y1_devirde_Worker_ONCE_kapanir_suren_tick_beklenmez_sonra_eski_sekmenin_yazimlari_reddedilir_gunluk_bozulmaz", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const idb = yeniIdb();
    let haber = 0;
    const o1 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin), baskaSekme: () => haber++ });
    const k1 = await ac(o1);
    const id = await oyna(k1, 2);
    k1.kopru.baslat();
    o1.isci.tickKapisi = () => new Promise(() => undefined);          // 3-6 sn suren adim: hic bitmeyecek
    await vi.waitFor(() => expect(o1.isci.cagrilar.filter((c) => c.y === "tick").length).toBeGreaterThan(3));
    const gunlukOnce = (await k1.kayit.depo.gunlukOku(id, 0)).length;

    const o2 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin) });
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((y) => y.tur === "baska_sekme");
      if (!x) throw new Error("yok");
      return x;
    });
    if (d.tur === "baska_sekme") d.devral();
    await p;
    expect(haber).toBe(1);
    expect(o1.worker.sonlandi).toBeGreaterThan(0);                     // Worker kapatildi (tick beklenmedi)
    // eski sekme artik yazamaz
    await expect(k1.kayit.depo.haftalarYaz(id, [{ week: 99, run_id: id }])).rejects.toBeDefined();
    await expect(k1.kayit.depo.gunlukYaz(id, [{ sira: 50, tur: "karar", dikis: 1, karar: { alan: "x" } }])).rejects.toBeDefined();
    expect((await (await ac2(idb)).kayit.depo.gunlukOku(id, 0)).length).toBe(gunlukOnce);
  });

  it("Y1_kilit_calinirsa_zarif_devir_yokken_eski_sekmede_IndexedDB_yazimi_HEMEN_kapanir", async () => {
    const locks = new SahteKilitler();
    const idb = yeniIdb();
    let haber = 0;
    const o1 = oturum(idb, "#/kurucu", { sekme: { locks, kanalUret: null, bekle: async () => undefined }, baskaSekme: () => haber++ });
    const k1 = await ac(o1);
    const id = await oyna(k1, 2);
    const o2 = oturum(idb, "#/kurucu", { sekme: { locks, kanalUret: null, bekle: async () => undefined } });
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((y) => y.tur === "baska_sekme");
      if (!x) throw new Error("yok");
      return x;
    });
    if (d.tur === "baska_sekme") d.devral();
    await p;
    await vi.waitFor(() => expect(haber).toBe(1));
    await expect(k1.kayit.depo.haftalarYaz(id, [{ week: 77, run_id: id }])).rejects.toBeDefined();
  });

  it("Y2_yukleme_sirasinda_devir_yuklemeyi_iptal_eder_Worker_kapanir_kimse_IndexedDBye_yazmaz", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const idb = yeniIdb();
    let haber = 0;
    const o1 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin), baskaSekme: () => haber++ });
    o1.worker.yuklemeBekle = ertele();                                  // A hala yukleniyor
    const p1 = tarayiciKaynagiKur(o1.secenek);
    const sonuc1 = p1.then(() => "tamam", (e: { kod?: string }) => e.kod);
    await vi.waitFor(() => expect(o1.worker.mesajlar.length).toBe(1));
    const o2 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin) });
    const p2 = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((y) => y.tur === "baska_sekme");
      if (!x) throw new Error("yok");
      return x;
    });
    if (d.tur === "baska_sekme") d.devral();
    await p2;
    expect(await sonuc1).toBe("iptal_edildi");
    expect(haber).toBe(1);
    expect(o1.worker.sonlandi).toBeGreaterThan(0);
  });

  it("Y2_secim_ekraninda_beklerken_devir_gelirse_secim_iptal_edilir", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const idb = yeniIdb();
    const k0 = await ac(oturum(idb, "#/kurucu"));
    await oyna(k0, 2);
    await k0.kapat();
    const o1 = oturum(idb, "#/", { sekme: ortam(locks, yayin) });
    const p1 = tarayiciKaynagiKur(o1.secenek);
    const sonuc1 = p1.then(() => "tamam", (e: { kod?: string }) => e.kod);
    await vi.waitFor(() => expect(o1.durumlar.some((x) => x.tur === "secim")).toBe(true));
    const o2 = oturum(idb, "#/kurucu", { sekme: ortam(locks, yayin) });
    const p2 = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((y) => y.tur === "baska_sekme");
      if (!x) throw new Error("yok");
      return x;
    });
    if (d.tur === "baska_sekme") d.devral();
    await p2;
    expect(await sonuc1).toBe("iptal_edildi");
    expect(o1.cekirdek.kosular.size).toBe(0);                          // A devami hic oynatmadi
  });
});

describe("kapanis duzeltmeleri (Z1, Z2, Z4)", () => {
  const olcekli = (locks: SahteKilitler, yayin: SahteYayin): SekmeOrtami => ({ locks, kanalUret: yayin.uret, bekle: (ms) => new Promise((r) => setTimeout(r, ms / 100)) });

  it("Z1_zarif_devir_zaman_asimini_asip_kilit_calinirsa_eski_sekmede_IndexedDB_HEMEN_kapanir", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const idb = yeniIdb();
    const o1 = oturum(idb, "#/kurucu", { sekme: olcekli(locks, yayin) });
    const k1 = await ac(o1);
    const id = await oyna(k1, 2);
    vi.spyOn(k1.kopru, "bosalt").mockImplementation(() => new Promise((r) => setTimeout(r, 700)));   // zarif devir 20 sn siniri (olcekli 200 ms) asar
    const o2 = oturum(idb, "#/kurucu", { sekme: olcekli(locks, yayin) });
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((y) => y.tur === "baska_sekme");
      if (!x) throw new Error("yok");
      return x;
    });
    if (d.tur === "baska_sekme") d.devral();
    await p;                                                               // yeni sekme kilidi calip yukledi; eski devir hala suruyor (700 ms)
    await expect(k1.kayit.depo.haftalarYaz(id, [{ week: 55, run_id: id }])).rejects.toBeDefined();
  });

  it("Z2_kayit_acildiktan_sonra_iptal_gorulurse_IndexedDB_baglantisi_kapatilir", async () => {
    const gercek = yeniIdb();
    let acildi = false;
    const idb = new Proxy(gercek, {
      get(t, k) {
        if (k === "open") return (...a: Parameters<IDBFactory["open"]>) => ((acildi = true), t.open(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    const kapat = vi.spyOn(IDBDatabase.prototype, "close");
    const o = oturum(idb as IDBFactory, "#/kurucu", { iptalEdildi: () => acildi });
    await expect(tarayiciKaynagiKur(o.secenek)).rejects.toMatchObject({ kod: "iptal_edildi" });
    expect(kapat).toHaveBeenCalled();
    kapat.mockRestore();
  });

  it("Z4_normal_kapat_uzun_isi_beklemez_Worker_hemen_kapanir", async () => {
    const o = oturum(yeniIdb(), "#/kurucu");
    const k = await tarayiciKaynagiKur(o.secenek);
    void k.kopru.uzunIs(() => new Promise(() => undefined));              // dakikalar suren kayittan acma gibi
    await new Promise((r) => setTimeout(r, 20));
    await Promise.race([k.kapat(), new Promise((_, red) => setTimeout(() => red(new Error("kapat_asili")), 1500))]);
    expect(o.worker.sonlandi).toBeGreaterThan(0);
  });
});

async function ac2(idb: IDBFactory): Promise<TarayiciKaynagi> {
  return ac(oturum(idb, "#/kurucu"));
}

// ---- B7: onceki model paketi secimi ve yeni surum uygulamasi icin kayit tamamlama ---------------------------------

const ESKI = "a".repeat(64);      // SahteCekirdek ANAHTAR.model_sha256: kayitlarin yazildigi model
const YENI = "b".repeat(64);

/** Service Worker sahtesi: duz manifest `guncel`; `?model=<sha>` yalniz `tutulan` modellerde o modeli, aksi halde guncel manifesti doner. */
function manifestAgi(guncel: string, tutulan: string[]): { fetch: (g: string) => Promise<Response>; istekler: string[] } {
  const istekler: string[] = [];
  return {
    istekler,
    fetch: async (girdi) => {
      istekler.push(girdi);
      const model = new URL(girdi).searchParams.get("model");
      const m = model !== null && tutulan.includes(model) ? model : guncel;
      return new Response(JSON.stringify({ model_sha256: m }), { status: 200 });
    },
  };
}

const yukleUrl = (o: Oturum): string => (o.worker.mesajlar.find((m) => (m as { t: string }).t === "yukle") as unknown as { girdi: { manifestUrl: string } }).girdi.manifestUrl;

describe("B7: onceki model paketi secimi", () => {
  async function kayitliOyun(): Promise<{ idb: IDBFactory; id: string }> {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    return { idb, id };
  }

  it("hash_kosusu_eski_modelle_yazilmis_ve_SW_onceki_paketi_tutuyorsa_manifest_model_sorgusuyla_istenir_ve_kayit_devam_eder", async () => {
    const { idb, id } = await kayitliOyun();
    const ag = manifestAgi(YENI, [ESKI]);
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: ag.fetch });
    const k2 = await ac(o2);
    expect(yukleUrl(o2)).toBe(`http://h/oyun/manifest.json?model=${ESKI}`);
    expect(o2.cekirdek.kosular.has(id)).toBe(true);
    expect(k2.kopru.calisiyor).toBe(true);
  });

  it("SW_onceki_paketi_tutmuyorsa_guncel_manifest_istenir_eski_davranis", async () => {
    const { idb, id } = await kayitliOyun();
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: manifestAgi(YENI, []).fetch });
    await ac(o2);
    expect(yukleUrl(o2)).toBe("http://h/oyun/manifest.json");
  });

  it("model_ayniysa_sorgu_eklenmez", async () => {
    const { idb, id } = await kayitliOyun();
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: manifestAgi(ESKI, [ESKI]).fetch });
    await ac(o2);
    expect(yukleUrl(o2)).toBe("http://h/oyun/manifest.json");
  });

  it("fetch_verilmezse_ve_kayit_yoksa_hic_manifest_sorgusu_yapilmaz", async () => {
    const ag = manifestAgi(YENI, [ESKI]);
    const o = oturum(yeniIdb(), "#/canli/yok", { fetch: ag.fetch });
    await ac(o);
    expect(ag.istekler).toEqual([]);
    expect(yukleUrl(o)).toBe("http://h/oyun/manifest.json");
  });

  it("ev_rotasi_model_farkliysa_soru_yukleme_ONCESI_sorulur_devam_eski_paketle_yeni_oyun_guncel_paketle", async () => {
    const { idb, id } = await kayitliOyun();
    // devam
    const o2 = oturum(idb, "#/", { fetch: manifestAgi(YENI, [ESKI]).fetch });
    const p2 = ac(o2);
    const s2 = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    expect(o2.worker.mesajlar).toEqual([]);                         // Worker daha baslamadi
    if (s2.tur === "secim") s2.devam();
    await p2;
    expect(yukleUrl(o2)).toBe(`http://h/oyun/manifest.json?model=${ESKI}`);
    expect(o2.durumlar.filter((d) => d.tur === "secim")).toHaveLength(1);   // devam akisi tekrar sormadi
    expect(o2.hashlar).toEqual([`#/canli/${id}`]);
    expect(o2.cekirdek.kosular.has(id)).toBe(true);
    await acik.pop()!.kapat();
    // yeni oyun
    const o3 = oturum(idb, "#/", { fetch: manifestAgi(YENI, [ESKI]).fetch });
    const p3 = ac(o3);
    const s3 = await vi.waitFor(() => {
      const s = o3.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    if (s3.tur === "secim") s3.yeni();
    await p3;
    expect(yukleUrl(o3)).toBe("http://h/oyun/manifest.json");
    expect(o3.cekirdek.kosular.size).toBe(0);
    expect(o3.durumlar.filter((d) => d.tur === "secim")).toHaveLength(1);
  });

  it("ev_rotasi_model_ayniysa_soru_eskisi_gibi_yukleme_sonrasi", async () => {
    const { idb } = await kayitliOyun();
    const o2 = oturum(idb, "#/", { fetch: manifestAgi(ESKI, []).fetch });
    const p = ac(o2);
    const s = await vi.waitFor(() => {
      const x = o2.durumlar.find((d) => d.tur === "secim");
      if (!x) throw new Error("secim_yok");
      return x;
    });
    expect(o2.worker.mesajlar.length).toBeGreaterThan(0);           // Worker yuklendi, soru sonradan
    if (s.tur === "secim") s.yeni();
    await p;
  });
});

describe("B7: yeni surum uygulamasi icin kayit tamamlama", () => {
  it("kayitTamamla_donguyu_durdurur_bekleyen_yoksa_true_surdur_donguyu_yeniden_baslatir", async () => {
    const k = await ac(oturum(yeniIdb(), "#/kurucu"));
    expect(k.kopru.calisiyor).toBe(true);
    expect(await k.kayitTamamla()).toBe(true);
    expect(k.kopru.calisiyor).toBe(false);
    k.surdur();
    expect(k.kopru.calisiyor).toBe(true);
  });

  it("bekleyen_yazim_varsa_false_uygulama_yapilmamali", async () => {
    const k = await ac(oturum(yeniIdb(), "#/kurucu"));
    vi.spyOn(k.kopru, "bekleyenYazim").mockReturnValue(2);
    expect(await k.kayitTamamla()).toBe(false);
  });

  it("devredilmis_sekmede_false", async () => {
    const k = await ac(oturum(yeniIdb(), "#/kurucu"));
    await k.kapat();
    expect(await k.kayitTamamla()).toBe(false);
  });
});

describe("B7 duzeltme turu 1", () => {
  it("Y1: kayitTamamla askidaki gunluk yazimini bekler; kosu basina gunluk senkronu ve son yazici.tick (goruntu) calisir; dongu once durur", async () => {
    const k = await ac(oturum(yeniIdb(), "#/kurucu"));
    const r = await k.kopru.fetch("/api/runs", { method: "POST", body: JSON.stringify({ config: {} }) });
    const id = ((await r.json()) as { runId: string }).runId;
    const sira: string[] = [];
    let askidaBitti = false;
    const yazici = k.kayit.yazici;
    const gunluk = yazici.gunlukSenkronla.bind(yazici);
    vi.spyOn(yazici, "gunlukSenkronla").mockImplementation(async (kosu, sonra) => {
      sira.push("gunluk");
      await new Promise((c) => setTimeout(c, 40));
      askidaBitti = true;
      return gunluk(kosu, sonra);
    });
    const tick = yazici.tick.bind(yazici);
    vi.spyOn(yazici, "tick").mockImplementation((kosu) => {
      sira.push(`tick:${askidaBitti}`);
      return tick(kosu);
    });
    expect(await k.kayitTamamla()).toBe(true);
    expect(k.kopru.calisiyor).toBe(false);
    expect(sira).toEqual(["gunluk", "tick:true"]);                  // tick, gunluk yazimi BITTIKTEN sonra
    expect(id).toBeTruthy();
  });

  it("Y1: gunluk yazimi hata verirse kayitTamamla false doner (uygulama yapilmaz)", async () => {
    const k = await ac(oturum(yeniIdb(), "#/kurucu"));
    await k.kopru.fetch("/api/runs", { method: "POST", body: JSON.stringify({ config: {} }) });
    vi.spyOn(k.kayit.yazici, "gunlukSenkronla").mockRejectedValue(new Error("idb"));
    expect(await k.kayitTamamla()).toBe(false);
  });

  it("Y3: eski paketle acilmis oturumda yeni oyun KURULMAZ (409), sayfa yenileme istenir; kayitli oyun suruyor", async () => {
    const { idb, id } = await (async () => {
      const idb = yeniIdb();
      const k1 = await ac(oturum(idb, "#/kurucu"));
      const id = await oyna(k1, 3);
      await k1.kapat();
      return { idb, id };
    })();
    const yenile = vi.fn();
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: manifestAgi(YENI, [ESKI]).fetch, yeniOyunIcinYenile: yenile });
    const k2 = await ac(o2);
    expect(k2.eskiPaket).toBe(true);
    const once = o2.cekirdek.kosular.size;
    const r = await k2.kopru.fetch("/api/runs", { method: "POST", body: JSON.stringify({ config: {} }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("yeni_surum_gerek");
    expect(yenile).toHaveBeenCalledOnce();
    expect(o2.cekirdek.kosular.size).toBe(once);
    expect(await (await k2.kopru.fetch(`/api/runs/${id}`)).status).toBe(200);
  });

  it("Y3: guncel paketle acilmis oturumda yeni oyun normal kurulur", async () => {
    const yenile = vi.fn();
    const k = await ac(oturum(yeniIdb(), "#/kurucu", { yeniOyunIcinYenile: yenile }));
    expect(k.eskiPaket).toBe(false);
    const r = await k.kopru.fetch("/api/runs", { method: "POST", body: JSON.stringify({ config: {} }) });
    expect(r.status).toBeLessThan(300);
    expect(yenile).not.toHaveBeenCalled();
  });

  it("R2-1 savunma: kayit guncel modelde, yuklu paket eskiyse tariften oynatma kaydi asagi yazmaz; sayfa yeniden yuklenir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);                 // kayit ESKI ("a") modelle yazildi; goruntu yok -> tariften_gerek
    await k1.kapat();
    const yenile = vi.fn();
    const yeniOyun = vi.fn();
    const ag = manifestAgi(ESKI, []);              // guncel manifest = kaydin modeli
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: ag.fetch, kayitIcinYenile: yenile, yeniOyunIcinYenile: yeniOyun, yenilemeBeklemeMs: 5 }, (c) => (c.anahtar = { ...c.anahtar, model_sha256: YENI })); // yuklu paket "b"
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((e) => e.tur === "devam_olmadi");
      if (!x) throw new Error("devam_olmadi_yok");
      return x;
    });
    expect(yenile).toHaveBeenCalledWith(id);       // R3-1: kayit icin yenileme (rota korunur), yeni oyun yenilemesi DEGIL
    expect(yeniOyun).not.toHaveBeenCalled();
    expect(o2.hashlar).toEqual([]);                // hash kosunun rotasinda kalir
    if (d.tur === "devam_olmadi") d.yeni();
    await p;
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).not.toContain("tariftenOynat");
    const k = await (await KayitDeposu.ac(idb)).kosuOku(id);
    expect(k?.modelAnahtari.model_sha256).toBe(ESKI);
  });

  it("Y1: DAO kosusunda yeniden_yukle_gerek yolunda hash once #/dao/ rotasina yazilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/dao", {}, daoKosuKur));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const sira: string[] = [];
    const o2 = oturum(idb, "", { fetch: manifestAgi(ESKI, []).fetch, kayitIcinYenile: (k) => sira.push(`yenile:${k}`), yenilemeBeklemeMs: 5 }, (c) => (c.anahtar = { ...c.anahtar, model_sha256: YENI }));
    o2.secenek.hashYaz = (h) => sira.push(`hash:${h}`);
    const p = ac(o2);
    const secim = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    if (secim.tur === "secim") secim.devam();
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((e) => e.tur === "devam_olmadi");
      if (!x) throw new Error("devam_olmadi_yok");
      return x;
    });
    expect(sira).toEqual([`hash:#/dao/${id}`, `yenile:${id}`]);
    if (d.tur === "devam_olmadi") d.yeni();
    await p;
  });

  it("R3-1: ev rotasinda devam secilip yeniden yukleme gerekirse hash ONCE kosunun rotasina yazilir (yenileme kosuya doner)", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const sira: string[] = [];
    const o2 = oturum(idb, "", { fetch: manifestAgi(ESKI, []).fetch, kayitIcinYenile: (k) => sira.push(`yenile:${k}`), yenilemeBeklemeMs: 5 }, (c) => (c.anahtar = { ...c.anahtar, model_sha256: YENI }));
    o2.secenek.hashYaz = (h) => sira.push(`hash:${h}`);
    const p = ac(o2);
    const secim = await vi.waitFor(() => {
      const s = o2.durumlar.find((d) => d.tur === "secim");
      if (!s) throw new Error("secim_yok");
      return s;
    });
    if (secim.tur === "secim") secim.devam();
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((e) => e.tur === "devam_olmadi");
      if (!x) throw new Error("devam_olmadi_yok");
      return x;
    });
    expect(sira).toEqual([`hash:#/canli/${id}`, `yenile:${id}`]);
    if (d.tur === "devam_olmadi") d.yeni();          // yenileme olmadiysa "yeni oyun": hash eve doner
    await p;
    expect(sira.at(-1)).toBe("hash:#/");
  });
});

describe("B8: acilis secimleri (uyumsuz, tariften_gerek, durdu), ilerleme ve iptal", () => {
  type DO = Extract<AcilisDurumu, { tur: "devam_olmadi" }>;
  const secimBekle = (o: Oturum): Promise<DO> =>
    vi.waitFor(() => {
      const x = o.durumlar.filter((e): e is DO => e.tur === "devam_olmadi").at(-1);
      if (!x) throw new Error("devam_olmadi_yok");
      return x;
    });

  /** 30 hafta oynanmis kayit (goruntu 13 ve 26'da); ikinci oturumda cekirdegin model anahtari farkli: goruntu uyumsuz. */
  async function uyumsuzKayit(): Promise<{ idb: IDBFactory; id: string }> {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 30);
    await k1.kapat();
    return { idb, id };
  }
  const yeniModel = (c: SahteCekirdek): void => {
    c.anahtar = { ...c.anahtar, model_sha256: "b".repeat(64) };
  };

  it("uyumsuz_goruntu_secim_ekrani_acar_tahmini_sure_ve_secenekler_sessiz_yeniden_oynatma_yok", async () => {
    const { idb, id } = await uyumsuzKayit();
    const o2 = oturum(idb, `#/canli/${id}`, {}, yeniModel);
    const p = ac(o2);
    const d = await secimBekle(o2);
    expect(d.sonuc).toMatchObject({ sonuc: "uyumsuz", tur: "surum" });
    expect(d.kosuId).toBe(id);
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).not.toContain("tariftenOynat");
    d.yeni();
    await p;
  });

  it("tariften_oynat_ilerleme_hafta_x_y_ve_iptal_ile_devam_sonra_kayit_yeni_modelle_yazilir_hash_yazilir", async () => {
    const { idb, id } = await uyumsuzKayit();
    const o2 = oturum(idb, "", {}, yeniModel);
    const p = ac(o2);
    const s = await vi.waitFor(() => {
      const x = o2.durumlar.find((d) => d.tur === "secim");
      if (!x) throw new Error("secim_yok");
      return x;
    });
    if (s.tur === "secim") s.devam();
    const d = await secimBekle(o2);
    const once = o2.durumlar.length;
    d.tariftenOynat();
    await p;
    const devamlar = o2.durumlar.slice(once).filter((x) => x.tur === "devam");
    expect(devamlar.length).toBeGreaterThan(0);
    const ilk = devamlar[0];
    expect(ilk?.tur === "devam" && ilk.hedef).toBeGreaterThanOrEqual(30);
    expect(ilk?.tur === "devam" && typeof ilk.iptal).toBe("function");
    expect(ilk?.tur === "devam" && ilk.tahmini?.hafta).toBeGreaterThanOrEqual(30);
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).toContain("tariftenOynat");
    expect(o2.hashlar.at(-1)).toBe(`#/canli/${id}`);
    const kayit = await (await KayitDeposu.ac(idb)).kosuOku(id);
    expect(kayit?.modelAnahtari.model_sha256).toBe("b".repeat(64));
  });

  it("iptal_kaydi_silmez_hash_eve_doner_ve_sayfa_yeniden_yuklenir", async () => {
    const { idb, id } = await uyumsuzKayit();
    const yenile = vi.fn();
    const o2 = oturum(idb, `#/canli/${id}`, { yenile }, yeniModel);
    const p = ac(o2);
    const d = await secimBekle(o2);
    d.tariftenOynat();
    const dd = await vi.waitFor(() => {
      const x = o2.durumlar.filter((e) => e.tur === "devam").at(-1);
      if (!x || x.tur !== "devam" || x.iptal === undefined) throw new Error("iptal_yok");
      return x;
    });
    if (dd.tur === "devam") dd.iptal?.();
    expect(yenile).toHaveBeenCalledTimes(1);
    expect(o2.hashlar).toContain("#/");
    expect(await (await KayitDeposu.ac(idb)).kosuOku(id)).not.toBeNull();
    void p.catch(() => undefined);
  });

  it("disa_aktar_dosya_dondurur_sil_kaydi_kaldirir_ve_yeni_oyuna_gecer_hash_temizlenir", async () => {
    const { idb, id } = await uyumsuzKayit();
    const o2 = oturum(idb, `#/canli/${id}`, {}, yeniModel);
    const p = ac(o2);
    const d = await secimBekle(o2);
    const dosya = await d.disaAktar();
    expect(JSON.parse(dosya.metin)).toMatchObject({ bicim: "daoliberal-kayit" });
    expect(dosya.ad).toMatch(/\.json$/);
    await d.sil();
    await p;
    expect(await (await KayitDeposu.ac(idb)).kosuOku(id)).toBeNull();
    expect(o2.hashlar).toEqual(["#/"]);
  });

  it("durdu_sonrasi_tariften_oynat_cagrilmaz_yalniz_disa_aktar_sil_yeni_sunulur_K9", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kayit.depo.gunlukYaz(id, [{ sira: 1, tur: "karar", dikis: 1, karar: { alan: "x" } }]);
    await k1.kapat();
    const o2 = oturum(idb, `#/canli/${id}`, {}, (c) => {
      c.reddet = 1;
    });
    const p = ac(o2);
    const d = await secimBekle(o2);
    expect(d.sonuc.sonuc).toBe("durdu");
    const { acilisSecimi } = await import("@/oyun/tarayici/acilisEslemesi");
    expect(acilisSecimi(d.sonuc).secenekler).toEqual(["disa_aktar", "sil", "yeni"]);
    d.yeni();
    await p;
  });

  it("uzun_goruntusuz_kayit_sormadan_baslatilmaz_secim_ekrani_tahminle_acilir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kayit.depo.kosuGuncelle(id, (x) => ({ ...x, yayimlanan: 40 }));
    await k1.kapat();
    const o2 = oturum(idb, `#/canli/${id}`);
    const p = ac(o2);
    const d = await secimBekle(o2);
    expect(d.sonuc).toMatchObject({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 40 });
    expect(o2.durumlar.filter((x) => x.tur === "devam").every((x) => x.tur === "devam" && x.uzun === true)).toBe(true);
    d.yeni();
    await p;
  });

  it("kisa_goruntusuz_kayit_sormadan_baştan_oynatilir_devam_ekraninda_tahmin_ve_iptal_vardir", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 5);
    await k1.kapat();
    const o2 = oturum(idb, `#/canli/${id}`);
    await ac(o2);
    const dv = o2.durumlar.filter((x) => x.tur === "devam");
    expect(dv.length).toBeGreaterThan(0);
    expect(dv.every((x) => x.tur === "devam" && typeof x.iptal === "function" && x.tahmini !== undefined && x.uzun === false)).toBe(true);
    expect(o2.durumlar.some((x) => x.tur === "devam_olmadi")).toBe(false);
  });

  it("yeniden_yukle_gerek_once_notr_surum_yukleniyor_sonra_secim_ekrani", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const yenile = vi.fn();
    const o2 = oturum(idb, `#/canli/${id}`, { fetch: manifestAgi(ESKI, []).fetch, kayitIcinYenile: yenile, yenilemeBeklemeMs: 20 }, (c) => (c.anahtar = { ...c.anahtar, model_sha256: YENI }));
    const p = ac(o2);
    const d = await secimBekle(o2);
    const i1 = o2.durumlar.findIndex((x) => x.tur === "surum_yukleniyor");
    const i2 = o2.durumlar.findIndex((x) => x.tur === "devam_olmadi");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i2);
    expect(yenile).toHaveBeenCalledWith(id);
    d.yeni();
    await p;
  });
});

describe("B8 Y2/K1: acilis akisi", () => {
  it("Y2_kaydin_modeli_yuklu_modelden_farkli_kisa_goruntusuz_kayit_sorulur_model_anahtari_degismez", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    const o2 = oturum(idb, `#/canli/${id}`, {}, yeniModelAnahtari);
    const p = ac(o2);
    const d = await vi.waitFor(() => {
      const x = o2.durumlar.find((e) => e.tur === "devam_olmadi");
      if (!x || x.tur !== "devam_olmadi") throw new Error("yok");
      return x;
    });
    expect(d.sonuc).toMatchObject({ sonuc: "uyumsuz", tur: "surum" });
    expect(o2.cekirdek.cagrilar.map((c) => c.yontem)).not.toContain("tariftenOynat");
    expect((await (await KayitDeposu.ac(idb)).kosuOku(id))?.modelAnahtari.model_sha256).toBe("a".repeat(64));
    d.yeni();
    await p;
  });

  it("sonuc_ve_dao_rotalari_acilista_ayni_secim_ekranini_acar", async () => {
    const idb = yeniIdb();
    const k1 = await ac(oturum(idb, "#/kurucu"));
    const id = await oyna(k1, 3);
    await k1.kapat();
    for (const hash of [`#/sonuc/${id}`, `#/dao/${id}`]) {
      const o2 = oturum(idb, hash, {}, yeniModelAnahtari);
      const p = ac(o2);
      const d = await vi.waitFor(() => {
        const x = o2.durumlar.find((e) => e.tur === "devam_olmadi");
        if (!x || x.tur !== "devam_olmadi") throw new Error("yok");
        return x;
      });
      expect(d.kosuId).toBe(id);
      d.yeni();
      await p;
    }
  });
});
function yeniModelAnahtari(c: SahteCekirdek): void {
  c.anahtar = { ...c.anahtar, model_sha256: "b".repeat(64) };
}
