"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t, type CopyKey } from "@/oyun/copy/t";
import type { DepolamaDurumu, KayitHizmetleri, KosuOzeti } from "@/oyun/tarayici/hizmetler";
import { ACIK_DEPO } from "@/oyun/yetenekler";
import { Banner } from "./Banner";
import { BantEylemleri } from "./BantEylemleri";
import { Diyalog } from "./Diyalog";
import styles from "./kayitPaneli.module.css";

const MB = 1024 * 1024;
const mb = (bayt: number): number => Math.round((bayt / MB) * 10) / 10;

const KALICI: Record<string, CopyKey> = {
  verildi: "kayit.kalici.verildi",
  verilmedi: "kayit.kalici.verilmedi",
  desteklenmiyor: "kayit.kalici.desteklenmiyor",
  hata: "kayit.kalici.hata",
};

/** Hata -> metin anahtari (kod `IceAktarmaHatasi.kod`; bilinmeyen kod ya da baska hata genel metne duser). */
function iceHatasi(e: unknown, sinir: number): string {
  const kod = typeof (e as { kod?: unknown } | null)?.kod === "string" ? (e as { kod: string }).kod : "";
  if (kod === "cok_buyuk") return t("kayit.ice.hata.cok_buyuk", { sinir });
  const anahtar = `kayit.ice.hata.${kod}` as CopyKey;
  return t(kod !== "" && anahtar !== "kayit.ice.hata.genel" && ANAHTARLAR.has(kod) ? anahtar : "kayit.ice.hata.genel");
}
const ANAHTARLAR = new Set(["json_gecersiz", "bicim_gecersiz", "surum_desteklenmiyor", "goruntu_iceriyor", "sema", "gunluk_sira_bitisik_degil", "paket_gecersiz", "kimlik_uretilemedi"]);

type Islem = { tur: "tamam" | "hata"; metin: string } | null;

/**
 * "Kayit ve depolama" paneli (tarayici kipi): depolama kullanimi, kalici depolama sonucu, kota uyarisi, kayitli oyunlar (ac, disa aktar, sil), kayit dosyasi
 * ice aktarma, Safari 7 gun bilgisi ve acik kod satiri. Veriyi yalniz `hizmetler` verir; panel kayit katmanini bilmez.
 */
export function KayitPaneli({ hizmetler, aktifKosuId, webkit, onKapat, onAc, indir }: {
  hizmetler: KayitHizmetleri;
  /** Su an oynanan koşu: silinemez ve "Ac" gosterilmez. */
  aktifKosuId: string | null;
  webkit: boolean;
  onKapat(): void;
  /** "Ac ve oynat": sayfa o kosunun rotasiyla (kurucu `#/canli`, DAO `#/dao`) yeniden yuklenir. */
  onAc(kosuId: string, tur: KosuOzeti["tur"]): void;
  indir(ad: string, metin: string): void;
}) {
  const uid = useId();
  const [depolama, setDepolama] = useState<DepolamaDurumu | null>(null);
  const [kosular, setKosular] = useState<KosuOzeti[] | "hata" | null>(null);
  const [silinecek, setSilinecek] = useState<string | null>(null);
  const [islem, setIslem] = useState<Islem>(null);
  const [dosya, setDosya] = useState<File | null>(null);
  const [ice, setIce] = useState<{ tur: "tamam"; kosuId: string; hafta: number; tur2: KosuOzeti["tur"] } | { tur: "hata"; metin: string } | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const canli = useRef(true);
  useEffect(() => {
    canli.current = true;
    return () => {
      canli.current = false;
    };
  }, []);

  const yukle = useCallback(async (): Promise<void> => {
    const [d, k] = await Promise.all([hizmetler.depolama().catch(() => null), hizmetler.kosular().catch(() => "hata" as const)]);
    if (!canli.current) return;
    setDepolama(d);
    setKosular(k);
  }, [hizmetler]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const disaAktar = async (k: KosuOzeti): Promise<void> => {
    setIslem(null);
    try {
      const d = await hizmetler.disaAktar(k.kosuId);
      indir(d.ad, d.metin);
      if (canli.current) {
        setIslem({ tur: "tamam", metin: t("kayit.kosu.disa_tamam") });
        void yukle();
      }
    } catch {
      if (canli.current) setIslem({ tur: "hata", metin: t("kayit.kosu.disa_hata") });
    }
  };
  const sil = async (kosuId: string): Promise<void> => {
    setIslem(null);
    try {
      await hizmetler.sil(kosuId);
    } catch {
      if (canli.current) setIslem({ tur: "hata", metin: t("kayit.kosu.sil_hata") });
    }
    if (canli.current) {
      setSilinecek(null);
      void yukle();
    }
  };
  const iceAktar = async (): Promise<void> => {
    if (dosya === null || mesgul) return;
    setMesgul(true);
    setIce(null);
    try {
      const r = await hizmetler.iceAktar(dosya);
      if (canli.current) {
        setIce({ tur: "tamam", kosuId: r.kosuId, hafta: r.hafta, tur2: r.tur });
        void yukle();
      }
    } catch (e) {
      if (canli.current) setIce({ tur: "hata", metin: iceHatasi(e, hizmetler.dosyaSiniriMB) });
    } finally {
      if (canli.current) setMesgul(false);
    }
  };

  const yuzde = depolama?.olcum ? Math.round(depolama.olcum.oran * 100) : 0;
  return (
    <Diyalog baslik={t("kayit.baslik")} kapatMetni={t("kayit.kapat")} kapatSonda onKapat={onKapat}>
      <div className={styles.kok}>
        <p className={styles.metin}>{t("kayit.bilgi")}</p>

        <section className={styles.bolum} aria-labelledby={`${uid}-dep`}>
          <h3 id={`${uid}-dep`} className={styles.altBaslik}>{t("kayit.depolama.baslik")}</h3>
          {depolama !== null ? (
            <>
              <p className={styles.metin}>
                {depolama.olcum !== null ? t("kayit.depolama.kullanim", { kullanim: mb(depolama.olcum.kullanim), kota: mb(depolama.olcum.kota), yuzde }) : t("kayit.depolama.bilinmiyor")}
              </p>
              {depolama.kotaUyarisi ? (
                <div role="alert">
                  <Banner tone="warn" asItem>{t("kayit.depolama.uyari", { yuzde })}</Banner>
                </div>
              ) : null}
              <p className={styles.metin}>{t(depolama.kalicilik !== null ? (KALICI[depolama.kalicilik.durum] ?? "kayit.kalici.bilinmiyor") : "kayit.kalici.bilinmiyor")}</p>
            </>
          ) : null}
          {webkit ? <Banner tone="warn" asItem>{t("kayit.safari")}</Banner> : <p className={styles.kucuk}>{t("kayit.safari")}</p>}
        </section>

        <section className={styles.bolum} aria-labelledby={`${uid}-kos`}>
          <h3 id={`${uid}-kos`} className={styles.altBaslik}>{t("kayit.kosular.baslik")}</h3>
          {kosular === "hata" ? <p className={styles.hata}>{t("kayit.kosular.yuklenemedi")}</p> : null}
          {Array.isArray(kosular) && kosular.length === 0 ? <p className={styles.kucuk}>{t("kayit.kosular.yok")}</p> : null}
          {Array.isArray(kosular) && kosular.length > 0 ? (
            <ul className={styles.liste}>
              {kosular.map((k) => {
                const aktif = k.aktif || k.kosuId === aktifKosuId;
                return (
                  <li key={k.kosuId} className={styles.satir}>
                    <p className={styles.metin}>{t("kayit.kosu.satir", { ad: k.ad, hafta: k.hafta })}</p>
                    <p className={styles.kucuk}>
                      {[
                        aktif ? t("kayit.kosu.aktif") : null,
                        k.kaynak === "ice_aktarma" ? t("kayit.kosu.ice_aktarilmis") : null,
                        k.disaAktarilmayanHafta > 0 ? t("kayit.kosu.disa_gerek", { hafta: k.disaAktarilmayanHafta }) : null,
                      ]
                        .filter((x): x is string => x !== null)
                        .join(", ")}
                    </p>
                    {aktif ? <p id={`${uid}-sil-${k.kosuId}`} className={styles.kucuk}>{t("kayit.kosu.sil_aktif")}</p> : null}
                    {silinecek === k.kosuId ? (
                      <div role="group" aria-label={t("kayit.kosu.sil_etiket", { ad: k.ad })}>
                        <p className={styles.metin}>{t("kayit.kosu.sil_onay", { ad: k.ad })}</p>
                        <div className={styles.dugmeler}>
                          <Button variant="primary" size="sm" onClick={() => void sil(k.kosuId)}>{t("kayit.kosu.sil_evet")}</Button>
                          <Button autoFocus variant="secondary" size="sm" onClick={() => setSilinecek(null)}>{t("kayit.kosu.vazgec")}</Button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.dugmeler}>
                        {aktif ? null : <Button variant="primary" size="sm" aria-label={t("kayit.kosu.ac_etiket", { ad: k.ad })} onClick={() => onAc(k.kosuId, k.tur)}>{t("kayit.kosu.ac")}</Button>}
                        <Button variant="secondary" size="sm" aria-label={t("kayit.kosu.disa_etiket", { ad: k.ad })} onClick={() => void disaAktar(k)}>{t("kayit.kosu.disa")}</Button>
                        <Button variant="secondary" size="sm" disabled={aktif} aria-describedby={aktif ? `${uid}-sil-${k.kosuId}` : undefined} aria-label={t("kayit.kosu.sil_etiket", { ad: k.ad })} onClick={() => setSilinecek(k.kosuId)}>{t("kayit.kosu.sil")}</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div role="status" aria-live="polite">
            {islem?.tur === "tamam" ? <p className={styles.metin}>{islem.metin}</p> : null}
          </div>
          {islem?.tur === "hata" ? <p role="alert" className={styles.hata}>{islem.metin}</p> : null}
        </section>

        <section className={styles.bolum} aria-labelledby={`${uid}-ice`}>
          <h3 id={`${uid}-ice`} className={styles.altBaslik}>{t("kayit.ice.baslik")}</h3>
          <p className={styles.kucuk}>{t("kayit.ice.bilgi")}</p>
          <Field kind="input" id={`${uid}-dosya`} label={t("kayit.ice.dosya")} labelSize="14" type="file" accept=".json,application/json" onChange={(e) => setDosya(e.target.files?.[0] ?? null)} />
          <div className={styles.dugmeler}>
            <Button variant="secondary" size="sm" disabled={dosya === null || mesgul} onClick={() => void iceAktar()}>{t("kayit.ice.dugme")}</Button>
          </div>
          <div role="status" aria-live="polite">
            {ice?.tur === "tamam" ? (
              <>
                <p className={styles.metin}>{t("kayit.ice.tamam", { hafta: ice.hafta })}</p>
                <div className={styles.dugmeler}>
                  <Button variant="primary" size="sm" onClick={() => onAc(ice.kosuId, ice.tur2)}>{t("kayit.ice.ac")}</Button>
                </div>
              </>
            ) : null}
          </div>
          {ice?.tur === "hata" ? <p role="alert" className={styles.hata}>{ice.metin}</p> : null}
        </section>

        <p className={styles.kucuk}>
          {t("acikkod.satir")}
          <BantEylemleri>
            <a href={ACIK_DEPO} target="_blank" rel="noopener noreferrer">{t("acikkod.baglanti")}</a>
          </BantEylemleri>
        </p>
      </div>
    </Diyalog>
  );
}
