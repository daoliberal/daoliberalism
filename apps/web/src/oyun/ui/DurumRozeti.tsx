"use client";
import { t } from "@/oyun/copy/t";
import stil from "./durumRozeti.module.css";

/**
 * B8: hafta adimi surerken ("hesaplaniyor") ve yazim surerken ("kaydediliyor") kose rozeti. Canli bolge (`aria-live="polite"`) her zaman vardir (icerik
 * sonradan eklendiginde de okunur). Hareket (nokta atimi) hareket azaltma tercihinde ve sistem tercihinde kapanir.
 */
export function DurumRozeti({ hesaplaniyor, kaydediliyor, yuvada = false }: { hesaplaniyor: boolean; kaydediliyor: boolean; /** Oyun ekranının alt-sol bildirim yuvasında akar (sabit köşe yerine): ipucu kartıyla ve tam ekran katmanla çakışmaz. */ yuvada?: boolean }) {
  const metin = hesaplaniyor ? t("hesap.hesaplaniyor") : kaydediliyor ? t("kayit.durum.kaydediliyor") : null;
  return (
    <div role="status" aria-live="polite" {...(yuvada ? { "data-durum-rozeti": "" } : {})} className={metin === null ? stil.bos : yuvada ? `${stil.rozet} ${stil.yuvada}` : stil.rozet}>
      {metin !== null ? (
        <>
          <span className={stil.nokta} aria-hidden="true" />
          <span>{metin}</span>
        </>
      ) : null}
    </div>
  );
}
