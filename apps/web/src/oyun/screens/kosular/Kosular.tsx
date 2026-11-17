"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { Hesaplaniyor } from "@/oyun/screens/canli/Hesaplaniyor";
import { kurucuTaslagiYaz } from "@/oyun/screens/kurucu/useKurucuTaslak";
import { abAdayiYaz, sonKosuOku } from "@/oyun/sim/kosuBaglami";
import { degistirKutuphane, exportRuns, importRuns, kayitSorunuOku, loadLibrary, type ImportResult, type SavedRun } from "@/oyun/sim/library";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunHandle } from "@/oyun/sim/types";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import { Banner } from "@/oyun/ui/Banner";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { CatallanmaAgaci } from "./CatallanmaAgaci";
import { DisaIceAktar } from "./DisaIceAktar";
import { acmaHatasi, kopyaTaslagi, yenidenKurmaTarifi } from "./kosularMantik";
import { KosuKarti } from "./KosuKarti";
import styles from "./Kosular.module.css";

/**
 * Koşular: kütüphane (tarif + ad, `localStorage`), her koşunun kendiliğinden kaydı (otomatikKayit.ts), kart eylemleri, çatallanma ağacı, dışa/içe aktarma.
 * "Aç" canlıda tarifi sunucuda hızlı yeniden kurar (koşu hâlâ sunucudaysa onu açar), kayıtta tarif kimliğiyle açar.
 */
export function Kosular() {
  const source = useSimSource();
  const { go } = useHashRoute();
  const { capabilities } = useSourceInfo();
  const [lib, setLib] = useState(() => loadLibrary());
  const [acik, setAcik] = useState<RunHandle[] | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<CopyKey | null>(null);
  const [silinecek, setSilinecek] = useState<SavedRun | null>(null);
  const [kapatilacak, setKapatilacak] = useState<RunHandle | null>(null);
  /** Açık koşu listesini yeniden çeker (Aç/Kapat sonrası). */
  const [yenile, setYenile] = useState(0);
  /** Eşzamansız eylemler (Aç) en güncel kütüphaneyi görsün. */
  const libRef = useRef(lib);
  useEffect(() => {
    libRef.current = lib;
  }, [lib]);
  const [disa, setDisa] = useState<{ metin: string; hepsi: boolean } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const sonKosu = sonKosuOku();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Açık koşular: canlıda sunucunun listesi; kayıt kaynağında yalnız en son bakılan koşu.
  useEffect(() => {
    let live = true;
    const done = (l: RunHandle[]): void => {
      if (live) setAcik(l);
    };
    if (typeof source.listRuns === "function") source.listRuns().then(done, () => done([]));
    else if (sonKosu !== null) source.open(sonKosu).then((h) => done(h ? [h] : []), () => done([]));
    else done([]);
    return () => {
      live = false;
    };
  }, [source, sonKosu, yenile]);

  /** Kütüphaneye her yazma `degistirKutuphane`'den geçer (otomatik kayıtla aynı tek yol): depolamadaki en güncel liste üzerinde işlenir, eşzamansız Aç ile yarışmaz. */
  const degistir = useCallback((f: (runs: SavedRun[]) => SavedRun[]): void => {
    libRef.current = degistirKutuphane(f);
    setLib(libRef.current);
  }, []);

  /** Koşuyu açar (canlıda yeniden kurar); hata nedenli metin olur, sessiz başarısızlık yok. Açılan koşu kimliği döner. */
  const ac = async (run: SavedRun): Promise<string | null> => {
    if (busy.current) return null;
    busy.current = true;
    setBekliyor(true);
    setHata(null);
    try {
      const h = await source.open(run.id, source.kind === "live" ? yenidenKurmaTarifi(run) : undefined);
      if (!alive.current) return null;
      if (h === null) {
        setHata("kosular.ac.kayit_yok");
        return null;
      }
      // Yeniden kurulduysa (sunucu eski kimliği tanımıyordu) girdi yeni kimliğe taşınır, çocukların üst koşusu da: sonraki Aç önce bu kimliği dener.
      if (h.runId !== run.id && !libRef.current.runs.some((r) => r.id === h.runId)) {
        degistir((runs) => runs.map((r) => (r.id === run.id ? { ...r, id: h.runId } : r.parentId === run.id ? { ...r, parentId: h.runId } : r)));
      }
      setYenile((n) => n + 1);
      return h.runId;
    } catch (e) {
      if (alive.current) setHata(acmaHatasi(e));
      return null;
    } finally {
      busy.current = false;
      if (alive.current) setBekliyor(false);
    }
  };

  const karsilastirNeden = (run: SavedRun): CopyKey | null => {
    if (source.kind === "replay") return "sonuc.ab.yok_kayit";
    if (!(capabilities.jobs && typeof source.startJob === "function" && typeof source.listRuns === "function")) return "sonuc.is.yok_yetenek";
    if (sonKosu === null) return "kosular.karsilastir.yok_a";
    if (run.id === sonKosu) return "kosular.karsilastir.ayni";
    return null;
  };

  const ice = (metin: string): ImportResult => {
    const r = importRuns(metin, libRef.current.runs);
    if (r.ok) degistir((runs) => [...runs, ...r.runs]);
    return r;
  };

  const adlar = new Set((acik ?? []).map((h) => h.runId));
  return (
    <div className={styles.sayfa}>
      <h2 className={styles.baslik}>{t("kosular.baslik")}</h2>
      <p className={styles.kucuk}>{t("kosular.bilgi")}</p>
      {lib.available && kayitSorunuOku() !== "depolama" ? null : <Banner tone="neutral">{t("kosular.depolama_yok")}</Banner>}
      {kayitSorunuOku() === "buyuk" ? <Banner tone="neutral">{t("kosular.kayit_buyuk")}</Banner> : null}

      <section className={styles.panel} aria-labelledby="kosular-acik-baslik">
        <h3 id="kosular-acik-baslik" className={styles.altBaslik}>{t("kosular.acik.baslik")}</h3>
        {acik !== null && acik.length === 0 ? <p className={styles.kucuk}>{t("kosular.acik.yok")}</p> : null}
        {acik !== null && acik.length > 0 ? (
          <ul className={styles.acikListe}>
            {acik.map((h) => (
              <li key={h.runId} className={styles.acikSatir}>
                <span className={styles.metin}>{t("kosular.acik.satir", { ad: h.state.name !== "" ? h.state.name : t("ustcubuk.adsiz"), n: h.state.week, toplam: h.state.durationWeeks })}</span>
                {h.state.mode === "dao" ? (
                  <Button variant="primary" size="sm" aria-label={t("kosular.eylem", { eylem: t("kosular.dao_ac"), ad: h.state.name !== "" ? h.state.name : t("ustcubuk.adsiz") })} onClick={() => go({ name: "dao", runId: h.runId })}>
                    {t("kosular.dao_ac")}
                  </Button>
                ) : null}
                {typeof source.discard === "function" ? (
                  <Button variant="secondary" size="sm" aria-label={t("kosular.eylem", { eylem: t("kosular.kapat"), ad: h.state.name !== "" ? h.state.name : t("ustcubuk.adsiz") })} onClick={() => setKapatilacak(h)}>
                    {t("kosular.kapat")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {hata !== null ? <div role="alert" className={styles.hata}>{t(hata)}</div> : null}
      <h3 id="kosular-kayitli-baslik" className={styles.altBaslik}>{t("kosular.kayitli.baslik")}</h3>
      {lib.runs.length === 0 ? (
        <div className={`${styles.panel} ${styles.bos}`}>{t("kosular.kayitli.yok")}</div>
      ) : (
        <ul className={styles.liste} aria-label={t("kosular.kart.liste")}>
          {[...lib.runs].reverse().map((r) => (
            <KosuKarti
              key={r.id} run={r} aktif={adlar.has(r.id)} bekliyor={bekliyor} karsilastirNeden={karsilastirNeden(r)}
              onAc={() => void ac(r).then((id) => id !== null && go({ name: "canli", runId: id }))}
              onAd={(ad) => degistir((runs) => runs.map((x) => (x.id === r.id ? { ...x, name: ad } : x)))}
              onKarsilastir={() => void ac(r).then((id) => {
                if (id === null || sonKosu === null) return;
                abAdayiYaz(id);
                go({ name: "sonuc", runId: sonKosu });
              })}
              onKopya={() => {
                kurucuTaslagiYaz(kopyaTaslagi(r));
                go({ name: "kurucu", adim: "2" });
              }}
              onDisa={() => setDisa({ metin: exportRuns([r]), hepsi: false })}
              onSil={() => setSilinecek(r)}
            />
          ))}
        </ul>
      )}

      <div className={styles.izgara}>
        <CatallanmaAgaci runs={lib.runs} />
        <DisaIceAktar disa={disa} onHepsi={() => setDisa({ metin: exportRuns(lib.runs), hepsi: true })} onIce={ice} />
      </div>

      {bekliyor && source.kind === "live" ? <Hesaplaniyor yeniden /> : null}
      {kapatilacak !== null ? (
        <Diyalog baslik={t("kosular.kapat.baslik")} kapatMetni={t("kosular.vazgec")} kapatSonda onKapat={() => setKapatilacak(null)}>
          <Stack gap="10" align="start">
            <p className={styles.metin}>{t("kosular.kapat.metin", { ad: kapatilacak.state.name !== "" ? kapatilacak.state.name : t("ustcubuk.adsiz") })}</p>
            <Button
              variant="primary" size="sm"
              onClick={() => {
                const id = kapatilacak.runId;
                setKapatilacak(null);
                source.discard?.(id).then(
                  () => alive.current && setYenile((n) => n + 1),
                  () => alive.current && setHata("kosular.kapat.hata"),
                );
              }}
            >
              {t("kosular.kapat")}
            </Button>
          </Stack>
        </Diyalog>
      ) : null}
      {silinecek !== null ? (
        <Diyalog baslik={t("kosular.sil.baslik")} kapatMetni={t("kosular.vazgec")} kapatSonda onKapat={() => setSilinecek(null)}>
          <Stack gap="10" align="start">
            <p className={styles.metin}>{t("kosular.sil.metin", { ad: silinecek.name })}</p>
            <Button
              variant="primary" size="sm"
              onClick={() => {
                const id = silinecek.id;
                degistir((runs) => runs.filter((x) => x.id !== id));
                setDisa(null);
                setSilinecek(null);
              }}
            >
              {t("kosular.sil")}
            </Button>
          </Stack>
        </Diyalog>
      ) : null}
    </div>
  );
}
