/**
 * Zemin süsleri kaydı: ağaç kümesi, park, meydan döşemesi, çit. Çizimler `public/oyun-harita/suslar/` altındadır
 * (renk değeri yok, yalnız `data-katman`); resimle değiştirmek = dosyayı koymak + satırı değiştirmek, kod değişmez.
 * `taban`: süsün zeminde kapladığı alan (sahne birimi); `capa`: çizimin hangi noktasının ayak izinin MERKEZİNE konacağı (0-1; binalarda ayak izinin alt kenarıdır). Çizimin genişliği `taban.g` kadardır.
 */
export type SusKimligi = "agac-kumesi" | "park" | "meydan-dosemesi" | "cit";
export type SusKaydi = { dosya: string; tur: "svg-katmanli" | "resim"; capa: { x: number; y: number }; taban: { g: number; d: number }; dosyaKoyu?: string };

export const SUSLER: readonly SusKimligi[] = ["agac-kumesi", "park", "meydan-dosemesi", "cit"];

export const SUS_KATALOGU: Record<SusKimligi, SusKaydi> = {
  "agac-kumesi": { dosya: "suslar/agac-kumesi.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.92 }, taban: { g: 28, d: 20 } },
  park: { dosya: "suslar/park.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.5 }, taban: { g: 56, d: 48 } },
  "meydan-dosemesi": { dosya: "suslar/meydan-dosemesi.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.5 }, taban: { g: 80, d: 80 } },
  cit: { dosya: "suslar/cit.svg", tur: "svg-katmanli", capa: { x: 0.5, y: 0.87 }, taban: { g: 40, d: 4 } },
};
