// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import { YuklemeHatasi, type AnaMesaj, type IsciMesaji, type Manifest } from "@/oyun/tarayici/protokol";
import { IsciIstemcisi, OyunYukleyici, type WorkerBaglantisi } from "@/oyun/tarayici/yukleyici";

class SahteWorker implements WorkerBaglantisi {
  gonderilen: { m: AnaMesaj; aktar?: Transferable[] }[] = [];
  sonlandi = 0;
  onmessage: WorkerBaglantisi["onmessage"] = null;
  onerror: WorkerBaglantisi["onerror"] = null;
  onmessageerror: WorkerBaglantisi["onmessageerror"] = null;
  postMessage(m: AnaMesaj, aktar?: Transferable[]): void {
    this.gonderilen.push({ m, aktar });
  }
  terminate(): void {
    this.sonlandi++;
  }
  gelen(m: IsciMesaji): void {
    this.onmessage?.({ data: m });
  }
}

const MANIFEST = { surum: 1 } as unknown as Manifest;
const HAZIR: IsciMesaji = { t: "hazir", anahtar: { model_sha256: "a", pyodide: "0.27.7", schema: 2, host_sema: 1 }, manifest: MANIFEST, sureler: { manifest: 1, indirme: 2, dogrulama: 3, derleme: 4, paket: 5, kurulum: 6 } };

describe("OyunYukleyici", () => {
  it("yukle_mesaji_mutlak_URL_ve_ilerleme_ana_is_parcacigina_iletilir_hazirda_istemci", async () => {
    const w = new SahteWorker();
    const il = vi.fn();
    const y = new OyunYukleyici({ workerUret: () => w, origin: "http://h:1", ilerleme: il });
    expect(w.gonderilen[0]?.m).toEqual({ t: "yukle", girdi: { manifestUrl: "http://h:1/oyun/manifest.json", pyodideDizini: "http://h:1/pyodide/0.27.7/", oyunDizini: "http://h:1/oyun/" } });
    w.gelen({ t: "ilerleme", asama: "indirme", oran: 0.5, alinan: 5, toplam: 10 });
    expect(il).toHaveBeenCalledWith({ asama: "indirme", oran: 0.5, alinan: 5, toplam: 10 });
    w.gelen(HAZIR);
    const { istemci } = await y.bitti;
    expect(istemci.bilgi.anahtar.pyodide).toBe("0.27.7");
    expect(w.sonlandi).toBe(0);
  });

  it("B7_model_verilirse_manifest_model_sorgusuyla_istenir_paket_dizini_ayni_kalir", () => {
    const w = new SahteWorker();
    new OyunYukleyici({ workerUret: () => w, origin: "http://h:1", model: "ab12" });
    expect(w.gonderilen[0]?.m).toEqual({ t: "yukle", girdi: { manifestUrl: "http://h:1/oyun/manifest.json?model=ab12", pyodideDizini: "http://h:1/pyodide/0.27.7/", oyunDizini: "http://h:1/oyun/" } });
  });

  it("yukleme_hatasi_YuklemeHatasi_kodlu_ve_worker_sonlandirilir", async () => {
    const w = new SahteWorker();
    const y = new OyunYukleyici({ workerUret: () => w, origin: "http://h" });
    w.gelen({ t: "yuklemeHatasi", kod: "sha_uyusmuyor", ayrinti: { beklenen: "a" } });
    await expect(y.bitti).rejects.toMatchObject({ kod: "sha_uyusmuyor", ayrinti: { beklenen: "a" } });
    expect(w.sonlandi).toBe(1);
  });

  it("iptal_worker_terminate_ve_iptal_edildi_hatasi", async () => {
    const w = new SahteWorker();
    const y = new OyunYukleyici({ workerUret: () => w, origin: "http://h" });
    y.iptal();
    await expect(y.bitti).rejects.toMatchObject({ kod: "iptal_edildi" });
    expect(w.sonlandi).toBe(1);
    w.gelen(HAZIR);                                   // iptalden sonra gelen mesaj yok sayilir
    y.iptal();
    expect(w.sonlandi).toBe(1);
  });

  it("Worker_script_hatasi_ve_uretim_hatasi_worker_baslamadi", async () => {
    const w = new SahteWorker();
    const y = new OyunYukleyici({ workerUret: () => w, origin: "http://h" });
    w.onerror?.({ message: "script" });
    await expect(y.bitti).rejects.toMatchObject({ kod: "worker_baslamadi" });
    const y2 = new OyunYukleyici({ workerUret: () => { throw new Error("yok"); }, origin: "http://h" });
    await expect(y2.bitti).rejects.toBeInstanceOf(YuklemeHatasi);
  });

  it("iptal_hazir_sonrasi_etkisiz_IsciIstemcisi_kapat_kullanilir", async () => {
    const w = new SahteWorker();
    const y = new OyunYukleyici({ workerUret: () => w, origin: "http://h" });
    w.gelen(HAZIR);
    const { istemci } = await y.bitti;
    y.iptal();
    expect(w.sonlandi).toBe(0);
    istemci.kapat();
    expect(w.sonlandi).toBe(1);
  });
});

describe("IsciIstemcisi: korelasyon kimligi, hata sozlesmesi", () => {
  const kur = (): { w: SahteWorker; i: IsciIstemcisi; dustu: ReturnType<typeof vi.fn> } => {
    const w = new SahteWorker();
    const dustu = vi.fn();
    const i = new IsciIstemcisi(w, { anahtar: HAZIR.t === "hazir" ? HAZIR.anahtar : (null as never), manifest: MANIFEST, sureler: { manifest: 0, indirme: 0, dogrulama: 0, derleme: 0, paket: 0, kurulum: 0 } }, dustu);
    return { w, i, dustu };
  };

  it("yanitlar_kimlikle_eslesir_sira_disi_gelse_de", async () => {
    const { w, i } = kur();
    const a = i.cagri("goruntuGerekli", { kosuId: "a" });
    const b = i.cagri("goruntuGerekli", { kosuId: "b" });
    const [ma, mb] = w.gonderilen.map((g) => g.m as Extract<AnaMesaj, { t: "cagri" }>);
    expect(ma?.id).not.toBe(mb?.id);
    w.gelen({ t: "yanit", id: mb!.id, ok: true, s: false });
    w.gelen({ t: "yanit", id: ma!.id, ok: true, s: true });
    expect(await a).toBe(true);
    expect(await b).toBe(false);
  });

  it("Python_hatasi_CekirdekHatasi_tur_mesaj_fark", async () => {
    const { w, i } = kur();
    const p = i.cagri("devam", { parcalar: [], yonetici: {}, gunluk: [], hedefHafta: 1 });
    w.gelen({ t: "yanit", id: 1, ok: false, hata: { tur: "UyumsuzGoruntu", mesaj: "m", fark: { schema: [1, 2] } } });
    const e = (await p.catch((x: unknown) => x)) as CekirdekHatasi;
    expect(e).toBeInstanceOf(CekirdekHatasi);
    expect([e.tur, e.message, e.fark]).toEqual(["UyumsuzGoruntu", "m", { schema: [1, 2] }]);
  });

  it("aktar_listesi_postMessage_a_gecer_ve_devamIlerleme_cagriya_ozel", async () => {
    const { w, i } = kur();
    const buf = new ArrayBuffer(4);
    const il = vi.fn();
    const il2 = vi.fn();
    void i.cagri("devam", { parcalar: [buf], yonetici: {}, gunluk: [], hedefHafta: 1 }, { aktar: [buf], devamIlerleme: il });
    void i.cagri("tariftenOynat", { tarif: { config: {}, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null }, gunluk: [], hedefHafta: 1 }, { devamIlerleme: il2 });
    expect(w.gonderilen[0]?.aktar).toEqual([buf]);
    w.gelen({ t: "devamIlerleme", id: 2, hafta: 5 });
    expect(il2).toHaveBeenCalledWith(5);
    expect(il).not.toHaveBeenCalled();
  });

  it("kapat_bekleyenleri_reddeder_worker_sonlanir_sonraki_cagri_reddedilir", async () => {
    const { w, i, dustu } = kur();
    const p = i.cagri("goruntuGerekli", { kosuId: "a" });
    i.kapat();
    await expect(p).rejects.toMatchObject({ tur: "IsciHatasi", message: "kapali" });
    expect(w.sonlandi).toBe(1);
    expect(i.acik).toBe(false);
    await expect(i.cagri("goruntuGerekli", { kosuId: "a" })).rejects.toBeInstanceOf(CekirdekHatasi);
    expect(dustu).not.toHaveBeenCalled();           // bilincli kapatma "dustu" degil
  });

  it("Worker_onerror_bekleyenleri_reddeder_ve_dustu_bildirir", async () => {
    const { w, i, dustu } = kur();
    const p = i.cagri("goruntuGerekli", { kosuId: "a" });
    w.onerror?.({ message: "olum" });
    await expect(p).rejects.toBeInstanceOf(CekirdekHatasi);
    expect(dustu).toHaveBeenCalledTimes(1);
  });
});

describe("IsciIstemcisi: messageerror", () => {
  it("messageerror_Worker_dustu_sayilir", async () => {
    const w = new SahteWorker();
    const dustu = vi.fn();
    const i = new IsciIstemcisi(w, { anahtar: { model_sha256: "a", pyodide: "0.27.7", schema: 2, host_sema: 1 }, manifest: MANIFEST, sureler: { manifest: 0, indirme: 0, dogrulama: 0, derleme: 0, paket: 0, kurulum: 0 } }, dustu);
    const p = i.cagri("goruntuGerekli", { kosuId: "a" });
    w.onmessageerror?.({});
    await expect(p).rejects.toBeInstanceOf(CekirdekHatasi);
    expect(dustu).toHaveBeenCalledTimes(1);
  });
});
