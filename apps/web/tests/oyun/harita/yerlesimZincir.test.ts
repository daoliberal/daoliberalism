import { describe, expect, it } from "vitest";
import { sehirSahnesi, type SehirSahnesiBaglami } from "@/oyun/harita/sehirSahnesi";
import type { HaritaDurumu, HaritaFirmaSatiri } from "@/oyun/harita/tipler";
import type { HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { izoSahneKur } from "@/oyun/harita/izoSahne";
import { packetOf } from "../helpers/fakeLiveServer";
import { izoManifestFiksturu } from "./fikstur/izoManifest";

const lonca = (ref: string): HoldingsLonca => ({ ref, owner: "player", members: 5, fee: null, capital: null, deposits: null, credit_out: null, equity: null });
const paket = (n = 3): WeekPacket => ({ ...packetOf("r", 20, 1), holdings: { loncas: Array.from({ length: n }, (_, i) => lonca(`l${i}`)) } as WeekPacket["holdings"] });
const TURLER = ["market", "un", "maden_komur", "lojistik", "okul"];
type F = { id: string; calisan: number; durum: HaritaDurumu; sahip?: "npc" | "oyuncu" };
const satir = (f: F): HaritaFirmaSatiri => [f.id, TURLER[Number(f.id.slice(1)) % TURLER.length]!, 0, f.calisan, null, f.sahip ?? "npc", null, f.durum];
const rnd = (tohum: number) => () => ((tohum = (tohum * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Hook mantığının saf karşılığı: önceki tablo -> sahne -> yeni tablo (commit). Dönüş: taşınan canlı firma sayısı. */
function zincir(izo: boolean, haftalar: F[][], sabit: Map<string, string> = new Map(), loncalar: number[] = []) {
  let tablo: ReadonlyMap<string, string> | null = null;
  let onceki: Record<string, string | null> = {};
  let tasinan = 0;
  const gecmis: Record<string, string | null>[] = [];
  for (const [hi, firmalar] of haftalar.entries()) {
    const ctx: SehirSahnesiBaglami = { runId: "k", sehirAdlari: ["A"], sehir: 0, katman: "yok", parselSecilebilir: true, yerlesim: tablo, sabitlemeler: sabit, ...(izo ? { izo: true as const } : {}) };
    const s = sehirSahnesi(paket(loncalar[hi] ?? 3), { hafta: 1, firmalar: firmalar.map(satir) }, ctx);
    tablo = s.yerlesim!;
    const simdi = Object.fromEntries(s.binalar.filter((b) => b.tur === "isletme").map((b) => [b.id, b.parsel]));
    for (const id of Object.keys(simdi)) if (id in onceki && onceki[id] !== simdi[id]) tasinan++;
    onceki = simdi;
    gecmis.push(simdi);
  }
  return { tasinan, gecmis };
}
const f = (i: number, calisan = 5, durum: HaritaDurumu = "uretim"): F => ({ id: `f${i}`, calisan, durum });

for (const izo of [false, true]) {
  describe(`kalici yerlesim zinciri (${izo ? "izo" : "klasik"})`, () => {
    it("firma_sayisi_60_10_50_salinimda_hicbir_canli_firma_tasinmaz", () => {
      const sayilar = [60, 60, 10, 10, 10, 50, 50, 5, 70];
      const haftalar = sayilar.map((n) => Array.from({ length: n }, (_, i) => f(i)));
      expect(zincir(izo, haftalar).tasinan).toBe(0);
    });
    it("rastgele_dogum_olum_200_hafta_kapali_tutma_ve_boy_degisimiyle_tasinma_yok", () => {
      const r = rnd(11);
      let canli = new Map<string, F>(Array.from({ length: 40 }, (_, i) => [`f${i}`, f(i, 5 + Math.floor(r() * 60))]));
      let sayac = 100;
      const haftalar: F[][] = [];
      for (let h = 0; h < 220; h++) {
        const hedef = h % 60 < 20 ? 8 : 65; // salınım
        for (const [id, x] of [...canli]) {
          if (r() < 0.05) canli.delete(id);
          else if (x.durum === "kapali" && r() < 0.1) canli.delete(id);
          else if (r() < 0.04) canli.set(id, { ...x, durum: "kapali" });
          else if (r() < 0.1) canli.set(id, { ...x, calisan: 1 + Math.floor(r() * 80) }); // boy 1-4 arası
        }
        while (canli.size < hedef && r() < 0.8) canli.set(`f${sayac}`, f(sayac++, 5));
        while (canli.size > hedef + 5 && r() < 0.5) canli.delete([...canli.keys()][0]!);
        canli = new Map(canli);
        haftalar.push([...canli.values()]);
      }
      expect(zincir(izo, haftalar).tasinan).toBe(0);
    });
    it("sabitleme_yalniz_bir_kez_hedef_sonradan_bosalsa_da_tasinmaz", () => {
      const taban = Array.from({ length: 12 }, (_, i) => f(i));
      const ilk = zincir(izo, [taban]).gecmis[0]!;
      const hedefSahibi = "f3";
      const hedef = ilk[hedefSahibi]!;
      const oyuncu: F = { id: "fo", calisan: 5, durum: "uretim", sahip: "oyuncu" };
      const sabit = new Map([["fo", hedef]]);
      const h1 = [...taban, oyuncu];
      const h2 = [...taban.filter((x) => x.id !== hedefSahibi), oyuncu]; // hedefi tutan düştü
      const h3 = [...taban.filter((x) => x.id !== hedefSahibi), oyuncu, f(40)];
      const { gecmis, tasinan } = zincir(izo, [taban, h1, h2, h3, h3], sabit);
      expect(gecmis[1]!["fo"]).not.toBe(hedef); // hedef dolu: en yakın boşa
      // 'fo' ilk yerleştiği yerde kalır; hedef boşalsa da taşınmaz
      expect(gecmis[2]!["fo"]).toBe(gecmis[1]!["fo"]);
      expect(gecmis[4]!["fo"]).toBe(gecmis[1]!["fo"]);
      expect(tasinan).toBe(0);
    });
  });
}

for (const izo of [false, true]) {
  describe(`kalici yerlesim: lonca sayisi artarken (${izo ? "izo" : "klasik"})`, () => {
    it("lonca_1den_40a_artarken_60_firmali_zincirde_sifir_tasima", () => {
      const firmalar = Array.from({ length: 60 }, (_, i) => f(i));
      const loncalar = Array.from({ length: 40 }, (_, i) => i + 1);
      const r = zincir(izo, loncalar.map(() => firmalar), new Map(), loncalar);
      expect(r.tasinan).toBe(0);
      // loncalar deliğe sığmasa da sahne kurulur ve her lonca bir yere konur
    });
    it("gercekci_200_hafta_6_haftada_bir_lonca_artarken_firma_dogum_olumu_sifir_tasima", () => {
      const r = rnd(5);
      let canli = new Map<string, F>(Array.from({ length: 30 }, (_, i) => [`f${i}`, f(i)]));
      let sayac = 100;
      const haftalar: F[][] = [];
      const loncalar: number[] = [];
      for (let h = 0; h < 200; h++) {
        for (const id of [...canli.keys()]) if (r() < 0.03) canli.delete(id);
        while (canli.size < 30 + Math.floor(h / 4) && r() < 0.9) canli.set(`f${sayac}`, f(sayac++, 5));
        canli = new Map(canli);
        haftalar.push([...canli.values()]);
        loncalar.push(1 + Math.floor(h / 6));
      }
      expect(zincir(izo, haftalar, new Map(), loncalar).tasinan).toBe(0);
    });
  });
}

describe("deliğe sığmayan loncalar (izo sahne)", () => {
  it("40_lonca_60_firma_izo_sahne_kurulur_hucreler_cakismaz_ve_firmalar_tasinmaz", () => {
    let tablo: ReadonlyMap<string, string> | null = null;
    const firmalar = Array.from({ length: 60 }, (_, i) => f(i));
    const onceki: Record<string, string> = {};
    for (let n = 1; n <= 40; n += 3) {
      const k = sehirSahnesi(paket(n), { hafta: 1, firmalar: firmalar.map(satir) }, { runId: "k", sehirAdlari: ["A"], sehir: 0, katman: "yok", parselSecilebilir: true, izo: true, yerlesim: tablo });
      tablo = k.yerlesim!;
      const iz = izoSahneKur(k, izoManifestFiksturu(), "t", (_, b) => b);
      const hucreler = iz.binalar.filter((b) => b.tur === "lonca" || b.tur === "isletme").map((b) => `${b.hucre.c},${b.hucre.r}`);
      expect(new Set(hucreler).size).toBe(hucreler.length);
      for (const b of k.binalar.filter((x) => x.tur === "isletme")) {
        if (b.id in onceki) expect(b.parsel).toBe(onceki[b.id]);
        onceki[b.id] = b.parsel!;
      }
    }
  });
});
