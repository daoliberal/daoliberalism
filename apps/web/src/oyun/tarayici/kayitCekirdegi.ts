/**
 * B5: B4b `KayitCekirdegi` arayuzunun gercek uygulamasi (Worker uzerinden). Hata sozlesmesi: Python istisnasi `CekirdekHatasi{tur, mesaj, fark}`
 * olarak reddedilir (`IsciIstemcisi` cevirir). Goruntu parcalari `ArrayBuffer` transfer listesiyle tasinir.
 */
import { CekirdekHatasi, type DevamGirdisi, type KayitCekirdegi, type TariftenGirdisi } from "./kayit/cekirdek";
import { kayitGirdisiniWorkera, tariftenGirdisiniWorkera, type YontemAdi, type YontemGirdisi, type YontemSonucu } from "./protokol";
import type { CagriSecenegi } from "./yukleyici";

export interface IsciCagrisi {
  cagri<Y extends YontemAdi>(y: Y, a: YontemGirdisi<Y>, o?: CagriSecenegi): Promise<YontemSonucu<Y>>;
  /** Worker'i sonlandirir (yanit vermiyorsa kopru cagirir). */
  kapat?(): void;
  /** Bekci icin: Worker'dan gelen toplam mesaj sayisi ve yanit bekleyen cagri sayisi. */
  mesajSayisi?(): number;
  bekleyen?(): number;
}

export function kayitCekirdegi(isci: IsciCagrisi): KayitCekirdegi {
  return {
    uyumlulukAnahtari: () => isci.cagri("uyumlulukAnahtari", null),
    goruntuGerekli: (kosuId) => isci.cagri("goruntuGerekli", { kosuId }),
    async goruntuAl(kosuId, sink) {
      const r = await isci.cagri("goruntuAl", { kosuId });
      // Worker `goruntu_al` hatasinda parcalari hic gondermez; basarida sirayla, birlestirmeden sink'e verilir.
      for (const p of r.parcalar) sink(new Uint8Array(p));
      return r.sonuc;
    },
    gunlukAl: (kosuId, sonra) => isci.cagri("gunlukAl", { kosuId, sonra }),
    tarifAl: (kosuId) => isci.cagri("tarifAl", { kosuId }),
    devam(g: DevamGirdisi) {
      // Parcalar transfer edilir (depodan taze okunmus kopyalar; cagri sonrasi bu dizi kullanilmaz).
      const parcalar = g.goruntu.parcalar;
      return isci.cagri("devam", kayitGirdisiniWorkera(g, parcalar), { aktar: parcalar, devamIlerleme: g.ilerleme });
    },
    tariftenOynat(g: TariftenGirdisi) {
      return isci.cagri("tariftenOynat", tariftenGirdisiniWorkera(g), { devamIlerleme: g.ilerleme });
    },
    async kosuSil(kosuId) {
      // Kopru rotasi: `DELETE /api/runs/<id>` (Python `delete` rotasi). 404 `kosu_yok` olarak reddedilir (B4b `kayitlaBirlikte` yolu).
      const r = await isci.cagri("istek", { yontem: "DELETE", yol: `/api/runs/${encodeURIComponent(kosuId)}` });
      if (r.status === 404) throw new CekirdekHatasi("UnknownRun", "kosu_yok");
      if (r.status < 200 || r.status >= 300) throw new CekirdekHatasi("HttpHatasi", `durum_${r.status}`);
    },
  };
}
