/**
 * Makro göstergeler seçicileri (M10): `WeekPacket.makro` üzerinde saf, yan etkisiz okumalar.
 * Seriler haftaya hizalıdır: `values[i]` = hafta `i + 1`; paketi olmayan ya da değeri ölçülmeyen hafta `null` (0 değil).
 */
import type { MakroBlogu, WeekPacket, World } from "./types";

export type SeriNokta = number | null;

/** Seçilen alan: bloktan bir sayı ya da `null` (ölçülmüyor). */
export type MakroAlan = (m: MakroBlogu) => number | null;

function uzunluk(weeks: WeekPacket[]): number {
  let m = 0;
  for (const w of weeks) if (w.week > m) m = w.week;
  return m;
}

/** Her haftaya `f(makro)` uygular; paketi ya da makro bloğu olmayan hafta `null`. */
export function makroSeri(weeks: WeekPacket[], f: MakroAlan): SeriNokta[] {
  const out: SeriNokta[] = new Array<SeriNokta>(uzunluk(weeks)).fill(null);
  for (const w of weeks) {
    if (w.week < 1 || w.makro === undefined) continue;
    const v = f(w.makro);
    out[w.week - 1] = v !== null && Number.isFinite(v) ? v : null;
  }
  return out;
}

/** İlk ölçülen hafta = 100 olacak biçimde yeniden tabanlama (ölçülmeyen hafta `null`; ilk ölçüm 0 ya da yoksa tüm seri `null`). */
export function ilkHafta100(values: SeriNokta[]): SeriNokta[] {
  const ilk = values.find((v): v is number => v !== null && v > 0);
  return values.map((v) => (v === null || ilk === undefined ? null : (v / ilk) * 100));
}

/** Endeks serisi: sunucunun endeksi (ilk hafta = 1) ilk ölçülen hafta = 100 olacak biçimde. */
export function endeksSerisi(weeks: WeekPacket[], f: MakroAlan): SeriNokta[] {
  return ilkHafta100(makroSeri(weeks, f));
}

/** Bir haftanın değeri (paket ya da makro bloğu yoksa `null`). */
export function makroDeger(p: WeekPacket | null, f: MakroAlan): number | null {
  if (p?.makro === undefined) return null;
  const v = f(p.makro);
  return v !== null && Number.isFinite(v) ? v : null;
}

/** Geniş işsizlik oranı: dünyanın toplam işsizliği (iş arayan oyuncu + havuz işsizleri) / iş gücü; sunucu göndermiyorsa `null`. */
export function issizlikOrani(p: WeekPacket | null): number | null {
  const w: World | undefined = p?.world;
  const v = w?.unemployment_rate_all;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Oyuncu işsizliği: yalnız iş arayan oyuncu / oyuncu (faiz kuralının gördüğü ölçü); sunucu göndermiyorsa `null`. */
export function oyuncuIssizlikOrani(p: WeekPacket | null): number | null {
  const v = p?.world?.unemployment_rate;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** İstihdam oranı = çalışan / (çalışan + iş arayan) = 1 - işsizlik (iş gücü aynı); işsizlik ölçülmüyorsa `null`. */
export function istihdamOrani(p: WeekPacket | null): number | null {
  const u = issizlikOrani(p);
  return u === null ? null : 1 - u;
}

/** Gerçek faiz: bloktaki değer; sunucu göndermediyse ama politika faizi ve enflasyon varsa farkı. */
export const gercekFaiz: MakroAlan = (m) => m.faiz.gercek ?? (m.faiz.politika !== null && m.fiyat.enf !== null ? m.faiz.politika - m.fiyat.enf : null);

/** Gerçek ücret endeksi yüzü: sunucu endeksi ilk hafta = 1; kartta 100 ile çarpılmış gösterilir. */
export const gercekUcret100: MakroAlan = (m) => (m.fiyat.gercek_ucret === null ? null : m.fiyat.gercek_ucret * 100);

/** Makro bloğu olan en az bir hafta var mı (eski sunucu / kayıtta sekme "bu veri yok" der). */
export function makroVar(weeks: WeekPacket[]): boolean {
  return weeks.some((p) => p.makro !== undefined);
}
