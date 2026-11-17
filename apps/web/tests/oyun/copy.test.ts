import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";

const UNITS_LINE = fs
  .readFileSync(path.resolve(__dirname, "../helpers/designRules.ts"), "utf8")
  .match(/const UNITS = "([^"]+)"/)![1]!;
const LENGTH = new RegExp(`(?<![\\w.#-])-?(?:\\d*\\.)?\\d+(?:${UNITS_LINE})\\b`, "i");

describe("copy", () => {
  it("birim_listesi_designRules_ile_ayni", () => {
    expect(UNITS_LINE.split("|")).toEqual(
      "px rem em vh vw vmin vmax dvh svh lvh dvw svw lvw ch ex pt pc cm mm in q cqw cqh cqi cqb lh rlh cap ic vb vi".split(" "),
    );
  });
  it("t_app_title_dolu", () => {
    expect(t("app.title").length).toBeGreaterThan(0);
  });
  it("yer_tutucu_doldurulur", () => {
    expect(t("app.hafta", { n: 12 })).toBe("Hafta 12");
    expect(t("app.hafta", { n: 12 })).not.toContain("{");
  });
  it("karar_numarasi_yok", () => {
    for (const v of Object.values(tr)) expect(v).not.toMatch(/K-\d+/);
  });
  it("batis_metinlerinde_ic_ad_yok", () => {
    const keys = ["event.batis10", "event.batis39", "canli.sk.batan", "canli.sk.batan_oyuncu", "sonuc.ozet", "sonuc.ozet.devam"] as const;
    for (const k of keys) {
      expect(tr[k], k).not.toMatch(/failed_|_cum|npc_|batan_kum|batan_oyuncu_firmasi|\b[a-z]+_[a-z_]+\b/);
      expect(tr[k], k).not.toMatch(/\bfirma batt/);                                              // eski, yanıltıcı etiket
    }
    expect(t("event.batis10", { hafta: 5, sayi: 12 })).toBe("Hf 5: toplam 12 yerleşik işletme battı");
    expect(t("sonuc.ozet", { n: 9, kar: "%90", batan: 3, kasa: "50 bin" })).toContain("kümülatif 3 işletme batışı");
  });
  it("bos_deger_yok", () => {
    for (const [k, v] of Object.entries(tr)) expect(v.trim().length, k).toBeGreaterThan(0);
  });
  it("sayi_ile_birim_bitisik_degil", () => {
    const lines = fs.readFileSync(path.resolve(__dirname, "../../src/oyun/copy/tr.ts"), "utf8").split("\n");
    for (const [i, line] of lines.entries()) expect(LENGTH.test(line), `tr.ts:${i + 1}`).toBe(false);
  });
});
