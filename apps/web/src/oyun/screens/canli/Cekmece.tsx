"use client";
import { useEffect, useState } from "react";
import { Table } from "@/components/primitives/Table";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { SIM_NOT_FOUND, SimUnsupported } from "@/oyun/sim/SimSource";
import type { DrawerData } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { goster, oran1, ondalik } from "./bicim";
import { ALANLAR, alanMetni } from "./cekmeceAlanlari";
import styles from "./Cekmece.module.css";

type Durum = { anahtar: string; durum: "yukleniyor" | "hazir" | "hata" | "yok"; veri: DrawerData | null };
type Kayit = Record<string, unknown>;

const liste = (v: unknown): Kayit[] => (Array.isArray(v) ? v.filter((x): x is Kayit => typeof x === "object" && x !== null) : []);
const metin = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const sayiMi = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type Props = {
  runId: string;
  /** Çekmecenin istendiği hafta (yayımlanmış); model ilerlese de değişmez. */
  hafta: number;
  kind: string;
  refId: string;
  sehirAdlari: string[];
  onAc(kind: string, ref: string): void;
  onKapat(): void;
};

/**
 * Ayrıntı çekmecesi (S5): `drawer/{kind}/{ref}?week=`; yalnız okur, koşuyu ve haftayı değiştirmez. Eski hafta notu, alanlar ve bağlantılar.
 * Bayat yanıtlar (kullanıcı başka çekmeceye geçti) yok sayılır.
 */
export function Cekmece({ runId, hafta, kind, refId, sehirAdlari, onAc, onKapat }: Props) {
  const source = useSimSource();
  const anahtar = `${runId}|${kind}|${refId}|${hafta}`;
  const [s, setS] = useState<Durum>({ anahtar: "", durum: "yukleniyor", veri: null });

  useEffect(() => {
    let canli = true;
    if (!source.drawer) return;
    source.drawer(runId, kind, refId, hafta).then(
      (veri) => canli && setS({ anahtar, durum: "hazir", veri }),
      (e: unknown) => canli && setS({ anahtar, durum: kind === "urun" && e instanceof SimUnsupported && e.message === SIM_NOT_FOUND ? "yok" : "hata", veri: null }),
    );
    return () => {
      canli = false;
    };
  }, [source, anahtar, runId, kind, refId, hafta]);

  // Anahtar değişince (başka çekmece, başka hafta) önceki yanıt geçersizdir: yükleniyor; kaynakta çekmece yoksa hata.
  const guncel: Durum = !source.drawer ? { anahtar, durum: "hata", veri: null } : s.anahtar === anahtar ? s : { anahtar, durum: "yukleniyor", veri: null };
  const veri = guncel.veri;
  const sehirAd = (i: unknown): string => (sayiMi(i) ? cityDisplayName(sehirAdlari[i] ?? "", i) : "");
  const baglanti = (anah: string, ad: string, git: () => void) => (
    <li key={anah}>
      <button type="button" className={styles.baglanti} onClick={git}>
        {ad}
      </button>
    </li>
  );

  const alanlar = veri ? (ALANLAR[veri.kind] ?? []) : [];
  const satirlar = veri ? alanlar.flatMap((a) => {
    const m = alanMetni(a.bicim, veri.fields[a.key]);
    return m === null ? [] : [{ key: a.key, etiket: t(`cekmece.alan.${a.key}` as CopyKey), m }];
  }) : [];
  const f = veri?.fields ?? {};
  const girdi = liste(f.inputs);
  const kullanan = liste(f.users);
  const sehirler = liste(f.cities);
  const firmalar = liste(f.firm_refs);
  const enCok = liste(f.top_sectors);
  const sehirNo = veri?.kind === "firm" && sayiMi(f.city) ? f.city : null;
  const lonca = veri?.kind === "firm" ? metin(f.lonca) : null;
  // Şehir çekmecesi sektörleri çalışan, lonca çekmecesi firma sayısıyla sıralar; sunucunun göndermediği sayı yazılmaz.
  const enCokCalisan = veri?.kind === "city";
  const miktarli = (ad: string, qty: unknown): string => (sayiMi(qty) ? t("cekmece.baglanti_miktar", { ad, n: ondalik(qty % 1 === 0 ? 0 : 2)(qty) }) : ad);
  const enCokMetin = (g: Kayit): string => {
    const ad = metin(g.label) ?? String(g.sector);
    if (enCokCalisan) return sayiMi(g.workers) ? t("cekmece.sektor_calisan", { ad, n: g.workers }) : ad;
    return sayiMi(g.firms) ? t("cekmece.sektor_satir", { ad, n: g.firms }) : ad;
  };
  const baglantiVar = girdi.length + kullanan.length + firmalar.length + enCok.length > 0 || sehirNo !== null || lonca !== null;

  return (
    <Diyalog baslik={veri?.title ?? t("cekmece.baslik")} onKapat={onKapat}>
      <div className={styles.govde} data-cekmece={kind}>
        {guncel.durum === "yukleniyor" ? <p className={styles.not} role="status">{t("cekmece.yukleniyor")}</p> : null}
        {guncel.durum === "yok" ? <p className={styles.not} role="status">{t("tuketim.urun.yok_hafta")}</p> : null}
        {guncel.durum === "hata" ? <p className={styles.not} role="alert">{t("cekmece.yuklenemedi")}</p> : null}
        {veri ? (
          <>
            {veri.stale ? <p className={styles.eski} role="status">{t("cekmece.eski_hafta", { n: veri.week })}</p> : <p className={styles.not}>{t("cekmece.hafta", { n: veri.week })}</p>}
            {veri.note_key ? <p className={styles.not}>{t(veri.note_key)}</p> : null}
            {satirlar.length > 0 ? (
              <dl className={styles.alanlar}>
                {satirlar.map((r) => (
                  <div key={r.key} className={styles.alan} data-alan={r.key}>
                    <dt>{r.etiket}</dt>
                    <dd>{r.m}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {sehirler.length > 0 ? (
              <Table
                caption={t("cekmece.sehirler")} columns="even4" minWidth="sm" density="compact" align={["start", "end", "end", "end"]}
                header={[t("cekmece.kol_sehir"), t("cekmece.kol_firma"), t("cekmece.kol_fiyat"), t("cekmece.kol_kitlik")]}
                rows={sehirler.map((c) => [sehirAd(c.city), goster(sayiMi(c.firms) ? c.firms : null, ondalik(0)), goster(sayiMi(c.price) ? c.price : null, ondalik(2)), goster(sayiMi(c.shortage) ? c.shortage : null, oran1)])}
              />
            ) : null}
            {baglantiVar ? (
              <div className={styles.baglantilar}>
                {girdi.length > 0 ? <h3 className={styles.altBaslik}>{t("cekmece.girdi")}</h3> : null}
                <ul className={styles.liste}>{girdi.flatMap((g) => (metin(g.from) ? [baglanti(`g-${g.from}`, miktarli(metin(g.label) ?? String(g.from), g.qty), () => onAc("sector", String(g.from)))] : []))}</ul>
                {kullanan.length > 0 ? <h3 className={styles.altBaslik}>{t("cekmece.kullanan")}</h3> : null}
                <ul className={styles.liste}>{kullanan.flatMap((g) => (metin(g.to) ? [baglanti(`k-${g.to}`, miktarli(metin(g.label) ?? String(g.to), g.qty), () => onAc("sector", String(g.to)))] : []))}</ul>
                {enCok.length > 0 ? <h3 className={styles.altBaslik}>{t(enCokCalisan ? "cekmece.en_cok_calisan" : "cekmece.en_cok_sektor")}</h3> : null}
                <ul className={styles.liste}>{enCok.flatMap((g) => (metin(g.sector) ? [baglanti(`e-${g.sector}`, enCokMetin(g), () => onAc("sector", String(g.sector)))] : []))}</ul>
                {firmalar.length > 0 ? <h3 className={styles.altBaslik}>{t("cekmece.firmalar")}</h3> : null}
                <ul className={styles.liste}>{firmalar.flatMap((g) => (metin(g.ref) ? [baglanti(`f-${g.ref}`, sayiMi(g.workers) ? t("cekmece.firma_satir", { sehir: sehirAd(g.city), n: g.workers }) : sehirAd(g.city), () => onAc("firm", String(g.ref)))] : []))}</ul>
                <ul className={styles.liste}>
                  {sehirNo !== null ? baglanti("sehir", t("cekmece.sehir_baglanti", { ad: sehirAd(sehirNo) }), () => onAc("city", String(sehirNo))) : null}
                  {lonca ? baglanti("lonca", t("cekmece.lonca_baglanti"), () => onAc("lonca", lonca)) : null}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Diyalog>
  );
}
