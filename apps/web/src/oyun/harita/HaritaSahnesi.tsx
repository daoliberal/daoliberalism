"use client";
// B7 (CSP): Pixi shader uniform senkronu `new Function` ile uretilir; bu paket onu `unsafe-eval` GEREKTIRMEYEN esdegerle degistirir (CSP `script-src` icinde `unsafe-eval` yok).
import "pixi.js/unsafe-eval";
import { Application } from "@pixi/react";
import { Color, Container, Graphics, Sprite, Text, type Application as PixiApp, type FederatedPointerEvent, type Texture } from "pixi.js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@/oyun/copy/t";
import ekranRenkleri from "@/oyun/ekran/ekranRenkleri.module.css";
import { HARITA_TUSLARI, kisayolHedefiUygun } from "@/oyun/screens/canli/kisayolKapsami";
import { adlandirici, type Adlandirici } from "./adlar";
import { katalogKaydi, VARSAYILAN_KATALOG, type BinaKatalogu } from "./binaKatalogu";
import { kaydir, kistir, odakla, tekerlekEylemi, PAYSIZ, sigdir, yakinlastir, type Pay } from "./gorunum";
import { HARITA_STILI, izoCozunurluk, KATMAN_STILI, SEHIR_RENGI, SEHIR_STILI, VARLIK_STILI } from "./haritaStili";
import { IzoCizimi } from "./izoCizimi";
import { IzoIpucu, type IpucuVerisi } from "./IzoIpucu";
import { useAnimasyonTercihi } from "@/oyun/hooks/useOyunTercihleri";
import type { IzoSahne } from "./izoSahne";
import { pixiDokuYap } from "./pixiDoku";
import { spriteDokuKaynakcisi, type SpriteDokuKaynakcisi } from "./spriteDoku";
import type { SpriteManifesti } from "./spriteManifest";
import { SUS_KATALOGU, type SusKimligi } from "./susKatalogu";
import styles from "./SehirHaritasi.module.css";
import { MEYDAN_REF, type BinaBoyu, type Gorunum, type HaritaRef, type Parsel, type Sablon, type SahneBina, type SehirSahnesi, type Sus } from "./tipler";
import { useSpriteManifest } from "./useSpriteManifest";
import { VarlikYukleyici } from "./varlikYukleyici";

const S = HARITA_STILI;
const V = VARLIK_STILI;

/** Sahnenin dokuyu aldığı kaynak (`VarlikYukleyici` ya da test sahtesi). */
export type DokuKaynakcisi = {
  doku(sablon: Sablon, boy: BinaBoyu): Promise<Texture>;
  /** Zemin süsü dokusu; yoksa süsler çizilmez. */
  susDoku?(sus: SusKimligi): Promise<Texture>;
  /** Kullanımda olmayan emekli dokuları yok eder (verilen küme sprite'ların şimdiki dokularıdır). */
  emekliyiAt?(kullanimda: ReadonlySet<Texture>): void;
  /** Bütün dokuları yok eder (çizim sökülürken). */
  yoket?(): void;
};
/** `odak`: `hedef` (sahne koordinatı) serbest alanın ortasına gelir (DAO ilk haftada ahır). */
export type OdakHedefi = { x: number; y: number } | { bina: string };
export type KameraKomutu = { n: number; tur: "yakin" | "uzak" | "sigdir" | "odak"; hedef?: OdakHedefi };

type Havuz = {
  kap: Container;
  plaka: Graphics;
  sprite: Sprite;
  t: Text | null;
  imza: string;
  istek: string;
  ref: HaritaRef;
  /** En son uygulanan bina kaydı (doku gelince güncel konum/ölçü buradan okunur). */
  b: SahneBina;
  tex: Texture | null;
  ax: number;
  ay: number;
  /** Havuzdan çıkarıldı, sprite'ı yok edildi: geç gelen doku artık yazılmaz. */
  gitti: boolean;
};
type SusHavuzu = { sprite: Sprite; istek: string; tex: Texture | null; s: Sus; /** Havuzdan çıkarıldı, sprite'ı yok edildi: geç gelen doku artık yazılmaz. */ gitti: boolean };
type Rozet = { g: Graphics; t: Text; imza: string };

/** Pixi yazı biçimi (tema değişince yeniden uygulanır). */
function yaziBicimi(tx: Text, renk: number, aile: string, boyut: number): void {
  const bicim = tx.style;
  bicim.fill = renk;
  bicim.fontFamily = aile;
  bicim.fontSize = boyut;
}

/**
 * Bina sprite'ının tek yerleşim hesabı: ölçek (çizim genişliği = taban x çarpan, işletmede parsel genişliğiyle sınırlı), çapa, konum ve
 * sahne koordinatındaki kutu. `yerlestir` (çizim) ve `binaKutusu` (seçimde kamera payı) aynı sonucu kullanır.
 */
export function binaSpriteYerlesimi(b: SahneBina, tex: { width: number; height: number }, katalog: BinaKatalogu = VARSAYILAN_KATALOG) {
  const w = Math.min(b.taban.g * V.genislikCarpani, b.parsel !== null ? SEHIR_STILI.parsel.genislik : Infinity);
  const h = (w * tex.height) / tex.width;
  const capa = katalogKaydi(b.sablon, b.boyut, katalog).capa;
  const x = b.x;
  const y = b.y + b.taban.d / 2;
  const sol = x - capa.x * w;
  const ust = y - capa.y * h;
  return { olcek: w / tex.width, capa, x, y, sol, sag: sol + w, ust, alt: ust + h };
}

const ayniRef = (a: HaritaRef | null, b: HaritaRef): boolean => a !== null && a.kind === b.kind && a.ref === b.ref;

/**
 * Tek şehir sahnesi. Zemin + sokak + parsel + meydan bir kez çizilir (tema ya da ölçü değişince yenilenir);
 * her bina bir `Container` (taban plakası + Sprite) ve `id` anahtarlı havuzda yaşar; rozetler ve en üstte etiketler.
 * Katman tonu bina tabanındaki plakaya yazılır (resimler tonlanmaz). Ticker yalnız animasyon (geçiş, duman) varken açılır; kapalıyken her değişiklikte `app.render()`.
 */
export class SehirCizimi {
  readonly dunya = new Container();
  private readonly zemin = new Graphics();
  /** Zeminin tıklanabilir yerleri: meydan ve (açıksa) boş parseller. Binalar bunun üstündedir, tıklamayı önce onlar alır. */
  private readonly yerKat = new Container();
  private readonly parselDugmeleri = new Map<string, Graphics>();
  private meydanDugmesi: Graphics | null = null;
  /** Zemin süsleri: zeminin üstünde, binaların altında; seçilemez. */
  private readonly susKat = new Container();
  private readonly binaKat = new Container();
  private readonly rozetKat = new Container();
  /** Bütün etiketler binaların ve rozetlerin üstündedir. */
  private readonly etiketKat = new Container();
  private readonly binalar = new Map<string, Havuz>();
  private readonly susler = new Map<string, SusHavuzu>();
  private readonly rozetler = new Map<string, Rozet>();
  private imzaZemin = "";
  private oldu = false;
  private hataBildirildi = false;
  tasidi = false;
  /** Bir bina dokusu geldiğinde o binanın ref'iyle çağrılır (seçili binanın kamera payı doku boyutuyla yeniden hesaplansın; başkasının dokusu kamerayı oynatmaz). */
  onDoku: ((ref: HaritaRef) => void) | null = null;

  constructor(
    private readonly app: PixiApp,
    private readonly tiklama: (r: HaritaRef) => void,
    private readonly dokular: DokuKaynakcisi,
    private readonly kok: () => Element,
    private readonly hata: (e: unknown) => void,
    private readonly katalog: BinaKatalogu = VARSAYILAN_KATALOG,
  ) {
    this.etiketKat.eventMode = S.etiketKatmani.olayModu;
    this.dunya.addChild(this.zemin, this.yerKat, this.susKat, this.binaKat, this.rozetKat, this.etiketKat);
    app.stage.addChild(this.dunya);
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
  }

  /** `.kok` öğesinin computed stilinden `--harita-*` değeri. */
  private deger(ad: string): string {
    return getComputedStyle(this.kok()).getPropertyValue(ad).trim();
  }
  private renk(ad: string): number {
    const v = this.deger(ad);
    return new Color(v === "" ? S.yedek.renk : v).toNumber();
  }

  guncelle(sahne: SehirSahnesi, secili: HaritaRef | null, g: Gorunum, tema: number, adlar: Adlandirici): void {
    const { app } = this;
    app.renderer.background.color = this.renk(SEHIR_RENGI.zemin);
    this.zeminCiz(sahne, tema);
    const aile = this.deger(SEHIR_RENGI.yazi) || S.yedek.aile;
    const yaz = (tx: Text | null, metin: string, boyut: number, ortala: boolean): Text => {
      const x = tx ?? new Text({ text: metin, style: { fontFamily: aile, fontSize: boyut, fill: this.renk(SEHIR_RENGI.etiket) } });
      if (tx === null) this.etiketKat.addChild(x);
      x.text = metin;
      yaziBicimi(x, this.renk(SEHIR_RENGI.etiket), aile, boyut);
      x.anchor.set(ortala ? 0.5 : 0, 0);
      return x;
    };

    this.yerleriGuncelle(sahne, secili);
    this.suslariGuncelle(sahne, tema);

    const gorunen = new Set<string>();
    for (const b of [...sahne.binalar, sahne.sehirBinasi, sahne.ahir]) {
      gorunen.add(b.id);
      const sec = ayniRef(secili, b.ref);
      const ben = sahne.ben?.binaId === b.id;
      const ilan = (sahne.ilanVeren?.has(b.id) ?? false);
      const ton = sahne.katman.tonlar.get(b.id);
      let h = this.binalar.get(b.id);
      if (!h) {
        h = this.binaYap(b);
        this.binalar.set(b.id, h);
      }
      h.ref = b.ref;
      h.b = b;
      const imza = [b.sablon, b.boyut, b.x, b.y, b.taban.g, b.taban.d, adlar.bina(b), sec, ben, ilan, ton ?? "", tema, sahne.ben?.neden ?? ""].join("|");
      if (h.imza === imza) continue;
      h.imza = imza;
      this.plakaCiz(h, b, sec, ben, ton, ilan);
      this.dokuIste(h, b, tema);
      this.yerlestir(h);
      const metin = ben && sahne.ben ? t(sahne.ben.neden === "isyeri" ? "harita.senin_isyerin" : sahne.ben.neden === "isletme" ? "harita.senin_isletmen" : "harita.senin_yerin") : adlar.bina(b);
      if (S.etiket.bina[b.tur] || sec || ben) {
        h.t = yaz(h.t, metin, b.tur === "sehir" ? V.etiket.sehirBoyut : V.etiket.boyut, true);
        h.ax = b.x;
        h.ay = b.y + b.taban.d / 2;
      } else if (h.t) {
        h.t.destroy();
        h.t = null;
      }
    }
    for (const [k, h] of this.binalar) if (!gorunen.has(k)) { h.gitti = true; h.kap.destroy({ children: true }); h.t?.destroy(); this.binalar.delete(k); }

    // Rozetler (işsizlik katmanı): sayı yalnız sayıdır, insan çizilmez.
    const rozetAnahtar = new Set<string>();
    for (const r of sahne.katman.rozetler) {
      const hedef = r.hedef === "sehir" ? { x: sahne.sehirBinasi.x, y: sahne.sehirBinasi.y - sahne.sehirBinasi.taban.d / 2 - V.rozet.yBosluk } : { x: sahne.meydan.x, y: sahne.meydan.y };
      const anahtar = r.hedef;
      rozetAnahtar.add(anahtar);
      let z = this.rozetler.get(anahtar);
      if (!z) {
        z = { g: new Graphics(), t: yaz(null, "", V.rozet.yaziBoyut, true), imza: "" };
        z.t.anchor.set(0.5, 0.5);
        this.rozetKat.addChild(z.g);
        this.rozetler.set(anahtar, z);
      }
      const imza = [r.sayi, hedef.x, hedef.y, tema].join("|");
      if (z.imza === imza) continue;
      z.imza = imza;
      const metin = String(r.sayi);
      z.t = yaz(z.t, metin, V.rozet.yaziBoyut, true);
      z.t.anchor.set(0.5, 0.5);
      yaziBicimi(z.t, this.renk(SEHIR_RENGI.rozetYazi), aile, V.rozet.yaziBoyut);
      z.t.position.set(hedef.x, hedef.y);
      const gen = Math.max(2 * V.rozet.yaricap, metin.length * V.rozet.yaziBoyut * 0.7 + V.rozet.yaricap);
      z.g.clear().roundRect(hedef.x - gen / 2, hedef.y - V.rozet.yaricap, gen, 2 * V.rozet.yaricap, V.rozet.yaricap).fill(this.renk(SEHIR_RENGI.rozet));
    }
    for (const [k, z] of this.rozetler) if (!rozetAnahtar.has(k)) { z.g.destroy(); z.t.destroy(); this.rozetler.delete(k); }

    // Etiketler ekranda sabit boyutta kalır.
    const ters = 1 / g.olcek;
    for (const h of this.binalar.values()) {
      if (!h.t) continue;
      h.t.scale.set(ters);
      h.t.position.set(h.ax, h.ay + V.etiket.bosluk * ters);
    }
    for (const z of this.rozetler.values()) z.t.scale.set(ters);
    this.dunya.position.set(g.x, g.y);
    this.dunya.scale.set(g.olcek);
    app.render();
  }

  /** Meydan zemini ve boş parseller: seçilebilir, seçiliyse kalın kenarlıkla işaretlenir. Süsler ve binalar bunların üstündedir. */
  private yerleriGuncelle(sahne: SehirSahnesi, secili: HaritaRef | null): void {
    const kalinlik = V.taban.seciliKalinlik;
    const renk = this.renk(SEHIR_RENGI.secili);
    if (this.meydanDugmesi === null) {
      const g = new Graphics();
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointertap", () => {
        if (!this.tasidi) this.tiklama({ kind: "lonca", ref: MEYDAN_REF });
      });
      this.yerKat.addChild(g);
      this.meydanDugmesi = g;
    }
    const m = sahne.meydan;
    this.meydanDugmesi.hitArea = { contains: (x: number, y: number) => (x - m.x) ** 2 + (y - m.y) ** 2 <= m.yaricap ** 2 };
    this.meydanDugmesi.clear();
    if (secili?.kind === "lonca" && secili.ref === MEYDAN_REF) this.meydanDugmesi.circle(m.x, m.y, m.yaricap).stroke({ width: kalinlik, color: renk });

    const gorunen = new Set<string>();
    for (const p of sahne.bosParseller ?? []) {
      gorunen.add(p.id);
      let g = this.parselDugmeleri.get(p.id);
      if (!g) {
        g = new Graphics();
        g.eventMode = "static";
        g.cursor = "pointer";
        const id = p.id;
        g.on("pointertap", () => {
          if (!this.tasidi) this.tiklama({ kind: "parsel", ref: id });
        });
        this.yerKat.addChild(g);
        this.parselDugmeleri.set(p.id, g);
      }
      this.parselKutusu(g, p, secili?.kind === "parsel" && secili.ref === p.id, kalinlik, renk);
    }
    for (const [k, g] of this.parselDugmeleri) if (!gorunen.has(k)) { g.destroy(); this.parselDugmeleri.delete(k); }
  }

  private parselKutusu(g: Graphics, p: Parsel, secili: boolean, kalinlik: number, renk: number): void {
    const sol = p.x - p.genislik / 2;
    const ust = p.y - p.yukseklik / 2;
    g.hitArea = { contains: (x: number, y: number) => x >= sol && x <= sol + p.genislik && y >= ust && y <= ust + p.yukseklik };
    g.clear();
    if (secili) g.roundRect(sol, ust, p.genislik, p.yukseklik, V.taban.kose).stroke({ width: kalinlik, color: renk });
  }

  /** Süsler: kimlik anahtarlı havuz; konum ve tür değişince yenilenir. Seçilemez (olay yok), tonlanmaz. */
  private suslariGuncelle(sahne: SehirSahnesi, tema: number): void {
    const gorunen = new Set<string>();
    for (const s of sahne.susler) {
      gorunen.add(s.id);
      let h = this.susler.get(s.id);
      if (!h) {
        const sprite = new Sprite();
        sprite.eventMode = "none";
        this.susKat.addChild(sprite);
        h = { sprite, istek: "", tex: null, s, gitti: false };
        this.susler.set(s.id, h);
      }
      h.s = s;
      const istek = `${s.tur}|${tema}`;
      if (h.istek !== istek) {
        h.istek = istek;
        const al = this.dokular.susDoku;
        if (al) {
          const hh = h;
          al.call(this.dokular, s.tur).then(
            (tex) => {
              if (this.oldu || hh.gitti || hh.istek !== istek) return;
              hh.tex = tex;
              this.susYerlestir(hh);
              // Önce çiz, sonra eski dokuları yok et: Pixi toplu çizim listesi yeni doku atamasından sonraki ilk çizimde yenilenir; yok edilmiş dokuyu hâlâ bağlamaya çalışırsa çizim hata verir.
              this.app.render();
              this.dokular.emekliyiAt?.(this.kullanimdakiler());
            },
            (e: unknown) => {
              if (this.oldu || this.hataBildirildi) return;
              this.hataBildirildi = true;
              this.hata(e);
            },
          );
        }
      }
      this.susYerlestir(h);
    }
    for (const [k, h] of this.susler) if (!gorunen.has(k)) { h.gitti = true; h.sprite.destroy(); this.susler.delete(k); }
  }

  private susYerlestir(h: SusHavuzu): void {
    const { sprite, tex, s } = h;
    if (tex === null) return;
    const kayit = SUS_KATALOGU[s.tur];
    sprite.texture = tex;
    sprite.scale.set(s.taban.g / tex.width);
    sprite.anchor.set(kayit.capa.x, kayit.capa.y);
    sprite.position.set(s.x, s.y);
  }

  private zeminCiz(sahne: SehirSahnesi, tema: number): void {
    const imza = [sahne.sehir, sahne.genislik, sahne.yukseklik, sahne.sokaklar.length, sahne.parseller.length, sahne.meydan.x, sahne.meydan.y, sahne.meydan.yaricap, tema].join("|");
    if (this.imzaZemin === imza) return;
    this.imzaZemin = imza;
    const z = this.zemin.clear();
    for (const p of sahne.parseller) z.roundRect(p.x - p.genislik / 2, p.y - p.yukseklik / 2, p.genislik, p.yukseklik, V.taban.kose).fill(this.renk(SEHIR_RENGI.parsel));
    for (const k of sahne.sokaklar) z.rect(k.x, k.y, k.genislik, k.yukseklik).fill(this.renk(k.ana ? SEHIR_RENGI.sokakAna : SEHIR_RENGI.sokak));
    z.circle(sahne.meydan.x, sahne.meydan.y, sahne.meydan.yaricap).fill(this.renk(SEHIR_RENGI.meydan));
  }

  private binaYap(b: SahneBina): Havuz {
    const kap = new Container();
    kap.eventMode = "static";
    kap.cursor = "pointer";
    const plaka = new Graphics();
    const sprite = new Sprite();
    kap.addChild(plaka, sprite);
    const id = b.id;
    kap.on("pointertap", () => {
      const son = this.binalar.get(id);
      if (son && !this.tasidi) this.tiklama(son.ref);
    });
    this.binaKat.addChild(kap);
    return { kap, plaka, sprite, t: null, imza: "", istek: "", ref: b.ref, b, tex: null, ax: b.x, ay: b.y, gitti: false };
  }

  private plakaCiz(h: Havuz, b: SahneBina, sec: boolean, ben: boolean, ton: string | undefined, ilan: boolean): void {
    const p = h.plaka.clear();
    if (!ton && !sec && !ben && !ilan) return;
    const w = b.taban.g + 2 * V.taban.pay;
    const d = b.taban.d + 2 * V.taban.pay;
    p.roundRect(b.x - w / 2, b.y - d / 2, w, d, V.taban.kose);
    if (ton) p.fill(this.renk(KATMAN_STILI.ton[ton as keyof typeof KATMAN_STILI.ton]));
    else if (ilan) p.fill({ color: this.renk(SEHIR_RENGI.ilan), alpha: V.taban.ilanDolgu });
    if (ilan && !ben && !sec) p.stroke({ width: V.taban.ilanKalinlik, color: this.renk(SEHIR_RENGI.ilan) });
    if (ben || sec) p.stroke({ width: ben ? V.taban.benKalinlik : V.taban.seciliKalinlik, color: this.renk(ben ? SEHIR_RENGI.ben : SEHIR_RENGI.secili) });
  }

  /** Binanın sahne koordinatındaki çizim kutusu (çizilen sprite ile aynı yardımcıdan: `binaSpriteYerlesimi`). Doku yoksa kare varsayılır. */
  binaKutusu(b: SahneBina): { sol: number; sag: number; ust: number; alt: number } {
    const tex = this.binalar.get(b.id)?.tex;
    const y = binaSpriteYerlesimi(b, tex ? { width: tex.width, height: tex.height } : { width: 1, height: 1 }, this.katalog);
    return { sol: y.sol, sag: y.sag, ust: y.ust, alt: y.alt };
  }

  /** Sprite'ı güncel bina kaydına göre ölçekler ve yerleştirir (doku yoksa bekler). */
  private yerlestir(h: Havuz): void {
    const { sprite, tex, b } = h;
    if (tex === null) return;
    sprite.texture = tex;
    const y = binaSpriteYerlesimi(b, { width: tex.width, height: tex.height }, this.katalog);
    sprite.scale.set(y.olcek);
    sprite.anchor.set(y.capa.x, y.capa.y);
    sprite.position.set(y.x, y.y);
  }

  private kullanimdakiler(): Set<Texture> {
    const k = new Set<Texture>();
    for (const h of this.binalar.values()) if (h.tex) k.add(h.tex);
    for (const h of this.susler.values()) if (h.tex) k.add(h.tex);
    return k;
  }

  private dokuIste(h: Havuz, b: SahneBina, tema: number): void {
    const istek = `${b.sablon}|${b.boyut}|${tema}`;
    if (h.istek === istek) return;
    h.istek = istek;
    this.dokular.doku(b.sablon, b.boyut).then(
      (tex) => {
        if (this.oldu || h.gitti || h.istek !== istek) return;
        h.tex = tex;
        this.yerlestir(h);
        this.onDoku?.(h.b.ref);
        // Önce çiz, sonra eski dokuları yok et (bkz. süs dokusu): yok edilmiş dokuyu bağlayan çizim hata verir.
        this.app.render();
        this.dokular.emekliyiAt?.(this.kullanimdakiler());
      },
      (e: unknown) => {
        if (this.oldu || this.hataBildirildi) return;
        this.hataBildirildi = true;
        this.hata(e);
      },
    );
  }

  yoket(): void {
    this.oldu = true;
    this.dokular.yoket?.();
    this.dunya.destroy({ children: true });
    this.binalar.clear();
    this.susler.clear();
    this.rozetler.clear();
    this.parselDugmeleri.clear();
    this.meydanDugmesi = null;
  }
}

type Props = {
  /** Etkin sahne: klasik `SehirSahnesi` ya da izometrik `IzoSahne` (`kaynak` alanı olan). */
  sahne: SehirSahnesi | IzoSahne;
  secili: HaritaRef | null;
  onSec(r: HaritaRef | null): void;
  kamera: Gorunum;
  onKamera(g: Gorunum): void;
  /** Yaklaştır/uzaklaştır/sığdır düğmeleri için: `n` her komutta artar. */
  komut?: KameraKomutu | null;
  adlar?: Adlandirici;
  /** Yüzen öğelerin (üst şerit, alt şerit) kapladığı kenar payları; sığdırma bu payların içine yapılır. */
  pay?: Pay;
  /** Doku yükleme ya da çizim hatası: üst bileşen tablo yedeğini açar. */
  onHata?(e: unknown): void;
  /** İzo çiziminde sprite/doku hatası: verilirse üst bileşen klasik görünüme düşer (verilmezse `onHata`). */
  onSpriteHatasi?(): void;
  /** Test için: doku kaynağı ve katalog (varsayılan: gerçek yükleyici). Kararlı referans olmalı (modül sabiti ya da useMemo): değişirse çizim baştan kurulur. */
  dokular?: DokuKaynakcisi;
  katalog?: BinaKatalogu;
  /** Test için: izo sprite doku kaynağı ve manifest (varsayılan: gerçek yükleyici ve modül önbelleğindeki manifest). */
  spriteDokular?: SpriteDokuKaynakcisi;
  manifest?: SpriteManifesti;
};

const izoMu = (s: SehirSahnesi | IzoSahne): s is IzoSahne => "kaynak" in s;
/** Tuval çözünürlüğü: izo modunda DPR `IZO_STILI.performans.dprUst` ile sınırlıdır (klasik değişmez). */
const cozunurluk = (izo: boolean): number => (typeof window === "undefined" ? 1 : izoCozunurluk(window.devicePixelRatio, izo));
/** Renderer çözünürlüğü farklıysa günceller (Pixi kendiliğinden yeniden boyutlar); aynıysa dokunmaz. */
function cozunurlukUygula(app: PixiApp, r: number): void {
  if (app.renderer.resolution !== r) app.renderer.resolution = r;
}
/** Kamera sınırları ve sığdırma için dünya ölçüsü. */
const dunyaBoyutu = (s: SehirSahnesi | IzoSahne): { genislik: number; yukseklik: number } => (izoMu(s) ? s.dunya : { genislik: s.genislik, yukseklik: s.yukseklik });

/**
 * Odak hedefini ETKİN sahnenin koordinatına çevirir. Hedef bina kimliğiyle (`{ bina }`: ahır, oyuncunun işletmesi...) verilirse etkin sahnede o binanın
 * konumu bulunur (izometrik: hücrenin dünya konumu = `ekran` + `kaydirma`; klasik: `x, y`); bulunamazsa null. `{ x, y }` olduğu gibi kalır.
 */
export function odakHedefi(sahne: SehirSahnesi | IzoSahne, hedef: OdakHedefi): { x: number; y: number } | null {
  if (!("bina" in hedef)) return hedef;
  if (izoMu(sahne)) {
    const ib = sahne.binalar.find((b) => b.id === hedef.bina);
    return ib ? { x: ib.ekran.x + sahne.kaydirma.x, y: ib.ekran.y + sahne.kaydirma.y } : null;
  }
  const b = [...sahne.binalar, sahne.sehirBinasi, sahne.ahir].find((x) => x.id === hedef.bina);
  return b ? { x: b.x, y: b.y } : null;
}

const VARSAYILAN_ADLAR = adlandirici();
/** Koyu tema mı? `data-theme` açıkça verilmişse o, yoksa sistem tercihi. */
function koyuMu(): boolean {
  const k = document.documentElement.getAttribute("data-theme");
  if (k !== null) return k === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}
const kokBul = (el: Element | null): Element | null => el?.closest(`.${ekranRenkleri.kok}`) ?? null;

/** Tek şehir tuvali (yalnız WebGL varken `next/dynamic` ile yüklenir). Ticker yalnız animasyon varken açık (üretimdeki bacalı bina görünürken 30 fps); animasyon yoksa boşta CPU sıfır. */
export function SehirTuvali({ sahne, secili, onSec, kamera, onKamera, komut = null, adlar = VARSAYILAN_ADLAR, pay = PAYSIZ, onHata, onSpriteHatasi, dokular, katalog, spriteDokular, manifest: manifestProp }: Props) {
  const kap = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<PixiApp | null>(null);
  const cizim = useRef<SehirCizimi | IzoCizimi | null>(null);
  const izo = izoMu(sahne);
  // Hareket tercihi (sistem + uygulama içi "azalt") ve düşük performans: çizici animasyon modunu bunlardan çözer.
  const tercih = useAnimasyonTercihi();
  const hareket = useMemo(() => ({ etkinAzalt: tercih.etkinAzalt, dusukPerformans: tercih.dusukPerformans }), [tercih.etkinAzalt, tercih.dusukPerformans]);
  const { manifest: modulManifesti } = useSpriteManifest(izo && manifestProp === undefined);
  const manifest = manifestProp ?? modulManifesti;
  const izoHazir = izo && manifest !== null;
  const [tema, setTema] = useState(0);
  const [boyut, setBoyut] = useState(0);
  const [dokuSurumu, setDokuSurumu] = useState(0);
  // Görünüm modu tuval açıkken değişirse çözünürlük de (izo: DPR üst sınırı) yeni moda uyar; renderer yalnız fark varsa yeniden boyutlanır.
  useEffect(() => {
    if (app === null) return;
    cozunurlukUygula(app, cozunurluk(izo));
  }, [app, izo]);
  const dokundu = useRef(false);
  const ipucuId = useId();
  /** Hover ya da dokunuş ipucu (izo): veri ve gösterildiği andaki tuval kutusu. */
  const [ipucu, setIpucu] = useState<{ veri: IpucuVerisi; kutu: { genislik: number; yukseklik: number }; dokunma: boolean } | null>(null);
  const uyardi = useRef(false);
  const son = useRef({ kamera, onSec, onKamera, onHata, onSpriteHatasi, sahne, secili });
  /** Son hesaplanan kamera: üst bileşen yeniden çizmeden gelen ardışık olaylar bayat prop'a değil buna göre birikimli hesaplanır. */
  const guncelKamera = useRef(kamera);
  useEffect(() => {
    guncelKamera.current = kamera;
  }, [kamera]);
  const kameraVer = (g: Gorunum): void => {
    guncelKamera.current = g;
    son.current.onKamera(g);
  };
  useEffect(() => {
    son.current = { kamera, onSec, onKamera, onHata, onSpriteHatasi, sahne, secili };
  }, [kamera, onSec, onKamera, onHata, onSpriteHatasi, sahne, secili]);

  const temaRef = useRef(0);
  useEffect(() => {
    temaRef.current = tema;
  }, [tema]);

  // Kutu ölçüsü: Pixi `screen` kutu değişiminden bir kare sonra güncellenir (ilk açılışta varsayılan boyutta kalabilir);
  // bu yüzden gerçek kapsayıcı ölçüsü esastır, ölçü yoksa (ya da ölçülemiyorsa) `screen`.
  const kutuOf = (a: PixiApp): { genislik: number; yukseklik: number } => {
    const el = kap.current;
    return el !== null && el.clientWidth > 0 && el.clientHeight > 0 ? { genislik: el.clientWidth, yukseklik: el.clientHeight } : { genislik: a.screen.width, yukseklik: a.screen.height };
  };
  const dunyaOf = (): { genislik: number; yukseklik: number } => dunyaBoyutu(son.current.sahne);

  useEffect(() => {
    if (app === null) return;
    // İzo sahne ama manifest henüz yok: çizim kurulmaz (üst bileşen "bekle" iken klasik sahne verir).
    if (izo && !izoHazir) return;
    const kokOf = (): Element => {
      const k = kokBul(kap.current);
      if (k) return k;
      if (!uyardi.current) {
        uyardi.current = true;
        console.warn("harita: `ekran/ekranRenkleri` .kok sınıflı üst öğe yok; --harita-* değerleri okunamıyor (renkler yedek).");
      }
      return document.documentElement;
    };
    let c: SehirCizimi | IzoCizimi;
    if (izo) {
      c = new IzoCizimi(app, (r) => son.current.onSec(r), spriteDokular ?? spriteDokuKaynakcisi(), kokOf, (e) => {
        const bildir = son.current.onSpriteHatasi;
        if (bildir) bildir();
        else son.current.onHata?.(e);
      }, manifest!);
    } else {
      const yukleyici: DokuKaynakcisi =
        dokular ??
        new VarlikYukleyici<Texture>({
          renk: (ad) => getComputedStyle(kokBul(kap.current) ?? document.documentElement).getPropertyValue(ad).trim(),
          getir: async (yol) => {
            const r = await fetch(yol);
            if (!r.ok) throw new Error(`${yol}: ${r.status}`);
            return r.text();
          },
          dokuYap: pixiDokuYap,
          tema: () => temaRef.current,
          koyu: () => koyuMu(),
          dokuYoket: (d) => d.destroy(true),
          ...(katalog ? { katalog } : {}),
        });
      c = new SehirCizimi(app, (r) => son.current.onSec(r), yukleyici, kokOf, (e) => son.current.onHata?.(e), katalog);
    }
    if (c instanceof IzoCizimi) {
      c.onHover = (v, dokunma = false) => setIpucu(v === null ? null : { veri: v, kutu: kutuOf(app), dokunma });
    }
    c.onDoku = (ref) => {
      const sec = son.current.secili;
      if (sec !== null && sec.kind === ref.kind && sec.ref === ref.ref) setDokuSurumu((n) => n + 1);
    };
    cizim.current = c;
    // Çoklu işaretçi: tek işaretçi kaydırır, iki işaretçi kıstırır (ortayı sabit tutar + orta kaymasını uygular); üçüncü ve sonrası yok sayılır.
    const basiliOlan = new Map<number, { x: number; y: number }>();
    let basili: { x: number; y: number } | null = null;
    let cift: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    const ciftOku = (): { a: { x: number; y: number }; b: { x: number; y: number } } | null => {
      if (basiliOlan.size !== 2) return null;
      const [a, b] = [...basiliOlan.values()];
      return { a: { ...a! }, b: { ...b! } };
    };
    let dokunma = false;
    const asagi = (e: FederatedPointerEvent): void => {
      const id = e.pointerId ?? 0;
      dokunma = e.pointerType === "touch" || e.pointerType === "pen";
      if (dokunma) setIpucu(null); // yeni dokunuş eski ipucuyu kapatır; bina dokunuşu pointertap'ta yenisini açar
      if (basiliOlan.has(id) || basiliOlan.size >= 2) return;
      basiliOlan.set(id, { x: e.global.x, y: e.global.y });
      if (basiliOlan.size === 1) {
        basili = { x: e.global.x, y: e.global.y };
        c.tasidi = false;
      } else {
        basili = null; // ikinci parmak: kaydırma biter, kıstırma başlar; dokunuş artık tıklama sayılmaz
        cift = ciftOku();
        c.tasidi = true;
      }
    };
    const tasi = (e: FederatedPointerEvent): void => {
      const id = e.pointerId ?? 0;
      const nokta = basiliOlan.get(id);
      if (nokta === undefined) return;
      if (basiliOlan.size === 2) {
        basiliOlan.set(id, { x: e.global.x, y: e.global.y });
        const simdi = ciftOku();
        if (cift === null || simdi === null) { cift = simdi; return; }
        dokundu.current = true;
        c.tasidi = true;
        kameraVer(kistir(guncelKamera.current, cift, simdi, kutuOf(app), dunyaOf()));
        cift = simdi;
        return;
      }
      if (basili === null) return;
      const dx = e.global.x - basili.x;
      const dy = e.global.y - basili.y;
      if (!c.tasidi && Math.hypot(dx, dy) < (dokunma ? S.suruklemeEsigiDokunma : S.suruklemeEsigi)) return;
      basili = { x: e.global.x, y: e.global.y };
      basiliOlan.set(id, basili);
      c.tasidi = true;
      dokundu.current = true;
      setIpucu(null);
      kameraVer(kaydir(guncelKamera.current, dx, dy, kutuOf(app), dunyaOf()));
    };
    const yukari = (e?: FederatedPointerEvent): void => {
      const id = e?.pointerId ?? 0;
      if (!basiliOlan.delete(id)) return;
      cift = null;
      // İkiliden biri kalktı: kalan parmak sıçramadan kaydırmaya devam eder (tıklama yine yutulur: c.tasidi açık kalır).
      const kalan = basiliOlan.size === 1 ? [...basiliOlan.values()][0]! : null;
      basili = kalan === null ? null : { ...kalan };
    };
    const iptal = (): void => {
      basiliOlan.clear();
      basili = null;
      cift = null;
    };
    app.stage.on("pointerdown", asagi).on("pointermove", tasi).on("pointerup", yukari).on("pointerupoutside", yukari).on("pointercancel", iptal);
    const tekerlek = (e: WheelEvent): void => {
      e.preventDefault();
      dokundu.current = true;
      const eylem = tekerlekEylemi(e);
      if (eylem.tur === "kaydir") {
        kameraVer(kaydir(guncelKamera.current, eylem.dx, eylem.dy, kutuOf(app), dunyaOf()));
        return;
      }
      const r = app.canvas.getBoundingClientRect();
      kameraVer(yakinlastir(guncelKamera.current, { x: e.clientX - r.left, y: e.clientY - r.top }, eylem.carpan, kutuOf(app), dunyaOf()));
    };
    app.canvas.addEventListener("wheel", tekerlek, { passive: false });
    // Klavye: + / - (kapsam denetimi: giriş, liste kutusu ve diyalogda çalışmaz).
    const tus = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || !kisayolHedefiUygun(e.target)) return;
      const yak = (HARITA_TUSLARI.yaklas.tus as readonly string[]).includes(e.key) || (HARITA_TUSLARI.yaklas.kod as readonly string[]).includes(e.code);
      const uzak = (HARITA_TUSLARI.uzaklas.tus as readonly string[]).includes(e.key) || (HARITA_TUSLARI.uzaklas.kod as readonly string[]).includes(e.code);
      if (!yak && !uzak) return;
      e.preventDefault();
      dokundu.current = true;
      const k = kutuOf(app);
      kameraVer(yakinlastir(guncelKamera.current, { x: k.genislik / 2, y: k.yukseklik / 2 }, yak ? S.yakinlastir.adim : 1 / S.yakinlastir.adim, k, dunyaOf()));
    };
    window.addEventListener("keydown", tus);
    return () => {
      window.removeEventListener("keydown", tus);
      app.canvas.removeEventListener("wheel", tekerlek);
      app.stage.off("pointerdown", asagi).off("pointermove", tasi).off("pointerup", yukari).off("pointerupoutside", yukari).off("pointercancel", iptal);
      c.yoket();
      cizim.current = null;
    };
  }, [app, dokular, katalog, izo, izoHazir, spriteDokular, manifest]);

  // Tema değişince (data-theme ya da sistem teması) renkler ve dokular yeniden okunur.
  useEffect(() => {
    const yenile = (): void => setTema((n) => n + 1);
    const mo = new MutationObserver(yenile);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", yenile);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", yenile);
    };
  }, []);

  // Kutu boyutu değişince yeniden sığdırma tetiklenir.
  useEffect(() => {
    const el = kap.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoyut((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Kamera komutları (yaklaştır / uzaklaştır / sığdır).
  const sonKomut = useRef(0);
  useEffect(() => {
    if (app === null || komut === null || komut.n === sonKomut.current) return;
    sonKomut.current = komut.n;
    const k = kutuOf(app);
    if (komut.tur === "sigdir") {
      dokundu.current = false;
      if (k.genislik > 0 && k.yukseklik > 0) kameraVer(sigdir(kamera, k.genislik, k.yukseklik, dunyaOf(), pay));
      return;
    }
    if (komut.tur === "odak") {
      if (komut.hedef && k.genislik > 0 && k.yukseklik > 0) {
        dokundu.current = true;
        const nokta = odakHedefi(son.current.sahne, komut.hedef);
        if (nokta) kameraVer(odakla(nokta, k.genislik, k.yukseklik, dunyaOf(), pay));
      }
      return;
    }
    dokundu.current = true;
    kameraVer(yakinlastir(guncelKamera.current, { x: k.genislik / 2, y: k.yukseklik / 2 }, komut.tur === "yakin" ? S.yakinlastir.adim : 1 / S.yakinlastir.adim, k, dunyaOf()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [komut, app]);

  // Seçili bina yüzen panelin (pay) altına düşüyorsa kamera onu serbest alana getirir. Kullanıcı kamerayı oynatmadıysa şehir zaten
  // serbest alana sığdırılır (aşağıdaki efekt), bu yüzden yalnız oynatılmış kamerada çalışır.
  useEffect(() => {
    const ref = secili;
    if (app === null || ref === null || !dokundu.current) return;
    const s = son.current.sahne;
    const c = cizim.current;
    let kutu: { sol: number; sag: number; ust: number; alt: number };
    if (izoMu(s)) {
      const ib = s.binalar.find((x) => x.ref.kind === ref.kind && x.ref.ref === ref.ref);
      if (!ib) return;
      kutu = c instanceof IzoCizimi ? c.binaKutusu(ib) : { sol: ib.ekran.x + s.kaydirma.x, sag: ib.ekran.x + s.kaydirma.x, ust: ib.ekran.y + s.kaydirma.y, alt: ib.ekran.y + s.kaydirma.y };
    } else {
      const b = [...s.binalar, s.sehirBinasi, s.ahir].find((x) => x.ref.kind === ref.kind && x.ref.ref === ref.ref);
      if (!b) return;
      kutu = c instanceof SehirCizimi ? c.binaKutusu(b) : { sol: b.x, sag: b.x, ust: b.y, alt: b.y };
    }
    const k = kutuOf(app);
    const m = V.seciliPay;
    // Dört kenar da serbest alanda kalsın; kutu sığmıyorsa serbest alanın ortasına getirilir.
    const eksen = (a0: number, a1: number, min: number, max: number): number => (a1 - a0 > max - min ? (min + max) / 2 - (a0 + a1) / 2 : a0 < min ? min - a0 : a1 > max ? max - a1 : 0);
    const dx = eksen(kutu.sol * kamera.olcek + kamera.x, kutu.sag * kamera.olcek + kamera.x, pay.sol + m, k.genislik - pay.sag - m);
    const dy = eksen(kutu.ust * kamera.olcek + kamera.y, kutu.alt * kamera.olcek + kamera.y, pay.ust + m, k.yukseklik - pay.alt - m);
    // Sınırlamadan geçirilmez: harita kenarındaki bina panelin altından ancak haritanın kenar payını aşarak çıkabilir.
    if (dx !== 0 || dy !== 0) kameraVer({ x: kamera.x + dx, y: kamera.y + dy, olcek: kamera.olcek });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secili?.kind, secili?.ref, pay.ust, pay.alt, pay.sol, pay.sag, app, dokuSurumu]);

  // Kullanıcı dokunmadıysa kutu ya da şehir ölçüsü değişince şehir yeniden sığdırılır.
  const dunya = dunyaBoyutu(sahne);
  // Görünüm modu (klasik <-> izometrik) değişince yerleşim koordinatları başka uzaya geçer: kullanıcının oynattığı kamera eski yerleşimde kalmasın,
  // otomatik sığdırma yeniden açılır ve aşağıdaki efekt yeni yerleşime sığdırır.
  const oncekiIzo = useRef(izo);
  useEffect(() => {
    if (oncekiIzo.current === izo) return;
    oncekiIzo.current = izo;
    dokundu.current = false;
  }, [izo]);
  const sehirNo = izo ? (sahne as IzoSahne).kaynak.sehir : (sahne as SehirSahnesi).sehir;
  useEffect(() => {
    if (app === null) return;
    const k = kutuOf(app);
    if (!dokundu.current && k.genislik > 0 && k.yukseklik > 0) kameraVer(sigdir(kamera, k.genislik, k.yukseklik, dunya, pay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, izo, sehirNo, dunya.genislik, dunya.yukseklik, boyut, pay.ust, pay.alt, pay.sol, pay.sag]);

  useEffect(() => {
    const c = cizim.current;
    if (c instanceof IzoCizimi) {
      if (izoMu(sahne)) c.guncelle(sahne, secili, kamera, tema, adlar, app !== null ? kutuOf(app) : undefined, hareket);
    } else if (c instanceof SehirCizimi && !izoMu(sahne)) c.guncelle(sahne, secili, kamera, tema, adlar);
  }, [app, sahne, secili, kamera, tema, adlar, boyut, izo, izoHazir, spriteDokular, manifest, dokular, katalog, hareket]);

  // Seçim kalkınca (panel kapandı) dokunmatik ipucu da kalkar.
  const ipucuGoster = izo && ipucu !== null && !(ipucu.dokunma && secili === null);
  useEffect(() => {
    if (!ipucuGoster && cizim.current instanceof IzoCizimi) cizim.current.ipucuKapat();
  }, [ipucuGoster]);
  return (
    <div ref={kap} className={styles.sahneKap} data-harita-sahne="" {...(ipucuGoster ? { "aria-describedby": ipucuId } : {})}>
      <Application resizeTo={kap} antialias autoDensity resolution={cozunurluk(izo)} autoStart={false} onInit={setApp} />
      {ipucuGoster ? <IzoIpucu id={ipucuId} veri={ipucu!.veri} /> : null}
    </div>
  );
}
