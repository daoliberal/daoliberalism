import { Color, Container, Graphics, Polygon, Rectangle, Sprite, Text, type Application as PixiApp, type Texture } from "pixi.js";
import { t } from "@/oyun/copy/t";
import type { Adlandirici } from "./adlar";
import { HARITA_STILI, IZO_RENGI, IZO_STILI, SEHIR_RENGI, VARLIK_STILI } from "./haritaStili";
import { durumGorunumu, type Gecis, type GorselDurum } from "./izoDurum";
import { derinlik, hucredenEkrana, type Hucre } from "./izometri";
import { animasyonModu } from "./izoTercih";
import type { IpucuVerisi } from "./IzoIpucu";
import { ipucuMetni, ipucuYeri } from "./izoIpucuYer";
import { balonlariDiz, balonMetni, type Balon } from "./izoOlay";
import type { IzoBina, IzoSahne } from "./izoSahne";
import type { ZeminKarosu } from "./izoZemin";
import type { SpriteDokuKaynakcisi } from "./spriteDoku";
import { bindirmeSprite, zeminSprite, type SpriteKaydi, type SpriteManifesti } from "./spriteManifest";
import { MEYDAN_REF, type Gorunum, type HaritaRef } from "./tipler";
import { fnv1a } from "./yerlesim";

const S = HARITA_STILI;
const V = VARLIK_STILI;
const Z = IZO_STILI;
const yarimKaro = Z.karo.yukseklik / 2;

type Nokta = { x: number; y: number };
export type IzoKutu = { sol: number; sag: number; ust: number; alt: number };

const ayniRef = (a: HaritaRef | null, b: HaritaRef): boolean => a !== null && a.kind === b.kind && a.ref === b.ref;

/** Çift-tek kuralıyla nokta çokgenin içinde mi (düz sayı dizisi: x0,y0,x1,y1,...). */
function cokgenIcinde(p: readonly number[], x: number, y: number): boolean {
  let ic = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!, yi = p[i + 1]!, xj = p[j]!, yj = p[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}

/** (c0..c1) x (r0..r1) parsel birimi dikdörtgeninin ekran çokgeni: üst, sağ, alt, sol (8 sayı). Tek hücrede elmas. */
function dikdortgenCokgeni(c0: number, c1: number, r0: number, r1: number): number[] {
  const a = hucredenEkrana({ c: c0, r: r0 }), b = hucredenEkrana({ c: c1, r: r0 }), d = hucredenEkrana({ c: c1, r: r1 }), e = hucredenEkrana({ c: c0, r: r1 });
  return [a.x, a.y, b.x, b.y, d.x, d.y, e.x, e.y];
}
/** Bir ya da iki (domino) hücrenin ayak izi çokgeni. */
function ayakIzi(h: Hucre, h2: Hucre | null): number[] {
  const c = h2 ? [h.c, h2.c] : [h.c];
  const r = h2 ? [h.r, h2.r] : [h.r];
  return dikdortgenCokgeni(Math.min(...c) - 0.5, Math.max(...c) + 0.5, Math.min(...r) - 0.5, Math.max(...r) + 0.5);
}

/** `[a, b]` aralığını adımı `ro`'yu aşmayacak, eşit aralıklı karo merkezleriyle döşer (izoZemin ile aynı kural). */
function karoMerkezleri(a: number, b: number, ro: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / ro - 1e-9));
  const s = (b - a) / n;
  return Array.from({ length: n }, (_, i) => a + s * (i + 0.5));
}

/**
 * Bina tıklama alanı (ekran uzayı, düz sayı dizisi): parsel (iki parselde ikisi) elması + gövde dikdörtgeni; gövdenin üst köşeleri çapraz kesilir,
 * böylece sprite kutusunun saydam üst köşeleri tıklanmaz. `ekran`: sprite ankrajının (ayak izinin alt köşesi) ekrandaki yeri.
 */
export function binaVurusAlani(ekran: Nokta, sprite: SpriteKaydi, olcek: number): number[] {
  const W = sprite.parsel.genislik * olcek;
  const H = sprite.parsel.yukseklik * olcek;
  const iki = sprite.parselSayisi === 2;
  const L = -W / 2;
  const R = iki ? W : W / 2;
  const solY = -H / 2;
  const sagY = iki ? -H : -H / 2;
  const T = Math.min(-sprite.ankraj.y * olcek, iki ? -1.5 * H : -H);
  const kes = Math.min((R - L) * Z.vurus.kesik, Math.min(solY, sagY) - T);
  const goreli = [L, solY, L, T + kes, L + kes, T, R - kes, T, R, T + kes, R, sagY, 0, 0];
  return goreli.map((v, i) => v + (i % 2 === 0 ? ekran.x : ekran.y));
}

type Hedef = { sprite: Sprite; uygula?: () => void };
/** Aynı sprite dosyasını kullanan sprite'lar: doku bir kez istenir, hepsine yazılır. */
type Grup = { kayit: SpriteKaydi; hedefler: Hedef[]; tex: Texture | null; istendi: boolean; gitti: boolean };

type Obje = {
  anahtar: string;
  kap: Container;
  sprite: Sprite;
  kayit: SpriteKaydi;
  grup: Grup;
  /** Sprite'ta şu an görünen dokunun dosyası (yeni sprite gelene dek eski görünür). */
  uygulanan: string | null;
  bindirme: { sprite: Sprite; kayit: SpriteKaydi; grup: Grup; tur: BindirmeTuru } | null;
  /** Bindirme sprite'ı manifestte yoksa `Graphics` yedeği (yalnız `--harita-izo-*` renkleri). */
  yedek: { g: Graphics; tur: BindirmeTuru; imza: string } | null;
  /** İşletme mi (durum görselleri yalnız işletmede); türü (`SahneBina.etiket`) ve histerezisli boy. */
  isletme: boolean;
  etiket: string | null;
  boy: 1 | 2 | 3 | 4;
  durum: GorselDurum;
  /** Tek seferlik geçiş (iskele, tahta, parlama, ışık); biterken `bekleyen` sprite uygulanır. */
  gecis: { tur: Gecis["tur"]; t0: number; sure: number } | null;
  /** Büyüme/küçülme geçişi bitene dek ertelenen yeni sprite kaydı. */
  bekleyen: SpriteKaydi | null;
  isik: Graphics | null;
  duman: Container | null;
  parlama: Graphics | null;
  /** Sprite'a gri tint yazıldı mı (tint yalnız gerektiğinde dokunulur; yoksa Pixi varsayılanı kalır). */
  tintli: boolean;
  /** Işık/duman Graphics renkleri hangi temayla çizildi. */
  fxTema: number;
  /** Ankraj noktası (ekran uzayı). */
  ax: number;
  ay: number;
  z: number;
  ref: HaritaRef | null;
  /** Ekran uzayında görsel kutu (kırpma için). */
  kutu: { x0: number; y0: number; x1: number; y1: number };
  gorunur: boolean;
  imza: string;
};
type BindirmeTuru = "iskele" | "tahtali";
export type HareketGirdisi = { etkinAzalt: boolean; dusukPerformans: boolean };
/** Ekran dışı elenebilen zemin/dolgu sprite'ı ve ekran uzayındaki kutusu (kamera payı kutusuyla kesişmiyorsa `visible = false`). */
type Oge = { sp: Sprite; x0: number; y0: number; x1: number; y1: number };
type DolguKabi = { kap: Container; imza: string; ogeler: Oge[] };
/** Pişirilmiş parsel zemini: `ayar` (ro|ölçek) değişince eskisi render sonrası atılır; `ax/ay` parsel merkezine göre ankraj oranı, kutu merkeze göre. */
type ParselDokusu = { tex: Texture; ayar: string; ax: number; ay: number; x0: number; y0: number; x1: number; y1: number };
type BalonNesnesi = { kap: Container; t0: number; omur: number; x: number; y: number; w: number; h: number; zamanlayici: ReturnType<typeof setTimeout> | null };
type Rozet = { g: Graphics; t: Text; imza: string };

/** Pixi yazı biçimi (tema değişince yeniden uygulanır). */
function yaziBicimi(tx: Text, renk: number, aile: string, boyut: number): void {
  const bicim = tx.style;
  bicim.fill = renk;
  bicim.fontFamily = aile;
  bicim.fontSize = boyut;
}

/**
 * İzometrik (sprite) şehir çizimi. Klasik `SehirCizimi` ile aynı dış sözleşme: `guncelle`, `binaKutusu`, `yoket`, `onDoku`, `tasidi`.
 * `dunya` kamera kabıdır; içindeki `govde` sahnenin `kaydirma`sını taşır (zemin kaydırma değişince yeniden kurulmaz). Govde katmanları, alttan üste:
 * zemin (render grubu: çerçeve, blok/parsel zemini, yol, ağaç, şerit) -> dolgu zemini (arsa/park) -> tıklanabilir yerler (meydan, kur hedefi) ->
 * katman/ilan plakası -> bina ve bina-benzeri dolgu (`zIndex = z`) -> seçim/ben halkası -> rozet -> etiket.
 * Ekran dışı binalar `visible = false` olur (kutu önbelleği; kamera payın içinde kaldıkça yeniden hesap yok); doku, bir tür ilk kez göründüğünde istenir.
 * Katman tonu plakaya yazılır; PNG tonlanmaz. Ticker yalnız animasyon varken açılır; ticker kapalıyken her değişiklikte `app.render()`.
 *
 * Durum ve büyüme görselleri (Görev 11): `IzoBina.durum` -> `durumGorunumu` (sprite `alpha` + `tint`; filtre yok), iskele/tahta bindirmesi (manifest sprite'ı,
 * yoksa `Graphics`), üretimde ışık ve (bacalı türlerde) duman. `IzoSahne.gecisler` her `id:hafta:tur` için bir kez oynar (`IZO_STILI.buyume.bindirmeMs`).
 * Ticker YALNIZ `animasyonModu` "tam" iken ve animasyonlu öğe (geçiş ya da duman) varken açıktır (`maxFPS` 30); biter bitmez durur ve son kare çizilir.
 * Hareket azaltılmış / düşük performans / sekme gizliyken hiç açılmaz: durumlar statik okunur (tahta, iskele, soluk, ışık). Ekran dışı binada animasyon çalışmaz.
 */
export class IzoCizimi {
  readonly dunya = new Container();
  private readonly govde = new Container();
  private readonly zeminKat = new Container({ isRenderGroup: true });
  private readonly dolguKat = new Container({ isRenderGroup: true });
  private readonly yerKat = new Container();
  private readonly plakaKat = new Graphics();
  private readonly binaKat = new Container();
  private readonly halkaKat = new Graphics();
  private readonly rozetKat = new Container();
  private readonly etiketKat = new Container();
  /** Olay balonları: en üst katman, kamera ölçeğinin tersiyle ekranda sabit boyutta. */
  private readonly balonKat = new Container();
  private readonly balonlar = new Map<string, BalonNesnesi>();
  private readonly gorulenBalon = new Set<string>();
  private balonIlk = true;
  /** Ben halkasının dış nabız halkası (tam modda alfa salınır) ve fare üstündeki binanın parlaması: en üstte, olay almaz. */
  private readonly benKat = new Graphics();
  private readonly hoverKat = new Graphics();
  private meydan: Graphics | null = null;
  private readonly kurHedefleri = new Map<string, Graphics>();
  private readonly nesneler = new Map<string, Obje>();
  private readonly dolguKaplari = new Map<string, DolguKabi>();
  private readonly rozetler = new Map<string, Rozet>();
  private readonly etiketler = new Map<string, { t: Text; x: number; y: number; imza: string }>();
  private zeminImzasi = "";
  /** Zemin sprite'ları (karo, pişirilmiş parsel): ekran dışı olanlar gizlenir; zemin her yeniden kurulduğunda baştan oluşur. */
  private zeminOgeleri: Oge[] = [];
  /** Zemin ya da dolgu değişti: kamera kutusu aynı kalsa da görünürlük yeniden hesaplanmalı. */
  private gorunurlukGecersiz = false;
  private readonly gruplar = new Set<Grup>();
  /**
   * Bütün sprite'ların (bina, zemin, dolgu) dosya başına ortak grupları (tek Texture). Şehir değişince ve zemin yeniden kurulunca da yaşar:
   * aynı dosya ikinci kez yüklenmez; yalnız yok edilmiş sprite'ların hedefleri ayıklanır (`hedefTemizle`).
   */
  private readonly nesneGruplari = new Map<string, Grup>();
  /** Parsel zemini pişirmeleri (dosya|ro|ölçek): 16 kaldırım karosu tek dokuya yazılır, bütün parseller paylaşır. */
  private readonly parselDokulari = new Map<string, ParselDokusu>();
  private olcek = 0.5;
  private kapsama: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private oldu = false;
  private hataBildirildi = false;
  private renderBekliyor = false;
  private hareket: HareketGirdisi = { etkinAzalt: false, dusukPerformans: false };
  private mod: "kapali" | "tam" = "tam";
  private tema = 0;
  /** Animasyon saati (ms): yalnız ticker çalışırken ilerler. */
  private zaman = 0;
  private tickerAcik = false;
  /** Bağlandıktan sonraki ilk `guncelle`: o anki geçişler eski sayılır (yeni örnek son haftanın geçişlerini yeniden oynatmaz). */
  private ilkGuncelleme = true;
  /** Bir geçiş bitti: ışık sınırı ve duman yeniden değerlendirilmeli. */
  private efektBekliyor = false;
  /** Oynatılmış (ya da atlanmış) geçiş kimlikleri (`id:hafta:tur`); en eskiler kırpılır. */
  private readonly islenenGecis = new Set<string>();
  private sonSahne: IzoSahne | null = null;
  /** Son `guncelle` girdileri: WebGL bağlamı geri gelince zemin bu girdilerle yeniden kurulur. */
  private sonGirdi: { s: IzoSahne; secili: HaritaRef | null; g: Gorunum; tema: number; adlar: Adlandirici; kutu: { genislik: number; yukseklik: number } | undefined; hareket: HareketGirdisi | undefined } | null = null;
  private sonSecili: HaritaRef | null = null;
  private hoverId: string | null = null;
  private sonImlec: { x: number; y: number } | null = null;
  private sonIpucu = "";
  /** Ekran piksellerinde (kamera dışı) imleci izleyen ipucu kutusu: `dunya`dan sonra eklenir, olay yutmaz. */
  private readonly ipucuKat = new Container();
  private readonly ipucuZemin = new Graphics();
  private ipucuBaslik: Text | null = null;
  private ipucuDetay: Text | null = null;
  private ipucuBoyut = { genislik: 0, yukseklik: 0 };
  private benNabzi = false;
  /** Seçim halkası belirme animasyonunun başlangıç saati (ms); yoksa null. */
  private secimT0: number | null = null;
  private secimAnahtari: string | null = null;
  /** Görünürlük hesabı kaç kez yapıldı (kamera eşiği testi için). */
  gorunurlukHesabi = 0;
  tasidi = false;
  /** Bir bina dokusu geldiğinde o binanın ref'iyle çağrılır (seçili binanın kamera payı yeniden hesaplansın). */
  onDoku: ((ref: HaritaRef) => void) | null = null;
  /** Fare binanın üstüne gelince ya da dokunmatikte bina seçilince ipucu verisi; ayrılınca null. */
  onHover: ((veri: IpucuVerisi | null, dokunma?: boolean) => void) | null = null;

  constructor(
    private readonly app: PixiApp,
    private readonly tiklama: (r: HaritaRef) => void,
    private readonly dokular: SpriteDokuKaynakcisi,
    private readonly kok: () => Element,
    private readonly hata: (e: unknown) => void,
    private readonly manifest: SpriteManifesti,
  ) {
    this.binaKat.sortableChildren = true;
    this.etiketKat.eventMode = S.etiketKatmani.olayModu;
    this.balonKat.eventMode = "none";
    for (const k of [this.plakaKat, this.halkaKat, this.rozetKat, this.benKat, this.hoverKat]) k.eventMode = "none";
    this.govde.addChild(this.zeminKat, this.dolguKat, this.yerKat, this.plakaKat, this.binaKat, this.halkaKat, this.rozetKat, this.etiketKat, this.benKat, this.hoverKat, this.balonKat);
    this.dunya.addChild(this.govde);
    this.ipucuKat.eventMode = "none";
    this.ipucuKat.visible = false;
    this.ipucuKat.addChild(this.ipucuZemin);
    app.stage.addChild(this.dunya, this.ipucuKat);
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.sekmeDegisti);
    app.canvas?.addEventListener?.("webglcontextrestored", this.baglamGeriGeldi);
  }

  /**
   * WebGL bağlamı kayıp sonrası geri gelince: resimden gelen dokuları Pixi yeniden yükler ama pişirilmiş parsel dokuları (RenderTexture) kaynaksızdır,
   * boş kalır. Bu yüzden bütün pişirmeler atılır, zemin ve dolgu imzaları sıfırlanıp son girdiyle yeniden kurulur (karo dokuları grupta hazır; yeniden pişirilir).
   */
  private readonly baglamGeriGeldi = (): void => {
    if (this.oldu) return;
    for (const d of this.parselDokulari.values()) d.tex.destroy(true);
    this.parselDokulari.clear();
    this.zeminImzasi = "";
    for (const [k, v] of [...this.dolguKaplari]) this.dolguKabiniKaldir(k, v);
    const e = this.sonGirdi;
    if (e) this.guncelle(e.s, e.secili, e.g, e.tema, e.adlar, e.kutu, e.hareket);
  };

  // --- animasyon modu ve ticker -------------------------------------------------------

  private modHesapla(): "kapali" | "tam" {
    return animasyonModu({ ...this.hareket, sekmeGorunur: typeof document === "undefined" || document.visibilityState !== "hidden" });
  }
  private readonly sekmeDegisti = (): void => {
    if (this.oldu) return;
    const yeni = this.modHesapla();
    if (yeni === this.mod) return;
    this.mod = yeni;
    this.modUygula();
  };
  /** Mod değişti: kapalıda sürmekte olan geçişler son duruma atlar ve duman kalkar; açılınca duman yeniden istenir. */
  private modUygula(): void {
    if (this.mod === "kapali") for (const o of this.nesneler.values()) if (o.gecis) this.gecisBitir(o);
    if (this.mod === "kapali") this.etkilesimSifirla();
    if (this.mod === "kapali") for (const k of [...this.balonlar.keys()]) this.balonKaldir(k);
    this.efektleriGuncelle();
    this.tickerDurumu();
  }
  private animasyonVar(): boolean {
    if (this.mod === "tam" && (this.benNabzi || this.secimT0 !== null)) return true;
    if (this.mod === "tam" && this.balonlar.size > 0) return true;
    for (const o of this.nesneler.values()) if (o.gecis || o.duman) return true;
    return false;
  }
  /** Ticker yalnız tam modda ve animasyonlu öğe varken açık; kapanınca son kare çizilir. */
  private tickerDurumu(): void {
    const ticker = this.app.ticker;
    if (!ticker) return;
    const istenen = !this.oldu && this.mod === "tam" && this.animasyonVar();
    if (istenen && !this.tickerAcik) {
      ticker.maxFPS = Z.animasyon.maxFps;
      ticker.add(this.kare);
      ticker.start();
      this.tickerAcik = true;
    } else if (!istenen && this.tickerAcik) {
      ticker.remove(this.kare);
      ticker.stop();
      this.tickerAcik = false;
      if (!this.oldu) this.app.render();
    }
  }
  /** Ticker karesi: geçişleri ve dumanı ilerletir (çizimi Pixi'nin ticker'ı yapar); işi biten ticker'ı kapatır. */
  private readonly kare = (t: { deltaMS: number }): void => {
    if (this.oldu) return;
    this.zaman += t.deltaMS;
    this.etkilesimKare();
    for (const o of this.nesneler.values()) {
      if (o.gecis) {
        const p = Math.min(1, (this.zaman - o.gecis.t0) / o.gecis.sure);
        if (p >= 1) this.gecisBitir(o);
        else this.gecisUygula(o, p);
      }
      if (o.duman) this.dumanKare(o);
    }
    this.balonKare();
    if (this.efektBekliyor) this.efektleriGuncelle();
    this.tickerDurumu();
  };

  /** `.kok` öğesinin computed stilinden `--harita-*` değeri. */
  private deger(ad: string): string {
    return getComputedStyle(this.kok()).getPropertyValue(ad).trim();
  }
  private renk(ad: string): number {
    const v = this.deger(ad);
    return new Color(v === "" ? S.yedek.renk : v).toNumber();
  }

  /** `kutu`: gerçek görünüm (kapsayıcı) ölçüsü; verilmezse Pixi `screen` (bir kare gecikmeli güncellenebilir). */
  guncelle(s: IzoSahne, secili: HaritaRef | null, g: Gorunum, tema: number, adlar: Adlandirici, kutu?: { genislik: number; yukseklik: number }, hareket?: HareketGirdisi): void {
    const { app } = this;
    this.sonGirdi = { s, secili, g, tema, adlar, kutu, hareket };
    app.renderer.background.color = this.renk(SEHIR_RENGI.zemin);
    this.olcek = s.olcek;
    this.tema = tema;
    if (this.ilkGuncelleme) {
      this.ilkGuncelleme = false;
      for (const g of s.gecisler) this.gecisIsle(g);
    }
    if (hareket) this.hareket = hareket;
    const yeniMod = this.modHesapla();
    const modDegisti = yeniMod !== this.mod;
    this.mod = yeniMod;
    if (modDegisti && yeniMod === "kapali") for (const o of this.nesneler.values()) if (o.gecis) this.gecisBitir(o);
    this.govde.position.set(s.kaydirma.x, s.kaydirma.y);
    this.zeminGuncelle(s, tema);
    this.dolguGuncelle(s);
    let efekt = this.buyumeGecisleriniBaslat(s) || modDegisti;
    efekt = this.nesneleriGuncelle(s) || efekt;
    const degisti = efekt;
    this.sonSahne = s;
    this.sonSecili = secili;
    this.adlar = adlar;
    this.yerleriGuncelle(s, secili);
    this.plakaVeHalka(s, secili);
    this.secimBelirmesi(secili);
    this.hoverCiz();
    this.ipucuTazele();
    this.rozetVeEtiket(s, secili, adlar, tema, g);
    const hesap = this.gorunurlukHesabi;
    this.gorunurlukGuncelle(g, degisti, kutu);
    this.balonlariGuncelle(s, g);
    if (this.gecisleriBaslat(s) || degisti || this.efektBekliyor || hesap !== this.gorunurlukHesabi) this.efektleriGuncelle();
    this.tickerDurumu();
    this.dunya.position.set(g.x, g.y);
    this.dunya.scale.set(g.olcek);
    app.render();
    this.pisirmeBudama(`${s.zemin.ro}|${s.olcek}`);
  }

  // --- doku grupları -----------------------------------------------------------------

  private hedefCikar(gr: Grup, sprite: Sprite): void {
    gr.hedefler = gr.hedefler.filter((h) => h.sprite !== sprite);
  }
  private hedefEkle(gr: Grup, h: Hedef): void {
    gr.hedefler.push(h);
    if (gr.tex) {
      h.sprite.texture = gr.tex;
      h.uygula?.();
    }
  }
  /** Yok edilmiş sprite'ların hedeflerini gruplardan atar (zemin/dolgu yeniden kurulunca birikmesin). */
  private hedefTemizle(): void {
    for (const gr of this.gruplar) if (gr.hedefler.length > 0) gr.hedefler = gr.hedefler.filter((h) => !h.sprite.destroyed);
  }
  /** Zemin/dolgu sprite'ının dokusunu ister (görünürlükten bağımsız: zemin türü sayısı küçüktür). */
  private zeminHedefi(k: SpriteKaydi, h: Hedef): void {
    const gr = this.nesneGrubu(k);
    this.hedefEkle(gr, h);
    this.grupIste(gr);
  }
  private grupIste(gr: Grup): void {
    if (gr.istendi || gr.gitti) return;
    gr.istendi = true;
    this.dokular.doku(gr.kayit).then(
      (tex) => {
        if (this.oldu || gr.gitti) return;
        gr.tex = tex;
        for (const h of gr.hedefler) {
          if (h.sprite.destroyed) continue;
          h.sprite.texture = tex;
          h.uygula?.();
        }
        this.renderIste();
      },
      (e: unknown) => {
        if (this.oldu || this.hataBildirildi) return;
        this.hataBildirildi = true;
        this.hata(e);
      },
    );
  }
  /** Önce çiz, sonra eski dokuları yok et (Pixi toplu çizim listesi yok edilmiş dokuyu bağlamaya çalışmasın); aynı turdaki gelişler tek çizimde birleşir. */
  private renderIste(): void {
    if (this.renderBekliyor) return;
    this.renderBekliyor = true;
    queueMicrotask(() => {
      this.renderBekliyor = false;
      if (this.oldu) return;
      this.app.render();
      this.dokular.emekliyiAt?.(this.kullanimdakiler());
    });
  }
  private kullanimdakiler(): Set<Texture> {
    const k = new Set<Texture>();
    for (const gr of this.gruplar) if (gr.tex) k.add(gr.tex);
    return k;
  }

  /** Zemin karosu sprite'ı: ankraj kaydın kendi ankrajı (zemin karolarında elmas merkezi). `ogeler` verilirse ekran dışı elemesine katılır. */
  private karoSprite(kap: Container, k: SpriteKaydi, merkez: Nokta, ogeler: Oge[] | null, aynali = false): Sprite {
    const sp = new Sprite();
    sp.eventMode = "none";
    sp.anchor.set(k.ankraj.x / k.genislik, k.ankraj.y / k.yukseklik);
    sp.scale.set(aynali ? -this.olcek : this.olcek, this.olcek);
    sp.position.set(merkez.x, merkez.y);
    kap.addChild(sp);
    const sol = Math.max(k.ankraj.x, k.genislik - k.ankraj.x) * this.olcek;
    this.ogeKaydet(ogeler, sp, merkez.x - sol, merkez.y - k.ankraj.y * this.olcek, merkez.x + sol, merkez.y + (k.yukseklik - k.ankraj.y) * this.olcek);
    this.zeminHedefi(k, { sprite: sp });
    return sp;
  }

  private ogeKaydet(ogeler: Oge[] | null, sp: Sprite, x0: number, y0: number, x1: number, y1: number): void {
    if (ogeler === null) return;
    const o = { sp, x0, y0, x1, y1 };
    ogeler.push(o);
    if (this.kapsama) sp.visible = this.ogeGorunur(o, this.kapsama);
  }
  private ogeGorunur(o: Oge, k: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return o.x1 >= k.x0 && o.x0 <= k.x1 && o.y1 >= k.y0 && o.y0 <= k.y1;
  }

  // --- parsel zemini pişirme -----------------------------------------------------------

  private pisirmeVar(): boolean {
    return typeof (this.app.renderer as { generateTexture?: unknown } | undefined)?.generateTexture === "function";
  }
  /**
   * Bir parselin zeminini (ro adımlı karo döşemesi) TEK dokuya pişirir ve (dosya, ro, ölçek) başına önbelleğe alır: büyük şehirde parsel başına
   * 16 (park/arsada ağaçlarla 20+) sprite yerine tek sprite çizilir (300 işletmeli şehirde zemin sprite'ı ~28 bine karşı ~8 bin altına iner).
   * Çözünürlük en az `pisirmeCozunurlugu`: yakınlaştırmada keskin kalır. Pişirilmiş doku da sprite dokuları gibi mipmaplidir (tüm şehir sığdırılınca ~8x küçültme
   * titremesin; NPOT mipmap WebGL2/WebGPU'da güvenlidir, bkz. `pixiDokuYap`). Doku kaynağı hazır olunca çağrılır.
   */
  private parselDokusu(k: SpriteKaydi, kaynak: Texture, ro: number, olcek: number): ParselDokusu {
    const anahtar = `${k.dosya}|${ro}|${olcek}`;
    const var_ = this.parselDokulari.get(anahtar);
    if (var_) return var_;
    const r = this.app.renderer as unknown as { generateTexture(o: unknown): Texture; resolution?: number };
    const kap = new Container();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rr of karoMerkezleri(-0.5, 0.5, ro)) {
      for (const cc of karoMerkezleri(-0.5, 0.5, ro)) {
        const e = hucredenEkrana({ c: cc, r: rr });
        const sp = new Sprite();
        sp.texture = kaynak;
        sp.anchor.set(k.ankraj.x / k.genislik, k.ankraj.y / k.yukseklik);
        sp.scale.set(olcek);
        sp.position.set(e.x, e.y);
        kap.addChild(sp);
        x0 = Math.min(x0, e.x - k.ankraj.x * olcek);
        y0 = Math.min(y0, e.y - k.ankraj.y * olcek);
        x1 = Math.max(x1, e.x + (k.genislik - k.ankraj.x) * olcek);
        y1 = Math.max(y1, e.y + (k.yukseklik - k.ankraj.y) * olcek);
      }
    }
    // Tam piksele oturan kutu: komşu parsellerle dikiş çıkmasın.
    const fx = Math.floor(x0), fy = Math.floor(y0), fw = Math.ceil(x1) - fx, fh = Math.ceil(y1) - fy;
    let tex: Texture;
    try {
      tex = r.generateTexture({ target: kap, frame: new Rectangle(fx, fy, fw, fh), resolution: Math.max(r.resolution ?? 1, Z.performans.pisirmeCozunurlugu), textureSourceOptions: { scaleMode: "linear", autoGenerateMipmaps: true, mipmapFilter: "linear" } });
    } finally {
      kap.destroy({ children: true });
    }
    const d: ParselDokusu = { tex, ayar: `${ro}|${olcek}`, ax: -fx / fw, ay: -fy / fh, x0: fx, y0: fy, x1: fx + fw, y1: fy + fh };
    this.parselDokulari.set(anahtar, d);
    return d;
  }
  /** Eski ayarla (ro/ölçek) pişirilmiş dokuları atar; yalnız çizimden sonra çağrılır (yok edilmiş dokuyu bağlayan toplu çizim listesi kalmasın). */
  private pisirmeBudama(ayar: string): void {
    for (const [k, d] of this.parselDokulari) {
      if (d.ayar === ayar) continue;
      this.parselDokulari.delete(k);
      d.tex.destroy(true);
    }
  }

  /**
   * Bir parselin (`h` hücresi ±0.5) zemini: pişirme varsa TEK sprite (doku gelince pişirilmiş parsel dokusu), yoksa eski karo döşemesi (`karo` geri çağrımı).
   * Pişirme atarsa sprite ham karo dokusuyla kalmaz: hata bir kez bildirilir (üst bileşen klasiğe döner).
   */
  private parselZemini(kap: Container, ogeler: Oge[] | null, k: SpriteKaydi, h: Hucre, ro: number, karoYap: (c: number, r: number) => void): void {
    if (!this.pisirmeVar()) {
      for (const r of karoMerkezleri(h.r - 0.5, h.r + 0.5, ro)) for (const c of karoMerkezleri(h.c - 0.5, h.c + 0.5, ro)) karoYap(c, r);
      return;
    }
    const sp = new Sprite();
    sp.eventMode = "none";
    const e = hucredenEkrana(h);
    sp.position.set(e.x, e.y);
    sp.visible = false; // pişirilmiş doku gelip eleme kutusu kaydedilene dek çizilmez
    kap.addChild(sp);
    const olcek = this.olcek;
    this.zeminHedefi(k, {
      sprite: sp,
      uygula: () => {
        const gr = this.nesneGrubu(k);
        if (sp.destroyed || gr.tex === null) return;
        try {
          const d = this.parselDokusu(k, gr.tex, ro, olcek);
          sp.texture = d.tex;
          sp.anchor.set(d.ax, d.ay);
          sp.scale.set(1);
          this.pisirilmisKaydet(ogeler, sp, e, d);
        } catch (err) {
          if (this.oldu || this.hataBildirildi) return;
          this.hataBildirildi = true;
          this.hata(err);
        }
      },
    });
  }
  /** Pişirilmiş parselin eleme kutusunu kaydeder (doku geldikten sonra; bir sprite için yalnız bir kez). */
  private pisirilmisKaydet(ogeler: Oge[] | null, sp: Sprite, e: Nokta, d: ParselDokusu): void {
    if (ogeler === null) return;
    this.ogeKaydet(ogeler, sp, e.x + d.x0, e.y + d.y0, e.x + d.x1, e.y + d.y1);
    sp.visible = this.kapsama === null || this.ogeGorunur(ogeler[ogeler.length - 1]!, this.kapsama);
    this.renderIste();
  }

  // --- zemin -------------------------------------------------------------------------

  private zeminGuncelle(s: IzoSahne, tema: number): void {
    const z = s.zemin;
    const imza = [s.kaynak.sehir, s.kaynak.kademe ?? 0, s.kaynak.parseller.length, z.ro, z.yollar.length, z.cerceve.length, z.blokZemini.length, z.seritler.length, z.kutu.c0, z.kutu.c1, z.kutu.r0, z.kutu.r1, s.olcek, tema].join("|");
    if (imza === this.zeminImzasi) return;
    this.zeminImzasi = imza;
    for (const ch of [...this.zeminKat.children]) {
      this.zeminKat.removeChild(ch);
      ch.destroy({ children: true });
    }
    this.hedefTemizle();
    const ogeler: Oge[] = [];
    this.zeminOgeleri = ogeler;
    this.gorunurlukGecersiz = true;
    const ro = z.ro;
    const w = (ro * Z.karo.genislik) / 2;
    const th = (ro * Z.karo.yukseklik) / 2;
    const elmasBoy = (e: Nokta): number[] => [e.x, e.y - th, e.x + w, e.y, e.x, e.y + th, e.x - w, e.y];
    const katYap = (): { kap: Container; yedek: Graphics } => ({ kap: new Container(), yedek: new Graphics() });
    /** Karo: sprite varsa sprite, yoksa yedek elmas. Yedek çizim katın dibinde toplanır. */
    const karo = (k: { kap: Container; yedek: Graphics }, sp: SpriteKaydi | null, h: Hucre, renkAd: string): void => {
      const e = hucredenEkrana(h);
      if (sp) this.karoSprite(k.kap, sp, e, ogeler);
      else k.yedek.poly(elmasBoy(e)).fill(this.renk(renkAd));
    };
    const yedekliKat = (): { kap: Container; yedek: Graphics } => {
      const k = katYap();
      k.kap.addChild(k.yedek);
      return k;
    };

    // 1) çerçeve zemini (ağaçsız çim)
    const cerceve = yedekliKat();
    const agaclar: ZeminKarosu[] = [];
    for (const c of [...z.cerceve].sort((a, b) => derinlik(a.hucre) - derinlik(b.hucre))) {
      if (c.tur === "agac") {
        agaclar.push(c);
        karo(cerceve, zeminSprite(this.manifest, "cim"), c.hucre, IZO_RENGI.cim);
      } else karo(cerceve, c.sprite, c.hucre, IZO_RENGI.cim);
    }
    this.zeminKat.addChild(cerceve.kap);

    // 2) parselsiz blok yuvaları (kaldırım), 3) her parselin altı, 4) yollar
    const blok = yedekliKat();
    for (const c of z.blokZemini) karo(blok, c.sprite, c.hucre, IZO_RENGI.isik);
    this.zeminKat.addChild(blok.kap);

    const kaldirim = zeminSprite(this.manifest, "kaldirim");
    const parsel = yedekliKat();
    for (const p of z.parselZemini) {
      if (!kaldirim) {
        parsel.yedek.poly(dikdortgenCokgeni(p.hucre.c - 0.5, p.hucre.c + 0.5, p.hucre.r - 0.5, p.hucre.r + 0.5)).fill(this.renk(IZO_RENGI.isik));
        continue;
      }
      this.parselZemini(parsel.kap, ogeler, kaldirim, p.hucre, ro, (c, r) => karo(parsel, kaldirim, { c, r }, IZO_RENGI.isik));
    }
    this.zeminKat.addChild(parsel.kap);

    const yol = yedekliKat();
    for (const y of z.yollar) karo(yol, y.sprite, y.hucre, IZO_RENGI.asfalt);
    this.zeminKat.addChild(yol.kap);

    // 5) çerçeve ağaçları (yolların üstünde, şeridin altında)
    const agac = yedekliKat();
    for (const c of agaclar) if (c.sprite) karo(agac, c.sprite, c.hucre, IZO_RENGI.cim);
    this.zeminKat.addChild(agac.kap);

    // 6) şeritler: çerçeve kutusuna maskelenir (uçlar çerçeveyi yarım parçaya kadar aşabilir)
    for (const sr of z.seritler) {
      const kap = new Container();
      const yatay: boolean = sr.yon === "kuzey" || sr.yon === "guney";
      const yedek = new Graphics();
      const renkAd = sr.tur === "nehir" ? IZO_RENGI.nehir : IZO_RENGI.cim;
      for (const h of sr.parcalar) {
        const mrk: Hucre = yatay ? { c: h.c + sr.uzunluk / 2, r: h.r + sr.genislik / 2 } : { c: h.c + sr.genislik / 2, r: h.r + sr.uzunluk / 2 };
        if (sr.sprite) this.karoSprite(kap, sr.sprite, hucredenEkrana(mrk), ogeler, !yatay);
        else yedek.poly(yatay ? dikdortgenCokgeni(h.c - sr.uzunluk / 2, h.c + sr.uzunluk / 2, h.r - sr.genislik / 2, h.r + sr.genislik / 2) : dikdortgenCokgeni(h.c - sr.genislik / 2, h.c + sr.genislik / 2, h.r - sr.uzunluk / 2, h.r + sr.uzunluk / 2)).fill(this.renk(renkAd));
      }
      if (!sr.sprite) kap.addChild(yedek);
      else yedek.destroy();
      const B = 400;
      const maske = new Graphics().poly(yatay ? dikdortgenCokgeni(z.kutu.c0, z.kutu.c1, -B, B) : dikdortgenCokgeni(-B, B, z.kutu.r0, z.kutu.r1)).fill(0xffffff);
      kap.mask = maske;
      this.zeminKat.addChild(kap, maske);
    }
  }

  // --- dolgu zemini (arsa, park, genişleme arsası) ------------------------------------

  private dolguGuncelle(s: IzoSahne): void {
    const ro = s.zemin.ro;
    const var_ = new Set<string>();
    let kaldirildi = false;
    const duzenle = (anahtar: string, imza: string, doldur: (kap: Container, ogeler: Oge[]) => void): void => {
      var_.add(anahtar);
      const imzaTam = `${imza}|${ro}|${this.olcek}`;
      const eski = this.dolguKaplari.get(anahtar);
      if (eski?.imza === imzaTam) return;
      if (eski) {
        this.dolguKabiniKaldir(anahtar, eski);
        kaldirildi = true;
      }
      const kap = new Container();
      const ogeler: Oge[] = [];
      doldur(kap, ogeler);
      this.dolguKat.addChild(kap);
      kap.label = anahtar;
      this.dolguKaplari.set(anahtar, { kap, imza: imzaTam, ogeler });
      this.gorunurlukGecersiz = true;
    };
    /** Parsel zemini: pişirilmiş tek sprite (desteklenmiyorsa karo döşemesi); park/arsada üstüne deterministik ağaçlar ayrı sprite olarak biner. */
    const parselKaro = (kap: Container, ogeler: Oge[], h: Hucre, sp: SpriteKaydi, agacSp?: SpriteKaydi | null, tohum?: string): void => {
      const agaclar: Hucre[] = [];
      this.parselZemini(kap, ogeler, sp, h, ro, (c, r) => this.karoSprite(kap, sp, hucredenEkrana({ c, r }), ogeler));
      if (agacSp && tohum !== undefined) {
        for (const r of karoMerkezleri(h.r - 0.5, h.r + 0.5, ro)) for (const c of karoMerkezleri(h.c - 0.5, h.c + 0.5, ro)) if (fnv1a(`${tohum}|${Math.round(c * 1000)}|${Math.round(r * 1000)}`) % 100 < 20) agaclar.push({ c, r });
        for (const a of agaclar.sort((x, y) => derinlik(x) - derinlik(y))) this.karoSprite(kap, agacSp, hucredenEkrana(a), ogeler);
      }
    };
    for (const d of s.dolgu) {
      if (d.sprite?.grup !== "zemin") continue;
      const sp = d.sprite;
      if (d.tur === "park") {
        const cim = zeminSprite(this.manifest, "cim");
        duzenle(`d:${d.parselId}`, `park|${sp.dosya}|${cim?.dosya ?? ""}`, (kap, ogeler) => parselKaro(kap, ogeler, d.hucre, cim ?? sp, cim ? sp : null, d.parselId));
      } else duzenle(`d:${d.parselId}`, `${d.tur}|${sp.dosya}`, (kap, ogeler) => parselKaro(kap, ogeler, d.hucre, sp));
    }
    for (const g of s.genislemeler) {
      if (g.sprite?.grup !== "zemin") continue;
      const sp = g.sprite;
      duzenle(`g:${g.binaId}`, `${g.tur}|${sp.dosya}|${g.hucre.c}|${g.hucre.r}`, (kap, ogeler) => parselKaro(kap, ogeler, g.hucre, sp));
    }
    for (const [k, v] of this.dolguKaplari) if (!var_.has(k)) {
      this.dolguKabiniKaldir(k, v);
      kaldirildi = true;
    }
    if (kaldirildi) {
      this.hedefTemizle();
      this.gorunurlukGecersiz = true;
    }
  }
  private dolguKabiniKaldir(k: string, v: DolguKabi): void {
    this.dolguKat.removeChild(v.kap);
    v.kap.destroy({ children: true });
    this.dolguKaplari.delete(k);
  }

  // --- bina ve bina-benzeri nesneler -------------------------------------------------

  /** Nesne kümesi ya da konumu değiştiyse true (görünürlük yeniden hesaplanır). */
  private nesneleriGuncelle(s: IzoSahne): boolean {
    let degisti = false;
    const var_ = new Set<string>();
    type Girdi = { anahtar: string; kayit: SpriteKaydi; ax: number; ay: number; z: number; ref: HaritaRef | null; b: IzoBina | null; durum: GorselDurum; boy: 1 | 2 | 3 | 4; etiket: string | null };
    const girdiler: Girdi[] = [];
    for (const b of s.binalar) girdiler.push({ anahtar: `b:${b.id}`, kayit: b.sprite, ax: b.ankraj.x, ay: b.ankraj.y, z: b.z, ref: b.ref, b, durum: b.tur === "isletme" ? b.durum : "uretim", boy: b.boy, etiket: b.tur === "isletme" ? b.sahne.etiket : null });
    for (const d of s.dolgu) {
      if (!d.sprite || d.sprite.grup === "zemin") continue;
      const e = hucredenEkrana(d.hucre);
      girdiler.push({ anahtar: `d:${d.parselId}`, kayit: d.sprite, ax: e.x, ay: e.y + yarimKaro, z: d.z, ref: null, b: null, durum: "uretim", boy: 1, etiket: null });
    }
    for (const g of s.genislemeler) {
      if (!g.sprite || g.sprite.grup === "zemin") continue;
      const e = hucredenEkrana(g.hucre);
      girdiler.push({ anahtar: `g:${g.binaId}`, kayit: g.sprite, ax: e.x, ay: e.y + yarimKaro, z: g.z, ref: null, b: null, durum: "uretim", boy: 1, etiket: null });
    }
    girdiler.sort((a, b) => a.z - b.z || (a.anahtar < b.anahtar ? -1 : a.anahtar > b.anahtar ? 1 : 0));

    for (const gi of girdiler) {
      var_.add(gi.anahtar);
      const imza = [gi.kayit.dosya, gi.ax, gi.ay, gi.z, gi.durum, gi.boy, s.olcek, this.tema].join("|");
      let o = this.nesneler.get(gi.anahtar);
      if (o?.imza === imza) {
        if (gi.ref) o.ref = gi.ref;
        continue;
      }
      degisti = true;
      if (!o) o = this.nesneYap(gi.anahtar, gi.kayit, gi.b !== null);
      o.ref = gi.ref;
      o.ax = gi.ax;
      o.ay = gi.ay;
      o.z = gi.z;
      o.kap.zIndex = gi.z;
      o.imza = imza;
      o.isletme = gi.b?.tur === "isletme";
      o.etiket = gi.etiket;
      o.boy = gi.boy;
      o.durum = gi.durum;
      if (o.kayit.dosya === gi.kayit.dosya) o.bekleyen = null;
      else if (o.gecis && (o.gecis.tur === "buyudu" || o.gecis.tur === "kuculdu") && this.mod === "tam") {
        // Büyüme/küçülme: önce bindirme (eski yapıda), geçiş bitince yeni sprite; doku önceden istenir ki geçiş anında hazır olsun.
        o.bekleyen = gi.kayit;
        if (o.gorunur) this.grupIste(this.nesneGrubu(gi.kayit));
      } else {
        o.bekleyen = null;
        this.kayitDegistir(o, gi.kayit);
      }
      if (o.uygulanan === o.kayit.dosya || o.uygulanan === null) this.nesneYerlestir(o);
      this.durumUygula(o);
      if (o.gecis) this.gecisUygula(o, Math.min(1, (this.zaman - o.gecis.t0) / o.gecis.sure));
      o.kutu = this.nesneKutusu(o);
      if (gi.b) o.kap.hitArea = new Polygon(binaVurusAlani({ x: o.ax, y: o.ay }, gi.kayit, s.olcek));
      else o.kap.hitArea = null;
    }
    for (const [k, o] of this.nesneler) {
      if (var_.has(k)) continue;
      degisti = true;
      this.hedefCikar(o.grup, o.sprite);
      if (o.bindirme) this.hedefCikar(o.bindirme.grup, o.bindirme.sprite);
      o.kap.destroy({ children: true });
      this.nesneler.delete(k);
    }
    return degisti;
  }

  /** Sprite kaydını değiştirir (doku grubu geçişi); yeni doku gelene dek eski görünür. */
  private kayitDegistir(o: Obje, kayit: SpriteKaydi): void {
    if (o.kayit.dosya !== kayit.dosya) {
      this.hedefCikar(o.grup, o.sprite);
      o.kayit = kayit;
      o.grup = this.nesneGrubu(kayit);
      this.hedefEkle(o.grup, { sprite: o.sprite, uygula: () => this.nesneYerlestir(o) });
      if (o.gorunur) this.grupIste(o.grup);
    } else o.kayit = kayit;
  }

  private nesneGrubu(k: SpriteKaydi): Grup {
    // Nesne sprite'ları dosya başına ortak grupta toplanır (tek Texture); grup nesne haritasında yaşar.
    let gr = this.nesneGruplari.get(k.dosya);
    if (!gr || gr.gitti) {
      gr = { kayit: k, hedefler: [], tex: null, istendi: false, gitti: false };
      this.nesneGruplari.set(k.dosya, gr);
      this.gruplar.add(gr);
    }
    return gr;
  }
  private nesneYap(anahtar: string, kayit: SpriteKaydi, tiklanir: boolean): Obje {
    const kap = new Container();
    kap.label = anahtar;
    const sprite = new Sprite();
    sprite.eventMode = "none";
    kap.addChild(sprite);
    if (tiklanir) {
      kap.eventMode = "static";
      kap.cursor = "pointer";
      kap.on("pointertap", (e?: { pointerType?: string; global?: { x: number; y: number } }) => {
        const son = this.nesneler.get(anahtar);
        if (!son?.ref || this.tasidi) return;
        this.tiklama(son.ref);
        // Dokunmatikte hover yoktur: ilk dokunuş hem seçer hem ipucunu gösterir.
        if (e?.pointerType === "touch" || e?.pointerType === "pen") {
          const id = anahtar.startsWith("b:") ? anahtar.slice(2) : anahtar;
          const v = e.global ? this.ipucuVerisi(id, e.global.x, e.global.y) : null;
          if (v) {
            this.ipucuCiz(v);
            this.app.render();
            this.onHover?.(v, true);
          }
        }
      });
      kap.on("pointerover", (e?: { pointerType?: string; global?: { x: number; y: number } }) => {
        if (e?.pointerType !== "mouse") return;
        const id = anahtar.startsWith("b:") ? anahtar.slice(2) : anahtar;
        this.hoverId = id;
        this.sonImlec = e.global ? { x: e.global.x, y: e.global.y } : null;
        this.hoverCiz();
        this.app.render();
        const v = e.global ? this.ipucuVerisi(id, e.global.x, e.global.y) : null;
        if (v) {
          this.sonIpucu = JSON.stringify(v);
          this.ipucuCiz(v);
          this.app.render();
          this.onHover?.(v);
        }
      });
      kap.on("pointermove", (e?: { pointerType?: string; global?: { x: number; y: number } }) => {
        if (e?.pointerType !== "mouse" || !e.global || this.hoverId === null) return;
        this.sonImlec = { x: e.global.x, y: e.global.y };
        if (!this.ipucuKat.visible) return;
        this.ipucuKonumla(e.global.x, e.global.y);
        this.app.render();
      });
      kap.on("pointerout", () => {
        if (this.hoverId === null) return;
        this.hoverId = null;
        this.sonImlec = null;
        this.sonIpucu = "";
        this.hoverCiz();
        this.ipucuKapat();
        this.app.render();
        this.onHover?.(null);
      });
    } else kap.eventMode = "none";
    this.binaKat.addChild(kap);
    const o: Obje = {
      anahtar, kap, sprite, kayit, grup: this.nesneGrubu(kayit), uygulanan: null, bindirme: null, yedek: null, isletme: false, etiket: null, boy: 1, durum: "uretim",
      gecis: null, bekleyen: null, isik: null, duman: null, parlama: null, tintli: false, fxTema: this.tema, ax: 0, ay: 0, z: 0, ref: null,
      kutu: { x0: 0, y0: 0, x1: 0, y1: 0 }, gorunur: false, imza: "",
    };
    kap.visible = false;
    this.hedefEkle(o.grup, {
      sprite,
      uygula: () => {
        o.uygulanan = o.kayit.dosya;
        this.nesneYerlestir(o);
        if (o.ref) this.onDoku?.(o.ref);
      },
    });
    this.nesneler.set(anahtar, o);
    return o;
  }

  /** Sprite'ı güncel kayda göre ölçekler, çapalar ve konumlar (doku yoksa da zararsız). */
  private nesneYerlestir(o: Obje): void {
    const { sprite, kayit: k } = o;
    sprite.anchor.set(k.ankraj.x / k.genislik, k.ankraj.y / k.yukseklik);
    sprite.scale.set(this.olcek);
    sprite.position.set(o.ax, o.ay);
    if (o.bindirme) {
      const bk = o.bindirme.kayit;
      o.bindirme.sprite.anchor.set(bk.ankraj.x / bk.genislik, bk.ankraj.y / bk.yukseklik);
      o.bindirme.sprite.scale.set(this.olcek);
      o.bindirme.sprite.position.set(o.ax, o.ay);
    }
    this.efektiKonumla(o);
  }

  private nesneKutusu(o: Obje): { x0: number; y0: number; x1: number; y1: number } {
    const k = o.kayit;
    const x0 = o.ax - k.ankraj.x * this.olcek;
    const y0 = o.ay - k.ankraj.y * this.olcek;
    return { x0, y0, x1: x0 + k.genislik * this.olcek, y1: y0 + k.yukseklik * this.olcek };
  }

  // --- durum görselleri: sprite alfa/tint, bindirme, ışık, duman, geçişler -------------------

  /** Bindirme türü: etkin geçiş (kuruldu/büyüdü iskele, battı/küçüldü tahta) önce, yoksa durum tablosu. */
  private bindirmeTuru(o: Obje): BindirmeTuru | null {
    if (!o.isletme) return null;
    switch (o.gecis?.tur) {
      case "kuruldu": case "buyudu": return "iskele";
      case "batti": case "kuculdu": return "tahtali";
      default: break;
    }
    const d = durumGorunumu(o.durum);
    return d.tahta ? "tahtali" : d.iskele ? "iskele" : null;
  }

  /** Durumun son (durağan) görünümü: sprite alfa/tint ve bindirme. Geçiş varsa `gecisUygula` bunun üstüne yazar. */
  private durumUygula(o: Obje): void {
    const d = durumGorunumu(o.isletme ? o.durum : "uretim");
    o.sprite.alpha = d.alfa;
    this.tintYaz(o, d.tint);
    this.bindirmeKur(o, this.bindirmeTuru(o));
    this.bindirmeAlfa(o, 1);
  }

  /** Çarpma tint'i (gri/soluk); filtre değil, batching bozulmaz. `null` = değişmez. */
  private tintYaz(o: Obje, tint: number | null): void {
    if (tint !== null) {
      o.sprite.tint = tint;
      o.tintli = true;
    } else if (o.tintli) {
      o.sprite.tint = 0xffffff;
      o.tintli = false;
    }
  }
  private bindirmeAlfa(o: Obje, a: number): void {
    if (o.bindirme) o.bindirme.sprite.alpha = a;
    if (o.yedek) o.yedek.g.alpha = a;
  }

  private bindirmeKur(o: Obje, tur: BindirmeTuru | null): void {
    const iki = o.kayit.parselSayisi === 2;
    const boy = (o.kayit.boy ?? o.boy) as 1 | 2 | 3 | 4;
    const kayit = tur ? bindirmeSprite(this.manifest, tur, iki ? 2 : 1, boy) : null;
    // manifest sprite'ı
    if (!kayit || tur === null) this.bindirmeKaldir(o);
    else if (!o.bindirme || o.bindirme.kayit.dosya !== kayit.dosya) {
      this.bindirmeKaldir(o);
      const sprite = new Sprite();
      sprite.eventMode = "none";
      o.kap.addChild(sprite);
      const grup = this.nesneGrubu(kayit);
      o.bindirme = { sprite, kayit, grup, tur };
      this.hedefEkle(grup, { sprite });
      if (o.gorunur) this.grupIste(grup);
    }
    // yedek Graphics (manifestte bindirme yoksa)
    if (tur !== null && !kayit) {
      const imza = [tur, o.kayit.dosya, this.olcek, this.tema].join("|");
      if (o.yedek?.imza !== imza) {
        if (o.yedek) {
          o.kap.removeChild(o.yedek.g);
          o.yedek.g.destroy();
        }
        const g = new Graphics();
        g.label = `yedek-${tur}`;
        g.eventMode = "none";
        this.yedekCiz(g, tur, o.kayit);
        o.kap.addChild(g);
        o.yedek = { g, tur, imza };
      }
    } else if (o.yedek) {
      o.kap.removeChild(o.yedek.g);
      o.yedek.g.destroy();
      o.yedek = null;
    }
    this.nesneYerlestir(o);
  }
  private bindirmeKaldir(o: Obje): void {
    if (!o.bindirme) return;
    this.hedefCikar(o.bindirme.grup, o.bindirme.sprite);
    o.kap.removeChild(o.bindirme.sprite);
    o.bindirme.sprite.destroy();
    o.bindirme = null;
  }
  /** Yedek iskele (direkler ve çıtalar) ya da tahta (çapraz kalaslar); ankraj noktasında yerel koordinat. */
  private yedekCiz(g: Graphics, tur: BindirmeTuru, k: SpriteKaydi): void {
    const W = (k.parsel.genislik * this.olcek) / 2;
    const E = Z.efekt.yedek;
    const H = k.ankraj.y * this.olcek * E.yukseklik;
    const renk = this.renk(tur === "iskele" ? IZO_RENGI.iskele : IZO_RENGI.tahta);
    if (tur === "iskele") {
      for (const x of [-0.55, 0.55]) g.rect(x * W - E.direk / 2, -H, E.direk, H).fill(renk);
      for (const y of [0.33, 0.66, 1]) g.rect(-0.55 * W, -H * y, 1.1 * W, E.cita).fill(renk);
    } else {
      for (const y of [0.25, 0.55, 0.85]) g.rect(-0.5 * W, -H * y, W, Math.max(E.cita, H * E.tahtaOran)).fill(renk);
      g.poly([-0.5 * W, 0, -0.35 * W, 0, 0.5 * W, -H, 0.35 * W, -H]).fill(renk);
    }
  }

  private efektiKonumla(o: Obje): void {
    const k = o.kayit;
    o.yedek?.g.position.set(o.ax, o.ay);
    o.isik?.position.set(o.ax, o.ay - Z.efekt.isik.yukseklik * k.ankraj.y * this.olcek);
    o.duman?.position.set(o.ax, o.ay - Z.efekt.duman.yukseklik * k.ankraj.y * this.olcek);
    o.parlama?.position.set(o.ax, o.ay - (k.parsel.yukseklik * this.olcek) / 2);
  }

  private isikYap(o: Obje): void {
    if (o.isik) return;
    const g = new Graphics();
    g.label = "isik";
    g.eventMode = "none";
    const E = Z.efekt.isik;
    g.circle(0, 0, Math.max(E.enAz, E.yaricap * this.olcek)).fill({ color: this.renk(IZO_RENGI.isikSicak), alpha: E.alfa });
    o.kap.addChild(g);
    o.isik = g;
    this.efektiKonumla(o);
  }
  private isikKaldir(o: Obje): void {
    if (!o.isik) return;
    o.kap.removeChild(o.isik);
    o.isik.destroy();
    o.isik = null;
  }
  private dumanYap(o: Obje): void {
    if (o.duman) return;
    const kap = new Container();
    kap.label = "duman";
    kap.eventMode = "none";
    const E = Z.efekt.duman;
    const renk = this.renk(IZO_RENGI.duman);
    for (let i = 0; i < E.adet; i++) {
      const p = new Graphics();
      p.eventMode = "none";
      p.circle(0, 0, Math.max(E.enAz, E.yaricap * this.olcek)).fill({ color: renk, alpha: E.alfa });
      kap.addChild(p);
    }
    o.kap.addChild(kap);
    o.duman = kap;
    this.efektiKonumla(o);
    this.dumanKare(o);
  }
  private dumanKaldir(o: Obje): void {
    if (!o.duman) return;
    o.kap.removeChild(o.duman);
    o.duman.destroy({ children: true });
    o.duman = null;
  }
  private dumanKare(o: Obje): void {
    if (!o.duman) return;
    const n = o.duman.children.length;
    o.duman.children.forEach((p, i) => {
      const faz = (this.zaman / Z.animasyon.dumanMs + i / n) % 1;
      const E = Z.efekt.duman;
      p.position.set(faz * E.yatay * this.olcek, -faz * E.yukselme * this.olcek);
      p.alpha = E.alfa * (1 - faz);
      p.scale.set(E.olcekBaslangic + faz);
    });
  }

  /**
   * Görünen binalarda ışık (durum tablosu) ve duman (bacalı türler, en çok `animasyon.enCok` bina, yalnız tam modda) kurar; görünmeyende geçiş ve dumanı bırakır.
   * Işık durağandır (hareket azaltılmışta da görünür); duman hareket olduğundan yalnız tam modda.
   */
  private efektleriGuncelle(): void {
    this.efektBekliyor = false;
    const dumanAdaylari: Obje[] = [];
    const isikAdaylari: Obje[] = [];
    for (const o of this.nesneler.values()) {
      if (!o.gorunur) {
        if (o.gecis) this.gecisBitir(o);
        this.dumanKaldir(o);
        continue;
      }
      if (o.fxTema !== this.tema) {
        this.isikKaldir(o);
        this.dumanKaldir(o);
        o.fxTema = this.tema;
      }
      if (!o.isletme) continue;
      const d = durumGorunumu(o.durum);
      const isik = d.isik || o.gecis?.tur === "zayifladi" || o.gecis?.tur === "toparlandi";
      if (isik) isikAdaylari.push(o);
      else this.isikKaldir(o);
      if (this.mod === "tam" && d.duman && o.etiket !== null && (IZO_STILI.dumanTurleri as readonly string[]).includes(o.etiket)) dumanAdaylari.push(o);
      else this.dumanKaldir(o);
    }
    // Işık da sınırlı: en çok `isikEnCok` bina (geçişte olanlar önce, sonra anahtar sırası); fazlası ışıksız.
    isikAdaylari.sort((a, b) => Number(!!b.gecis) - Number(!!a.gecis) || (a.anahtar < b.anahtar ? -1 : a.anahtar > b.anahtar ? 1 : 0));
    isikAdaylari.forEach((o, i) => (i < Z.animasyon.isikEnCok ? this.isikYap(o) : this.isikKaldir(o)));
    dumanAdaylari.sort((a, b) => (a.anahtar < b.anahtar ? -1 : a.anahtar > b.anahtar ? 1 : 0));
    dumanAdaylari.forEach((o, i) => (i < Z.animasyon.enCok ? this.dumanYap(o) : this.dumanKaldir(o)));
  }

  /** Geçiş kimliği bir kez işlenir; kimlik kümesi sınırlı tutulur. */
  private gecisIsle(g: Gecis): boolean {
    const k = `${g.id}:${g.hafta}:${g.tur}`;
    if (this.islenenGecis.has(k)) return false;
    this.islenenGecis.add(k);
    if (this.islenenGecis.size > 512) this.islenenGecis.delete(this.islenenGecis.values().next().value as string);
    return true;
  }
  /** Büyüme/küçülme sprite değişiminden ÖNCE başlar (eski yapı bindirmeyle görünür kalsın). Görünen mevcut binalarda yalnız tam modda. */
  private buyumeGecisleriniBaslat(s: IzoSahne): boolean {
    let basladi = false;
    for (const g of s.gecisler) {
      if (g.tur !== "buyudu" && g.tur !== "kuculdu") continue;
      const o = this.nesneler.get(`b:${g.id}`);
      if (this.mod !== "tam" || !o || !o.gorunur || o.gecis) continue;
      if (!this.gecisIsle(g)) continue;
      this.gecisBaslat(o, g.tur);
      basladi = true;
    }
    return basladi;
  }
  /** Öteki geçişler görünürlük hesabından SONRA başlar (yeni kurulan bina da vardır). Görünmeyen ya da hareket kapalıyken atlanır (son durum zaten çizili). */
  private gecisleriBaslat(s: IzoSahne): boolean {
    let basladi = false;
    for (const g of s.gecisler) {
      if (!this.gecisIsle(g)) continue;
      const o = this.nesneler.get(`b:${g.id}`);
      if (this.mod !== "tam" || !o || !o.gorunur || o.gecis) continue;
      this.gecisBaslat(o, g.tur);
      basladi = true;
    }
    return basladi;
  }
  private gecisBaslat(o: Obje, tur: Gecis["tur"]): void {
    o.gecis = { tur, t0: this.zaman, sure: tur === "canlandi" ? Z.animasyon.parlamaMs : Z.buyume.bindirmeMs };
    if (tur === "canlandi" && !o.parlama) {
      const g = new Graphics();
      g.label = "parlama";
      g.eventMode = "none";
      g.circle(0, 0, (o.kayit.parsel.genislik * this.olcek) / 2).stroke({ width: Z.efekt.parlama.cizgi, color: this.renk(IZO_RENGI.isikSicak) });
      o.kap.addChild(g);
      o.parlama = g;
    }
    if (tur === "zayifladi" || tur === "toparlandi") this.isikYap(o);
    this.efektiKonumla(o);
    this.durumUygula(o);
    this.gecisUygula(o, 0);
  }
  /** Geçişin `p` (0..1) anındaki görünümü; durağan görünümün üstüne yazar. */
  private gecisUygula(o: Obje, p: number): void {
    const gc = o.gecis;
    if (!gc) return;
    const d = durumGorunumu(o.durum);
    switch (gc.tur) {
      case "kuruldu":
        o.sprite.alpha = d.alfa * p; // iskele tam görünür, bina onun içinden belirir
        break;
      case "batti":
        o.sprite.alpha = 1 + (d.alfa - 1) * p;
        this.tintYaz(o, p >= 0.5 ? d.tint : null);
        this.bindirmeAlfa(o, p);
        break;
      case "canlandi":
        if (o.parlama) {
          const E = Z.efekt.parlama;
          o.parlama.scale.set(E.olcekBaslangic + p, (E.olcekBaslangic + p) * E.egim);
          o.parlama.alpha = 1 - p;
        }
        break;
      case "zayifladi":
        if (o.isik) o.isik.alpha = 1 - p;
        break;
      case "toparlandi":
        if (o.isik) o.isik.alpha = p;
        break;
      default: // buyudu, kuculdu: bindirme tam görünür (durumUygula)
        break;
    }
  }
  private gecisBitir(o: Obje): void {
    o.gecis = null;
    if (o.parlama) {
      o.kap.removeChild(o.parlama);
      o.parlama.destroy();
      o.parlama = null;
    }
    if (o.bekleyen) {
      this.kayitDegistir(o, o.bekleyen);
      o.bekleyen = null;
      o.kutu = this.nesneKutusu(o);
    }
    if (o.isik) o.isik.alpha = 1;
    this.durumUygula(o);
    this.efektleriGuncelleTek(o);
    this.efektBekliyor = true;
  }
  /** Geçiş bitince bu bina için ışık/duman durağan durumu. */
  private efektleriGuncelleTek(o: Obje): void {
    if (!o.gorunur || !o.isletme) return;
    if (!durumGorunumu(o.durum).isik) this.isikKaldir(o); // yeni ışık sınırı gözeten efektleriGuncelle'de kurulur
  }

  // --- görünürlük --------------------------------------------------------------------

  private gorunurlukGuncelle(g: Gorunum, zorla: boolean, kutu?: { genislik: number; yukseklik: number }): void {
    const w = kutu && kutu.genislik > 0 ? kutu.genislik : this.app.screen.width;
    const h = kutu && kutu.yukseklik > 0 ? kutu.yukseklik : this.app.screen.height;
    const kay = this.govde.position;
    const v = { x0: -g.x / g.olcek - kay.x, y0: -g.y / g.olcek - kay.y, x1: (w - g.x) / g.olcek - kay.x, y1: (h - g.y) / g.olcek - kay.y };
    const k0 = this.kapsama;
    if (this.gorunurlukGecersiz) {
      zorla = true;
      this.gorunurlukGecersiz = false;
    }
    if (!zorla && k0 && v.x0 >= k0.x0 && v.y0 >= k0.y0 && v.x1 <= k0.x1 && v.y1 <= k0.y1) return;
    this.gorunurlukHesabi++;
    const px = (v.x1 - v.x0) * Z.gorunurluk.pay;
    const py = (v.y1 - v.y0) * Z.gorunurluk.pay;
    const k = { x0: v.x0 - px, y0: v.y0 - py, x1: v.x1 + px, y1: v.y1 + py };
    this.kapsama = k;
    // Zemin ve dolgu sprite'ları: kutusu kamera payı kutusuyla kesişmeyen çizilmez (büyük şehirde on binlerce karo; Pixi gizli çocukları atlar).
    const ele = (o: Oge): void => {
      const gor = this.ogeGorunur(o, k);
      if (gor !== o.sp.visible) o.sp.visible = gor;
    };
    for (const o of this.zeminOgeleri) ele(o);
    for (const d of this.dolguKaplari.values()) for (const o of d.ogeler) ele(o);
    for (const o of this.nesneler.values()) {
      const gor = o.kutu.x1 >= k.x0 && o.kutu.x0 <= k.x1 && o.kutu.y1 >= k.y0 && o.kutu.y0 <= k.y1;
      if (gor !== o.gorunur) {
        o.gorunur = gor;
        o.kap.visible = gor;
      }
      if (gor) {
        this.grupIste(o.grup);
        if (o.bindirme) this.grupIste(o.bindirme.grup);
      }
    }
  }

  // --- tıklanabilir yerler: meydan ve kur hedefleri ---------------------------------

  private yerleriGuncelle(s: IzoSahne, secili: HaritaRef | null): void {
    const renk = this.renk(IZO_RENGI.secili);
    const kalinlik = Z.plaka.seciliKalinlik;
    if (this.meydan === null) {
      const g = new Graphics();
      g.label = "meydan";
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointertap", () => {
        if (!this.tasidi) this.tiklama({ kind: "lonca", ref: MEYDAN_REF });
      });
      this.yerKat.addChild(g);
      this.meydan = g;
    }
    const hucreler = s.plaza.hucreler.map((h) => ayakIzi(h, null));
    // Tıklama alanı: plaza hücreleri ve aralarındaki merkez kavşak (dört hücrenin çevrelediği karelik çekirdek).
    const yari = 1 + s.zemin.ro / 2;
    const cekirdek = dikdortgenCokgeni(s.plaza.hucre.c - yari, s.plaza.hucre.c + yari, s.plaza.hucre.r - yari, s.plaza.hucre.r + yari);
    const alan = [...hucreler, cekirdek];
    this.meydan.hitArea = { contains: (x: number, y: number) => alan.some((p) => cokgenIcinde(p, x, y)) };
    this.meydan.clear();
    if (secili?.kind === "lonca" && secili.ref === MEYDAN_REF) for (const p of hucreler) this.meydan.poly(p).stroke({ width: kalinlik, color: renk });

    const gorunen = new Set<string>();
    for (const b of s.bosHucreler) {
      gorunen.add(b.parselId);
      let g = this.kurHedefleri.get(b.parselId);
      if (!g) {
        g = new Graphics();
        g.label = `bos:${b.parselId}`;
        g.eventMode = "static";
        g.cursor = "pointer";
        const id = b.parselId;
        g.on("pointertap", () => {
          if (!this.tasidi) this.tiklama({ kind: "parsel", ref: id });
        });
        this.yerKat.addChild(g);
        this.kurHedefleri.set(b.parselId, g);
      }
      const p = ayakIzi(b.hucre, b.hucre2);
      g.hitArea = { contains: (x: number, y: number) => cokgenIcinde(p, x, y) };
      g.clear();
      if (secili?.kind === "parsel" && secili.ref === b.parselId) g.poly(p).stroke({ width: kalinlik, color: renk });
    }
    for (const [k, g] of this.kurHedefleri) if (!gorunen.has(k)) { g.destroy(); this.kurHedefleri.delete(k); }
  }

  // --- plaka (ton, ilan) ve halka (seçim, ben) ---------------------------------------

  private plakaVeHalka(s: IzoSahne, secili: HaritaRef | null): void {
    const k = s.kaynak;
    const plaka = this.plakaKat.clear();
    const halka = this.halkaKat.clear();
    const benId = k.ben?.binaId;
    const benKat = this.benKat.clear();
    this.benNabzi = false;
    for (const b of s.binalar) {
      const sec = ayniRef(secili, b.ref);
      const ben = benId === b.id;
      const ilan = k.ilanVeren?.has(b.id) ?? false;
      const ton = k.katman.tonlar.get(b.id);
      if (!ton && !ilan && !sec && !ben) continue;
      const p = ayakIzi(b.hucre, b.hucre2);
      if (ton) plaka.poly(p).fill({ color: this.renk(IZO_RENGI.ton[ton]), alpha: Z.plaka.alfa });
      else if (ilan) plaka.poly(p).fill({ color: this.renk(SEHIR_RENGI.ilan), alpha: Z.plaka.ilanDolgu });
      if (ilan && !ben && !sec) plaka.poly(p).stroke({ width: Z.plaka.ilanKalinlik, color: this.renk(SEHIR_RENGI.ilan) });
      if (ben || sec) halka.poly(p).stroke({ width: ben ? Z.plaka.benKalinlik : Z.plaka.seciliKalinlik, color: this.renk(ben ? IZO_RENGI.ben : IZO_RENGI.secili) });
      // Ben: dışa ikinci (kalın) halka; tam modda nabız atar, aksi halde statik kalın halka olarak görünür.
      if (ben) {
        benKat.poly(p).stroke({ width: Z.plaka.benKalinlik + Z.etkilesim.nabizEk, color: this.renk(IZO_RENGI.ben) });
        this.benNabzi = true;
      }
    }
    if (!this.benNabzi || this.mod !== "tam") benKat.alpha = 1;
  }

  // --- etkileşim: nabız, seçim belirmesi, hover parlaması, ipucu ------------------------

  private etkilesimKare(): void {
    if (this.benNabzi && this.mod === "tam") {
      const e = Z.etkilesim;
      const faz = (Math.sin((this.zaman / e.nabizMs) * Math.PI * 2) + 1) / 2;
      this.benKat.alpha = e.nabizEnAz + (1 - e.nabizEnAz) * faz;
    }
    if (this.secimT0 !== null) {
      const p = (this.zaman - this.secimT0) / Z.etkilesim.secimMs;
      if (p >= 1) {
        this.secimT0 = null;
        this.halkaKat.alpha = 1;
      } else this.halkaKat.alpha = Math.max(0, p);
    }
  }
  private etkilesimSifirla(): void {
    this.secimT0 = null;
    this.halkaKat.alpha = 1;
    this.benKat.alpha = 1;
  }
  /** Seçim değişince halka kısa süre belirir (yalnız tam modda; hareket azaltılmışsa anında). */
  private secimBelirmesi(secili: HaritaRef | null): void {
    const anahtar = secili === null ? null : `${secili.kind}:${secili.ref}`;
    if (anahtar === this.secimAnahtari) return;
    this.secimAnahtari = anahtar;
    if (anahtar !== null && this.mod === "tam") {
      this.secimT0 = this.zaman;
      this.halkaKat.alpha = 0;
    } else this.etkilesimSifirla();
  }
  private hoverCiz(): void {
    const g = this.hoverKat.clear();
    if (this.hoverId === null || this.sonSahne === null) return;
    const b = this.sonSahne.binalar.find((x) => x.id === this.hoverId);
    if (b) g.poly(ayakIzi(b.hucre, b.hucre2)).fill({ color: Z.etkilesim.hoverRenk, alpha: Z.etkilesim.hoverAlfa });
  }
  /** Sahne güncellenince (durum, çalışan) hover ipucu bayatlamasın: değiştiyse yeniden bildirilir. */
  private ipucuTazele(): void {
    if (this.hoverId === null || this.sonImlec === null) return;
    const v = this.ipucuVerisi(this.hoverId, this.sonImlec.x, this.sonImlec.y);
    if (v === null) {
      this.hoverId = null;
      this.sonIpucu = "";
      this.ipucuKapat();
      this.onHover?.(null);
      return;
    }
    const j = JSON.stringify(v);
    if (j === this.sonIpucu) return;
    this.sonIpucu = j;
    this.ipucuCiz(v);
    this.onHover?.(v);
  }
  /** İpucu kutusunu içerikle kurar (metin, zemin, çerçeve) ve imlecin yanına koyar. */
  private ipucuCiz(v: IpucuVerisi): void {
    const st = Z.ipucu;
    const m = ipucuMetni(v);
    const aile = this.deger(SEHIR_RENGI.yazi) || S.yedek.aile;
    const yazi = this.renk(SEHIR_RENGI.ipucuYazi);
    // Metinler her çizimde yeniden kurulur (Pixi `Text` stili kurucuda verilir; sonradan atanmaz).
    for (const eski of [this.ipucuBaslik, this.ipucuDetay]) if (eski) { this.ipucuKat.removeChild(eski); eski.destroy(); }
    const yap = (metin: string, kalin: boolean): Text => {
      const tx = new Text({ text: metin, style: { fontFamily: aile, fontSize: st.yaziBoyut, fill: yazi, fontWeight: kalin ? "bold" : "normal" } });
      this.ipucuKat.addChild(tx);
      return tx;
    };
    const detay = m.detay.join("\n");
    const baslik = yap(m.baslik, true);
    const detayTx = detay === "" ? null : yap(detay, false);
    this.ipucuBaslik = baslik;
    this.ipucuDetay = detayTx;
    const olc = (tx: Text, varsayilan: number, yan: "width" | "height"): number => (tx[yan] > 0 ? tx[yan] : varsayilan);
    const bw = olc(baslik, m.baslik.length * st.yaziBoyut * 0.6, "width");
    const bh = olc(baslik, st.yaziBoyut, "height");
    const dw = detayTx === null ? 0 : olc(detayTx, detay.length * st.yaziBoyut * 0.6, "width");
    const dh = detayTx === null ? 0 : olc(detayTx, st.yaziBoyut, "height");
    const w = Math.max(bw, dw) + 2 * st.yanBosluk;
    const h = bh + (detayTx === null ? 0 : st.satirAralik + dh) + 2 * st.dikeyBosluk;
    this.ipucuBoyut = { genislik: w, yukseklik: h };
    baslik.position.set(st.yanBosluk, st.dikeyBosluk);
    detayTx?.position.set(st.yanBosluk, st.dikeyBosluk + bh + st.satirAralik);
    this.ipucuZemin.clear().roundRect(0, 0, w, h, st.kose).fill(this.renk(SEHIR_RENGI.ipucuZemin)).stroke({ width: st.cerceve, color: this.renk(SEHIR_RENGI.ipucuCerceve) });
    this.ipucuKat.visible = true;
    this.ipucuKonumla(v.x, v.y);
  }
  private ipucuKonumla(x: number, y: number): void {
    const k = this.sonGirdi?.kutu ?? { genislik: this.app.screen.width, yukseklik: this.app.screen.height };
    const yer = ipucuYeri(x, y, this.ipucuBoyut, k, Z.ipucu.bosluk);
    this.ipucuKat.position.set(yer.x, yer.y);
  }
  /** İpucu kutusunu gizler (fare ayrıldı ya da dokunmatik ipucu seçimle birlikte kalktı). */
  ipucuKapat(): void {
    if (!this.ipucuKat.visible) return;
    this.ipucuKat.visible = false;
    this.app.render();
  }
  private ipucuVerisi(id: string, x: number, y: number): IpucuVerisi | null {
    const b = this.sonSahne?.binalar.find((o) => o.id === id);
    if (!b || !this.adlar) return null;
    const isletme = b.tur === "isletme";
    return { ad: this.adlar.bina(b.sahne), durum: b.durum, calisan: isletme ? (b.sahne.calisan ?? null) : null, sahip: isletme ? (b.sahne.sahip ?? null) : null, x, y };
  }
  private adlar: Adlandirici | null = null;

  // --- rozet ve etiket ---------------------------------------------------------------

  private rozetVeEtiket(s: IzoSahne, secili: HaritaRef | null, adlar: Adlandirici, tema: number, g: Gorunum): void {
    const k = s.kaynak;
    const aile = this.deger(SEHIR_RENGI.yazi) || S.yedek.aile;
    const yaz = (tx: Text | null, hedef: Container, metin: string, boyut: number, ortala: boolean, renkAd: string): Text => {
      const x = tx ?? new Text({ text: metin, style: { fontFamily: aile, fontSize: boyut, fill: this.renk(renkAd) } });
      if (tx === null) hedef.addChild(x);
      x.text = metin;
      yaziBicimi(x, this.renk(renkAd), aile, boyut);
      x.anchor.set(ortala ? 0.5 : 0, 0);
      return x;
    };
    // Rozetler (işsizlik katmanı): sayı yalnız sayıdır, insan çizilmez.
    const sehirBina = s.binalar.find((b) => b.id === k.sehirBinasi.id);
    const anahtarlar = new Set<string>();
    for (const r of k.katman.rozetler) {
      let hx: number, hy: number;
      if (r.hedef === "sehir" && sehirBina) {
        hx = sehirBina.ankraj.x;
        hy = sehirBina.ankraj.y - sehirBina.sprite.ankraj.y * s.olcek - V.rozet.yBosluk;
      } else {
        const e = hucredenEkrana(s.plaza.hucre);
        hx = e.x;
        hy = e.y;
      }
      anahtarlar.add(r.hedef);
      let z = this.rozetler.get(r.hedef);
      if (!z) {
        z = { g: new Graphics(), t: yaz(null, this.rozetKat, "", V.rozet.yaziBoyut, true, SEHIR_RENGI.rozetYazi), imza: "" };
        this.rozetKat.addChild(z.g);
        this.rozetler.set(r.hedef, z);
      }
      const imza = [r.sayi, hx, hy, tema].join("|");
      if (z.imza === imza) continue;
      z.imza = imza;
      const metin = String(r.sayi);
      z.t = yaz(z.t, this.rozetKat, metin, V.rozet.yaziBoyut, true, SEHIR_RENGI.rozetYazi);
      z.t.anchor.set(0.5, 0.5);
      z.t.position.set(hx, hy);
      const gen = Math.max(2 * V.rozet.yaricap, metin.length * V.rozet.yaziBoyut * 0.7 + V.rozet.yaricap);
      z.g.clear().roundRect(hx - gen / 2, hy - V.rozet.yaricap, gen, 2 * V.rozet.yaricap, V.rozet.yaricap).fill(this.renk(SEHIR_RENGI.rozet));
    }
    for (const [kk, z] of this.rozetler) if (!anahtarlar.has(kk)) { z.g.destroy(); z.t.destroy(); this.rozetler.delete(kk); }

    // Etiketler: şehir ve ahır her zaman, işletme/lonca yalnız seçiliyken ya da Ben iken.
    const var_ = new Set<string>();
    for (const b of s.binalar) {
      const sec = ayniRef(secili, b.ref);
      const ben = k.ben?.binaId === b.id;
      if (!(S.etiket.bina[b.tur] || sec || ben)) continue;
      var_.add(b.id);
      const metin = ben && k.ben ? t(k.ben.neden === "isyeri" ? "harita.senin_isyerin" : k.ben.neden === "isletme" ? "harita.senin_isletmen" : "harita.senin_yerin") : adlar.bina(b.sahne);
      const e = this.etiketler.get(b.id);
      const imza = [metin, tema].join("|");
      const tx = e && e.imza === imza ? e.t : yaz(e?.t ?? null, this.etiketKat, metin, b.tur === "sehir" ? V.etiket.sehirBoyut : V.etiket.boyut, true, SEHIR_RENGI.etiket);
      this.etiketler.set(b.id, { t: tx, x: b.ankraj.x, y: b.ankraj.y, imza });
    }
    for (const [id, e] of this.etiketler) if (!var_.has(id)) { e.t.destroy(); this.etiketler.delete(id); }
    // Etiketler ve rozet yazıları ekranda sabit boyutta kalır.
    const ters = 1 / g.olcek;
    for (const e of this.etiketler.values()) {
      e.t.scale.set(ters);
      e.t.position.set(e.x, e.y + V.etiket.bosluk * ters);
    }
    for (const z of this.rozetler.values()) z.t.scale.set(ters);
  }

  /** Binanın dünya koordinatındaki çizim kutusu (kamera payı için): ankraj + kaydırma, sprite ölçüleri manifestten. */
  binaKutusu(b: IzoBina): IzoKutu {
    const kay = this.govde.position;
    const k = b.sprite;
    const sol = b.ankraj.x + kay.x - k.ankraj.x * this.olcek;
    const ust = b.ankraj.y + kay.y - k.ankraj.y * this.olcek;
    return { sol, sag: sol + k.genislik * this.olcek, ust, alt: ust + k.yukseklik * this.olcek };
  }

  // --- olay balonları ------------------------------------------------------------------

  /**
   * Yeni balonları (kimliği daha önce görülmemiş) bina üstünde gösterir; yeni örnek ilk güncellemede eski balonları gösterilmiş sayar.
   * Ekranda sabit boyut: balon kabı kamera ölçeğinin tersiyle ölçeklenir. Tam modda ticker solma/yükselmeyi yürütür; azaltılmış harekette
   * animasyonsuz statik gösterilir ve `IZO_STILI.balon.azaltMs` sonra bir zamanlayıcıyla kalkar (ticker açılmaz).
   */
  private balonlariGuncelle(s: IzoSahne, g: Gorunum): void {
    const ilk = this.balonIlk;
    this.balonIlk = false;
    for (const b of s.balonlar) {
      if (this.gorulenBalon.has(b.id)) continue;
      // Ekran dışı hedefte balon oynatılmaz ve kimlik tüketilmez (kamera gelince, olay hâlâ güncelse gösterilir).
      if (!ilk && !this.nesneler.get(`b:${b.hedef.binaId}`)?.gorunur) continue;
      this.gorulenBalon.add(b.id);
      if (this.gorulenBalon.size > 512) this.gorulenBalon.delete(this.gorulenBalon.values().next().value as string);
      if (ilk || this.balonlar.size >= Z.balon.enCok) continue;
      const bina = s.binalar.find((x) => x.id === b.hedef.binaId);
      if (!bina) continue;
      this.balonKur(b, bina, s.olcek);
    }
    this.balonDuzenle(g);
  }
  private balonKur(b: Balon, bina: IzoBina, olcek: number): void {
    const st = Z.balon;
    const aile = this.deger(SEHIR_RENGI.yazi) || S.yedek.aile;
    const metin = balonMetni(b);
    const tx = new Text({ text: metin, style: { fontFamily: aile, fontSize: st.yaziBoyut, fill: this.renk(SEHIR_RENGI.rozetYazi) } });
    tx.anchor?.set(0.5, 0.5);
    const tw = tx.width > 0 ? tx.width : metin.length * st.yaziBoyut * 0.6;
    const w = tw + 2 * st.yanBosluk, h = st.yaziBoyut + 2 * st.dikeyBosluk;
    const gr = new Graphics();
    gr.roundRect(-w / 2, -h, w, h, h / 2).fill(this.renk(b.ton === "iyi" ? IZO_RENGI.ton.iyi : b.ton === "kotu" ? IZO_RENGI.ton.dar : IZO_RENGI.ton.orta));
    tx.position.set(0, -h / 2);
    const kap = new Container();
    kap.label = `balon:${b.id}`;
    kap.eventMode = "none";
    kap.addChild(gr, tx);
    this.balonKat.addChild(kap);
    const azalt = this.mod === "kapali";
    const omur = azalt ? st.azaltMs : b.omur;
    const n: BalonNesnesi = { kap, t0: this.zaman, omur, x: bina.ankraj.x, y: bina.ankraj.y - bina.sprite.ankraj.y * olcek - st.ustBosluk, w, h, zamanlayici: null };
    if (azalt) {
      n.zamanlayici = setTimeout(() => {
        n.zamanlayici = null;
        if (this.oldu) return;
        this.balonKaldir(b.id);
        this.app.render();
      }, omur);
    }
    this.balonlar.set(b.id, n);
  }
  private balonKaldir(id: string): void {
    const n = this.balonlar.get(id);
    if (!n) return;
    if (n.zamanlayici !== null) clearTimeout(n.zamanlayici);
    this.balonlar.delete(id);
    this.balonKat.removeChild(n.kap);
    n.kap.destroy({ children: true });
  }
  /** Balonları yerleştirir (ekran sabit boyutu için ters ölçek) ve çakışanları yukarı iter; tam modda yumuşak yükselme ve son `solmaMs`'de solma. */
  private balonDuzenle(g: Gorunum): void {
    if (this.balonlar.size === 0) return;
    const sc = 1 / (g.olcek > 0 ? g.olcek : 1);
    const st = Z.balon;
    const liste = [...this.balonlar.values()];
    const yuk = liste.map((n) => (this.mod === "tam" ? st.yukselme * Math.min(1, ((this.zaman - n.t0) / n.omur) * 4) : 0));
    const kutular = liste.map((n, i) => ({ x: n.x - (n.w * sc) / 2, y: n.y - n.h * sc - yuk[i]! * sc, w: n.w * sc, h: n.h * sc }));
    const y = balonlariDiz(kutular, st.aralik * sc);
    liste.forEach((n, i) => {
      n.kap.scale.set(sc);
      n.kap.position.set(n.x, y[i]! + n.h * sc);
      if (this.mod === "tam") n.kap.alpha = Math.max(0, Math.min(1, (n.omur - (this.zaman - n.t0)) / st.solmaMs));
      else n.kap.alpha = 1;
    });
  }
  private balonKare(): void {
    if (this.balonlar.size === 0) return;
    for (const [id, n] of [...this.balonlar]) if (this.zaman - n.t0 >= n.omur) this.balonKaldir(id);
    const e = this.sonGirdi;
    if (e) this.balonDuzenle(e.g);
  }

  yoket(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.sekmeDegisti);
    this.app.canvas?.removeEventListener?.("webglcontextrestored", this.baglamGeriGeldi);
    const ticker = this.app.ticker;
    if (this.tickerAcik && ticker) {
      ticker.remove(this.kare);
      ticker.stop();
    }
    this.tickerAcik = false;
    this.oldu = true;
    for (const b of this.balonlar.values()) if (b.zamanlayici !== null) clearTimeout(b.zamanlayici);
    this.balonlar.clear();
    this.dokular.yoket?.();
    this.dunya.destroy({ children: true });
    for (const d of this.parselDokulari.values()) d.tex.destroy(true);
    this.parselDokulari.clear();
    this.zeminOgeleri = [];
    this.nesneler.clear();
    this.dolguKaplari.clear();
    this.rozetler.clear();
    this.etiketler.clear();
    this.kurHedefleri.clear();
    this.gruplar.clear();
    this.nesneGruplari.clear();
    this.meydan = null;
  }
}
