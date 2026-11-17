import type { DaoGozlem } from "@/oyun/sim/dao";

/**
 * DAO gözlemi örnekleri (yalnız web testleri; sunucu bağlantı sözleşmesi dosyasından bağımsız).
 * Biçim: görev 5 `gozlem(W)` çıktısı. Sunucu tarafı (T6a) bu örneklerle hizalanır.
 */
export const GOZLEM_AHIR: DaoGozlem = {
  hafta: 3,
  ben: {
    sehir: 0, nakit: 120.5, mevduat: { lonca: null, tutar: 0 },
    is: { firma: "f1", sektor: "ahir", ucret: 10 },
    durum: "ahir", calisilan_hafta: 3, tecrube_hafta: 0, terfi_esik: { kalfa: { hafta: 40, itibar: 4 }, usta: { hafta: 150, itibar: 12 } }, itibar: 0.5, servet_dilimi: 3, unvan: "cirak",
  },
  firmam: null,
  kurabilir: { evet: false, eksikler: ["calisma", "harc"], harc: 500, gereken_hafta: 13 },
  sektorler: [
    { sektor: "firin", urun: "ekmek", fiyat: 4.2, firma: 3, eksik: 120, disaridan: 40 },
    { sektor: "market", urun: "gida", fiyat: 6, firma: 2, eksik: 0, disaridan: 0 },
  ],
  loncalar: [
    { ad: "lonca0", mevduat_faizi: 0.0012, kapali: false, mevduat: 5000 },
    { ad: "lonca1", mevduat_faizi: 0.002, kapali: true, mevduat: 800 },
  ],
  sehir: { talep_karsilama: 0.93, is_arayan: 14 },
  tercih: { mevduat: null },
  gecmis: { dilim0: 3, firmalar: [] },
  ilanlar: [{ firma: "f1", ad: "f1", sektor: "firin", acik: 2, ucret: 14.5, maas_odeyemedi: false, kasa_gucu: "orta" }],
  olaylar: [{ tur: "ise_girdi", hafta: 3, firma: "Fırın Bir" }],
};

export const GOZLEM_CALISAN: DaoGozlem = {
  ...GOZLEM_AHIR,
  ben: {
    ...GOZLEM_AHIR.ben,
    nakit: 900, mevduat: { lonca: "lonca0", tutar: 300 },
    is: { firma: "f7", sektor: "firin", ucret: 22 },
    durum: "calisan", calisilan_hafta: 14, unvan: "kalfa", servet_dilimi: 4,
  },
  kurabilir: { evet: true, eksikler: [], harc: 500, gereken_hafta: 13 },
  tercih: { mevduat: { lonca: "lonca0", oran: 0.5 } },
  olaylar: [],
};

export const GOZLEM_KURUCU: DaoGozlem = {
  ...GOZLEM_CALISAN,
  ben: { ...GOZLEM_CALISAN.ben, is: { firma: "f9", sektor: "firin", ucret: 0 }, durum: "kurucu", unvan: "girisimci", servet_dilimi: 5 },
  firmam: { ad: "Benim Fırınım", sektor: "firin", nakit: 400, isci: 3, kar: 12.5, yas: 6, kasa_degisim: -30, kasa_hafta: 4.5 },
  kurabilir: { evet: false, eksikler: ["zaten_kurucu"], harc: 500, gereken_hafta: 13 },
  gecmis: { dilim0: 3, firmalar: [{ ad: "Benim Fırınım", sektor: "firin", yas: 6, ayakta: true }] },
  olaylar: [{ tur: "kuruldu", hafta: 8, firma: "Benim Fırınım", sektor: "firin" }],
};
