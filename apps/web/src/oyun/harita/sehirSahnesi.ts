import { cityDisplayName } from "../lib/names";
import type { ChainNode, WeekPacket } from "../sim/types";
import { katalogKaydi, sablonOf, VARSAYILAN_KATALOG, type BinaKatalogu } from "./binaKatalogu";
import { issizOf } from "./haritaModeli";
import { boyOf, KATMAN_STILI, SEHIR_STILI } from "./haritaStili";
import { sektorBilinir, sektorGrubu } from "./sektorGrubu";
import { dominoYuvalari, halkaYuvalari, izgaraSec, izoIzgaraSec, izoMeydanYaricapi, meydanDeligi, sokakAgi, yuvaAta, type SokakAgi } from "./sokakAgi";
import { susYerlestir } from "./susYerlesimi";
import { KADEME_ANAHTARI, KADEME_TAVAN, LONCA_ONEKI, MEYDAN_ANAHTARI, tabloKademesi, tabloMeydani, yerlesimIlerlet, type YerlesimTablosu } from "./yerlesimTablosu";
import type { BenVurgusu, HaritaBaglami, HaritaVerisi, Katman, KatmanVerisi, LejantSatiri, SahneBina, SehirSahnesi, TonAdi } from "./tipler";

export type SehirSahnesiBaglami = HaritaBaglami & {
  /** Gösterilen şehrin dizini. */
  sehir: number;
  katman: Katman;
  /** Fiyat katmanı için 4 hafta önceki paket; yoksa fiyat katmanı "yok" olur. */
  oncekiPaket?: WeekPacket | null;
  katalog?: BinaKatalogu;
  /** Boş parseller seçilebilir (DAO: "İşletme kur" hedefi). */
  parselSecilebilir?: boolean;
  /** İş ararken ilan veren işletme kimlikleri (DAO): bu binalar haritada parlar. */
  ilanVeren?: ReadonlySet<string>;
  /**
   * İzometrik görünüm: yuva = domino (ana parsel + r+1 genişleme parseli), meydan yarıçapı lonca sayısına göre (`izoMeydanYaricapi`), ızgara hem
   * domino hem plaza hücresine yetecek kadar büyür. Verilmezse çıktı klasik sahneyle bayt bayt aynıdır.
   */
  izo?: true;
  /**
   * Kalıcı yerleşim (K9): verilirse (null = ilk açılış, `yuvaAta` ile tohumlanır) işletmeler önceki tabloya göre yerleşir (mevcut atamalar korunur) ve
   * ilerlemiş tablo `sahne.yerlesim` olarak döner. Verilmezse eski deterministik `yuvaAta` (çıktı bayt bayt aynı).
   */
  yerlesim?: YerlesimTablosu | null;
  /** Oyuncunun işletmesi -> seçtiği parsel (izo: domino ankrajı), K8. Yalnız `yerlesim` ile birlikte etkindir. */
  sabitlemeler?: ReadonlyMap<string, string>;
};

/** Eşik karşılaştırmasında kayan nokta gürültüsünü (ör. 105/100 - 1) yok eden yuvarlama çarpanı. */
const ORAN_HASSASIYET = 1e9;
const SEHIR_ID = (s: number): string => `sehir-${s}`;
const dugum = (paket: WeekPacket | null | undefined, sektor: string, sehir: number): ChainNode | undefined =>
  paket?.chain?.nodes?.find((n) => n.sector === sektor && n.city === sehir);

const talepTonu = (n: ChainNode | undefined): TonAdi | null => {
  if (!n || n.shortage === null || n.shortage === undefined) return null;
  const karsilama = 1 - Math.min(1, Math.max(0, n.shortage));
  return karsilama >= KATMAN_STILI.talep.iyi ? "iyi" : karsilama >= KATMAN_STILI.talep.orta ? "orta" : "dar";
};

const fiyatTonu = (simdi: ChainNode | undefined, once: ChainNode | undefined): TonAdi | null => {
  if (!simdi || !once || simdi.price === null || once.price === null || !(once.price > 0)) return null;
  const d = Math.round((simdi.price / once.price - 1) * ORAN_HASSASIYET) / ORAN_HASSASIYET;
  return d <= KATMAN_STILI.fiyat.dusen ? "dusen" : d >= KATMAN_STILI.fiyat.artan ? "artan" : "yatay";
};

const LEJANT: Record<"talep" | "fiyat", { ton: TonAdi; alt: number | null; ust: number | null }[]> = {
  talep: [
    { ton: "iyi", alt: KATMAN_STILI.talep.iyi, ust: null },
    { ton: "orta", alt: KATMAN_STILI.talep.orta, ust: KATMAN_STILI.talep.iyi },
    { ton: "dar", alt: null, ust: KATMAN_STILI.talep.orta },
  ],
  fiyat: [
    { ton: "dusen", alt: null, ust: KATMAN_STILI.fiyat.dusen },
    { ton: "yatay", alt: KATMAN_STILI.fiyat.dusen, ust: KATMAN_STILI.fiyat.artan },
    { ton: "artan", alt: KATMAN_STILI.fiyat.artan, ust: null },
  ],
};

/**
 * Tek şehir sahnesi (saf). `paket` null olabilir (DAO'da ilk hafta yayımlanmadan: loncasız, katmansız). Sokaklar, parseller, binalar ve katman verisi; çizim yok.
 * Parsel ataması işletme kimliğinden ve (koşu, şehir) tohumundan türer: işletme gelip gidince ötekiler kaymaz;
 * parsel yetmezse ızgara büyür. Belediye ve ahır sabit yerlerdedir (parsel almaz); loncalar meydanın halkalarındadır.
 * `harita` null ise (kayıt kaynağı ya da ilk anlık görüntüden önce) işletme yoktur, `veriYok` true olur.
 */
export function sehirSahnesi(paket: WeekPacket | null, harita: HaritaVerisi | null, ctx: SehirSahnesiBaglami): SehirSahnesi {
  const katalog = ctx.katalog ?? VARSAYILAN_KATALOG;
  const sehir = ctx.sehir;
  // Ahır ve belediye satırları işletme değildir: özel binaları (ahir, sehirBinasi) zaten çizilir; işletme listesine girerse çift bina olur.
  const firmalar = (harita?.firmalar ?? []).filter((f) => f[2] === sehir && f[1] !== "ahir" && f[1] !== "belediye");
  const loncalar = [...(paket?.holdings?.loncas ?? [])];

  const izo = ctx.izo === true;
  const halka = halkaYuvalari(loncalar.length);
  const gereken = Math.ceil(firmalar.length * SEHIR_STILI.bosluk);
  const kalici = ctx.yerlesim !== undefined;
  const ag = kalici
    ? kaliciIzgara(izo, gereken, loncalar.length, halka, ctx.yerlesim ?? null, firmalar.map((f) => f[0]))
    : izo ? izoIzgaraSec(gereken, loncalar.length, izoMeydanYaricapi(loncalar.length)) : izgaraSec(gereken, halka.yaricap);
  const domino = izo ? dominoYuvalari(ag) : [];
  const dominoNo = new Map(domino.map((d) => [d.ankraj, d]));

  const bina = (b: Omit<SahneBina, "taban">): SahneBina => ({ ...b, taban: katalogKaydi(b.sablon, b.boyut, katalog).taban });
  const ad = cityDisplayName(ctx.sehirAdlari[sehir] ?? "", sehir);

  const sehirBinasi = bina({
    id: SEHIR_ID(sehir), tur: "sehir", sehir, x: ag.sehirBinasi.x, y: ag.sehirBinasi.y, boyut: 4, ref: { kind: "city", ref: String(sehir) }, etiket: ad, parsel: null, sablon: "sehir",
  });
  const ahir = bina({ id: "ahir", tur: "ahir", sehir: null, x: ag.ahir.x, y: ag.ahir.y, boyut: 4, ref: { kind: "sector", ref: "ahir" }, etiket: "ahir", parsel: null, sablon: "ahir" });

  const binalar: SahneBina[] = [];
  const halkaYuva = kalici && !izo ? halka.yuvalar.filter((h) => halkaSigar(h, ag.meydan.yaricap)) : halka.yuvalar;
  const deligeSigan = kalici ? (izo ? meydanDeligi(ag).length : halkaYuva.length) : loncalar.length;
  // Kalıcı yerleşim: önceki turlarda deliğe sığmayıp parsele konan loncalar yerinde kalır (K9 dışı ama düzensizliği azaltır); yenisi sığmazsa aşağıda parsele konur.
  const onceki = ctx.yerlesim ?? null;
  const loncaParsel = new Map<string, string>();
  const parselKimlik = new Map(ag.parseller.map((p) => [p.id, p]));
  const yuvaGecerli = (id: string): boolean => (izo ? dominoNo.has(id) : parselKimlik.has(id));
  const firmaYuvalari = new Set(firmalar.flatMap((f) => { const y = onceki?.get(f[0]); return y === undefined ? [] : [y]; }));
  if (kalici) {
    for (const l of loncalar) {
      const y = onceki?.get(LONCA_ONEKI + l.ref);
      if (y !== undefined && yuvaGecerli(y) && !firmaYuvalari.has(y)) loncaParsel.set(l.ref, y);
    }
  }
  const halkaLoncalari = loncalar.filter((l) => !loncaParsel.has(l.ref)).map((l) => l.ref).sort();
  const icerdeki = new Set(halkaLoncalari.slice(0, deligeSigan));
  const tasanLoncalar = halkaLoncalari.slice(deligeSigan);
  const yuvaNo = yuvaAta([...icerdeki], halkaYuva, `meydan|${ctx.runId}`);
  const loncaBinasi = (l: (typeof loncalar)[number]): SahneBina => {
    const boyut = boyOf(l.members);
    const ref = { kind: "lonca" as const, ref: l.ref };
    const rezerv = loncaParsel.get(l.ref);
    if (rezerv !== undefined) {
      const p = parselKimlik.get(rezerv)!;
      return bina({ id: l.ref, tur: "lonca", sehir: null, x: p.x, y: p.y, boyut, ref, etiket: l.ref, parsel: p.id, sablon: "lonca" });
    }
    const y = halka.yuvalar.find((h) => h.id === yuvaNo.get(l.ref))!;
    return bina({ id: l.ref, tur: "lonca", sehir: null, x: ag.meydan.x + y.dx, y: ag.meydan.y + y.dy, boyut, ref, etiket: l.ref, parsel: null, sablon: "lonca" });
  };

  const rezervliYuva = new Set(loncaParsel.values());
  const yuvalar = (izo ? domino.map((d) => ({ id: d.ankraj, oncelik: d.kademe })) : ag.parseller.map((p) => ({ id: p.id, oncelik: p.kademe }))).filter((y) => !rezervliYuva.has(y.id));
  const parselTohum = `parsel|${ctx.runId}|${sehir}`;
  const parselNo = ctx.yerlesim !== undefined
    ? yerlesimIlerlet(ctx.yerlesim, firmalar.map((f) => ({ id: f[0], kapali: f[7] === "kapali" })), yuvalar, parselTohum, ctx.sabitlemeler)
    : yuvaAta(firmalar.map((f) => f[0]), yuvalar, parselTohum);
  // Deliğe sığmayan yeni loncalar: firma yuvaları atandıktan sonra meydana en yakın boş yuvaya konur ve kalıcı rezerve edilir.
  const kullanilan = new Set([...parselNo.entries()].filter(([k]) => !k.startsWith("#")).map(([, v]) => v));
  for (const ref of tasanLoncalar) {
    let en: { id: string; uz: number } | null = null;
    for (const y of yuvalar) {
      if (kullanilan.has(y.id)) continue;
      const p = parselKimlik.get(y.id)!;
      const uz = Math.hypot(p.x - ag.meydan.x, p.y - ag.meydan.y);
      if (en === null || uz < en.uz || (uz === en.uz && y.id < en.id)) en = { id: y.id, uz };
    }
    if (en === null) throw new Error("sehirSahnesi:lonca-yuvasi-yok");
    loncaParsel.set(ref, en.id);
    kullanilan.add(en.id);
  }
  for (const l of loncalar) binalar.push(loncaBinasi(l));
  const isletmeler: SahneBina[] = [];
  for (const [id, tur, , calisan, , sahip, , durum] of firmalar) {
    const parsel = parselKimlik.get(parselNo.get(id)!)!;
    const grup = sektorBilinir(tur) ? sektorGrubu(tur) : undefined;
    isletmeler.push(bina({
      id, tur: "isletme", ...(grup ? { grup } : {}), sehir, x: parsel.x, y: parsel.y, boyut: boyOf(calisan), ref: { kind: "firm", ref: id }, etiket: tur, sahip, parsel: parsel.id, sablon: sablonOf("isletme", grup),
      ...(izo ? { genisleme: dominoNo.get(parsel.id)!.genisleme, durum, calisan } : {}),
    }));
  }
  binalar.push(...isletmeler);

  let ben: BenVurgusu | null = null;
  const b = ctx.ben;
  if (b) {
    const firma = b.firma !== null && isletmeler.some((x) => x.id === b.firma) ? b.firma : null;
    if (b.durum === "ahir") ben = { binaId: "ahir", neden: "ahir" };
    else if (b.sehir !== sehir) ben = null;
    else if (b.durum === "calisiyor" && firma) ben = { binaId: firma, neden: "isyeri" };
    else if (b.durum === "sahip" && firma) ben = { binaId: firma, neden: "isletme" };
    else ben = { binaId: sehirBinasi.id, neden: "sehir" };
  }

  const susler = izo ? [] : susYerlestir({
    runId: ctx.runId, sehir, parseller: ag.parseller, dolu: new Set([...isletmeler.map((x) => x.parsel), ...loncaParsel.values()].filter((x): x is string => x !== null)),
    meydan: ag.meydan, ahir: { x: ahir.x, y: ahir.y, g: ahir.taban.g, d: ahir.taban.d },
  });
  const doluParseller = new Set<string | null>([...isletmeler.map((x) => x.parsel), ...loncaParsel.values()]);
  // İzo: kur hedefi yalnız iki hücresi de boş domino'nun ana parseli (genişleme parselleri ve meydan deliğindeki yarım dominolar hariç).
  const bosParseller = ctx.parselSecilebilir !== true ? [] : izo
    ? ag.parseller.filter((p) => dominoNo.has(p.id) && !doluParseller.has(p.id))
    : ag.parseller.filter((p) => !doluParseller.has(p.id));
  return {
    ...(ctx.yerlesim !== undefined ? { yerlesim: new Map([...parselNo, [KADEME_ANAHTARI, String(ag.kademe)], [MEYDAN_ANAHTARI, String(ag.meydan.yaricap)], ...[...loncaParsel].map(([r, y]) => [LONCA_ONEKI + r, y] as [string, string])]) } : {}),
    ...(izo ? { kademe: ag.kademe } : {}),
    susler, bosParseller, sehir, ad, genislik: ag.genislik, yukseklik: ag.yukseklik, sokaklar: ag.sokaklar, parseller: ag.parseller, binalar, meydan: ag.meydan, sehirBinasi, ahir, ben,
    katman: katmanVerisi(paket, ctx, isletmeler), veriYok: harita === null,
    ilanVeren: new Set([...isletmeler.filter((x) => ctx.ilanVeren?.has(x.id)).map((x) => x.id), ...(ctx.ilanVeren?.has(`s${sehir}_belediye0`) ? [sehirBinasi.id] : [])]),     // belediye ilan verir: şehir binası parlar
  };
}

function katmanVerisi(paket: WeekPacket | null, ctx: SehirSahnesiBaglami, isletmeler: SahneBina[]): KatmanVerisi {
  const yok: KatmanVerisi = { tur: "yok", tonlar: new Map(), lejant: [], rozetler: [] };
  if (ctx.katman === "yok") return yok;
  if (paket === null) return yok;
  if (ctx.katman === "issizlik") {
    const satirlar = paket.cities ?? [];
    const satir = satirlar.find((c) => c.index === ctx.sehir);
    if (!satir) return yok;
    const toplam = satirlar.reduce((t, c) => t + issizOf(c), 0);
    return {
      tur: "issizlik", tonlar: new Map(), lejant: [],
      rozetler: [{ hedef: "sehir", binaId: SEHIR_ID(ctx.sehir), sayi: issizOf(satir) }, { hedef: "meydan", binaId: null, sayi: toplam }],
    };
  }
  const tonlar = new Map<string, TonAdi>();
  for (const b of isletmeler) {
    const simdi = dugum(paket, b.etiket, ctx.sehir);
    const ton = ctx.katman === "talep" ? talepTonu(simdi) : fiyatTonu(simdi, dugum(ctx.oncekiPaket, b.etiket, ctx.sehir));
    if (ton) tonlar.set(b.id, ton);
  }
  // Veri hiç yoksa (zincir yok ya da fiyat için önceki hafta yok) katman "yok" döner.
  const veriVar = ctx.katman === "talep" ? (paket.chain?.nodes?.length ?? 0) > 0 : (paket.chain?.nodes?.length ?? 0) > 0 && (ctx.oncekiPaket?.chain?.nodes?.length ?? 0) > 0;
  if (!veriVar || tonlar.size === 0) return yok;
  const sayac = new Map<TonAdi, number>();
  for (const t of tonlar.values()) sayac.set(t, (sayac.get(t) ?? 0) + 1);
  const lejant: LejantSatiri[] = LEJANT[ctx.katman].map((s) => ({ ...s, anahtar: `${ctx.katman}.${s.ton}`, adet: sayac.get(s.ton) ?? 0 }));
  return { tur: ctx.katman, tonlar, lejant, rozetler: [] };
}


/** Halka yuvası meydan dairesinin (taşma payıyla) içinde mi. */
const halkaSigar = (h: { dx: number; dy: number }, yaricap: number): boolean => Math.hypot(h.dx, h.dy) + SEHIR_STILI.meydan.tasma <= yaricap + 0.1;

/**
 * Kalıcı yerleşimde ızgara: kademe ve meydan yarıçapı tabloya göre asla küçülmez; yarıçap büyüyecekse de atanmış firma yuvasını (izo: domino çifti) yutmayacak
 * en büyük değerde durur (loncalar K9 dışıdır; sığmayanlar parsele konur). Tablo yoksa çıktı klasik/izo seçimiyle aynıdır.
 */
function kaliciIzgara(izo: boolean, gereken: number, loncaSayisi: number, halka: ReturnType<typeof halkaYuvalari>, onceki: YerlesimTablosu | null, firmaIdler: readonly string[]): SokakAgi {
  const istenen = izo ? izoMeydanYaricapi(loncaSayisi) : halka.yaricap;
  const eski = tabloMeydani(onceki);
  const kMin = tabloKademesi(onceki);
  const hedef = Math.max(istenen, eski);
  const atanan = new Set<string>();
  for (const id of firmaIdler) {
    const y = onceki?.get(id);
    if (y === undefined) continue;
    atanan.add(y);
    const m = /^p(-?\d+)_(-?\d+)$/.exec(y);
    if (izo && m) atanan.add(`p${Number(m[1]) + 1}_${m[2]}`);
  }
  const uygun = (r: number): boolean => {
    const var_ = new Set(sokakAgi(kMin, r).parseller.map((p) => p.id));
    for (const a of atanan) if (!var_.has(a)) return false;
    return true;
  };
  let r = hedef;
  if (atanan.size > 0 && !uygun(hedef)) {
    let lo = uygun(eski) ? eski : 0;
    let hi = hedef;
    while (hi - lo > 1) {
      const orta = Math.floor((lo + hi) / 2);
      if (uygun(orta)) lo = orta;
      else hi = orta;
    }
    r = lo;
  }
  for (let k = kMin; k <= KADEME_TAVAN; k++) {
    const ag = sokakAgi(k, r);
    const yuva = izo ? dominoYuvalari(ag).length : ag.parseller.length;
    const delik = izo ? meydanDeligi(ag).length : halka.yuvalar.filter((h) => halkaSigar(h, r)).length;
    if (yuva >= gereken + Math.max(0, loncaSayisi - delik)) return ag;
  }
  return sokakAgi(KADEME_TAVAN, r);
}
