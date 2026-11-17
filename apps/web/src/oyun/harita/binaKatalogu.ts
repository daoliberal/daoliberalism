import type { BinaBoyu, BinaTuru, Sablon, SektorGrubu } from "./tipler";

/**
 * Bina varlık kataloğu: şablon x boy -> çizim dosyası ve zemin ölçüsü. Resimle değiştirmek = dosyayı
 * `public/oyun-harita/` altına koymak + ilgili satırı değiştirmek; kod değişmez (T3 çizer, burası yalnız kayıt).
 * `dosya`/`dosyaKoyu`: `public/oyun-harita/` altındaki göreli yol (koyu tema için isteğe bağlı ikinci dosya).
 * `capa`: çizimin zemine oturduğu nokta, çizim genişliği/yüksekliğinin oranı (0-1; x ortası 0.5, y tabanı ~0.9).
 * `taban`: zemin ayak izi (sahne birimi); parsele sığmak ve çakışmamak için yerleşim yalnız bunu kullanır.
 */
export type KatalogKaydi = {
  dosya: string;
  tur: "svg-katmanli" | "resim";
  capa: { x: number; y: number };
  taban: { g: number; d: number };
  dosyaKoyu?: string;
};
export type BinaKatalogu = Record<Sablon, Record<BinaBoyu, KatalogKaydi>>;

export const SABLONLAR: readonly Sablon[] = ["hammadde", "imalat", "hizmet", "lojistik", "lonca", "sehir", "ahir"];
export const BOYLAR: readonly BinaBoyu[] = [1, 2, 3, 4];

/*
 * SAHİBE NOT: resim koymak için ilgili satırda `dosya` ve `tur` değerini değiştir (tur: "resim"); başka yere dokunma.
 * Her satır bir şablon x boy: dosya, tur, capa (resmin zemine bastığı nokta), taban (zemin ayak izi). Kılavuz: GORSEL-DEGISTIRME.md.
 * İşletme tabanları 64x56 parsele sığar, lonca meydan halkasına sığar; tabanı değiştirirsen yerleşim de değişir.
 */
export const VARSAYILAN_KATALOG: BinaKatalogu = {
  hammadde: {
    1: { dosya: "sablonlar/hammadde-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 30, d: 26 } },
    2: { dosya: "sablonlar/hammadde-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 38, d: 32 } },
    3: { dosya: "sablonlar/hammadde-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 46, d: 38 } },
    4: { dosya: "sablonlar/hammadde-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 56, d: 46 } },
  },
  imalat: {
    1: { dosya: "sablonlar/imalat-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 32, d: 26 } },
    2: { dosya: "sablonlar/imalat-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 40, d: 32 } },
    3: { dosya: "sablonlar/imalat-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 50, d: 38 } },
    4: { dosya: "sablonlar/imalat-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 58, d: 46 } },
  },
  hizmet: {
    1: { dosya: "sablonlar/hizmet-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 28, d: 24 } },
    2: { dosya: "sablonlar/hizmet-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 36, d: 30 } },
    3: { dosya: "sablonlar/hizmet-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 44, d: 36 } },
    4: { dosya: "sablonlar/hizmet-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 54, d: 44 } },
  },
  lojistik: {
    1: { dosya: "sablonlar/lojistik-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 34, d: 24 } },
    2: { dosya: "sablonlar/lojistik-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 42, d: 30 } },
    3: { dosya: "sablonlar/lojistik-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 52, d: 36 } },
    4: { dosya: "sablonlar/lojistik-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 60, d: 44 } },
  },
  lonca: {
    1: { dosya: "sablonlar/lonca-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 18, d: 16 } },
    2: { dosya: "sablonlar/lonca-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 22, d: 18 } },
    3: { dosya: "sablonlar/lonca-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 26, d: 20 } },
    4: { dosya: "sablonlar/lonca-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 30, d: 24 } },
  },
  sehir: {
    1: { dosya: "sablonlar/sehir-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 60, d: 40 } },
    2: { dosya: "sablonlar/sehir-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 68, d: 44 } },
    3: { dosya: "sablonlar/sehir-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 76, d: 48 } },
    4: { dosya: "sablonlar/sehir-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 84, d: 52 } },
  },
  ahir: {
    1: { dosya: "sablonlar/ahir-1.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 70, d: 30 } },
    2: { dosya: "sablonlar/ahir-2.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 80, d: 34 } },
    3: { dosya: "sablonlar/ahir-3.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 90, d: 38 } },
    4: { dosya: "sablonlar/ahir-4.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.9 }, taban: { g: 100, d: 42 } },
  },
};

export const katalogKaydi = (sablon: Sablon, boy: BinaBoyu, katalog: BinaKatalogu = VARSAYILAN_KATALOG): KatalogKaydi => katalog[sablon][boy];

/** Bina türü + sektör grubundan şablon adı (bilinmeyen sektör: hizmet, `binaStili` ile aynı yedek). */
export function sablonOf(tur: BinaTuru, grup: SektorGrubu | undefined): Sablon {
  return tur === "isletme" ? (grup ?? "hizmet") : tur === "liman" || tur === "ihracat" ? "sehir" : tur;      // kurumlar klasik katalogda yok (yalnız izo sahnede çizilir)
}
