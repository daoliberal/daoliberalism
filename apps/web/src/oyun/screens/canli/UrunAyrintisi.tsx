import { Button } from "@/components/primitives/Button";
import { Table } from "@/components/primitives/Table";
import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import type { DrawerData } from "@/oyun/sim/types";
import { goster, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";
import { useCekmece } from "./useCekmece";

type Props = { runId: string; urun: string; ad: string; hafta: number; sehirAdlari: string[]; onKapat(): void };

type Satir = { sehir: number; talep: number | null; uretim: number | null; stok: number | null; firma: number | null };

/** Ürün çekmecesinin şehir satırları (`fields.sehirler`); alanı eksik ya da bozuk satır atlanır, sayı uydurulmaz. */
function satirlarOf(d: DrawerData | null): Satir[] {
  const ham = d?.fields.sehirler;
  if (!Array.isArray(ham)) return [];
  const say = (v: unknown): number | null => (sonlu(v as number | null) ? (v as number) : null);
  return ham.flatMap((x): Satir[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const sehir = o.sehir;
    if (typeof sehir !== "number" || !Number.isInteger(sehir)) return [];
    return [{ sehir, talep: say(o.talep), uretim: say(o.uretim), stok: say(o.stok), firma: say(o.firma) }];
  });
}

/**
 * Bir ürünün şehirlere göre ayrıntısı (ürün çekmecesi, istek üzerine). Hafta değişince yenilenir. O hafta ayrıntı yoksa (sunucu 404: model önde) hata değil
 * "duraklatınca açılır" notu çıkar ve son alınan ayrıntı soluk gösterilir; başka bir hatada "alınamadı" yazar, panel çökmez.
 */
export function UrunAyrintisi({ runId, urun, ad, hafta, sehirAdlari, onKapat }: Props) {
  const d = useCekmece(runId, "urun", urun, hafta);
  const veri = d.durum === "hazir" ? d.veri : d.durum === "hata" ? null : (d.son ?? null);
  const soluk = d.durum !== "hazir";
  const satirlar = satirlarOf(veri);
  return (
    <section aria-label={t("tuketim.urun.baslik", { urun: ad })} className={styles.bolum} data-tuketim="urun">
      <h3 className={styles.baslik}>{t("tuketim.urun.baslik", { urun: ad })}</h3>
      {d.durum === "yukleniyor" ? <p className={styles.kucuk} role="status">{t("tuketim.urun.yukleniyor")}</p> : null}
      {d.durum === "yok" ? <p className={styles.kucuk} role="status">{t("tuketim.urun.yok_hafta")}</p> : null}
      {d.durum === "hata" ? <p className={styles.kucuk} role="alert">{t("tuketim.urun.yok")}</p> : null}
      {soluk && veri ? <p className={styles.kucuk}>{t("tuketim.urun.son_hafta", { n: veri.week })}</p> : null}
      {satirlar.length > 0 ? (
        <div className={soluk ? styles.solgun : undefined} data-soluk={soluk ? "evet" : "hayir"}>
          <Table
            caption={t("tuketim.urun.tablo")} columns="even5" minWidth="md" density="compact" align={["start", "end", "end", "end", "end"]}
            header={[t("tuketim.urun.kol_sehir"), t("tuketim.urun.kol_talep"), t("tuketim.urun.kol_uretim"), t("tuketim.urun.kol_stok"), t("tuketim.urun.kol_firma")]}
            rows={satirlar.map((s) => [cityDisplayName(sehirAdlari[s.sehir] ?? "", s.sehir), goster(s.talep, sayi), goster(s.uretim, sayi), goster(s.stok, sayi), goster(s.firma, sayi)])}
          />
        </div>
      ) : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" onClick={onKapat}>{t("tuketim.urun.kapat")}</Button>
      </div>
    </section>
  );
}
