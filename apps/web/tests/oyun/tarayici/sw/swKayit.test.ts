// @vitest-environment node
// B7: SW kaydi ve yeni surum yonetimi (kullanici onayi, kayit tamamlama, uygulama).
import { describe, expect, it, vi } from "vitest";
import { SW_KAPSAMI, SW_YOLU, swBaslat, type KonteynerYuzu, type SwSecenek, type YeniSurumDurumu } from "@/oyun/tarayici/swKayit";

class SahteIsci {
  state: string;
  mesajlar: unknown[] = [];
  private f: (() => void)[] = [];
  constructor(state = "installing") {
    this.state = state;
  }
  postMessage(m: unknown): void {
    this.mesajlar.push(m);
  }
  addEventListener(_t: "statechange", f: () => void): void {
    this.f.push(f);
  }
  gec(state: string): void {
    this.state = state;
    this.f.forEach((x) => x());
  }
}

class SahteKayit {
  waiting: SahteIsci | null = null;
  installing: SahteIsci | null = null;
  guncellemeSayisi = 0;
  guncellemeHata = false;
  private uf: (() => void)[] = [];
  addEventListener(_t: "updatefound", f: () => void): void {
    this.uf.push(f);
  }
  async update(): Promise<void> {
    this.guncellemeSayisi++;
    if (this.guncellemeHata) throw new TypeError("offline");
  }
  yeniKur(): SahteIsci {
    const w = new SahteIsci();
    this.installing = w;
    this.uf.forEach((f) => f());
    return w;
  }
  kuruldu(w: SahteIsci): void {
    this.installing = null;
    this.waiting = w;
    w.gec("installed");
  }
}

class SahteKonteyner implements KonteynerYuzu {
  controller: unknown = { var: true };
  kayit = new SahteKayit();
  kayitCagrilari: { url: string; secenek: unknown }[] = [];
  private d: (() => void)[] = [];
  async register(url: string, secenek: { scope: string }): Promise<SahteKayit> {
    this.kayitCagrilari.push({ url, secenek });
    return this.kayit;
  }
  addEventListener(_t: "controllerchange", f: () => void): void {
    this.d.push(f);
  }
  removeEventListener(_t: "controllerchange", f: () => void): void {
    this.d = this.d.filter((x) => x !== f);
  }
  degisim(): void {
    [...this.d].forEach((f) => f());
  }
}

function ortam(k: SahteKonteyner | null, ek: Partial<SwSecenek> = {}) {
  const yenidenYukle = vi.fn();
  const o: SwSecenek = {
    etkin: true,
    konteyner: k,
    guvenliBaglam: true,
    yol: "/oyun/",
    yenidenYukle,
    gorunurluk: { dinle: () => () => undefined, gorunur: () => true },
    zamanlayici: { aralik: () => () => undefined, zaman: () => 0, bekle: () => new Promise<void>(() => undefined) },
    ...ek,
  };
  return { o, yenidenYukle };
}

const durumlar = (s: { abone(f: (d: YeniSurumDurumu) => void): () => void }): YeniSurumDurumu[] => {
  const l: YeniSurumDurumu[] = [];
  s.abone((d) => l.push(d));
  return l;
};

describe("kayit kosullari", () => {
  it("uygun degilse kaydetmez: bayraksiz/uretim disi, destek yok, guvensiz baglam, oyun disi sayfa", async () => {
    const k = new SahteKonteyner();
    expect(await swBaslat(ortam(k, { etkin: false }).o)).toBeNull();
    expect(await swBaslat(ortam(null).o)).toBeNull();
    expect(await swBaslat(ortam(k, { guvenliBaglam: false }).o)).toBeNull();
    expect(await swBaslat(ortam(k, { yol: "/" }).o)).toBeNull();
    expect(await swBaslat(ortam(k, { yol: "/dao/" }).o)).toBeNull();
    expect(await swBaslat(ortam(k, { yol: "/oyunlar/" }).o)).toBeNull();
    expect(k.kayitCagrilari).toEqual([]);
  });

  it("oyun sayfasinda /sw.js'i oyun kapsamiyla kaydeder", async () => {
    const k = new SahteKonteyner();
    expect(await swBaslat(ortam(k).o)).not.toBeNull();
    expect(k.kayitCagrilari).toEqual([{ url: SW_YOLU, secenek: { scope: SW_KAPSAMI, updateViaCache: "none" } }]);
  });

  it("kayit hatasi oyunu bozmaz (null, hata bildirilir)", async () => {
    const k = new SahteKonteyner();
    k.register = () => Promise.reject(new Error("SecurityError"));
    const hata = vi.fn();
    expect(await swBaslat(ortam(k, { hata }).o)).toBeNull();
    expect(hata).toHaveBeenCalledOnce();
  });
});

describe("yeni surum hazir", () => {
  it("ilk kurulumda (denetleyen worker yok) bant cikmaz", async () => {
    const k = new SahteKonteyner();
    k.controller = null;
    const s = await swBaslat(ortam(k).o);
    const l = durumlar(s!);
    const w = k.kayit.yeniKur();
    k.kayit.kuruldu(w);
    expect(l).toEqual(["yok"]);
  });

  it("denetleyen worker varken yeni worker kurulunca 'hazir'; kendiliginden uygulanmaz", async () => {
    const k = new SahteKonteyner();
    const s = await swBaslat(ortam(k).o);
    const l = durumlar(s!);
    const w = k.kayit.yeniKur();
    expect(l).toEqual(["yok"]);
    k.kayit.kuruldu(w);
    expect(l).toEqual(["yok", "hazir"]);
    expect(w.mesajlar).toEqual([]); // skipWaiting mesaji gonderilmedi
  });

  it("kayit aninda zaten bekleyen worker varsa 'hazir'", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const s = await swBaslat(ortam(k).o);
    expect(s!.durum).toBe("hazir");
  });
});

describe("uygula", () => {
  async function hazir() {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k);
    const s = (await swBaslat(e.o))!;
    return { k, e, s, w: k.kayit.waiting };
  }

  it("once kayit tamamlanir, sonra atla mesaji, controllerchange ile sayfa yenilenir", async () => {
    const { k, e, s, w } = await hazir();
    const sira: string[] = [];
    const l = durumlar(s);
    const hazirla = vi.fn(async () => {
      sira.push("hazirla");
      expect(w.mesajlar).toEqual([]); // kayit bitmeden atla YOK
      return true;
    });
    const surdur = vi.fn();
    const is = s.uygula(hazirla, surdur);
    await vi.waitFor(() => expect(w.mesajlar).toEqual([{ t: "atla" }]));
    expect(e.yenidenYukle).not.toHaveBeenCalled();
    k.degisim();
    await is;
    expect(e.yenidenYukle).toHaveBeenCalledOnce();
    expect(surdur).not.toHaveBeenCalled();
    expect(l).toEqual(["hazir", "kaydediliyor", "uygulaniyor"]);
  });

  it("kayit tamamlanamazsa surum UYGULANMAZ, oyun surdurulur, hata durumu", async () => {
    const { e, s, w } = await hazir();
    const surdur = vi.fn();
    await s.uygula(async () => false, surdur);
    expect(w.mesajlar).toEqual([]);
    expect(surdur).toHaveBeenCalledOnce();
    expect(e.yenidenYukle).not.toHaveBeenCalled();
    expect(s.durum).toBe("hata");
  });

  it("hazirla firlatirsa ayni sekilde uygulanmaz", async () => {
    const { s, w } = await hazir();
    const surdur = vi.fn();
    await s.uygula(() => Promise.reject(new Error("idb")), surdur);
    expect(w.mesajlar).toEqual([]);
    expect(surdur).toHaveBeenCalledOnce();
    expect(s.durum).toBe("hata");
  });

  it("controllerchange zaman asimina ugrarsa oyun surdurulur, sayfa yenilenmez; hatadan sonra yeniden denenebilir", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k, { zamanlayici: { aralik: () => () => undefined, zaman: () => 0, bekle: async () => undefined } });
    const s = (await swBaslat(e.o))!;
    const surdur = vi.fn();
    await s.uygula(async () => true, surdur);
    expect(surdur).toHaveBeenCalledOnce();
    expect(e.yenidenYukle).not.toHaveBeenCalled();
    expect(s.durum).toBe("hata");
    k.kayit.waiting!.mesajlar.length = 0;
    const is = s.uygula(async () => true, surdur);
    await vi.waitFor(() => expect(k.kayit.waiting!.mesajlar.length).toBe(1));
    k.degisim();
    await is;
  });

  it("hazir degilken uygula etkisiz", async () => {
    const k = new SahteKonteyner();
    const s = (await swBaslat(ortam(k).o))!;
    const hazirla = vi.fn(async () => true);
    await s.uygula(hazirla, vi.fn());
    expect(hazirla).not.toHaveBeenCalled();
  });
});

describe("K5: gec ya da baska sekmeden etkinlesme", () => {
  it("zaman asimindan SONRA gelen controllerchange once kaydi YENIDEN tamamlar, sonra yeniler", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k, { zamanlayici: { aralik: () => () => undefined, zaman: () => 0, bekle: async () => undefined } });
    const s = (await swBaslat(e.o))!;
    const sira: string[] = [];
    let serbest!: () => void;
    const hazirla = vi.fn(async () => {
      sira.push("hazirla");
      if (hazirla.mock.calls.length > 1) await new Promise<void>((c) => (serbest = c));
      return true;
    });
    await s.uygula(hazirla, () => sira.push("surdur"));
    expect(s.durum).toBe("hata");
    k.degisim();
    await vi.waitFor(() => expect(hazirla).toHaveBeenCalledTimes(2));
    expect(e.yenidenYukle).not.toHaveBeenCalled(); // kayit bitmeden yenileme YOK
    serbest();
    await vi.waitFor(() => expect(e.yenidenYukle).toHaveBeenCalledOnce());
    expect(sira).toEqual(["hazirla", "surdur", "hazirla"]);
  });

  it("gec etkinlesmede kayit tamamlanamazsa sayfa yenilenmez, oyun surer", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k, { zamanlayici: { aralik: () => () => undefined, zaman: () => 0, bekle: async () => undefined } });
    const s = (await swBaslat(e.o))!;
    const hazirla = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const surdur = vi.fn();
    await s.uygula(hazirla, surdur);
    k.degisim();
    await vi.waitFor(() => expect(surdur).toHaveBeenCalledTimes(2));
    expect(e.yenidenYukle).not.toHaveBeenCalled();
    expect(s.durum).toBe("hata");
  });

  it("bekleyen worker kalmamis ve denetleyen degismis (baska sekme onayladi): dogrudan yenilenir", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k);
    const s = (await swBaslat(e.o))!;
    k.kayit.waiting = null;
    k.controller = { yeni: true };
    await s.uygula(async () => true, vi.fn());
    expect(e.yenidenYukle).toHaveBeenCalledOnce();
  });

  it("bekleyen worker kalmamis ve denetleyen ayni: bant kalkar ('yok'), oyun surdurulur, sayfa yenilenmez", async () => {
    const k = new SahteKonteyner();
    k.kayit.waiting = new SahteIsci("installed");
    const e = ortam(k);
    const s = (await swBaslat(e.o))!;
    k.kayit.waiting = null;
    const surdur = vi.fn();
    await s.uygula(async () => true, surdur);
    expect(s.durum).toBe("yok");
    expect(surdur).toHaveBeenCalledOnce();
    expect(e.yenidenYukle).not.toHaveBeenCalled();
  });
});

describe("guncelleme denetimi", () => {
  it("sayfa gorunur olunca (esik asilmissa) update(); cevrimdisi hata sessiz", async () => {
    const k = new SahteKonteyner();
    let gorunur = () => undefined as void;
    let simdi = 0;
    const e = ortam(k, {
      gorunurluk: { dinle: (f) => ((gorunur = f), () => undefined), gorunur: () => true },
      zamanlayici: { aralik: () => () => undefined, zaman: () => simdi, bekle: () => new Promise<void>(() => undefined) },
    });
    await swBaslat(e.o);
    gorunur();
    expect(k.kayit.guncellemeSayisi).toBe(0); // esik asilmadi
    simdi = 6 * 60 * 1000;
    k.kayit.guncellemeHata = true;
    gorunur();
    await vi.waitFor(() => expect(k.kayit.guncellemeSayisi).toBe(1));
  });
});
