/**
 * B8: kayit acilis sonucu -> secim ekrani eslemesi (saf). Her `AkisSonucu` turu icin baslik/bilgi metin anahtari, tahmini sure ve sunulacak secenekler.
 * K9: `durdu` sonrasi kayda duz devam EDILEMEZ (yazim kilitli; yalniz `gunlukKes`/silme/tariften yeniden kurma acar): bu ekran yalniz disa aktar, sil, yeni oyun sunar.
 */
import type { CopyKey } from "@/oyun/copy/t";
import type { AkisSonucu } from "./kayit/akis";
import type { SureTahmini } from "./kayit/siniflandirma";
import type { Fark } from "./kayit/tel";

export type AcilisSecenekAdi = "tariften_oynat" | "disa_aktar" | "sil" | "yeni" | "yeniden_yukle";

export interface AcilisSecimi {
  baslik: CopyKey;
  bilgi: CopyKey;
  bilgiParam?: Record<string, string | number>;
  tahmini: SureTahmini | null;
  secenekler: readonly AcilisSecenekAdi[];
}

const TARIFTEN: readonly AcilisSecenekAdi[] = ["tariften_oynat", "disa_aktar", "sil", "yeni"];

export function acilisSecimi(s: Exclude<AkisSonucu, { sonuc: "tamam" }>): AcilisSecimi {
  switch (s.sonuc) {
    case "uyumsuz":
      return { baslik: `acilis.uyumsuz.${s.tur}.baslik`, bilgi: `acilis.uyumsuz.${s.tur}.bilgi`, tahmini: s.tahmini, secenekler: TARIFTEN };
    case "tariften_gerek":
      return { baslik: "acilis.tariften.baslik", bilgi: s.neden === "goruntu_cok_eski" ? "acilis.tariften.goruntu_cok_eski" : "acilis.tariften.goruntu_yok", tahmini: s.tahmini, secenekler: TARIFTEN };
    case "durdu":
      return { baslik: "acilis.durdu.baslik", bilgi: `acilis.durdu.${s.durum}`, tahmini: null, secenekler: ["disa_aktar", "sil", "yeni"] };
    case "hata":
      if (s.tur === "yeniden_yukle_gerek") return { baslik: "acilis.hata.baslik", bilgi: "acilis.hata.surum", tahmini: null, secenekler: ["yeniden_yukle", "disa_aktar", "yeni"] };
      if (s.tur === "kosu_yok") return { baslik: "acilis.hata.baslik", bilgi: "acilis.hata.kosu_yok", tahmini: null, secenekler: ["yeni"] };
      return { baslik: "acilis.hata.baslik", bilgi: "acilis.hata.bilgi", tahmini: null, secenekler: ["yeniden_yukle", "disa_aktar", "sil", "yeni"] };
  }
}

/** Sure etiketi: 90 saniyeye dek saniye, sonrasi dakika (yukari yuvarlanir). Metin anahtari + deger. */
function sureEtiketi(sn: number): { anahtar: "tarayici.sure.sn" | "tarayici.sure.dk"; deger: number } {
  if (sn < 90) return { anahtar: "tarayici.sure.sn", deger: Math.max(1, Math.round(sn)) };
  return { anahtar: "tarayici.sure.dk", deger: Math.max(1, Math.round(sn / 60)) };
}

export function sureAraligi(t: SureTahmini): { enaz: CopyKey; enazDeger: number; encok: CopyKey; encokDeger: number } {
  const a = sureEtiketi(t.enAzSn);
  const b = sureEtiketi(t.enCokSn);
  return { enaz: a.anahtar, enazDeger: a.deger, encok: b.anahtar, encokDeger: b.deger };
}

/** Goruntusuz kayit bu tahmini (en cok, sn) icindeyse ve model ayniysa SORMADAN baştan oynatilir; aksi halde secim ekrani. */
export const OTOMATIK_AZAMI_SN = 150;

export type AcilisKarari = { tur: "otomatik" } | { tur: "secim"; sonuc: Exclude<AkisSonucu, { sonuc: "tamam" }> };

/**
 * TEK karar noktasi: acilis akisi (`devamAkisi`) ve Koşular/`#/sonuc`/`#/dao` yolundan acma (`kopru.kayittanAc`) AYNI tabloyu kullanir.
 * `tamam` disindaki her sonuc secim ekranina gider; tek istisna: goruntusuz (`goruntu_yok`) kayit, tahmin <= 150 sn ve kaydin modeli yuklu modelle ayniysa
 * otomatik baştan oynatilir. Model farkliysa (Y2) uzunluktan bagimsiz "bu model surumuyle acilamadi" secimi (tahmini sureyle) gosterilir.
 */
export function acilisKarari(sonuc: Exclude<AkisSonucu, { sonuc: "tamam" }>, o: { uyumlu: boolean; fark?: Fark }): AcilisKarari {
  if (sonuc.sonuc === "tariften_gerek") {
    if (!o.uyumlu) return { tur: "secim", sonuc: { sonuc: "uyumsuz", tur: "surum", fark: o.fark ?? {}, hedef: sonuc.hedef, tahmini: sonuc.tahmini, secenekler: ["tariften_oynat", "disa_aktar", "sil"] } };
    if (sonuc.neden === "goruntu_yok" && sonuc.tahmini.enCokSn <= OTOMATIK_AZAMI_SN) return { tur: "otomatik" };
  }
  return { tur: "secim", sonuc };
}
