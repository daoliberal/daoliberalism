/**
 * Ekonomi paneli seçicileri (M10): `WeekPacket.ekonomi` ve `harita` üzerinde saf, yan etkisiz okumalar.
 * Seriler haftaya hizalıdır: `values[i]` = hafta `i + 1`; paketi olmayan ya da değeri ölçülmeyen hafta `null` (0 değil).
 * Birimler: hane `n` kişi-DÖNGÜdür (haftada `CYCLES_PER_WEEK` döngü); oyuncuya kişi gösterilecekse `kisiHafta` ile kişi-haftaya çevrilir.
 * `npc_issiz_parasiz` zaten kişi-haftadır, çevrilmez.
 */
import type { HaritaFirmaSatiri, HaritaVerisi } from "@/oyun/harita/tipler";
import type { EkonomiBlogu, EksikUrun, HaneTuketim, Hareket, NpcHaneTuketim, UcretSatiri, WeekPacket } from "./types";

export type SeriNokta = number | null;

/** Modelde bir haftadaki döngü (gün) sayısı: hane `n` kişi-döngü olarak gelir. */
export const CYCLES_PER_WEEK = 7;

/** Kişi-döngüyü kişi-haftaya çevirir (`null` korunur). */
export function kisiHafta(kisiDongu: number | null): number | null {
  return kisiDongu === null ? null : kisiDongu / CYCLES_PER_WEEK;
}

/** Hafta numarasına göre en son paket serisi uzunluğu: paketlerdeki en büyük hafta. */
function uzunluk(weeks: WeekPacket[]): number {
  let m = 0;
  for (const w of weeks) if (w.week > m) m = w.week;
  return m;
}

/** Her haftaya `f(paket)` uygular; paketi ya da ekonomi bloğu olmayan hafta `null`. */
function seri(weeks: WeekPacket[], f: (e: EkonomiBlogu, p: WeekPacket) => SeriNokta): SeriNokta[] {
  const out: SeriNokta[] = new Array<SeriNokta>(uzunluk(weeks)).fill(null);
  for (const w of weeks) {
    if (w.week < 1 || w.ekonomi === undefined) continue;
    out[w.week - 1] = f(w.ekonomi, w);
  }
  return out;
}

export type HaneKaynagi = "oyuncu" | "npc" | "birlesik";

/** n ağırlıklı birleşik hane: `n` ya da `alan` ölçülmeyen gruplar dışarıda kalır; hiçbiri kalmazsa `null`. */
export function birlesikHane(gruplar: readonly HaneTuketim[]): HaneTuketim {
  let n = 0; let kn = 0; let k = 0; let sn = 0; let s = 0;
  for (const g of gruplar) {
    if (g.n === null || g.n <= 0) continue;
    n += g.n;
    if (g.karsilanma !== null) { kn += g.n; k += g.n * g.karsilanma; }
    if (g.sepet !== null) { sn += g.n; s += g.n * g.sepet; }
  }
  return { n: n > 0 ? n : null, karsilanma: kn > 0 ? k / kn : null, sepet: sn > 0 ? s / sn : null };
}

/** Hane tablosu: `sehir === null` dünya, aksi halde o şehrin satırı (satır yoksa `null`). */
function haneTablosu(e: EkonomiBlogu, sehir: number | null): { ise: HaneTuketim; issiz: HaneTuketim; npc: NpcHaneTuketim | null } | null {
  if (sehir === null) return e.tuketim.hane;
  return e.tuketim.hane.sehir.find((s) => s.sehir === sehir) ?? null;
}

/** Bir blokta bir hane grubu: oyuncu (varsayılan), NPC (çalışan / işsiz) ya da ikisinin n ağırlıklı birleşimi; `sehir` verilirse o şehrin haneleri (varsayılan dünya). */
export function haneGrubu(e: EkonomiBlogu, grup: "ise" | "issiz", kaynak: HaneKaynagi = "oyuncu", sehir: number | null = null): HaneTuketim | null {
  const tablo = haneTablosu(e, sehir);
  if (tablo === null) return null;
  const oy = tablo[grup] ?? null;
  const np = tablo.npc?.[grup] ?? null;
  if (kaynak === "oyuncu") return oy;
  if (kaynak === "npc") return np;
  if (oy === null) return np;
  return np === null ? oy : birlesikHane([oy, np]);
}

/** Hane karşılanma / sepet serisi (varsayılan oyuncu haneleri; `kaynak` ile NPC ya da n ağırlıklı birleşik; `sehir` ile şehir, varsayılan dünya). */
export function haneSeri(weeks: WeekPacket[], grup: "ise" | "issiz", alan: "karsilanma" | "sepet", kaynak: HaneKaynagi = "oyuncu", sehir: number | null = null): SeriNokta[] {
  return seri(weeks, (e) => haneGrubu(e, grup, kaynak, sehir)?.[alan] ?? null);
}

/** Harcama (Akçe); `sehir` verilirse o şehrin satırı (şehirde `toplam` = oyuncu + NPC, ikisi de ölçülmüşse). */
export function harcamaSeri(weeks: WeekPacket[], tur: "npc" | "oyuncu" | "toplam", sehir: number | null = null): SeriNokta[] {
  if (sehir === null) return seri(weeks, (e) => e.tuketim.harcama?.[tur] ?? null);
  return seri(weeks, (e) => {
    const h = e.tuketim.hane.sehir.find((s) => s.sehir === sehir)?.harcama ?? null;
    if (h === null) return null;
    if (tur !== "toplam") return h[tur];
    return h.oyuncu === null || h.npc === null ? null : h.oyuncu + h.npc;
  });
}

/** Parası olmadığı için tüketemeyen işsiz yerleşik halk (kişi-HAFTA; zaten haftalık, çevrilmez); `sehir === null` dünya. */
export function parasizIssizSeri(weeks: WeekPacket[], sehir: number | null): SeriNokta[] {
  return seri(weeks, (e) => (sehir === null ? e.tuketim.hane.npc_issiz_parasiz : (e.tuketim.hane.sehir.find((s) => s.sehir === sehir)?.npc_issiz_parasiz ?? null)));
}

/** Özel sektör istihdamı: `sehir === null` dünya, aksi halde o şehir. */
export function ozelIstihdamSeri(weeks: WeekPacket[], sehir: number | null): SeriNokta[] {
  return seri(weeks, (e) => (sehir === null ? e.isletme.istihdam.ozel : (e.isletme.sehir.find((s) => s.sehir === sehir)?.ozel_calisan ?? null)));
}

/** Kurulan / büyüyen / küçülen / batan işletme sayısı; ilk hafta (önceki yok) `null`. */
export function hareketSeri(weeks: WeekPacket[], sehir: number | null, alan: keyof Hareket): SeriNokta[] {
  return seri(weeks, (e) => {
    const h = sehir === null ? e.isletme.hareket : (e.isletme.sehir.find((s) => s.sehir === sehir)?.hareket ?? null);
    return h === null ? null : h[alan];
  });
}

/** Büyüklük kovası (1-4 çalışan, ...) başına işletme sayısı; `sehir === null` dünya = şehirlerin toplamı. Blok ya da şehir yoksa `null`. */
export function boyDagilimi(p: WeekPacket | null, sehir: number | null): [number, number, number, number] | null {
  const e = p?.ekonomi;
  if (e === undefined) return null;
  if (sehir !== null) return e.isletme.sehir.find((s) => s.sehir === sehir)?.boy ?? null;
  if (e.isletme.sehir.length === 0) return null;
  const t: [number, number, number, number] = [0, 0, 0, 0];
  for (const s of e.isletme.sehir) for (let i = 0; i < 4; i++) t[i]! += s.boy[i]!;
  return t;
}

/** Karşılanmayan talebi en çok olan ürünler (yalnız sektör panosundaki ürünler); blok yoksa ya da pano kapalıysa `null`. */
export function eksikUrunler(p: WeekPacket | null): EksikUrun[] | null {
  return p?.ekonomi?.tuketim.urunler ?? null;
}

/** Ürün çekmecesi açılabilir mi: yalnız sektör panosunda olan ürünler (ör. süt, deri, et panoda olmayabilir: açılmaz). */
export function urunAcilabilir(p: WeekPacket | null, urun: string): boolean {
  return eksikUrunler(p)?.some((u) => u.urun === urun) === true;
}

/**
 * Bir işletmenin çalışan sayısı serisi. Tam haritası olan hafta satırı doğrudan okur; yalnız `haritaFark` taşıyan hafta (Kurucu ara haftaları)
 * firmayı tabandaki tam haritadan + farktan çözer (tüm haritayı birleştirmeden). Taban pencerede yoksa, firma yoksa ya da fark sonrası kapanmışsa `null`.
 */
export function firmaSeri(weeks: WeekPacket[], firmaNo: string): SeriNokta[] {
  const out: SeriNokta[] = new Array<SeriNokta>(uzunluk(weeks)).fill(null);
  const taban = new Map<number, HaritaFirmaSatiri | undefined>(); // tam harita haftası -> firmanın satırı
  for (const w of weeks) if (w.harita !== undefined) taban.set(w.harita.hafta, w.harita.firmalar.find((f) => f[0] === firmaNo));
  for (const w of weeks) {
    if (w.week < 1) continue;
    if (w.harita !== undefined) {
      out[w.week - 1] = taban.get(w.harita.hafta)?.[3] ?? null;
      continue;
    }
    const fark = w.haritaFark;
    if (fark === undefined || !taban.has(fark.taban)) continue;
    if (fark.kapanan.includes(firmaNo)) continue;
    const d = fark.degisen.find((x) => x[0] === firmaNo);
    if (d !== undefined) { out[w.week - 1] = d[2]; continue; }
    const y = fark.yeni.find((x) => x[0] === firmaNo);
    out[w.week - 1] = y !== undefined ? y[3] : (taban.get(fark.taban)?.[3] ?? null);
  }
  return out;
}

/** En çok çalışanı olan işletmeler (harita satırlarından; kapalılar hariç); `sehir === null` tüm şehirler. Eşitlikte kimliğe göre. `h`: güncel harita (ara haftada `guncelHarita(weeks)`). */
export function enBuyukFirmalar(h: HaritaVerisi | null, sehir: number | null, n: number): { id: string; tur: string; calisan: number }[] {
  if (h === null) return [];
  return h.firmalar
    .filter((f) => (sehir === null || f[2] === sehir) && f[7] !== "kapali" && f[3] > 0)
    .map((f) => ({ id: f[0], tur: f[1], calisan: f[3] }))
    .sort((a, b) => b.calisan - a.calisan || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, n));
}

/** Oyuncu ve NPC haneleri tek bakışta (n ağırlıklı birleşik dahil); `n` kişi-döngü, `nKisiHafta` kişi-hafta (n / 7). */
export type HaneKirilimi = { oyuncu: HaneTuketim; npc: HaneTuketim | null; birlesik: HaneTuketim; nKisiHaftaBirlesik: number | null };
export function haneKirilimi(p: WeekPacket | null, grup: "ise" | "issiz", sehir: number | null = null): HaneKirilimi | null {
  const e = p?.ekonomi;
  if (e === undefined) return null;
  const oyuncu = haneGrubu(e, grup, "oyuncu", sehir);
  if (oyuncu === null) return null;
  const npc = haneGrubu(e, grup, "npc", sehir);
  const birlesik = npc === null ? birlesikHane([oyuncu]) : birlesikHane([oyuncu, npc]);
  return { oyuncu, npc, birlesik, nKisiHaftaBirlesik: kisiHafta(birlesik.n) };
}

/** Bir haftanın ücret ve fiyat satırı: `sehir === null` dünya, aksi halde o şehir (satır yoksa `null`). */
export function ucretSatiri(p: WeekPacket | null, sehir: number | null): UcretSatiri | null {
  const u = p?.ekonomi?.tuketim.ucret ?? null;
  if (u === null) return null;
  return sehir === null ? u.dunya : (u.sehir[sehir] ?? null);
}

/** Tam sabit sepetin haftalık bedeli = net ücret / oran (sunucu `oran`ı net ücretin tam sepete bölümüdür; ayrıca bayt ayrılmaz). Hesaplanamazsa `null`. */
export function tamSepet(u: UcretSatiri | null): number | null {
  return u !== null && u.net !== null && u.oran !== null && u.oran > 0 ? u.net / u.oran : null;
}

/**
 * Ücret endeksi ya da fiyat endeksi serisi, ilk ölçülen hafta = 100 olacak biçimde yeniden tabanlanmış (iki seri aynı grafikte kıyaslanabilir).
 * Ölçülmeyen hafta `null`; ilk ölçüm 0 ya da yoksa tüm seri `null`.
 */
export function endeksSeri(weeks: WeekPacket[], alan: "ucret" | "fiyat", sehir: number | null): SeriNokta[] {
  const ham = seri(weeks, (_e, p) => ucretSatiri(p, sehir)?.[alan] ?? null);
  const ilk = ham.find((v): v is number => v !== null && v > 0);
  return ham.map((v) => (v === null || ilk === undefined ? null : (v / ilk) * 100));
}

/** Alt kademe net ücretin TAM sabit sepete oranı serisi (kaç katı). */
export function ucretOraniSeri(weeks: WeekPacket[], sehir: number | null): SeriNokta[] {
  return seri(weeks, (_e, p) => ucretSatiri(p, sehir)?.oran ?? null);
}
