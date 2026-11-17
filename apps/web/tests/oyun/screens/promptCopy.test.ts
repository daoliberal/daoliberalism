import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tr } from "@/oyun/copy/tr";

const PROTO = path.resolve(__dirname, "../../../prototype/oyun/Main.dc.html");
const MIN = 12;

function proto(): string {
  if (!fs.existsSync(PROTO)) throw new Error("G0: prototype/oyun/Main.dc.html yok");
  return fs.readFileSync(PROTO, "utf8");
}

describe("metin sadakati (prototipte birebir alt dize)", () => {
  const html = proto();
  /** Kayıttan türetilen ölçüm metinleri: sayılar güncel kayıttan gelir (prototip eski v12.3 sayılarını taşır); bayatlamayı tests/oyun/kayitMetin.test.ts denetler. */
  const KAYITTAN = new Set(["setting.gecis_destegi.hint", "sablon.dayanikli_taban.olcum", "sablon.gecis_destegi.olcum"]);
  const entries = Object.entries(tr).filter(([k]) => !KAYITTAN.has(k) && (/^setting\.[a-z_]+\.(name|what|changes|hint)$/.test(k) || /^sablon\.[a-z_]+\.(name|desc|olcum)$/.test(k)));

  it("kapsam_bos_degil", () => {
    expect(entries.length).toBeGreaterThan(15);
  });

  /**
   * W1 dil kuralı düzeltmeleri (metin_kurallari.json: sayıya kesmeyle ek getirilmez): prototipteki biçim yeni biçime çevrilir.
   * Her çift [yeni, prototipteki]; metin, yeni parçalar eskileriyle değiştirilince prototipte birebir bulunmalıdır.
   */
  const DIL_DUZELTMESI: Record<string, [string, string][]> = {
    "setting.kurumlar_vergisi.hint": [["%20 olduğunda", "%20'de"], ["yaklaşık %0,5 kadarı", "~%0,5'i"]],
  };
  const original = (k: string, v: string): string => (DIL_DUZELTMESI[k] ?? []).reduce((acc, [yeni, eski]) => acc.replace(yeni, eski), v);

  it("dil_duzeltmeleri_uygulandi", () => {
    for (const k of Object.keys(DIL_DUZELTMESI)) {
      expect(tr[k as keyof typeof tr], k).not.toMatch(/\d['’][a-zçğıöşü]/);
      expect(original(k, tr[k as keyof typeof tr]), k).not.toBe(tr[k as keyof typeof tr]);
    }
  });

  it.each(entries.filter(([, v]) => v.length >= MIN))("%s", (k, v) => {
    const o = original(k, v);
    expect(html.includes(o), o).toBe(true);
  });

  it("secenek_etiketleri_esitlik", () => {
    expect(tr["setting.gecis_destegi.options.kapali"]).toBe("kapalı");
    expect(tr["setting.gecis_destegi.options.kisa_sureli"]).toBe("kısa süreli");
    expect(tr["setting.gecis_destegi.options.kurtarma_fonuyla"]).toBe("kurtarma fonuyla");
  });

  it("kurucu_prototip_metinleri", () => {
    expect(html.includes(tr["kurucu.sablon_giris"]), "kurucu.sablon_giris").toBe(true);
    // W3: Başlangıç dünyası metni prototipin "tohum" metninin yerine geçti (model belirlenimli; "rastlantı" yanlıştı), prototipte bulunmaz.
    expect(tr["kurucu.dunya_ipucu"]).not.toMatch(/tohum|rastlant/i);
  });

  it("sablon_varsayim_cumlesi_kayittan_turetilir", () => {
    // Sabit metin yok: cümle yayımlanan behavior_changes'tan kurulur (prototipin "2 varsayım" iddiası bu modelde yanlış).
    expect(html.includes("dünya varsayımını da değiştirir")).toBe(true);
    expect(tr["sablon.varsayim"]).toContain("dünya varsayımını da değiştirir");
    expect("sablon.dayanikli_taban.varsayim" in tr).toBe(false);
  });
});
