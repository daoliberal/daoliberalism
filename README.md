# daoliberalism

Tarayıcıda çalışan, ekonomi simülasyonuna dayalı ücretsiz bir oyun. Oyuncu bir dünyaya girer; firmalar, loncalar, krediler ve iş piyasası haftalık adımlarla işler. Model davranışı belirlenimcidir: aynı tohum ve ayarlarla aynı çıktı üretilir.

Bu depo oyunun uygulamasını (`apps/web`) ve simülasyon modelini (`simulasyon/`) içerir.

## Çalıştırma

Gereksinimler: Node.js >= 22.12, pnpm, Python 3.

```sh
pnpm install --frozen-lockfile
pnpm --filter web build        # statik çıktı: apps/web/out
pnpm --filter web dev          # geliştirme sunucusu
```

Sunucu testleri (hızlı mod):

```sh
cd simulasyon/arayuz/server
python3 -m tests.run_all --quick
```

Model belirlenimcilik kapısı (hızlı katman). Altın (golden) `.md` çıktıları depoda yoktur, yalnız SHA'ları (`golden/SHA256SUMS.json`) vardır; önce üretilir:

```sh
cd simulasyon/kagit-ustu/modulerlestirme
python3 tools/golden.py make snapshot/v13.3/model_mod.py --tier fast    # depodaki SHA'larla aynı çıktıyı üretir (`SHA256SUMS.json`ta yalnız tarih ve yol üst bilgisi değişir)
python3 tools/gate.py --tier fast
```

Uyarı: `golden.py make` komutunu bugünkü `model_mod.py` ile koşmayın; altınları bugünkü modelden üretip izlenen `golden/SHA256SUMS.json` dosyasının üzerine yazar ve kapıyı sahte yeşile çevirir. Yanlışlıkla yazıldıysa (ya da yukarıdaki doğru komuttan sonra üst bilgiyi geri almak için): `git checkout -- golden/SHA256SUMS.json` (aynı `modulerlestirme` klasöründen).

Not: altın çıktılar modelin v13.3 dondurmasına (`snapshot/v13.3`) aittir; sonraki varsayılan değişiklikleri içermez. Bu yüzden bugünkü varsayılanlarla `gate.py` kırmızı görünür. Bu bir gerileme değil, bayat referanstır; yeniden dondurma planlıdır.

Bilinen sorun: `tests.run_all` içinde `test_wire_contract` yük altında ara sıra kırılır; tek başına koşunca geçer.

## İletişim

Hata bildirimi ve sorular için GitHub Issues kullanın.

## Lisans

Kod ve görseller (sprite ve harita dahil) MIT lisansı altındadır: bkz. `LICENSE`.

Yazı tipleri SIL Open Font License (OFL) altındadır ve `@fontsource` paketleriyle gelir: Bricolage Grotesque, Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono.
