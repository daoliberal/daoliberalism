import { cityDisplayName } from "../lib/names";
import type { WeekPacket } from "../sim/types";
import { boyOf } from "./haritaStili";
import { sektorBilinir, sektorGrubu } from "./sektorGrubu";
import { DUNYA, type Bina, type BenVurgusu, type Bolge, type HaritaBaglami, type HaritaModeli, type HaritaVerisi } from "./tipler";
import { AHIR, YARICAP, dunyaYerlesimi, isletmeAlani, seritAlani, sehirBinasiKonumu, yerlestir } from "./yerlesim";

const boyutOf = boyOf;

/** Haritadaki işsiz: iş arayan oyuncular + havuzdaki işsiz NPC'ler (modelde havuz işgücündeki işsizdir). */
export const issizOf = (c: { unemployed: number; npc_pool?: number | null } | undefined): number => (c?.unemployed ?? 0) + (c?.npc_pool ?? 0);

const sehirBinaId = (sehir: number): string => `sehir-${sehir}`;

/**
 * Paket + bina anlık görüntüsünden harita modeli. Saf: girdiyi değiştirmez; aynı girdi aynı çıktıyı verir.
 * Ekran metni üretmez: `etiket` bina kimliği/türüdür (`tur`, lonca `ref`, `ahir`), yerelleştirmeyi çizim katmanı `tr.ts` ile yapar;
 * şehir adı yoksa ya da boşsa `Bolge.ad` "Şehir N"dir (öbür ekranlarla aynı yedek). `harita` yoksa (kayıt kaynağı ya da ilk anlık görüntüden önce) işletme binası olmaz; şehir, lonca ve ahır yine çizilir.
 */
export function haritaModeli(paket: WeekPacket, harita: HaritaVerisi | null, ctx: HaritaBaglami): HaritaModeli {
  const satirlar = paket.cities ?? [];
  const sehirler = satirlar.length > 0 ? satirlar.map((c) => c.index) : ctx.sehirAdlari.map((_, i) => i);
  const yerlesim = dunyaYerlesimi(sehirler.length);

  const bolgeler: Bolge[] = sehirler.map((sehir, i) => {
    const d = yerlesim.bolgeler[i];
    const satir = satirlar.find((c) => c.index === sehir);
    return { sehir, ad: cityDisplayName(ctx.sehirAdlari[sehir] ?? "", sehir), x: d.x, y: d.y, genislik: d.genislik, yukseklik: d.yukseklik, calisan: satir?.employed ?? 0, issiz: issizOf(satir) };
  });

  const binalar: Bina[] = [];
  for (const b of bolgeler) {
    const k = sehirBinasiKonumu(b);
    binalar.push({ id: sehirBinaId(b.sehir), tur: "sehir", sehir: b.sehir, x: k.x, y: k.y, boyut: 4, ref: { kind: "city", ref: String(b.sehir) }, etiket: b.ad });
  }

  const loncalar = paket.holdings?.loncas ?? [];
  const loncaKonum = yerlestir(loncalar.map((l) => ({ id: l.ref, yaricap: YARICAP[boyutOf(l.members)] })), seritAlani(yerlesim.lonca), ctx.runId);
  for (const l of loncalar) {
    const k = loncaKonum.get(l.ref)!;
    binalar.push({ id: l.ref, tur: "lonca", sehir: null, x: k.x, y: k.y, boyut: boyutOf(l.members), ref: { kind: "lonca", ref: l.ref }, etiket: l.ref });
  }

  const firmalar = harita?.firmalar ?? [];
  const isletmeler: Bina[] = [];
  sehirler.forEach((sehir, i) => {
    const bu = firmalar.filter((f) => f[2] === sehir);
    const konum = yerlestir(bu.map((f) => ({ id: f[0], yaricap: YARICAP[boyutOf(f[3])] })), isletmeAlani(yerlesim.bolgeler[i]), ctx.runId);
    for (const [id, tur, , calisan, , sahip, , durum] of bu) {
      const k = konum.get(id)!;
      isletmeler.push({
        id, tur: "isletme", ...(sektorBilinir(tur) ? { grup: sektorGrubu(tur) } : {}), sehir, x: k.x, y: k.y, boyut: boyutOf(calisan),
        ref: { kind: "firm", ref: id }, etiket: tur, sahip, durum,
      });
    }
  });
  binalar.push(...isletmeler);

  binalar.push({ id: "ahir", tur: "ahir", sehir: null, x: AHIR.x + AHIR.genislik / 2, y: AHIR.y + AHIR.yukseklik / 2, boyut: 4, ref: { kind: "sector", ref: "ahir" }, etiket: "ahir" });

  const sehirBinasi = (sehir: number): BenVurgusu | null => (bolgeler.some((b) => b.sehir === sehir) ? { binaId: sehirBinaId(sehir), neden: "sehir" } : null);
  let ben: BenVurgusu | null = null;
  const b = ctx.ben;
  if (b) {
    const firma = b.firma !== null && isletmeler.some((x) => x.id === b.firma) ? b.firma : null;
    if (b.durum === "ahir") ben = { binaId: "ahir", neden: "ahir" };
    else if (b.durum === "calisiyor" && firma) ben = { binaId: firma, neden: "isyeri" };
    else if (b.durum === "sahip" && firma) ben = { binaId: firma, neden: "isletme" };
    else ben = sehirBinasi(b.sehir);
  }

  const calisan = satirlar.length > 0 ? satirlar.reduce((t, c) => t + c.employed, 0) : (paket.world.employed ?? 0);
  const issiz = satirlar.length > 0 ? satirlar.reduce((t, c) => t + issizOf(c), 0) : (paket.world.unemployed ?? 0) + (paket.world.npc_pool ?? 0);
  return {
    hafta: paket.week,
    firmaHafta: harita ? harita.hafta : null,
    genislik: DUNYA.genislik,
    yukseklik: DUNYA.yukseklik,
    bolgeler,
    binalar,
    ben,
    ozet: { sehir: bolgeler.length, isletme: isletmeler.filter((x) => x.durum !== "kapali").length, lonca: loncalar.length, calisan, issiz, ahirda: paket.world.players_in_ahir ?? 0 },
  };
}
