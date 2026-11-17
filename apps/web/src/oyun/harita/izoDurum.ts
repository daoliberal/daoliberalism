import type { DaoOlay } from "../sim/dao";
import { IZO_STILI } from "./haritaStili";
import { boyGecisi, type BoyHaritasi } from "./izoBoy";
import type { HaritaFirmaSatiri, HaritaVerisi } from "./tipler";

/** İşletmenin çizimdeki durumu: harita durumuna kuruluş ve canlanma eklenir. */
export type GorselDurum = "uretim" | "zayif" | "issiz" | "kapali" | "kuruluyor" | "canlandi";

/** Doğumdan (ya da NPC'de ilk görülmeden) sonra kaç hafta "kuruluyor" sayılır. */
export const KURULUS_PENCERESI = 4;

/**
 * Bir satırın görsel durumu. `oncekiKapaliydi` yalnız canlanma haftasında true verilmelidir (süre sınırı burada yok). Öncelik: kapalı > canlandı (önceki harita kapalıydı, şimdi değil) > kuruluyor > harita durumu.
 * `kuruluyor`: doğum bilinen (oyuncu/DAO) işletmede `hafta - dogum`; NPC'de doğum null olduğundan baseline'dan sonra ilk görülme haftası (`ilkGorulme`).
 */
export function gorselDurum(satir: HaritaFirmaSatiri, hafta: number, ilkGorulme: number | null, oncekiKapaliydi: boolean): GorselDurum {
  const durum = satir[7];
  if (durum === "kapali") return "kapali";
  if (oncekiKapaliydi) return "canlandi";
  const dogum = satir[6];
  const kurulus = dogum !== null ? dogum : ilkGorulme;
  if (kurulus !== null && hafta - kurulus >= 0 && hafta - kurulus < KURULUS_PENCERESI) return "kuruluyor";
  return durum;
}

export type Gecis = { id: string; hafta: number; tur: "kuruldu" | "batti" | "canlandi" | "zayifladi" | "toparlandi" | "buyudu" | "kuculdu" };

const SAGLAM = new Set(["uretim"]);

/**
 * İki harita arasındaki kimlik farkından anlık geçişler (saf). `onceki` null ise baseline: `kuruldu` üretilmez.
 * Aradaki haftalar atlanmış olabilir (Kurucu, hızlı oynatma): tek farktan üretilir, hafta `simdi.hafta`.
 * DAO olayları (`kuruldu`, `firma_batti`) anlık geçiştir; haritadan zaten üretilen (aynı kimlik ve tür) tekrarlanmaz.
 */
export function gecisler(onceki: HaritaVerisi | null, simdi: HaritaVerisi, boySimdi: BoyHaritasi, daoOlaylari: readonly DaoOlay[] = []): Gecis[] {
  const cikti: Gecis[] = [];
  const gorulen = new Set<string>();
  const ekle = (id: string, tur: Gecis["tur"], hafta: number): void => {
    const k = `${id}:${tur}`;
    if (gorulen.has(k)) return;
    gorulen.add(k);
    cikti.push({ id, hafta, tur });
  };
  if (onceki !== null) {
    const eski = new Map(onceki.firmalar.map((f) => [f[0], f[7]] as const));
    const simdiKimlik = new Set<string>();
    for (const f of simdi.firmalar) {
      const id = f[0];
      simdiKimlik.add(id);
      const e = eski.get(id);
      const d = f[7];
      if (e === undefined) {
        if (d !== "kapali") ekle(id, "kuruldu", simdi.hafta);
        continue;
      }
      if (e !== "kapali" && d === "kapali") ekle(id, "batti", simdi.hafta);
      else if (e === "kapali" && d !== "kapali") ekle(id, "canlandi", simdi.hafta);
      else if (d !== "kapali") {
        if (SAGLAM.has(e) && !SAGLAM.has(d)) ekle(id, "zayifladi", simdi.hafta);
        else if (!SAGLAM.has(e) && SAGLAM.has(d)) ekle(id, "toparlandi", simdi.hafta);
      }
      if (d !== "kapali") {
        const b = boySimdi.get(id);
        const g = b ? boyGecisi(b, simdi.hafta) : null;
        if (g) ekle(id, g, simdi.hafta);
      }
    }
    for (const [id, e] of eski) if (!simdiKimlik.has(id) && e !== "kapali") ekle(id, "batti", simdi.hafta);
  }
  for (const o of daoOlaylari) {
    if (o.tur === "kuruldu") ekle(o.firma, "kuruldu", o.hafta);
    else if (o.tur === "firma_batti") ekle(o.firma, "batti", o.hafta);
  }
  return cikti;
}

export type DurumGorunumu = { alfa: number; tint: number | null; tahta: boolean; iskele: boolean; duman: boolean; isik: boolean };

/** Görsel durumun çizim karşılığı (`IZO_STILI.durum` tablosu). Duman yalnız `IZO_STILI.dumanTurleri`ndeki türlerde çizilir (tür çiziciye bırakılır). */
export function durumGorunumu(d: GorselDurum): DurumGorunumu {
  return { ...IZO_STILI.durum[d] };
}

/**
 * Haritadaki her işletmenin görsel durumu (id -> durum). `canlananlar`: bu hafta canlanan kimlikler (`Gecis.tur === "canlandi"` ve `hafta === harita.hafta`):
 * `gorselDurum`'un `oncekiKapaliydi` bayrağı yalnız bunlar için true verilir.
 */
export function durumHaritasi(harita: HaritaVerisi, ilkGorulme: ReadonlyMap<string, number>, canlananlar: ReadonlySet<string>): Map<string, GorselDurum> {
  const cikti = new Map<string, GorselDurum>();
  for (const f of harita.firmalar) cikti.set(f[0], gorselDurum(f, harita.hafta, ilkGorulme.get(f[0]) ?? null, canlananlar.has(f[0])));
  return cikti;
}
