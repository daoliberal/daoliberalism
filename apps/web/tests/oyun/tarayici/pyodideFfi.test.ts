// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { Isci, type IsciOrtami, type PyodideModulu } from "@/oyun/tarayici/isci";
import type { HaftaPaketi } from "@/oyun/tarayici/kayit/tel";
import type { AboneOlaylari, AnaMesaj, IsciMesaji, TickSonucu, YukleGirdisi } from "@/oyun/tarayici/protokol";

/**
 * Ö5: GERCEK Pyodide 0.27.7 (Node, B6 paketi: `public/oyun`, `public/pyodide/0.27.7`) ile Worker'daki AYNI kopru kodu (`Isci` + `isci_kopru.py`):
 * `goruntu_al` (to_js -> Uint8Array kopyasi -> ArrayBuffer parcalari) ve parcali `devam` (Uint8Array -> to_bytes). A cekirdeginden alinan goruntuyle
 * ikinci bir Pyodide'de devam edilir; sonraki haftalar kesintisizle BAYT BAYT esit olmalidir.
 * Yavas (~1 dk) ve `public/` ciktisina bagli (`node scripts/pyodideKopyala.mjs && node scripts/paketModel.mjs`): `OYUN_PYODIDE_FFI=1` ile calisir.
 */
const PUB = path.resolve(import.meta.dirname, "../../../public");
const KOSTUR = process.env.OYUN_PYODIDE_FFI === "1";
const CONFIG = { name: "Deneme", cityNames: ["A", "B", "C", "D", "E"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: {} };
const GIRDI: YukleGirdisi = { manifestUrl: "http://x/oyun/manifest.json", pyodideDizini: "http://x/pyodide/0.27.7/", oyunDizini: "http://x/oyun/" };

function ortam(): IsciOrtami {
  return {
    fetch: async (url) => {
      const buf = readFileSync(path.join(PUB, new URL(url).pathname));
      return new Response(buf, { headers: { "content-length": String(buf.length) } });
    },
    pyodideAc: async (url) => {
      const modul = (await import(/* @vite-ignore */ pathToFileURL(path.join(PUB, new URL(url).pathname)).href)) as PyodideModulu;
      return { loadPyodide: (o) => modul.loadPyodide({ ...o, indexURL: path.join(PUB, "pyodide/0.27.7/") + "/" }) };
    },
    sha256Hex: async (v) => createHash("sha256").update(new Uint8Array(v)).digest("hex"),
    simdi: () => performance.now(),
    bekle: async () => undefined,
  };
}

class Oturum {
  giden: IsciMesaji[] = [];
  isci = new Isci(ortam(), (m) => this.giden.push(m));
  private id = 0;
  haftalar = new Map<number, string>();
  abone = 0;
  kosuId = "";

  async yukle(): Promise<void> {
    await this.isci.mesaj({ t: "yukle", girdi: GIRDI });
    const son = this.giden.at(-1);
    if (son?.t !== "hazir") throw new Error(`yukleme_basarisiz ${JSON.stringify(son)}`);
  }

  async cagri<T>(y: string, a: unknown): Promise<T> {
    const id = ++this.id;
    await this.isci.mesaj({ t: "cagri", id, y, a } as AnaMesaj);
    const m = this.giden.find((x) => x.t === "yanit" && x.id === id);
    if (!m || m.t !== "yanit") throw new Error("yanit_yok");
    if (!m.ok) throw Object.assign(new Error(m.hata.mesaj), { tur: m.hata.tur });
    return m.s as T;
  }

  istek<T = unknown>(yontem: string, yol: string, govde?: unknown): Promise<{ status: number; body: T }> {
    return this.cagri("istek", { yontem, yol, govde });
  }

  topla(olaylar: AboneOlaylari[]): void {
    for (const s of olaylar) for (const o of s.olaylar) if (o.event === "week") this.haftalar.set((o.data as HaftaPaketi).week, JSON.stringify(o.data));
  }

  /** `hedef` hafta yayimlanana dek tick (en cok 80). */
  async sur(hedef: number): Promise<void> {
    for (let i = 0; i < 80 && !this.haftalar.has(hedef); i++) {
      const r = await this.cagri<TickSonucu>("tick", { aboneler: [this.abone] });
      this.topla(r.olaylar);
    }
    if (!this.haftalar.has(hedef)) throw new Error(`hafta_gelmedi_${hedef}`);
  }

  async adim(w: number): Promise<void> {
    await this.istek("POST", `/api/runs/${this.kosuId}/control`, { action: "step", speed: 16 });
    await this.sur(w);
  }

  async aboneOl(): Promise<void> {
    const r = await this.istek<{ abone: number }>("GET", `/api/runs/${this.kosuId}/events`);
    this.abone = r.body.abone;
    const o = await this.cagri<AboneOlaylari[]>("olaylar", { aboneler: [this.abone] });
    this.topla(o);
  }
}

describe.skipIf(!KOSTUR)("gercek Pyodide FFI (Node): goruntu_al + parcali devam", () => {
  it("goruntu_parcalari_ArrayBuffer_devam_ikinci_Pyodide_de_sonraki_haftalar_kesintisizle_bayt_bayt_esit", async () => {
    const A = new Oturum();
    await A.yukle();
    const yaratildi = await A.istek<{ runId: string }>("POST", "/api/runs", { config: CONFIG });
    expect(yaratildi.status).toBe(201);
    A.kosuId = yaratildi.body.runId;
    await A.aboneOl();
    for (let w = 1; w <= 3; w++) await A.adim(w);

    // goruntu_al: Python bytes -> to_js -> Uint8Array kopyasi -> ArrayBuffer (transfer listesi)
    let g: { sonuc: { yayimlanan: number; parca: number; sikisik: number; yonetici: unknown; anahtar: { pyodide: string } }; parcalar: ArrayBuffer[] } | null = null;
    for (let i = 0; i < 10 && g === null; i++) {
      try {
        g = await A.cagri("goruntuAl", { kosuId: A.kosuId });
      } catch (e) {
        if ((e as { tur?: string }).tur !== "GoruntuHazirDegil") throw e;
        topla(await A.cagri<TickSonucu>("tick", { aboneler: [A.abone] }), A);
      }
    }
    if (g === null) throw new Error("goruntu_alinamadi");
    expect(g.parcalar.length).toBe(g.sonuc.parca);
    expect(g.parcalar.length).toBeGreaterThan(0);
    expect(g.parcalar.every((b) => b instanceof ArrayBuffer && b.byteLength > 0)).toBe(true);
    expect(g.parcalar.reduce((a, b) => a + b.byteLength, 0)).toBeGreaterThanOrEqual(g.sonuc.sikisik);      // `sikisik` zlib govdesi; parcalar duz JSON onekini de tasir
    expect(g.sonuc.anahtar.pyodide).toBe("0.27.7");
    const yayimlanan = g.sonuc.yayimlanan;

    // B: ayni goruntuyle baska Pyodide'de parcali devam (Uint8Array -> to_bytes)
    const B = new Oturum();
    await B.yukle();
    const paketler = [...A.haftalar.entries()].filter(([w]) => w <= yayimlanan && w > yayimlanan - 4).sort((x, y) => x[0] - y[0]).map(([, p]) => JSON.parse(p) as HaftaPaketi);
    const devam = await B.cagri<{ durum: string; hafta: number; kosu_id: string }>("devam", {
      parcalar: g.parcalar,
      yonetici: g.sonuc.yonetici,
      gunluk: [],
      hedefHafta: yayimlanan,
      paketler,
    });
    expect(devam.durum).toBe("tamam");
    B.kosuId = devam.kosu_id;
    expect(B.kosuId).toBe(A.kosuId);
    await B.aboneOl();

    // Sonraki iki hafta: A kesintisiz, B goruntuden. Paketler (run_id dahil) bayt bayt esit.
    for (const w of [yayimlanan + 1, yayimlanan + 2]) {
      await A.adim(w);
      await B.adim(w);
      expect(B.haftalar.get(w), `hafta ${w}`).toBe(A.haftalar.get(w));
    }
  }, 300_000);
});

function topla(r: TickSonucu, o: Oturum): void {
  o.topla(r.olaylar);
}
