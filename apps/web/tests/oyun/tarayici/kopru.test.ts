// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { kayitKatmaniAc, type KayitKatmani } from "@/oyun/tarayici/kayit";
import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import { TarayiciKopru, type Uyari } from "@/oyun/tarayici/kopru";
import { tahminiOynatma } from "@/oyun/tarayici/kayit/siniflandirma";
import { SahteCekirdek } from "./kayit/yardimci";
import { yeniIdb } from "./kayit/yardimci";
import { SahteIsci, ertele } from "./yardimci";

interface Yigin {
  cekirdek: SahteCekirdek;
  isci: SahteIsci;
  kayit: KayitKatmani;
  kopru: TarayiciKopru;
  hatalar: [string, unknown][];
}

const acik: Yigin[] = [];
async function kur(): Promise<Yigin> {
  const cekirdek = new SahteCekirdek();
  const isci = new SahteIsci(cekirdek);
  const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
  const hatalar: [string, unknown][] = [];
  const kopru = new TarayiciKopru({ isci, kayit, hata: (k, e) => hatalar.push([k, e]) });
  const y = { cekirdek, isci, kayit, kopru, hatalar };
  acik.push(y);
  return y;
}
afterEach(async () => {
  for (const y of acik.splice(0)) {
    await y.kopru.durdur();
    y.kayit.depo.kapat();
  }
});

interface Yanit {
  runId: string;
  live: boolean;
  error: { code: string };
}
async function json<T = Yanit>(r: Response): Promise<T> {
  return JSON.parse(await r.text()) as T;
}
const POST = (govde: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(govde), headers: { "X-Oyun-Istek": "1" } });
const sonraki = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function bekle(kosul: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const son = Date.now() + ms;
  while (!(await kosul())) {
    if (Date.now() > son) throw new Error("zaman_asimi");
    await sonraki(2);
  }
}

describe("fetchImpl: HTTP rotalari Worker istegine", () => {
  it("GET_hello_yanit_JSON_status_ve_icerik_turu", async () => {
    const { kopru, isci } = await kur();
    const r = await kopru.fetch("/api/hello", { method: "GET", headers: { Accept: "application/json" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect((await json(r)).live).toBe(true);
    expect(isci.cagrilar[0]).toEqual({ y: "istek", a: { yontem: "GET", yol: "/api/hello", govde: undefined, arsiv: undefined } });
  });

  it("POST_govdesi_ayrisir_204_govdesiz_404_sunucu_gibi_gecer", async () => {
    const { kopru, isci } = await kur();
    const r1 = await kopru.fetch("/api/runs", POST({ config: { a: 1 } }));
    expect(r1.status).toBe(201);
    const id = (await json(r1)).runId as string;
    expect((isci.cagrilar[0]?.a as { govde: unknown }).govde).toEqual({ config: { a: 1 } });
    const r2 = await kopru.fetch(`/api/runs/${id}`, { method: "DELETE" });
    expect(r2.status).toBe(204);
    expect(await r2.text()).toBe("");
    const r3 = await kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    expect(r3.status).toBe(404);
    expect((await json(r3)).error.code).toBe("not_found");
  });

  it("api_disi_yol_404_ve_iptal_edilmis_sinyal_AbortError", async () => {
    const { kopru, isci } = await kur();
    expect((await kopru.fetch("/baska")).status).toBe(404);
    expect(isci.cagrilar).toEqual([]);
    const c = new AbortController();
    c.abort();
    await expect(kopru.fetch("/api/hello", { signal: c.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("Worker_dustugunde_ve_cekirdek_hatasinda_500_doner_sunucu_yok_degil_neden_kodda", async () => {
    const { kopru, isci } = await kur();
    isci.dusur = new Error("kapali");
    const r = await kopru.fetch("/api/hello");
    expect(r.status).toBe(500);
    expect((await json(r)).error.code).toBe("kopru_hatasi");
  });

  it("bekleyen_istek_AbortSignal_ile_birakilir", async () => {
    const { kopru, isci } = await kur();
    const kapi = ertele();
    isci.tickKapisi = () => kapi.promise;
    const c = new AbortController();
    kopru.baslat();
    await bekle(() => isci.cagrilar.some((x) => x.y === "tick"));
    const p = kopru.fetch("/api/hello", { signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    kapi.coz();
    await kopru.durdur();
  });
});

describe("kosu yaratma: kayit + HEMEN kalicilik aboneligi", () => {
  it("POST_runs_kosuBaslat_ve_abone_yanit_donmeden_once_hazir", async () => {
    const { kopru, isci, kayit } = await kur();
    const r = await kopru.fetch("/api/runs", POST({ config: {} }));
    const id = (await json(r)).runId as string;
    expect(await kayit.depo.kosuOku(id)).not.toBeNull();
    const yollar = isci.cagrilar.filter((c) => c.y === "istek").map((c) => `${(c.a as { yontem: string }).yontem} ${(c.a as { yol: string }).yol}`);
    expect(yollar).toEqual(["POST /api/runs", `GET /api/runs/${id}/events`]);
    expect(isci.aboneler.size).toBe(1);
  });

  it("dal_rotasi_ebeveyn_baglantisiyla_yeni_kosuyu_kaydeder_ve_abone_olur", async () => {
    const { kopru, kayit, isci } = await kur();
    const a = (await json(await kopru.fetch("/api/runs", POST({ config: {} })))).runId as string;
    const b = (await json(await kopru.fetch(`/api/runs/${a}/branch`, POST({ week: 7 })))).runId as string;
    expect(b).not.toBe(a);
    expect((await kayit.depo.kosuOku(b))?.ebeveyn).toEqual([a, 7]);
    expect(isci.aboneler.size).toBe(2);
  });

  it("hatali_olusturma_yaniti_kayit_acmaz", async () => {
    const { kopru, isci, kayit } = await kur();
    isci.yanitlar.set("POST /api/runs", { status: 422, headers: {}, body: { error: { code: "x" } } });
    expect((await kopru.fetch("/api/runs", POST({}))).status).toBe(422);
    expect(await kayit.depo.kosulariListele()).toEqual([]);
    expect(isci.aboneler.size).toBe(0);
  });

  it("kosuBaslat_hatasi_oyunu_kesmez_hata_bildirilir", async () => {
    const { kopru, kayit, hatalar } = await kur();
    vi.spyOn(kayit.yazici, "kosuBaslat").mockRejectedValue(new Error("idb"));
    expect((await kopru.fetch("/api/runs", POST({}))).status).toBe(201);
    expect(hatalar.map((h) => h[0])).toEqual(["kosu_baslat"]);
  });
});

describe("kalicilik sirasi ve dayanikliligi (Ö2, Ö3)", () => {
  it("dal_kucuk_haftada_abonelik_penceresindeki_haftalar_kayda_yazilir_kayip_yok", async () => {
    const { kopru, isci, kayit } = await kur();
    const a = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    isci.branchHaftalari = 3;
    const d = (await json(await kopru.fetch(`/api/runs/${a}/branch`, POST({ week: 3 })))).runId;
    await bekle(async () => (await kayit.depo.paketSayisi(d)) === 3);
    expect((await kayit.depo.paketAraligi(d, 1, 3)).map((p) => p.week)).toEqual([1, 2, 3]);
    // kayit, abonelikten ONCE acilmisti (istek sirasi)
    const istekler = isci.cagrilar.filter((c) => c.y === "istek").map((c) => (c.a as { yol: string }).yol);
    expect(istekler.indexOf(`/api/runs/${d}/events`)).toBeGreaterThan(istekler.indexOf(`/api/runs/${a}/branch`));
  });

  it("kosuBaslat_basarisizsa_gorunur_uyari_haftalar_bellekte_bekler_kayit_kendini_acinca_yazilir", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u) });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    vi.spyOn(kayit.yazici, "kosuBaslat").mockRejectedValueOnce(new Error("idb"));
    isci.branchHaftalari = 2;
    const a = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    expect(uyarilar).toEqual([{ tur: "kayit_acilamadi", kosuId: a }]);
    const d = (await json(await kopru.fetch(`/api/runs/${a}/branch`, POST({ week: 2 })))).runId;
    await bekle(async () => (await kayit.depo.paketSayisi(d)) === 2);
  });

  it("hafta_yazimi_hata_verirse_bellekte_bekler_uyari_sonraki_turda_yeniden_denenir_delik_olusmaz", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u) });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    const gercek = kayit.yazici.haftalarOlayi.bind(kayit.yazici);
    let hata = 3;                                                 // ilk drenajin 3 denemesi de basarisiz
    vi.spyOn(kayit.yazici, "haftalarOlayi").mockImplementation(async (k, p) => {
      if (hata-- > 0) throw new Error("gecici_idb");
      return gercek(k, p);
    });
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    kopru.baslat();
    await bekle(() => uyarilar.some((u) => u.tur === "kayit_yazilamadi"));
    await bekle(() => uyarilar.some((u) => u.tur === "kayit_duzeldi"));
    await bekle(async () => (await kayit.depo.paketSayisi(id)) >= 4);
    await kopru.durdur();
    const haftalar = (await kayit.depo.paketAraligi(id, 1, 99)).map((p) => p.week);
    expect(haftalar).toEqual(haftalar.map((_, i) => i + 1));      // 1..n, delik yok
  });
});

describe("tick dongusu: bosta siniflamasi, gunluk, bariyer, olu Worker", () => {
  it("onceden_hesaplanmis_hafta_yayimi_bosta_degildir_yazici_tick_her_turda_calisir", async () => {
    const { kopru, isci, kayit } = await kur();
    isci.tickMs = 5;                                              // hesapsiz yayim: kisa sure ama week olayi var
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const tick = vi.spyOn(kayit.yazici, "tick");
    kopru.baslat();
    await bekle(() => isci.cagrilar.filter((c) => c.y === "tick").length >= 6);
    await kopru.durdur();
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(5);     // 2 sn bosta kapisina takilsaydi 1-2 olurdu
  });

  it("Worker_sessiz_kalirsa_olu_sayilir_kapatilir_dustu_bildirilir", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    isci.tickKapisi = () => new Promise(() => undefined);
    isci.bekleyenCagri = 1;                                            // yanit bekleyen cagri var, hic mesaj gelmiyor
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const dustu = vi.fn();
    const kopru = new TarayiciKopru({ isci, kayit, dustu, sessizlikAsimiMs: 60, bekciYoklamaMs: 15 });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    kopru.baslat();
    await bekle(() => dustu.mock.calls.length === 1);
    expect(isci.kapatildi).toBe(true);
    expect(kopru.calisiyor).toBe(false);
  });

  it("uzun_cagri_ilerleme_mesajlari_yaydikca_bekci_sessizlik_saymaz_dusme_yok", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    isci.tickKapisi = () => new Promise(() => undefined);
    isci.bekleyenCagri = 1;
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const dustu = vi.fn();
    const kopru = new TarayiciKopru({ isci, kayit, dustu, sessizlikAsimiMs: 60, bekciYoklamaMs: 15 });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    kopru.baslat();
    const ilerleme = setInterval(() => isci.mesajlar++, 10);          // sinirin ~5 kati sure boyunca ilerleme olayi
    await sonraki(320);
    clearInterval(ilerleme);
    expect(dustu).not.toHaveBeenCalled();
    isci.tickKapisi = null;
    await sonraki(150);                                                // ilerleme kesildi: sessizlik birikir
    expect(dustu).toHaveBeenCalledTimes(1);
  });

  it("uzun_is_suresince_tick_gonderilmez_bitince_surer", async () => {
    const { kopru, isci } = await kur();
    const bit = ertele();
    kopru.baslat();
    await bekle(() => isci.cagrilar.some((c) => c.y === "tick"));
    const p = kopru.uzunIs(() => bit.promise);
    await sonraki(30);
    const n = isci.cagrilar.filter((c) => c.y === "tick").length;
    await sonraki(60);
    expect(isci.cagrilar.filter((c) => c.y === "tick").length).toBeLessThanOrEqual(n + 1);   // en cok suren tick; yenisi yok
    bit.coz(undefined);
    await p;
    await bekle(() => isci.cagrilar.filter((c) => c.y === "tick").length > n + 1);
    await kopru.durdur();
  });

  it("yanit_kalici_yazimdan_once_verilmez_bariyer", async () => {
    const { kopru, isci, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    let yazildi = false;
    const gercek = kayit.yazici.haftalarOlayi.bind(kayit.yazici);
    vi.spyOn(kayit.yazici, "haftalarOlayi").mockImplementation(async (k, p) => {
      await sonraki(40);
      await gercek(k, p);
      yazildi = true;
    });
    const kapi = ertele();
    isci.tickKapisi = () => kapi.promise;
    kopru.baslat();
    await bekle(() => isci.cagrilar.some((c) => c.y === "tick"));
    const yanit = kopru.fetch("/api/hello");                       // tick'ten SONRA siraya girer
    kapi.coz();
    await yanit;
    expect(yazildi).toBe(true);
    isci.tickKapisi = null;
    await kopru.durdur();
  });

  it("p50_acilista_cekirdege_verilebilsin_diye_IndexedDB_meta_a_yazilir", async () => {
    const { kopru, isci, kayit } = await kur();
    isci.tickMs = 4000;
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    kopru.baslat();
    await bekle(async () => (await kayit.depo.metaOku<number>("p50")) === 4);
    await kopru.durdur();
  });
});

describe("Y4/Y5: kayittan acma paylasimi, kuyruk siniri, bitis", () => {
  it("ayni_kimlik_icin_ikinci_GET_surenin_bitmesini_bekler_404_almaz_ilerleme_uyarisi", async () => {
    const { isci, kayit, cekirdek } = await kur();
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u) });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = "canli-eski";
    await kayit.depo.kosuOlustur({ kosuId: id, tarif: { config: {}, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null }, modelAnahtari: { model_sha256: "a".repeat(64), pyodide: "0.27.7", schema: 2, host_sema: 1 }, ebeveyn: null, kaynak: "yerel", yayimlanan: 9, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 });
    const kapi = ertele();
    vi.spyOn(kayit.akis, "devamEt").mockImplementation(async (_k, o) => {
      o?.ilerleme?.(4);
      await kapi.promise;
      isci.kosular.set(id, { id, oynuyor: false, pencereTaban: 0 });
      cekirdek.kosuYarat(id);
      return { sonuc: "tamam", kosuId: id, hafta: 9, uygulanan: 9, kalan: 0, kaynak: "tarif", goruntuHaftasi: null, genisletilmis: false };
    });
    const bir = kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    await bekle(() => uyarilar.some((u) => u.tur === "acilis_suruyor"));
    const iki = kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    await sonraki(20);
    kapi.coz();
    expect([(await bir).status, (await iki).status]).toEqual([200, 200]);
    expect(uyarilar).toContainEqual({ tur: "acilis_suruyor", kosuId: id, hafta: 4, hedef: 9 });
    expect(uyarilar.at(-1)).toEqual({ tur: "acilis_bitti", kosuId: id });
  });

  it("kuyruk_sinirina_gelince_tick_durur_en_eski_atilmaz_yazim_duzelince_delik_yok", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u), bekleyenAzami: 3 });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const gercek = kayit.yazici.haftalarOlayi.bind(kayit.yazici);
    let bozuk = true;
    vi.spyOn(kayit.yazici, "haftalarOlayi").mockImplementation(async (k, p) => {
      if (bozuk) throw new Error("idb_kapali");
      return gercek(k, p);
    });
    kopru.baslat();
    await bekle(() => uyarilar.some((u) => u.tur === "kayit_yazilamadi"));
    await sonraki(60);
    const tickler = isci.cagrilar.filter((c) => c.y === "tick").length;
    await sonraki(60);
    expect(isci.cagrilar.filter((c) => c.y === "tick").length).toBe(tickler);       // kuyruk dolu: tick durdu
    bozuk = false;
    await bekle(() => uyarilar.some((u) => u.tur === "kayit_duzeldi"), 4000);
    await bekle(async () => (await kayit.depo.paketSayisi(id)) >= tickler + 2);
    await kopru.durdur();
    const haftalar = (await kayit.depo.paketAraligi(id, 1, 999)).map((p) => p.week);
    expect(haftalar).toEqual(haftalar.map((_, i) => i + 1));                          // 1..n, delik yok
  });

  it("kosu_bitince_yazilamamis_haftalar_dusmez_kosu_takipte_kalir_sonra_yazilir", async () => {
    const { kopru, isci, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    const gercek = kayit.yazici.haftalarOlayi.bind(kayit.yazici);
    let bozuk = true;
    vi.spyOn(kayit.yazici, "haftalarOlayi").mockImplementation(async (k, p) => {
      if (bozuk) throw new Error("idb");
      return gercek(k, p);
    });
    isci.aboneler.forEach((a) => a.kuyruk.push({ id: 9, event: "week", data: { week: 1, run_id: id } }));
    isci.aboneler.forEach((a) => (a.kapali = true));                                  // koşu bitti: abonelik kapanir
    kopru.drenajPlanla();
    await sonraki(40);
    expect(await kayit.depo.paketSayisi(id)).toBe(0);
    bozuk = false;
    await kopru.bekleyenleriYaz();
    expect(await kayit.depo.paketSayisi(id)).toBe(1);
  });
});

describe("K7: kayitli ama Python'da olmayan kosu (Koşular ekranindan acma)", () => {
  it("GET_404_kayit_varsa_devamEt_ile_kurulur_istek_yinelenir_ikinci_kez_denenmez", async () => {
    const { kopru, isci, kayit, cekirdek } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kayit.depo.haftalarYaz(id, [{ week: 1, run_id: id }]);
    await kopru.fetch(`/api/runs/${id}`, { method: "GET" });         // zaten var: devam gerekmez
    isci.kosular.delete(id);                                          // Python bellegi kayboldu (yeni sayfa/eski kosu)
    cekirdek.kosular.delete(id);
    const devam = vi.spyOn(kayit.akis, "devamEt").mockImplementation(async () => {
      isci.kosular.set(id, { id, oynuyor: false, pencereTaban: 0 });
      cekirdek.kosuYarat(id);
      return { sonuc: "tamam", kosuId: id, hafta: 1, uygulanan: 1, kalan: 0, kaynak: "tarif", goruntuHaftasi: null, genisletilmis: false };
    });
    const yeni = new TarayiciKopru({ isci, kayit });
    acik.push({ cekirdek, isci, kayit, kopru: yeni, hatalar: [] });
    const r = await yeni.fetch(`/api/runs/${id}`, { method: "GET" });
    expect(r.status).toBe(200);
    expect(devam).toHaveBeenCalledTimes(1);
    expect(await kayit.depo.kosulariListele()).toHaveLength(1);       // kayit ciftlenmedi
    expect(isci.aboneler.size).toBe(2);                               // eski oturumun + yeni kalicilik abonesi (hemen)
    isci.kosular.delete(id);
    expect((await yeni.fetch(`/api/runs/${id}`, { method: "GET" })).status).toBe(404);
    expect(devam).toHaveBeenCalledTimes(1);                           // ayni kimlik bir kez denenir
  });

  it("R3-1: kayittan_acmada_yeniden_yukle_gerek_secim_icin_yenileme_ister_(rota_korunur)_yeni_oyun_yenilemesi_degil_409", async () => {
    const { isci, kayit, cekirdek } = await kur();
    const kayitIcin = vi.fn();
    const yeniOyun = vi.fn();
    const kopru = new TarayiciKopru({ isci, kayit, eskiPaket: true, kayitSecimiIcin: kayitIcin, yeniOyunIcinYenile: yeniOyun });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = "canli-genc";
    await kayit.depo.kosuOlustur({ kosuId: id, tarif: { config: {}, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null }, modelAnahtari: { model_sha256: "b".repeat(64), pyodide: "0.27.7", schema: 2, host_sema: 1 }, ebeveyn: null, kaynak: "yerel", yayimlanan: 5, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 });
    vi.spyOn(kayit.akis, "devamEt").mockResolvedValue({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 5, tahmini: tahminiOynatma(5) } as never);
    vi.spyOn(kayit.akis, "tariftenBastan").mockResolvedValue({ sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" });
    expect((await kopru.fetch(`/api/runs/${id}`, { method: "GET" })).status).toBe(409);
    expect(kayitIcin).toHaveBeenCalledWith(id);
    expect(yeniOyun).not.toHaveBeenCalled();
  });

  it("kaydi_olmayan_kosu_404_kalir", async () => {
    const { kopru, kayit } = await kur();
    const devam = vi.spyOn(kayit.akis, "devamEt");
    expect((await kopru.fetch("/api/runs/yok", { method: "GET" })).status).toBe(404);
    expect(devam).not.toHaveBeenCalled();
  });
});

describe("kosu siniri: arayuzde olmayan kosunun kalicilik aboneligi yeni kosuya yer acar", () => {
  type Dinleyici = (ev: { type: string; data?: unknown }) => void;
  interface Akis {
    readyState: number;
    addEventListener(t: string, f: Dinleyici): void;
    close(): void;
  }
  it("ucuncu_kosu_olusturulurken_arayuzu_olmayan_eski_kosunun_abonesi_birakilir_kayit_korunur", async () => {
    const { kopru, isci, kayit } = await kur();
    const a = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    const b = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    expect(isci.aboneler.size).toBe(2);
    const c = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    // a ve b arayuzde degil: ikisinin de abonesi birakildi, yalniz yeni kosu (c) takipte
    expect([...isci.aboneler.values()].map((x) => x.kosuId)).toEqual([c]);
    expect((await kayit.depo.kosulariListele()).map((k) => k.kosuId).sort()).toEqual([a, b, c].sort());
  });

  it("arayuzunde_acik_akis_olan_kosu_ve_dal_ebeveyni_korunur", async () => {
    const { kopru, isci } = await kur();
    const a = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    const s = new (kopru.eventSource as unknown as new (u: string) => Akis)(`/api/runs/${a}/events`);
    await bekle(() => s.readyState === 1);
    const b = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    expect(isci.aboneler.size).toBeGreaterThanOrEqual(3);     // a: kalicilik + arayuz, b: kalicilik
    const d = (await json(await kopru.fetch(`/api/runs/${a}/branch`, POST({ week: 3 })))).runId;
    const kosular = new Set([...isci.aboneler.values()].map((x) => x.kosuId));
    expect(kosular.has(a)).toBe(true);                         // ebeveyn + arayuz akisi korunur
    expect(kosular.has(d)).toBe(true);
    expect(kosular.has(b)).toBe(false);                        // arayuzu olmayan ara kosu birakildi
  });
});

describe("tick dongusu: hafta olaylari IndexedDB'ye, abonelikten zamanlama", () => {
  it("her_week_olayi_depoya_yazilir_ve_yazici_tick_calisir", async () => {
    const { kopru, isci, kayit, cekirdek } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const tick = vi.spyOn(kayit.yazici, "tick");
    kopru.baslat();
    await bekle(async () => (await kayit.depo.paketSayisi(id)) >= 3);
    await kopru.durdur();
    const p = await kayit.depo.paketAraligi(id, 1, 3);
    expect(p.map((x) => x.week)).toEqual([1, 2, 3]);
    expect(tick).toHaveBeenCalledWith(id);
    expect((await kayit.depo.kosuOku(id))?.yayimlanan).toBeGreaterThanOrEqual(3);
    expect(cekirdek.kosular.get(id)?.released).toBeGreaterThanOrEqual(3);
    // Idempotent: ayni hafta ikinci kez yazilirsa cift kayit olmaz (kalicilik + devam tekrar oynatmasi).
    await kayit.yazici.haftaOlayi(id, { week: 2, run_id: id });
    expect(await kayit.depo.paketSayisi(id)).toBe((await kayit.depo.paketAraligi(id, 1, 99)).length);
    void isci;
  });

  it("goruntu_kadansi_dolunca_tick_sonrasi_goruntu_yazilir", async () => {
    const { kopru, kayit, cekirdek } = await kur();
    cekirdek.kadans = 2;
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    kopru.baslat();
    await bekle(async () => (await kayit.depo.goruntuleriListele(id)).length >= 1);
    await kopru.durdur();
  });

  it("bosta_tick_p50u_etkilemez_gercek_adimlar_ortanca_p50_olur", async () => {
    const { kopru, isci, kayit } = await kur();
    isci.tickMs = 4000;
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    kopru.baslat();
    await bekle(() => isci.p50.length >= 1);
    await kopru.durdur();
    expect(isci.p50[0]).toBe(4);
    void kayit;
  });

  it("Worker_dusunce_dongu_biter_ve_dustu_cagrilir", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const dustu = vi.fn();
    const kopru = new TarayiciKopru({ isci, kayit, dustu });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    isci.dusur = new Error("kapali");
    kopru.baslat();
    await bekle(() => dustu.mock.calls.length === 1);
    expect(kopru.calisiyor).toBe(false);
  });

  it("DELETE_rotasi_takibi_bitirir_ve_Python_aboneligini_kapatir", async () => {
    const { kopru, isci, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    expect(isci.aboneler.size).toBe(1);
    await kopru.fetch(`/api/runs/${id}`, { method: "DELETE" });
    expect(isci.aboneler.size).toBe(0);
    expect(isci.cagrilar.some((c) => c.y === "olayKapat")).toBe(true);
    expect((await kayit.depo.kosuOku(id))).not.toBeNull(); // kayit korunur (kaydi silmek acik eylemdir)
  });
});

describe("istek kuyrugu: hafta adimi sirasinda gelen istek bekler, kaybolmaz", () => {
  it("adim_surerken_gelen_fetch_adimdan_sonra_yanitlanir_sonraki_tickten_once", async () => {
    const { kopru, isci } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const kapi = ertele();
    let giris = 0;
    isci.tickKapisi = async () => {
      giris++;
      if (giris === 1) await kapi.promise;
    };
    kopru.baslat();
    await bekle(() => isci.cagrilar.filter((c) => c.y === "tick").length === 1);
    let yanit: Response | null = null;
    const p = kopru.fetch("/api/hello").then((r) => (yanit = r));
    await sonraki(20);
    expect(yanit).toBeNull();                      // adim bitmedi: istek kuyrukta
    kapi.coz();
    await p;
    expect(yanit).not.toBeNull();
    const sirasi = isci.cagrilar.map((c) => (c.y === "istek" ? `istek:${(c.a as { yol: string }).yol}` : c.y));
    const t1 = sirasi.indexOf("tick");
    const hello = sirasi.indexOf("istek:/api/hello");
    expect(hello).toBeGreaterThan(t1);
    const t2 = sirasi.indexOf("tick", t1 + 1);
    expect(t2 === -1 || hello < t2).toBe(true);    // ikinci tick'ten once yanitlandi
    await kopru.durdur();
  });
});

describe("arsiv_gerek: pencere disi hafta IndexedDB'den", () => {
  it("pencere_disi_weeks_istegi_depodan_arsivle_yinelenir", async () => {
    const { kopru, isci, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    isci.kosular.get(id)!.pencereTaban = 5;
    await kayit.depo.haftalarYaz(id, [1, 2, 3, 4, 5].map((w) => ({ week: w, run_id: id, x: w })));
    const r = await kopru.fetch(`/api/runs/${id}/weeks?from=1&to=6`, { method: "GET" });
    expect(r.status).toBe(200);
    expect((await json<{ week: number }[]>(r)).map((p) => p.week)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(isci.arsivIstekleri).toEqual([
      { yol: `/api/runs/${id}/weeks?from=1&to=6`, arsiv: 0 },
      { yol: `/api/runs/${id}/weeks?from=1&to=6`, arsiv: 5 },
    ]);
  });

  it("depoda_yoksa_500_arsiv_eksik_sonsuz_dongu_yok", async () => {
    const { kopru, isci } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    isci.kosular.get(id)!.pencereTaban = 5;
    const r = await kopru.fetch(`/api/runs/${id}/weeks?from=1&to=3`, { method: "GET" });
    expect(r.status).toBe(500);
    expect((await json(r)).error.code).toBe("arsiv_eksik");
    expect(isci.arsivIstekleri.length).toBe(1);
  });

  it("sinirsiz_arsiv_gerek_en_cok_3_yineleme_sonra_arsiv_dongusu", async () => {
    const { kopru, isci, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kayit.depo.haftalarYaz(id, [{ week: 1, run_id: id }]);
    isci.yanitlar.set(`GET /api/runs/${id}/weeks?from=1&to=1`, { status: 0, headers: {}, body: null, arsiv_gerek: { runId: id, from: 1, to: 1 } });
    const r = await kopru.fetch(`/api/runs/${id}/weeks?from=1&to=1`, { method: "GET" });
    expect(r.status).toBe(500);
    expect((await json(r)).error.code).toBe("arsiv_dongusu");
    expect(isci.cagrilar.filter((c) => c.y === "istek" && (c.a as { yol: string }).yol.includes("/weeks")).length).toBe(4);
  });
});

describe("gunluk senkronu: her mutasyondan sonra", () => {
  it("POST_changes_sonrasi_gunluk_depoya_yazilir_GET_yazmaz", async () => {
    const { kopru, kayit } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    const sync = vi.spyOn(kayit.yazici, "gunlukSenkronla");
    await kopru.fetch(`/api/runs/${id}/changes`, POST({ gecis_destegi: "x" }));
    expect(sync).toHaveBeenCalledWith(id);
    await bekle(async () => (await kayit.depo.gunlukOku(id, 0)).length === 1);      // senkron arkadan (yanit beklemez)
    expect((await kayit.depo.gunlukOku(id, 0)).map((g) => g.sira)).toEqual([1]);
    sync.mockClear();
    await kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    expect(sync).not.toHaveBeenCalled();
  });

  it("4xx_mutasyon_yazim_yapmaz", async () => {
    const { kopru, kayit, isci } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    isci.yanitlar.set(`POST /api/runs/${id}/changes`, { status: 422, headers: {}, body: { error: { code: "x" } } });
    const sync = vi.spyOn(kayit.yazici, "gunlukSenkronla");
    expect((await kopru.fetch(`/api/runs/${id}/changes`, POST({}))).status).toBe(422);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("EventSource koprusu: SSE olay eslemesi", () => {
  type Dinleyici = (ev: { type: string; data?: unknown }) => void;
  interface Akis {
    readyState: number;
    addEventListener(t: string, f: Dinleyici): void;
    close(): void;
  }
  const ac = (kopru: TarayiciKopru, url: string): Akis => new (kopru.eventSource as unknown as new (u: string) => Akis)(url);

  it("new_ile_cagrilir_state_hemen_gelir_week_tickte_data_dizge_readyState_acik", async () => {
    const { kopru } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const s = ac(kopru, `/api/runs/${id}/events`);
    const olaylar: [string, unknown][] = [];
    for (const t of ["state", "week", "world_event", "ended", "error"]) s.addEventListener(t, (ev) => olaylar.push([ev.type, ev.data]));
    expect(s.readyState).toBe(0);
    await bekle(() => olaylar.some((o) => o[0] === "state"));            // tick'i beklemeden (acilista drenaj)
    expect(s.readyState).toBe(1);
    expect(JSON.parse(olaylar[0]?.[1] as string)).toEqual({ runId: id });
    kopru.baslat();
    await bekle(() => olaylar.some((o) => o[0] === "week"));
    const hafta = olaylar.find((o) => o[0] === "week");
    expect(typeof hafta?.[1]).toBe("string");
    expect(JSON.parse(hafta?.[1] as string).week).toBe(1);
    await kopru.durdur();
    s.close();
  });

  it("close_Python_aboneligini_kapatir_kapali_akis_olay_almaz", async () => {
    const { kopru, isci } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    const s = ac(kopru, `/api/runs/${id}/events`);
    await bekle(() => s.readyState === 1);
    const once = isci.aboneler.size;
    s.close();
    expect(s.readyState).toBe(2);
    await bekle(() => isci.aboneler.size === once - 1);
  });

  it("bilinmeyen_kosu_error_olayi_veri_olmadan_ve_readyState_CLOSED", async () => {
    const { kopru } = await kur();
    const s = ac(kopru, "/api/runs/yok/events");
    const hatalar: unknown[] = [];
    s.addEventListener("error", (ev) => hatalar.push(ev.data));
    await bekle(() => hatalar.length === 1);
    expect(hatalar[0]).toBeUndefined();
    expect(s.readyState).toBe(2);
  });

  it("kosu_silinince_akis_kapanir_error_olayi_CLOSED_LiveSource_toparlanir", async () => {
    const { kopru } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    const s = ac(kopru, `/api/runs/${id}/events`);
    const hatalar: unknown[] = [];
    s.addEventListener("error", (ev) => hatalar.push(ev.data));
    await bekle(() => s.readyState === 1);
    await kopru.fetch(`/api/runs/${id}`, { method: "DELETE" });
    kopru.drenajPlanla();
    await bekle(() => s.readyState === 2);
    expect(hatalar.length).toBe(1);
  });

  it("kalicilik_olaylari_arayuz_olaylarindan_once_islenir_ekranda_gorulen_hafta_kayitta_vardir", async () => {
    const { kopru, kayit, hatalar } = await kur();
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const s = ac(kopru, `/api/runs/${id}/events`);
    let kayitliIken: boolean | null = null;
    s.addEventListener("week", () => {
      if (kayitliIken === null) void kayit.depo.paketOku(id, 1).then((p) => { void hatalar; kayitliIken = p !== null; });
    });
    kopru.baslat();
    await bekle(() => kayitliIken !== null);
    expect(kayitliIken).toBe(true);
    await kopru.durdur();
  });
});

describe("B8: durum gostergeleri (hesaplaniyor, kaydediliyor, kilitli, hazir_degil)", () => {
  async function kurU(ek: { gostergeGecikmeMs?: number; gostergeKapanmaMs?: number } = {}): Promise<Yigin & { uyarilar: Uyari[] }> {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u), ...ek });
    const y = { cekirdek, isci, kayit, kopru, hatalar: [], uyarilar };
    acik.push(y);
    return y;
  }

  it("hafta_adimi_gecikme_esigini_asinca_hesaplaniyor_acilir_biter_kapanir_kisa_adim_gostermez", async () => {
    const { kopru, isci, uyarilar } = await kurU({ gostergeGecikmeMs: 20, gostergeKapanmaMs: 5 });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const kapi = ertele();
    isci.tickKapisi = () => kapi.promise;
    kopru.baslat();
    await bekle(() => uyarilar.some((u) => u.tur === "hesaplaniyor" && u.mesgul));
    kapi.coz();
    isci.tickKapisi = null;
    await bekle(() => uyarilar.some((u) => u.tur === "hesaplaniyor" && !u.mesgul));
    await kopru.durdur();
    const sira = uyarilar.filter((u) => u.tur === "hesaplaniyor").map((u) => (u as { mesgul: boolean }).mesgul);
    expect(sira.slice(0, 2)).toEqual([true, false]);
  });

  it("hizli_tick_hesaplaniyor_gostermez", async () => {
    const { kopru, isci, uyarilar } = await kurU({ gostergeGecikmeMs: 5000 });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    kopru.baslat();
    await bekle(() => isci.cagrilar.filter((c) => c.y === "tick").length >= 3);
    await kopru.durdur();
    expect(uyarilar.filter((u) => u.tur === "hesaplaniyor")).toEqual([]);
  });

  it("yazici_tick_kilitli_donerse_bir_kez_kayit_kilitli_hazir_degil_gelip_gecince_bekliyor_acilir_kapanir", async () => {
    const { kopru, isci, kayit, uyarilar } = await kurU({ gostergeGecikmeMs: 5000 });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const gunluk = { eklenen: 0, cakisan: [] };
    const sonuclar: { durum: string }[] = [{ durum: "hazir_degil" }, { durum: "hazir_degil" }, { durum: "gerekmiyor" }, { durum: "kilitli" }, { durum: "kilitli" }, { durum: "gerekmiyor" }];
    let i = 0;
    vi.spyOn(kayit.yazici, "tick").mockImplementation(async () => ({ gunluk, goruntu: (sonuclar[Math.min(i++, sonuclar.length - 1)] ?? { durum: "kilitli" }) as never }));
    kopru.baslat();
    await bekle(() => i >= 7 && isci.cagrilar.some((c) => c.y === "tick"));
    await kopru.durdur();
    const bekliyor = uyarilar.filter((u) => u.tur === "kayit_bekliyor").map((u) => (u as { bekliyor: boolean }).bekliyor);
    expect(bekliyor).toEqual([true, false]);
    expect(uyarilar.filter((u) => u.tur === "kayit_kilitli")).toEqual([{ tur: "kayit_kilitli", kosuId: id, kilitli: true }, { tur: "kayit_kilitli", kosuId: id, kilitli: false }]);   // Ö7: kilit kalkinca da bildirilir
  });

  it("yazici_tick_yavassa_kaydediliyor_acilir_ve_kapanir", async () => {
    const { kopru, isci, kayit, uyarilar } = await kurU({ gostergeGecikmeMs: 15, gostergeKapanmaMs: 5 });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId as string;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    const kapi = ertele();
    let kez = 0;
    vi.spyOn(kayit.yazici, "tick").mockImplementation(async () => {
      if (kez++ === 0) await kapi.promise;
      return { gunluk: { eklenen: 0, cakisan: [] }, goruntu: { durum: "gerekmiyor" } };
    });
    kopru.baslat();
    await bekle(() => uyarilar.some((u) => u.tur === "kaydediliyor" && u.mesgul));
    // Yuk altinda hizli ardisik tick'ler kapanma suresini (5 ms) surekli yeniden baslatabilir; duraklatinca dongu (en cok 2 hf onden hesap) durur ve kapanma gozlenir.
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "pause" }));
    kapi.coz();
    await bekle(() => uyarilar.some((u) => u.tur === "kaydediliyor" && !u.mesgul));
    await kopru.durdur();
    expect(isci.cagrilar.length).toBeGreaterThan(0);
  });
});

describe("B8 K1: kayittan acma sonuclari acilis akisiyla ayni tabloyu kullanir (sessiz yeni koşu YOK)", () => {
  async function kurK(ek: { yukluModel?: string } = {}) {
    const { isci, kayit, cekirdek } = await kur();
    const secim = vi.fn();
    const kopru = new TarayiciKopru({ isci, kayit, kayitSecimiIcin: secim });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = "canli-k1";
    await kayit.depo.kosuOlustur({ kosuId: id, tarif: { config: {}, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null }, modelAnahtari: cekirdek.anahtar, ebeveyn: null, kaynak: "yerel", yayimlanan: 5, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 });
    void ek;
    return { kopru, kayit, cekirdek, isci, secim, id };
  }
  const posts = (isci: { cagrilar: { y: string; a?: unknown }[] }): number => isci.cagrilar.filter((c) => c.y === "istek" && (c.a as { yontem?: string; yol?: string }).yontem === "POST" && (c.a as { yol?: string }).yol === "/api/runs").length;

  it.each([
    ["uyumsuz", { sonuc: "uyumsuz", tur: "surum", fark: {}, hedef: 5, tahmini: tahminiOynatma(5), secenekler: [] }],
    ["durdu", { sonuc: "durdu", durum: "sapma", kosuId: "canli-k1", cekirdek: {}, kosuSilinebilir: true }],
    ["hata", { sonuc: "hata", tur: "ValueError", mesaj: "x" }],
    ["uzun_tariften_gerek", { sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 40, tahmini: tahminiOynatma(40) }],
    ["goruntu_cok_eski", { sonuc: "tariften_gerek", neden: "goruntu_cok_eski", hedef: 5, tahmini: tahminiOynatma(5) }],
  ])("%s_409_kayit_secim_gerek_kayitSecimiIcin_cagrilir_yeni_kosu_kurulmaz_ikinci_GET_de_409", async (_ad, sonuc) => {
    const { kopru, kayit, isci, secim, id } = await kurK();
    vi.spyOn(kayit.akis, "devamEt").mockResolvedValue(sonuc as never);
    const tariften = vi.spyOn(kayit.akis, "tariftenBastan");
    const r = await kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe("kayit_secim_gerek");
    expect(secim).toHaveBeenCalledTimes(1);
    expect(secim).toHaveBeenCalledWith(id);
    expect(tariften).not.toHaveBeenCalled();
    expect(posts(isci)).toBe(0);
    expect((await kopru.fetch(`/api/runs/${id}`, { method: "GET" })).status).toBe(409);     // 404'e (yeniden kurma) dusmez
    expect(secim).toHaveBeenCalledTimes(1);
  });

  it("kisa_goruntusuz_ayni_model_otomatik_baştan_oynatilir_tamam_200", async () => {
    const { kopru, kayit, id } = await kurK();
    vi.spyOn(kayit.akis, "devamEt").mockResolvedValue({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 5, tahmini: tahminiOynatma(5) });
    const t = vi.spyOn(kayit.akis, "tariftenBastan").mockImplementation(async () => {
      kopru["kosular"].set(id, { abone: 1, ebeveyn: null, bekleyen: new Map(), yazimUyarisi: false });
      return { sonuc: "tamam", kosuId: id, hafta: 5, uygulanan: 5, kalan: 0, kaynak: "tarif", goruntuHaftasi: null, genisletilmis: false };
    });
    await kopru.fetch(`/api/runs/${id}`, { method: "GET" });
    expect(t).toHaveBeenCalledTimes(1);
  });

  it("Y2_kaydin_modeli_yuklu_modelden_farkliysa_kisa_goruntusuz_bile_secim_model_anahtari_degismez", async () => {
    const { kopru, kayit, cekirdek, secim, id } = await kurK();
    cekirdek.anahtar = { ...cekirdek.anahtar, model_sha256: "c".repeat(64) };       // yuklu model != kayit
    vi.spyOn(kayit.akis, "devamEt").mockResolvedValue({ sonuc: "tariften_gerek", neden: "goruntu_yok", hedef: 5, tahmini: tahminiOynatma(5) });
    const t = vi.spyOn(kayit.akis, "tariftenBastan");
    expect((await kopru.fetch(`/api/runs/${id}`, { method: "GET" })).status).toBe(409);
    expect(t).not.toHaveBeenCalled();
    expect(secim).toHaveBeenCalledWith(id);
    expect((await kayit.depo.kosuOku(id))?.modelAnahtari.model_sha256).toBe("a".repeat(64));
  });

  it("Y1_kosuSil_koprudan_takibi_bitirir_kaydi_siler_GET_ile_dirilmez_cekirdek_hatasi_yutulmaz", async () => {
    const { kopru, kayit, cekirdek, id } = await kurK();
    await kopru["kosular"].set(id, { abone: 1, ebeveyn: null, bekleyen: new Map(), yazimUyarisi: false });
    expect([...kopru.takipEdilenler()]).toEqual([id]);
    cekirdek.kosuSil = async () => {
      throw new CekirdekHatasi("HttpHatasi", "durum_500");
    };
    await expect(kopru.kosuSil(id)).rejects.toThrow("durum_500");
    expect(await kayit.depo.kosuOku(id)).not.toBeNull();       // silinemedi: kayit duruyor
    cekirdek.kosuSil = async () => undefined;
    await kopru.kosuSil(id);
    expect(await kayit.depo.kosuOku(id)).toBeNull();
    expect(kopru.takipEdilenler().has(id)).toBe(false);
    expect((await kopru.fetch(`/api/runs/${id}`, { method: "GET" })).status).toBe(404);   // dirilmez
  });
});

describe("B8 Ö2: gosterge yanip sonmez", () => {
  it("ardisik_uzun_adimlar_arasinda_gosterge_acik_kalir_tek_acilis_tek_kapanis", async () => {
    const cekirdek = new SahteCekirdek();
    const isci = new SahteIsci(cekirdek);
    const kayit = await kayitKatmaniAc({ idb: yeniIdb(), cekirdek });
    const uyarilar: Uyari[] = [];
    const kopru = new TarayiciKopru({ isci, kayit, uyari: (u) => uyarilar.push(u), gostergeGecikmeMs: 10, gostergeKapanmaMs: 150 });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = (await json(await kopru.fetch("/api/runs", POST({})))).runId;
    await kopru.fetch(`/api/runs/${id}/control`, POST({ action: "play" }));
    isci.tickKapisi = () => new Promise<void>((c) => setTimeout(c, 40));   // her adim esikten uzun, adimlar arasi bosluk kapanma toleransindan kisa
    kopru.baslat();
    await bekle(() => isci.cagrilar.filter((c) => c.y === "tick").length >= 8);
    expect(uyarilar.filter((u) => u.tur === "hesaplaniyor" && u.mesgul).length).toBe(1);
    expect(uyarilar.filter((u) => u.tur === "hesaplaniyor" && !u.mesgul).length).toBe(0);
    await kopru.durdur();
    await bekle(() => uyarilar.some((u) => u.tur === "hesaplaniyor" && !u.mesgul));
    expect(uyarilar.filter((u) => u.tur === "hesaplaniyor").map((u) => (u as { mesgul: boolean }).mesgul)).toEqual([true, false]);
  });
});

describe("B8 tur 2 r1-O2: yenileme baslamazsa secim kaydi silinir, sonraki Ac yeniden dener", () => {
  it("kayitSecimiIcin_false_donerse_ikinci_GET_yeniden_secim_ister", async () => {
    const { isci, kayit, cekirdek } = await kur();
    const secim = vi.fn(async () => false);
    const kopru = new TarayiciKopru({ isci, kayit, kayitSecimiIcin: secim });
    acik.push({ cekirdek, isci, kayit, kopru, hatalar: [] });
    const id = "canli-r2";
    await kayit.depo.kosuOlustur({ kosuId: id, tarif: { config: {}, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null }, modelAnahtari: cekirdek.anahtar, ebeveyn: null, kaynak: "yerel", yayimlanan: 5, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 });
    vi.spyOn(kayit.akis, "devamEt").mockResolvedValue({ sonuc: "hata", tur: "ValueError", mesaj: "x" });
    expect((await kopru.fetch(`/api/runs/${id}`)).status).toBe(409);
    await sonraki(5);
    expect((await kopru.fetch(`/api/runs/${id}`)).status).toBe(409);
    expect(secim).toHaveBeenCalledTimes(2);                 // false: kayit temizlendi, yeniden denendi
  });
});
