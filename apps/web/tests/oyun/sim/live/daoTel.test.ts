import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { daoAdlari } from "@/oyun/screens/dao/DaoYardim";
import { BASVURU_RED_NEDENLERI, daoDurumMetni, daoEksikMetni, daoHataAnahtari, daoOlayMetni, daoUnvanMetni, type DaoOlay } from "@/oyun/sim/dao";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { WireError, parseDaoGozlem } from "@/oyun/sim/live/wire";
import type { RunConfig, SimSource, SourceInfo } from "@/oyun/sim/types";
import { createLiveSource } from "@/oyun/sim/live";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";
import { GOZLEM_AHIR } from "../../helpers/daoVeri";

/**
 * DAO gözlemi, yeni olaylar ve karar redleri: GERÇEK modelin çıktısından üretilmiş ortak fikstür
 * (`simulasyon/arayuz/server/tests/fixtures/dao_tel.json`; Python `tests/test_dao_tel.py` baytları üretir ve karşılaştırır).
 */
type Fikstur = {
  gozlem: Record<string, unknown>;
  olaylar: Record<string, unknown>[];
  ret: { karar: Record<string, unknown>; kod: string; fields: (string | { id: string; reason: string })[] }[];
};
const FILE = path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/dao_tel.json");
const FIX = JSON.parse(readFileSync(FILE, "utf-8")) as Fikstur;
const info = { world: { chain: { sectors: [{ sector: "universite", label: "Üniversite" }] } } } as unknown as SourceInfo;
const ad = daoAdlari(["Közlüdere", "Yaldızova", "Bakırbük", "Çamlık", "Dereli"], info);

describe("F1: pano alanları tel ayrıştırıcısından geçer", () => {
  const firmam = { ad: "s0_firin_oy1", sektor: "firin", nakit: 400, isci: 3, kar: -50, yas: 5 };
  it("kasa_degisim_kasa_hafta_ve_disaridan_ayristirilir", () => {
    const g = parseDaoGozlem({ ...FIX.gozlem, firmam: { ...firmam, kasa_degisim: -600, kasa_hafta: 2.5 }, sektorler: [{ sektor: "firin", urun: "un", fiyat: 1, firma: 2, eksik: 0, disaridan: 100 }] });
    expect(g.firmam).toMatchObject({ kar: -50, kasa_degisim: -600, kasa_hafta: 2.5 });
    expect(g.sektorler[0]!.disaridan).toBe(100);
  });
  it("eski_sunucuda_alan_yoksa_null", () => {
    const g = parseDaoGozlem({ ...FIX.gozlem, firmam, sektorler: [{ sektor: "firin", urun: "un", fiyat: 1, firma: 2, eksik: 0 }] });
    expect(g.firmam!.kasa_degisim).toBeNull();
    expect(g.firmam!.kasa_hafta).toBeNull();
    expect(g.sektorler[0]!.disaridan).toBeNull();
  });
});

describe("DAO gerçek model fikstürü (dao_tel.json)", () => {
  it("gozlem_ilanlariyla_ayristirir", () => {
    const g = parseDaoGozlem(FIX.gozlem);
    expect(g.ilanlar.length).toBeGreaterThan(0);
    expect(g.ilanlar.length).toBeLessThanOrEqual(30);
    for (const i of g.ilanlar) {
      expect(i.firma).not.toBe("");
      expect(Number.isInteger(i.acik) && i.acik > 0).toBe(true);
      expect(Number.isFinite(i.ucret)).toBe(true);
      expect(["zayif", "orta", "guclu"]).toContain(i.kasa_gucu);                   // gerçek modelin kasa gücü göstergesi
    }
    expect(g.ilanlar.map((i) => i.ucret)).toEqual([...g.ilanlar.map((i) => i.ucret)].sort((a, b) => b - a));
    expect(g.olaylar).toEqual([{ tur: "ahirdan_cikti", hafta: 2 }]);
    expect(g.ben.durum).toBe("is_arayan");
  });

  it("yeni_olaylarin_hepsi_taninir_genele_dusmez_ve_okunur_metin_verir", () => {
    const g = parseDaoGozlem({ ...FIX.gozlem, olaylar: FIX.olaylar });
    expect(g.olaylar.map((o) => o.tur)).toEqual(FIX.olaylar.map((o) => o.tur));
    expect(g.olaylar.map((o) => o.tur)).not.toContain("genel");
    expect(new Set(g.olaylar.map((o) => o.tur))).toEqual(new Set(["ahirdan_cikti", "basvuru_kabul", "basvuru_red", "is_degistirdi", "ise_girdi", "isten_cikarildi"]));
    const nedenler = g.olaylar.flatMap((o) => (o.tur === "basvuru_red" ? [o.neden] : []));
    expect(new Set(nedenler)).toEqual(new Set(["sehir", "ilan_kapandi"]));
    for (const o of g.olaylar) {
      const m = daoOlayMetni(o, ad);
      expect(m).not.toBe(t("dao.olay.genel"));
      expect(m).not.toMatch(/\bs\d+_|_/);                                   // ham kimlik görünmez
    }
  });

  it("isten_cikarildi_gercek_modelin_nedeniyle_okunur_metin_verir_ve_kabul_gozlemi_ayristirilir", () => {
    const g = parseDaoGozlem({ ...FIX.gozlem, olaylar: FIX.olaylar });
    const o = g.olaylar.find((x) => x.tur === "isten_cikarildi");
    expect(o).toBeDefined();
    if (o?.tur !== "isten_cikarildi") throw new Error("tür");
    expect(["ucret_odenmedi", "kucultme", "firma_kapandi"]).toContain(o.neden);
    expect(daoOlayMetni(o, ad)).not.toBe(t("dao.olay.isten_cikarildi", { firma: ad.firma(o.firma), neden: t("dao.olay.isten_cikarildi.genel") }));
    const kabul = parseDaoGozlem((FIX as unknown as { kabul_gozlemi: Record<string, unknown> }).kabul_gozlemi);
    expect(kabul.ilanlar.every((i) => i.kasa_gucu !== "bilinmiyor")).toBe(true);
  });

  it("is_degistirdi_ve_firma_batti_neden_yas_ayristirilir_eski_sunucuda_null", () => {
    const g = parseDaoGozlem({
      ...GOZLEM_AHIR,
      olaylar: [
        { tur: "is_degistirdi", hafta: 6, eski: "s0_belediye0", yeni: "s0_hastane0" },
        { tur: "firma_batti", hafta: 7, firma: "s0_firin_oy1", neden: "ucret_odenmedi", yas: 0 },
        { tur: "firma_batti", hafta: 8, firma: "s0_firin_oy2" },
      ],
    });
    expect(g.olaylar).toEqual([
      { tur: "is_degistirdi", hafta: 6, eski: "s0_belediye0", yeni: "s0_hastane0" },
      { tur: "firma_batti", hafta: 7, firma: "s0_firin_oy1", neden: "ucret_odenmedi", yas: 0 },
      { tur: "firma_batti", hafta: 8, firma: "s0_firin_oy2" },
    ]);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "is_degistirdi", hafta: 1, eski: "a" }] })).toThrow(WireError);
    const gec = parseDaoGozlem({ ...GOZLEM_AHIR, gecmis: { dilim0: 2, firmalar: [{ ad: "f1", sektor: "firin", yas: 3, ayakta: false, neden: "kredi_odenemedi", olum_haftasi: 9 }, { ad: "f2", sektor: "firin", yas: 1, ayakta: true }] } });
    expect(gec.gecmis.firmalar.map((f) => [f.neden, f.olum_haftasi])).toEqual([["kredi_odenemedi", 9], [undefined, undefined]]);
  });

  it("kasa_gucu_yoksa_ya_da_taninmiyorsa_bilinmiyor_olur_paket_dusmez", () => {
    const il = (kasa: unknown) => parseDaoGozlem({ ...GOZLEM_AHIR, ilanlar: [{ firma: "f1", ad: "f1", sektor: "firin", acik: 1, ucret: 5, ...(kasa === undefined ? {} : { kasa_gucu: kasa }) }] }).ilanlar[0]!.kasa_gucu;
    expect([il(undefined), il("yeni_deger"), il("zayif")]).toEqual(["bilinmiyor", "bilinmiyor", "zayif"]);
  });

  it("ret_nedenleri_gercek_modelin_nedenleriyle_ayri_ayri_metne_gider", () => {
    const metinler = new Set<string>();
    for (const r of FIX.ret) {
      const alanlar = r.fields.map((f) => (typeof f === "string" ? { id: f, reason: "invalid" } : f));
      const k = daoHataAnahtari(new SimUnsupported(r.kod, alanlar));
      expect(k).not.toBe("dao.hata.genel");
      expect(k).not.toBe("dao.hata.karar_gecersiz");                       // neden metni genel "verilemiyor"dan daha açık
      metinler.add(t(k));
    }
    expect(metinler.size).toBe(3);                                           // ahirda, ahirda_degil, geçersiz firma
  });
});

describe("DAO yeni olay metinleri", () => {
  it("basvuru_red_nedenleri_oyuncu_diliyle", () => {
    const metin = (neden: string) => daoOlayMetni({ tur: "basvuru_red", hafta: 4, firma: "fk0", neden }, ad);
    expect(metin("ilan_kapandi")).toContain("İlan kapandı");
    expect(metin("sehir")).toContain("başka bir şehirde");
    expect(metin("zaten_calisiyor")).toContain("Zaten bir işte");
    expect(metin("secilmedi")).toContain("başka birini seçti");
    expect(BASVURU_RED_NEDENLERI).toHaveLength(5);
    expect(metin("ayni_firma")).toContain("bu işletmede");
    expect(new Set(BASVURU_RED_NEDENLERI.map(metin)).size).toBe(5);
    expect(metin("yeni_bir_neden")).toContain(t("dao.olay.basvuru_red.genel"));          // tanınmayan neden de görünür metne düşer
  });

  it("ahirdan_cikti_basvuru_kabul_ve_uygulanamadi_metinleri", () => {
    expect(daoOlayMetni({ tur: "ahirdan_cikti", hafta: 2 }, ad)).toBe("Ahırdan çıktın; artık iş arıyorsun.");
    expect(daoOlayMetni({ tur: "basvuru_kabul", hafta: 3, firma: "s0_universite0" }, ad)).toBe("Başvurun kabul edildi: Üniversite.");
    expect(daoOlayMetni({ tur: "karar_uygulanamadi", hafta: 3, karar: "basvur", neden: null }, ad)).toBe("Başvurun uygulanamadı.");
    expect(daoOlayMetni({ tur: "karar_uygulanamadi", hafta: 3, karar: "ahirdan_cik", neden: null }, ad)).toBe("Ahırdan çıkma uygulanamadı.");
  });

  it("bilinmeyen_olay_turu_genel_metne_duser", () => {
    const g = parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "gelecekteki_olay", hafta: 9, x: 1 }, { tur: "baska" }] });
    expect(g.olaylar).toEqual<DaoOlay[]>([{ tur: "genel", hafta: 9, kaynak: "gelecekteki_olay" }, { tur: "genel", hafta: 0, kaynak: "baska" }]);
    expect(g.olaylar.map((o) => daoOlayMetni(o, ad))).toEqual([t("dao.olay.genel"), t("dao.olay.genel")]);
  });
});

describe("DAO ayrıştırma sıkılığı", () => {
  it("ilanlar_yoksa_bos_bozuksa_wire_error", () => {
    const eski: Record<string, unknown> = { ...GOZLEM_AHIR };
    delete eski.ilanlar;
    expect(parseDaoGozlem(eski).ilanlar).toEqual([]);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, ilanlar: [{ firma: "f1", ad: "f1", sektor: "firin", acik: "2", ucret: 1 }] })).toThrow(WireError);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, ilanlar: [{ firma: "f1" }] })).toThrow(WireError);
  });

  it("bilinen_olayda_eksik_alan_wire_error_basvuru_red_nedensiz_olmaz", () => {
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "basvuru_red", hafta: 1, firma: "f1" }] })).toThrow(WireError);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "basvuru_kabul", hafta: 1 }] })).toThrow(WireError);
  });
});

describe("LiveSource: ret nedenleri ve yeni kararlar", () => {
  let kaynaklar: SimSource[] = [];
  afterEach(() => { kaynaklar.forEach((s) => s.dispose()); kaynaklar = []; });
  const mk = () => {
    const server = createFakeLiveServer();
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    kaynaklar.push(source);
    return { server, source };
  };
  const config: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 520, seedIndex: 0, values: {}, mode: "dao" };
  const hata = async (p: Promise<unknown>): Promise<SimUnsupported> => p.then(() => { throw new Error("kabul edildi"); }, (e: unknown) => e as SimUnsupported);

  it("ret_gövdesinin_fields_nedenleri_SimUnsupported_alanlar_olarak_gelir", async () => {
    const { source } = mk();
    const h = await source.start({ ...config });
    const e = await hata(source.daoKarar!(h.runId, { tur: "ayril" }));          // ahırdayken
    expect([e.message, e.alanlar]).toEqual(["karar_gecersiz", [{ id: "tur", reason: "ahirda" }]]);
    expect(t(daoHataAnahtari(e))).toBe("Ahırdayken bu karar verilemez; önce ahırdan çık.");
    const e2 = await hata(source.daoKarar!(h.runId, { tur: "ahirdan_cik" }).then(() => source.control(h.runId, { action: "step" })).then(() => source.daoKarar!(h.runId, { tur: "ahirdan_cik" })));
    expect(e2.alanlar).toEqual([{ id: "tur", reason: "ahirda_degil" }]);
    expect(t(daoHataAnahtari(e2))).toBe("Zaten ahırda değilsin.");
    const e3 = await hata(source.daoKarar!(h.runId, { tur: "basvur", firma: "yok" }));
    expect(e3.alanlar).toEqual([{ id: "firma", reason: "invalid" }]);
    expect(daoHataAnahtari(e3)).toBe("dao.hata.neden.firma");
  });

  it("ahirdan_cik_sonra_basvur_kabul_ve_ilanlar_gozlemde", async () => {
    const { source } = mk();
    const h = await source.start({ ...config });
    expect((await source.daoGozlem!(h.runId)).ilanlar.map((i) => i.firma)).toEqual(["f1", "f2", "f9"]);
    await source.daoKarar!(h.runId, { tur: "ahirdan_cik" });
    await source.control(h.runId, { action: "step" });
    expect((await source.daoGozlem!(h.runId)).olaylar.map((o) => o.tur)).toEqual(["ahirdan_cikti"]);
    await source.daoKarar!(h.runId, { tur: "basvur", firma: "f2" });
    await source.control(h.runId, { action: "step" });
    const g = await source.daoGozlem!(h.runId);
    expect(g.olaylar).toEqual([{ tur: "basvuru_kabul", hafta: 2, firma: "f2" }]);
    expect(g.ben.durum).toBe("calisan");
  });

  it("kapanan_ilana_basvuru_ilan_kapandi_red_olayi", async () => {
    const { source } = mk();
    const h = await source.start({ ...config });
    await source.daoKarar!(h.runId, { tur: "ahirdan_cik" });
    for (let i = 0; i < 4; i++) await source.control(h.runId, { action: "step" });            // 4. hafta: f9 ilanı kapandı
    expect((await source.daoGozlem!(h.runId)).ilanlar.map((i) => i.firma)).toEqual(["f1", "f2"]);
    await source.daoKarar!(h.runId, { tur: "basvur", firma: "f9" });
    await source.control(h.runId, { action: "step" });
    expect((await source.daoGozlem!(h.runId)).olaylar).toEqual([{ tur: "basvuru_red", hafta: 5, firma: "f9", neden: "ilan_kapandi" }]);
  });
});

describe("bilinmeyen eksiklik, durum ve unvan paketi düşürmez", () => {
  it("ahirda_eksigi_kabul_edilir_ve_okunur_metin_verir", () => {
    const g = parseDaoGozlem({ ...GOZLEM_AHIR, kurabilir: { ...GOZLEM_AHIR.kurabilir, eksikler: ["ahirda"] } });
    expect(g.kurabilir.eksikler).toEqual(["ahirda"]);
    expect(daoEksikMetni("ahirda", g.kurabilir)).toBe("Ahırdan çıkıp bir işe girmelisin.");
  });

  it("bilinmeyen_eksiklik_durum_ve_unvan_genel_metne_duser_paket_reddedilmez", () => {
    const g = parseDaoGozlem({
      ...GOZLEM_AHIR,
      kurabilir: { ...GOZLEM_AHIR.kurabilir, eksikler: ["gelecekteki_sart", "harc"] },
      ben: { ...GOZLEM_AHIR.ben, durum: "yeni_durum", unvan: "yeni_unvan" },
    });
    expect(g.kurabilir.eksikler).toEqual(["bilinmiyor", "harc"]);
    expect(daoEksikMetni("bilinmiyor", g.kurabilir)).toBe("Bir şart eksik.");
    expect(g.ben.durum).toBe("bilinmiyor");
    expect(g.ben.unvan).toBe("bilinmiyor");
    expect(daoDurumMetni(g.ben.durum)).toBe("Bilinmiyor");
    expect(daoUnvanMetni(g.ben.unvan)).toBe("Bilinmiyor");
  });

  it("dizge_olmayan_deger_hala_wire_error", () => {
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, durum: 5 } })).toThrow(WireError);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, kurabilir: { ...GOZLEM_AHIR.kurabilir, eksikler: [1] } })).toThrow(WireError);
  });
});

