/**
 * Kayit yazicisi: kosu olusturma, hafta paketleri, gunluk ve goruntu (B4a `akis` bolumu).
 *
 * Kosu basina yazimlar sirayla yurur (tick -> gunluk -> goruntu). Hafta paketleri ve gunluk hafta/sira anahtariyla idempotenttir:
 * devam sonrasi yeniden oynatma ve abonelik tekrarlari cift kayit uretmez.
 */
import { hataFark, hataMesaji, hataTuru, type KayitCekirdegi } from "./cekirdek";
import { KayitDeposu, type GoruntuUstverisi, type KosuKaydi } from "./depo";
import { gecici, kaliciDumpHatasi } from "./siniflandirma";
import { kotaDoluHatasi, type KotaYoneticisi } from "./kota";
import { semaHatalari } from "./sema";
import { TEL_SEMA, type GunlukGirisi, type HaftaPaketi, type Tarif } from "./tel";

export type GoruntuDurumu =
  | { durum: "gerekmiyor" }
  | { durum: "durdu"; tur: string }
  /** `devam`/`tariftenBastan` durdu (reddedildi/sapma/...): `gunlukKes` ya da silme/tariften oynatma olmadan yazim yapilmaz. */
  | { durum: "kilitli" }
  | { durum: "hazir_degil" }
  | { durum: "hata"; tur: string }
  | { durum: "tutarsiz" }
  | { durum: "yazim_hatasi"; tur: string }
  | { durum: "yazildi"; kimlik: string; hafta: number; yayimlanan: number; parca: number; ham: number; sikisik: number };

export interface TickSonucu {
  gunluk: { eklenen: number; cakisan: number[] };
  goruntu: GoruntuDurumu;
}

export interface HatirlatmaOlayi {
  kosuId: string;
  hafta: number;
}

export interface YaziciSecenek {
  depo: KayitDeposu;
  cekirdek: KayitCekirdegi;
  kota?: KotaYoneticisi | null;
  /** 52 haftada bir "kaydi disa aktar" hatirlatmasi (gosterim B8). */
  hatirlatma?: (o: HatirlatmaOlayi) => void;
  /** Ust uste bu kadar bilinmeyen `goruntuAl` hatasindan sonra goruntu denemesi durdurulur. */
  azamiArdisikHata?: number;
  zaman?: () => number;
}

const ARDISIK_HATA = 3;

function kopya(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export class KosuYazici {
  private readonly depo: KayitDeposu;
  private readonly cekirdek: KayitCekirdegi;
  private readonly kota: KotaYoneticisi | null;
  private readonly hatirlatma: ((o: HatirlatmaOlayi) => void) | undefined;
  private readonly azamiHata: number;
  private readonly zaman: () => number;
  private readonly kuyruk = new Map<string, Promise<unknown>>();
  private readonly ardisik = new Map<string, number>();
  /** Yalniz oturum bellegi: ardisik bilinmeyen hata durdurmasi (kalici degil). */
  private readonly oturumDurdu = new Set<string>();
  private readonly kilitli = new Set<string>();

  constructor(o: YaziciSecenek) {
    this.depo = o.depo;
    this.cekirdek = o.cekirdek;
    this.kota = o.kota ?? null;
    this.hatirlatma = o.hatirlatma;
    this.azamiHata = o.azamiArdisikHata ?? ARDISIK_HATA;
    this.zaman = o.zaman ?? Date.now;
  }

  /** Ayni kosuya ait is sirayla calisir. */
  private sirala<T>(kosuId: string, is: () => Promise<T>): Promise<T> {
    const onceki = this.kuyruk.get(kosuId) ?? Promise.resolve();
    const yeni = onceki.then(is, is);
    this.kuyruk.set(
      kosuId,
      yeni.catch(() => undefined),
    );
    return yeni;
  }

  /**
   * Koşu yaratilinca (cekirdekte var oldugunda) kaydini acar. Idempotenttir: var olan kayit korunur.
   * `tarif` verilmezse cekirdekten `tarifAl` ile okunur; model anahtari `uyumlulukAnahtari()`dir.
   */
  async kosuBaslat(kosuId: string, o: { tarif?: Tarif; ebeveyn?: [string, number] | null } = {}): Promise<KosuKaydi> {
    const tarif = o.tarif ?? (await this.cekirdek.tarifAl(kosuId));
    const anahtar = await this.cekirdek.uyumlulukAnahtari();
    return this.depo.kosuOlustur({
      kosuId,
      tarif,
      modelAnahtari: anahtar,
      ebeveyn: o.ebeveyn ?? null,
      kaynak: "yerel",
      yayimlanan: 0,
      gunlukSira: 0,
      sonGoruntu: null,
      goruntuDurdu: null,
      sonDisaAktarim: 0,
      sonHatirlatma: 0,
    });
  }

  /** `week` olayi: paketi hafta anahtariyla yazar, 52 hf hatirlatmasini degerlendirir. */
  async haftaOlayi(kosuId: string, paket: HaftaPaketi): Promise<void> {
    return this.haftalarOlayi(kosuId, [paket]);
  }

  async haftalarOlayi(kosuId: string, paketler: readonly HaftaPaketi[]): Promise<void> {
    const s = await this.kotaylaYaz(kosuId, () => this.depo.haftalarYaz(kosuId, paketler));
    if (s.hatirlatma) this.hatirlatma?.({ kosuId, hafta: s.yayimlanan });
  }

  /** Yazim kota dolu hatasi verirse en eski kosunun goruntuleri silinip bir kez yinelenir (gunluk ve paketler asla silinmez). */
  private async kotaylaYaz<T>(kosuId: string, yaz: () => Promise<T>): Promise<T> {
    try {
      return await yaz();
    } catch (e) {
      if (kotaDoluHatasi(e) && this.kota && (await this.kota.enEskiBosalt(kosuId))) return yaz();
      throw e;
    }
  }

  /**
   * Reddedilen/sapan (`durdu`) bir kosu icin yazim kilitlenir: koşu ya silinir, ya tariften oynatilir, ya da `gunlukKes` ile
   * kayitli gunluk cekirdegin kabul ettigi son siraya kesilir. Aksi halde yeni kararlar eski sira numaralariyla cakisir ve kaybolur.
   */
  kilitle(kosuId: string): void {
    this.kilitli.add(kosuId);
  }

  kilitliMi(kosuId: string): boolean {
    return this.kilitli.has(kosuId);
  }

  /** `sira` SONRASI girisleri siler, sayaci geri ceker ve kilidi acar. Cagiran `sira`yi cekirdegin `gunluk_sira`sindan (reddedilen giris - 1) verir. */
  async gunlukKes(kosuId: string, sira: number): Promise<number> {
    const n = await this.sirala(kosuId, () => this.depo.gunlukKes(kosuId, sira));
    this.kilitli.delete(kosuId);
    return n;
  }

  /** Silinen/yeniden kurulan kosunun kilidi ve oturum durdurmasi kalkar. */
  kilidiBirak(kosuId: string): void {
    this.kilitli.delete(kosuId);
    this.oturumDurdu.delete(kosuId);
  }

  /** `gunluk_al(kosu, sonra)` girislerini idempotent yazar. `sonra` verilmezse depodaki son sira kullanilir. */
  gunlukSenkronla(kosuId: string, sonra?: number): Promise<{ eklenen: number; cakisan: number[] }> {
    return this.sirala(kosuId, () => this.gunlukIc(kosuId, sonra));
  }

  private async gunlukIc(kosuId: string, sonra?: number): Promise<{ eklenen: number; cakisan: number[] }> {
    if (this.kilitli.has(kosuId)) return { eklenen: 0, cakisan: [] };
    const k = await this.depo.kosuOku(kosuId);
    if (!k) return { eklenen: 0, cakisan: [] };
    const girisler: GunlukGirisi[] = await this.cekirdek.gunlukAl(kosuId, sonra ?? k.gunlukSira);
    const s = await this.kotaylaYaz(kosuId, () => this.depo.gunlukYaz(kosuId, girisler));
    if (s.cakisan.length > 0) await this.depo.taniYaz({ tur: "gunluk_cakisma", kosuId, ayrinti: { sira: s.cakisan.slice(0, 20), adet: s.cakisan.length } });
    return s;
  }

  /** Her tick sonrasi: gunluk, sonra (kadans doldu ve durdurulmadiysa) goruntu. */
  tick(kosuId: string): Promise<TickSonucu> {
    return this.sirala(kosuId, async () => {
      const gunluk = await this.gunlukIc(kosuId);
      const k = await this.depo.kosuOku(kosuId);
      if (!k) return { gunluk, goruntu: { durum: "gerekmiyor" } };
      if (this.kilitli.has(kosuId)) return { gunluk, goruntu: { durum: "kilitli" } };
      if (this.oturumDurdu.has(kosuId)) return { gunluk, goruntu: { durum: "durdu", tur: "ardisik_hata" } };
      if (k.goruntuDurdu) return { gunluk, goruntu: { durum: "durdu", tur: k.goruntuDurdu.tur } };
      if (!(await this.cekirdek.goruntuGerekli(kosuId))) return { gunluk, goruntu: { durum: "gerekmiyor" } };
      return { gunluk, goruntu: await this.goruntuIc(kosuId, k) };
    });
  }

  /** Kadansa bakmadan goruntu alir (ornegin dal sonrasi). Durdurulmus kosuda calismaz. */
  goruntuAl(kosuId: string): Promise<GoruntuDurumu> {
    return this.sirala(kosuId, async () => {
      const k = await this.depo.kosuOku(kosuId);
      if (!k) return { durum: "gerekmiyor" };
      if (this.kilitli.has(kosuId)) return { durum: "kilitli" };
      if (k.goruntuDurdu) return { durum: "durdu", tur: k.goruntuDurdu.tur };
      return this.goruntuIc(kosuId, k);
    });
  }

  /** Durdurulmus goruntu denemesini yeniden acar (ornegin yeni model surumune gecildikten sonra). */
  async goruntuDenemesiniAc(kosuId: string): Promise<void> {
    await this.depo.kosuGuncelle(kosuId, (k) => (k.goruntuDurdu ? { ...k, goruntuDurdu: null } : null));
    this.ardisik.delete(kosuId);
    this.oturumDurdu.delete(kosuId);
  }

  private async goruntuIc(kosuId: string, k: KosuKaydi): Promise<GoruntuDurumu> {
    const parcalar: ArrayBuffer[] = [];
    let s;
    try {
      s = await this.cekirdek.goruntuAl(kosuId, (u) => {
        parcalar.push(kopya(u));
      });
    } catch (e) {
      parcalar.length = 0; // yarim parcalar atilir: hicbir sey yazilmaz
      const tur = hataTuru(e);
      if (gecici(e)) return { durum: "hazir_degil" };
      if (kaliciDumpHatasi(e)) {
        await this.depo.taniYaz({ tur: "goruntu_kalici_hata", kosuId, ayrinti: { hata: tur, hafta: k.yayimlanan, model_sha256: k.modelAnahtari.model_sha256, fark: hataFark(e) } });
        await this.depo.kosuGuncelle(kosuId, (x) => ({ ...x, goruntuDurdu: { tur, hafta: x.yayimlanan, zaman: this.zaman() } }));
        return { durum: "durdu", tur };
      }
      const n = (this.ardisik.get(kosuId) ?? 0) + 1;
      this.ardisik.set(kosuId, n);
      await this.depo.taniYaz({ tur: "goruntu_bilinmeyen_hata", kosuId, ayrinti: { hata: tur, hafta: k.yayimlanan, ardisik: n, mesaj: hataMesaji(e).slice(0, 200) } });
      if (n >= this.azamiHata) this.oturumDurdu.add(kosuId); // yalniz bu oturum; kalici durdurma yalniz TaninmayanReferans/TaninmayanLambda
      return { durum: "hata", tur };
    }

    // Sozlesme denetimi: bozuk ya da tutarsiz sonuc yazilmaz (onceki goruntu korunur).
    const { yonetici, ...ozet } = s;
    const hatalar = [...semaHatalari(TEL_SEMA.goruntu_al, ozet), ...semaHatalari(TEL_SEMA.yonetici, yonetici)];
    const tutarsiz =
      hatalar.length > 0 ||
      s.parca !== parcalar.length ||
      s.goruntu_kimligi !== s.yonetici.goruntu_kimligi ||
      s.gunluk_sira !== s.yonetici.gunluk_sira;
    if (tutarsiz) {
      await this.depo.taniYaz({ tur: "goruntu_tutarsiz", kosuId, ayrinti: { hatalar: hatalar.slice(0, 10), beklenenParca: s.parca, gelenParca: parcalar.length } });
      return { durum: "tutarsiz" };
    }

    // Gunluk delik birakmasin: goruntunun gunluk_sira'sina kadar tum girisler depoda olmadan isaretci cevrilmez.
    let guncel = await this.depo.kosuOku(kosuId);
    if (guncel && guncel.gunlukSira < s.gunluk_sira) {
      await this.gunlukIc(kosuId);
      guncel = await this.depo.kosuOku(kosuId);
    }
    if (!guncel || guncel.gunlukSira < s.gunluk_sira) {
      await this.depo.taniYaz({ tur: "goruntu_gunluk_eksik", kosuId, ayrinti: { goruntuGunlukSira: s.gunluk_sira, depodaki: guncel?.gunlukSira ?? null } });
      return { durum: "tutarsiz" };
    }

    const ust: GoruntuUstverisi = {
      kosuId,
      goruntuKimligi: s.goruntu_kimligi,
      zaman: this.zaman(),
      hafta: s.hafta,
      yayimlanan: s.yayimlanan,
      ham: s.ham,
      sikisik: s.sikisik,
      parca: s.parca,
      anahtar: s.anahtar,
      gunlukSira: s.gunluk_sira,
      yonetici: s.yonetici,
    };
    try {
      await this.depo.goruntuYaz(ust, parcalar);
    } catch (e) {
      if (kotaDoluHatasi(e) && this.kota) {
        const b = await this.kota.enEskiBosalt(kosuId);
        if (b) {
          try {
            await this.depo.goruntuYaz(ust, parcalar);
            return this.yazildi(kosuId, ust);
          } catch (e2) {
            e = e2;
          }
        }
      }
      await this.depo.taniYaz({ tur: "goruntu_yazim_hatasi", kosuId, ayrinti: { hata: kotaDoluHatasi(e) ? "QuotaExceededError" : hataTuru(e), hafta: s.yayimlanan } });
      return { durum: "yazim_hatasi", tur: kotaDoluHatasi(e) ? "kota" : hataTuru(e) };
    }
    return this.yazildi(kosuId, ust);
  }

  private async yazildi(kosuId: string, u: GoruntuUstverisi): Promise<GoruntuDurumu> {
    this.ardisik.delete(kosuId);
    if (this.kota) await this.kota.denetle(kosuId);
    return { durum: "yazildi", kimlik: u.goruntuKimligi, hafta: u.hafta, yayimlanan: u.yayimlanan, parca: u.parca, ham: u.ham, sikisik: u.sikisik };
  }
}
