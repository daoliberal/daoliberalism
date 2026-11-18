import type { tr } from "./tr";

/**
 * B8: tarayici kipinde (model oyuncunun tarayicisinda) "sunucu" diyen metinlerin yerine gecen karsiliklar. `t()` bayrakli derlemede bunlari okur;
 * sunucu ve bayraksiz derlemede `tr` metinleri aynen kalir. Anahtarlar `tr`de bulunmali (test).
 */
export const tarayiciMetinleri: Partial<Record<keyof typeof tr, string>> = {
  "hata.sunucu_yok": "Oyun motoruna ulaşılamıyor. Sayfayı yeniden yüklemeyi dene; kaydın güvende.",
  "hata.sunucu_bozuk": "Oyun motoru bir hata verdi. Sayfayı yeniden yüklemeyi dene; kaydın güvende.",
  "kurucu.kayit_notu.live": "Bu sürüm gerçek modeli tarayıcında çalıştırır; oyunların bu tarayıcıda saklanır",
  "dao.sunucu_yok": "DAO oyunu için oyun motoru çalışmalı. Sayfayı yeniden yüklemeyi dene.",
  "dao.kosu_yok": "Bu oyun bu tarayıcıda bulunamadı.",
  "kosular.kapat.metin": "{ad} kapatılacak ve açık koşu sayısından düşecek. Kütüphanedeki kaydı silinmez; sonra Aç ile yeniden kurulabilir.",
  "kosular.kart.ad_uzun": "Bu koşunun adı 64 karakterden uzun; oyun kabul etmez. Yeniden adlandır, sonra aç.",
  "sart.nufus.hiz_yok": "Tahmini hız yok: model bu cihazda henüz ölçüm bildirmedi.",
  "sart.nufus.hiz_not": "Süre ağırlıkla oyuncu sayısına bağlıdır; NPC sayısı süreyi az etkiler. Tahmin, bu cihazda varsayılan dünyada yapılan ölçümün oyuncu oranıyla ölçeklenmesidir.",
  "sart.hesap.hata": "Açılış hesabı alınamadı: oyun motoru yanıt vermedi ya da yanıt okunamadı.",
  "sart.ozet.tahmin_yok": "Etkiyi tahmin etmiyoruz: ölçülmemiş bir değerin sonucu için sayı uydurulmaz. Gerçek sonucu görmek için şartı uygulayıp oyunu oynat.",
  "kosular.ac.kayit_yok": "Bu koşu şu an açılamadı: oyun yenileniyor ya da kaydı seçim gerektiriyor. Biraz sonra yeniden dene.",
  "canli.dallan.kapali_canli": "Bu oyunda dallanma kapalı.",
};
