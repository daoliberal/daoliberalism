import { ImageSource, Texture } from "pixi.js";
import type { DokuKaynagi } from "./varlikYukleyici";

/**
 * Kaynaktan (svg metni ya da png/webp yolu) doku üretir; svg blob URL'i çözümlendikten sonra bırakılır.
 * NPOT notu: sprite PNG'leri ikinin kuvveti değildir; NPOT dokuda `autoGenerateMipmaps` yalnız WebGL2/WebGPU'da güvenlidir (Pixi 8'de WebGL1 yedeği yok); modern tarayıcıların hepsi WebGL2'dir.
 * `mipmap`: GPU mipmap üretir ve üçlü doğrusal süzme kullanır (ekranda küçültülerek çizilen sprite'lar için; kenar titremesi ve aliasing azalır).
 */
export async function pixiDokuYap(k: DokuKaynagi, cozunurluk: number, mipmap = false): Promise<Texture> {
  const svg = "svg" in k;
  const url = svg ? URL.createObjectURL(new Blob([k.svg], { type: "image/svg+xml" })) : k.url;
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return new Texture({ source: new ImageSource({ resource: img, resolution: svg ? cozunurluk : 1, ...(mipmap ? { autoGenerateMipmaps: true, scaleMode: "linear", mipmapFilter: "linear" } : {}) }) });
  } finally {
    if (svg) URL.revokeObjectURL(url);
  }
}
