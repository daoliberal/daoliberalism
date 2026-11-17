import { describe, expect, it } from "vitest";
import { WireError, parseCapabilities, parseHarita, parseHaritaFark, parsePacket } from "@/oyun/sim/live/wire";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFakeLiveServer, haritaOf, haritaTel, packetOf } from "../../helpers/fakeLiveServer";

describe("wire: harita", () => {
  it("parse_harita_paketten", () => {
    const p = parsePacket({ ...packetOf("r", 10, 1), harita: haritaOf(10) });
    expect(p.harita!.hafta).toBe(10);
    expect(p.harita!.firmalar.length).toBeGreaterThan(5);
    expect(p.harita!.firmalar[0]).toEqual(["f0", "tarla_bugday", 0, 2, expect.anything(), "oyuncu", 0, "uretim"]);
    expect(parsePacket(packetOf("r", 11, 1)).harita).toBeUndefined();
  });

  it("bozuk satır atlanır, bozuk alan reddedilir", () => {
    const h = parseHarita({ hafta: 10, firmalar: [["a", "un", 0, 4, null, "npc"], ["b", "un", 0, 4, null, "robot"], ["c", "un", -1, 4, null, "npc"], ["d", "un"], "x", ["e", "un", 1, 4, "lonca0", "dao"]] });
    expect(h.firmalar.map((f) => f[0])).toEqual(["a", "e"]);
    expect(h.firmalar[0]).toEqual(["a", "un", 0, 4, null, "npc", null, "uretim"]);
    expect(() => parseHarita({ hafta: "10", firmalar: [] })).toThrow(WireError);
    expect(() => parseHarita({ hafta: 10, firmalar: {} })).toThrow(WireError);
  });

  it("sikistirilmis_tel_bicimi_ayni_ts_nesnesine_cevrilir_eski_bicim_de_okunur", () => {
    const h = haritaOf(10);
    h.firmalar.push(["s2_tarla_bugday17", "tarla_bugday", 2, 40, "lonca1", "dao", null, "uretim"], ["ozel-kimlik", "un", 0, 3, null, "oyuncu", null, "uretim"], ["s1_un07", "un", 1, 3, null, "npc", null, "uretim"]);
    const tel = haritaTel(h);
    expect(typeof (tel.firmalar as unknown[][])[h.firmalar.length - 3]![0]).toBe("number");      // kalıba uyan kimlik sayıya iner
    expect(typeof (tel.firmalar as unknown[][])[h.firmalar.length - 2]![0]).toBe("string");      // uymayan kimlik olduğu gibi
    expect(typeof (tel.firmalar as unknown[][])[h.firmalar.length - 1]![0]).toBe("string");      // "07" kurallı sayı değil: kayıpsız kalsın
    expect(parsePacket({ ...packetOf("r", 10, 1), harita: tel }).harita).toEqual(h);
    expect(parsePacket({ ...packetOf("r", 10, 1), harita: h }).harita).toEqual(h);
  });

  it("sunucunun_gercek_ciktisi_fiksturu_ayni_baytlarla_cozulur", () => {
    const tel = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/harita_tel.json"), "utf-8")) as unknown;
    expect(parseHarita(tel)).toEqual({
      hafta: 10,
      firmalar: [
        ["s0_tarla_bugday0", "tarla_bugday", 0, 40, null, "npc", null, "uretim"], ["s1_un12", "un", 1, 7, "lonca2", "oyuncu", null, "uretim"], ["ozel-kimlik", "un", 2, 5, null, "dao", null, "uretim"],
        ["77", "firin", 0, 5, "lonca2", "npc", null, "uretim"], ["s0_un9007199254740992", "un", 0, 5, null, "npc", null, "uretim"], ["s0_un07", "un", 0, 5, null, "npc", null, "kapali"],
        ["s2_un3", "un", 2, 5, null, "npc", 4, "zayif"], ["s2_un4", "un", 2, 0, null, "npc", 8, "issiz"], ["s2_un5", "un", 2, 5, null, "npc", 1, "kapali"],
      ],
    });
  });

  it("6_elemanli_eski_ve_8_elemanli_yeni_satir_okunur_7li_ve_bilinmeyen_durum_atlanir", () => {
    const tel = (...satirlar: unknown[][]) => ({ hafta: 4, turler: ["un"], loncalar: [], sahipler: ["npc", "oyuncu", "dao"], firmalar: satirlar });
    const h = parseHarita(tel(
      [1, 0, 0, 5, -1, 0],                      // eski: dogum null, durum uretim
      [2, 0, 0, 5, -1, 0, 17, "zayif"],         // yeni
      [3, 0, 1, 0, -1, 1, null, "issiz"],      // NPC: dogum null
      [4, 0, 1, 5, -1, 0, 3, "kapali"],
      [5, 0, 0, 5, -1, 0, 17],                  // 7 eleman: atlanir
      [6, 0, 0, 5, -1, 0, 17, "bilinmeyen"],    // bilinmeyen durum: atlanir
      [7, 0, 0, 5, -1, 0, "17", "uretim"],      // dogum tur hatasi: atlanir
      [8, 0, 0, 5, -1, 0, 1.5, "uretim"],       // dogum kesirli: atlanir
      [9, 0, 0, 5, -1, 0, -1, "uretim"],        // dogum negatif: atlanir
    ));
    expect(h.firmalar).toEqual([
      ["s0_un1", "un", 0, 5, null, "npc", null, "uretim"], ["s0_un2", "un", 0, 5, null, "npc", 17, "zayif"],
      ["s1_un3", "un", 1, 0, null, "oyuncu", null, "issiz"], ["s1_un4", "un", 1, 5, null, "npc", 3, "kapali"],
    ]);
  });

  it("bozuk_indeks_ya_da_kimlik_satiri_dusurur_atmaz", () => {
    const iyi = [3, 0, 1, 9, 0, 1];
    const tel = (...satirlar: unknown[][]) => ({ hafta: 4, turler: ["un"], loncalar: ["l0"], sahipler: ["npc", "oyuncu", "dao"], firmalar: [iyi, ...satirlar] });
    const kotu: unknown[][] = [
      [1, 5, 1, 9, -1, 0], [1, -1, 1, 9, -1, 0], [1, 0.5, 1, 9, -1, 0],      // tur indeksi aralık dışı / negatif / kesirli
      [1, 0, 1, 9, 3, 0], [1, 0, 1, 9, -2, 0], [1, 0, 1, 9, 0.5, 0],          // lonca: -1 dışı negatif, aralık dışı, kesirli
      [1, 0, 1, 9, -1, 3], [1, 0, 1, 9, -1, -1], [1, 0, 1, 9, -1, 1.5],        // sahip indeksi
      [2 ** 53, 0, 1, 9, -1, 0], [-1, 0, 1, 9, -1, 0], [1.5, 0, 1, 9, -1, 0],  // sayı kimlik güvenli tam sayı değil / negatif / kesirli
    ];
    const h = parseHarita(tel(...kotu));
    expect(h.firmalar).toEqual([["s1_un3", "un", 1, 9, "l0", "oyuncu", null, "uretim"]]);
  });

  it("capabilities.harita yalnız true ise açık", () => {
    expect(parseCapabilities({ harita: true }).harita).toBe(true);
    expect(parseCapabilities({}).harita).toBe(false);
  });

  it("sahte sunucu harita'yı yalnız 10. haftalarda ve yetenek açıkken yollar", () => {
    expect(packetOf("r", 20, 1, { harita: true }).harita?.hafta).toBe(20);
    expect(packetOf("r", 21, 1, { harita: true }).harita).toBeUndefined();
    expect(packetOf("r", 20, 1).harita).toBeUndefined();
  });

  it("sahte sunucu adımlarken harita yalnız 10. haftada ve yetenek açıkken gelir", async () => {
    const sunucu = createFakeLiveServer();
    expect(sunucu.capabilities.harita).toBe(false);
    sunucu.capabilities.harita = true;
    const api = async (method: string, yol: string, govde?: unknown) => (await sunucu.fetch(`http://127.0.0.1:8765/api${yol}`, { method, body: govde === undefined ? undefined : JSON.stringify(govde) })).json() as Promise<{ runId: string }>;
    const { runId } = await api("POST", "/runs", { config: { name: "H", cityNames: ["A", "B", "C", "D", "E"], templateId: "dayanikli_taban", durationWeeks: 25, seedIndex: 0, values: { gecis_destegi: "kapali" } } });
    for (let i = 0; i < 12; i++) await api("POST", `/runs/${runId}/control`, { action: "step" });
    const paketler = sunucu.run(runId)!.packets;
    expect(paketler.map((p) => (p.harita ? p.week : 0)).filter(Boolean)).toEqual([1, 10]);
  });
});

describe("wire: haritaFark", () => {
  const fark = (...ek: Partial<Record<string, unknown>>[]) => Object.assign({ hafta: 24, taban: 20, degisen: [], yeni: [], kapanan: [] }, ...ek);

  it("parseHaritaFark_paketten_ve_tel_biciminden", () => {
    const tel = fark({ degisen: [["s1_un12", 0, 25], ["s2_un3", 1, 5]], yeni: [["s1_firin2", "firin", 1, 5, "lonca2", "oyuncu", 22, "uretim"]], kapanan: ["s2_un5"] });
    const p = parsePacket({ ...packetOf("r", 24, 1), haritaFark: tel });
    expect(p.haritaFark).toEqual({
      hafta: 24, taban: 20,
      degisen: [["s1_un12", "uretim", 25], ["s2_un3", "zayif", 5]],
      yeni: [["s1_firin2", "firin", 1, 5, "lonca2", "oyuncu", 22, "uretim"]],
      kapanan: ["s2_un5"],
    });
    expect(parsePacket(packetOf("r", 24, 1)).haritaFark).toBeUndefined();
    expect(p.harita).toBeUndefined();
  });

  it("parseHaritaFark_bozuk_satir_atlanir", () => {
    const h = parseHaritaFark(fark({
      degisen: [["a", 3, 0], ["b", 9, 4], ["c", 1], "x", ["d", 2, -1], [7, 0, 3], ["e", 1, 2.5]],      // b: bilinmeyen durum, c: kısa, d: negatif çalışan, 7: sayı kimlik dizgeye döner
      yeni: [["n1", "un", 0, 4, null, "npc", null, "uretim"], ["n2", "un", 0, 4, null, "robot", null, "uretim"], ["n3"]],
      kapanan: ["k1", 5, null, "k2"],
    }));
    expect(h.degisen).toEqual([["a", "kapali", 0], ["7", "uretim", 3], ["e", "zayif", 2.5]]);
    expect(h.yeni).toEqual([["n1", "un", 0, 4, null, "npc", null, "uretim"]]);
    expect(h.kapanan).toEqual(["k1", "5", "k2"]);      // sayı kimlik dizgeye döner, null atlanır
  });

  it("bozuk_alan_reddedilir_paket_dusmez", () => {
    expect(() => parseHaritaFark({ hafta: "24", taban: 20, degisen: [], yeni: [], kapanan: [] })).toThrow(WireError);
    expect(() => parseHaritaFark({ hafta: 24, taban: 20, degisen: {}, yeni: [], kapanan: [] })).toThrow(WireError);
    expect(() => parseHaritaFark({ hafta: 24, degisen: [], yeni: [], kapanan: [] })).toThrow(WireError);
  });

  it("sunucunun_gercek_ciktisi_fiksturu_ayni_baytlarla_cozulur", () => {
    const tel = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/harita_fark_tel.json"), "utf-8")) as unknown;
    expect(parseHaritaFark(tel)).toEqual({
      hafta: 24, taban: 20,
      degisen: [["s1_un12", "uretim", 25], ["s2_un3", "zayif", 5]],
      yeni: [["s1_firin2", "firin", 1, 5, "lonca2", "oyuncu", 22, "uretim"]],
      kapanan: ["s2_un4", "s2_un5"],
    });
  });
});
