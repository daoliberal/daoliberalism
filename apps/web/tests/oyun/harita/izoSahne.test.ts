import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IZO_STILI, SEHIR_STILI } from "@/oyun/harita/haritaStili";
import { YOL_ORANI, blokAraligi, hucredenEkrana, parselDikdortgeni, parselHucresi, yolBantlari, yolaDegiyor, type Dikdortgen, type Hucre } from "@/oyun/harita/izometri";
import { binaSpriteSec, izoSahneKur, kurumYerleri, type IzoBina, type IzoSahne } from "@/oyun/harita/izoSahne";
import { sehirSahnesi, type SehirSahnesiBaglami } from "@/oyun/harita/sehirSahnesi";
import { dominoYuvalari, izoMeydanYaricapi, meydanDeligi, sokakAgi } from "@/oyun/harita/sokakAgi";
import { manifestCoz, type SpriteKaydi, type SpriteManifesti } from "@/oyun/harita/spriteManifest";
import type { HaritaDurumu, HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import type { HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";
import { izoManifestFiksturu } from "./fikstur/izoManifest";

const RO = YOL_ORANI;
const EPS = 1e-6;

// --- Manifest: fikstür + tekil (boy'suz) türler; gerçek sette tarla/değirmen/belediye/ahır/lonca tekil sprite'lı ---
function tekil(ad: string, tur: string): SpriteKaydi {
  return {
    ad, dosya: `yalin/${ad}_yalin.png`, genislik: 209, yukseklik: 163, ankraj: { x: 104, y: 162 }, parsel: { genislik: 208, yukseklik: 120 }, kaynak: "uretim", insanli: false,
    oyunTurleri: [tur], grup: "tekil", boy: null, parselSayisi: 1, yalin: true, zeminTuru: null, baglanti: null,
  };
}
const fiks = izoManifestFiksturu();
const m: SpriteManifesti = { ...fiks, kayitlar: [...fiks.kayitlar, tekil("bugday_tarlasi", "tarla_bugday"), tekil("belediye", "belediye"), tekil("ahir", "ahir"), tekil("lonca_tekil", "lonca"), tekil("liman_tekil", "liman"), tekil("gumruk_tekil", "ihracat"), tekil("ev_a", "konut"), tekil("ev_b", "konut"), tekil("ev_c", "konut")] };

// --- Sahne girdileri ---
const lonca = (ref: string, members = 5): HoldingsLonca => ({ ref, owner: "player", members, fee: null, capital: null, deposits: null, credit_out: null, equity: null });
const paketOf = (loncaSayisi = 3): WeekPacket => ({ ...packetOf("r", 20, 1), holdings: { loncas: Array.from({ length: loncaSayisi }, (_, i) => lonca(`lonca${i}`, 5 + i * 20)) } as WeekPacket["holdings"] });
const TURLER = ["market", "un", "tarla_bugday", "lojistik", "okul", "maden_komur", "eglence", "restoran"];
const firma = (i: number, durum: HaritaDurumu = "uretim", calisan = 2 + ((i * 7) % 60)): HaritaFirmaSatiri => [`f${i}`, TURLER[i % TURLER.length]!, 0, calisan, null, "npc", null, durum];
const verisi = (n: number): HaritaVerisi => ({ hafta: 20, firmalar: Array.from({ length: n }, (_, i) => firma(i)) });
const ctxOf = (ek: Partial<SehirSahnesiBaglami> = {}): SehirSahnesiBaglami => ({ runId: "kosu-1", sehirAdlari: ["A", "B"], sehir: 0, katman: "yok", izo: true, parselSecilebilir: true, ...ek });
const ozdes = (_: string, b: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 => b;
const kur = (n: number, o: { loncalar?: number; tohum?: string; gorsel?: (id: string, b: 1 | 2 | 3 | 4) => 1 | 2 | 3 | 4; v?: HaritaVerisi; ctx?: Partial<SehirSahnesiBaglami>; man?: SpriteManifesti } = {}): IzoSahne =>
  izoSahneKur(sehirSahnesi(paketOf(o.loncalar ?? 3), o.v ?? verisi(n), ctxOf(o.ctx)), o.man ?? m, o.tohum ?? "t1", o.gorsel ?? ozdes);

// --- Bağımsız geometri yardımcıları ---
const kesisir = (a: Dikdortgen, b: Dikdortgen): boolean => a.c0 < b.c1 - EPS && a.c1 > b.c0 + EPS && a.r0 < b.r1 - EPS && a.r1 > b.r0 + EPS;
const kare = (h: Hucre): Dikdortgen => ({ c0: h.c - 0.5, c1: h.c + 0.5, r0: h.r - 0.5, r1: h.r + 0.5 });
const ayniHucre = (a: Hucre, b: Hucre): boolean => Math.abs(a.c - b.c) < EPS && Math.abs(a.r - b.r) < EPS;
const parseId = (id: string): { dr: number; dc: number } => { const k = /^p(-?\d+)_(-?\d+)$/.exec(id)!; return { dr: Number(k[1]), dc: Number(k[2]) }; };
const bloktaMi = (a: string, b: string): boolean => Math.floor(parseId(a).dr / 2) === Math.floor(parseId(b).dr / 2) && Math.floor(parseId(a).dc / 3) === Math.floor(parseId(b).dc / 3);
const isletmeler = (z: IzoSahne): IzoBina[] => z.binalar.filter((b) => b.tur === "isletme");
const yolAgi = (z: IzoSahne) => yolBantlari(blokAraligi(z.kaynak.parseller.map((p) => p.id))!, z.zemin.ro);
const serit = (s: IzoSahne["zemin"]["seritler"][number]): Dikdortgen[] =>
  s.parcalar.map((h) => (s.yon === "kuzey" || s.yon === "guney" ? { c0: h.c - s.uzunluk / 2, c1: h.c + s.uzunluk / 2, r0: h.r - s.genislik / 2, r1: h.r + s.genislik / 2 } : { c0: h.c - s.genislik / 2, c1: h.c + s.genislik / 2, r0: h.r - s.uzunluk / 2, r1: h.r + s.uzunluk / 2 }));
/** Bir binanın ayrılmış zemini: tek hücre ya da (işletmede) ana + genişleme parseli (görsel boydan bağımsız). */
const ayakIzi = (b: IzoBina): Dikdortgen[] => {
  if (b.tur !== "isletme") return [kare(b.hucre)];
  return [parselDikdortgeni(b.sahne.parsel!, RO), parselDikdortgeni(b.sahne.genisleme!, RO)];
};
const ARTAN_TOHUMLAR = Array.from({ length: 51 }, (_, i) => `tohum-${i}`);

describe("sokakAgi izo yardimcilari", () => {
  it("izoMeydanYaricapi_lonca_sayisiyla_monoton", () => {
    const sayilar = [0, 1, 6, 20, 60];
    const r = sayilar.map((n) => izoMeydanYaricapi(n));
    for (let i = 0; i < r.length; i++) {
      expect(r[i]!).toBeGreaterThanOrEqual(SEHIR_STILI.meydan.yaricap);
      if (i > 0) expect(r[i]!).toBeGreaterThanOrEqual(r[i - 1]!);
      // meydan deliğindeki tam hücre >= n; bir adım küçüğünde değil (en küçük yarıçap), taban yarıçap hariç
      expect(meydanDeligi(sokakAgi(20, r[i]!)).length).toBeGreaterThanOrEqual(sayilar[i]!);
      if (r[i]! > SEHIR_STILI.meydan.yaricap) expect(meydanDeligi(sokakAgi(20, r[i]! - 1)).length).toBeLessThan(sayilar[i]!);
    }
    expect(r[4]!).toBeGreaterThan(r[1]!);
    expect(izoMeydanYaricapi(20)).toBe(izoMeydanYaricapi(20)); // saf
  });

  it("dominoYuvalari_ayni_blokta_komsu_cift_ve_yarimlar_haric", () => {
    const ag = sokakAgi(1, izoMeydanYaricapi(12));
    const yuvalar = dominoYuvalari(ag);
    const kume = new Set(ag.parseller.map((p) => p.id));
    expect(yuvalar.length).toBeGreaterThan(10);
    for (const y of yuvalar) {
      const a = parseId(y.ankraj);
      expect(((a.dr % 2) + 2) % 2).toBe(0);
      expect(y.genisleme).toBe(`p${a.dr + 1}_${a.dc}`);
      expect(bloktaMi(y.ankraj, y.genisleme)).toBe(true);
      expect(kume.has(y.ankraj) && kume.has(y.genisleme)).toBe(true);
    }
    // bağımsız sayım: iki hücresi de ızgarada olan çift sayısı
    const beklenen = ag.parseller.filter((p) => { const a = parseId(p.id); return ((a.dr % 2) + 2) % 2 === 0 && kume.has(`p${a.dr + 1}_${a.dc}`); }).length;
    expect(yuvalar.length).toBe(beklenen);
    expect(new Set(yuvalar.flatMap((y) => [y.ankraj, y.genisleme])).size).toBe(2 * yuvalar.length);
  });
});

describe("binaSpriteSec", () => {
  it("tekil_sprite_li_turler_boy_1_3_tekil_boy4_grup_kompoziti", () => {
    for (const boy of [1, 2, 3] as const) expect(binaSpriteSec(m, "tarla_bugday", boy, "f1").ad).toBe("bugday_tarlasi");
    const b4 = binaSpriteSec(m, "tarla_bugday", 4, "f1");
    expect(b4.ad).toBe("hammadde_boy4");
    expect(b4.parselSayisi).toBe(2);
    // tekil sprite'ı olmayan tür: grup merdiveni (boy ile değişir)
    for (const boy of [1, 2, 3, 4] as const) expect(binaSpriteSec(m, "market", boy, "f1").ad).toBe(`hizmet_boy${boy}`);
    expect(binaSpriteSec(m, "lojistik", 2, "f1").ad).toBe("lojistik_boy2");
    expect(binaSpriteSec(m, "belediye", 1, "x").ad).toBe("belediye");
  });

  it("bilinmeyen_tur_genel_sprite_ile_cizilir_ve_insanli_atanmaz", () => {
    const s = binaSpriteSec(m, "bilinmeyen_xyz", 2, "f9");
    expect(s.insanli).toBe(false);
    expect(s.grup).toBe("hizmet"); // bilinmeyen tür hizmet grubuna düşer
    // hizmet merdiveni de yoksa genel sprite
    const sadeceGenel: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup === "genel" || k.grup === "zemin") };
    expect(binaSpriteSec(sadeceGenel, "bilinmeyen_xyz", 3, "f9").ad).toBe("genel_bina");
    // eglence için insanlı sprite vardır ama hiç seçilmez
    for (const boy of [1, 2, 3, 4] as const) expect(binaSpriteSec(m, "eglence", boy, "f2").insanli).toBe(false);
  });
});

describe("izoSahneKur", () => {
  it("izo_domino_yuvalar_genisleme_parseli_komsu_ve_ayni_blokta", () => {
    const z = kur(30);
    const parseller = new Set(z.kaynak.parseller.map((p) => p.id));
    expect(isletmeler(z)).toHaveLength(30);
    for (const b of isletmeler(z)) {
      const a = parseId(b.sahne.parsel!);
      expect(((a.dr % 2) + 2) % 2).toBe(0);
      expect(b.sahne.genisleme).toBe(`p${a.dr + 1}_${a.dc}`);
      expect(bloktaMi(b.sahne.parsel!, b.sahne.genisleme!)).toBe(true);
      expect(parseller.has(b.sahne.parsel!) && parseller.has(b.sahne.genisleme!)).toBe(true);
    }
  });

  it("iki_isletme_ayni_dominoyu_paylasmaz_ve_genislemeye_baska_isletme_oturmaz", () => {
    const z = kur(60);
    const idler = isletmeler(z).flatMap((b) => [b.sahne.parsel!, b.sahne.genisleme!]);
    expect(new Set(idler).size).toBe(idler.length);
    const anaSet = new Set(isletmeler(z).map((b) => b.sahne.parsel!));
    for (const b of isletmeler(z)) expect(anaSet.has(b.sahne.genisleme!)).toBe(false);
  });

  it("ayni_girdi_ayni_cikti", () => {
    expect(kur(40)).toEqual(kur(40));
    const karisik: HaritaVerisi = { ...verisi(40), firmalar: [...verisi(40).firmalar].reverse() };
    const a = kur(40);
    const b = kur(40, { v: karisik });
    expect(b.binalar.map((x) => [x.id, x.hucre, x.z])).toEqual(a.binalar.map((x) => [x.id, x.hucre, x.z]));
  });

  it("her_parselli_bina_kendi_hucresinde", () => {
    const z = kur(50);
    for (const b of isletmeler(z)) {
      expect(ayniHucre(b.hucre, parselHucresi(b.sahne.parsel!, z.zemin.ro))).toBe(true);
      expect(b.ref).toEqual({ kind: "firm", ref: b.id });
      expect(b.ekran).toEqual(hucredenEkrana(b.hucre));
    }
    // hiçbir bina ayak izi bir başkasıyla kesişmez
    const hepsi = z.binalar.map((b) => ({ id: b.id, kutular: ayakIzi(b) }));
    for (let i = 0; i < hepsi.length; i++) for (let j = i + 1; j < hepsi.length; j++) {
      for (const p of hepsi[i]!.kutular) for (const q of hepsi[j]!.kutular) expect(kesisir(p, q), `${hepsi[i]!.id}/${hepsi[j]!.id}`).toBe(false);
    }
  });

  it("derinlik_sirasi_arkadan_one", () => {
    const z = kur(60, { loncalar: 8, gorsel: (id, b) => (id.endsWith("3") ? 4 : b) });
    const zler = z.binalar.map((b) => b.z);
    expect(zler).toEqual([...zler].sort((a, b) => a - b));
    // kesin arkadaki (tüm ayak izi köşegen toplamı küçük) önce çizilir
    const aralik = (b: IzoBina): [number, number] => {
      const ks = ayakIzi(b);
      return [Math.min(...ks.map((k) => k.c0 + k.r0)), Math.max(...ks.map((k) => k.c1 + k.r1))];
    };
    const sira = new Map(z.binalar.map((b, i) => [b.id, i]));
    let sinanan = 0;
    for (const a of z.binalar) for (const b of z.binalar) {
      if (a === b) continue;
      if (aralik(a)[1] <= aralik(b)[0] + EPS) { expect(sira.get(a.id)!, `${a.id} arkada, ${b.id} önde`).toBeLessThan(sira.get(b.id)!); sinanan++; }
    }
    expect(sinanan).toBeGreaterThan(100);
  });

  it("bina_gelip_gidince_digerleri_buyuk_olcude_yerinde", () => {
    // Eşikler sehirSahnesi.test sözleşmesiyle aynı: seyrek şehirde ortalama <= 0,5; dolu kademede ortalama <= 2 ve her silmede >= %80 yerinde.
    const ortalamaKayma = (n: number): { ort: number; enAz: number } => {
      const v = verisi(n);
      const tam = parselOf(kur(n, { v }));
      let toplam = 0;
      let enAz = 1;
      for (let i = 0; i < n; i++) {
        const az = parselOf(kur(n - 1, { v: { ...v, firmalar: v.firmalar.filter((_, k) => k !== i) } }));
        const ids = Object.keys(az);
        const tasinan = ids.filter((id) => az[id] !== tam[id]).length;
        toplam += tasinan;
        enAz = Math.min(enAz, (ids.length - tasinan) / ids.length);
      }
      return { ort: toplam / n, enAz };
    };
    expect(ortalamaKayma(10).ort).toBeLessThanOrEqual(0.5);
    const dolu = ortalamaKayma(30);
    expect(dolu.ort).toBeLessThanOrEqual(2);
    expect(dolu.enAz).toBeGreaterThanOrEqual(0.8);
    // yeni bina gelince de ötekiler yerinde
    const v = verisi(30);
    const tam = parselOf(kur(30, { v }));
    const fazla = parselOf(kur(31, { v: { ...v, firmalar: [...v.firmalar, firma(99)] } }));
    expect(Object.keys(tam).filter((id) => fazla[id] !== tam[id]).length / 30).toBeLessThanOrEqual(0.2);
  });

  it("meydan_buyuyunce_yalniz_domino_su_kaybolanlar_ve_zincir_tasinir", () => {
    // Ölçülen: lonca 3 -> 20'ye kadar taşınan <= 2 x kaybeden; 3 -> 30'da (deliğin yarısı iç kademeyi yutar) oran ~2,4 olur (en çok 2,5 x).
    for (const [n, yeniLonca, oran] of [[14, 14, 2], [20, 20, 2], [30, 20, 2], [14, 30, 2.5], [20, 30, 2.5], [30, 30, 2.5]] as const) {
      const v = verisi(n);
      const az = kur(n, { v, loncalar: 3 });
      const cok = kur(n, { v, loncalar: yeniLonca });
      expect(cok.kaynak.meydan.yaricap).toBeGreaterThan(az.kaynak.meydan.yaricap);
      const kalan = new Set(cok.kaynak.parseller.map((p) => p.id));
      const once = parselOf(az);
      const sonra = parselOf(cok);
      const kaybeden = isletmeler(az).filter((b) => !kalan.has(b.sahne.parsel!) || !kalan.has(b.sahne.genisleme!)).length;
      const tasinan = Object.keys(once).filter((id) => once[id] !== sonra[id]).length;
      expect(tasinan, `n=${n} lonca=${yeniLonca}`).toBeLessThanOrEqual(oran * kaybeden);
      // kaybetmeyen bina bile taşınmışsa bu yalnız kademe/kayıp zincirinden: kaybeden yoksa kimse taşınmaz
      if (kaybeden === 0) expect(tasinan).toBe(0);
    }
  });

  it("kapali_isletme_10_hafta_parselini_tutar", () => {
    const v = verisi(20);
    const kapali: HaritaVerisi = { ...v, firmalar: v.firmalar.map((f) => (f[0] === "f5" ? ([...f.slice(0, 7), "kapali"] as unknown as HaritaFirmaSatiri) : f)) };
    const a = kur(20, { v });
    const b = kur(20, { v: kapali });
    const f5 = b.binalar.find((x) => x.id === "f5")!;
    expect(f5.kapali).toBe(true);
    expect(a.binalar.find((x) => x.id === "f5")!.kapali).toBe(false);
    expect(f5.sahne.parsel).toBe(a.binalar.find((x) => x.id === "f5")!.sahne.parsel);
    expect(parselOf(b)).toEqual(parselOf(a));
    // kapalı bina genişleme parselini de tutar: kur hedefi olmaz
    expect(b.bosHucreler.some((h) => h.parselId === f5.sahne.parsel || h.parselId === f5.sahne.genisleme)).toBe(false);
  });

  it("kademe_buyuyunce_icerdekiler_yerinde", () => {
    const v = verisi(80);
    const kucuk = kur(40, { v: { ...v, firmalar: v.firmalar.slice(0, 40) } });
    const buyuk = kur(80, { v });
    expect(buyuk.kaynak.kademe!).toBeGreaterThan(kucuk.kaynak.kademe!);
    const o = parselOf(kucuk);
    const y = parselOf(buyuk);
    const kalan = Object.keys(o).filter((id) => o[id] === y[id]).length;
    expect(kalan / 40).toBeGreaterThanOrEqual(0.8);
  });

  it("boy_degisince_hucre_ekran_z_ayni_sprite_degisir", () => {
    const b1 = kur(30, { gorsel: () => 1 });
    const b3 = kur(30, { gorsel: () => 3 });
    const b4 = kur(30, { gorsel: () => 4 });
    for (const x of isletmeler(b1)) {
      const y = isletmeler(b3).find((k) => k.id === x.id)!;
      const w = isletmeler(b4).find((k) => k.id === x.id)!;
      for (const k of [y, w]) {
        expect(k.hucre).toEqual(x.hucre);
        expect(k.ekran).toEqual(x.ekran);
        expect(k.z).toBe(x.z);
      }
      expect(x.boy).toBe(1);
      expect(y.boy).toBe(3);
      expect(w.boy).toBe(4);
      // tekil sprite'lı tür (tarla) boy 1-3'te aynı sprite'ı korur; boy 4'te grup kompozitine geçer
      if (x.sahne.etiket !== "tarla_bugday") expect(y.sprite.ad).not.toBe(x.sprite.ad);
      else expect(y.sprite.ad).toBe(x.sprite.ad);
      expect(w.sprite.ad).not.toBe(y.sprite.ad);
      expect(x.sprite.ad).toBe(binaSpriteSec(m, x.sahne.etiket, 1, x.id).ad);
    }
    expect(b1.binalar.map((x) => x.id)).toEqual(b4.binalar.map((x) => x.id));
  });

  it("boy4_iki_parsel_domino_yi_kaplar_komsular_oynamaz", () => {
    const b1 = kur(30, { gorsel: () => 1 });
    const b4 = kur(30, { gorsel: () => 4 });
    for (const x of isletmeler(b4)) {
      expect(x.hucre2).not.toBeNull();
      expect(x.hucre2!.c).toBeCloseTo(x.hucre.c, 9); // aynı sütun
      expect(x.hucre2!.r).toBeCloseTo(x.hucre.r + 1, 9); // r+1 komşu, aynı blokta: araya yol girmez
      expect(ayniHucre(x.hucre2!, parselHucresi(x.sahne.genisleme!, RO))).toBe(true);
      expect(x.sprite.parselSayisi).toBe(2);
      // her hücre ve komşu aynı yerde
      const eski = isletmeler(b1).find((k) => k.id === x.id)!;
      expect(eski.hucre2).toBeNull();
      expect(eski.hucre).toEqual(x.hucre);
    }
    // boy 4: genişleme parseli binanın altında; boy 1-3: boş genişleme arsası
    expect(b4.genislemeler).toHaveLength(0);
    expect(b1.genislemeler).toHaveLength(30);
    expect(b4.bosHucreler.map((h) => h.parselId)).toEqual(b1.bosHucreler.map((h) => h.parselId));
    // diğer (lonca, belediye, ahır) binalar oynamaz
    for (const x of b1.binalar.filter((k) => k.tur !== "isletme")) expect(b4.binalar.find((k) => k.id === x.id)!.hucre).toEqual(x.hucre);
  });

  it("genisleme_arsasi_bos_genisleme_parselinde_deterministik", () => {
    const z = kur(30, { gorsel: () => 1 });
    for (const g of z.genislemeler) {
      const b = z.binalar.find((x) => x.id === g.binaId)!;
      expect(ayniHucre(g.hucre, parselHucresi(b.sahne.genisleme!, RO))).toBe(true);
      expect(["cimen", "arsa", "otopark"]).toContain(g.tur);
    }
    expect(new Set(z.genislemeler.map((g) => g.tur)).size).toBeGreaterThan(1);
    expect(kur(30, { gorsel: () => 1 }).genislemeler).toEqual(z.genislemeler);
    expect(z.genislemeler).toHaveLength(30);
    // bir bina büyüyünce yalnız onun arsası kalkar
    const f3 = kur(30, { gorsel: (id) => (id === "f3" ? 4 : 1) });
    expect(f3.genislemeler).toHaveLength(29);
    expect(f3.genislemeler.some((g) => g.binaId === "f3")).toBe(false);
  });

  it("insanli_sprite_atanmaz", () => {
    const z = kur(60, { loncalar: 6 });
    expect(z.binalar.every((b) => !b.sprite.insanli)).toBe(true);
    expect(isletmeler(z).filter((b) => b.sahne.etiket === "eglence").length).toBeGreaterThan(0);
  });

  it("bos_sehir_cokmez", () => {
    for (const s of [sehirSahnesi(null, null, ctxOf()), sehirSahnesi(paketOf(4), { hafta: 1, firmalar: [] }, ctxOf()), sehirSahnesi(paketOf(0), null, ctxOf({ parselSecilebilir: false }))]) {
      const z = izoSahneKur(s, m, "t", ozdes);
      expect(z.zemin.yollar.length).toBeGreaterThan(0);
      expect(z.binalar.some((b) => b.tur === "sehir")).toBe(true);
      expect(z.binalar.some((b) => b.tur === "ahir")).toBe(true);
      expect(isletmeler(z)).toHaveLength(0);
      expect(z.dunya.genislik).toBeGreaterThan(0);
      expect(z.dunya.yukseklik).toBeGreaterThan(0);
    }
    expect(izoSahneKur(sehirSahnesi(paketOf(4), { hafta: 1, firmalar: [] }, ctxOf()), m, "t", ozdes).binalar.filter((b) => b.tur === "lonca")).toHaveLength(4);
  });

  it("izo_olmayan_sahne_acik_hata_verir", () => {
    const s = sehirSahnesi(paketOf(), verisi(5), ctxOf({ izo: undefined }));
    expect(() => izoSahneKur(s, m, "t", ozdes)).toThrow(/izoSahne/);
  });
});

describe("izoSahne kur hedefi", () => {
  const dolu = (z: IzoSahne): Set<string> => new Set(isletmeler(z).flatMap((b) => [b.sahne.parsel!, b.sahne.genisleme!]));

  it("kur_hedefi_yalniz_iki_hucresi_de_bos_domino", () => {
    const z = kur(25, { loncalar: 5 });
    const kume = new Set(z.kaynak.parseller.map((p) => p.id));
    const d = dolu(z);
    // bağımsız beklenen: ana (cift satır) + r+1 ikisi de ızgarada ve ikisi de boş
    const beklenen = z.kaynak.parseller.map((p) => p.id).filter((id) => { const a = parseId(id); return ((a.dr % 2) + 2) % 2 === 0 && kume.has(`p${a.dr + 1}_${a.dc}`) && !d.has(id) && !d.has(`p${a.dr + 1}_${a.dc}`); });
    expect(z.kaynak.bosParseller!.map((p) => p.id).sort()).toEqual(beklenen.sort());
    expect(beklenen.length).toBeGreaterThan(5);
    for (const h of z.bosHucreler) {
      const a = parseId(h.parselId);
      expect(ayniHucre(h.hucre2, parselHucresi(`p${a.dr + 1}_${a.dc}`, RO))).toBe(true);
      expect(h.ekran).toEqual(hucredenEkrana(h.hucre));
    }
  });

  it("genisleme_parseli_kur_hedefi_degil_ve_baska_isletmenin_genislemesi_secilemez", () => {
    for (const gorsel of [ozdes, () => 4 as const]) {
      const z = kur(25, { gorsel });
      const genisleme = new Set(isletmeler(z).map((b) => b.sahne.genisleme!));
      for (const h of z.bosHucreler) {
        expect(genisleme.has(h.parselId)).toBe(false);
        expect(genisleme.has(`p${parseId(h.parselId).dr + 1}_${parseId(h.parselId).dc}`)).toBe(false);
      }
      for (const b of isletmeler(z)) expect(z.bosHucreler.some((h) => h.parselId === b.sahne.genisleme || ayniHucre(h.hucre2, b.hucre2 ?? parselHucresi(b.sahne.genisleme!, RO)))).toBe(false);
    }
  });

  it("meydan_deligine_dusen_yarim_domino_kur_hedefi_degil", () => {
    const z = kur(10, { loncalar: 20 });
    const kume = new Set(z.kaynak.parseller.map((p) => p.id));
    const yarim = z.kaynak.parseller.map((p) => p.id).filter((id) => { const a = parseId(id); const es = ((a.dr % 2) + 2) % 2 === 0 ? `p${a.dr + 1}_${a.dc}` : `p${a.dr - 1}_${a.dc}`; return !kume.has(es); });
    expect(yarim.length).toBeGreaterThan(0); // senaryo gerçekten yarım domino üretiyor
    const hedef = new Set(z.bosHucreler.map((h) => h.parselId));
    const sahip = dolu(z);
    for (const id of yarim) {
      expect(hedef.has(id), id).toBe(false);
      expect(sahip.has(id), id).toBe(false);
    }
    expect(z.artanParseller.map((p) => p.parselId).sort()).toEqual([...yarim].sort());
  });

  it("bosHucreler_bosParsellerle_ayni_kumeden_ve_secilebilir_degilse_bos", () => {
    const z = kur(25);
    expect(z.bosHucreler.map((h) => h.parselId).sort()).toEqual(z.kaynak.bosParseller!.map((p) => p.id).sort());
    const kapali = kur(25, { ctx: { parselSecilebilir: false } });
    expect(kapali.bosHucreler).toEqual([]);
    expect(kapali.kaynak.bosParseller).toEqual([]);
  });
});

describe("izoSahne dolgu (K6)", () => {
  const dolu = (z: IzoSahne): Set<string> => new Set(isletmeler(z).flatMap((b) => [b.sahne.parsel!, b.sahne.genisleme!]));
  const blokAnahtar = (id: string): string => `${Math.floor(parseId(id).dr / 2)}_${Math.floor(parseId(id).dc / 3)}`;

  it("her_bos_parselde_tam_bir_dolgu", () => {
    for (const z of [kur(10), kur(40, { loncalar: 6 }), kur(25, { loncalar: 20 })]) {
      const d = dolu(z);
      const beklenen = z.kaynak.parseller.map((p) => p.id).filter((id) => !d.has(id)).sort();
      expect(z.dolgu.map((x) => x.parselId).sort()).toEqual(beklenen);
      expect(new Set(z.dolgu.map((x) => x.parselId)).size).toBe(z.dolgu.length);
      for (const x of z.dolgu) expect(ayniHucre(x.hucre, parselHucresi(x.parselId, RO))).toBe(true);
      // her kur hedefi ve artan parsel dolgulu
      const dolgulu = new Set(z.dolgu.map((x) => x.parselId));
      for (const h of z.bosHucreler) expect(dolgulu.has(h.parselId) && dolgulu.has(`p${parseId(h.parselId).dr + 1}_${parseId(h.parselId).dc}`)).toBe(true);
      for (const a of z.artanParseller) expect(dolgulu.has(a.parselId)).toBe(true);
    }
  });

  it("dolgu_bina_ve_genislemeyle_cakismaz_insanli_yok", () => {
    const z = kur(40, { loncalar: 6, gorsel: (id, b) => (id.endsWith("3") ? 4 : b) });
    const parselKutulari = new Set(z.binalar.filter((b) => b.tur === "isletme").flatMap((b) => [b.sahne.parsel!, b.sahne.genisleme!]));
    const genisleme = new Set(z.genislemeler.map((g) => g.binaId));
    for (const x of z.dolgu) {
      expect(parselKutulari.has(x.parselId)).toBe(false);
      for (const b of z.binalar) for (const k of ayakIzi(b)) expect(kesisir(kare(x.hucre), k), `${x.parselId}/${b.id}`).toBe(false);
      for (const g of z.genislemeler) expect(kesisir(kare(x.hucre), kare(g.hucre))).toBe(false);
      if (x.sprite) expect(x.sprite.insanli).toBe(false);
    }
    expect(genisleme.size).toBeGreaterThan(0);
  });

  it("kural_isletmeli_blokta_arsa_bos_blokta_konut_ya_da_park_oran_ayarda", () => {
    const z = kur(10, { loncalar: 3 });
    const isletmeBloklari = new Set(isletmeler(z).map((b) => blokAnahtar(b.sahne.parsel!)));
    let konut = 0, bosBlok = 0;
    for (const x of z.dolgu) {
      if (isletmeBloklari.has(blokAnahtar(x.parselId))) expect(x.tur, x.parselId).toBe("arsa");
      else {
        bosBlok++;
        expect(["konut", "park"]).toContain(x.tur);
        if (x.tur === "konut") { konut++; expect(x.sprite!.oyunTurleri).toContain("konut"); }
        else expect(x.sprite?.zeminTuru).toBe("agac");
      }
    }
    expect(z.dolgu.some((x) => x.tur === "arsa")).toBe(true);
    // oran: çok tohum üzerinde işletmesiz bloklarda ~%70 konut
    let konutSay = 0, toplam = 0;
    for (const t of ARTAN_TOHUMLAR) {
      const k = kur(10, { loncalar: 3, tohum: t });
      const dolguBloklari = new Set(isletmeler(k).map((i) => blokAnahtar(i.sahne.parsel!)));
      for (const x of k.dolgu.filter((d) => !dolguBloklari.has(blokAnahtar(d.parselId)))) { toplam++; if (x.tur === "konut") konutSay++; }
    }
    expect(toplam).toBeGreaterThan(200);
    expect(Math.abs(konutSay / toplam - IZO_STILI.dolgu.konutOrani / 100)).toBeLessThan(0.08);
    expect(bosBlok).toBeGreaterThan(4);
    expect(konut / bosBlok).toBeGreaterThan(0.4);
    expect(konut / bosBlok).toBeLessThan(0.95);
    expect(kur(10, { loncalar: 3 }).dolgu).toEqual(z.dolgu); // deterministik
  });

  it("kademe_buyuyunce_ic_dolgular_kararli", () => {
    const v = verisi(40);
    const kucuk = kur(40, { v, loncalar: 3 });
    const buyuk = kur(40, { v, loncalar: 20 });
    expect(buyuk.kaynak.kademe!).toBeGreaterThanOrEqual(kucuk.kaynak.kademe!);
    const bloklar = (z: IzoSahne): Set<string> => new Set(isletmeler(z).map((b) => blokAnahtar(b.sahne.parsel!)));
    const kb = bloklar(kucuk), bb = bloklar(buyuk);
    const eski = new Map(kucuk.dolgu.map((x) => [x.parselId, x]));
    let karsilastirilan = 0;
    for (const x of buyuk.dolgu) {
      const o = eski.get(x.parselId);
      if (!o || kb.has(blokAnahtar(x.parselId)) !== bb.has(blokAnahtar(x.parselId)) || kb.has(blokAnahtar(x.parselId))) continue;
      karsilastirilan++;
      expect([x.tur, x.sprite?.ad]).toEqual([o.tur, o.sprite?.ad]);
    }
    expect(karsilastirilan).toBeGreaterThan(5);
  });
});

describe("izoSahne z sirasi: genisleme ve dolgu", () => {
  it("genisleme_ve_dolgu_z_si_binalarla_ayni_derinlik_kuralinda", () => {
    const z = kur(40, { loncalar: 6, gorsel: () => 1 });
    const aralik = (ks: Dikdortgen[]): [number, number] => [Math.min(...ks.map((k) => k.c0 + k.r0)), Math.max(...ks.map((k) => k.c1 + k.r1))];
    const ogeler = [
      ...z.dolgu.map((d) => ({ ad: `dolgu ${d.parselId}`, z: d.z, a: aralik([kare(d.hucre)]), konut: d.tur === "konut" })),
      ...z.genislemeler.map((g) => ({ ad: `genisleme ${g.binaId}`, z: g.z, a: aralik([kare(g.hucre)]), konut: false })),
    ];
    let sinanan = 0, konutSinanan = 0;
    for (const o of ogeler) for (const b of isletmeler(z)) {
      const ba = aralik(ayakIzi(b));
      if (o.a[1] <= ba[0] + EPS) { expect(o.z, `${o.ad} arkada, ${b.id} önde`).toBeLessThan(b.z); sinanan++; if (o.konut) konutSinanan++; }
      if (ba[1] <= o.a[0] + EPS) { expect(o.z, `${o.ad} önde, ${b.id} arkada`).toBeGreaterThan(b.z); sinanan++; if (o.konut) konutSinanan++; }
    }
    expect(sinanan).toBeGreaterThan(200);
    expect(konutSinanan).toBeGreaterThan(0);
    // bina kendi genişleme arsasının üstündedir (arsa altta)
    for (const g of z.genislemeler) expect(g.z).toBeLessThan(z.binalar.find((b) => b.id === g.binaId)!.z);
  });

  it("genisleme_arsasi_ve_dolgu_arsasi_ayni_sprite", () => {
    const z = kur(30, { gorsel: () => 1 });
    const ga = z.genislemeler.find((g) => g.tur === "arsa")!;
    const da = z.dolgu.find((d) => d.tur === "arsa")!;
    expect(ga.sprite).not.toBeNull();
    expect(ga.sprite!.ad).toBe(da.sprite!.ad);
  });
});

describe("izoSahne belediye ahir ve plaza", () => {
  it("belediye_cercevede_kuzey_kapidan_bir_hucre_kayik", () => {
    let kuzeyde = 0;
    let kayan = 0;
    for (const t of ARTAN_TOHUMLAR) {
      const z = kur(20, { tohum: t });
      const bel = z.binalar.find((b) => b.tur === "sehir")!;
      const yonSeritli = new Set(z.zemin.seritler.map((s) => s.yon));
      const kapi = (y: string): Hucre => z.zemin.kapilar.find((k) => k.yon === y)!.hucre;
      const { kapsam } = z.zemin;
      if (!yonSeritli.has("kuzey")) {
        kuzeyde++;
        expect(bel.hucre.c).toBeCloseTo(kapi("kuzey").c + 1, 9);
        expect(bel.hucre.r).toBeCloseTo(kapsam.r0 - 0.5, 9);
      } else {
        kayan++;
        // şeritli kuzeyden en yakın şeritsiz kenara: doğu, batı, güney sırası
        const beklenen = (["dogu", "bati", "guney"] as const).find((y) => !yonSeritli.has(y))!;
        const k = kapi(beklenen);
        const yer = { dogu: { c: kapsam.c1 + 0.5, r: k.r + 1 }, bati: { c: kapsam.c0 - 0.5, r: k.r + 1 }, guney: { c: k.c + 1, r: kapsam.r1 + 0.5 } }[beklenen];
        expect(bel.hucre.c).toBeCloseTo(yer.c, 9);
        expect(bel.hucre.r).toBeCloseTo(yer.r, 9);
      }
    }
    expect(kuzeyde).toBeGreaterThan(5);
    expect(kayan).toBeGreaterThan(5);
  });

  it("belediye_ahir_ve_lonca_hicbir_tohumda_serit_yol_kavsak_kapi_ya_da_binayla_cakismaz", () => {
    for (const t of ARTAN_TOHUMLAR) {
      const z = kur(30, { tohum: t, loncalar: 6 });
      const yb = yolAgi(z);
      const seritler = z.zemin.seritler.flatMap(serit);
      const ozel = z.binalar.filter((b) => b.tur !== "isletme");
      expect(ozel.filter((b) => b.tur === "sehir")).toHaveLength(1);
      expect(ozel.filter((b) => b.tur === "ahir")).toHaveLength(1);
      expect(ozel.filter((b) => b.tur === "lonca")).toHaveLength(6);
      for (const b of ozel) {
        const k = kare(b.hucre);
        expect(yolaDegiyor(k, yb), `${t} ${b.id} yol`).toBe(false);
        expect(seritler.some((s) => kesisir(k, s)), `${t} ${b.id} şerit`).toBe(false);
        for (const kapi of z.zemin.kapilar) expect(kesisir(k, kare(kapi.hucre)) , `${t} ${b.id} kapı`).toBe(false);
      }
      const hepsi = z.binalar.map((b) => ({ id: b.id, kutular: ayakIzi(b) }));
      for (let i = 0; i < hepsi.length; i++) for (let j = i + 1; j < hepsi.length; j++) {
        for (const p of hepsi[i]!.kutular) for (const q of hepsi[j]!.kutular) expect(kesisir(p, q), `${t} ${hepsi[i]!.id}/${hepsi[j]!.id}`).toBe(false);
      }
    }
  });

  it("ahir_guneyde_kapidan_bir_hucre_ters_yone_kayik_belediyeden_farkli_kenarda", () => {
    for (const t of ARTAN_TOHUMLAR) {
      const z = kur(10, { tohum: t });
      const bel = z.binalar.find((b) => b.tur === "sehir")!;
      const ahir = z.binalar.find((b) => b.tur === "ahir")!;
      const yonSeritli = new Set(z.zemin.seritler.map((s) => s.yon));
      const { kapsam } = z.zemin;
      if (!yonSeritli.has("guney")) {
        expect(ahir.hucre.r).toBeCloseTo(kapsam.r1 + 0.5, 9);
        expect(ahir.hucre.c).toBeCloseTo(z.zemin.kapilar.find((k) => k.yon === "guney")!.hucre.c - 1, 9);
      }
      expect(ayniHucre(ahir.hucre, bel.hucre)).toBe(false);
      expect(ahir.sprite.grup === "tekil" || ahir.sprite.oyunTurleri.includes("ahir")).toBe(true);
    }
  });

  it("lonca_basina_ayri_tam_hucre_ve_ayak_izleri_kesismez", () => {
    const z = kur(20, { loncalar: 20 });
    const loncalar = z.binalar.filter((b) => b.tur === "lonca");
    expect(loncalar).toHaveLength(20);
    const anahtar = (h: Hucre): string => `${h.c.toFixed(6)},${h.r.toFixed(6)}`;
    const plaza = new Set(z.plaza.hucreler.map(anahtar));
    expect(new Set(loncalar.map((b) => anahtar(b.hucre))).size).toBe(20);
    for (const b of loncalar) {
      expect(plaza.has(anahtar(b.hucre)), b.id).toBe(true);
      expect(b.hucre2).toBeNull();
      expect(b.ref).toEqual({ kind: "lonca", ref: b.id });
    }
    for (let i = 0; i < loncalar.length; i++) for (let j = i + 1; j < loncalar.length; j++) expect(kesisir(kare(loncalar[i]!.hucre), kare(loncalar[j]!.hucre))).toBe(false);
    // plaza hücreleri yol ağına değmez; merkezdeki kavşakta yer alır
    const yb = yolAgi(z);
    for (const h of z.plaza.hucreler) expect(yolaDegiyor(kare(h), yb)).toBe(false);
    expect(z.plaza.hucreler.length).toBe(meydanDeligi(sokakAgi(z.kaynak.kademe!, z.kaynak.meydan.yaricap)).length);
    expect(z.plaza.hucreler.length).toBeGreaterThanOrEqual(20);
  });

  it("lonca_yerleri_lonca_gelip_gidince_buyuk_olcude_sabit", () => {
    const yerOf = (z: IzoSahne): Record<string, string> => Object.fromEntries(z.binalar.filter((b) => b.tur === "lonca").map((b) => [b.id, `${b.hucre.c.toFixed(4)},${b.hucre.r.toFixed(4)}`]));
    const bes = yerOf(kur(10, { loncalar: 5 }));
    const alti = yerOf(kur(10, { loncalar: 6 }));
    const tasinan = Object.keys(bes).filter((id) => alti[id] !== bes[id]).length;
    expect(tasinan).toBeLessThanOrEqual(2);
  });

  it("kaynak_sahne_alanlari_korunur", () => {
    const s = sehirSahnesi(paketOf(), verisi(20), ctxOf({ ben: { sehir: 0, firma: "f3", durum: "sahip" }, ilanVeren: new Set(["f2"]) }));
    const z = izoSahneKur(s, m, "t", ozdes);
    expect(z.kaynak).toBe(s);
    expect(z.kaynak.katman).toBe(s.katman);
    expect(z.kaynak.ilanVeren).toBe(s.ilanVeren);
    expect(z.kaynak.meydan).toBe(s.meydan);
    expect(z.kaynak.sehirBinasi).toBe(s.sehirBinasi);
    expect(z.kaynak.ahir).toBe(s.ahir);
    expect(z.kaynak.ben).toBe(s.ben);
    expect(z.binalar.find((b) => b.tur === "sehir")!.sahne).toBe(s.sehirBinasi);
    expect(z.binalar.find((b) => b.tur === "ahir")!.sahne).toBe(s.ahir);
  });

  it("dunya_kutusu_tum_spritelari_kapsar", () => {
    const z = kur(60, { loncalar: 9, gorsel: (id, b) => (id.endsWith("1") ? 4 : b) });
    const olcek = IZO_STILI.karo.genislik / m.parselKaro.genislik;
    expect(z.dunya.genislik).toBeGreaterThan(500);
    const icinde = (x: number, y: number, ad: string): void => {
      expect(x + z.kaydirma.x, `${ad} x`).toBeGreaterThanOrEqual(-EPS);
      expect(x + z.kaydirma.x, `${ad} x`).toBeLessThanOrEqual(z.dunya.genislik + EPS);
      expect(y + z.kaydirma.y, `${ad} y`).toBeGreaterThanOrEqual(-EPS);
      expect(y + z.kaydirma.y, `${ad} y`).toBeLessThanOrEqual(z.dunya.yukseklik + EPS);
    };
    for (const b of z.binalar) {
      const son = b.hucre2 ?? b.hucre;
      const e = hucredenEkrana(son);
      const ax = e.x;
      const ay = e.y + IZO_STILI.karo.yukseklik / 2; // ayak izinin alt köşesi
      const sol = ax - b.sprite.ankraj.x * olcek;
      const ust = ay - b.sprite.ankraj.y * olcek;
      icinde(sol, ust, b.id);
      icinde(sol + b.sprite.genislik * olcek, ust + b.sprite.yukseklik * olcek, b.id);
    }
    // zemin kutusunun dört köşesi de içeride
    const { kutu } = z.zemin;
    for (const [c, r] of [[kutu.c0, kutu.r0], [kutu.c1, kutu.r0], [kutu.c0, kutu.r1], [kutu.c1, kutu.r1]] as const) {
      const p = hucredenEkrana({ c, r });
      icinde(p.x, p.y, "kutu");
    }
    // kaydırma pad'den başlatır
    expect(Math.min(...z.binalar.map((b) => b.sprite.ankraj.x * 0 + hucredenEkrana(b.hucre).x)) + z.kaydirma.x).toBeGreaterThan(0);
  });

  const GERCEK_MANIFEST = path.resolve(process.cwd(), "public/oyun-sprite/manifest.json");
  it.skipIf(!fs.existsSync(GERCEK_MANIFEST))("gercek_manifestle_calisir", () => {
    const yol = GERCEK_MANIFEST;
    const gercek = manifestCoz(JSON.parse(fs.readFileSync(yol, "utf8")));
    const z = kur(60, { loncalar: 6, man: gercek, gorsel: (id, b) => (id.endsWith("2") ? 4 : b) });
    expect(z.binalar.every((b) => b.sprite && !b.sprite.insanli)).toBe(true);
    expect(isletmeler(z).filter((b) => b.sahne.etiket === "tarla_bugday").every((b) => (b.boy < 4 ? b.sprite.ad === "bugday_tarlasi" : b.sprite.ad.startsWith("hammadde_boy4")))).toBe(true);
    expect(z.binalar.find((b) => b.tur === "sehir")!.sprite.ad).toBe("belediye");
    expect(z.binalar.find((b) => b.tur === "ahir")!.sprite.ad).toBe("ahir");
    expect(z.binalar.filter((b) => b.tur === "lonca").every((b) => b.sprite.ad === "lonca")).toBe(true);
    for (const g of z.genislemeler) expect(["cimen", "otopark", "arsa"]).toContain(g.tur);
  });
});

describe("izoSahne şehir kurumları (Liman, İhracat)", () => {
  const YONLER = ["kuzey", "dogu", "guney", "bati"] as const;
  /** Nehir kenarına komşu, park olmayan kenar (nehir - 1) ve nehre doğru yön (+1: artan c/r). */
  const KOMSU = { kuzey: { kenar: "bati", d: -1 }, dogu: { kenar: "kuzey", d: 1 }, guney: { kenar: "dogu", d: 1 }, bati: { kenar: "guney", d: -1 } } as const;
  const kurumlar = (z: IzoSahne): { liman: IzoBina; ihracat: IzoBina } => ({ liman: z.binalar.find((b) => b.tur === "liman")!, ihracat: z.binalar.find((b) => b.tur === "ihracat")! });
  /** Kenar boyunca koordinat (c ya da r) ve kenara dik koordinat. */
  const eksen = (kenar: string, h: Hucre): { boyunca: number; dik: number } => (kenar === "kuzey" || kenar === "guney" ? { boyunca: h.c, dik: h.r } : { boyunca: h.r, dik: h.c });

  it("her_sehirde_tek_liman_ve_tek_ihracat_binasi_kurum_referansiyla", () => {
    for (const t of ARTAN_TOHUMLAR) for (const n of [1, 30]) {
      const z = kur(n, { tohum: t, loncalar: 2 });
      const { liman, ihracat } = kurumlar(z);
      expect(z.binalar.filter((b) => b.tur === "liman")).toHaveLength(1);
      expect(z.binalar.filter((b) => b.tur === "ihracat")).toHaveLength(1);
      expect(liman.ref).toEqual({ kind: "kurum", ref: "liman" });
      expect(ihracat.ref).toEqual({ kind: "kurum", ref: "ihracat" });
      expect(liman.sahne.tur).toBe("liman");
      expect(ihracat.sahne.tur).toBe("ihracat");
      expect(liman.id).not.toBe(ihracat.id);
      for (const b of [liman, ihracat]) { expect(b.boy).toBe(1); expect(b.hucre2).toBeNull(); expect(b.durum).toBe("uretim"); expect(b.kapali).toBe(false); }
    }
  });

  it("sprite_liman_kurumu_gemili_liman_ihracat_gumruk_ve_isletme_listesine_girmez", () => {
    const z = kur(20);
    const { liman, ihracat } = kurumlar(z);
    expect(liman.sprite.ad).toBe("liman_tekil");
    expect(ihracat.sprite.ad).toBe("gumruk_tekil");
    expect(isletmeler(z).some((b) => b.id === liman.id || b.id === ihracat.id)).toBe(false);
    expect(z.kaynak.binalar.some((b) => b.tur === ("liman" as string))).toBe(false);          // klasik sahne kurum taşımaz
  });

  it("liman_nehre_komsu_cerceve_kenarinda_kapi_yaninda_ihracat_ayni_kenarda_ya_da_karsi_kenarda", () => {
    let ayniKenar = 0;
    for (const t of ARTAN_TOHUMLAR) for (const n of [1, 30]) {
      const z = kur(n, { tohum: t, loncalar: 6 });
      const { liman, ihracat } = kurumlar(z);
      const nehir = z.zemin.seritler.find((s) => s.tur === "nehir")!;
      const { kenar } = KOMSU[nehir.yon];
      const karsi = ({ kuzey: "guney", guney: "kuzey", dogu: "bati", bati: "dogu" } as const)[nehir.yon];
      const { kapsam } = z.zemin;
      const dikOf = (y: string): number => ({ kuzey: kapsam.r0 - 0.5, guney: kapsam.r1 + 0.5, dogu: kapsam.c1 + 0.5, bati: kapsam.c0 - 0.5 })[y]!;
      const kenarOf = (b: IzoBina): string => [kenar, karsi].find((y) => Math.abs(eksen(y, b.hucre).dik - dikOf(y)) < EPS)!;
      const kapiKayma = (b: IzoBina): number => eksen(kenarOf(b), b.hucre).boyunca - eksen(kenarOf(b), z.zemin.kapilar.find((k) => k.yon === kenarOf(b))!.hucre).boyunca;
      expect(kenarOf(liman), `${t}/${n} Liman nehre komşu kenarda`).toBe(kenar);
      expect([kenar, karsi], `${t}/${n}`).toContain(kenarOf(ihracat));
      for (const b of [liman, ihracat]) {
        expect(YONLER.filter((y) => y === kenarOf(b))).toHaveLength(1);
        expect(z.zemin.seritler.some((s) => s.yon === kenarOf(b)), `${t} ${b.id} şeritsiz kenar`).toBe(false);
        expect(Math.abs(kapiKayma(b)), `${t}/${n} ${b.id} kapı yanında`).toBeLessThanOrEqual(4 + EPS);
        expect(Math.abs(kapiKayma(b)), `${t}/${n} ${b.id}`).toBeGreaterThanOrEqual(1 - EPS);
      }
      if (kenarOf(ihracat) === kenar) {
        ayniKenar++;
        // aynı kenarda: İhracat Liman'dan nehirden daha uzakta değil, kapıdan ters yönde ya da Liman'ın ötesinde (nehre doğru sıra: önce yakın aday)
        expect(Math.abs(kapiKayma(liman)) <= Math.abs(kapiKayma(ihracat)) || Math.sign(kapiKayma(liman)) !== Math.sign(kapiKayma(ihracat)), `${t}/${n}`).toBe(true);
      }
    }
    expect(ayniKenar).toBeGreaterThan(10);
  });

  it("hicbir_tohumda_serit_yol_kapi_belediye_ahir_lonca_isletme_ya_da_birbiriyle_cakismaz", () => {
    for (const t of ARTAN_TOHUMLAR) for (const n of [5, 60]) {
      const z = kur(n, { tohum: t, loncalar: 6, gorsel: (id, b) => (id.endsWith("1") ? 4 : b) });
      const yb = yolAgi(z);
      const seritler = z.zemin.seritler.flatMap(serit);
      const { liman, ihracat } = kurumlar(z);
      for (const b of [liman, ihracat]) {
        const k = kare(b.hucre);
        expect(yolaDegiyor(k, yb), `${t} ${b.id} yol`).toBe(false);
        expect(seritler.some((s) => kesisir(k, s)), `${t} ${b.id} şerit`).toBe(false);
        for (const kapi of z.zemin.kapilar) expect(kesisir(k, kare(kapi.hucre)), `${t} ${b.id} kapı`).toBe(false);
        for (const o of z.binalar) if (o !== b) for (const p of ayakIzi(o)) expect(kesisir(k, p), `${t} ${b.id}/${o.id}`).toBe(false);
      }
    }
  });

  it("kurum_yeri_kalici_yerlesim_ve_firma_sayisindan_bagimsiz_firma_yerlesimi_degismez", () => {
    for (const t of ARTAN_TOHUMLAR.slice(0, 12)) {
      const a = kur(10, { tohum: t });
      const b = kur(11, { tohum: t });                                    // aynı kademe: çerçeve aynı
      expect(a.kaynak.kademe).toBe(b.kaynak.kademe);
      for (const ad of ["liman", "ihracat"] as const) expect(kurumlar(a)[ad].hucre).toEqual(kurumlar(b)[ad].hucre);
      const yerlesimli = izoSahneKur(sehirSahnesi(paketOf(3), verisi(10), ctxOf({ yerlesim: new Map() })), m, t, ozdes);
      for (const ad of ["liman", "ihracat"] as const) expect(kurumlar(yerlesimli)[ad].hucre).toEqual(kurumlar(a)[ad].hucre);
      expect(parselOf(yerlesimli)).toEqual(parselOf(a));                  // kurumlar işletme yuvalarına dokunmaz
    }
  });

  it("lojistik_firmasi_kurum_limani_sprite_i_almaz", () => {
    const gercek = path.resolve(process.cwd(), "public/oyun-sprite/manifest.json");
    if (!fs.existsSync(gercek)) return;
    const mg = manifestCoz(JSON.parse(fs.readFileSync(gercek, "utf8")));
    for (const boy of [1, 2, 3, 4] as const) expect(binaSpriteSec(mg, "lojistik", boy, "s0_lojistik0").ad, `boy ${boy}`).toBe(`lojistik_boy${boy}`);
    const z = kur(40, { man: mg, loncalar: 3 });
    const { liman, ihracat } = kurumlar(z);
    expect(liman.sprite.ad).toBe("liman");
    expect(ihracat.sprite.ad).toBe("gumruk");
    expect(isletmeler(z).filter((b) => b.sahne.etiket === "lojistik").every((b) => b.sprite.ad !== "liman")).toBe(true);
  });
});

function parselOf(z: IzoSahne): Record<string, string | null> {
  return Object.fromEntries(isletmeler(z).map((b) => [b.id, b.sahne.parsel]));
}

describe("kurum yeri bulunamazsa", () => {
  it("kurumYerleri_atmaz_bos_dondurur_ve_uyari_loglar", () => {
    // 1x1 kapsam: kenar boyunca kapıdan kayık hiçbir aday sığmaz
    const dar = { ro: 0.26, yollar: [], blokZemini: [], parselZemini: [], cerceve: [], seritler: [], kapilar: [], kapsam: { c0: 0, c1: 1, r0: 0, r1: 1 }, kutu: { c0: 0, c1: 1, r0: 0, r1: 1 } } as unknown as Parameters<typeof kurumYerleri>[0];
    const uyari = vi.spyOn(console, "warn").mockImplementation(() => {});
    let yer: ReturnType<typeof kurumYerleri> | undefined;
    expect(() => { yer = kurumYerleri(dar, [], 901); }).not.toThrow();
    kurumYerleri(dar, [], 901); // aynı şehir: ikinci uyarı yok
    kurumYerleri(dar, [], 902); // başka şehir: kendi uyarısı
    expect(yer).toEqual({ liman: null, ihracat: null });
    expect(uyari).toHaveBeenCalledTimes(2);
    expect(String(uyari.mock.calls[0]![0])).toContain("kurum-yeri");
    uyari.mockRestore();
  });
});
