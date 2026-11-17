import { describe, expect, it } from "vitest";
import { oncekiPaket } from "@/oyun/harita/oncekiPaket";
import { KATMAN_STILI } from "@/oyun/harita/haritaStili";
import type { WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const paketler = (...haftalar: number[]): WeekPacket[] => haftalar.map((h) => packetOf("r", h, 1));

describe("oncekiPaket", () => {
  it("test_tam_dort_hafta_onceki_paket_secilir", () => {
    const w = paketler(1, 2, 3, 4, 5, 6, 7, 8);
    expect(KATMAN_STILI.fiyat.hafta).toBe(4);
    expect(oncekiPaket(w, w[7]!)?.week).toBe(4);
  });
  it("test_tam_hafta_yoksa_ondan_onceki_en_yeni_paket", () => {
    const w = paketler(1, 2, 5, 9, 10, 11); // hedef 7: 5 en yakın eski
    expect(oncekiPaket(w, w[5]!)?.week).toBe(5);
  });
  it("test_yeterince_eski_paket_yoksa_null", () => {
    const w = paketler(1, 2, 3, 4);
    expect(oncekiPaket(w, w[3]!)).toBeNull(); // hedef 0
    expect(oncekiPaket([], null)).toBeNull();
    expect(oncekiPaket(w, null)).toBeNull();
  });
  it("test_sira_onemsiz_ve_gelecek_paket_secilmez", () => {
    const w = paketler(8, 3, 4, 12, 1);
    expect(oncekiPaket(w, w[0]!)?.week).toBe(4);
    expect(oncekiPaket(w, w[2]!)).toBeNull(); // 4. hafta için hedef 0: 1. haftalık paket 1 > 0 değil
  });
});
