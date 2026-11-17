import { t } from "@/oyun/copy/t";
import type { IpucuVerisi } from "./IzoIpucu";

/**
 * İpucu kutusunun sol-üst köşesi: imlecin sağ-altında `bosluk` kadar uzakta durur; tuvalden taşacaksa imlecin karşı yanına geçer,
 * yine sığmazsa tuval kenarına kıstırılır. Her şey tuval pikselidir; imleç hareket ettikçe yeniden hesaplanır (kutu imleci izler).
 */
export function ipucuYeri(x: number, y: number, boyut: { genislik: number; yukseklik: number }, kutu: { genislik: number; yukseklik: number }, bosluk: number): { x: number; y: number } {
  const yer = (imlec: number, uzunluk: number, sinir: number): number => {
    const ileri = imlec + bosluk;
    const aday = ileri + uzunluk <= sinir ? ileri : imlec - bosluk - uzunluk;
    return Math.max(0, Math.min(aday, sinir - uzunluk));
  };
  return { x: yer(x, boyut.genislik, kutu.genislik), y: yer(y, boyut.yukseklik, kutu.yukseklik) };
}

/** İpucu metni: başlık (bina adı) ve ayrıntı satırları (durum ve çalışan, oyuncu işletmesi). Hem Pixi kutusu hem erişilebilir DOM kopyası aynı metni kullanır. */
export function ipucuMetni(v: IpucuVerisi): { baslik: string; detay: string[] } {
  const detay: string[] = [];
  if (v.calisan !== null) detay.push(`${t(`harita.durum.${v.durum}`)} · ${t("harita.ipucu.calisan", { n: v.calisan })}`);
  if (v.sahip === "oyuncu" || v.sahip === "dao") detay.push(t("harita.ipucu.oyuncu"));
  return { baslik: v.ad, detay };
}
