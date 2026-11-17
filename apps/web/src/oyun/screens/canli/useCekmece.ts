"use client";
import { useEffect, useState } from "react";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { SIM_NOT_FOUND, SimUnsupported } from "@/oyun/sim/SimSource";
import type { DrawerData } from "@/oyun/sim/types";

/**
 * `yok`: yalnız ürün çekmecesinde, sunucu 404 verdiğinde (işçi önde olduğundan o hafta henüz yok): hata değil, "duraklatınca açılır" boş durumu.
 * `son`: aynı tür ve kayıt için son başarılı yanıt (yeni istek sürerken ya da `yok` iken eski veriyi göstermek için); yoksa `null`.
 */
export type CekmeceDurumu = { durum: "yukleniyor" | "hazir" | "hata" | "yok"; veri: DrawerData | null; son?: DrawerData | null };

/**
 * Tek bir ayrıntı kaydı: `drawer/{kind}/{ref}?week=` (yalnız okur). `hafta` istek anının yayımlanmış haftasıdır; model ilerlese de değişmez
 * (yanıt `stale` ise "eski hafta" notu çıkar). Anahtar değişince önceki yanıt geçersizdir (yükleniyor); bayat yanıtlar yok sayılır;
 * kaynakta çekmece yoksa `hata`.
 */
export function useCekmece(runId: string, kind: string, ref: string, hafta: number): CekmeceDurumu {
  const source = useSimSource();
  const anahtar = `${runId}|${kind}|${ref}|${hafta}`;
  const sonAnahtar = `${runId}|${kind}|${ref}`;
  const [s, setS] = useState<{ anahtar: string } & CekmeceDurumu>({ anahtar: "", durum: "yukleniyor", veri: null });
  const [sonVeri, setSonVeri] = useState<{ anahtar: string; veri: DrawerData } | null>(null);
  useEffect(() => {
    let canli = true;
    if (!source.drawer) return;
    source.drawer(runId, kind, ref, hafta).then(
      (veri) => {
        if (!canli) return;
        setS({ anahtar, durum: "hazir", veri });
        setSonVeri({ anahtar: sonAnahtar, veri });
      },
      (e: unknown) => {
        if (!canli) return;
        const yok = kind === "urun" && e instanceof SimUnsupported && e.message === SIM_NOT_FOUND;
        setS({ anahtar, durum: yok ? "yok" : "hata", veri: null });
      },
    );
    return () => {
      canli = false;
    };
  }, [source, anahtar, sonAnahtar, runId, kind, ref, hafta]);
  if (!source.drawer) return { durum: "hata", veri: null };
  const son = kind === "urun" && sonVeri?.anahtar === sonAnahtar ? sonVeri.veri : null;
  return s.anahtar === anahtar ? { durum: s.durum, veri: s.veri, ...(kind === "urun" ? { son } : {}) } : { durum: "yukleniyor", veri: null, ...(kind === "urun" ? { son } : {}) };
}
