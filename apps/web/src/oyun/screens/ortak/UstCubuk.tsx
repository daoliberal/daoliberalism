"use client";
import { KayitDugmesi } from "@/oyun/ui/KayitDugmesi";
import { useEffect, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import { useSpriteHatasi, useUrlBayragi } from "@/oyun/harita/gorunumDurumu";
import { istenenMod } from "@/oyun/harita/izoTercih";
import { useSpriteManifest } from "@/oyun/harita/useSpriteManifest";
import { useHashRoute, type OyunRoute } from "@/oyun/hooks/useHashRoute";
import type { useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";
import type { Registry, RunState } from "@/oyun/sim/types";
import { useRegistry } from "@/oyun/sim/useRegistry";
import { useRun } from "@/oyun/sim/useRun";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { degistirAc, degistirKapat, odakBekliyor, useDegistirAcik } from "@/oyun/screens/canli/degistirDurumu";
import { KararGunlugu } from "@/oyun/screens/canli/KararGunlugu";
import { sifirlaAc, sifirlaKapat } from "@/oyun/screens/canli/sifirlaDurumu";
import { DEGISTIR_ID } from "@/oyun/screens/canli/SaatCubugu";
import { SartOkuyucu, senaryoAdi } from "./SartOkuyucu";
import styles from "./UstCubuk.module.css";


export type Tercih = ReturnType<typeof useOyunTercihleri>;

function saatMetni(s: RunState): string {
  switch (s.status) {
    case "running": return t("ustcubuk.saat_akiyor", { n: s.speed });
    case "ended": return t("ustcubuk.saat_bitti");
    case "failed": return t("ustcubuk.saat_hata");
    case "ready":
    case "paused": return s.week === 0 ? t("ustcubuk.saat_hazir") : t("ustcubuk.saat_durdu");        // canlı sunucu hafta 0'da `paused` bildirir (kayıt kaynağı `ready`): ikisi de "Hazır"
  }
}

type Veri = { state: RunState | null; events: ReturnType<typeof useRun>["events"]; registry: Registry | null };
type Parca = { route: OyunRoute; /** Üst çubuk gibi ortak çizen bir üst bileşen koşu verisini bir kez abone olup verir; verilmezse parça kendisi abone olur. */ veri?: Veri; /** Canlı koşu kaynakta açıldı mı (açılmadan abone olunmaz: bilinmeyen kimlik hata verir). */ kosuHazir?: boolean };
const kosuKimligi = (route: OyunRoute): string | null => (route.name === "canli" || route.name === "sonuc" ? route.runId : null);

/** Koşu durumu, olayları ve kayıt defteri; `veri` verilmişse yeniden abone olunmaz. */
function useUstVeri(route: OyunRoute, kosuHazir: boolean, veri: Veri | undefined): Veri {
  const kendi = useRun(veri === undefined && kosuHazir ? kosuKimligi(route) : null);
  const kayit = useRegistry();
  return veri ?? { state: kendi.state, events: kendi.events, registry: kayit.registry };
}

/** Koşu çipleri: dünya adı, Şart, hafta, saat, senaryo. Kendi başına çizilebilir. */
export function UstCipler({ route, kosuHazir = true, veri }: Parca) {
  const runId = kosuKimligi(route);
  const { state, registry } = useUstVeri(route, kosuHazir, veri);
  const hasRun = runId !== null && state !== null;
  const senaryo = state === null ? t("ustcubuk.dunya_varsayilan") : senaryoAdi(state, registry);
  return (
    <ul className={styles.cipler}>
      <li className={styles.cip}>{hasRun && state.name !== "" ? state.name : t("ustcubuk.adsiz")}</li>
      {hasRun ? (
        <>
          <li className={styles.cip}>{t("ustcubuk.sart", { n: state.version })}</li>
          <li className={styles.cip}>{t("ustcubuk.hafta", { n: state.week, toplam: state.durationWeeks })}</li>
          <li className={styles.cip}>{saatMetni(state)}</li>
          <li className={styles.cip}>{t("ustcubuk.dunya", { ad: senaryo })}</li>
        </>
      ) : null}
    </ul>
  );
}

/** Tema ve hareket düğmeleri. */
export function TercihDugmeleri({ tercih }: { tercih: Tercih }) {
  // "Düşük performans" yalnız izometrik görünüm istenirken anlamlıdır (klasikte animasyon yok).
  const urlBayragi = useUrlBayragi();
  const spriteHatasi = useSpriteHatasi();
  const manifestHata = useSpriteManifest(false).durum === "hata";
  // Etkin mod: sprite/manifest hatasıyla sade görünüme düşülmüşse düğme de "Sade" gösterir.
  const izo = istenenMod({ tercih: tercih.gorunum, urlBayragi }) === "izo" && !spriteHatasi && !manifestHata;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={tercih.toggleTema}>
        {tercih.tema === "dark" ? t("ustcubuk.tema_acik") : t("ustcubuk.tema_koyu")}
      </Button>
      <Button variant="toggle" size="sm" pressed={tercih.azalt} onClick={tercih.toggleAzalt}>
        {tercih.azalt ? t("ustcubuk.hareket_azaltildi") : t("ustcubuk.hareket_azalt")}
      </Button>
      <Button variant="toggle" size="sm" pressed={izo} onClick={() => tercih.setGorunum(izo ? "klasik" : "izo")}>
        {izo ? t("ustcubuk.gorunum_sehir") : t("ustcubuk.gorunum_sade")}
      </Button>
      {izo ? (
        <Button variant="toggle" size="sm" pressed={tercih.dusukPerformans} onClick={tercih.toggleDusukPerformans}>
          {tercih.dusukPerformans ? t("ustcubuk.dusuk_performans_acik") : t("ustcubuk.dusuk_performans")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Ekran düğmeleri ve diyalogları (Şart, Karar günlüğü, Sonuç, Koşular, tercihler). Bir `menu` yuvasına taşınabilir.
 * "Şartı değiştir" yalnız Canlı Dünya'da ve koşu sürerken görünür (Canlı'da ikinci bir düğme yoktur); diyalog Canlı'dadır.
 */
export function UstMenu({ route, tercih, kosuHazir = true, veri }: Parca & { tercih: Tercih }) {
  const { go } = useHashRoute();
  const runId = kosuKimligi(route);
  const { state, events, registry } = useUstVeri(route, kosuHazir, veri);
  const [acik, setAcik] = useState<"sart" | "gunluk" | null>(null);
  const degistirAcik = useDegistirAcik();
  useEffect(() => {
    // Diyalog kapanınca odak bu düğmeye döner (düğme sonradan kurulduysa çizilince).
    if (degistirAcik || !odakBekliyor()) return;
    const el = document.getElementById(DEGISTIR_ID);
    if (el && !el.hasAttribute("disabled") && document.activeElement !== el) el.focus();
  });
  // Canlı Dünya dışına çıkınca açık "Şartı değiştir" diyaloğu kapanır (dönüşte kendiliğinden açılmaz).
  useEffect(() => {
    if (route.name !== "canli") {
      degistirKapat();
      sifirlaKapat();
    }
  }, [route.name]);
  const kapat = () => setAcik(null);
  const hasRun = runId !== null && state !== null;
  const bitti = state !== null && (state.status === "ended" || state.status === "failed");

  return (
    <>
      <nav className={styles.menu} aria-label={t("ustcubuk.menu")}>
        {hasRun && route.name !== "canli" ? (
          <Button variant="secondary" size="sm" onClick={() => go({ name: "canli", runId: runId })}>
            {t("ustcubuk.canli")}
          </Button>
        ) : null}
        {hasRun ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setAcik("sart")}>
              {t("ustcubuk.sart_dugme")}
            </Button>
            {route.name === "canli" && state.status !== "ended" && state.status !== "failed" ? (
              <Button id={DEGISTIR_ID} variant="primary" size="sm" disabled={state.computing} onClick={degistirAc}>
                {t("degistir.dugme")}
              </Button>
            ) : null}
            {route.name === "canli" ? (
              <Button variant="secondary" size="sm" onClick={sifirlaAc}>
                {t("canli.sifirla.baslik")}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setAcik("gunluk")}>
              {t("ustcubuk.gunluk")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => go({ name: "sonuc", runId: runId })}>
              {bitti ? t("ustcubuk.sonuc") : t("ustcubuk.ara_durum")}
            </Button>
          </>
        ) : null}
        <Button variant="secondary" size="sm" onClick={() => go({ name: "kosular" })}>
          {t("ustcubuk.kosular")}
        </Button>
        <KayitDugmesi />
        <TercihDugmeleri tercih={tercih} />
      </nav>
      {acik === "sart" && hasRun ? <SartOkuyucu state={state} onKapat={kapat} /> : null}
      {acik === "gunluk" ? (
        <Diyalog baslik={t("ustcubuk.gunluk")} onKapat={kapat}>
          {hasRun ? <KararGunlugu state={state} events={events} registry={registry} /> : null}
        </Diyalog>
      ) : null}
    </>
  );
}

/** Üst çubuk (Başlangıç dışındaki her ekranda): koşu çipleri ve menü yan yana. */
export function UstCubuk({ route, tercih, kosuHazir = true }: Parca & { tercih: Tercih }) {
  const veri = useUstVeri(route, kosuHazir, undefined);
  return (
    <header className={styles.ust}>
      <UstCipler route={route} veri={veri} />
      <UstMenu route={route} tercih={tercih} veri={veri} />
    </header>
  );
}
