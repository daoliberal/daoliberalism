import { SUS_STILI } from "./haritaStili";
import { SUS_KATALOGU, type SusKimligi } from "./susKatalogu";
import type { Meydan, Parsel, Sus } from "./tipler";
import { fnv1a } from "./yerlesim";

export type SusGirdisi = {
  runId: string;
  sehir: number;
  parseller: readonly Parsel[];
  /** İşletmenin oturduğu parsel kimlikleri (süs yalnız boş parsele konur). */
  dolu: ReadonlySet<string>;
  meydan: Meydan;
  /** Ahır ayak izi (merkez ve boyut): çit ön kenara dizilir. */
  ahir: { x: number; y: number; g: number; d: number };
};

/** 0-1 arası kararlı sayı (kimlikten). */
const pay = (anahtar: string): number => (fnv1a(anahtar) % 10000) / 10000;

/**
 * Zemin süsleri (saf). Boş parsellerin bir kısmı ağaç kümesi ya da park alır (kimlik tabanlı: işletme gelip gidince başka parsellerin süsü değişmez),
 * meydanın altına döşeme, ahırın önüne (çizimin altına) çit konur. `x, y` süsün ayak izi merkezidir.
 */
export function susYerlestir(g: SusGirdisi): Sus[] {
  const out: Sus[] = [];
  out.push({ id: "meydan", tur: "meydan-dosemesi", x: g.meydan.x, y: g.meydan.y, taban: boyut("meydan-dosemesi", 2 * g.meydan.yaricap * SUS_STILI.meydanKenar / Math.SQRT2) });
  for (const p of g.parseller) {
    if (g.dolu.has(p.id)) continue;
    const anahtar = `sus|${g.runId}|${g.sehir}|${p.id}`;
    if (pay(anahtar) >= SUS_STILI.bosOran) continue;
    const tur: SusKimligi = pay(`${anahtar}|tur`) < SUS_STILI.parkOrani ? "park" : "agac-kumesi";
    out.push({ id: `sus-${p.id}`, tur, x: p.x, y: p.y, taban: { ...SUS_KATALOGU[tur].taban } });
  }
  const cit = SUS_KATALOGU.cit.taban;
  const adet = Math.max(1, Math.ceil(g.ahir.g / cit.g));
  const y = g.ahir.y + g.ahir.d / 2 + SUS_STILI.citBosluk;
  for (let i = 0; i < adet; i++) out.push({ id: `cit-${i}`, tur: "cit", x: g.ahir.x + (i - (adet - 1) / 2) * cit.g, y, taban: { ...cit } });
  return out;
}

/** Meydan döşemesi kareye yakın: kenar `genislik`, derinlik aynı. */
const boyut = (tur: SusKimligi, genislik: number): { g: number; d: number } => ({ g: Math.round(genislik), d: Math.round(genislik * (SUS_KATALOGU[tur].taban.d / SUS_KATALOGU[tur].taban.g)) });
