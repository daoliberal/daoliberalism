import { katalogKaydi, VARSAYILAN_KATALOG, type BinaKatalogu } from "./binaKatalogu";
import { SABLON_RENGI, SVG_KATMANLARI, VARLIK_STILI } from "./haritaStili";
import { SUS_KATALOGU, type SusKimligi } from "./susKatalogu";
import type { BinaBoyu, Sablon } from "./tipler";

/**
 * Harita varlık yükleyici. Katalog kaydına göre iki yol:
 * - `svg-katmanli`: SVG metni okunur, `data-katman` işaretli katmanlara `--harita-*` takma adlarının değeri yazılır
 *   (çizimde sabit renk yoktur), `data-ek` ekleri boya göre açılır/kapanır, sonuç doku olur.
 * - `resim` (png/webp): tonlamasız doğrudan yüklenir; `dosyaKoyu` varsa koyu temada o kullanılır.
 * Resimle değiştirme: dosyayı `public/oyun-harita/` altına koy + katalog satırını değiştir; bu dosya değişmez.
 */

type RGB = [number, number, number];

function ayristir(v: string): RGB | null {
  const s = v.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as RGB;
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as RGB;
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const onAlti = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** `ana` rengine `ile` rengini `oran` kadar karıştırır (0-1). Ayrıştırılamazsa `ana` aynen döner. */
export function karistir(ana: string, ile: string, oran: number): string {
  const a = ayristir(ana);
  const b = ayristir(ile);
  if (!a || !b) return ana;
  return `#${[0, 1, 2].map((i) => onAlti(a[i]! * (1 - oran) + b[i]! * oran)).join("")}`;
}

/** Katmanlı SVG metnini tonlar. `anaRenk`: şablonun ana renk takma adı; `renk(ad)`: takma adın şimdiki değeri. */
export function svgTonla(svg: string, boy: BinaBoyu, anaRenk: string, renk: (ad: string) => string, cozunurluk: number): string {
  const belge = new DOMParser().parseFromString(svg, "image/svg+xml");
  const kok = belge.documentElement;
  const ana = renk(anaRenk);
  const kontur = renk("--harita-kontur");
  for (const el of Array.from(belge.querySelectorAll("[data-katman]"))) {
    const kural = SVG_KATMANLARI[el.getAttribute("data-katman") ?? ""];
    if (!kural) continue;
    const taban = kural.renk === "grup" ? ana : renk(kural.renk);
    el.setAttribute("fill", kural.karisim ? karistir(taban, renk(kural.karisim.ile), kural.karisim.oran) : taban);
    if (!kural.cizgisiz) {
      el.setAttribute("stroke", kontur);
      el.setAttribute("stroke-width", String(VARLIK_STILI.konturKalinligi));
      el.setAttribute("stroke-linejoin", "round");
    }
  }
  for (const el of Array.from(belge.querySelectorAll("[data-ek]"))) {
    if (Number(el.getAttribute("data-ek")) > boy) el.setAttribute("display", "none");
  }
  const kutu = (kok.getAttribute("viewBox") ?? "0 0 100 100").split(/[\s,]+/).map(Number);
  kok.setAttribute("width", String((kutu[2] ?? 100) * cozunurluk));
  kok.setAttribute("height", String((kutu[3] ?? 100) * cozunurluk));
  return new XMLSerializer().serializeToString(kok);
}

export type DokuKaynagi = { svg: string } | { url: string };
export type YukleyiciBagimliliklari<T> = {
  /** `--harita-*` takma adının şimdiki değeri (`.kok` öğesinin computed stili). */
  renk(ad: string): string;
  /** `public/oyun-harita` altındaki svg metnini getirir. */
  getir(yol: string): Promise<string>;
  /** Kaynaktan doku üretir (Pixi tarafı). */
  dokuYap(kaynak: DokuKaynagi, cozunurluk: number): Promise<T>;
  /** Tema sayacı: değişince doku anahtarı değişir. */
  tema(): number | string;
  koyu(): boolean;
  katalog?: BinaKatalogu;
  /** Dokuyu yok eder (Pixi: `destroy(true)`); verilmezse eski dokular yalnız önbellekten atılır. */
  dokuYoket?(doku: T): void;
};

export class VarlikYukleyici<T> {
  private readonly onbellek = new Map<string, { p: Promise<T>; v?: T }>();
  /** Tema değişince önbellekten atılan ama sprite'larda hâlâ görünebilen dokular. */
  private emekli = new Set<T>();
  constructor(private readonly b: YukleyiciBagimliliklari<T>) {}

  doku(sablon: Sablon, boy: BinaBoyu): Promise<T> {
    return this.al(sablon, boy, katalogKaydi(sablon, boy, this.b.katalog ?? VARSAYILAN_KATALOG), SABLON_RENGI[sablon]);
  }

  /** Zemin süsü dokusu (aynı önbellek ve tema kuralları; süsün boy eki ve ana rengi yoktur). */
  susDoku(sus: SusKimligi): Promise<T> {
    return this.al(`sus-${sus}`, 1, SUS_KATALOGU[sus], VARLIK_STILI.susAnaRenk);
  }

  private al(ad: string, boy: BinaBoyu, kayit: { dosya: string; tur: "svg-katmanli" | "resim"; dosyaKoyu?: string }, anaRenk: string): Promise<T> {
    const koyu = this.b.koyu();
    const anahtar = `${ad}|${boy}|${this.b.tema()}|${koyu ? "k" : "a"}`;
    const var_ = this.onbellek.get(anahtar);
    if (var_) return var_.p;
    // Tema değişince eski temanın girdileri emekliye ayrılır; kullanım bitince `emekliyiAt` yok eder.
    const onek = anahtar.split("|").slice(2).join("|");
    for (const [k, g] of this.onbellek) {
      if (k.split("|").slice(2).join("|") === onek) continue;
      if (g.v !== undefined) this.emekli.add(g.v);
      this.onbellek.delete(k);
    }
    const yol = VARLIK_STILI.kok + (kayit.tur === "resim" && koyu && kayit.dosyaKoyu ? kayit.dosyaKoyu : kayit.dosya);
    const girdi: { p: Promise<T>; v?: T } = { p: undefined as unknown as Promise<T> };
    girdi.p = (kayit.tur === "resim"
      ? this.b.dokuYap({ url: yol }, VARLIK_STILI.cozunurluk)
      : this.b.getir(yol).then((metin) => this.b.dokuYap({ svg: svgTonla(metin, boy, anaRenk, this.b.renk, VARLIK_STILI.cozunurluk) }, VARLIK_STILI.cozunurluk))
    ).then(
      (v) => {
        // Geç çözülen girdi artık önbellekte değilse (tema değişti ya da yoket çağrıldı) kullanan sprite olamaz: hemen yok et.
        if (this.onbellek.get(anahtar) !== girdi) {
          this.b.dokuYoket?.(v);
          return v;
        }
        girdi.v = v;
        return v;
      },
      (e: unknown) => {
        this.onbellek.delete(anahtar);
        throw e;
      },
    );
    this.onbellek.set(anahtar, girdi);
    return girdi.p;
  }

  /** Emekli dokulardan `kullanimda` kümesinde olmayanları yok eder. */
  emekliyiAt(kullanimda: ReadonlySet<T>): void {
    for (const d of [...this.emekli]) {
      if (kullanimda.has(d)) continue;
      this.emekli.delete(d);
      this.b.dokuYoket?.(d);
    }
  }

  /** Bütün dokuları (önbellek ve emekli) yok eder; çizim sökülürken çağrılır. */
  yoket(): void {
    for (const g of this.onbellek.values()) if (g.v !== undefined) this.emekli.add(g.v);
    this.onbellek.clear();
    this.emekliyiAt(new Set());
  }
}
