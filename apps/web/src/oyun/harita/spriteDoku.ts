import type { Texture } from "pixi.js";
import { IZO_STILI } from "./haritaStili";
import { pixiDokuYap } from "./pixiDoku";
import { SPRITE_YOLU, type SpriteKaydi } from "./spriteManifest";

/**
 * İzometrik çizimin dokuyu aldığı kaynak. Klasik `DokuKaynakcisi` (şablon x boy anahtarlı) ile karışmaz: burada anahtar sprite dosyasıdır,
 * aynı dosyayı kullanan bütün binalar tek `Texture` paylaşır. `emekliyiAt` ve `yoket` klasik kaynakla aynı anlamdadır.
 */
export type SpriteDokuKaynakcisi = {
  doku(s: SpriteKaydi): Promise<Texture>;
  /** Kullanımda olmayan emekli dokuları yok eder (verilen küme çizimdeki şimdiki dokulardır). */
  emekliyiAt?(kullanimda: ReadonlySet<Texture>): void;
  /** Bütün dokuları yok eder (çizim sökülürken). */
  yoket?(): void;
};

export type SpriteDokuBagimliliklari<T> = {
  /** `{ url }` kaynağından doku üretir (Pixi tarafı: `pixiDokuYap`). */
  dokuYap(kaynak: { url: string }, cozunurluk: number): Promise<T>;
  /** Dokuyu yok eder (Pixi: `destroy(true)`); verilmezse yalnız önbellekten atılır. */
  dokuYoket?(doku: T): void;
};

/** PNG sprite yükleyici: önbellek anahtarı `dosya`; geç çözülen doku (yoket sonrası) hemen yok edilir. */
export class SpriteDokuYukleyici<T> {
  private readonly onbellek = new Map<string, { p: Promise<T>; v?: T }>();
  /** Önbellekten atılan ama sprite'larda hâlâ görünebilen dokular. */
  private readonly emekli = new Set<T>();
  constructor(private readonly b: SpriteDokuBagimliliklari<T>) {}

  doku(s: SpriteKaydi): Promise<T> {
    const var_ = this.onbellek.get(s.dosya);
    if (var_) return var_.p;
    const girdi: { p: Promise<T>; v?: T } = { p: undefined as unknown as Promise<T> };
    girdi.p = this.b.dokuYap({ url: SPRITE_YOLU + s.dosya }, 1).then(
      (v) => {
        // Geç çözülen girdi artık önbellekte değilse (yoket çağrıldı) kullanan sprite olamaz: hemen yok et.
        if (this.onbellek.get(s.dosya) !== girdi) {
          this.b.dokuYoket?.(v);
          return v;
        }
        girdi.v = v;
        return v;
      },
      (e: unknown) => {
        if (this.onbellek.get(s.dosya) === girdi) this.onbellek.delete(s.dosya);
        throw e;
      },
    );
    this.onbellek.set(s.dosya, girdi);
    return girdi.p;
  }

  /** Bir dosyanın dokusunu önbellekten atıp emekliye ayırır (sonraki istek yeniden yükler); kullanım bitince `emekliyiAt` yok eder. */
  emekliyeAyir(dosya: string): void {
    const g = this.onbellek.get(dosya);
    if (!g) return;
    this.onbellek.delete(dosya);
    if (g.v !== undefined) this.emekli.add(g.v);
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

/**
 * Doku belleği tahmini (bayt): benzersiz dosya başına genişlik x yükseklik x 4; mipmap seviyeleri +1/3. Atlas yoktur (43 tür ~29 sprite'a eşlenir),
 * bu yüzden her dosya ayrı dokudur ve toplam, setin tamamı yüklense bile `IZO_STILI.performans.dokuButcesiMB` altında kalmalıdır.
 */
export function dokuButcesiBayt(kayitlar: readonly Pick<SpriteKaydi, "dosya" | "genislik" | "yukseklik">[], mipmap: boolean): number {
  const goruldu = new Set<string>();
  let toplam = 0;
  for (const k of kayitlar) {
    if (goruldu.has(k.dosya)) continue;
    goruldu.add(k.dosya);
    toplam += k.genislik * k.yukseklik * 4;
  }
  return mipmap ? (toplam * 4) / 3 : toplam;
}

/** Gerçek Pixi kaynakçısı (sprite dokuları `IZO_STILI.performans.mipmap` ile mipmapli). */
export function spriteDokuKaynakcisi(): SpriteDokuKaynakcisi {
  return new SpriteDokuYukleyici<Texture>({ dokuYap: (k, c) => pixiDokuYap(k, c, IZO_STILI.performans.mipmap), dokuYoket: (d) => d.destroy(true) });
}
