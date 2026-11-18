/**
 * B8: arayuz yetenekleri, TEK kaynaktan. `NEXT_PUBLIC_OYUN_KAYNAK=tarayici` derlemesinde (model oyuncunun tarayicisinda) sunucuya bagli ekranlar gizlenir,
 * yerel kayit ekranlari acilir. Sunucu ve bayraksiz (onizleme) derlemede bugunku arayuz AYNEN kalir. Ekranlar kosulu kendileri kurmaz; bu listeyi okur.
 *
 * Gizlenenler (tarayici): arka plan isleri gerektiren ekranlar (altı dünya, A/B karşılaştırma, etki önizlemesi: tarayıcı çekirdeğinde iş işçisi yok),
 * "Dünyayı yayınla", paylaşılan dünyalar (Benim dünyalarım, `#/dao/d/<kod>`, skor tablosu), kayıt/önizleme bağlantıları (`?kaynak=kayit`, `canli-` öneksiz kimlik).
 * Kalanlar: oyun içi sonuç/ölçüm ekranları, "Açılış hesabı" (`/api/world/plan` Worker içinde çalışır), "Şartı paylaş" (kod üretimi istemcidedir).
 */
export interface Yetenekler {
  /** Altı dünya, A/B karşılaştırma ve etki önizlemesi (hepsi arka plan işi ister). */
  isEkranlari: boolean;
  /** Sonuç ekranındaki "Dünyayı yayınla" (sunucuya yazar). */
  dunyaYayinla: boolean;
  /** Benim dünyalarım, paylaşılan dünya sayfası, skor tablosu, dünyada yeni DAO koşusu (sunucu ister). */
  paylasilanDunyalar: boolean;
  /** `?kaynak=kayit` ve `canli-` öneksiz kimlikle kayıt/önizleme kaynağından açma. */
  kayitBaglantilari: boolean;
  /** Kayıt ve depolama paneli, dışa/içe aktarma, kota, 52 hafta hatırlatması, açık kod satırı. */
  yerelKayit: boolean;
  /** Telefon/tablet uyarısı (uzun oyun desteklenmiyor). */
  cihazUyarisi: boolean;
}

export function yetenekler(tarayici: boolean): Yetenekler {
  return {
    isEkranlari: !tarayici,
    dunyaYayinla: !tarayici,
    paylasilanDunyalar: !tarayici,
    kayitBaglantilari: !tarayici,
    yerelKayit: tarayici,
    cihazUyarisi: tarayici,
  };
}

/** Derleme zamani sabiti: bayraksiz derlemede `false` (ilgili kod dallari budanir). */
export const TARAYICI = process.env.NEXT_PUBLIC_OYUN_KAYNAK === "tarayici";
export const YETENEKLER: Yetenekler = yetenekler(TARAYICI);

/** Acik kod deposu (acik kod bilgi satirinin baglantisi). */
export const ACIK_DEPO = "https://github.com/daoliberal/daoliberalism";
