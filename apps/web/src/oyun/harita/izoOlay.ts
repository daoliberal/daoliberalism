import { t, type CopyKey } from "@/oyun/copy/t";
import { DAO_UNVANLAR, daoUnvanMetni, type DaoGozlem, type DaoOlay, type DaoUnvan } from "../sim/dao";
import { IZO_STILI } from "./haritaStili";
import type { Gecis } from "./izoDurum";

export type UnvanDegisimi = { eski: DaoUnvan; yeni: DaoUnvan };

/** Hafta geçişi olay balonu: haritada `hedef.binaId` binasının üstünde kısa ömürlü gösterilir (yalnız gösterir, oyuncu adımı yapmaz). `omur` ms. */
export type Balon = {
  id: string;
  hedef: { binaId: string };
  metinAnahtari: CopyKey;
  params: Record<string, string | number>;
  ton: "iyi" | "uyari" | "kotu";
  omur: number;
};

/** İki ardışık gözlemden oyuncunun unvan değişimi (saf; model/olay şeması değişmez). İlk gözlemde ya da aynı unvanda null. */
export function unvanDegisimi(onceki: DaoGozlem | null, simdi: DaoGozlem): UnvanDegisimi | null {
  if (onceki === null) return null;
  const eski = onceki.ben.unvan, yeni = simdi.ben.unvan;
  return eski === yeni ? null : { eski, yeni };
}

const sira = (u: DaoUnvan): number => DAO_UNVANLAR.indexOf(u);

type Aday = { binaId: string; hafta: number; ben: boolean; tur: string; anahtar: CopyKey; params: Record<string, string | number>; ton: Balon["ton"]; sira: number };

const GECIS_BALONU: Partial<Record<Gecis["tur"], { anahtar: CopyKey; ton: Balon["ton"] }>> = {
  kuruldu: { anahtar: "harita.balon.kuruldu", ton: "iyi" },
  batti: { anahtar: "harita.balon.batti", ton: "kotu" },
  canlandi: { anahtar: "harita.balon.canlandi", ton: "iyi" },
};

/**
 * Hafta geçişlerinden, oyuncunun DAO olaylarından ve unvan değişiminden balonlar (saf). Yalnız görünür şehirdeki (`binaVar`) binalara bağlı olaylar;
 * aynı bina için en yeni 1; toplam `enCok`. Oyuncunun kendi olayları (DAO olayı, terfi) önce gelir ve daha uzun yaşar. Terfi balonu `benBinaId`'ye (işyeri/işletme ya da şehir binası) konur.
 * Yalnız son iki haftanın DAO olayları sayılır (kümülatif liste verilebilir). Balon kimliği `bina:tür:hafta`; aynı olay iki kez balon üretmez.
 */
export function balonlar(
  gecisler: readonly Gecis[], daoOlaylari: readonly DaoOlay[], unvan: UnvanDegisimi | null, binaVar: (id: string) => boolean, enCok: number = IZO_STILI.balon.enCok, benBinaId: string | null = null, terfiHafta: number | null = null,
): Balon[] {
  const son = Math.max(-Infinity, ...gecisler.map((g) => g.hafta), ...daoOlaylari.map((o) => o.hafta));
  const adaylar: Aday[] = [];
  let n = 0;
  const ekle = (a: Omit<Aday, "sira">): void => {
    if (binaVar(a.binaId)) adaylar.push({ ...a, sira: n++ });
  };
  if (unvan !== null && benBinaId !== null && sira(unvan.yeni) > sira(unvan.eski) && sira(unvan.eski) >= 0) {
    ekle({ binaId: benBinaId, hafta: terfiHafta ?? (Number.isFinite(son) ? son : 0), ben: true, tur: `terfi_${unvan.yeni}`, anahtar: "harita.balon.terfi", params: { unvan: daoUnvanMetni(unvan.yeni) }, ton: "iyi" });
  }
  const benFirma = new Set<string>();
  for (const o of daoOlaylari) {
    if (o.hafta < son - 1) continue;
    if (o.tur === "kuruldu") { benFirma.add(o.firma); ekle({ binaId: o.firma, hafta: o.hafta, ben: true, tur: "kuruldu", anahtar: "harita.balon.kuruldu", params: {}, ton: "iyi" }); }
    else if (o.tur === "firma_batti") { benFirma.add(o.firma); ekle({ binaId: o.firma, hafta: o.hafta, ben: true, tur: "batti", anahtar: "harita.balon.batti", params: {}, ton: "kotu" }); }
    else if (o.tur === "ise_girdi") ekle({ binaId: o.firma, hafta: o.hafta, ben: true, tur: "ise_girdi", anahtar: "harita.balon.ise_girdi", params: {}, ton: "iyi" });
  }
  for (const g of gecisler) {
    const b = GECIS_BALONU[g.tur];
    if (b) ekle({ binaId: g.id, hafta: g.hafta, ben: benFirma.has(g.id), tur: g.tur, anahtar: b.anahtar, params: {}, ton: b.ton });
  }
  adaylar.sort((a, b) => Number(b.ben) - Number(a.ben) || b.hafta - a.hafta || a.sira - b.sira);
  const secilen = new Map<string, Aday>();
  for (const a of adaylar) if (!secilen.has(a.binaId)) secilen.set(a.binaId, a);
  return [...secilen.values()].slice(0, Math.max(0, enCok)).map((a) => ({
    id: `${a.binaId}:${a.tur}:${a.hafta}`, hedef: { binaId: a.binaId }, metinAnahtari: a.anahtar, params: a.params, ton: a.ton,
    omur: a.ben ? IZO_STILI.balon.benOmurMs : IZO_STILI.balon.omurMs,
  }));
}

/** Balonun ekrandaki metni. */
export const balonMetni = (b: Balon): string => t(b.metinAnahtari, b.params);

export type BalonKutusu = { x: number; y: number; w: number; h: number };
/**
 * Çakışan balonları üst üste bindirmeden dizer (saf): sırayla her kutu, öncekilerle kesişiyorsa `aralik` boşlukla yukarı itilir. Girdi sırası öncelik sırasıdır (ilk kutu yerinde kalır).
 * Kutu (x, y) = sol üst; dönüş: aynı sırada yeni y değerleri.
 */
export function balonlariDiz(kutular: readonly BalonKutusu[], aralik: number = IZO_STILI.balon.aralik): number[] {
  const yerlesen: BalonKutusu[] = [];
  return kutular.map((k) => {
    let y = k.y;
    for (let tur = 0; tur < kutular.length + 1; tur++) {
      const c = yerlesen.find((o) => k.x < o.x + o.w + aralik && o.x < k.x + k.w + aralik && y < o.y + o.h + aralik && o.y < y + k.h + aralik);
      if (!c) break;
      y = c.y - k.h - aralik;
    }
    yerlesen.push({ ...k, y });
    return y;
  });
}
