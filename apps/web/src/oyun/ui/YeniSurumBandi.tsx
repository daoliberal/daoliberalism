"use client";
import { Button } from "@/components/primitives/Button";
import { t } from "@/oyun/copy/t";
import type { YeniSurumDurumu } from "@/oyun/tarayici/swKayit";
import { Banner } from "./Banner";
import stil from "./yeniSurum.module.css";

/**
 * B7/B8: "yeni surum hazir" bandi. Surum KENDILIGINDEN uygulanmaz: kullanici onaylayinca once oyun kaydi tamamlanir, sonra sayfa yenilenir.
 * Durum "yok" iken hicbir sey cizilmez. "Sonra" ile bu oturumda gizlenir; `sonra` DURUMU KOPYA DEGIL ust bilesendedir (OyunApp): bant yuva/sabit sutun arasinda
 * yeniden kuruldugunda (B10 Y-5) kapatma korunur.
 */
export function YeniSurumBandi({ durum, onayla, sonra, onSonra }: { durum: YeniSurumDurumu; onayla(): void; sonra: boolean; onSonra(): void }) {
  if (durum === "yok" || (durum === "hazir" && sonra)) return null;
  const mesgul = durum === "kaydediliyor" || durum === "uygulaniyor";
  return (
    <div className={stil.kok}>
      <Banner tone={durum === "hata" ? "warn" : "neutral"}>
        {durum === "hazir" ? t("tarayici.surum.hazir") : null}
        {durum === "kaydediliyor" ? t("tarayici.surum.kaydediliyor") : null}
        {durum === "uygulaniyor" ? t("tarayici.surum.uygulaniyor") : null}
        {durum === "hata" ? t("tarayici.surum.hata") : null}
        <Button variant="secondary" onClick={onayla} disabled={mesgul}>
          {t("tarayici.surum.uygula")}
        </Button>
        {durum === "hazir" ? (
          <Button variant="secondary" onClick={onSonra}>
            {t("tarayici.surum.sonra")}
          </Button>
        ) : null}
      </Banner>
    </div>
  );
}
