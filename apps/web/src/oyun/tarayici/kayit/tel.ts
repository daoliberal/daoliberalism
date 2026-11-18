/**
 * Python cekirdegi ile tarayici kayit katmani arasindaki tel sozlesmesi (B4a: `simulasyon/arayuz/server/oyun_server/tarayici/tel_b4.json`).
 *
 * Alan adlari tel'deki gibi (snake_case) birakilir: nesneler Python'dan JSON olarak gelir ve JSON olarak gider.
 * `TEL_SEMA` tel_b4.json'daki tur sozlesmesinin birebir kopyasidir; `tests/oyun/tarayici/kayit/tel.test.ts` dosyayi okuyup
 * kopyanin ayni oldugunu kilitler (sabitler, alan kumeleri, hata turleri). Sozlesme degisirse test kirmizi olur.
 */

export const SABITLER = {
  kadans: 13,
  kadans_uzun: 26,
  ham_esik_bayt: 314572800,
  paket_penceresi: 4,
  devam_azami_hafta: 12,
  yonetici_sema: 1,
  goruntu_sema: 2,
  host_sema: 1,
} as const;

export type Sozluk = Record<string, unknown>;

/** Koşunun hangi model/Pyodide/sema ile yazildigi. */
export interface ModelAnahtari {
  model_sha256: string;
  pyodide: string | null;
  schema: number;
  host_sema: number;
}

export interface Tarif {
  config: Sozluk;
  takvim: Sozluk[];
  parent_id: string | null;
  fork_week: number | null;
  dunya_kodu: string | null;
  oyuncu: string | null;
}

export interface KararGirisi {
  sira: number;
  tur: "karar";
  dikis: number;
  karar: Sozluk;
}

export interface SartGirisi {
  sira: number;
  tur: "sart";
  dikis: number;
  yama: Sozluk;
  not: string | null;
  surum: number;
}

export type GunlukGirisi = KararGirisi | SartGirisi;

/** Hafta paketi (`week` olayi): yalniz `week` alani bu katmanca okunur, gerisi saydam. */
export interface HaftaPaketi {
  week: number;
  [alan: string]: unknown;
}

export interface Yonetici {
  sema: number;
  goruntu_kimligi: string;
  id: string;
  duration: number;
  world_id: string | null;
  world_values: Sozluk | null;
  goals: unknown[] | null;
  name: string;
  city_names: unknown[] | null;
  seed_index: number;
  scenario_id: string;
  overrides: Sozluk;
  later_overrides: Sozluk[];
  values: Sozluk;
  status: string;
  speed: number;
  version: number;
  accepted_version: number;
  version_sets: unknown[][];
  version_from: unknown[][];
  version_notes: unknown[][];
  locks: string[];
  dao0: Sozluk | null;
  harita0: Sozluk | null;
  model_version: string | null;
  released: number;
  packet_base: number;
  hist_worlds: Sozluk[];
  hist_versions: number[];
  buf: Sozluk[];
  worker_week: number;
  target: number;
  credit: number;
  vevents_due: unknown[][];
  vevents: Sozluk[];
  raw_config: Sozluk;
  schedule: Sozluk[];
  tarif_takvim: Sozluk[];
  sched_total: number;
  sched_applied: number;
  parent_id: string | null;
  fork_week: number | null;
  mode: string;
  dunya_kodu: string | null;
  oyuncu: string | null;
  flush_one: boolean;
  olay: boolean;
  dao_sonuc: Sozluk | null;
  karar_sira: number;
  harita_taban: Sozluk | null;
  gunluk_sira: number;
  son_ham: number;
}

export interface GoruntuAlSonuc {
  hafta: number;
  yayimlanan: number;
  goruntu_kimligi: string;
  ham: number;
  sikisik: number;
  parca: number;
  anahtar: ModelAnahtari;
  gunluk_sira: number;
  yonetici: Yonetici;
}

export type DevamDurumu = "tamam" | "reddedildi" | "sapma" | "takildi" | "basarisiz";

export interface DevamSonuc {
  durum: DevamDurumu;
  kosu_id: string;
  hafta: number;
  uygulanan: number;
  kalan: number;
  giris?: Sozluk;
  neden?: string | null;
  fields?: unknown[] | null;
  beklenen?: number | unknown[] | null;
  gercek?: number | unknown[] | null;
}

/** Python hata turleri (tel_b4.json `hatalar`). */
export const HATA_TURLERI = [
  "UyumsuzGoruntu",
  "GoruntuHazirDegil",
  "ValueError",
  "TooManyRuns",
  "GuvensizGoruntu",
  "TaninmayanLambda",
  "TaninmayanReferans",
] as const;
export type HataTuru = (typeof HATA_TURLERI)[number];

/** `UyumsuzGoruntu.fark`: `{alan: [goruntude, simdi]}`; `guvensiz`/`bozuk` alanlari alt tur bilgisi tasir. */
export type Fark = Record<string, unknown>;

/** Surum farki sayilan `fark` alanlari (tel_b4.json `hatalar.UyumsuzGoruntu`). */
export const SURUM_FARK_ALANLARI = ["model_sha256", "pyodide", "schema", "host_sema", "host_alanlari", "yonetici_sema"] as const;
/** Bozuk kayit sayilan `fark` alanlari. */
export const BOZUK_FARK_ALANLARI = ["bozuk", "bicim", "yukleme"] as const;

/** tel_b4.json tur sozlesmesi (bkz. dosya basi). Tur dizgeleri: int, num, str, bool, null, dict, list; `a|b`; `{..}`; `?` sonek: istege bagli; `[t]`: liste. */
export const TEL_SEMA = {
  anahtar: { model_sha256: "str", pyodide: "str|null", schema: "int", host_sema: "int" },
  goruntu_al: {
    hafta: "int",
    yayimlanan: "int",
    goruntu_kimligi: "str",
    ham: "int",
    sikisik: "int",
    parca: "int",
    anahtar: { model_sha256: "str", pyodide: "str|null", schema: "int", host_sema: "int" },
    gunluk_sira: "int",
  },
  yonetici: {
    sema: "int",
    goruntu_kimligi: "str",
    id: "str",
    duration: "int",
    world_id: "str|null",
    world_values: "dict|null",
    goals: "list|null",
    name: "str",
    city_names: "list|null",
    seed_index: "int",
    scenario_id: "str",
    overrides: "dict",
    later_overrides: ["dict"],
    values: "dict",
    status: "str",
    speed: "int",
    version: "int",
    accepted_version: "int",
    version_sets: ["list"],
    version_from: ["list"],
    version_notes: ["list"],
    locks: ["str"],
    dao0: "dict|null",
    harita0: "dict|null",
    model_version: "str|null",
    released: "int",
    packet_base: "int",
    hist_worlds: ["dict"],
    hist_versions: ["int"],
    buf: ["dict"],
    worker_week: "int",
    target: "int",
    credit: "int",
    vevents_due: ["list"],
    vevents: ["dict"],
    raw_config: "dict",
    schedule: ["dict"],
    tarif_takvim: ["dict"],
    sched_total: "int",
    sched_applied: "int",
    parent_id: "str|null",
    fork_week: "int|null",
    mode: "str",
    dunya_kodu: "str|null",
    oyuncu: "str|null",
    flush_one: "bool",
    olay: "bool",
    dao_sonuc: "dict|null",
    karar_sira: "int",
    harita_taban: "dict|null",
    gunluk_sira: "int",
    son_ham: "int",
  },
  gunluk: {
    karar: { sira: "int", tur: "str", dikis: "int", karar: "dict" },
    sart: { sira: "int", tur: "str", dikis: "int", yama: "dict", not: "str|null", surum: "int" },
  },
  tarif: { config: "dict", takvim: ["dict"], parent_id: "str|null", fork_week: "int|null", dunya_kodu: "str|null", oyuncu: "str|null" },
  devam_sonuc: {
    durum: "str",
    kosu_id: "str",
    hafta: "int",
    uygulanan: "int",
    kalan: "int",
    "giris?": "dict",
    "neden?": "str|null",
    "fields?": "list|null",
    "beklenen?": "int|list|null",
    "gercek?": "int|list|null",
  },
} as const;
