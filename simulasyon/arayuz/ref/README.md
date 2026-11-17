# Prototip referansı (salt okunur)

Bu klasördeki kopya, Claude Design'ın ürettiği oyun arayüz prototipinin birebir kopyasıdır. Kopya `apps/web/prototype/oyun/Main.dc.html` yoluna alınmıştır ve **salt okunur** referanstır: içeriği değiştirilmez, düzeltilmez, yeniden biçimlendirilmez. Sonraki görevler bu dosyayı yalnız okuyarak uygular.

## Kaynak

- Kaynak yol: `yerel çalışma klasörü (aktarımda maskelendi)`
- Kopya yolu: `apps/web/prototype/oyun/Main.dc.html`
- Tarih: 2026-10-28
- Boyut: 352173 bayt (kaynakla aynı)
- sha256: `265858407ba15b302ea8102949184550edbc9726e611d84861614e696a362da5`
- Köken: Claude Design artifact (özel paylaşım bağlantısı aktarımda maskelendi), sürüm `1793198040-b05e`

## Kurallar

- Kopya `cp` ile bayt bayt alınmıştır; sha256 ile doğrulanmıştır.
- Prototipin renkleri, yazı tipleri ve ölçüleri uygulamaya taşınmaz; değerler `tokens.css` belirteçlerinden gelir.
- Prototipteki model dosyaları, kayıt verileri ve gizli kalibrasyon adları bu referansın kapsamında değildir.

## Prototip durum anahtarları ve sadakat satırları (P1)

Prototipte ekranı `screen` seçer (`start|builder|live|result|runs`); builder için `bStep` 0/1/2; `view` yalnız canlı ekranın alt sekmesidir (`world|city|chain`). Metin `apps/web/fidelity/oyun/oyun-parity.ts` içindeki `oyunPrototypeText(state)` ile üretilir: `state = this.initialState();` işaretçisi bellekte `Object.assign(this.initialState(), <durum>)` ile yamalanır (dosya değişmez).

| Ekran | Durum | Boş olmayan satır |
| --- | --- | --- |
| Başlangıç | `{screen:"start"}` | 11 |
| Kurucu adım 0 | `{screen:"builder", bStep:0}` | 62 |
| Kurucu adım 1 | `{screen:"builder", bStep:1}` | 38 |
| Kurucu adım 2 | `{screen:"builder", bStep:2}` | 107 |
| Canlı | `{screen:"live"}` | 77 |
| Sonuç | `{screen:"result"}` | 6 |
| Koşular | `{screen:"runs"}` | 12 |
| Şart editörü paneli (F3) | `{screen:"live", editorOpen:true}` tek başına **77** (değişmez): kaplama `editorOpen && values` ister, `values` başta `null`. `values` = `draft`'ın kopyası olmalı (JSON olarak verilemez); F3 bu durumu kendi yamasıyla kurar (`s.values = this.clone(s.draft)` ile 181 satır) | 181 |

`assertOyunParity(page, state, { screen, only?, root?, width? })`: `only` prototip metninin boş olmayan satırlarının 1 tabanlı numaralarıyla aralıklarıdır (`[{from:1,to:12}]`); verilirse yalnız bu satırlar (ve sırası) denetlenir. F1/F2/F3 görevleri aşağıdaki `only` tablosunu kendi ekinde verilen aralıklarla doldurur (her aralık için hangi MVP bölümüne ait olduğu yazılır).

| Ekran | `only` aralığı | MVP bölümü |
| --- | --- | --- |
| (F1/F2/F3 doldurur) | | |
