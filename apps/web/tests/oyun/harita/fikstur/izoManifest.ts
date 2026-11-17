import type { SpriteKaydi, SpriteManifesti } from "@/oyun/harita/spriteManifest";

const PARSEL = { genislik: 208, yukseklik: 120 } as const;

function kayit(ad: string, ek: Partial<SpriteKaydi>): SpriteKaydi {
  return {
    ad,
    dosya: `${ad}.png`,
    genislik: 209,
    yukseklik: 200,
    ankraj: { x: 104, y: 199 },
    parsel: { ...PARSEL },
    kaynak: "uretim",
    insanli: false,
    oyunTurleri: [],
    grup: "genel",
    boy: null,
    parselSayisi: 1,
    yalin: true,
    zeminTuru: null,
    baglanti: null,
    ...ek,
  };
}

const bag = (s: string): NonNullable<SpriteKaydi["baglanti"]> => ({ K: s.includes("K"), D: s.includes("D"), G: s.includes("G"), B: s.includes("B") });

/** Gerçek sete benzeyen sahte manifest: 4 grup x 4 boy (boy 4 iki parsel), tek boylu lonca, tüm zemin türleri, bindirme, 1 genel, 1 insanlı. */
export function izoManifestFiksturu(): SpriteManifesti {
  const kayitlar: SpriteKaydi[] = [];
  for (const g of ["hammadde", "imalat", "hizmet", "lojistik"]) {
    for (const b of [1, 2, 3, 4] as const) {
      kayitlar.push(
        kayit(`${g}_boy${b}`, {
          dosya: `merdiven/yalin/${g}_boy${b}_yalin.png`,
          grup: g,
          boy: b,
          parselSayisi: b === 4 ? 2 : 1,
          genislik: b === 4 ? 313 : 209,
          yukseklik: 100 + b * 30,
        }),
      );
    }
  }
  kayitlar.push(kayit("lonca_boy1", { dosya: "merdiven/yalin/lonca_boy1_yalin.png", grup: "lonca", boy: 1, oyunTurleri: ["lonca"] }));
  kayitlar.push(kayit("genel_bina", { dosya: "yalin/genel_bina_yalin.png", grup: "genel", boy: 1 }));
  kayitlar.push(kayit("oyun_parki", { dosya: "insanli/oyun_parki.png", grup: "hizmet", boy: 1, oyunTurleri: ["eglence"], insanli: true }));

  const zemin = (ad: string, tur: string, baglanti: string | null = null): void => {
    kayitlar.push(kayit(ad, { dosya: `zemin/${ad}.png`, genislik: 58, yukseklik: 35, ankraj: { x: 29, y: 17 }, grup: "zemin", zeminTuru: tur, baglanti: baglanti === null ? null : bag(baglanti) }));
  };
  for (const on of ["yol", "yol-ana"]) {
    zemin(`${on}_duz_dogu_bati`, `${on}-duz`, "BD");
    zemin(`${on}_duz_kuzey_guney`, `${on}-duz`, "KG");
    zemin(`${on}_kavsak`, `${on}-kavsak`, "KDGB");
    for (const s of ["K", "D", "G", "B"]) {
      zemin(`${on}_t_kapali_${s}`, `${on}-t`, "KDGB".replace(s, ""));
      zemin(`${on}_son_${s}`, `${on}-sonu`, s);
    }
    for (const k of ["KD", "DG", "GB", "BK"]) zemin(`${on}_kose_${k}`, `${on}-kose`, k);
  }
  for (const t of ["kaldirim", "cim", "agac", "arsa", "park", "nehir", "cimen", "otopark", "konut"]) zemin(`zemin_${t}`, t);

  for (const t of ["iskele", "tahtali"] as const) {
    for (const b of [1, 2, 3, 4] as const) {
      kayitlar.push(kayit(`${t}_boy${b}`, { dosya: `overlay/${t}_boy${b}.png`, grup: "bindirme", oyunTurleri: [t], boy: b, parselSayisi: b === 4 ? 2 : 1, ankraj: { x: 149, y: 183 } }));
    }
  }
  const zeminKaro = { genislik: 55, yukseklik: 32 };
  return { kayitlar, karo: zeminKaro, zeminKaro, parselKaro: { genislik: 208, yukseklik: 120 }, yolOrani: 55 / 208 };
}
