import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { haritaBirlestir } from "../../../src/oyun/harita/haritaKaynagi";
import { haritaGecisleriIlerlet, useHaritaGecisleri, type GecisDurumu } from "../../../src/oyun/harita/useHaritaGecisleri";
import { IZO_STILI } from "../../../src/oyun/harita/haritaStili";
import type { HaritaDurumu, HaritaFirmaSatiri, HaritaVerisi } from "../../../src/oyun/harita/tipler";
import type { DaoOlay } from "../../../src/oyun/sim/dao";

const satir = (id: string, o: { calisan?: number; sahip?: "npc" | "oyuncu" | "dao"; dogum?: number | null; durum?: HaritaDurumu } = {}): HaritaFirmaSatiri =>
  [id, "market", 0, o.calisan ?? 5, null, o.sahip ?? "npc", o.dogum ?? null, o.durum ?? "uretim"];
const harita = (hafta: number, ...firmalar: HaritaFirmaSatiri[]): HaritaVerisi => ({ hafta, firmalar });

function kur(ilk: HaritaVerisi | null) {
  return renderHook(({ h, o }: { h: HaritaVerisi | null; o?: readonly DaoOlay[] }) => useHaritaGecisleri(h, o), { initialProps: { h: ilk } as { h: HaritaVerisi | null; o?: readonly DaoOlay[] } });
}

describe("useHaritaGecisleri", () => {
  it("baseline_sonra_yeni_hafta_gecis_uretir", () => {
    const { result, rerender } = kur(harita(1, satir("a")));
    expect(result.current.gecisler).toEqual([]);
    rerender({ h: harita(2, satir("a"), satir("n")) });
    expect(result.current.gecisler).toEqual([{ id: "n", hafta: 2, tur: "kuruldu" }]);
    expect(result.current.ilkGorulme.get("n")).toBe(2);
    expect(result.current.ilkGorulme.has("a")).toBe(false);
  });
  it("ayni_gecis_iki_kez_uretilmez_ayni_hafta_tekrar", () => {
    const { result, rerender } = kur(harita(1, satir("a")));
    const h2 = harita(2, satir("a"), satir("n"));
    rerender({ h: h2 });
    rerender({ h: { ...h2 } });
    expect(result.current.gecisler).toHaveLength(1);
  });
  it("hizli_oynatmada_atlanan_haftalar_tek_karede_kirpilir", () => {
    const { result, rerender } = kur(harita(1));
    const cok = Array.from({ length: 30 }, (_, i) => satir(`n${i}`));
    rerender({ h: harita(40, ...cok) });
    expect(IZO_STILI.gecis.enCok).toBe(12);
    expect(result.current.gecisler).toHaveLength(12);
  });
  it("kirpma_biriken_gecislerde_de_en_cok_12", () => {
    const { result, rerender } = kur(harita(1));
    rerender({ h: harita(2, ...Array.from({ length: 8 }, (_, i) => satir(`a${i}`))) });
    rerender({ h: harita(3, ...Array.from({ length: 16 }, (_, i) => satir(`a${i}`))) });
    expect(result.current.gecisler.length).toBeLessThanOrEqual(12);
  });
  it("boy_haritasi_her_yeni_haftada_ilerler_ayni_hafta_iki_kez_ilerletmez", () => {
    const { result, rerender } = kur(harita(1, satir("a", { calisan: 5 })));
    expect(result.current.gorselBoy("a", 2)).toBe(1);
    rerender({ h: harita(2, satir("a", { calisan: 10 })) });
    rerender({ h: harita(2, satir("a", { calisan: 10 })) }); // ayni hafta: sayac artmaz
    rerender({ h: harita(3, satir("a", { calisan: 10 })) });
    expect(result.current.gorselBoy("a", 2)).toBe(1); // 2 hafta: esik 3
    rerender({ h: harita(4, satir("a", { calisan: 10 })) });
    expect(result.current.gorselBoy("a", 2)).toBe(2);
  });
  it("gorselBoy_histerezisi_yansitir", () => {
    const { result, rerender } = kur(harita(1, satir("a", { calisan: 7 })));
    for (let h = 2; h <= 7; h += 1) rerender({ h: harita(h, satir("a", { calisan: h % 2 ? 7 : 8 })) });
    expect(result.current.gorselBoy("a", 2)).toBe(1);
    expect(result.current.gorselBoy("bilinmeyen", 3)).toBe(3); // bilinmeyen kimlik: ham boy
  });
  it("buyudu_gecisi_boy_haritasindan", () => {
    const { result, rerender } = kur(harita(1, satir("a", { calisan: 5 })));
    for (const h of [2, 3, 4]) rerender({ h: harita(h, satir("a", { calisan: 10 })) });
    expect(result.current.gecisler).toContainEqual({ id: "a", hafta: 4, tur: "buyudu" });
  });
  it("dao_olaylari_bir_kez_ve_gecmis_haritayla_cakismaz", () => {
    const olay: DaoOlay[] = [{ tur: "kuruldu", hafta: 2, firma: "x", sektor: "market" }];
    const { result, rerender } = kur(harita(1, satir("a")));
    rerender({ h: harita(2, satir("a")), o: olay });
    expect(result.current.gecisler).toEqual([{ id: "x", hafta: 2, tur: "kuruldu" }]);
    rerender({ h: harita(2, satir("a")), o: [...olay] });
    expect(result.current.gecisler).toHaveLength(1);
  });
  it("kurucu_ve_dao_kadans_senaryolari", () => {
    // DAO: her hafta tam harita.
    const dao = kur(harita(10, satir("a"), satir("b")));
    const adimlar: unknown[][] = [];
    for (let h = 11; h <= 13; h += 1) {
      dao.rerender({ h: harita(h, satir("a"), satir("b", { durum: h === 12 ? "kapali" : "uretim" })) });
      adimlar.push([...dao.result.current.gecisler]);
    }
    expect(adimlar).toEqual([[], [{ id: "b", hafta: 12, tur: "batti" }], [{ id: "b", hafta: 13, tur: "canlandi" }]]);
    // Kurucu: 10 haftada tam, arada fark (istemci birlestirir).
    const taban = harita(10, satir("a"), satir("b"));
    const k = kur(taban);
    const birlesik = haritaBirlestir(taban, { hafta: 13, taban: 10, degisen: [["b", "kapali", 0]], yeni: [satir("n")], kapanan: [] })!;
    k.rerender({ h: birlesik });
    expect(k.result.current.gecisler).toEqual(expect.arrayContaining([{ id: "b", hafta: 13, tur: "batti" }, { id: "n", hafta: 13, tur: "kuruldu" }]));
    k.rerender({ h: harita(20, satir("a"), satir("n")) });
    expect(k.result.current.gecisler).toEqual([]); // b kapali dustu: sessiz; her sonuc yalniz son guncellemenin gecisleri
  });
  it("anahtar_degisince_sifirlanir", () => {
    const { result, rerender } = renderHook(({ h, k }: { h: HaritaVerisi | null; k: string }) => useHaritaGecisleri(h, undefined, k), { initialProps: { h: harita(5, satir("a")) as HaritaVerisi | null, k: "r1" } });
    rerender({ h: harita(6, satir("a"), satir("n")), k: "r1" });
    expect(result.current.gecisler).toHaveLength(1);
    rerender({ h: harita(2, satir("z")), k: "r2" });
    expect(result.current.gecisler).toEqual([]);
    expect(result.current.ilkGorulme.size).toBe(0);
  });
  it("null_harita_durumu_bozmaz", () => {
    const { result, rerender } = kur(harita(1, satir("a")));
    rerender({ h: null });
    expect(result.current.gecisler).toEqual([]);
    expect(result.current.gorselBoy("a", 3)).toBe(1); // durum korunur
    rerender({ h: harita(2, satir("a")) });
    expect(result.current.gecisler).toEqual([]);
  });

  it("dao_olayi_hafta_kaymasi_ve_ayri_render_tek_gecis", () => {
    const { result, rerender } = kur(harita(1, satir("a")));
    const h2 = harita(2, satir("a"), satir("x"));
    rerender({ h: h2 });
    expect(result.current.gecisler).toEqual([{ id: "x", hafta: 2, tur: "kuruldu" }]);
    rerender({ h: h2, o: [{ tur: "kuruldu", hafta: 1, firma: "x", sektor: "market" }] }); // olay ayri render'da, hafta 1 kaymis
    expect(result.current.gecisler).toEqual([{ id: "x", hafta: 2, tur: "kuruldu" }]);
    // tersi: olay once, harita sonra
    const t = kur(harita(1, satir("a")));
    t.rerender({ h: harita(1, satir("a")), o: [{ tur: "firma_batti", hafta: 2, firma: "a" }] });
    expect(t.result.current.gecisler).toEqual([{ id: "a", hafta: 2, tur: "batti" }]);
    t.rerender({ h: harita(3, satir("a", { durum: "kapali" })), o: [{ tur: "firma_batti", hafta: 2, firma: "a" }] });
    expect(t.result.current.gecisler).toEqual([]);
  });
  it("baseline_ilk_render_olaylari_gecis_yapmaz", () => {
    const olay: DaoOlay[] = [{ tur: "kuruldu", hafta: 5, firma: "x", sektor: "market" }];
    const { result, rerender } = renderHook(({ h, o }: { h: HaritaVerisi | null; o?: readonly DaoOlay[] }) => useHaritaGecisleri(h, o), { initialProps: { h: harita(5, satir("x")), o: olay } });
    expect(result.current.gecisler).toEqual([]);
    rerender({ h: harita(6, satir("x")), o: olay }); // ayni bayat olay yeniden gelse de yayilmaz
    expect(result.current.gecisler).toEqual([]);
  });
  it("hafta_geriye_gidince_ayni_anahtarla_sifirlanir", () => {
    const { result, rerender } = kur(harita(10, satir("a")));
    rerender({ h: harita(11, satir("a"), satir("n")) });
    expect(result.current.ilkGorulme.size).toBe(1);
    rerender({ h: harita(5, satir("a"), satir("z")) });
    expect(result.current.gecisler).toEqual([]);
    expect(result.current.ilkGorulme.size).toBe(0);
  });
  it("strictmode_cift_render_tek_ilerleme", () => {
    const { result, rerender } = renderHook(({ h }: { h: HaritaVerisi }) => useHaritaGecisleri(h), { initialProps: { h: harita(1, satir("a", { calisan: 5 })) }, wrapper: StrictMode });
    rerender({ h: harita(2, satir("a", { calisan: 10 }), satir("n")) });
    expect(result.current.gecisler).toEqual([{ id: "n", hafta: 2, tur: "kuruldu" }]);
    rerender({ h: harita(3, satir("a", { calisan: 10 }), satir("n")) });
    rerender({ h: harita(4, satir("a", { calisan: 10 }), satir("n")) });
    expect(result.current.gecisler).toContainEqual({ id: "a", hafta: 4, tur: "buyudu" });
  });
  it("ilerlet_saf_ayni_girdi_ayni_sonuc_ve_onceki_degismez", () => {
    let d: GecisDurumu = haritaGecisleriIlerlet(null, harita(1, satir("a")), undefined, undefined).durum;
    const kopya = JSON.stringify([...d.ilk]) + JSON.stringify(d.goruldu) + d.onceki?.hafta + d.boy.size;
    const h2 = harita(2, satir("a"), satir("n"));
    const s1 = haritaGecisleriIlerlet(d, h2, undefined, undefined);
    const s2 = haritaGecisleriIlerlet(d, h2, undefined, undefined);
    expect(s2.cikti.gecisler).toEqual(s1.cikti.gecisler);
    expect(s1.cikti.gecisler).toHaveLength(1);
    expect(JSON.stringify([...d.ilk]) + JSON.stringify(d.goruldu) + d.onceki?.hafta + d.boy.size).toBe(kopya);
    d = s1.durum;
    expect(d.onceki?.hafta).toBe(2);
  });
});
