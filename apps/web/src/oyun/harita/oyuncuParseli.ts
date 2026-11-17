import { depolamaYaz } from "./depolama";

/**
 * Oyuncunun işletmesi için seçtiği parselin sabitlenmesi (K8). Sunucu parsel bilmez; istemci "İşletme kur" kabul edilince {parsel, mod, sektor}
 * bekletir, `kuruldu` olayıyla yeni firmanın kimliği gelince {firma -> parsel} olarak bağlar. Koşu kimliğiyle localStorage'da yaşar.
 */
export type GorunumTuru = "izo" | "klasik";
export type OyuncuParselDeposu = {
  izo: Readonly<Record<string, string>>;
  klasik: Readonly<Record<string, string>>;
  bekleyen: { parsel: string; mod: GorunumTuru; sektor: string } | null;
  /** Bağlanmış ya da bekleyen yokken görülmüş (eski) firma kimlikleri: yeni kurulanla karışmaz. */
  islenen: readonly string[];
};

export const bosDepo = (): OyuncuParselDeposu => ({ izo: {}, klasik: {}, bekleyen: null, islenen: [] });
const ANAHTAR = "daoliberal.oyuncuparsel.";

export const sabitlemeler = (d: OyuncuParselDeposu, mod: GorunumTuru): ReadonlyMap<string, string> => new Map(Object.entries(d[mod]));

/** Saf: görülen firma kimlikleri (kuruldu olayları, `ben.is.firma`) içinde yeni olan ilkini bekleyen kura bağlar; hepsi işlenmiş sayılır. */
export function isletmeBagla(d: OyuncuParselDeposu, firmalar: readonly string[]): OyuncuParselDeposu {
  let s = d;
  for (const f of firmalar) {
    if (s.islenen.includes(f)) continue;
    const b = s.bekleyen;
    s = b === null
      ? { ...s, islenen: [...s.islenen, f] }
      : { ...s, [b.mod]: { ...s[b.mod], [f]: b.parsel }, bekleyen: null, islenen: [...s.islenen, f] };
  }
  return s;
}

const metinMi = (x: unknown): x is Record<string, string> =>
  x !== null && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((v) => typeof v === "string");

export function depoOku(runId: string): OyuncuParselDeposu {
  try {
    const ham = typeof localStorage === "undefined" ? null : localStorage.getItem(ANAHTAR + runId);
    if (ham === null) return bosDepo();
    const o: unknown = JSON.parse(ham);
    if (o === null || typeof o !== "object") return bosDepo();
    const { izo, klasik, bekleyen, islenen } = o as Record<string, unknown>;
    if (!metinMi(izo) || !metinMi(klasik) || !Array.isArray(islenen) || !islenen.every((x) => typeof x === "string")) return bosDepo();
    const b = bekleyen as { parsel?: unknown; mod?: unknown; sektor?: unknown } | null;
    const gecerliB = b !== null && typeof b === "object" && typeof b.parsel === "string" && (b.mod === "izo" || b.mod === "klasik") && typeof b.sektor === "string";
    return { izo, klasik, islenen: islenen as string[], bekleyen: gecerliB ? { parsel: b.parsel as string, mod: b.mod as GorunumTuru, sektor: b.sektor as string } : null };
  } catch {
    return bosDepo();
  }
}

export function depoYaz(runId: string, d: OyuncuParselDeposu): void {
  depolamaYaz(runId, ANAHTAR + runId, JSON.stringify(d));
}
