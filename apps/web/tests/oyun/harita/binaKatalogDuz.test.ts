import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOYLAR, katalogKaydi, SABLONLAR } from "@/oyun/harita/binaKatalogu";

/** Düzleştirmeden önceki değerler (kayit() + TABAN): tablo bunlarla birebir aynı olmalı. */
const ESKI: Record<string, Record<number, [number, number]>> = {
  hammadde: { 1: [30, 26], 2: [38, 32], 3: [46, 38], 4: [56, 46] },
  imalat: { 1: [32, 26], 2: [40, 32], 3: [50, 38], 4: [58, 46] },
  hizmet: { 1: [28, 24], 2: [36, 30], 3: [44, 36], 4: [54, 44] },
  lojistik: { 1: [34, 24], 2: [42, 30], 3: [52, 36], 4: [60, 44] },
  lonca: { 1: [18, 16], 2: [22, 18], 3: [26, 20], 4: [30, 24] },
  sehir: { 1: [60, 40], 2: [68, 44], 3: [76, 48], 4: [84, 52] },
  ahir: { 1: [70, 30], 2: [80, 34], 3: [90, 38], 4: [100, 42] },
};
const KAYNAK = fs.readFileSync(path.resolve(__dirname, "../../../src/oyun/harita/binaKatalogu.ts"), "utf8");

describe("binaKatalogu düz tablo", () => {
  it("tablo_eskisiyle_ayni_degerleri_verir", () => {
    for (const s of SABLONLAR) for (const b of BOYLAR) {
      const k = katalogKaydi(s, b);
      expect(k, `${s}-${b}`).toEqual({ dosya: `sablonlar/${s}-${b}.svg`, tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: ESKI[s]![b]![0], d: ESKI[s]![b]![1] } });
    }
  });
  it("her_sablon_boy_icin_kaynakta_acik_bir_satir_var_kayit_ve_taban_tablosu_yok", () => {
    const bulunan: string[] = [];
    let simdiki = "";
    for (const l of KAYNAK.split("\n")) {
      const sb = /^ {2}(\w+): \{$/.exec(l);
      if (sb) simdiki = sb[1]!;
      const bo = /^ {4}([1-4]): \{ dosya: "[^"]+", tur: "(?:svg-katmanli|resim)", capa: \{ x: [\d.]+, y: [\d.]+ \}, taban: \{ g: \d+, d: \d+ \}(?:, dosyaKoyu: "[^"]+")? \},$/.exec(l);
      if (bo) bulunan.push(`${simdiki}-${bo[1]}`);
    }
    expect(bulunan.sort()).toEqual(SABLONLAR.flatMap((s) => BOYLAR.map((b) => `${s}-${b}`)).sort());
    expect(KAYNAK).not.toMatch(/function kayit\(|const TABAN/);
  });
});
