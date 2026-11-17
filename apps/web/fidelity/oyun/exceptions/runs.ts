import type { OyunException } from "../exceptions";

/** Koşular ekranı (`runs`): prototipin satırlarından oyunun göstermediği ya da dil kuralıyla yeniden yazdığı kısımlar. */
export const RUNS_EXCEPTIONS: readonly OyunException[] = [
  {
    screen: "runs", kind: "omit", line: /^Otomatik kayıt:/,
    reason: "Prototip bu satırla kaydın kendiliğinden yapıldığını söyler; oyun da her koşuyu başladığı anda dünya adıyla kendiliğinden kaydeder (Kaydet düğmesi yok), bunu söyleyen metin 'Başlattığınız her koşu dünya adıyla bu tarayıcıda kendiliğinden kaydedilir...' satırıdır.",
  },
  {
    screen: "runs", kind: "omit", line: /^Henüz koşu yok\.$/,
    reason: "Sahip isteği (D3): koşular kendiliğinden kaydedildiği için Açık koşular'ın hemen altındaki 'Henüz koşu yok.' yanıltıyordu (açık koşu varken bile kütüphane boş görünürdü). Oyunda kaydedilmiş koşular bölümü kendi başlığı ('Kaydedilmiş koşular') altında 'Kaydedilmiş koşu yok...' der; metin birim testinde (kosular.test.tsx) denetlenir.",
  },
  {
    screen: "runs", kind: "omit", line: /Şart v\d+ · hafta \d+ ·/,
    reason: "Kart bilgi satırı: prototip koşunun dünyasını, şart sürümünü, haftasını, durumunu ve senaryosunu yazar; kütüphane yalnız tarif ve ad tuttuğu için oyun 'kaynak · süre · şart sürümü sayısı · kayıt tarihi' yazar (hafta ve çöküş durumu koşu açılınca model yeniden hesaplanınca belli olur). Aynı nedenle kartta kıvılcım grafiği yoktur (kütüphanede seri saklanmaz). Etkin koşunun Sil düğmesi prototipte kapalıdır (delDis); oyunda kütüphane kaydı sunucudaki koşudan bağımsız olduğu için Sil açık kalır ve onay diyaloğu ister (diyalog 'alertdialog' değil, projenin Diyalog bileşeni 'dialog'). Oyun metni birim testinde (kosular.test.tsx) denetlenir.",
  },
  {
    screen: "runs", kind: "omit", line: /^Açık$/,
    reason: "Prototipte 'Açık' etiketi etkin koşunun kartındadır; oyunda sunucuda açık olan kayıtlı koşunun kartında görünür (kimlik eşleşmesi). Aynı metin, koşulları farklı.",
  },
];
