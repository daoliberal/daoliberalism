/**
 * Devam akislari (B4a `akis`): en yakin goruntuden devam, dal, surum uyumsuzlugunda tariften yeniden oynatma, koşu silme.
 *
 * Sessiz yeniden oynatma yoktur: goruntu uyumsuz/guvensiz/bozuksa akis `uyumsuz` sonucu (tanı kaydi + tahmini sure + secenekler) dondurur;
 * "yeni surumde bastan oynat" ya da "disa aktar" kararini kullanici verir (B8) ve `tariftenBastan` / `disaAktar` ile uygulanir.
 */
import { hataFark, hataMesaji, hataTuru, type KayitCekirdegi } from "./cekirdek";
import { KayitDeposu, type GoruntuUstverisi, type KosuKaydi } from "./depo";
import { anahtarFarki, tahminiOynatma, uyumsuzTuru, type SureTahmini, type UyumsuzTur } from "./siniflandirma";
import { SABITLER, type DevamSonuc, type Fark, type GunlukGirisi, type ModelAnahtari, type Tarif } from "./tel";
import type { KosuYazici } from "./yazici";

export type UyumsuzSecenek = "tariften_oynat" | "disa_aktar" | "sil";

export type AkisSonucu =
  | { sonuc: "tamam"; kosuId: string; hafta: number; uygulanan: number; kalan: number; kaynak: "goruntu" | "tarif"; goruntuHaftasi: number | null; genisletilmis: boolean }
  /** Cekirdek durdu (reddedildi/sapma/takildi/basarisiz): kosu cekirdekte kalir; `kosuSil` ile silinebilir. */
  | { sonuc: "durdu"; durum: Exclude<DevamSonuc["durum"], "tamam">; kosuId: string; cekirdek: DevamSonuc; kosuSilinebilir: true }
  | { sonuc: "uyumsuz"; tur: UyumsuzTur; fark: Fark; hedef: number; tahmini: SureTahmini; secenekler: readonly UyumsuzSecenek[] }
  | { sonuc: "tariften_gerek"; neden: "goruntu_yok" | "goruntu_cok_eski"; hedef: number; tahmini: SureTahmini }
  | { sonuc: "hata"; tur: string; mesaj: string };

export interface AkisSecenek {
  depo: KayitDeposu;
  cekirdek: KayitCekirdegi;
  yazici?: KosuYazici | null;
  zaman?: () => number;
  /**
   * B7: sunulan GUNCEL paketin model_sha256'i (yoksa `null`/verilmezse denetim yok). Yuklu paket guncel degilse (onceki paketle acilmis oturum) ve kaydin modeli
   * yuklu paketinkinden FARKLIYSA `tariftenBastan` kaydin anahtarini yuklu (eski) paketin anahtarina yazmaz: `yeniden_yukle_gerek` doner (yenilemeden sonra
   * `modelSecimi` kaydin paketini, yoksa guncel paketi yukler; guncel paketle acilan oturumda kosul olusmaz, dongu yok).
   */
  guncelModel?: () => Promise<string | null>;
}

export interface DevamSecenegi {
  /** Varsayilan: kosunun kayitli `yayimlanan` haftasi. */
  hedef?: number;
  ilerleme?: (hafta: number) => void;
}

export interface DalSecenegi {
  kosuId: string;
  hafta: number;
  yeniKosuId: string;
  ilerleme?: (hafta: number) => void;
  /** Dal olusunca hemen bir goruntu almayi dener (varsayilan true; dal bir sonraki kadansa dek tariften oynamasin). */
  ilkGoruntu?: boolean;
}

const SECENEKLER: readonly UyumsuzSecenek[] = ["tariften_oynat", "disa_aktar", "sil"];

export function enYakinGoruntu(goruntuler: readonly GoruntuUstverisi[], hedef: number, o: { dal?: boolean } = {}): GoruntuUstverisi | null {
  const adaylar = goruntuler.filter((g) => g.yayimlanan <= hedef && (!o.dal || g.hafta <= hedef));
  adaylar.sort((a, b) => b.yayimlanan - a.yayimlanan || b.hafta - a.hafta || b.zaman - a.zaman);
  return adaylar[0] ?? null;
}

/** Hedefe uygun tum adaylar, en yakindan baslayarak (ilki `enYakinGoruntu`dur). */
export function goruntuAdaylari(goruntuler: readonly GoruntuUstverisi[], hedef: number, o: { dal?: boolean } = {}): GoruntuUstverisi[] {
  const sonuc: GoruntuUstverisi[] = [];
  let kalan = [...goruntuler];
  for (;;) {
    const g = enYakinGoruntu(kalan, hedef, o);
    if (!g) return sonuc;
    sonuc.push(g);
    kalan = kalan.filter((x) => x !== g);
  }
}

/** Tek `devam` cagrisina verilecek `azami_hafta`: normalde 12; kadans dolmadan once dusen kosularda (<= kadans_uzun) boşluga genisletilir. */
export function azamiHaftaSec(bosluk: number): { izin: boolean; azami: number; genisletilmis: boolean } {
  if (bosluk <= SABITLER.devam_azami_hafta) return { izin: true, azami: SABITLER.devam_azami_hafta, genisletilmis: false };
  if (bosluk <= SABITLER.kadans_uzun) return { izin: true, azami: bosluk, genisletilmis: true };
  return { izin: false, azami: SABITLER.devam_azami_hafta, genisletilmis: false };
}

export class DevamAkisi {
  private readonly depo: KayitDeposu;
  private readonly cekirdek: KayitCekirdegi;
  private readonly yazici: KosuYazici | null;
  private readonly zaman: () => number;

  constructor(o: AkisSecenek) {
    this.depo = o.depo;
    this.cekirdek = o.cekirdek;
    this.yazici = o.yazici ?? null;
    this.zaman = o.zaman ?? Date.now;
    this.guncelModel = o.guncelModel ?? null;
  }

  private readonly guncelModel: (() => Promise<string | null>) | null;

  /** Acilista: kayittaki model anahtari simdikiyle ayni mi. Uyumsuzsa `devamEt` zaten `uyumsuz` sonucu verir; arayuz onceden bilgi icin kullanir. */
  async uyumlulukDurumu(kosuId: string): Promise<{ uyumlu: boolean; fark: Fark; kayitta: ModelAnahtari | null; simdi: ModelAnahtari }> {
    const simdi = await this.cekirdek.uyumlulukAnahtari();
    const k = await this.depo.kosuOku(kosuId);
    const fark = k ? anahtarFarki({ ...k.modelAnahtari }, { ...simdi }) : {};
    return { uyumlu: Object.keys(fark).length === 0, fark, kayitta: k?.modelAnahtari ?? null, simdi };
  }

  // ---- devam ------------------------------------------------------------------------------------------------------

  /**
   * B8: `devamEt` ONCESI bilgi (cekirdege gitmez): hangi yoldan acilacak, kac hafta yeniden oynatilacak ve tahmini sure. `genisletilmis` = en yakin goruntu
   * 12 haftadan uzakta (13-26): arayuz "devam birkac dakika surebilir" uyarisini onceden gosterir (sonuctaki `genisletilmis` yalniz bilgidir).
   */
  async devamOnizleme(kosuId: string, hedefHafta?: number): Promise<{ kaynak: "goruntu" | "tarif"; oynatilacak: number; tahmini: SureTahmini; genisletilmis: boolean } | null> {
    const k = await this.depo.kosuOku(kosuId);
    if (!k) return null;
    const hedef = hedefHafta ?? k.yayimlanan;
    const g = goruntuAdaylari(await this.depo.goruntuleriListele(kosuId), hedef).find((a) => azamiHaftaSec(hedef - a.yayimlanan).izin);
    if (!g) return { kaynak: "tarif", oynatilacak: hedef, tahmini: tahminiOynatma(hedef), genisletilmis: false };
    const oynatilacak = hedef - g.yayimlanan;
    return { kaynak: "goruntu", oynatilacak, tahmini: tahminiOynatma(oynatilacak), genisletilmis: azamiHaftaSec(oynatilacak).genisletilmis };
  }

  async devamEt(kosuId: string, o: DevamSecenegi = {}): Promise<AkisSonucu> {
    const k = await this.depo.kosuOku(kosuId);
    if (!k) return { sonuc: "hata", tur: "kosu_yok", mesaj: "kosu_yok" };
    const hedef = o.hedef ?? k.yayimlanan;
    const adaylar = goruntuAdaylari(await this.depo.goruntuleriListele(kosuId), hedef).filter((g) => azamiHaftaSec(hedef - g.yayimlanan).izin);
    if (adaylar.length === 0) {
      const var_ = (await this.depo.goruntuleriListele(kosuId)).some((g) => g.yayimlanan <= hedef);
      return { sonuc: "tariften_gerek", neden: var_ ? "goruntu_cok_eski" : "goruntu_yok", hedef, tahmini: tahminiOynatma(hedef) };
    }
    const gunluk = await this.depo.gunlukOku(kosuId, 0);
    // Son 2 goruntu: en yenisi bozuk/guvensizse siradaki (sinir icindeyse) denenir; surum farkinda geri dusus anlamsiz.
    let son: AkisSonucu | null = null;
    for (const g of adaylar) {
      const azami = azamiHaftaSec(hedef - g.yayimlanan);
      const h = await this.goruntuHazirla(k, g, hedef);
      let sonuc: AkisSonucu;
      if (h.sonuc) sonuc = h.sonuc;
      else {
        const paketler = await this.paketPenceresi(kosuId, g.yayimlanan);
        try {
          const r = await this.cekirdek.devam({ goruntu: h.goruntu, gunluk, hedefHafta: hedef, paketler, azamiHafta: azami.azami, ilerleme: o.ilerleme });
          return this.devamSonucu(r, { kaynak: "goruntu", goruntuHaftasi: g.hafta, genisletilmis: azami.genisletilmis, senkron: kosuId });
        } catch (e) {
          sonuc = await this.cekirdekHatasi(e, { kosuId, hedef, g, kaynak: "cekirdek" });
        }
      }
      if (sonuc.sonuc !== "uyumsuz" || sonuc.tur === "surum") return sonuc;
      son = sonuc;
    }
    return son as AkisSonucu;
  }

  // ---- dal --------------------------------------------------------------------------------------------------------

  /**
   * Dal: `devam(..., kosu_id=<yeni>, ebeveyn=[eski, hafta])`. Goruntunun host haftasi dal haftasini asmaz; gunlukten yalniz `dikis <= hafta` girisleri gider.
   * Goruntu yoksa (ilk kadans dolmadan) ebeveynin tarifiyle ve ayni gunluk suzmesiyle tariften oynatilir (dal tarifi: `parent_id`/`fork_week`).
   * Dal deposu: ebeveynin goruntu oncesi gunluk girisleri kopyalanir (dal sonradan tariften oynatilabilsin); oynatilanlar `gunlukAl` ile ayni `sira`yla yazilir.
   */
  async dalOlustur(o: DalSecenegi): Promise<AkisSonucu> {
    const e = await this.depo.kosuOku(o.kosuId);
    if (!e) return { sonuc: "hata", tur: "kosu_yok", mesaj: "kosu_yok" };
    if (!Number.isInteger(o.hafta) || o.hafta < 0) return { sonuc: "hata", tur: "dal_haftasi_gecersiz", mesaj: "dal_haftasi_gecersiz" };
    if (await this.depo.kosuOku(o.yeniKosuId)) return { sonuc: "hata", tur: "kosu_var", mesaj: "kosu_var" };
    const tumGunluk = await this.depo.gunlukOku(o.kosuId, 0);
    const gunluk = tumGunluk.filter((x) => x.dikis <= o.hafta);
    const adaylar = goruntuAdaylari(await this.depo.goruntuleriListele(o.kosuId), o.hafta, { dal: true }).filter((x) => azamiHaftaSec(o.hafta - x.yayimlanan).izin);
    const dalTarifi: Tarif = { ...e.tarif, parent_id: o.kosuId, fork_week: o.hafta };
    let g: GoruntuUstverisi | null = null;
    let azami: ReturnType<typeof azamiHaftaSec> | null = null;
    let r: DevamSonuc | null = null;
    let kopyalanacak: GunlukGirisi[] = gunluk;
    let kaynak: "goruntu" | "tarif" = "tarif";
    let sonSonuc: AkisSonucu | null = null;
    for (const aday of adaylar) {
      const az = azamiHaftaSec(o.hafta - aday.yayimlanan);
      const h = await this.goruntuHazirla(e, aday, o.hafta);
      let sonuc: AkisSonucu;
      if (h.sonuc) sonuc = h.sonuc;
      else {
        const paketler = await this.paketPenceresi(o.kosuId, aday.yayimlanan);
        try {
          r = await this.cekirdek.devam({ goruntu: h.goruntu, gunluk, hedefHafta: o.hafta, paketler, kosuId: o.yeniKosuId, ebeveyn: [o.kosuId, o.hafta], azamiHafta: az.azami, ilerleme: o.ilerleme });
          g = aday;
          azami = az;
          kaynak = "goruntu";
          kopyalanacak = gunluk.filter((x) => x.sira <= aday.yonetici.gunluk_sira);
          break;
        } catch (err) {
          sonuc = await this.cekirdekHatasi(err, { kosuId: o.kosuId, hedef: o.hafta, g: aday, kaynak: "cekirdek" });
        }
      }
      if (sonuc.sonuc !== "uyumsuz" || sonuc.tur === "surum") return sonuc;
      sonSonuc = sonuc;
    }
    if (!r) {
      if (sonSonuc) return sonSonuc; // adaylarin hepsi bozuk/guvensiz: sessiz tariften oynatma yok
      try {
        r = await this.cekirdek.tariftenOynat({ tarif: dalTarifi, gunluk, hedefHafta: o.hafta, kosuId: o.yeniKosuId, ilerleme: o.ilerleme });
      } catch (err) {
        return this.cekirdekHatasi(err, { kosuId: o.kosuId, hedef: o.hafta, g: null, kaynak: "cekirdek" });
      }
    }
    if (r.durum !== "tamam") return this.devamSonucu(r, { kaynak, goruntuHaftasi: g?.hafta ?? null, genisletilmis: false, senkron: null, kilitle: false }); // dal kaydi yok: kilitlenecek kayit da yok
    this.yazici?.kilidiBirak(r.kosu_id);

    const anahtar = await this.cekirdek.uyumlulukAnahtari();
    let tarif = dalTarifi;
    try {
      tarif = await this.cekirdek.tarifAl(r.kosu_id);
    } catch {
      /* cekirdek tarif vermezse kurulan dal tarifi kullanilir */
    }
    await this.depo.kosuOlustur({
      kosuId: r.kosu_id,
      tarif,
      modelAnahtari: anahtar,
      ebeveyn: [o.kosuId, o.hafta],
      kaynak: "yerel",
      yayimlanan: r.hafta,
      gunlukSira: 0,
      sonGoruntu: null,
      goruntuDurdu: null,
      sonDisaAktarim: e.sonDisaAktarim, // hatirlatma sayaci ebeveynden devralinir
      sonHatirlatma: e.sonHatirlatma,
      olusturma: this.zaman(),
    });
    await this.depo.gunlukYaz(r.kosu_id, kopyalanacak);
    await this.yazici?.gunlukSenkronla(r.kosu_id, 0);
    if (o.ilkGoruntu !== false) await this.yazici?.goruntuAl(r.kosu_id);
    return { sonuc: "tamam", kosuId: r.kosu_id, hafta: r.hafta, uygulanan: r.uygulanan, kalan: r.kalan, kaynak, goruntuHaftasi: g?.hafta ?? null, genisletilmis: azami?.genisletilmis ?? false };
  }

  // ---- tariften bastan ---------------------------------------------------------------------------------------------

  /**
   * `tariften_oynat(tarif, TAM gunluk, hedef)`; reddedilen kararda durur. Basarida kayit yeni model anahtariyla isaretlenir,
   * eski (uyumsuz) goruntuler silinir, durdurulmus goruntu denemesi yeniden acilir. Gunluk ve paketler kalir.
   */
  /**
   * B7 R2-1: yuklu paket guncel degil (onceki paketle acilmis oturum) ve kaydin modeli yuklu paketinkinden farkliysa kayit asagi yazilmaz; sayfa yeniden
   * yuklenmeli (`modelSecimi` kaydin paketini yukler). B8: acilis ve kayittanAc secimden ONCE bunu sorar (model farki secim ekrani ile ayrilir).
   */
  async yenidenYuklemeGerekli(kosuId: string): Promise<boolean> {
    const k = await this.depo.kosuOku(kosuId);
    const guncel = this.guncelModel ? await this.guncelModel().catch(() => null) : null;
    if (!k || guncel === null) return false;
    const yuklu = await this.cekirdek.uyumlulukAnahtari();
    return yuklu.model_sha256 !== guncel && k.modelAnahtari.model_sha256 !== yuklu.model_sha256;
  }

  async tariftenBastan(kosuId: string, o: DevamSecenegi = {}): Promise<AkisSonucu> {
    const k = await this.depo.kosuOku(kosuId);
    if (!k) return { sonuc: "hata", tur: "kosu_yok", mesaj: "kosu_yok" };
    const hedef = o.hedef ?? k.yayimlanan;
    if (await this.yenidenYuklemeGerekli(kosuId)) return { sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" };
    const gunluk = await this.depo.gunlukOku(kosuId, 0);
    let r: DevamSonuc;
    try {
      r = await this.cekirdek.tariftenOynat({ tarif: k.tarif, gunluk, hedefHafta: hedef, kosuId, ilerleme: o.ilerleme });
    } catch (e) {
      return this.cekirdekHatasi(e, { kosuId, hedef, g: null, kaynak: "cekirdek" });
    }
    if (r.durum !== "tamam") return this.devamSonucu(r, { kaynak: "tarif", goruntuHaftasi: null, genisletilmis: false, senkron: null });
    const anahtar = await this.cekirdek.uyumlulukAnahtari();
    await this.depo.kosuGuncelle(kosuId, (x) => ({ ...x, modelAnahtari: anahtar, goruntuDurdu: null, sonGoruntu: null }));
    await this.depo.goruntuleriSil(kosuId);
    await this.yazici?.goruntuDenemesiniAc(kosuId);
    this.yazici?.kilidiBirak(kosuId);
    await this.yazici?.gunlukSenkronla(r.kosu_id, 0);
    await this.depo.taniYaz({ tur: "tariften_oynatildi", kosuId, ayrinti: { hedef, hafta: r.hafta, model_sha256: anahtar.model_sha256, pyodide: anahtar.pyodide } });
    return { sonuc: "tamam", kosuId: r.kosu_id, hafta: r.hafta, uygulanan: r.uygulanan, kalan: r.kalan, kaynak: "tarif", goruntuHaftasi: null, genisletilmis: false };
  }

  // ---- silme ------------------------------------------------------------------------------------------------------

  /** `reddedildi`/`sapma` sonrasi bellekte kalan kosuyu cekirdekten siler; `kayitlaBirlikte` ise depodaki kaydi da siler. */
  async kosuSil(kosuId: string, o: { kayitlaBirlikte?: boolean } = {}): Promise<void> {
    try {
      await this.cekirdek.kosuSil(kosuId);
    } catch (e) {
      // Yalniz "cekirdekte yok" (404 / UnknownRun / kosu_yok) sessizdir; baska hata YUKARI cikar ve kayit silinmez (cekirdekte yasayan kosu kayitsiz kalip dirilmesin).
      const yok = hataTuru(e) === "UnknownRun" || hataMesaji(e) === "kosu_yok";
      if (!o.kayitlaBirlikte || !yok) throw e;
    }
    this.yazici?.kilidiBirak(kosuId);
    if (o.kayitlaBirlikte) await this.depo.kosuSil(kosuId);
  }

  /** `devam` paket penceresi: goruntu haftasinda biten ardisik son ek (delik varsa ardisik kisim, goruntu haftasi paketi yoksa bos). */
  private async paketPenceresi(kosuId: string, yayimlanan: number) {
    const p = await this.depo.paketPenceresi(kosuId, yayimlanan, SABITLER.paket_penceresi);
    let bas = p.length;
    let beklenen = yayimlanan;
    while (bas > 0 && (p[bas - 1] as { week: number }).week === beklenen) {
      bas--;
      beklenen--;
    }
    return p.slice(bas);
  }

  // ---- ic ---------------------------------------------------------------------------------------------------------

  /** Goruntu parcalari + anahtar on denetimi. Sorun varsa hazir `uyumsuz` sonucu doner (goruntu cekirdege hic gitmez). */
  private async goruntuHazirla(k: KosuKaydi, g: GoruntuUstverisi, hedef: number): Promise<{ sonuc: AkisSonucu; goruntu?: undefined } | { sonuc?: undefined; goruntu: { parcalar: ArrayBuffer[]; yonetici: GoruntuUstverisi["yonetici"] } }> {
    const simdi = await this.cekirdek.uyumlulukAnahtari();
    const fark = anahtarFarki({ ...g.anahtar }, { ...simdi });
    if (Object.keys(fark).length > 0) return { sonuc: await this.uyumsuzSonuc("surum", fark, { kosuId: k.kosuId, hedef, g, kaynak: "on_denetim" }) };
    const parcalar = await this.depo.goruntuParcalari(k.kosuId, g.goruntuKimligi);
    if (!parcalar) return { sonuc: await this.uyumsuzSonuc("bozuk", { bicim: ["parca_eksik", "tam"] }, { kosuId: k.kosuId, hedef, g, kaynak: "on_denetim" }) };
    return { goruntu: { parcalar, yonetici: g.yonetici } };
  }

  private async cekirdekHatasi(e: unknown, o: { kosuId: string; hedef: number; g: GoruntuUstverisi | null; kaynak: string }): Promise<AkisSonucu> {
    const ut = uyumsuzTuru(e);
    if (ut) return this.uyumsuzSonuc(ut, hataFark(e) ?? {}, o);
    const tur = hataTuru(e);
    const mesaj = hataMesaji(e).slice(0, 200);
    // Gorunti-yonetici eslesmesi yerel kaydin bozuldugunu gosterir: bozuk akisi (siradaki goruntu / tariften secenegi).
    if (tur === "ValueError" && /e[sş]le[sş]mi/i.test(mesaj)) return this.uyumsuzSonuc("bozuk", { eslesme: ["goruntu_yonetici", mesaj] }, o);
    await this.depo.taniYaz({ tur: "cekirdek_hatasi", kosuId: o.kosuId, ayrinti: { hata: tur, kaynak: o.kaynak, hedef: o.hedef, mesaj } });
    return { sonuc: "hata", tur, mesaj };
  }

  private async uyumsuzSonuc(tur: UyumsuzTur, fark: Fark, o: { kosuId: string; hedef: number; g: GoruntuUstverisi | null; kaynak: string }): Promise<AkisSonucu> {
    const simdi = await this.cekirdek.uyumlulukAnahtari().catch(() => null);
    await this.depo.taniYaz({
      tur: "uyumsuz_goruntu",
      kosuId: o.kosuId,
      ayrinti: { alt: tur, fark, kaynak: o.kaynak, goruntuHaftasi: o.g?.hafta ?? null, goruntuAnahtari: o.g?.anahtar ?? null, simdiAnahtar: simdi, hedef: o.hedef },
    });
    return { sonuc: "uyumsuz", tur, fark, hedef: o.hedef, tahmini: tahminiOynatma(o.hedef), secenekler: SECENEKLER };
  }

  private async devamSonucu(r: DevamSonuc, o: { kaynak: "goruntu" | "tarif"; goruntuHaftasi: number | null; genisletilmis: boolean; senkron: string | null; kilitle?: boolean }): Promise<AkisSonucu> {
    if (r.durum !== "tamam") {
      if (o.kilitle !== false) this.yazici?.kilitle(r.kosu_id); // durdu: gunluk/goruntu yazimi `gunlukKes` ya da silme/tariften oynatmaya dek kilitli
      return { sonuc: "durdu", durum: r.durum, kosuId: r.kosu_id, cekirdek: r, kosuSilinebilir: true };
    }
    this.yazici?.kilidiBirak(r.kosu_id); // cekirdek kosuyu yeni kurdu: eski durdu durumu gecersiz
    if (o.senkron) await this.yazici?.gunlukSenkronla(r.kosu_id, 0);
    return { sonuc: "tamam", kosuId: r.kosu_id, hafta: r.hafta, uygulanan: r.uygulanan, kalan: r.kalan, kaynak: o.kaynak, goruntuHaftasi: o.goruntuHaftasi, genisletilmis: o.genisletilmis };
  }
}
