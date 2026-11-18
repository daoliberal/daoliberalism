// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Isci, IsciHatasi, manifestiDogrula, type IsciOrtami, type PyodideModulu, type PyodideYuzu } from "@/oyun/tarayici/isci";
import { BOSTA_MS, PYODIDE_SURUMU, YuklemeHatasi, type AnaMesaj, type IsciMesaji, type Manifest, type YukleGirdisi } from "@/oyun/tarayici/protokol";

const SHA = "b".repeat(64);
const MODEL = "a".repeat(64);
const MANIFEST: Manifest = { surum: 1, pyodide: PYODIDE_SURUMU, goruntu_sema: 2, host_sema: 1, model_sha256: MODEL, paket: { ad: "oyun-0123456789ab.zip", sha256: SHA, boyut: 6 } };
const ANAHTAR = { model_sha256: MODEL, pyodide: PYODIDE_SURUMU, schema: 2, host_sema: 1 };
const GIRDI: YukleGirdisi = { manifestUrl: "http://x/oyun/manifest.json", pyodideDizini: "http://x/pyodide/0.27.7/", oyunDizini: "http://x/oyun/" };

/** Python `IsciKopru` taklidi: yontemler JSON dizgesi doner. */
class SahteKopru {
  cagrilar: { ad: string; args: unknown[] }[] = [];
  sonuc: Record<string, string> = {};
  sink: ((u: Uint8Array) => void) | null = null;
  ok = (s: unknown): string => `{"ok":true,"s":${JSON.stringify(s)}}`;
  private kayit(ad: string, ...args: unknown[]): string {
    this.cagrilar.push({ ad, args });
    return this.sonuc[ad] ?? this.ok(null);
  }
  istek = (...a: unknown[]): string => this.kayit("istek", ...a);
  tick = (...a: unknown[]): string => this.kayit("tick", ...a);
  olaylar = (...a: unknown[]): string => this.kayit("olaylar", ...a);
  olay_kapat = (...a: unknown[]): string => this.kayit("olay_kapat", ...a);
  p50 = (...a: unknown[]): string => this.kayit("p50", ...a);
  uyumluluk_anahtari = (): string => this.sonuc.uyumluluk_anahtari ?? this.ok(ANAHTAR);
  goruntu_gerekli = (...a: unknown[]): string => this.kayit("goruntu_gerekli", ...a);
  goruntu_al = (kosu: string, sink: (u: Uint8Array) => void): string => {
    this.cagrilar.push({ ad: "goruntu_al", args: [kosu] });
    this.sink?.(new Uint8Array([1, 2]));
    sink(new Uint8Array([1, 2, 3]));
    sink(new Uint8Array([4, 5]));
    return this.sonuc.goruntu_al ?? this.ok({ hafta: 3 });
  };
  gunluk_al = (...a: unknown[]): string => this.kayit("gunluk_al", ...a);
  tarif_al = (...a: unknown[]): string => this.kayit("tarif_al", ...a);
  devam = (...a: unknown[]): string => {
    this.cagrilar.push({ ad: "devam", args: a });
    const ilerleme = a[8] as (h: number) => void;
    ilerleme(3);
    ilerleme(4);
    return this.sonuc.devam ?? this.ok({ durum: "tamam", kosu_id: "k", hafta: 4, uygulanan: 4, kalan: 0 });
  };
  tariften_oynat = (...a: unknown[]): string => this.kayit("tariften_oynat", ...a);
  kapat = (): string => this.kayit("kapat");
}

interface Duzen {
  isci: Isci;
  giden: { m: IsciMesaji; aktar?: Transferable[] }[];
  kopru: SahteKopru;
  ortam: IsciOrtami;
  py: { env?: Record<string, string>; indexURL?: string; unpack: unknown[][]; yol: unknown[][]; sira: string[] };
}

function duzen(o: { manifest?: unknown; zip?: Uint8Array; sha?: string; surum?: string; manifestDurum?: number; zipDurum?: number; anahtar?: unknown; pyodideHata?: boolean; fetchHata?: boolean } = {}): Duzen {
  const kopru = new SahteKopru();
  if (o.anahtar !== undefined) kopru.sonuc.uyumluluk_anahtari = kopru.ok(o.anahtar);
  const py = { env: undefined as Record<string, string> | undefined, indexURL: undefined as string | undefined, unpack: [] as unknown[][], yol: [] as unknown[][], sira: [] as string[] };
  const zip = o.zip ?? new Uint8Array([1, 2, 3, 4, 5, 6]);
  const ortam: IsciOrtami = {
    fetch: async (girdi) => {
      py.sira.push(`fetch:${girdi.replace("http://x", "")}`);
      if (o.fetchHata) throw new TypeError("ag");
      if (girdi.endsWith("manifest.json")) return new Response(JSON.stringify(o.manifest ?? MANIFEST), { status: o.manifestDurum ?? 200 });
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(zip.slice(0, 3));
            c.enqueue(zip.slice(3));
            c.close();
          },
        }),
        { status: o.zipDurum ?? 200 },
      );
    },
    pyodideAc: async (url) => {
      py.sira.push(`import:${url.replace("http://x", "")}`);
      if (o.pyodideHata) throw new Error("import");
      const modul: PyodideModulu = {
        loadPyodide: async (s) => {
          py.env = s.env;
          py.indexURL = s.indexURL;
          py.sira.push("loadPyodide");
          const yuz: PyodideYuzu = {
            version: o.surum ?? PYODIDE_SURUMU,
            unpackArchive: (...a) => {
              py.sira.push("unpack");
              py.unpack.push(a);
            },
            pyimport: (ad) => {
              if (ad === "sys") return { path: { insert: (...a: unknown[]) => py.yol.push(a) } };
              if (ad === "pyodide.ffi") return { to_js: "TO_JS" };
              if (ad === "oyun_server.tarayici.isci_kopru") return { kur: (toJs: unknown) => (py.sira.push(`kur:${String(toJs)}`), kopru) };
              throw new Error(`pyimport_${ad}`);
            },
          };
          return yuz;
        },
      };
      return modul;
    },
    sha256Hex: async () => o.sha ?? SHA,
    simdi: (() => {
      let t = 0;
      return () => (t += 10);
    })(),
    bekle: async () => undefined,
  };
  const giden: Duzen["giden"] = [];
  const isci = new Isci(ortam, (m, aktar) => giden.push({ m, aktar }));
  return { isci, giden, kopru, ortam, py };
}

const yukle = (d: Duzen): Promise<void> => d.isci.mesaj({ t: "yukle", girdi: GIRDI });
const cagri = (d: Duzen, y: string, a: unknown, id = 1): Promise<void> => d.isci.mesaj({ t: "cagri", id, y, a } as AnaMesaj);
const yanit = (d: Duzen, id = 1): IsciMesaji | undefined => d.giden.map((g) => g.m).find((m) => m.t === "yanit" && m.id === id);

describe("yukleme (B6 devri)", () => {
  it("siralama_ve_PYTHONHASHSEED_0_unpackArchive_app_sys_path_kur_to_js", async () => {
    const d = duzen();
    await yukle(d);
    expect(d.py.sira).toEqual([
      "fetch:/oyun/manifest.json",
      "fetch:/oyun/oyun-0123456789ab.zip",
      "fetch:/pyodide/0.27.7/pyodide.asm.wasm",          // on-indirme (ilerleme orani icin)
      "fetch:/pyodide/0.27.7/python_stdlib.zip",
      "fetch:/pyodide/0.27.7/pyodide.asm.js",
      "fetch:/pyodide/0.27.7/pyodide-lock.json",
      "import:/pyodide/0.27.7/pyodide.mjs",
      "loadPyodide",
      "unpack",
      "kur:TO_JS",
    ]);
    expect(d.py.env).toEqual({ PYTHONHASHSEED: "0" });
    expect(d.py.indexURL).toBe("http://x/pyodide/0.27.7/");
    expect(d.py.unpack).toEqual([[new Uint8Array([1, 2, 3, 4, 5, 6]), "zip", { extractDir: "/app" }]]);
    expect(d.py.yol).toEqual([[0, "/app/simulasyon/arayuz/server"]]);
    const son = d.giden.at(-1)?.m;
    expect(son).toMatchObject({ t: "hazir", anahtar: ANAHTAR, manifest: MANIFEST });
  });

  it("asama_ilerlemeleri_sirayla_indirme_orani_ve_sureler", async () => {
    const d = duzen();
    await yukle(d);
    const il = d.giden.map((g) => g.m).filter((m): m is Extract<IsciMesaji, { t: "ilerleme" }> => m.t === "ilerleme");
    expect([...new Set(il.map((m) => m.asama))]).toEqual(["manifest", "indirme", "dogrulama", "derleme", "paket", "kurulum"]);
    const indirme = il.filter((m) => m.asama === "indirme").map((m) => m.oran as number);
    expect(indirme.length).toBeGreaterThan(4);
    expect(indirme).toEqual([...indirme].sort((a, b) => a - b));            // oransal ve azalmaz (zip + Pyodide dosyalari toplam bayta gore)
    expect(indirme[0]).toBeGreaterThan(0);
    expect(indirme[0]).toBeLessThan(0.01);                                   // ilk 3 bayt / ~14 MB
    expect(indirme.at(-1)).toBeLessThanOrEqual(1);
    const hazir = d.giden.map((g) => g.m).find((m) => m.t === "hazir");
    expect(hazir?.t === "hazir" && Object.values(hazir.sureler).every((x) => x > 0)).toBe(true);
  });

  it("manifest_okunamaz_gecersiz_pyodide_surumu_farkli_acik_hata_kodlari", async () => {
    const kod = async (o: Parameters<typeof duzen>[0]): Promise<string | undefined> => {
      const d = duzen(o);
      await yukle(d);
      const m = d.giden.at(-1)?.m;
      return m?.t === "yuklemeHatasi" ? m.kod : undefined;
    };
    expect(await kod({ manifestDurum: 404 })).toBe("manifest_okunamadi");
    expect(await kod({ fetchHata: true })).toBe("manifest_okunamadi");
    expect(await kod({ manifest: { ...MANIFEST, surum: 2 } })).toBe("manifest_gecersiz");
    expect(await kod({ manifest: { ...MANIFEST, paket: { ...MANIFEST.paket, ad: "../x.zip" } } })).toBe("manifest_gecersiz");
    expect(await kod({ manifest: { ...MANIFEST, pyodide: "0.28.0" } })).toBe("pyodide_surumu_uyusmuyor");
    expect(await kod({ zipDurum: 500 })).toBe("paket_indirilemedi");
    expect(await kod({ surum: "0.28.0" })).toBe("pyodide_surumu_uyusmuyor");
    expect(await kod({ pyodideHata: true })).toBe("pyodide_yuklenemedi");
  });

  it("sha256_uyusmazligi_acik_hata_ve_Pyodide_hic_yuklenmez", async () => {
    const d = duzen({ sha: "c".repeat(64) });
    await yukle(d);
    const m = d.giden.at(-1)?.m;
    expect(m).toMatchObject({ t: "yuklemeHatasi", kod: "sha_uyusmuyor", ayrinti: { beklenen: SHA, bulunan: "c".repeat(64) } });
    expect(d.py.sira.some((s) => s.startsWith("import:") || s === "loadPyodide")).toBe(false);
  });

  it("model_anahtari_manifestle_uyusmazsa_acik_hata_ve_cagri_hazir_degil", async () => {
    const d = duzen({ anahtar: { ...ANAHTAR, model_sha256: "d".repeat(64) } });
    await yukle(d);
    const m = d.giden.at(-1)?.m;
    expect(m).toMatchObject({ t: "yuklemeHatasi", kod: "model_anahtari_uyusmuyor" });
    expect(m?.t === "yuklemeHatasi" && (m.ayrinti.fark as Record<string, unknown>).model_sha256).toEqual([MODEL, "d".repeat(64)]);
    await cagri(d, "tick", { aboneler: [] });
    expect(yanit(d)).toMatchObject({ ok: false, hata: { tur: "hazir_degil" } });
  });

  it("ikinci_yukle_istegi_yok_sayilir", async () => {
    const d = duzen();
    await yukle(d);
    const n = d.giden.length;
    await yukle(d);
    expect(d.giden.length).toBe(n);
  });

  it("manifestiDogrula_sha_bicimi_ve_boyut", () => {
    expect(() => manifestiDogrula({ ...MANIFEST, model_sha256: "xyz" })).toThrow(YuklemeHatasi);
    expect(() => manifestiDogrula({ ...MANIFEST, paket: { ...MANIFEST.paket, boyut: 0 } })).toThrow(YuklemeHatasi);
    expect(manifestiDogrula(MANIFEST)).toEqual(MANIFEST);
  });
});

describe("cagri dagitimi", () => {
  it("yuklenmeden_cagri_hazir_degil", async () => {
    const d = duzen();
    await cagri(d, "istek", { yontem: "GET", yol: "/api/hello" });
    expect(yanit(d)).toMatchObject({ ok: false, hata: { tur: "hazir_degil", fark: null } });
  });

  it("istek_govde_ve_arsiv_JSON_dizgesi_sonuc_nesne", async () => {
    const d = duzen();
    await yukle(d);
    d.kopru.sonuc.istek = d.kopru.ok({ status: 200, headers: {}, body: { a: 1 } });
    await cagri(d, "istek", { yontem: "POST", yol: "/api/runs", govde: { x: 1 }, arsiv: [{ week: 2 }] });
    expect(d.kopru.cagrilar.at(-1)).toEqual({ ad: "istek", args: ["POST", "/api/runs", '{"x":1}', '[{"week":2}]'] });
    expect(yanit(d)).toEqual({ t: "yanit", id: 1, ok: true, s: { status: 200, headers: {}, body: { a: 1 } } });
    await cagri(d, "istek", { yontem: "GET", yol: "/api/hello", arsiv: [] }, 2);
    expect(d.kopru.cagrilar.at(-1)).toEqual({ ad: "istek", args: ["GET", "/api/hello", undefined, undefined] });
  });

  it("Python_hatasi_tur_mesaj_fark_olarak_tasinir_CekirdekHatasi_sozlesmesi", async () => {
    const d = duzen();
    await yukle(d);
    d.kopru.sonuc.devam = '{"ok":false,"hata":{"tur":"UyumsuzGoruntu","mesaj":"goruntu uyumsuz","fark":{"pyodide":["0.27.7","0.28.0"]}}}';
    await cagri(d, "devam", { parcalar: [], yonetici: {}, gunluk: [], hedefHafta: 5 });
    expect(yanit(d)).toEqual({ t: "yanit", id: 1, ok: false, hata: { tur: "UyumsuzGoruntu", mesaj: "goruntu uyumsuz", fark: { pyodide: ["0.27.7", "0.28.0"] } } });
  });

  it("goruntuAl_parcalari_transfer_listesiyle_sink_kopyasi_hata_olursa_parca_gonderilmez", async () => {
    const d = duzen();
    await yukle(d);
    await cagri(d, "goruntuAl", { kosuId: "k1" });
    const g = d.giden.at(-1);
    const s = (g?.m as Extract<IsciMesaji, { t: "yanit"; ok: true }>).s as { sonuc: unknown; parcalar: ArrayBuffer[] };
    expect(s.sonuc).toEqual({ hafta: 3 });
    expect(s.parcalar.map((b) => [...new Uint8Array(b)])).toEqual([[1, 2, 3], [4, 5]]);
    expect(g?.aktar).toEqual(s.parcalar);                                    // transfer listesi = parcalarin kendisi (kopyasiz)
    d.kopru.sonuc.goruntu_al = '{"ok":false,"hata":{"tur":"GoruntuHazirDegil","mesaj":"bekleyen_karar","fark":null}}';
    await cagri(d, "goruntuAl", { kosuId: "k1" }, 2);
    const h = d.giden.at(-1);
    expect(h?.m).toMatchObject({ ok: false, hata: { tur: "GoruntuHazirDegil" } });
    expect(h?.aktar).toBeUndefined();
  });

  it("tick_olaylari_ayni_yanitta_ve_ms_olculur", async () => {
    const d = duzen();
    await yukle(d);
    d.kopru.sonuc.tick = d.kopru.ok([{ abone: 1, olaylar: [{ id: 1, event: "week", data: { week: 1 } }], kapandi: false }]);
    await cagri(d, "tick", { aboneler: [1] });
    const s = (yanit(d) as Extract<IsciMesaji, { t: "yanit"; ok: true }>).s as { ms: number; olaylar: unknown[] };
    expect(s.olaylar).toHaveLength(1);
    expect(s.ms).toBeGreaterThan(0);
    expect(d.kopru.cagrilar.at(-1)).toEqual({ ad: "tick", args: [[1]] });
  });

  it("bosta_tick_sonrasi_SONRAKI_tickin_basinda_beklenir_yanit_gecikmez_hafta_olayi_bosta_degildir", async () => {
    const beklenen: number[] = [];
    const d = duzen();
    (d.ortam as { bekle: IsciOrtami["bekle"] }).bekle = async (ms) => void beklenen.push(ms);
    await yukle(d);
    d.kopru.sonuc.tick = d.kopru.ok([]);
    await cagri(d, "tick", { aboneler: [], bostaBekleMs: 100 });
    expect(beklenen).toEqual([]);                                            // ilk tick: bekleme yok, yanit hemen
    expect(yanit(d)).toMatchObject({ ok: true });
    await cagri(d, "tick", { aboneler: [], bostaBekleMs: 100 }, 2);
    expect(beklenen).toEqual([100]);                                         // onceki bosta: bu tick'in basinda
    await cagri(d, "tick", { aboneler: [] }, 3);
    expect(beklenen.length).toBe(1);                                         // bostaBekleMs verilmediyse beklenmez
    // hafta olayi tasiyan kisa tick bosta degildir: sonraki tick beklemez
    d.kopru.sonuc.tick = d.kopru.ok([{ abone: 1, olaylar: [{ id: 1, event: "week", data: {} }], kapandi: false }]);
    await cagri(d, "tick", { aboneler: [1], bostaBekleMs: 100 }, 4);
    await cagri(d, "tick", { aboneler: [1], bostaBekleMs: 100 }, 5);
    expect(beklenen.length).toBe(2);                                         // 3. tick bostaydi -> 4. tick'te bir bekleme; 5. tick'te yok
    expect(BOSTA_MS).toBeGreaterThan(10);
  });

  it("bekleme_sirasinda_gelen_baska_istek_tick_yanitindan_ONCE_yanitlanir", async () => {
    const d = duzen();
    let birak: () => void = () => undefined;
    (d.ortam as { bekle: IsciOrtami["bekle"] }).bekle = () => new Promise<void>((c) => (birak = c));
    await yukle(d);
    d.kopru.sonuc.tick = d.kopru.ok([]);
    await cagri(d, "tick", { aboneler: [], bostaBekleMs: 100 }, 1);          // bosta
    const bekleyen = cagri(d, "tick", { aboneler: [], bostaBekleMs: 100 }, 2);
    await cagri(d, "olaylar", { aboneler: [] }, 3);
    expect(yanit(d, 3)).toMatchObject({ ok: true });
    expect(yanit(d, 2)).toBeUndefined();
    birak();
    await bekleyen;
    const sira = d.giden.map((g) => g.m).filter((m) => m.t === "yanit").map((m) => (m as { id: number }).id);
    expect(sira).toEqual([1, 3, 2]);
  });

  it("devam_ilerleme_geri_cagrisi_devamIlerleme_mesaji_parcalar_Uint8Array_json_girdiler", async () => {
    const d = duzen();
    await yukle(d);
    await cagri(d, "devam", { parcalar: [new Uint8Array([9, 8]).buffer], yonetici: { sema: 1 }, gunluk: [{ sira: 1 }], hedefHafta: 8, paketler: [{ week: 4 }], kosuId: "yeni", ebeveyn: ["eski", 8], azamiHafta: 12 }, 7);
    const c = d.kopru.cagrilar.at(-1)?.args as unknown[];
    expect((c[0] as Uint8Array[]).map((u) => [...u])).toEqual([[9, 8]]);
    expect(c.slice(1, 8)).toEqual(['{"sema":1}', '[{"sira":1}]', 8, '[{"week":4}]', "yeni", '["eski",8]', 12]);
    expect(d.giden.map((g) => g.m).filter((m) => m.t === "devamIlerleme")).toEqual([
      { t: "devamIlerleme", id: 7, hafta: 3 },
      { t: "devamIlerleme", id: 7, hafta: 4 },
    ]);
    expect(yanit(d, 7)).toMatchObject({ ok: true });
  });

  it("bilinmeyen_yontem_acik_hata", async () => {
    const d = duzen();
    await yukle(d);
    await cagri(d, "yok_boyle", null, 2);
    expect(yanit(d, 2)).toMatchObject({ ok: false, hata: { tur: "bilinmeyen_yontem" } });
    expect(new IsciHatasi("kapali").tur).toBe("kapali");
  });
});
