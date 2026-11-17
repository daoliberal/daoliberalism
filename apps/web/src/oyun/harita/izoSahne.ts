import type { Balon } from "./izoOlay";
import { IZO_STILI } from "./haritaStili";
import type { Gecis, GorselDurum } from "./izoDurum";
import { BLOK_SATIR, BLOK_SUTUN, derinlik, hucredenEkrana, parselDikdortgeni, parselHucresi, type Hucre } from "./izometri";
import { izoZeminKur, type IzoZemin, type Yon } from "./izoZemin";
import { dominoYuvalari, meydanDeligi, sokakAgi, yuvaAta } from "./sokakAgi";
import { tekilSprite, turSprite, zeminSprite, type SpriteKaydi, type SpriteManifesti } from "./spriteManifest";
import type { BinaTuru, HaritaRef, SahneBina, SehirSahnesi } from "./tipler";
import { fnv1a } from "./yerlesim";

/**
 * İzometrik sahne yerleşimi (saf veri, çizim Görev 9'da). `izo: true` ile kurulmuş `SehirSahnesi`'ni hücrelere oturtur:
 * işletmeler domino yuvalarına (ana parsel + r+1 genişleme parseli), loncalar plaza (meydan deliği) hücrelerine, belediye ve ahır
 * çerçeveye (şerit kenarına denk gelmeden). Koordinatlar sürekli parsel birimidir; `ekran` alanları `hucredenEkrana` uzayındadır
 * (dünya piksel konumu = ekran + `kaydirma`).
 */

export type IzoBina = {
  id: string;
  ref: HaritaRef;
  tur: BinaTuru;
  /** Görsel boy (histerezisli `gorselBoy` sonucu). Belediye, ahır ve lonca 1. */
  boy: 1 | 2 | 3 | 4;
  sprite: SpriteKaydi;
  /** Ana parselin (ya da özel binanın) hücre MERKEZİ. */
  hucre: Hucre;
  /** Yalnız sprite iki parsellik (boy 4) ise genişleme parselinin hücre merkezi; yoksa null. */
  hucre2: Hucre | null;
  /** `hucredenEkrana(hucre)`: boydan bağımsız (boy değişince bina yerinde kalır). */
  ekran: { x: number; y: number };
  /** Sprite ankraj pikselinin oturacağı nokta (ekran uzayı): tüm ayak izinin alt köşesi; iki parselde genişleme parselinin altı. */
  ankraj: { x: number; y: number };
  /** Çizim sırası (artan = öne): işletmede domino'nun ön hücresi (boydan bağımsız), özel binada kendi hücresi. */
  z: number;
  /** Harita satırı `kapali`: işletme parselini 10 hafta tutar; çizici tahtalı bindirmesi koyar. */
  kapali: boolean;
  /** Çizimdeki görsel durum (`gorselDurum`: kuruluyor/canlandı dahil); durum haritası verilmediyse harita durumu. Yalnız işletmede anlamlı, diğerleri `uretim`. */
  durum: GorselDurum;
  sahne: SahneBina;
};

export type DolguTuru = "konut" | "arsa" | "park";
export type GenislemeTuru = "cimen" | "arsa" | "otopark";
/**
 * Görev 9 notları:
 * - `binalar`, `genislemeler[].z` ve `dolgu[].z` aynı `derinlik` uzayındadır; bina-benzeri sprite'lar (konut, cimen/otopark arsası) binalarla tek
 *   listede z artan sıralanıp iç içe çizilir. Zemin karosu olanlar (`sprite.grup === "zemin"`: park, arsa) zemin katmanında döşenir.
 *   Genişleme arsasının z'si bina z'sinden azıcık küçüktür (bina kendi arsasının üstünde). EŞİT z'de kimlik (id) sırası uygulanır.
 * - Çizici iki parsellik çizimi `boy`'a değil `sprite.parselSayisi` / `hucre2`'ye bakarak yapar (boy 4 ama sprite tek parselse hucre2 null'dır).
 * - Lonca `SahneBina.x/y` izo'da anlamsızdır (klasik meydan halkası); konum için `IzoBina.hucre` kullanılır.
 */
export type IzoSahne = {
  /** Klasik sahne: katman, bosParseller, ilanVeren, meydan, sehirBinasi, ahir, ben buradan okunur. */
  kaynak: SehirSahnesi;
  zemin: IzoZemin;
  /** Tüm binalar (işletme, lonca, belediye `sehir`, ahır), `z` artan sırada (arkadan öne). */
  binalar: readonly IzoBina[];
  /** Genişleme parseli boşken (görsel boy 4 değil) o parselin dolgusu. `arsa` zemin karosudur: çizici parseli döşer. */
  genislemeler: readonly { binaId: string; hucre: Hucre; tur: GenislemeTuru; sprite: SpriteKaydi | null; z: number }[];
  /** "İşletme kur" hedefleri: iki hücresi de boş domino (`kaynak.bosParseller` ile aynı küme). */
  bosHucreler: readonly { parselId: string; hucre: Hucre; hucre2: Hucre; ekran: { x: number; y: number } }[];
  /**
   * Boş her parsel için tam bir dolgu (K4/K6: gri levha yok). İşletmeli bloktaki boş parsel `arsa` (çimenli boş arsa); işletmesiz blokta
   * ~%70 `konut` (ev/apartman varyantı), kalanı `park` (ağaçlı çim). Kur hedefi olan parseller de buradadır (kurulunca dolgu kalkar).
   * `sprite.grup === "zemin"` ise karodur: çizici parseli döşer; değilse bina gibi parselin alt köşesine oturur.
   */
  dolgu: readonly { parselId: string; hucre: Hucre; tur: DolguTuru; sprite: SpriteKaydi | null; z: number }[];
  /** Meydan deliğine düşen yarım dominoların tek kalan parselleri: hedef değil, işletme almaz (yalnız zemin). */
  artanParseller: readonly { parselId: string; hucre: Hucre }[];
  /** Plaza: merkez kavşak ve meydan deliğindeki tüm tam hücreler (loncalar bunlardan birine oturur). */
  plaza: { hucre: Hucre; hucreler: readonly Hucre[] };
  /** Sprite piksel -> ekran ölçeği (`karo.genislik / parselKaro.genislik`). */
  olcek: number;
  dunya: { genislik: number; yukseklik: number };
  kaydirma: { x: number; y: number };
  /** Son güncellemenin yeni geçişleri (`id:hafta:tur` kimliğiyle bir kez oynar); çizici tüketir, sahne yerleşimini etkilemez. */
  gecisler: readonly Gecis[];
  /** Hafta geçişi olay balonları (`balonlar`); çizici her kimliği bir kez gösterir, yerleşimi etkilemez. */
  balonlar: readonly Balon[];
};

/** `izoSahneKur`'a isteğe bağlı çizim girdileri: görsel durum haritası (id -> durum) ve yeni geçişler. */
export type IzoSahneEk = { durumlar?: ReadonlyMap<string, GorselDurum>; gecisler?: readonly Gecis[]; balonlar?: readonly Balon[] };

/**
 * Tür-özel sprite kuralı: kendine özel tekil (boy'suz) sprite'ı olan türler (tarla, maden, santral, değirmen, liman...) boy 1-3'te o sprite'ı,
 * boy 4'te grup merdiveninin boy 4 kompozitini alır; diğerleri `turSprite` merdivenine girer (bilinmeyen tür: hizmet grubu, o da yoksa genel).
 */
export function binaSpriteSec(m: SpriteManifesti, tur: string, boy: 1 | 2 | 3 | 4, kimlik: string): SpriteKaydi {
  if (boy < 4) {
    const t = tekilSprite(m, tur, kimlik);
    if (t) return t;
  }
  return turSprite(m, tur, boy, kimlik);
}

/** Etkin sahneden klasik `SehirSahnesi` görünümü: panel, lejant, ben, ilan, seçim ve kur hedefi bunu okur. */
export function etkinSehirSahnesi(s: SehirSahnesi | IzoSahne): SehirSahnesi {
  return "kaynak" in s ? s.kaynak : s;
}

/** Kur hedefi parselin türü: izometrik sahnede dolgu (konut, park, boş arsa); klasikte (ya da dolgusu olmayan parselde) gerçekten boş. */
export type ParselTuru = "bos" | DolguTuru;
export function parselTuruOf(s: SehirSahnesi | IzoSahne, parselId: string): ParselTuru {
  return "kaynak" in s ? (s.dolgu?.find((d) => d.parselId === parselId)?.tur ?? "bos") : "bos";
}

const hata = (neden: string): Error => new Error(`izoSahne:${neden}`);
const GENISLEME_TURLERI: readonly GenislemeTuru[] = ["cimen", "arsa", "otopark"];
/** Belediye kuzeyi, ahır güneyi sever; şeritliyse en yakın şeritsiz kenara geçer (iki liste birbirinin tersidir: tek şeritsiz kenar çiftine düşmez). */
const BELEDIYE_SIRASI: readonly Yon[] = ["kuzey", "dogu", "bati", "guney"];
const AHIR_SIRASI: readonly Yon[] = ["guney", "bati", "dogu", "kuzey"];

/**
 * Şehir kurumları (Liman, İhracat) nehir şeridinin kıyısına en yakın çerçeve kenarında durur: nehir kenarının kendisi (şerit dış bandı örter) ve park
 * kenarı kullanılamaz; nehre komşu serbest kenar `nehir - 1`'dir. `d`: o kenarda nehre doğru yön (artan c/r için 1).
 */
const NEHRE_KOMSU: Readonly<Record<Yon, { kenar: Yon; d: 1 | -1 }>> = { kuzey: { kenar: "bati", d: -1 }, dogu: { kenar: "kuzey", d: 1 }, guney: { kenar: "dogu", d: 1 }, bati: { kenar: "guney", d: -1 } };
const KARSI: Readonly<Record<Yon, Yon>> = { kuzey: "guney", guney: "kuzey", dogu: "bati", bati: "dogu" };
const KURUM_ADIM_EN_FAZLA = 4;

/**
 * Liman ve İhracat yerleri (çerçeve bandı, kapıdan `k` hücre kayık). Aday sırası: nehre komşu kenarda kapıdan nehre doğru (1, 2, ...), sonra ters yönde; sığmazsa (kısa kenar)
 * nehrin karşı kenarında kapıya en yakından. Aday geçerli: yol ağının köşelerinden uzak (kapsam boyunca aralık), belediye/ahır/önceki kurumla çakışmaz.
 * Şerit, yol ve kapıdan uzaktır (bant dış kenara değil kapsama bitişik; şeritler dış bandın dışındadır). İlk geçerli aday Liman, ikincisi İhracat; yer bulunamayan kurum null döner (atmaz).
 */
/** Kurum yeri bulunamayan şehirler: uyarı şehir başına bir kez basılır (sahne her hafta yeniden kurulur). */
const KURUM_UYARILDI = new Set<number>();
export function kurumYerleri(z: IzoZemin, dolu: readonly Hucre[], sehir = -1): { liman: Hucre | null; ihracat: Hucre | null } {
  const nehir = z.seritler.find((s) => s.tur === "nehir")?.yon ?? "kuzey";
  const { kapsam } = z;
  const ortaC = (kapsam.c0 + kapsam.c1) / 2;
  const ortaR = (kapsam.r0 + kapsam.r1) / 2;
  const yer = (kenar: Yon, k: number): Hucre | null => {
    const kapi = z.kapilar.find((x) => x.yon === kenar)?.hucre ?? { c: ortaC, r: ortaR };
    const yatay = kenar === "kuzey" || kenar === "guney";
    const boyunca = (yatay ? kapi.c : kapi.r) + k;
    const [lo, hi] = yatay ? [kapsam.c0, kapsam.c1] : [kapsam.r0, kapsam.r1];
    if (boyunca < lo + 0.5 - 1e-9 || boyunca > hi - 0.5 + 1e-9) return null;
    return kenar === "kuzey" ? { c: boyunca, r: kapsam.r0 - 0.5 } : kenar === "guney" ? { c: boyunca, r: kapsam.r1 + 0.5 } : kenar === "dogu" ? { c: kapsam.c1 + 0.5, r: boyunca } : { c: kapsam.c0 - 0.5, r: boyunca };
  };
  const { kenar, d } = NEHRE_KOMSU[nehir];
  const adaylar: (Hucre | null)[] = [];
  for (let k = 1; k <= KURUM_ADIM_EN_FAZLA; k++) adaylar.push(yer(kenar, d * k));
  for (let k = 1; k <= KURUM_ADIM_EN_FAZLA; k++) adaylar.push(yer(kenar, -d * k));
  const karsi = KARSI[nehir];
  for (let k = 1; k <= KURUM_ADIM_EN_FAZLA; k++) adaylar.push(yer(karsi, k), yer(karsi, -k));
  const secilen: Hucre[] = [];
  const kullanilan = [...dolu];
  for (const h of adaylar) {
    if (h === null || kullanilan.some((o) => Math.abs(o.c - h.c) < 1 - 1e-9 && Math.abs(o.r - h.r) < 1 - 1e-9)) continue;
    secilen.push(h);
    kullanilan.push(h);
    if (secilen.length === 2) break;
  }
  // Yer bulunamazsa (çok kısa kenar) sahne kurulumu atmaz: o kurum çizilmeden devam edilir.
  if (secilen.length < 2 && !KURUM_UYARILDI.has(sehir)) {
    KURUM_UYARILDI.add(sehir);
    console.warn("izoSahne:kurum-yeri", { sehir, yersiz: 2 - secilen.length });
  }
  return { liman: secilen[0] ?? null, ihracat: secilen[1] ?? null };
}

const parseId = (id: string): { dr: number; dc: number } => {
  const k = /^p(-?\d+)_(-?\d+)$/.exec(id);
  if (!k) throw hata("parsel");
  return { dr: Number(k[1]), dc: Number(k[2]) };
};

/**
 * Çerçeve bandında (kapsamın hemen dışı, kalınlık kenarHucre = 1 parsel) bir ayak izi: kapıdan `yan` hücre kayık, şeritsiz ilk kenarda.
 * Şeritler (nehir tohumla seçilen kenarı, park bitişik kenarı) çerçevenin dış bandını tamamen kapladığından şeritli kenar hiç seçilmez.
 */
function cerceveYeri(z: IzoZemin, sira: readonly Yon[], yan: 1 | -1): Hucre {
  const seritli = new Set(z.seritler.map((s) => s.yon));
  const yon = sira.find((y) => !seritli.has(y)) ?? sira[0]!;
  const { kapsam } = z;
  const ortaC = (kapsam.c0 + kapsam.c1) / 2;
  const ortaR = (kapsam.r0 + kapsam.r1) / 2;
  const kapi = z.kapilar.find((k) => k.yon === yon)?.hucre ?? { c: ortaC, r: ortaR };
  if (yon === "kuzey") return { c: kapi.c + yan, r: kapsam.r0 - 0.5 };
  if (yon === "guney") return { c: kapi.c + yan, r: kapsam.r1 + 0.5 };
  if (yon === "dogu") return { c: kapsam.c1 + 0.5, r: kapi.r + yan };
  return { c: kapsam.c0 - 0.5, r: kapi.r + yan };
}

export function izoSahneKur(s: SehirSahnesi, m: SpriteManifesti, tohum: string, gorselBoy: (id: string, hamBoy: 1 | 2 | 3 | 4) => 1 | 2 | 3 | 4, ek: IzoSahneEk = {}): IzoSahne {
  if (s.kademe === undefined) throw hata("izo-degil");
  const zemin = izoZeminKur(s.parseller, m, tohum, s.sehir);
  const ro = zemin.ro;
  const olcek = IZO_STILI.karo.genislik / m.parselKaro.genislik;
  const yarimKaro = IZO_STILI.karo.yukseklik / 2;
  const ag = sokakAgi(s.kademe, s.meydan.yaricap);

  // --- Plaza: meydan deliğindeki tam hücreler; merkez = ana cadde kavşağı ---
  const delikIdleri = meydanDeligi(ag);
  const kavsak: Hucre = {
    c: (parselDikdortgeni("p0_-1", ro).c1 + parselDikdortgeni("p0_0", ro).c0) / 2,
    r: (parselDikdortgeni("p-1_0", ro).r1 + parselDikdortgeni("p0_0", ro).r0) / 2,
  };
  const plazaHucreleri = delikIdleri
    .map((id) => ({ id, hucre: parselHucresi(id, ro) }))
    .map((h) => ({ ...h, uzaklik: Math.hypot(h.hucre.c - kavsak.c, h.hucre.r - kavsak.r) }))
    .sort((a, b) => a.uzaklik - b.uzaklik || (a.id < b.id ? -1 : 1));

  const olustur = (b: SahneBina, boy: 1 | 2 | 3 | 4, hucre: Hucre, hucre2: Hucre | null, sprite: SpriteKaydi, z: number, kapali: boolean, durum: GorselDurum = "uretim"): IzoBina => {
    const son = hucre2 ?? hucre;
    const e = hucredenEkrana(son);
    return { id: b.id, ref: b.ref, tur: b.tur, boy, sprite, hucre, hucre2, ekran: hucredenEkrana(hucre), ankraj: { x: e.x, y: e.y + yarimKaro }, z, kapali, durum, sahne: b };
  };

  const binalar: IzoBina[] = [];

  // --- Loncalar: plaza hücrelerine kimlik tabanlı (iç hücre önce), lonca gelip gidince ötekiler kaymaz ---
  // Kalıcı yerleşimde deliğe sığmayan loncalar bir domino ankrajına (`SahneBina.parsel`) konur; kalanı plaza hücrelerine.
  const tumLoncalar = s.binalar.filter((b) => b.tur === "lonca");
  const parselLoncalar = tumLoncalar.filter((b) => b.parsel !== null);
  const loncalar = tumLoncalar.filter((b) => b.parsel === null);
  for (const l of parselLoncalar) {
    const hucre = parselHucresi(l.parsel!, ro);
    binalar.push(olustur(l, 1, hucre, null, binaSpriteSec(m, "lonca", 1, l.id), derinlik(hucre), false));
  }
  if (loncalar.length > plazaHucreleri.length) throw hata("plaza-yetmez");
  const yuvaNo = yuvaAta(loncalar.map((l) => l.id), plazaHucreleri.map((h) => ({ id: h.id, oncelik: Math.floor(h.uzaklik) })), `plaza|${tohum}|${s.sehir}`);
  const plazaOf = new Map(plazaHucreleri.map((h) => [h.id, h.hucre]));
  for (const l of loncalar) {
    const hucre = plazaOf.get(yuvaNo.get(l.id)!)!;
    binalar.push(olustur(l, 1, hucre, null, binaSpriteSec(m, "lonca", 1, l.id), derinlik(hucre), false));
  }

  // --- İşletmeler: domino (ana + genişleme) ---
  const arsaSprite = zeminSprite(m, "arsa") ?? zeminSprite(m, "cimen");
  const genislemeler: IzoSahne["genislemeler"][number][] = [];
  for (const b of s.binalar) {
    if (b.tur !== "isletme") continue;
    if (b.parsel === null || b.genisleme === undefined) throw hata("izo-degil");
    const hucre = parselHucresi(b.parsel, ro);
    const hucreGenisleme = parselHucresi(b.genisleme, ro);
    const boy = gorselBoy(b.id, b.boyut);
    const sprite = binaSpriteSec(m, b.etiket, boy, b.id);
    const iki = sprite.parselSayisi === 2;
    if (!iki) {
      const tur = GENISLEME_TURLERI[fnv1a(`${tohum}|${b.id}|genisleme`) % GENISLEME_TURLERI.length]!;
      // `arsa` türü dolgudaki arsayla aynı sprite'ı kullanır (tek tutarlı görünüm)
      genislemeler.push({ binaId: b.id, hucre: hucreGenisleme, tur, sprite: tur === "arsa" ? arsaSprite : zeminSprite(m, tur), z: derinlik(hucreGenisleme) - 0.5 });
    }
    binalar.push(olustur(b, boy, hucre, iki ? hucreGenisleme : null, sprite, derinlik(hucreGenisleme), b.durum === "kapali", ek.durumlar?.get(b.id) ?? b.durum ?? "uretim"));
  }

  // --- Belediye ve ahır: çerçevede, şerit/yol/kapıdan uzak ---
  const belediye = cerceveYeri(zemin, BELEDIYE_SIRASI, 1);
  binalar.push(olustur(s.sehirBinasi, 1, belediye, null, binaSpriteSec(m, "belediye", 1, s.sehirBinasi.id), derinlik(belediye), false));
  const ahir = cerceveYeri(zemin, AHIR_SIRASI, -1);
  binalar.push(olustur(s.ahir, 1, ahir, null, binaSpriteSec(m, "ahir", 1, s.ahir.id), derinlik(ahir), false));

  // --- Şehir kurumları: Liman (ithalat) ve İhracat, nehre komşu çerçeve kenarında kapı yanında ---
  const kurum = kurumYerleri(zemin, [belediye, ahir], s.sehir);
  const kurumBina = (tur: "liman" | "ihracat"): SahneBina => ({
    id: tur, tur, sehir: s.sehir, x: 0, y: 0, boyut: 1, ref: { kind: "kurum", ref: tur }, etiket: tur, parsel: null, sablon: "sehir", taban: { g: 1, d: 1 },
  });
  for (const [tur, hucre] of [["liman", kurum.liman], ["ihracat", kurum.ihracat]] as const) {
    if (hucre === null) continue;
    binalar.push(olustur(kurumBina(tur), 1, hucre, null, binaSpriteSec(m, tur, 1, tur), derinlik(hucre), false));
  }

  binalar.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // --- Kur hedefleri ve artan parseller ---
  const bosHucreler = (s.bosParseller ?? []).map((p) => {
    const { dr, dc } = parseId(p.id);
    const hucre = parselHucresi(p.id, ro);
    return { parselId: p.id, hucre, hucre2: parselHucresi(`p${dr + 1}_${dc}`, ro), ekran: hucredenEkrana(hucre) };
  });
  const dominoda = new Set(dominoYuvalari(ag).flatMap((d) => [d.ankraj, d.genisleme]));
  const artanParseller = s.parseller.filter((p) => !dominoda.has(p.id)).map((p) => ({ parselId: p.id, hucre: parselHucresi(p.id, ro) }));

  // --- Dolgu (K6): işletme domino'su dışındaki her parsel ---
  const isletmeParselleri = new Set<string>();
  const isletmeBloklari = new Set<string>();
  const blokOf = (id: string): string => { const { dr, dc } = parseId(id); return `${Math.floor(dr / BLOK_SATIR)}_${Math.floor(dc / BLOK_SUTUN)}`; };
  for (const l of parselLoncalar) isletmeParselleri.add(l.parsel!);
  for (const b of s.binalar) {
    if (b.tur !== "isletme") continue;
    isletmeParselleri.add(b.parsel!);
    isletmeParselleri.add(b.genisleme!);
    isletmeBloklari.add(blokOf(b.parsel!));
  }
  const dolgu: IzoSahne["dolgu"][number][] = s.parseller.filter((p) => !isletmeParselleri.has(p.id)).map((p) => {
    const hucre = parselHucresi(p.id, ro);
    if (isletmeBloklari.has(blokOf(p.id))) return { parselId: p.id, hucre, tur: "arsa" as const, sprite: arsaSprite, z: derinlik(hucre) };
    const konutMu = fnv1a(`${tohum}|${p.id}|dolgu`) % 100 < IZO_STILI.dolgu.konutOrani;
    const ev = konutMu ? tekilSprite(m, "konut", `${tohum}|${p.id}`) : null;
    return ev ? { parselId: p.id, hucre, tur: "konut" as const, sprite: ev, z: derinlik(hucre) } : { parselId: p.id, hucre, tur: "park" as const, sprite: zeminSprite(m, "agac"), z: derinlik(hucre) };
  });

  // --- Dünya kutusu: zemin kutusu + tüm sprite kutuları ---
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const kapsa = (x: number, y: number): void => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  const spriteKutusu = (sp: SpriteKaydi, ax: number, ay: number, aynali = false): void => {
    const solPay = (aynali ? sp.genislik - sp.ankraj.x : sp.ankraj.x) * olcek;
    kapsa(ax - solPay, ay - sp.ankraj.y * olcek);
    kapsa(ax - solPay + sp.genislik * olcek, ay - sp.ankraj.y * olcek + sp.yukseklik * olcek);
  };
  const { kutu } = zemin;
  for (const [c, r] of [[kutu.c0, kutu.r0], [kutu.c1, kutu.r0], [kutu.c0, kutu.r1], [kutu.c1, kutu.r1]] as const) { const p = hucredenEkrana({ c, r }); kapsa(p.x, p.y); }
  for (const b of binalar) spriteKutusu(b.sprite, b.ankraj.x, b.ankraj.y);
  for (const g of genislemeler) {
    const e = hucredenEkrana(g.hucre);
    if (g.sprite) spriteKutusu(g.sprite, e.x, e.y + (g.sprite.grup === "zemin" ? 0 : yarimKaro));
  }
  for (const d of dolgu) {
    if (!d.sprite) continue;
    const e = hucredenEkrana(d.hucre);
    spriteKutusu(d.sprite, e.x, e.y + (d.sprite.grup === "zemin" ? 0 : yarimKaro));
  }
  for (const sr of zemin.seritler) {
    if (!sr.sprite) continue;
    const yatay = sr.yon === "kuzey" || sr.yon === "guney";
    for (const h of sr.parcalar) {
      const a = hucredenEkrana(yatay ? { c: h.c + sr.uzunluk / 2, r: h.r + sr.genislik / 2 } : { c: h.c + sr.genislik / 2, r: h.r + sr.uzunluk / 2 });
      spriteKutusu(sr.sprite, a.x, a.y, !yatay);
    }
  }
  if (!Number.isFinite(x0)) { x0 = y0 = x1 = y1 = 0; }
  const pad = IZO_STILI.pad;

  return {
    kaynak: s,
    zemin,
    binalar,
    genislemeler,
    dolgu,
    bosHucreler,
    artanParseller,
    plaza: { hucre: kavsak, hucreler: plazaHucreleri.map((h) => h.hucre) },
    olcek,
    dunya: { genislik: x1 - x0 + 2 * pad, yukseklik: y1 - y0 + 2 * pad },
    kaydirma: { x: pad - x0, y: pad - y0 },
    gecisler: ek.gecisler ?? [],
    balonlar: ek.balonlar ?? [],
  };
}
