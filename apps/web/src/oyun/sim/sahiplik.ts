import type { Holdings, World } from "./types";

/** Sahiplik görünümünün satır kimlikleri (arayüz metni `canli.sahiplik.sahip.*` anahtarlarından gelir). */
export type SahipSatirId = "hane_nakdi" | "hane_mevduat" | "sigorta" | "yerlesik" | "oyuncu_isletme" | "kamu" | "lonca_kasa" | "diger";
export type SahipSatir = { id: SahipSatirId; deger: number | null };
export type SahiplikGorunumu = {
  satirlar: SahipSatir[];
  /** Satırların toplamı; bir satır ölçülmediyse `null` (eksik toplam uydurma sayı verirdi). */
  toplam: number | null;
  /** Hesap görünümünün toplamı (6 kesim); sahiplik toplamı bununla (± yuvarlama) kapanır. */
  hesapToplami: number | null;
  /** Net lonca kasası negatifse: loncaların dışarıdaki kredisi + tahvili (kasanın eksiye düşmesinin karşılığı); aksi halde `null`. */
  krediDisarida: number | null;
};

const sonlu = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const topla = (...v: (number | null | undefined)[]): number | null => (v.every(sonlu) ? (v as number[]).reduce((a, b) => a + b, 0) : null);

/**
 * Paranın kime ait olduğu (PLAN-TAKIP §4.1, U2). Saf işlev: sunucu hesabını yeniden yapmaz, yalnız paketin parçalarını birleştirir.
 *
 *   hane nakdi = money_households; hane mevduatı = deposits_players; sigortacılar = insurance_reserve + deposits_insurance;
 *   yerleşik işletmeler = money_npc_firms; oyuncu işletmeleri = money_player_firms; kamu = money_city + found_fund;
 *   lonca kasası (net, işaretli) = lonca_cash_net; diğer = money_other.
 */
export function sahiplikGorunumu(w: World | null, h: Holdings | undefined): SahiplikGorunumu | null {
  if (!w || !h) return null;
  const m = h.money;
  const satirlar: SahipSatir[] = [
    { id: "hane_nakdi", deger: sonlu(w.money_households) ? w.money_households : null },
    { id: "hane_mevduat", deger: m.deposits_players },
    { id: "sigorta", deger: topla(m.insurance_reserve, m.deposits_insurance) },
    { id: "yerlesik", deger: sonlu(w.money_npc_firms) ? w.money_npc_firms : null },
    { id: "oyuncu_isletme", deger: sonlu(w.money_player_firms) ? w.money_player_firms : null },
    { id: "kamu", deger: topla(w.money_city, m.found_fund) },
    { id: "lonca_kasa", deger: m.lonca_cash_net },
    { id: "diger", deger: sonlu(w.money_other) ? w.money_other : null },
  ];
  const kredi = sonlu(m.lonca_cash_net) && m.lonca_cash_net < 0 ? topla(m.credit_out, m.bonds_out) : null;
  return {
    satirlar,
    toplam: topla(...satirlar.map((s) => s.deger)),
    hesapToplami: topla(w.money_households, w.money_npc_firms, w.money_player_firms, w.money_city, w.money_lonca, w.money_other),
    krediDisarida: kredi,
  };
}

/** Oyuncu gruplarının sırası (sunucudaki öncelik sırasıyla aynı: her kişi ilk uyan tek gruba girer). */
export const OYUNCU_GRUPLARI = ["lonca_owner", "firm_owner", "employed_player_firm", "employed_npc_firm", "municipal", "ahir", "seeking", "student", "other"] as const;

export type MevduatSatir = { id: string; deger: number | null };
export type MevduatSahipleri = { satirlar: MevduatSatir[]; toplam: number | null };

/**
 * Mevduat sahipleri (grup başına tutar): bilinen oyuncu grupları sırayla, sigortacılar, sonra bilinmeyen anahtarların toplamı "other" satırına eklenir
 * (ham anahtar yazılmaz). Biri ölçülmediyse toplam `null`. Pay oranını çağıran toplamdan hesaplar.
 */
export function mevduatSahipleri(h: Holdings | undefined): MevduatSahipleri | null {
  if (!h) return null;
  const by = h.deposits.by_group;
  const bilinen = new Set<string>([...OYUNCU_GRUPLARI, "insurance"]);
  let artik: number | null = 0;
  for (const [k, v] of Object.entries(by)) if (!bilinen.has(k)) artik = artik === null || !sonlu(v) ? null : artik + v;
  const satirlar: MevduatSatir[] = [...OYUNCU_GRUPLARI, "insurance"].map((id) => {
    const v = by[id];
    const ek = id === "other" ? artik : 0;
    return { id, deger: sonlu(v) && ek !== null ? v + ek : null };
  });
  return { satirlar, toplam: topla(...satirlar.map((s) => s.deger)) };
}

export type LoncaAltSatirId = "mevduat" | "fon" | "rezerv" | "kasa";
export type LoncaKirilimi = { satirlar: { id: LoncaAltSatirId; deger: number | null }[]; toplam: number | null };

/**
 * "Hangi hesapta" görünümünde Loncalar kesiminin içi: mevduat (oyuncu + sigorta), kuruluş fonu, sigorta rezervi ve loncaların net kasası.
 * Dördünün toplamı `money_lonca`ya (± yuvarlama) eşittir; sunucunun tanımı `lonca_cash_net = money_lonca - mevduatlar - fon - rezerv`dir.
 */
export function loncaKirilimi(h: Holdings | undefined): LoncaKirilimi | null {
  if (!h) return null;
  const m = h.money;
  const satirlar: LoncaKirilimi["satirlar"] = [
    { id: "mevduat", deger: topla(m.deposits_players, m.deposits_insurance) },
    { id: "fon", deger: m.found_fund },
    { id: "rezerv", deger: m.insurance_reserve },
    { id: "kasa", deger: m.lonca_cash_net },
  ];
  return { satirlar, toplam: topla(...satirlar.map((x) => x.deger)) };
}
