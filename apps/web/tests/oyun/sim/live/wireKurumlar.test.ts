import { describe, expect, it } from "vitest";
import { parsePacket } from "@/oyun/sim/live/wire";
import { packetOf } from "../../helpers/fakeLiveServer";

const iyi = { sehir: 0, ithalat_hacim: 10, ihracat_hacim: 4, ithalat_urunler: [{ urun: "un", pay: 0.5 }] };

describe("wire: kurumlar hoşgörüsü", () => {
  it("bozuk_satir_atlanir_paket_dusmez", () => {
    const p = parsePacket({ ...packetOf("r", 5, 1), kurumlar: [iyi, { sehir: "x" }, "bozuk", { ...iyi, sehir: 1, ihracat_hacim: -1 }, { ...iyi, sehir: 2 }] });
    expect(p.kurumlar!.map((k) => k.sehir)).toEqual([0, 2]);
  });
  it("blok_dizi_degilse_atlanir_paket_dusmez", () => {
    const p = parsePacket({ ...packetOf("r", 5, 1), kurumlar: { yanlis: true } });
    expect(p.kurumlar).toBeUndefined();
    expect(p.week).toBe(5);
  });
});
