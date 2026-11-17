import { t } from "@/oyun/copy/t";

/** Lejant anahtarı (`<katman>.<ton>`, `sehirSahnesi` lejant satırlarından) -> ekran metni. */
export const lejantAdi = (anahtar: string): string => {
  switch (anahtar) {
    case "talep.iyi": return t("harita.lejant.talep.iyi");
    case "talep.orta": return t("harita.lejant.talep.orta");
    case "talep.dar": return t("harita.lejant.talep.dar");
    case "fiyat.dusen": return t("harita.lejant.fiyat.dusen");
    case "fiyat.yatay": return t("harita.lejant.fiyat.yatay");
    case "fiyat.artan": return t("harita.lejant.fiyat.artan");
    default: return anahtar;
  }
};
