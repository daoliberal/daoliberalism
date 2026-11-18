// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CekirdekHatasi } from "@/oyun/tarayici/kayit/cekirdek";
import { kayitCekirdegi, type IsciCagrisi } from "@/oyun/tarayici/kayitCekirdegi";
import type { YontemAdi } from "@/oyun/tarayici/protokol";
import { ANAHTAR, ornekDeger, tarifOrnek } from "./kayit/yardimci";
import { TEL_SEMA, type Yonetici } from "@/oyun/tarayici/kayit/tel";

interface Cagri {
  y: YontemAdi;
  a: unknown;
  o?: { aktar?: Transferable[]; devamIlerleme?: (h: number) => void };
}

function isci(yanit: (c: Cagri) => unknown): { isci: IsciCagrisi; cagrilar: Cagri[] } {
  const cagrilar: Cagri[] = [];
  return {
    cagrilar,
    isci: {
      async cagri(y, a, o) {
        const c = { y, a, o } as Cagri;
        cagrilar.push(c);
        const s = yanit(c);
        if (s instanceof Error) throw s;
        return s as never;
      },
    },
  };
}

describe("kayitCekirdegi: KayitCekirdegi arayuzunun Worker uygulamasi", () => {
  it("basit_yontemler_dogru_cagriya_eslenir", async () => {
    const t = isci((c) => ({ uyumlulukAnahtari: ANAHTAR, goruntuGerekli: true, gunlukAl: [], tarifAl: tarifOrnek() })[c.y as string]);
    const k = kayitCekirdegi(t.isci);
    expect(await k.uyumlulukAnahtari()).toEqual(ANAHTAR);
    expect(await k.goruntuGerekli("k1")).toBe(true);
    expect(await k.gunlukAl("k1", 4)).toEqual([]);
    expect(await k.tarifAl("k1")).toEqual(tarifOrnek());
    expect(t.cagrilar.map((c) => [c.y, c.a])).toEqual([["uyumlulukAnahtari", null], ["goruntuGerekli", { kosuId: "k1" }], ["gunlukAl", { kosuId: "k1", sonra: 4 }], ["tarifAl", { kosuId: "k1" }]]);
  });

  it("goruntuAl_parcalar_sirayla_sink_e_birlestirmeden_hata_olursa_sink_cagrilmaz", async () => {
    const yon = ornekDeger(TEL_SEMA.yonetici) as Yonetici;
    const sonuc = { hafta: 3, yayimlanan: 3, goruntu_kimligi: "g", ham: 1, sikisik: 2, parca: 2, anahtar: ANAHTAR, gunluk_sira: 0, yonetici: yon };
    const t = isci(() => ({ sonuc, parcalar: [new Uint8Array([1, 2]).buffer, new Uint8Array([3]).buffer] }));
    const verilen: number[][] = [];
    expect(await kayitCekirdegi(t.isci).goruntuAl("k", (u) => verilen.push([...u]))).toEqual(sonuc);
    expect(verilen).toEqual([[1, 2], [3]]);
    const h = isci(() => new CekirdekHatasi("GoruntuHazirDegil", "bekleyen"));
    const v2: unknown[] = [];
    await expect(kayitCekirdegi(h.isci).goruntuAl("k", (u) => v2.push(u))).rejects.toMatchObject({ tur: "GoruntuHazirDegil" });
    expect(v2).toEqual([]);
  });

  it("devam_parcalar_transfer_listesiyle_yonetici_ve_ilerleme_gecer_hata_CekirdekHatasi", async () => {
    const yon = ornekDeger(TEL_SEMA.yonetici) as Yonetici;
    const parca = new Uint8Array([7]).buffer;
    const t = isci(() => ({ durum: "tamam", kosu_id: "k", hafta: 5, uygulanan: 1, kalan: 0 }));
    const il = (): void => undefined;
    await kayitCekirdegi(t.isci).devam({ goruntu: { parcalar: [parca], yonetici: yon }, gunluk: [], hedefHafta: 5, paketler: [{ week: 4 }], kosuId: "yeni", ebeveyn: ["e", 5], azamiHafta: 12, ilerleme: il });
    const c = t.cagrilar[0] as Cagri;
    expect(c.o?.aktar).toEqual([parca]);
    expect(c.o?.devamIlerleme).toBe(il);
    expect(c.a).toMatchObject({ parcalar: [parca], yonetici: yon, hedefHafta: 5, kosuId: "yeni", ebeveyn: ["e", 5], azamiHafta: 12 });
    const h = isci(() => new CekirdekHatasi("UyumsuzGoruntu", "x", { pyodide: ["a", "b"] }));
    await expect(kayitCekirdegi(h.isci).devam({ goruntu: { parcalar: [], yonetici: yon }, gunluk: [], hedefHafta: 1 })).rejects.toMatchObject({ tur: "UyumsuzGoruntu", fark: { pyodide: ["a", "b"] } });
  });

  it("tariftenOynat_girdisi_ve_ilerleme", async () => {
    const t = isci(() => ({ durum: "tamam", kosu_id: "k", hafta: 2, uygulanan: 2, kalan: 0 }));
    const il = (): void => undefined;
    await kayitCekirdegi(t.isci).tariftenOynat({ tarif: tarifOrnek(), gunluk: [], hedefHafta: 2, kosuId: "k", ilerleme: il });
    expect(t.cagrilar[0]).toMatchObject({ y: "tariftenOynat", a: { hedefHafta: 2, kosuId: "k" }, o: { devamIlerleme: il } });
  });

  it("kosuSil_DELETE_rotasi_404_kosu_yok_digerleri_HttpHatasi", async () => {
    let durum = 204;
    const t = isci(() => ({ status: durum, headers: {}, body: null }));
    const k = kayitCekirdegi(t.isci);
    await k.kosuSil("canli-a b");
    expect(t.cagrilar[0]?.a).toEqual({ yontem: "DELETE", yol: "/api/runs/canli-a%20b" });
    durum = 404;
    await expect(k.kosuSil("x")).rejects.toMatchObject({ tur: "UnknownRun" });
    durum = 500;
    await expect(k.kosuSil("x")).rejects.toMatchObject({ tur: "HttpHatasi" });
  });
});
