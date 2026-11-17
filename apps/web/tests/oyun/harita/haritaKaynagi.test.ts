import { describe, expect, it } from "vitest";
import { haritaBirlestir, sonFark, sonHarita } from "@/oyun/harita/haritaKaynagi";
import type { HaritaFarki, HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import type { WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const sat = (id: string, calisan = 5, durum: HaritaFirmaSatiri[7] = "uretim"): HaritaFirmaSatiri => [id, "un", 0, calisan, null, "npc", null, durum];
const baz = (hafta: number, ...f: HaritaFirmaSatiri[]): HaritaVerisi => ({ hafta, firmalar: f });
const fark = (hafta: number, taban: number, ek: Partial<HaritaFarki> = {}): HaritaFarki => ({ hafta, taban, degisen: [], yeni: [], kapanan: [], ...ek });
const pk = (week: number, ek: { harita?: HaritaVerisi; haritaFark?: HaritaFarki } = {}): WeekPacket => ({ ...packetOf("r", week, 1), ...ek });

describe("haritaBirlestir", () => {
  it("haritaBirlestir_taban_yoksa_null", () => {
    expect(haritaBirlestir(null, fark(12, 10))).toBeNull();
    expect(haritaBirlestir(baz(10, sat("a")), null)).toBeNull();
    expect(haritaBirlestir(null, null)).toBeNull();
  });

  it("haritaBirlestir_taban_uyusmazsa_null", () => {
    // araya giren / yeniden bağlanan istemci: elindeki tam alan 1. hafta, gelen fark 20. haftayı taban alıyor
    expect(haritaBirlestir(baz(1, sat("a")), fark(23, 20))).toBeNull();
    expect(haritaBirlestir(baz(20, sat("a")), fark(15, 10))).toBeNull();
  });

  it("haritaBirlestir_degisen_yeni_kapanan_uygular", () => {
    const b = baz(10, sat("a", 5), sat("b", 30), sat("c", 9));
    const f = fark(14, 10, { degisen: [["a", "kapali", 0], ["b", "zayif", 55]], yeni: [sat("d", 3)], kapanan: ["c"] });
    const out = haritaBirlestir(b, f);
    expect(out).toEqual({ hafta: 14, firmalar: [sat("a", 0, "kapali"), sat("b", 55, "zayif"), sat("d", 3)] });
    expect(b.firmalar).toHaveLength(3);                                    // taban değişmez (artımlı birleştirme her seferinde tabandan)
    expect(b.firmalar[0]).toEqual(sat("a", 5));
    expect(haritaBirlestir(b, fark(15, 10))).toEqual({ hafta: 15, firmalar: b.firmalar });
  });

  it("bilinmeyen_kimlikli_degisen_ve_kapanan_yok_sayilir", () => {
    const out = haritaBirlestir(baz(10, sat("a")), fark(12, 10, { degisen: [["yok", "zayif", 1]], kapanan: ["yok2"] }));
    expect(out).toEqual({ hafta: 12, firmalar: [sat("a")] });
  });
});

describe("sonHarita / sonFark", () => {
  it("sonFark_atlanan_haftada_en_sonu_alir", () => {
    const weeks = [pk(10, { harita: baz(10, sat("a")) }), pk(11, { haritaFark: fark(11, 10) }), pk(12), pk(14, { haritaFark: fark(14, 10, { degisen: [["a", "zayif", 5]] }) })];      // 12 ve 13 yok/atlandı
    expect(sonFark(weeks)?.hafta).toBe(14);
    expect(sonHarita(weeks)?.hafta).toBe(10);
    expect(haritaBirlestir(sonHarita(weeks), sonFark(weeks))).toEqual({ hafta: 14, firmalar: [sat("a", 5, "zayif")] });
  });

  it("fark_yoksa_null_ve_gecmis_katlanmaz", () => {
    expect(sonFark([pk(1, { harita: baz(1) }), pk(2)])).toBeNull();
    expect(sonFark([])).toBeNull();
    // iki farktan yalnız sonuncusu tabandan uygulanır: 11. haftanın değişimi 14'te yeniden taşınmıyorsa geri gelmez (fark tabana göre ve birikimlidir)
    const weeks = [pk(10, { harita: baz(10, sat("a"), sat("b")) }), pk(11, { haritaFark: fark(11, 10, { degisen: [["a", "zayif", 5]] }) }), pk(14, { haritaFark: fark(14, 10, { degisen: [["a", "zayif", 5], ["b", "issiz", 0]] }) })];
    expect(haritaBirlestir(sonHarita(weeks), sonFark(weeks))?.firmalar).toEqual([sat("a", 5, "zayif"), sat("b", 0, "issiz")]);
  });
});
