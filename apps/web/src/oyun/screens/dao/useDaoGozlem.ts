"use client";
import { useEffect, useState } from "react";
import { daoGeciciMi, type DaoGozlem } from "@/oyun/sim/dao";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunState, WeekPacket } from "@/oyun/sim/types";

/** Koşunun ilk paketi gelmeden sunucu `hazirlaniyor` döner: bu aralıkla yeniden sorulur. */
const YENIDEN_MS = 1500;
/** Geçici ağ/5xx hatasında yeniden deneme aralığı: 1,5 sn'den başlar, her denemede iki katına çıkar, en çok bu kadar. */
const GERI_CEKIL_EN_COK_MS = 15_000;
/**
 * Sunucu "hazirlaniyor" (409) derken koşu hazırlık işaretini taşımıyorsa en çok bu kadar kez sorulur (~1 dk): çökmüş/ölü bir işçi hiç paket yayımlamaz ve
 * sunucu sonsuza dek "hazirlaniyor" yanıtlar; sınırsız yoklama konsolu yüzlerce 409 ile doldurur.
 */
const HAZIRLANIYOR_EN_COK = 40;

/**
 * Oyuncunun güncel gözlemi: yayımlanan haftanın paketinde `dao` varsa o, yoksa `GET /dao`. Hafta değişince yeniden okunur.
 * `hazirlaniyor`: sunucu henüz gözlem vermedi (ilk paket yolda).
 */
export function useDaoGozlem(runId: string, state: RunState | null, weeks: WeekPacket[]): { gozlem: DaoGozlem | null; hazirlaniyor: boolean; hata: string | null } {
  const source = useSimSource();
  const hafta = state?.week ?? 0;
  const paket = weeks.length > 0 ? weeks[weeks.length - 1]! : null;
  const paketten = paket !== null && paket.week === hafta && paket.dao !== undefined ? paket.dao : null;
  const [okunan, setOkunan] = useState<{ runId: string; hafta: number; gozlem: DaoGozlem } | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  /** Sunucunun hata kodu (`dao_degil`, `unknown_run`...) ya da ağ hatası anahtarı; `hazirlaniyor` hata sayılmaz. */
  const [hata, setHata] = useState<string | null>(null);
  const durumVar = state !== null;
  /** Koşu çöktü: sunucu gözlem vermez; yoklama hiç başlamaz. */
  const olu = state?.status === "failed";
  /** Koşu oynuyor (hafta 0'da "duruyor" ayrımı için). */
  const calisiyor = state?.status === "running";
  /** Hafta 0'da duruyor: ilk paket oyuncu oynat'a basmadan yayımlanmaz, "hazirlaniyor" meşrudur. */
  const duruyor = hafta === 0 && !calisiyor && state?.preparing === undefined && state?.computing !== true;
  // `dao0` HAFTA 0 gozlemidir: yalniz hafta 0'da gecerli. Yenilemeden sonra durum (hafta N>0) paketlerden once gelir; o pencerede dao0 guncel diye gosterilmez, `GET /dao` yoklamasi surer.
  const dao0Var = weeks.length === 0 && hafta === 0 && state?.dao0 != null;
  const hazirlikSuruyor = state?.preparing !== undefined || state?.computing === true;
  const [vazgecildi, setVazgecildi] = useState<string | null>(null);

  useEffect(() => {
    if (!durumVar || olu || paketten !== null || dao0Var || typeof source.daoGozlem !== "function") return;
    let canli = true;
    let zaman: ReturnType<typeof setTimeout> | null = null;
    let deneme = 0;
    let hazirDeneme = 0;
    const oku = (): void => {
      source.daoGozlem!(runId).then(
        (g) => {
          if (!canli) return;
          deneme = 0;
          setBekliyor(false);
          setHata(null);
          setOkunan({ runId, hafta, gozlem: g });
        },
        (e: unknown) => {
          if (!canli) return;
          if (e instanceof SimUnsupported && e.message === "hazirlaniyor") {
            hazirDeneme += 1;
            if (duruyor) {
              // Oynat'a basılana kadar tek yoklama yeter (DAO olmayan koşu `dao_degil` ile yine anlaşılır); hata üretilmez, ilk hafta ipucu görünür kalır.
              setBekliyor(false);
              setHata(null);
              return;
            }
            if (!duruyor && !hazirlikSuruyor && hazirDeneme >= HAZIRLANIYOR_EN_COK) {
              setBekliyor(false);
              setVazgecildi(runId);
              return;
            }
            setBekliyor(true);
            setHata(null);
            zaman = setTimeout(oku, YENIDEN_MS);
          } else {
            // Bilinmeyen (SimUnsupported olmayan) hata da yutulmaz: geçici sayılır.
            setHata(e instanceof SimUnsupported ? e.message : "hata.sunucu_bozuk");
            if (!(e instanceof SimUnsupported) || daoGeciciMi(e)) {
              // Geçici hata (ağ düştü, sunucu 5xx): hata görünür kalır, aralık büyüyerek yeniden denenir; kalıcı kodlar (`dao_degil`...) denenmez.
              zaman = setTimeout(oku, Math.min(YENIDEN_MS * 2 ** deneme, GERI_CEKIL_EN_COK_MS));
              deneme += 1;
            }
          }
        },
      );
    };
    oku();
    return () => {
      canli = false;
      if (zaman !== null) clearTimeout(zaman);
    };
  }, [source, runId, hafta, durumVar, olu, hazirlikSuruyor, duruyor, dao0Var, paketten]);

  if (paketten !== null) return { gozlem: paketten, hazirlaniyor: false, hata: null };
  const okunanBu = okunan !== null && okunan.runId === runId ? okunan.gozlem : null;
  const bu = okunanBu ?? (weeks.length === 0 && hafta === 0 ? state?.dao0 ?? null : null);          // haftalık paket yokken ve hafta 0'dayken: ready ile gelen hafta 0 gözlemi (harita0 deseni)
  if (bu === null && olu) return { gozlem: null, hazirlaniyor: false, hata: "kosu_coktu" };
  if (bu === null && vazgecildi === runId) return { gozlem: null, hazirlaniyor: false, hata: "kosu_yanit_vermiyor" };
  return { gozlem: bu, hazirlaniyor: bu === null && bekliyor, hata: bu === null ? hata : null };
}
