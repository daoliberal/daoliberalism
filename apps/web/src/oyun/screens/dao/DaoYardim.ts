import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { sektorOkunurAd } from "@/oyun/lib/sektorAdlari";
import type { HaritaBaglami } from "@/oyun/harita/tipler";
import type { DaoAdlar, DaoDurum, DaoGozlem } from "@/oyun/sim/dao";
import type { SourceInfo } from "@/oyun/sim/types";

/** Modelin işletme kimlikleri: `s0_maden_komur0` (sektör türü yakalanır), `fk0`, `f7`. */
const MAKINE_ADI = /^(?:s\d+_(.+?)\d*|fk?\d+)$/;

/** Olay ve tablo metinleri için şehir ve sektör adlandırıcıları: şehir koşunun adlarından, sektör kaynak bilgisindeki etiketlerden (yoksa tür kodu). */
export function daoAdlari(cityNames: string[], info: SourceInfo | null): DaoAdlar {
  const etiketler = new Map((info?.world?.chain?.sectors ?? []).map((s) => [s.sector, s.label]));
  const sektor = (tur: string): string => (tur === "ahir" ? t("harita.ahir") : (etiketler.get(tur) ?? sektorOkunurAd(tur)));
  return {
    firma: (kimlik, sektorTuru) => {
      const m = MAKINE_ADI.exec(kimlik);
      if (m === null) return kimlik; // okunur ad (oyuncunun işletmesi)
      const tur = sektorTuru ?? m[1] ?? null;
      return tur === null ? t("dao.firma_bilinmiyor") : sektor(tur);
    },
    sehir: (i) => cityDisplayName(cityNames[i] ?? "", i),
    sektor,
  };
}

const HARITA_DURUMU: Record<DaoDurum, NonNullable<HaritaBaglami["ben"]>["durum"]> = { kurucu: "sahip", calisan: "calisiyor", is_arayan: "issiz", ahir: "ahir", bilinmiyor: "issiz" };

/** Oyuncunun haritadaki yeri (vurgulanan bina): gözlem yoksa (hafta 0) vurgu yoktur. */
export function daoHaritaBeni(g: DaoGozlem | null): HaritaBaglami["ben"] {
  return g === null ? null : { sehir: g.ben.sehir, firma: g.ben.is.firma, durum: HARITA_DURUMU[g.ben.durum] };
}
