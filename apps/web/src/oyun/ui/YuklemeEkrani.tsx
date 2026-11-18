"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import type { AcilisDurumu } from "@/oyun/tarayici/kaynak";
import { acilisSecimi, sureAraligi } from "@/oyun/tarayici/acilisEslemesi";
import type { SureTahmini } from "@/oyun/tarayici/kayit/siniflandirma";
import { ASAMALAR, type YuklemeHatasiKodu } from "@/oyun/tarayici/protokol";
import { dosyaIndir } from "./indir";
import stil from "./yukleme.module.css";

const MB = 1024 * 1024;

/** Toplam ilerleme 0..1: asama sirasi + asama ici oran (asgari ekran; B8'de gelistirilir). */
export function toplamOran(asama: (typeof ASAMALAR)[number], oran: number | null): number {
  const i = ASAMALAR.indexOf(asama);
  return Math.min(1, (i + (oran ?? 0)) / ASAMALAR.length);
}

const HATA_ANAHTARI: Record<YuklemeHatasiKodu, CopyKey> = {
  manifest_okunamadi: "tarayici.hata.manifest_okunamadi",
  manifest_gecersiz: "tarayici.hata.manifest_gecersiz",
  paket_indirilemedi: "tarayici.hata.paket_indirilemedi",
  sha_uyusmuyor: "tarayici.hata.sha_uyusmuyor",
  sha_desteklenmiyor: "tarayici.hata.sha_desteklenmiyor",
  pyodide_yuklenemedi: "tarayici.hata.pyodide_yuklenemedi",
  pyodide_surumu_uyusmuyor: "tarayici.hata.pyodide_surumu_uyusmuyor",
  paket_acilamadi: "tarayici.hata.paket_acilamadi",
  cekirdek_kurulamadi: "tarayici.hata.cekirdek_kurulamadi",
  model_anahtari_uyusmuyor: "tarayici.hata.model_anahtari_uyusmuyor",
  worker_baslamadi: "tarayici.hata.worker_baslamadi",
  iptal_edildi: "tarayici.hata.iptal_edildi",
};

export function hataAnahtari(kod: string): CopyKey {
  return (HATA_ANAHTARI as Record<string, CopyKey | undefined>)[kod] ?? "tarayici.hata.genel";
}

/** Tarayici kaynagi hazirlanirken: asama + ilerleme, kayit secimi ya da hata. */
export function YuklemeEkrani({ durum, indir = dosyaIndir }: { durum: AcilisDurumu | null; /** Dosya indirme (testte yerine konur). */ indir?: (ad: string, metin: string) => unknown }) {
  if (durum !== null && durum.tur === "secim") {
    return (
      <section className={stil.kok} aria-labelledby="yukleme-baslik">
        <Stack gap="10" align="start">
          <h2 id="yukleme-baslik">{t("tarayici.secim.baslik")}</h2>
          <p>{t("tarayici.secim.ozet", { hafta: durum.hafta })}</p>
          <Stack gap="10" align="start">
            <Button variant="primary" onClick={() => durum.devam()}>
              {t("tarayici.secim.devam")}
            </Button>
            <Button variant="secondary" onClick={() => durum.yeni()}>
              {t("tarayici.secim.yeni")}
            </Button>
          </Stack>
        </Stack>
      </section>
    );
  }
  if (durum !== null && durum.tur === "devam_olmadi") return <AcilisSecimiEkrani durum={durum} indir={indir} />;
  if (durum !== null && durum.tur === "surum_yukleniyor") {
    return (
      <section className={stil.kok} aria-labelledby="yukleme-baslik">
        <Stack gap="10" align="start">
          <h2 id="yukleme-baslik">{t(durum.neden === "acma" ? "tarayici.acma_yukleniyor.baslik" : "tarayici.surum_yukleniyor.baslik")}</h2>
          <p role="status" aria-live="polite">{t(durum.neden === "acma" ? "tarayici.acma_yukleniyor.bilgi" : "tarayici.surum_yukleniyor.bilgi")}</p>
          <progress className={stil.cubuk} aria-label={t("tarayici.ilerleme_etiket")} />
        </Stack>
      </section>
    );
  }
  if (durum !== null && durum.tur === "baska_sekme") {
    return (
      <section className={stil.kok} aria-labelledby="yukleme-baslik">
        <Stack gap="10" align="start">
          <h2 id="yukleme-baslik">{t("tarayici.baska_sekme.baslik")}</h2>
          <p>{t("tarayici.baska_sekme.bilgi")}</p>
          <Button variant="primary" onClick={() => durum.devral()}>
            {t("tarayici.baska_sekme.devral")}
          </Button>
        </Stack>
      </section>
    );
  }
  const devam = durum !== null && durum.tur === "devam";
  const oran = durum === null ? 0 : durum.tur === "yukleme" ? toplamOran(durum.asama, durum.oran) : devam && durum.hedef ? Math.min(1, durum.hafta / Math.max(1, durum.hedef)) : 0;
  const asama = durum !== null && durum.tur === "yukleme" ? durum.asama : "manifest";
  return (
    <section className={stil.kok} aria-labelledby="yukleme-baslik">
      <Stack gap="10" align="start">
        <h2 id="yukleme-baslik">{devam ? t("tarayici.devam.baslik") : t("tarayici.baslik")}</h2>
        <p role="status" aria-live="polite">
          {devam
            ? durum.hedef === null
              ? t("tarayici.devam.sureli")
              : t("tarayici.devam.ilerleme", { hafta: durum.hafta, hedef: durum.hedef })
            : t(`tarayici.asama.${asama}`)}
        </p>
        <progress className={stil.cubuk} max={1} value={oran} aria-label={t("tarayici.ilerleme_etiket")} />
        {durum !== null && durum.tur === "yukleme" && durum.asama === "indirme" && durum.alinan !== undefined && durum.toplam ? (
          <p className={stil.ayrinti}>{t("tarayici.indirme_ayrinti", { alinan: (durum.alinan / MB).toFixed(1), toplam: (durum.toplam / MB).toFixed(1) })}</p>
        ) : null}
        {devam ? (durum.hedef === null ? null : <p className={stil.ayrinti}>{t("tarayici.devam.sureli")}</p>) : <p className={stil.ayrinti}>{t("tarayici.bilgi")}</p>}
        {devam && durum.tahmini ? <p className={stil.ayrinti}>{tahminMetni(durum.tahmini)}</p> : null}
        {devam && durum.uzun ? <p className={stil.ayrinti}>{t(durum.kaynak === "tarif" ? "tarayici.devam.uzun_tarif" : "tarayici.devam.uzun")}</p> : null}
        {devam && durum.iptal ? (
          <>
            <Button variant="secondary" onClick={() => durum.iptal?.()}>
              {t("tarayici.devam.iptal")}
            </Button>
            <p className={stil.ayrinti}>{t("tarayici.devam.iptal_bilgi")}</p>
          </>
        ) : null}
      </Stack>
    </section>
  );
}

/** Yukleme hatasi: aciklama + yeniden dene. */
export function YuklemeHatasiEkrani({ kod, yeniden }: { kod: string; yeniden(): void }) {
  return (
    <section className={stil.kok} aria-labelledby="yukleme-baslik">
      <Stack gap="10" align="start">
        <h2 id="yukleme-baslik">{t("tarayici.hata.baslik")}</h2>
        <p role="alert">{t(hataAnahtari(kod))}</p>
        <Button variant="primary" onClick={yeniden}>
          {t("durum.yeniden")}
        </Button>
      </Stack>
    </section>
  );
}

/** Oyun motoru bu sekmede artik calismiyor: baska sekme devraldi ya da Worker durdu. Kayit guvende; yeniden yukleme kayittan devam eder. */
export function MotorEkrani({ neden, yenidenYukle }: { neden: "devredildi" | "motor_durdu"; yenidenYukle(): void }) {
  return (
    <section className={stil.kok} aria-labelledby="yukleme-baslik">
      <Stack gap="10" align="start">
        <h2 id="yukleme-baslik">{t(`tarayici.${neden}.baslik`)}</h2>
        <p role="alert">{t(`tarayici.${neden}.bilgi`)}</p>
        <Button variant="primary" onClick={yenidenYukle}>
          {t("tarayici.yeniden_yukle")}
        </Button>
      </Stack>
    </section>
  );
}

function tahminMetni(tahmini: SureTahmini): string {
  const a = sureAraligi(tahmini);
  return t("tarayici.devam.tahmin", { enaz: t(a.enaz, { n: a.enazDeger }), encok: t(a.encok, { n: a.encokDeger }) });
}

/** Kayit acilamadi: sonucun turune gore anlasilir metin ve secenekler (baştan oynat + tahmini sure, dışa aktar, sil, yeni oyun, yeniden yukle). */
function AcilisSecimiEkrani({ durum, indir }: { durum: Extract<AcilisDurumu, { tur: "devam_olmadi" }>; indir: (ad: string, metin: string) => unknown }) {
  const secim = acilisSecimi(durum.sonuc);
  const [onay, setOnay] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [bilgi, setBilgi] = useState<{ tur: "tamam" | "hata"; metin: string } | null>(null);
  const var_ = (a: (typeof secim.secenekler)[number]): boolean => secim.secenekler.includes(a);
  // Ö6: ilerleme ekrani secim ekranina donusurken baslik odak alir (ekran okuyucu yeni ekrani duyurur).
  const baslik = useRef<HTMLHeadingElement>(null);
  useEffect(() => baslik.current?.focus(), []);


  const disaAktar = async (): Promise<void> => {
    setMesgul(true);
    setBilgi(null);
    try {
      const d = await durum.disaAktar();
      indir(d.ad, d.metin);
      setBilgi({ tur: "tamam", metin: t("acilis.disa_tamam") });
    } catch {
      setBilgi({ tur: "hata", metin: t("acilis.disa_hata") });
    } finally {
      setMesgul(false);
    }
  };
  const sil = async (): Promise<void> => {
    setMesgul(true);
    setBilgi(null);
    try {
      await durum.sil();
    } catch {
      setBilgi({ tur: "hata", metin: t("acilis.sil_hata") });
      setOnay(false);
    } finally {
      setMesgul(false);
    }
  };

  return (
    <section className={stil.kok} aria-labelledby="yukleme-baslik">
      <Stack gap="10" align="start">
        <h2 id="yukleme-baslik" ref={baslik} tabIndex={-1}>{t(secim.baslik)}</h2>
        <p>{t(secim.bilgi, secim.bilgiParam)}</p>
        {secim.tahmini ? <p className={stil.ayrinti}>{t("acilis.tahmin", { hafta: secim.tahmini.hafta, enaz: t(sureAraligi(secim.tahmini).enaz, { n: sureAraligi(secim.tahmini).enazDeger }), encok: t(sureAraligi(secim.tahmini).encok, { n: sureAraligi(secim.tahmini).encokDeger }) })}</p> : null}
        <Stack gap="10" align="start">
          {var_("tariften_oynat") ? (
            <Button variant="primary" disabled={mesgul} onClick={() => durum.tariftenOynat()}>
              {t("acilis.dugme.tariften")}
            </Button>
          ) : null}
          {var_("yeniden_yukle") ? (
            <Button variant="primary" disabled={mesgul} onClick={() => durum.yenidenYukle()}>
              {t("tarayici.yeniden_yukle")}
            </Button>
          ) : null}
          {var_("disa_aktar") ? (
            <Button variant="secondary" disabled={mesgul} onClick={() => void disaAktar()}>
              {t("acilis.dugme.disa")}
            </Button>
          ) : null}
          {var_("sil") && !onay ? (
            <Button variant="secondary" disabled={mesgul} onClick={() => setOnay(true)}>
              {t("acilis.dugme.sil")}
            </Button>
          ) : null}
          {var_("sil") && onay ? (
            <div role="group" aria-label={t("acilis.dugme.sil")}>
              <Stack gap="10" align="start">
                <p>{t("acilis.sil_onay")}</p>
                <Button variant="primary" disabled={mesgul} onClick={() => void sil()}>
                  {t("acilis.sil_evet")}
                </Button>
                <Button autoFocus variant="secondary" disabled={mesgul} onClick={() => setOnay(false)}>
                  {t("acilis.sil_vazgec")}
                </Button>
              </Stack>
            </div>
          ) : null}
          {var_("yeni") ? (
            <Button variant={var_("tariften_oynat") || var_("yeniden_yukle") ? "secondary" : "primary"} disabled={mesgul} onClick={() => durum.yeni()}>
              {t("tarayici.secim.yeni")}
            </Button>
          ) : null}
        </Stack>
        <div role="status" aria-live="polite">
          {bilgi?.tur === "tamam" ? <p>{bilgi.metin}</p> : null}
        </div>
        {bilgi?.tur === "hata" ? <p role="alert">{bilgi.metin}</p> : null}
      </Stack>
    </section>
  );
}
