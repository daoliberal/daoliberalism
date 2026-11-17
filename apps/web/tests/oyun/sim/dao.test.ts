import { daoAdlari } from "@/oyun/screens/dao/DaoYardim";
import type { SourceInfo } from "@/oyun/sim/types";
import { describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { DAO_SURE, UNVAN_ESIKLERI, belediyeKimligi, terfiIlerlemesi, daoDurumMetni, daoEksikMetni, daoHataAnahtari, daoOlayMetni, daoUnvanMetni, loncaKurEksikMetni, type DaoOlay } from "@/oyun/sim/dao";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { WireError, parseDaoGozlem, parsePacket, parseState } from "@/oyun/sim/live/wire";
import { GOZLEM_AHIR, GOZLEM_KURUCU } from "../helpers/daoVeri";
import { packetOf } from "../helpers/fakeLiveServer";

const info = { world: { chain: { sectors: [{ sector: "firin", label: "Fırın" }, { sector: "maden_komur", label: "Kömür madeni" }] } } } as unknown as SourceInfo;
const ad = daoAdlari(["Közlüdere", "Yaldızova", "Bakırbük"], info);

describe("DAO işletme adı: ham kimlik hiçbir metinde geçmez", () => {
  it("makine_kimlikleri_sektor_adina_okunur_ad_ise_oldugu_gibi", () => {
    expect(ad.firma("s0_maden_komur0")).toBe("Kömür madeni");
    expect(ad.firma("s0_ahir3")).toBe("Ahır");
    expect(ad.firma("fk0", "firin")).toBe("Fırın");
    expect(ad.firma("fk0")).toBe("bir işletme");
    expect(ad.firma("Fırın Bir")).toBe("Fırın Bir");
  });
  it("olay_metinleri_ham_kimlik_icermez", () => {
    const olaylar: DaoOlay[] = [
      { tur: "ise_girdi", hafta: 1, firma: "s0_maden_komur0" },
      { tur: "isten_cikarildi", hafta: 2, firma: "s0_ahir3", neden: null },
      { tur: "firma_batti", hafta: 3, firma: "fk7" },
      { tur: "kuruldu", hafta: 4, firma: "s2_firin9", sektor: "firin" },
    ];
    for (const o of olaylar) expect(daoOlayMetni(o, ad)).not.toMatch(/\bs\d+_|\bfk?\d+\b|_/);
    expect(daoOlayMetni(olaylar[0]!, ad)).toBe("İşe girdin: Kömür madeni.");
  });
});

describe("DAO olay metinleri", () => {
  const ornek: [DaoOlay, string][] = [
    [{ tur: "kuruldu", hafta: 1, firma: "Fırın Bir", sektor: "firin" }, "İşletmen kuruldu: Fırın Bir."],
    [{ tur: "kurulamadi", hafta: 1, sektor: "firin", neden: "sart" }, "İşletme kuramadın: henüz şartları sağlamıyorsun."],
    [{ tur: "kurulamadi", hafta: 1, sektor: "firin", neden: "kredi" }, "İşletme kuramadın: lonca kredisi yetmedi."],
    [{ tur: "kurulamadi", hafta: 1, sektor: "firin", neden: "bekleme" }, "İşletme kuramadın: bu şehirde aynı ürüne yakın zamanda işletme kuruldu; biraz beklemelisin."],
    [{ tur: "ayrildi", hafta: 1 }, "İşten ayrıldın."],
    [{ tur: "ise_girdi", hafta: 1, firma: "Fırın Bir" }, "İşe girdin: Fırın Bir."],
    [{ tur: "isten_cikarildi", hafta: 1, firma: "Fırın Bir", neden: null }, "İşten çıkarıldın: Fırın Bir. İşletme seninle yollarını ayırdı."],
    [{ tur: "isten_cikarildi", hafta: 1, firma: "Fırın Bir", neden: "ucret_odenmedi" }, "İşten çıkarıldın: Fırın Bir. İşletmenin kasası maaşını ödeyemedi."],
    [{ tur: "isten_cikarildi", hafta: 1, firma: "Fırın Bir", neden: "kucultme" }, "İşten çıkarıldın: Fırın Bir. İşletme kadrosunu küçülttü."],
    [{ tur: "isten_cikarildi", hafta: 1, firma: "Fırın Bir", neden: "firma_kapandi" }, "İşten çıkarıldın: Fırın Bir. İşletme kapandı."],
    [{ tur: "isten_cikarildi", hafta: 1, firma: "Fırın Bir", neden: "yeni_kod" }, "İşten çıkarıldın: Fırın Bir. İşletme seninle yollarını ayırdı."],
    [{ tur: "firmam_kuculdu", hafta: 1, firma: "Fırın Bir", neden: "satis" }, "Fırın Bir işletmen beklenen satışa göre kadrosunu küçülttü: bir işçi çıkarıldı."],
    [{ tur: "firma_batti", hafta: 1, firma: "Fırın Bir" }, "İşletmen battı: Fırın Bir. Nedeni belirsiz."],
    [{ tur: "firma_batti", hafta: 1, firma: "Fırın Bir", neden: "ucret_odenmedi", yas: 12 }, "İşletmen battı: Fırın Bir. Maaşlar ödenemedi. 12 hafta yaşadı."],
    [{ tur: "firma_batti", hafta: 1, firma: "Fırın Bir", neden: "kredi_odenemedi", yas: 0 }, "İşletmen battı: Fırın Bir. Lonca kredisi ödenemedi. 0 hafta yaşadı."],
    [{ tur: "firma_batti", hafta: 1, firma: "Fırın Bir", neden: "sahip_ayrildi", yas: 3 }, "İşletmen battı: Fırın Bir. Sahibi işletmeden ayrıldı. 3 hafta yaşadı."],
    [{ tur: "firma_batti", hafta: 1, firma: "Fırın Bir", neden: "yeni_kod", yas: 5 }, "İşletmen battı: Fırın Bir. Nedeni belirsiz. 5 hafta yaşadı."],
    [{ tur: "basvuru_red", hafta: 1, firma: "Fırın Bir", neden: "ayni_firma" }, "Başvurun kabul edilmedi: Fırın Bir. Zaten bu işletmede çalışıyorsun; iş değiştirmen gerekmedi."],
    [{ tur: "goc_etti", hafta: 1, sehir: 2 }, "Taşındın: Bakırbük."],
    [{ tur: "lonca_kapali", hafta: 1, lonca: "lonca1" }, "Mevduat koyduğun lonca kapalı; birikimin bu hafta başka loncaya gitti."],
    [{ tur: "mevduat_yatirilmadi", hafta: 1 }, "Mevduat koyduğun lonca kapalı ve açık lonca bulunamadı; birikimin elinde kaldı."],
    [{ tur: "cekildi", hafta: 1, miktar: 1250 }, "1.250 Akçe çektin."],
    [{ tur: "sermaye_eklendi", hafta: 2, miktar: 500, firma: "Fırın Bir" }, "500 Akçe sermayeyi Fırın Bir işletmene ekledin."],
    [{ tur: "sermaye_eklenemedi", hafta: 2, neden: "nakit_yok" }, "Sermaye eklenemedi: nakdin yetmedi."],
    [{ tur: "lonca_degisti", hafta: 4, firma: "Fırın Bir", eski: "lonca0", lonca: "lonca2" }, "Fırın Bir işletmen Lonca 3 loncasına geçti."],
    [{ tur: "lonca_degisti", hafta: 4, firma: "Fırın Bir", eski: "lonca0", lonca: "lonca2", kaynak: "insan" }, "Fırın Bir işletmen Lonca 3 loncasına geçti."],
    [{ tur: "lonca_degisti", hafta: 4, firma: "Fırın Bir", eski: "lonca0", lonca: "lonca2", kaynak: "otomatik" }, "Fırın Bir işletmen kendiliğinden Lonca 1 loncasından Lonca 3 loncasına geçti: o lonca daha elverişli çıktı."],
    [{ tur: "lonca_degisti", hafta: 4, firma: "Fırın Bir", eski: "lonca0", lonca: "lonca2", kaynak: "baska" }, "Fırın Bir işletmen Lonca 3 loncasına geçti."],
    [{ tur: "firmam_kuculdu", hafta: 1, firma: "Fırın Bir", neden: "zarar" }, "Fırın Bir işletmen zarar ettiği ve kasası inceldiği için kadrosunu küçülttü: bir işçi çıkarıldı."],
    [{ tur: "firmam_kuculdu", hafta: 1, firma: "Fırın Bir", neden: "ucret" }, "Fırın Bir işletmen işçilerin ücretini ödeyemedi: bir işçi işten ayrıldı."],
    [{ tur: "lonca_degisti", hafta: 4, firma: "Fırın Bir", eski: "lonca0", lonca: "lonca2", kaynak: "kapanma" }, "Lonca 1 loncan kapandı; Fırın Bir işletmen Lonca 3 loncasına taşındı."],
    [{ tur: "firmam_kuculdu", hafta: 1, firma: "Fırın Bir", neden: "yeni_bilinmeyen" }, "Fırın Bir işletmen kadrosunu küçülttü."],
    [{ tur: "lonca_kapandi_yeniden_atandi", hafta: 30, firma: "Fırın Bir", eski: "lonca2", lonca: "lonca1" }, "Lonca 3 kapandı; işletmen Lonca 2 loncasına atandı. Seçimin silindi."],
    [{ tur: "karar_uygulanamadi", hafta: 4, karar: "lonca_sec", neden: "lonca_kapali" }, "Lonca değişikliği uygulanamadı."],
    [{ tur: "lonca_kuruldu", hafta: 5, lonca: "lonca6" }, "Lonca 7 loncasını kurdun."],
    [{ tur: "lonca_kurulamadi", hafta: 5, yol: "girisimci", neden: ["nakit", "yeni_sart"] }, "Lonca kurulamadı: Kuruluş sermayesi için nakdin yetmiyor. Başka bir şart eksik."],
    [{ tur: "loncam_kapandi", hafta: 9, lonca: "lonca6", neden: "gider", kayip: 3000, mevduat_tasindi: { lonca: "lonca1", tutar: 50 }, mevduat_odendi: 0 }, "Lonca 7 loncan kapandı (gider ödenemedi). Kuruluşta koyduğun sermayeden 3.000 Akçe geri alamadın; sermaye diğer loncalara dağıldı. 50 Akçe mevduatın Lonca 2 loncasına taşındı. Bir süre yeni lonca kuramazsın."],
    [{ tur: "loncam_kapandi", hafta: 9, lonca: "lonca6", neden: "uyesiz", kayip: 750, mevduat_tasindi: null, mevduat_odendi: 20 }, "Lonca 7 loncan kapandı (üyesiz ve kasasız). Kuruluşta koyduğun sermayeden 750 Akçe geri alamadın; sermaye diğer loncalara dağıldı. 20 Akçe mevduatın nakit ödendi. Bir süre yeni lonca kuramazsın."],
    [{ tur: "cekilemedi", hafta: 1 }, "Loncanın kasasında çekebileceğin para yoktu."],
    [{ tur: "kurabilir_oldu", hafta: 1 }, "İşletme kurabilirsin: bütün şartlar tamam."],
    [{ tur: "karar_uygulanamadi", hafta: 1, karar: "goc", neden: "kurucu" }, "Taşınma uygulanamadı."],
    [{ tur: "karar_uygulanamadi", hafta: 1, karar: "ayril", neden: null }, "İşten ayrılma uygulanamadı."],
    [{ tur: "karar_uygulanamadi", hafta: 1, karar: "constructor", neden: null }, "Kararın uygulanamadı."],
    [{ tur: "isten_cikarildi", hafta: 2, firma: "s0_ahir3", neden: null }, "Ahırdan ayrıldın."],
    [{ tur: "is_degistirdi", hafta: 3, eski: "Fırın Bir", yeni: "Market İki" }, "İş değiştirdin: Fırın Bir işinden Market İki işine geçtin."],
  ];
  it.each(ornek)("%j metne dönüşür", (olay, metin) => {
    expect(daoOlayMetni(olay, ad)).toBe(metin);
  });

  it("bütün olay türleri örneklenmiş", () => {
    expect(new Set(ornek.map(([o]) => o.tur))).toEqual(new Set(["kuruldu", "kurulamadi", "ayrildi", "ise_girdi", "isten_cikarildi", "firma_batti", "is_degistirdi", "goc_etti", "lonca_kapali", "mevduat_yatirilmadi", "cekildi", "cekilemedi", "sermaye_eklendi", "sermaye_eklenemedi", "lonca_degisti", "firmam_kuculdu", "lonca_kapandi_yeniden_atandi", "lonca_kuruldu", "lonca_kurulamadi", "loncam_kapandi", "kurabilir_oldu", "karar_uygulanamadi", "basvuru_red"]));
  });
});

describe("F2: lonca seçimi tel biçimi ve hata nedenleri", () => {
  const firmam = { ad: "s0_firin_oy1", sektor: "firin", nakit: 400, isci: 3, kar: 1, yas: 5 };
  const ham = (ek: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(GOZLEM_KURUCU)), ...ek });
  it("firmam_lonca_ve_lonca_listesi_alanlari_ayristirilir", () => {
    const g = parseDaoGozlem(ham({
      firmam: { ...firmam, lonca: "lonca1", lonca_degisebilir: true },
      loncalar: [{ ad: "lonca0", mevduat_faizi: 0, kapali: false, mevduat: 1, pay_orani: 0.02, kredi_verebilir: true, skor: 0.05 }, { ad: "lonca1", mevduat_faizi: 0, kapali: true, mevduat: 0, pay_orani: 0.02, kredi_verebilir: false, skor: null }],
    }));
    expect(g.firmam).toMatchObject({ lonca: "lonca1", lonca_degisebilir: true });
    expect(g.loncalar[0]).toMatchObject({ pay_orani: 0.02, kredi_verebilir: true, skor: 0.05 });
    expect(g.loncalar[1]!.skor).toBeNull();
  });
  it("eski_sunucuda_alanlar_yoktur", () => {
    const g = parseDaoGozlem(ham({ firmam }));
    expect("lonca" in g.firmam!).toBe(false);
    expect("skor" in g.loncalar[0]!).toBe(false);
  });
  it("lonca_olaylari_ayristirilir", () => {
    const g = parseDaoGozlem(ham({ olaylar: [{ tur: "lonca_degisti", hafta: 4, firma: "f", eski: "lonca0", lonca: "lonca2" }, { tur: "lonca_kapandi_yeniden_atandi", hafta: 9, firma: "f", eski: "lonca2", lonca: "lonca1" }] }));
    expect(g.olaylar.map((o) => o.tur)).toEqual(["lonca_degisti", "lonca_kapandi_yeniden_atandi"]);
  });
  it("rekabet_g1_kaynak_ve_neden_ayristirilir_bilinmeyen_dusurmez", () => {
    const g = parseDaoGozlem(ham({ olaylar: [
      { tur: "lonca_degisti", hafta: 4, firma: "f", eski: "lonca0", lonca: "lonca2", kaynak: "otomatik" },
      { tur: "lonca_degisti", hafta: 5, firma: "f", eski: "lonca2", lonca: "lonca1", kaynak: "yeni_bilinmeyen" },
      { tur: "lonca_degisti", hafta: 6, firma: "f", eski: "lonca1", lonca: "lonca0" },
      { tur: "firmam_kuculdu", hafta: 7, firma: "f", kisi: "p1", neden: "zarar" },
      { tur: "firmam_kuculdu", hafta: 8, firma: "f", kisi: "p1", neden: "yeni_bilinmeyen" },
    ] }));
    expect(g.olaylar).toEqual([
      { tur: "lonca_degisti", hafta: 4, firma: "f", eski: "lonca0", lonca: "lonca2", kaynak: "otomatik" },
      { tur: "lonca_degisti", hafta: 5, firma: "f", eski: "lonca2", lonca: "lonca1", kaynak: "yeni_bilinmeyen" },
      { tur: "lonca_degisti", hafta: 6, firma: "f", eski: "lonca1", lonca: "lonca0" },
      { tur: "firmam_kuculdu", hafta: 7, firma: "f", neden: "zarar" },
      { tur: "firmam_kuculdu", hafta: 8, firma: "f", neden: "yeni_bilinmeyen" },
    ]);
  });
  it("lonca_erken_hafta_ve_firmam_kuculdu_ayristirilir", () => {
    const g = parseDaoGozlem(ham({ firmam: { ...firmam, lonca: "lonca1", lonca_degisebilir: false, lonca_erken_hafta: 22 }, olaylar: [{ tur: "firmam_kuculdu", hafta: 7, firma: "f", kisi: "p12", neden: "satis" }] }));
    expect(g.firmam).toMatchObject({ lonca_degisebilir: false, lonca_erken_hafta: 22 });
    expect(g.olaylar).toEqual([{ tur: "firmam_kuculdu", hafta: 7, firma: "f", neden: "satis" }]);
    expect(parseDaoGozlem(ham({ firmam: { ...firmam, lonca: "l", lonca_degisebilir: false, lonca_erken_hafta: null } })).firmam).toMatchObject({ lonca_erken_hafta: null });
  });
  it.each(["kurucu_degil", "lonca_kapali", "ayni_lonca", "bekleme", "erken"])("ret_nedeni_%s_ozel_metne_doner", (reason) => {
    const e = new SimUnsupported("karar_gecersiz", [{ id: "lonca", reason }]);
    expect(daoHataAnahtari(e)).toBe(`dao.hata.neden.${reason}`);
  });
});

describe("F3: lonca_kur tel biçimi", () => {
  const ham = (ek: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(GOZLEM_KURUCU)), ...ek });
  it("lonca_kur_alani_ayristirilir", () => {
    const g = parseDaoGozlem(ham({ lonca_kur: { girisimci: ["nakit"], medya: [], yeniden: ["yuva_yok"] } }));
    expect(g.lonca_kur).toEqual({ girisimci: ["nakit"], medya: [], yeniden: ["yuva_yok"] });
  });
  it("eski_sunucuda_lonca_kur_yoktur", () => {
    expect("lonca_kur" in parseDaoGozlem(ham({}))).toBe(false);
  });
  it("eksik_yol_ya_da_bozuk_liste_reddedilir", () => {
    expect(() => parseDaoGozlem(ham({ lonca_kur: { girisimci: [] } }))).toThrow();
    expect(() => parseDaoGozlem(ham({ lonca_kur: { girisimci: [1], medya: [], yeniden: [] } }))).toThrow();
  });
  it("olaylar_ayristirilir", () => {
    const g = parseDaoGozlem(ham({ olaylar: [{ tur: "lonca_kuruldu", hafta: 5, lonca: "lonca6" }, { tur: "lonca_kurulamadi", hafta: 6, yol: "medya", neden: ["medya_firma"] }] }));
    expect(g.olaylar.map((o) => o.tur)).toEqual(["lonca_kuruldu", "lonca_kurulamadi"]);
  });
  it("loncam_ayrinti_ve_olay_ayristirilir", () => {
    const g = parseDaoGozlem(ham({
      ben: { ...JSON.parse(JSON.stringify(GOZLEM_KURUCU)).ben, loncam: { ad: "lonca6", sermaye: 3000, uye_sayisi: 2, kasa: 15.5, durum: "acik" } },
      lonca_kur_ayrinti: { girisimci: [{ id: "nakit", gerek: 3500, var: 10 }, { id: "kurucu_yasagi", kalan: 50 }], medya: [], yeniden: [{ id: "yuva_yok" }] },
      olaylar: [{ tur: "loncam_kapandi", hafta: 9, lonca: "lonca6", neden: "gider", kayip: 3000, mevduat_tasindi: { lonca: "lonca1", tutar: 50 }, mevduat_odendi: 0 }],
    }));
    expect(g.ben.loncam).toEqual({ ad: "lonca6", sermaye: 3000, uye_sayisi: 2, kasa: 15.5, durum: "acik" });
    expect(g.lonca_kur_ayrinti!.girisimci[1]).toEqual({ id: "kurucu_yasagi", kalan: 50 });
    expect(g.olaylar[0]).toMatchObject({ tur: "loncam_kapandi", mevduat_tasindi: { lonca: "lonca1", tutar: 50 }, mevduat_odendi: 0 });
    expect(parseDaoGozlem(ham({ ben: { ...JSON.parse(JSON.stringify(GOZLEM_KURUCU)).ben, loncam: null } })).ben.loncam).toBeNull();
    expect(() => parseDaoGozlem(ham({ lonca_kur_ayrinti: { girisimci: [{ id: "nakit", gerek: "x" }], medya: [], yeniden: [] } }))).toThrow();
  });
  it("her_eksik_kimliginin_metni_var", () => {
    for (const id of ["erken", "inovator_degil", "medya_firma", "zaten_sahip", "dao_aktif", "nakit", "itibar", "kurucu_yasagi", "dao_telif", "firma_yas_kadro", "yuva_yok", "yol", "kapali"]) {
      expect(loncaKurEksikMetni(id)).not.toBe(loncaKurEksikMetni("tanimsiz_kimlik"));
    }
  });
});

describe("terfi ilerlemesi", () => {
  const ben = (unvan: "cirak" | "kalfa" | "usta" | "girisimci" | "bilinmiyor", calisilan_hafta: number, itibar: number) => ({ unvan, calisilan_hafta, itibar });
  it("esikler_modeldeki_degerlerdir", () => {
    expect(UNVAN_ESIKLERI).toEqual({ kalfa: { hafta: 40, itibar: 4 }, usta: { hafta: 150, itibar: 12 } });
  });
  it("cirak_kalfaya_kalfa_ustaya_ilerler_usta_girisimci_ve_bilinmeyen_null", () => {
    expect(terfiIlerlemesi(ben("cirak", 23, 2.1))).toEqual({ hedef: "kalfa", yaklasik: true, hafta: 23, gerekenHafta: 40, itibar: 2.1, gerekenItibar: 4, tamam: false });
    expect(terfiIlerlemesi(ben("kalfa", 100, 12))).toMatchObject({ hedef: "usta", gerekenHafta: 150, gerekenItibar: 12, tamam: false });
    expect(terfiIlerlemesi(ben("usta", 300, 20))).toBeNull();
    expect(terfiIlerlemesi(ben("girisimci", 300, 20))).toBeNull();
    expect(terfiIlerlemesi(ben("bilinmiyor", 300, 20))).toBeNull();
  });
  it("tamam_yalniz_iki_sart_birden_saglaninca", () => {
    const tb = (tecrube_hafta: number, itibar: number) => terfiIlerlemesi({ unvan: "cirak", calisilan_hafta: 0, tecrube_hafta, itibar })!.tamam;
    expect(tb(40, 3.9)).toBe(false);
    expect(tb(39, 4)).toBe(false);
    expect(tb(40, 4)).toBe(true);
  });
  it("tecrube_hafta_varsa_o_kullanilir_yaklasik_degil_tamam_hesaplanir", () => {
    const r = terfiIlerlemesi({ unvan: "cirak", calisilan_hafta: 90, tecrube_hafta: 38.5, itibar: 5 })!;
    expect(r).toMatchObject({ hafta: 38.5, yaklasik: false, tamam: false });
    expect(terfiIlerlemesi({ unvan: "cirak", calisilan_hafta: 10, tecrube_hafta: 41, itibar: 5 })).toMatchObject({ hafta: 41, yaklasik: false, tamam: true });
  });
  it("tecrube_hafta_yoksa_calisilan_hafta_yaklasik_ve_tamam_asla_true_degil", () => {
    expect(terfiIlerlemesi(ben("cirak", 90, 5))).toMatchObject({ hafta: 90, yaklasik: true, tamam: false });
  });
  it("model_terfi_esigi_gelirse_yerel_kopyanin_yerine_kullanilir", () => {
    const esik = { kalfa: { hafta: 30, itibar: 2 }, usta: { hafta: 100, itibar: 8 } };
    expect(terfiIlerlemesi({ unvan: "cirak", calisilan_hafta: 0, tecrube_hafta: 31, terfi_esik: esik, itibar: 2.5 })).toMatchObject({ gerekenHafta: 30, gerekenItibar: 2, yaklasik: false, tamam: true });
  });
  it("wire_tecrube_hafta_istege_bagli_sayi_olarak_ayristirilir", () => {
    const ham = (ben: Record<string, unknown>) => JSON.parse(JSON.stringify({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, tecrube_hafta: undefined, ...ben } }));   // eski sunucu: alan yok
    expect(parseDaoGozlem(ham({ tecrube_hafta: 12.5 })).ben.tecrube_hafta).toBe(12.5);
    expect("tecrube_hafta" in parseDaoGozlem(ham({})).ben).toBe(false);
    expect("tecrube_hafta" in parseDaoGozlem(ham({ tecrube_hafta: "x" })).ben).toBe(false);
    expect("tecrube_hafta" in parseDaoGozlem(ham({ tecrube_hafta: null })).ben).toBe(false);
  });
  it("belediye_kimligi_sehir_numarasindan", () => {
    expect(belediyeKimligi(3)).toBe("s3_belediye0");
  });
});

describe("DAO sabit metinler", () => {
  it("unvan, durum ve eksikler", () => {
    expect(["cirak", "kalfa", "usta", "girisimci"].map((u) => daoUnvanMetni(u as "cirak"))).toEqual(["Çırak", "Kalfa", "Usta", "Girişimci"]);
    expect(["ahir", "calisan", "is_arayan", "kurucu"].map((d) => daoDurumMetni(d as "ahir"))).toEqual(["Ahırda çalışıyor", "Çalışıyor", "İş arıyor", "İşletme sahibi"]);
    const k = { evet: false, eksikler: [], harc: 500, gereken_hafta: 13 };
    expect(daoEksikMetni("issiz", k)).toBe("İşletme kurmak için bir işte çalışıyor ya da iş arıyor olmalısın.");
    expect(daoEksikMetni("calisma", k)).toBe("En az 13 hafta çalışmış olmalısın.");
    expect(daoEksikMetni("harc", k)).toBe("Kuruluş harcı için 500 Akçe gerekir.");
    expect(daoEksikMetni("zaten_kurucu", k)).toBe("Zaten bir işletmen var.");
    expect(daoEksikMetni("erken", k)).toBe("Oyunun ilk haftasında işletme kurulamaz.");
    expect(t("dao.ahir.cik")).toBe("Ahırdan çık, iş ara");
    expect(t("dao.kayit_notu")).toBe("Verdiğin kararlar, bilgisayar karakterlerini daha gerçekçi yapmak için kaydedilir.");
    expect(t("dao.sunucu_yok")).toBe("DAO oyunu için oyun sunucusu çalışmalı.");
  });

  it("hata kodları Türkçe metne döner", () => {
    const m = (kod: string) => t(daoHataAnahtari(new SimUnsupported(kod)));
    expect(m("ayni_hafta")).toBe("Bu hafta için zaten bir karar verdin.");
    expect(m("once_cek")).toBe("Başka loncaya geçmeden önce mevduatını çek.");
    expect(m("kurucuyken_goc")).toBe("İşletme sahibiyken taşınamazsın.");
    expect(m("kosu_bitti")).toBe("Oyun bitti.");
    expect(m("karar_gecersiz")).toBe("Bu karar verilemiyor.");
    expect(t(daoHataAnahtari(new SimUnsupported("hata.sunucu_yok")))).toBe(t("hata.sunucu_yok"));
    expect(t(daoHataAnahtari(new Error("x")))).toBe(t("dao.hata.genel"));
  });

  it("süre 520", () => {
    expect(DAO_SURE).toBe(520);
  });
});

describe("DAO tel ayrıştırma", () => {
  it("gözlem örnekleri ayrışır", () => {
    expect(parseDaoGozlem(JSON.parse(JSON.stringify(GOZLEM_AHIR)))).toEqual(GOZLEM_AHIR);
    expect(parseDaoGozlem(JSON.parse(JSON.stringify(GOZLEM_KURUCU)))).toEqual(GOZLEM_KURUCU);
  });

  it("bilinmeyen olay türü düşmez genel olay olur, bozuk alan reddedilir", () => {
    const g = parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "yeni_tur", hafta: 1 }, { tur: "ayrildi", hafta: 2 }] });
    expect(g.olaylar).toEqual([{ tur: "genel", hafta: 1, kaynak: "yeni_tur" }, { tur: "ayrildi", hafta: 2 }]);
    expect(daoOlayMetni(g.olaylar[0]!, ad)).toBe(t("dao.olay.genel"));
    expect(t("dao.olay.genel")).not.toBe("");
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, ben: { ...GOZLEM_AHIR.ben, durum: 7 } })).toThrow(WireError); // dizge olmayan; tanınmayan dizge "bilinmiyor" olur (daoTel.test)
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, hafta: "3" })).toThrow(WireError);
    expect(() => parseDaoGozlem(null)).toThrow(WireError);
  });

  it("talep karşılama boş olabilir", () => {
    const g = parseDaoGozlem({ ...GOZLEM_AHIR, sehir: { talep_karsilama: null, is_arayan: 0 } });
    expect(g.sehir.talep_karsilama).toBeNull();
  });

  it("paketin dao alanı ayrışır; bozuk dao paketi düşürmez", () => {
    expect(parsePacket({ ...packetOf("r", 3, 1), dao: GOZLEM_AHIR }).dao).toEqual(GOZLEM_AHIR);
    expect(parsePacket({ ...packetOf("r", 3, 1), dao: { x: 1 } }).dao).toBeUndefined();
    expect(parsePacket(packetOf("r", 3, 1)).dao).toBeUndefined();
  });

  it("durumda mode ve dunyaKodu", () => {
    const base = JSON.parse(JSON.stringify({ runId: "r", status: "paused", week: 0, durationWeeks: 520, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "x", name: "A", cityNames: [] }));
    expect(parseState(base).mode).toBeUndefined();
    expect(parseState({ ...base, mode: "dao", dunyaKodu: "K7M2QXA" })).toMatchObject({ mode: "dao", dunyaKodu: "K7M2QXA" });
    expect(parseState({ ...base, mode: "baska" }).mode).toBeUndefined();
  });
});

describe("DAO yeni olay türleri telden ayrıştırılır", () => {
  it("kurabilir_oldu_ve_karar_uygulanamadi_dusmez_bilinmeyen_genel_olur", () => {
    const g = parseDaoGozlem({
      ...GOZLEM_AHIR,
      olaylar: [
        { tur: "kurabilir_oldu", hafta: 4 },
        { tur: "karar_uygulanamadi", hafta: 4, karar: "goc", neden: "kurucu" },
        { tur: "karar_uygulanamadi", hafta: 5, karar: "ayril" },
        { tur: "bilinmeyen_olay", hafta: 5 },
      ],
    });
    expect(g.olaylar).toEqual([
      { tur: "kurabilir_oldu", hafta: 4 },
      { tur: "karar_uygulanamadi", hafta: 4, karar: "goc", neden: "kurucu" },
      { tur: "karar_uygulanamadi", hafta: 5, karar: "ayril", neden: null },
      { tur: "genel", hafta: 5, kaynak: "bilinmeyen_olay" },
    ]);
    expect(() => parseDaoGozlem({ ...GOZLEM_AHIR, olaylar: [{ tur: "karar_uygulanamadi", hafta: 4 }] })).toThrow(WireError);
  });
});
