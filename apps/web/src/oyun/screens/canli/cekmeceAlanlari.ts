import { t, type CopyKey } from "@/oyun/copy/t";
import { num, pct } from "@/oyun/lib/format";
import { ondalik } from "./bicim";

/** Çekmece alan biçimleri: sunucudan gelen ham değer biçimlenir, bilinmeyen/ölçülmeyen değer "ölçülmüyor" olur. */
type Bicim = "oran" | "oran2" | "sayi" | "para" | "ondalik" | "evet" | "mulk" | "sahip";
type Alan = { key: string; bicim: Bicim };

const A = (key: string, bicim: Bicim): Alan => ({ key, bicim });

export const ALANLAR: Record<string, readonly Alan[]> = {
  city: [
    A("served", "oran"), A("employed", "sayi"), A("unemployed", "sayi"), A("players_seeking", "sayi"), A("population", "sayi"), A("players_in_ahir", "sayi"), A("npc_broke", "sayi"), A("cash", "para"), A("cash_weeks", "ondalik"), A("firms_npc", "sayi"), A("firms_player", "sayi"),
    A("rent_pct", "oran"), A("occupancy", "oran"), A("tenants_per_house", "ondalik"), A("migration_in", "sayi"), A("migration_out", "sayi"),
    A("players", "sayi"), A("reputation", "ondalik"), A("idle_npcs", "sayi"), A("wage_index", "ondalik"), A("rent_multiplier", "ondalik"),
    A("import_value", "para"), A("export_value", "para"), A("consumption_value", "para"), A("unpaid_households", "sayi"),
  ],
  sector: [
    A("firms", "sayi"), A("healthy", "sayi"), A("shortage", "oran"), A("persist", "oran"), A("cover_days", "ondalik"), A("price_trend", "oran"),
    A("price", "ondalik"), A("workers", "sayi"),
  ],
  firm: [
    A("workers", "sayi"), A("capacity", "sayi"), A("cash", "para"), A("ownership", "mulk"), A("privatized", "evet"), A("born", "sayi"), A("age", "sayi"),
    A("alive", "evet"), A("died", "sayi"), A("profit", "para"), A("debt", "para"), A("loan_rate", "oran2"), A("health", "ondalik"),
    A("cover_weeks", "ondalik"), A("loss_streak", "sayi"), A("staffless", "evet"), A("exiting", "evet"), A("stock_units", "sayi"), A("insolvent_weeks", "sayi"),
    A("price", "ondalik"), A("wage_avg", "para"), A("sold_week", "sayi"),
  ],
  lonca: [
    A("members", "sayi"), A("fee", "oran"), A("capital", "para"), A("deposits", "para"), A("credit_out", "para"), A("equity", "para"),
    A("owner", "sahip"),
  ],
};

const num0 = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Bir alanın değer metni; değer yoksa ya da türü beklenenden farklıysa `null` (satır gösterilmez), ölçülmeyen sayı "ölçülmüyor". */
export function alanMetni(bicim: Bicim, v: unknown): string | null {
  if (v === undefined) return null;
  const OLC = t("canli.gosterge.olculmuyor");
  switch (bicim) {
    case "evet": return typeof v === "boolean" ? t(v ? "cekmece.evet" : "cekmece.hayir") : v === null ? OLC : null;
    case "mulk": return typeof v === "string" && (["public", "npc", "player"] as string[]).includes(v) ? t(`cekmece.mulk.${v}` as CopyKey) : null;
    case "sahip": return typeof v === "string" && (["player", "none", "closed"] as string[]).includes(v) ? t(`cekmece.sahip.${v}` as CopyKey) : null;
    default: {
      if (v === null) return OLC;
      const n = num0(v);
      if (n === null) return null;
      if (bicim === "oran") return pct(n, 1);
      if (bicim === "oran2") return pct(n, 2);
      if (bicim === "ondalik") return ondalik(2)(n);
      if (bicim === "para") return t("canli.gosterge.akce", { n: num(n) });
      return num(n);
    }
  }
}
