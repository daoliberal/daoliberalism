import type { DaoEksik, DaoGozlem, DaoIlan, DaoKarar, DaoOlay } from "@/oyun/sim/dao";

/**
 * Sahte sunucunun DAO oyuncusu: gerçek modelin (görev 3-5) kurallarını küçük ölçekte taklit eder.
 * Kararlar gönderildiği haftadan SONRAKİ hafta uygulanır; ret kodları sunucu tablosundakilerle aynıdır.
 */
export class DaoRet extends Error {
  // Gerçek sunucu: ret gövdesi `fields = [{id, reason}]`; `reason` modelin nedeni (`ahirda`, `ahirda_degil`, `isletme_sahibi`, `geri_alinmaz`), nedensiz alanda "invalid" (işçinin kodu `code`'dur).
  constructor(readonly status: number, readonly kod: string, readonly fields: { id: string; reason: string }[] = []) {
    super(kod);
  }
}

const GEREKEN_HAFTA = 13;
const HARC = 500;
const SEKTORLER = ["firin", "market"] as const;
const LONCALAR = ["lonca0", "lonca1"] as const;
const TEK_SEFERLIK = new Set(["cek", "ayril", "ahirdan_cik", "basvur", "goc", "kur"]);
/** Sahte şehrin iş ilanları: ücrete göre azalan, açık kadro > 0. `f9` ilanı 4. haftadan sonra kapanır. */
const ILANLAR: readonly DaoIlan[] = [
  { firma: "f1", ad: "f1", sektor: "firin", acik: 2, ucret: 14.5, maas_odeyemedi: false, kasa_gucu: "guclu" },
  { firma: "f2", ad: "f2", sektor: "market", acik: 1, ucret: 12, maas_odeyemedi: false, kasa_gucu: "orta" },
  { firma: "f9", ad: "f9", sektor: "firin", acik: 1, ucret: 9.5, maas_odeyemedi: true, kasa_gucu: "zayif" },
];

type Bekleyen = { tek: DaoKarar | null; mevduat: { lonca: string | null; oran: number } | null };

export class FakeDao {
  hafta = 0;
  sehir = 0;
  nakit = 100;
  mevduat: { lonca: string | null; tutar: number } = { lonca: null, tutar: 0 };
  durum: "ahir" | "calisan" | "is_arayan" | "kurucu" = "ahir";
  calisilan = 0;
  firma: { ad: string; sektor: string; yas: number; ayakta: boolean } | null = null;
  tercih: { lonca: string | null; oran: number } | null = null;
  olaylar: DaoOlay[] = [];
  gecmis: { ad: string; sektor: string; yas: number; ayakta: boolean }[] = [];
  /** Gönderilmiş ve kabul edilmiş kararlar (uygulanacak haftayla). */
  kabul: { hafta: number; karar: DaoKarar }[] = [];
  private bekleyen = new Map<number, Bekleyen>();
  /** Kabul edilen başvurunun (hafta, firma): 3 hafta sonra işletme küçülür, oyuncu `isten_cikarildi` ile yeniden iş arar. */
  private is: { hafta: number; firma: string } | null = null;

  constructor(readonly sure: number) {}

  private eksikler(): DaoEksik[] {
    const e: DaoEksik[] = [];
    if (this.hafta <= 1) e.push("erken");
    if (this.durum === "is_arayan") e.push("issiz");
    if (this.durum === "kurucu") e.push("zaten_kurucu");
    if (this.calisilan < GEREKEN_HAFTA) e.push("calisma");
    if (this.nakit < HARC) e.push("harc");
    return e;
  }

  private ilanlar(hafta: number): DaoIlan[] {
    return ILANLAR.filter((i) => !(i.firma === "f9" && hafta >= 4)).map((i) => ({ ...i }));
  }

  gozlem(): DaoGozlem {
    const e = this.eksikler();
    const calisan = this.durum === "kurucu" ? "f9" : this.durum === "is_arayan" ? null : "f1";
    return {
      hafta: this.hafta,
      ben: {
        sehir: this.sehir, nakit: this.nakit, mevduat: this.mevduat,
        is: { firma: calisan, sektor: this.durum === "ahir" ? "ahir" : calisan === null ? null : "firin", ucret: calisan === null || this.durum === "kurucu" ? 0 : 10 },
        durum: this.durum, calisilan_hafta: this.calisilan, tecrube_hafta: this.calisilan, terfi_esik: { kalfa: { hafta: 40, itibar: 4 }, usta: { hafta: 150, itibar: 12 } }, itibar: 0.5, servet_dilimi: 3,
        unvan: this.durum === "kurucu" ? "girisimci" : this.calisilan >= 2 * GEREKEN_HAFTA ? "usta" : this.calisilan >= GEREKEN_HAFTA ? "kalfa" : "cirak",
        loncam: null,
      },
      firmam: this.firma && this.firma.ayakta ? { ad: this.firma.ad, sektor: this.firma.sektor, nakit: 400, isci: 3, kar: 12.5, yas: this.firma.yas, uyari: [], kasa_pisti_hafta: null } : null,
      kurabilir: { evet: e.length === 0, eksikler: e, harc: HARC, gereken_hafta: GEREKEN_HAFTA },
      sektorler: SEKTORLER.map((s, i) => ({ sektor: s, urun: s === "firin" ? "ekmek" : "gida", fiyat: 4 + i, firma: 3 - i, eksik: 100 * i, disaridan: 50 * i, kasa_egilim: -50 * i, firma_sayisi_13hf: 3 - i })),
      loncalar: LONCALAR.map((ad, i) => ({ ad, mevduat_faizi: 0.001 * (i + 1), kapali: false, mevduat: 5000, pay_orani: 0.02, kredi_verebilir: i % 2 === 0, skor: 0.03 + 0.01 * i })),
      lonca_kur: { girisimci: ["erken", "inovator_degil"], medya: ["erken", "medya_firma"], yeniden: ["yuva_yok"] },
      lonca_kur_ayrinti: { girisimci: [{ id: "erken" }, { id: "nakit", gerek: 3500, var: 10 }, { id: "kurucu_yasagi", kalan: 50 }], medya: [{ id: "medya_firma" }, { id: "itibar", gerek: 8, var: 1 }], yeniden: [{ id: "yuva_yok" }, { id: "nakit", gerek: 3000, var: 10 }] },
      sehir: { talep_karsilama: 0.9, is_arayan: 12 },
      tercih: { mevduat: this.tercih },
      gecmis: { dilim0: 3, firmalar: this.gecmis.map((f) => ({ ...f })) },
      ilanlar: this.ilanlar(this.hafta),
      olaylar: this.olaylar,
    };
  }

  /** Kararı doğrular ve sıraya koyar; uygulanacak haftayı döner (`hafta + 1`). */
  karar(k: unknown): number {
    const neden = (id: string, reason: string): never => { throw new DaoRet(422, "karar_gecersiz", [{ id, reason }]); };
    const bos = (id: string): never => { throw new DaoRet(422, "karar_gecersiz", [{ id, reason: "invalid" }]); };
    if (this.hafta >= this.sure) throw new DaoRet(409, "kosu_bitti");
    if (k === null || typeof k !== "object" || Array.isArray(k)) return bos("karar");
    const o = k as Record<string, unknown>;
    const tur = o.tur;
    const izinli: Record<string, string[]> = { mevduat: ["tur", "lonca", "oran"], cek: ["tur", "miktar"], ayril: ["tur"], ahirdan_cik: ["tur"], basvur: ["tur", "firma"], goc: ["tur", "sehir"], kur: ["tur", "sektor"] };
    if (typeof tur !== "string" || !(tur in izinli)) return bos("tur");
    if (Object.keys(o).some((a) => !izinli[tur]!.includes(a))) return bos("alan");
    const kayit = k as DaoKarar;
    if (kayit.tur === "mevduat") {
      if (!(kayit.lonca === null || (typeof kayit.lonca === "string" && (LONCALAR as readonly string[]).includes(kayit.lonca)))) return bos("lonca");
      if (typeof kayit.oran !== "number" || !(kayit.oran >= 0 && kayit.oran <= 1)) return bos("oran");
      if (kayit.lonca !== null && this.mevduat.tutar > 0 && this.mevduat.lonca !== null && this.mevduat.lonca !== kayit.lonca) throw new DaoRet(422, "once_cek");
    } else if (kayit.tur === "cek") {
      if (typeof kayit.miktar !== "number" || !(kayit.miktar > 0)) return bos("miktar");
    } else if (kayit.tur === "goc") {
      if (!Number.isInteger(kayit.sehir) || kayit.sehir < 0 || kayit.sehir > 4) return bos("sehir");
      if (this.durum === "kurucu") throw new DaoRet(422, "kurucuyken_goc");
    } else if (kayit.tur === "kur") {
      if (typeof kayit.sektor !== "string" || !(SEKTORLER as readonly string[]).includes(kayit.sektor)) return bos("sektor");
    } else if (kayit.tur === "ayril") {
      if (this.durum === "ahir") return neden("tur", "ahirda");        // ahırdan yalnız ahirdan_cik ile çıkılır
      if (this.durum === "is_arayan") return bos("tur");
    } else if (kayit.tur === "ahirdan_cik") {
      if (this.durum !== "ahir") return neden("tur", "ahirda_degil");
    } else if (kayit.tur === "basvur") {
      if (this.durum === "ahir") return neden("tur", "ahirda");
      if (this.durum === "kurucu") return neden("tur", "isletme_sahibi");
      if (typeof kayit.firma !== "string" || !ILANLAR.some((i) => i.firma === kayit.firma)) return bos("firma");
    }
    const uygulama = this.hafta + 1;
    const b = this.bekleyen.get(uygulama) ?? { tek: null, mevduat: null };
    if (TEK_SEFERLIK.has(kayit.tur)) {
      if (b.tek) throw new DaoRet(422, "ayni_hafta", [{ id: "tur", reason: "invalid" }]);
      b.tek = kayit;
    } else if (kayit.tur === "mevduat") {
      b.mevduat = { lonca: kayit.lonca, oran: kayit.oran };
    }
    this.bekleyen.set(uygulama, b);
    this.kabul.push({ hafta: uygulama, karar: kayit });
    return uygulama;
  }

  /** Bir hafta ilerler: bekleyen kararlar uygulanır, olaylar yazılır. */
  adim(): void {
    const once = this.eksikler().length === 0;
    this.hafta += 1;
    this.olaylar = [];
    const w = this.hafta;
    if (this.is !== null && this.durum === "calisan" && w === this.is.hafta + 3) {
      this.durum = "is_arayan";
      this.olaylar.push({ tur: "isten_cikarildi", hafta: w, firma: this.is.firma, neden: "kucultme" });
      this.is = null;
    }
    const b = this.bekleyen.get(w);
    this.bekleyen.delete(w);
    if (b?.mevduat) this.tercih = b.mevduat;
    if (this.firma?.ayakta) this.firma.yas += 1;
    const k = b?.tek;
    if (k?.tur === "ayril" && this.durum === "is_arayan") {
      this.olaylar.push({ tur: "karar_uygulanamadi", hafta: w, karar: "ayril", neden: "is_yok" });
    } else if (k?.tur === "goc" && this.durum === "kurucu") {
      this.olaylar.push({ tur: "karar_uygulanamadi", hafta: w, karar: "goc", neden: "kurucu" });
    } else if (k?.tur === "ayril") {
      if (this.durum === "kurucu" && this.firma) {
        this.firma.ayakta = false;
        this.olaylar.push({ tur: "firma_batti", hafta: w, firma: this.firma.ad });
      } else {
        this.olaylar.push({ tur: "ayrildi", hafta: w });
      }
      this.durum = "is_arayan";
    } else if (k?.tur === "cek") {
      const cekilen = Math.min(k.miktar, this.mevduat.tutar);
      if (cekilen > 0) {
        this.mevduat = { ...this.mevduat, tutar: this.mevduat.tutar - cekilen };
        this.nakit += cekilen;
        this.olaylar.push({ tur: "cekildi", hafta: w, miktar: cekilen });
      } else {
        this.olaylar.push({ tur: "cekilemedi", hafta: w });
      }
    } else if (k?.tur === "ahirdan_cik") {
      this.durum = "is_arayan";                                          // ahırdan yalnız bu kararla çıkılır; sonra iş arar
      this.olaylar.push({ tur: "ahirdan_cikti", hafta: w });
    } else if (k?.tur === "basvur") {
      if (this.durum === "calisan") this.olaylar.push({ tur: "basvuru_red", hafta: w, firma: k.firma, neden: "zaten_calisiyor" });
      else if (this.ilanlar(w).some((i) => i.firma === k.firma)) {
        this.durum = "calisan";
        this.is = { hafta: w, firma: k.firma };
        this.olaylar.push({ tur: "basvuru_kabul", hafta: w, firma: k.firma });
      } else this.olaylar.push({ tur: "basvuru_red", hafta: w, firma: k.firma, neden: "ilan_kapandi" });
    } else if (k?.tur === "goc") {
      this.sehir = k.sehir;
      this.olaylar.push({ tur: "goc_etti", hafta: w, sehir: k.sehir });
    } else if (k?.tur === "kur") {
      if (this.eksikler().length === 0) {
        this.firma = { ad: "Benim Fırınım", sektor: k.sektor, yas: 0, ayakta: true };
        this.gecmis.push(this.firma);
        this.durum = "kurucu";
        this.nakit -= HARC;
        this.olaylar.push({ tur: "kuruldu", hafta: w, firma: this.firma.ad, sektor: k.sektor });
      } else {
        this.olaylar.push({ tur: "kurulamadi", hafta: w, sektor: k.sektor, neden: "sart" });
      }
    }
    if (this.durum === "ahir" || this.durum === "calisan") this.calisilan += 1;
    this.nakit += this.durum === "kurucu" ? 0 : 10;
    // Model gibi: kurma şartları bu hafta ilk kez tamamlandıysa olay yazar ("Bir şey olana kadar" burada durur).
    if (!once && this.eksikler().length === 0) this.olaylar.push({ tur: "kurabilir_oldu", hafta: w });
  }
}
