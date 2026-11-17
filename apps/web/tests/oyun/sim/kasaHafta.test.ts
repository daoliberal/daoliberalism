// E0: kasa hedefi en düşük şehirden ölçülür (şehir başına kasa-hafta); alan yoksa toplam ölçü (eski sunucu/kayıt).
import { describe, expect, it } from "vitest";
import { computeResult, kasaTaban, KASA_TABAN_HAFTA } from "@/oyun/sim/result";
import { parsePacket } from "@/oyun/sim/live/wire";
import { toPackets } from "@/oyun/sim/replay/loader";
import type { CityRow, GoalId, Registry, WeekPacket, World } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const NULLS = packetOf("r", 1, 1).world;
const ALL: GoalId[] = ["alive", "serve", "kasa", "gini"];
const satir = (index: number, cash_weeks?: number | null): CityRow => ({
  index, served: 0.9, employed: 1, unemployed: 0, cash: 1, firms_npc: 1, firms_player: 0, rent_pct: null, occupancy: null, tenants_per_house: null,
  migration_in: 0, migration_out: 0, ...(cash_weeks === undefined ? {} : { cash_weeks }),
});
type Ek = { cities?: CityRow[]; cash_weeks?: (number | null)[] };
function kosu(n: number, world: (w: number) => Partial<World>, ek: (w: number) => Ek = () => ({})): WeekPacket[] {
  return Array.from({ length: n }, (_, i) => {
    const w = i + 1;
    return { ...packetOf("r", w, 1), world: { ...NULLS, served: 0.9, gini: 0.5, city_cash_total: 50000, ...world(w) }, events: [], ...ek(w) };
  });
}
const kasa = (r: ReturnType<typeof computeResult>) => r.goals.find((g) => g.id === "kasa")!;

describe("kasa hedefi: en düşük şehir", () => {
  it("toplam yeterli olsa da tabanın altına inen şehir hedefi bozar", () => {
    const w = kosu(200, () => ({ city_cash_weeks: 6 }), (h) => ({ cities: [satir(0, 6), satir(1, h === 90 ? KASA_TABAN_HAFTA - 0.4 : 6), satir(2, 7)] }));
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: false, value: KASA_TABAN_HAFTA - 0.4, basis: "city" });
  });
  it("her şehir tabanın üstündeyse tutturulur, değer en düşük şehirdir", () => {
    const w = kosu(200, () => ({ city_cash_weeks: 6 }), () => ({ cities: [satir(0, 4), satir(1, 3.5), satir(2, null)] }));
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: true, value: 3.5, basis: "city" });
  });
  it("kayıt: paketteki cash_weeks listesi de aynı ölçüdür", () => {
    const w = kosu(200, () => ({ city_cash_weeks: 6 }), (h) => ({ cash_weeks: [5, h === 70 ? 1.2 : 5, null] }));
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: false, value: 1.2, basis: "city" });
  });
  it("açılış haftalarındaki düşük şehir sayılmaz", () => {
    const w = kosu(200, () => ({ city_cash_weeks: 6 }), (h) => ({ cities: [satir(0, h < 10 ? 0.1 : 5)] }));
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: true, value: 5, basis: "city" });
  });
  it("şehir alanı yoksa (eski sunucu/kayıt) toplam ölçü ve eski davranış", () => {
    const w = kosu(200, (h) => ({ city_cash_weeks: h === 50 ? 1.5 : 6 }));
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: false, value: 1.5, basis: "total" });
    const eski = kosu(200, () => ({ city_cash_weeks: 6 }), () => ({ cities: [satir(0)] }));       // satırda cash_weeks yok
    expect(kasa(computeResult(eski, ALL, 200))).toMatchObject({ met: true, value: 6, basis: "total" });
  });
  it("şehir ölçüleri null ise toplama düşer; ikisi de null ise ölçülmedi", () => {
    const toplam = kosu(200, () => ({ city_cash_weeks: 4 }), () => ({ cities: [satir(0, null)] }));
    expect(kasa(computeResult(toplam, ALL, 200))).toMatchObject({ met: true, value: 4, basis: "total" });
    const yok = kosu(200, () => ({ city_cash_weeks: null }), () => ({ cities: [satir(0, null)] }));
    expect(kasa(computeResult(yok, ALL, 200))).toMatchObject({ met: null, reason: "unmeasured", value: null });
  });
  it("koşu sürerken taban altı kesin başarısızlık, üstü beklemede", () => {
    const alt = kosu(60, () => ({ city_cash_weeks: 6 }), (h) => ({ cities: [satir(0, h === 30 ? 1 : 5)] }));
    expect(kasa(computeResult(alt, ALL, 200))).toMatchObject({ met: false, value: 1 });
    const ust = kosu(60, () => ({ city_cash_weeks: 6 }), () => ({ cities: [satir(0, 5)] }));
    expect(kasa(computeResult(ust, ALL, 200))).toMatchObject({ met: null, reason: "pending", value: 5 });
  });
});

describe("kasa-hafta tel ve kayıt biçimi", () => {
  const p = packetOf("r", 1, 1, { cities: true });
  it("tel: cash_weeks sayı ya da null okunur, alan yoksa anahtar eklenmez, bozuk tür WireError", () => {
    const row = { ...p.cities![0]!, cash_weeks: 3.25 };
    expect(parsePacket({ ...p, cities: [row] }).cities![0]!.cash_weeks).toBe(3.25);
    expect(parsePacket({ ...p, cities: [{ ...row, cash_weeks: null }] }).cities![0]!.cash_weeks).toBeNull();
    const eski: Record<string, unknown> = { ...row };
    delete eski.cash_weeks;
    expect("cash_weeks" in parsePacket({ ...p, cities: [eski] }).cities![0]!).toBe(false);
    expect(() => parsePacket({ ...p, cities: [{ ...row, cash_weeks: "x" }] })).toThrow();
  });
  it("sözleşme fikstüründeki şehir satırları cash_weeks taşır", () => {
    for (const c of p.cities!) expect(typeof c.cash_weeks).toBe("number");
  });
  it("kayıt: city_cash_weeks_c* sütunları paket cash_weeks listesine açılır; sütun yoksa alan yok", () => {
    const cols = (extra: Record<string, (number | null)[]>) => ({ set: "kapali", pm_index: 0, weeks: 2, cols: { served: [1, 1], city_cash_weeks: [4, 3], ...extra } });
    const dolu = toPackets(cols({ city_cash_weeks_c0: [5, 4], city_cash_weeks_c1: [null, 3], city_cash_weeks_c2: [6, 3.5] }), "r");
    expect(dolu[0]!.world.city_cash_weeks).toBe(4);
    expect(dolu[0]!.cash_weeks).toEqual([5, null, 6]);
    expect(dolu[1]!.cash_weeks).toEqual([4, 3, 3.5]);
    const eski = toPackets(cols({}), "r");
    expect("cash_weeks" in eski[0]!).toBe(false);
  });
});

describe("kasa hedefi: etiket ve değer aynı kaynaktan (E0 düzeltme 1, m2)", () => {
  it("şehir verisi yalnız bazı haftalarda varsa etiket en düşük değeri veren ölçüyü söyler", () => {
    const sehirdeEnDusuk = kosu(200, () => ({ city_cash_weeks: 6 }), (h) => (h < 100 ? { cities: [satir(0, 5)] } : {}));
    expect(kasa(computeResult(sehirdeEnDusuk, ALL, 200))).toMatchObject({ value: 5, basis: "city" });
    const toplamdaEnDusuk = kosu(200, (h) => ({ city_cash_weeks: h >= 100 ? 3 : 6 }), (h) => (h < 100 ? { cities: [satir(0, 5)] } : {}));
    expect(kasa(computeResult(toplamdaEnDusuk, ALL, 200))).toMatchObject({ value: 3, basis: "total" });
    const esit = kosu(200, () => ({ city_cash_weeks: 5 }), (h) => (h < 100 ? { cities: [satir(0, 5)] } : {}));
    expect(kasa(computeResult(esit, ALL, 200)).basis).toBe("city");
  });
});

describe("kasa hedefi: modelin bu şartta uyguladığı taban (m3)", () => {
  const kart = (id: string, def: unknown, shows?: unknown) => ({ id, default: def, ...(shows ? { shows } : {}) });
  const kayit = {
    cards: [kart("gecis_destegi", "kurtarma_fonuyla"), kart("kasa_tabani", 2), kart("destek_bitis_esigi", 60, [{ label: "Derin kasa tabanı", text: "0,5 hafta", value: 0.5 }])],
  } as unknown as Registry;
  it("TRANS_SUPPORT=2 (kurtarma fonuyla) derin tabanı, öteki şartlar kasa tabanı kartını kullanır; değerler kayıt kartlarından okunur", () => {
    expect(kasaTaban(kayit, { gecis_destegi: "kurtarma_fonuyla" })).toBe(0.5);
    expect(kasaTaban(kayit, {})).toBe(0.5);                                   // kartın varsayılanı kurtarma fonuyla
    expect(kasaTaban(kayit, { gecis_destegi: "kapali" })).toBe(2);
    expect(kasaTaban(kayit, { gecis_destegi: "kisa_sureli" })).toBe(2);
    expect(kasaTaban(kayit, { gecis_destegi: "kapali", kasa_tabani: 3 })).toBe(3);
    expect(kasaTaban(null, { gecis_destegi: "kapali" })).toBe(KASA_TABAN_HAFTA);   // kayıt yoksa adı ve kaynağı belli sabit
  });
  it("hüküm koşunun taban değeriyle verilir ve sonuçta taban görünür", () => {
    const w = kosu(200, () => ({ city_cash_weeks: 6 }), () => ({ cities: [satir(0, 1.2)] }));
    expect(kasa(computeResult(w, ALL, 200, [], 0.5))).toMatchObject({ met: true, value: 1.2, floor: 0.5 });
    expect(kasa(computeResult(w, ALL, 200, [], 2))).toMatchObject({ met: false, value: 1.2, floor: 2 });
    expect(kasa(computeResult(w, ALL, 200))).toMatchObject({ met: false, floor: KASA_TABAN_HAFTA });
  });
});
