import { describe, expect, it } from "vitest";
import { sehirSahnesi } from "@/oyun/harita/sehirSahnesi";
import { tabloOku, tabloYaz } from "@/oyun/harita/yerlesimTablosu";
import type { HaritaFirmaSatiri } from "@/oyun/harita/tipler";
import type { HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const lonca = (ref: string): HoldingsLonca => ({ ref, owner: "player", members: 5, fee: null, capital: null, deposits: null, credit_out: null, equity: null });
const paket = (n: number): WeekPacket => ({ ...packetOf("r", 20, 1), holdings: { loncas: Array.from({ length: n }, (_, i) => lonca(`l${i}`)) } as WeekPacket["holdings"] });
const firmalar = (n: number): HaritaFirmaSatiri[] => Array.from({ length: n }, (_, i) => [`f${i}`, "market", 0, 5, null, "npc", null, "uretim"]);
const ctx = (izo: boolean, yerlesim: ReadonlyMap<string, string> | null) => ({ runId: "k", sehirAdlari: ["A"], sehir: 0, katman: "yok" as const, parselSecilebilir: true, yerlesim, ...(izo ? { izo: true as const } : {}) });

describe("okunan tablo doğrulaması", () => {
  for (const bozuk of ["1e6", "NaN", "-3", "999", "abc", "2.5"]) {
    it(`tabloOku_bozuk_kademe_${bozuk}_tabloyu_yok_sayar`, () => {
      tabloYaz("b.izo.0", new Map([["f1", "p0_0"], ["#kademe", bozuk]]), "b");
      expect(tabloOku("b.izo.0")).toBeNull();
    });
    it(`tabloOku_bozuk_meydan_${bozuk}_tabloyu_yok_sayar`, () => {
      if (bozuk === "2.5") return; // meydan ondalık olabilir
      tabloYaz("c.izo.0", new Map([["f1", "p0_0"], ["#meydan", bozuk]]), "c");
      expect(tabloOku("c.izo.0")).toBeNull();
    });
  }
  it("gecerli_kademe_ve_meydan_okunur", () => {
    tabloYaz("d.izo.0", new Map([["f1", "p0_0"], ["#kademe", "3"], ["#meydan", "120"]]), "d");
    expect(tabloOku("d.izo.0")?.get("#kademe")).toBe("3");
  });
  for (const izo of [false, true]) {
    it(`sehirSahnesi_bozuk_tablo_degerlerinde_donmaz_ve_sahne_kurar_${izo ? "izo" : "klasik"}`, () => {
      const bozuk = new Map([["f0", "p0_0"], ["#kademe", "1000000"], ["#meydan", "1e9"]]);
      const s = sehirSahnesi(paket(3), { hafta: 1, firmalar: firmalar(10) }, ctx(izo, bozuk));
      expect(s.binalar.filter((b) => b.tur === "isletme")).toHaveLength(10);
      expect(Number(s.yerlesim!.get("#kademe"))).toBeLessThan(40);
    });
  }
  it("ikili_arama_farkli_lonca_gecmislerinde_atanmis_yuvayi_yutmaz", () => {
    for (const izo of [false, true]) {
      for (const gecmis of [[1, 8, 25, 40], [40, 3, 40], [5, 5, 30, 2, 33], [2, 14, 9, 40, 1]]) {
        let tablo: ReadonlyMap<string, string> | null = null;
        const onceki: Record<string, string | null> = {};
        for (const n of gecmis) {
          const s = sehirSahnesi(paket(n), { hafta: 1, firmalar: firmalar(60) }, ctx(izo, tablo));
          tablo = s.yerlesim!;
          for (const b of s.binalar.filter((x) => x.tur === "isletme")) {
            if (b.id in onceki) expect(b.parsel, `${izo} ${gecmis} ${b.id}`).toBe(onceki[b.id]);
            onceki[b.id] = b.parsel;
          }
        }
      }
    }
  });
});
