/**
 * Kaydi disa/ice aktarma (B4a `guvenlik`, BAGLAYICI): dosyada goruntu (pickle) ASLA yoktur.
 *
 * Dosya (`DisaAktarimDosyasi`, surum 1): `{bicim, surum, olusturma, modelAnahtari, kosu: {tarif, ebeveyn, yayimlanan}, gunluk, paketler?}`.
 * Ice aktarma yalniz tarif + gunluk (+ gorsellestirme icin istege bagli paketler) kabul eder; bilinen goruntu anahtarlari (`goruntu`, `goruntuler`,
 * `parcalar`, `yonetici`, ...) dosyanin yapisal duzeylerinde gorulurse dosya reddedilir. Kabul edilen veri sema ile dogrulanip YENIDEN kurulur
 * (bilinen alanlarin kopyasi); cekirdege yalniz `tariftenOynat` ile verilir.
 */
import type { KayitCekirdegi } from "./cekirdek";
import { DepoHatasi, KayitDeposu, type KosuKaydi } from "./depo";
import { semaHatalari } from "./sema";
import { TEL_SEMA, type GunlukGirisi, type HaftaPaketi, type ModelAnahtari, type Tarif } from "./tel";
import { DevamAkisi, type AkisSonucu, type DevamSecenegi } from "./akis";
import type { KosuYazici } from "./yazici";

export const DOSYA_BICIMI = "daoliberal-kayit";
export const DOSYA_SURUMU = 1;
export const AZAMI_DOSYA_KARAKTERI = 64 * 1024 * 1024;
export const AZAMI_HAFTA = 2000;
export const AZAMI_GUNLUK = 200000;
export const AZAMI_PAKET = 3000;
const AZAMI_DERINLIK = 64;

/** Dosyanin yapisal duzeylerinde (kok, `kosu`, tarif ust duzeyi, gunluk/paket girisleri) bulunmamasi gereken anahtarlar (goruntu/pickle tasiyicilari). */
export const YASAK_ANAHTARLAR = ["goruntu", "goruntuler", "parcalar", "yonetici", "pickle", "snapshot"] as const;

export interface DisaAktarimDosyasi {
  bicim: typeof DOSYA_BICIMI;
  surum: typeof DOSYA_SURUMU;
  olusturma: number;
  modelAnahtari: ModelAnahtari;
  kosu: { tarif: Tarif; ebeveyn: [string, number] | null; yayimlanan: number };
  gunluk: GunlukGirisi[];
  paketler?: HaftaPaketi[];
}

export class IceAktarmaHatasi extends Error {
  readonly kod: string;
  readonly yol: string | null;
  constructor(kod: string, yol?: string | null) {
    super(kod);
    this.name = "IceAktarmaHatasi";
    this.kod = kod;
    this.yol = yol ?? null;
  }
}

/** Kosunun disa aktarma dosyasi (goruntu yok). `paketler: true` gorsellestirme icin hafta paketlerini de koyar. Disa aktarma hatirlatma sayacini sifirlar. */
export async function disaAktar(depo: KayitDeposu, kosuId: string, o: { paketler?: boolean; zaman?: () => number } = {}): Promise<DisaAktarimDosyasi> {
  const k = await depo.kosuOku(kosuId);
  if (!k) throw new IceAktarmaHatasi("kosu_yok");
  const gunluk = await depo.gunlukOku(kosuId, 0);
  const dosya: DisaAktarimDosyasi = {
    bicim: DOSYA_BICIMI,
    surum: DOSYA_SURUMU,
    olusturma: (o.zaman ?? Date.now)(),
    modelAnahtari: k.modelAnahtari,
    kosu: { tarif: k.tarif, ebeveyn: k.ebeveyn, yayimlanan: k.yayimlanan },
    gunluk,
  };
  if (o.paketler) dosya.paketler = await depo.paketAraligi(kosuId, 0, Number.MAX_SAFE_INTEGER);
  await depo.kosuGuncelle(kosuId, (x) => ({ ...x, sonDisaAktarim: x.yayimlanan, sonHatirlatma: x.yayimlanan }));
  return dosya;
}

export function dosyaMetni(d: DisaAktarimDosyasi): string {
  return JSON.stringify(d);
}

/** `__proto__`, asiri derinlik ve sonlu olmayan sayi taramasi (her duzey). Ilk sorunlu yolu dondurur. */
function tara(x: unknown, yol: string, derinlik: number): { kod: string; yol: string } | null {
  if (derinlik > AZAMI_DERINLIK) return { kod: "cok_derin", yol };
  if (typeof x === "number") return Number.isFinite(x) ? null : { kod: "sayi_gecersiz", yol };
  if (typeof x !== "object" || x === null) return null;
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) {
      const s = tara(x[i], yol + "[" + i + "]", derinlik + 1);
      if (s) return s;
    }
    return null;
  }
  for (const a of Object.keys(x)) {
    if (a === "__proto__") return { kod: "anahtar_yasak", yol: yol + "." + a };
    const s = tara((x as Record<string, unknown>)[a], yol + "." + a, derinlik + 1);
    if (s) return s;
  }
  return null;
}

/** Goruntu tasiyicisi anahtarlar yapisal duzeylerde aranir (icerik alanlari: config, takvim, karar, yama, paket govdesi taranmaz: onlar JSON verisi olarak kopyalanir). */
function yapisalYasak(d: Record<string, unknown>): void {
  const bak = (o: unknown, yol: string) => {
    if (typeof o !== "object" || o === null || Array.isArray(o)) return;
    for (const a of Object.keys(o)) if ((YASAK_ANAHTARLAR as readonly string[]).includes(a)) throw new IceAktarmaHatasi("goruntu_iceriyor", yol + "." + a);
  };
  bak(d, "$");
  const kosu = d.kosu as Record<string, unknown> | undefined;
  bak(kosu, "$.kosu");
  bak(kosu?.tarif, "$.kosu.tarif");
  if (Array.isArray(d.gunluk)) d.gunluk.forEach((g: unknown, i: number) => bak(g, "$.gunluk[" + i + "]"));
  if (Array.isArray(d.paketler)) d.paketler.forEach((p: unknown, i: number) => bak(p, "$.paketler[" + i + "]"));
}

function kopyala<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function tamsayi(x: unknown, en: number, fazla: number): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= en && x <= fazla;
}

/**
 * Metni (ya da cozulmus nesneyi) dogrular ve temiz bir kopya dondurur. Uygun degilse `IceAktarmaHatasi`. Goruntu iceren dosya REDDEDILIR.
 * Tarif/gunluk: tel_b4 semasi (fazla anahtar yok sayilir ve kopyaya alinmaz); gunluk `sira` 1..n bitisik, `tur` karar|sart.
 */
export function dosyayiDogrula(girdi: string | unknown): DisaAktarimDosyasi {
  let ham: unknown = girdi;
  if (typeof girdi === "string") {
    if (girdi.length > AZAMI_DOSYA_KARAKTERI) throw new IceAktarmaHatasi("cok_buyuk");
    try {
      ham = JSON.parse(girdi);
    } catch {
      throw new IceAktarmaHatasi("json_gecersiz");
    }
  }
  const sorun = tara(ham, "$", 0);
  if (sorun) throw new IceAktarmaHatasi(sorun.kod, sorun.yol);
  if (typeof ham !== "object" || ham === null || Array.isArray(ham)) throw new IceAktarmaHatasi("bicim_gecersiz");
  const d = ham as Record<string, unknown>;
  yapisalYasak(d);
  if (d.bicim !== DOSYA_BICIMI) throw new IceAktarmaHatasi("bicim_gecersiz", "$.bicim");
  if (d.surum !== DOSYA_SURUMU) throw new IceAktarmaHatasi("surum_desteklenmiyor", "$.surum");
  if (typeof d.olusturma !== "number" || !Number.isFinite(d.olusturma)) throw new IceAktarmaHatasi("sema", "$.olusturma");
  const ah = semaHatalari(TEL_SEMA.anahtar, d.modelAnahtari);
  if (ah.length) throw new IceAktarmaHatasi("sema", "$.modelAnahtari" + ah[0]!.slice(1));

  const kosu = d.kosu as Record<string, unknown> | undefined;
  if (typeof kosu !== "object" || kosu === null || Array.isArray(kosu)) throw new IceAktarmaHatasi("sema", "$.kosu");
  const th = semaHatalari(TEL_SEMA.tarif, kosu.tarif, { siki: false });
  if (th.length) throw new IceAktarmaHatasi("sema", "$.kosu.tarif" + th[0]!.slice(1));
  if (!tamsayi(kosu.yayimlanan, 0, AZAMI_HAFTA)) throw new IceAktarmaHatasi("sema", "$.kosu.yayimlanan");
  let ebeveyn: [string, number] | null = null;
  if (kosu.ebeveyn !== null && kosu.ebeveyn !== undefined) {
    const e = kosu.ebeveyn;
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string" || !tamsayi(e[1], 0, AZAMI_HAFTA)) throw new IceAktarmaHatasi("sema", "$.kosu.ebeveyn");
    ebeveyn = [e[0], e[1]];
  }
  const t = kosu.tarif as Record<string, unknown>;
  const tarif: Tarif = kopyala({ config: t.config as Tarif["config"], takvim: t.takvim as Tarif["takvim"], parent_id: t.parent_id as string | null, fork_week: t.fork_week as number | null, dunya_kodu: t.dunya_kodu as string | null, oyuncu: t.oyuncu as string | null });

  if (!Array.isArray(d.gunluk)) throw new IceAktarmaHatasi("sema", "$.gunluk");
  if (d.gunluk.length > AZAMI_GUNLUK) throw new IceAktarmaHatasi("cok_buyuk", "$.gunluk");
  const gunluk: GunlukGirisi[] = [];
  d.gunluk.forEach((g: unknown, i: number) => {
    const yol = "$.gunluk[" + i + "]";
    const tur = typeof g === "object" && g !== null ? (g as Record<string, unknown>).tur : undefined;
    if (tur !== "karar" && tur !== "sart") throw new IceAktarmaHatasi("sema", yol + ".tur");
    const h = semaHatalari(tur === "karar" ? TEL_SEMA.gunluk.karar : TEL_SEMA.gunluk.sart, g, { siki: false });
    if (h.length) throw new IceAktarmaHatasi("sema", yol + h[0]!.slice(1));
    const o = g as Record<string, unknown>;
    if (o.sira !== i + 1) throw new IceAktarmaHatasi("gunluk_sira_bitisik_degil", yol + ".sira");
    if (!tamsayi(o.dikis, 0, AZAMI_HAFTA)) throw new IceAktarmaHatasi("sema", yol + ".dikis");
    gunluk.push(
      tur === "karar"
        ? kopyala({ sira: o.sira as number, tur: "karar" as const, dikis: o.dikis, karar: o.karar as Record<string, unknown> })
        : kopyala({ sira: o.sira as number, tur: "sart" as const, dikis: o.dikis, yama: o.yama as Record<string, unknown>, not: o.not as string | null, surum: o.surum as number }),
    );
  });

  const sonuc: DisaAktarimDosyasi = { bicim: DOSYA_BICIMI, surum: DOSYA_SURUMU, olusturma: d.olusturma, modelAnahtari: kopyala(d.modelAnahtari as ModelAnahtari), kosu: { tarif, ebeveyn, yayimlanan: kosu.yayimlanan }, gunluk };
  if (d.paketler !== undefined) {
    if (!Array.isArray(d.paketler) || d.paketler.length > AZAMI_PAKET) throw new IceAktarmaHatasi("sema", "$.paketler");
    sonuc.paketler = d.paketler.map((p: unknown, i: number) => {
      const o = p as Record<string, unknown> | null;
      if (typeof o !== "object" || o === null || Array.isArray(o) || !tamsayi(o.week, 0, AZAMI_HAFTA)) throw new IceAktarmaHatasi("paket_gecersiz", "$.paketler[" + i + "]");
      return kopyala(o) as HaftaPaketi;
    });
  }
  return sonuc;
}

export interface IceAktarimSonucu {
  kosuId: string;
  kayit: KosuKaydi;
  /** Dosyadaki hedef hafta (`kosu.yayimlanan`): oynatma icin onerilen. */
  hedef: number;
  paketSayisi: number;
}

/**
 * Dogrulanmis dosyayi YENI bir kosu olarak TEK islemde depoya yazar (goruntu yok; kaynak `ice_aktarma`). Cekirdege dokunmaz.
 * `kimlikUret` var olan bir kimlik verirse yenisi denenir (en cok 5); var olan kosuyla birlesme yoktur.
 * Dosya boyutu on denetimi (`File.size` <= AZAMI_DOSYA_KARAKTERI) metin okunmadan once arayuzun (B8) isidir.
 * Paketler yalniz depoya (goruntuleme) yazilir, cekirdege hicbir zaman verilmez.
 */
export async function iceAktar(depo: KayitDeposu, girdi: string | unknown, o: { kimlikUret: () => string }): Promise<IceAktarimSonucu> {
  const d = dosyayiDogrula(girdi);
  let kayit: KosuKaydi | null = null;
  for (let deneme = 0; deneme < 5 && !kayit; deneme++) {
    const kosuId = o.kimlikUret();
    try {
      kayit = await depo.iceAktarimYaz(
        { kosuId, tarif: d.kosu.tarif, modelAnahtari: d.modelAnahtari, ebeveyn: d.kosu.ebeveyn, kaynak: "ice_aktarma", yayimlanan: 0, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 },
        d.gunluk,
        d.paketler ?? [],
        d.kosu.yayimlanan,
      );
    } catch (e) {
      if (!(e instanceof DepoHatasi) || e.kod !== "kosu_var") throw e; // kimlik cakismasi: yeni kimlik denenir
    }
  }
  if (!kayit) throw new IceAktarmaHatasi("kimlik_uretilemedi");
  return { kosuId: kayit.kosuId, kayit, hedef: d.kosu.yayimlanan, paketSayisi: d.paketler?.length ?? 0 };
}

/** Ice aktar + `tariften_oynat` (surum uyumsuz olsa da calisir; goruntu yoktur). */
export async function iceAktarVeOynat(
  o: { depo: KayitDeposu; cekirdek: KayitCekirdegi; yazici?: KosuYazici | null; kimlikUret: () => string },
  girdi: string | unknown,
  s: DevamSecenegi = {},
): Promise<{ ice: IceAktarimSonucu; akis: AkisSonucu }> {
  const ice = await iceAktar(o.depo, girdi, { kimlikUret: o.kimlikUret });
  const akis = new DevamAkisi({ depo: o.depo, cekirdek: o.cekirdek, yazici: o.yazici });
  return { ice, akis: await akis.tariftenBastan(ice.kosuId, { hedef: ice.hedef, ...s }) };
}
