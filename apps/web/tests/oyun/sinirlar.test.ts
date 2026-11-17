import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_WORLD_NAME } from "@/oyun/lib/names";
import { MAX_AD_UZUNLUK, MAX_NOT_UZUNLUK } from "@/oyun/lib/sinirlar";
import { KOSU_AD_UZUNLUK } from "@/oyun/sim/library";

/** Sunucu ve web aynı sınırları kullanır (son inceleme M2/M4): tek değer, iki taraf birlikte değişir. */
const MANAGER = path.resolve(import.meta.dirname, "../../../../simulasyon/arayuz/server/oyun_server/runs/manager.py");
const sabit = (ad: string): number => {
  const m = new RegExp(`^${ad} = (\\d+)`, "m").exec(readFileSync(MANAGER, "utf-8"));
  if (!m) throw new Error(`sunucuda sabit yok: ${ad}`);
  return Number(m[1]);
};

describe("sunucu ve web sınırları", () => {
  it("ad_siniri_sunucu_koşu_adı_ile_aynı_ve_web_te_tek_sabit", () => {
    expect(MAX_AD_UZUNLUK).toBe(sabit("MAX_NAME_LEN"));
    expect(sabit("MAX_CITY_NAME_LEN")).toBe(MAX_AD_UZUNLUK);
    expect(MAX_WORLD_NAME).toBe(MAX_AD_UZUNLUK);
    expect(KOSU_AD_UZUNLUK).toBe(MAX_AD_UZUNLUK);
  });

  it("not_siniri_sunucu_ile_aynı", () => {
    expect(MAX_NOT_UZUNLUK).toBe(sabit("MAX_NOTE_LEN"));
  });
});
