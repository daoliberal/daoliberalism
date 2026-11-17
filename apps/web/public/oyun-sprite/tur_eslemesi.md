# Oyun isletme turu -> sprite eslemesi

Sprite dosyalari `sprite/` altinda; her bina icin tam parsel (`sprite/<ad>.png`) ve yalin (`sprite/yalin/<ad>_yalin.png`) surum vardir. Buyume merdiveni (boy 1-4) icin `sprite/merdiven/` ve `sprite/merdiven/yalin/`.

Kalite: **ozel** = ture ozgu sprite; **yaklasik** = baska turle ortak gorsel (tur kimligi oyunda tabela/renk bindirmesiyle verilecek).

| tur | sektor grubu | sprite | kalite |
|---|---|---|---|
| tarla_bugday | hammadde | bugday_tarlasi | ozel |
| tarla_seker | hammadde | seker_tarlasi | ozel |
| tarla_pamuk | hammadde | pamuk_tarlasi | ozel |
| maden_silika | hammadde | maden_silika | ozel |
| maden_aluminyum | hammadde | maden_aluminyum | ozel |
| maden_kimyasal | hammadde | maden_kimyasal | ozel |
| maden_komur | hammadde | maden_komur | ozel |
| maden_altin | hammadde | maden_altin | ozel |
| petrol | hammadde | petrol | ozel |
| kereste | hammadde | kereste | ozel |
| un | imalat | degirmen | ozel |
| firin | imalat | dukkan_tente | ozel (tenteli firin/dukkan) |
| sise_sut | imalat | fabrika_silo | yaklasik (silolu fabrika) |
| kola | imalat | fabrika_baca_04 | yaklasik |
| cam | imalat | fabrika_baca_03 | yaklasik |
| plastik | imalat | fabrika_kirmizi_merdiven | yaklasik |
| deterjan | imalat | fabrika_kirmizi_depo | yaklasik |
| tekstil | imalat | fabrika_kirmizi_depo | yaklasik |
| giyim | imalat | fabrika_kirmizi_depo | yaklasik |
| mobilya | imalat | fabrika_kirmizi_depo | yaklasik |
| moda | hizmet | avm | yaklasik |
| elektronik | imalat | fabrika_baca_03 | yaklasik |
| bilgisayar | imalat | apartman_koyu_cam | yaklasik |
| santral | imalat | santral | ozel |
| kuyumcu | hizmet | dukkan_tente | yaklasik |
| market | hizmet | avm | ozel (avm) |
| medya | hizmet | gokdelen_cam_mavi | yaklasik |
| arge | hizmet | apartman_bej_yuksek | yaklasik |
| yazilim | hizmet | apartman_koyu_cam | yaklasik |
| guvenlik | hizmet | polis | ozel |
| ulasim | hizmet | ulasim_garaj | ozel |
| otel | hizmet | gokdelen_bej_cam | yaklasik |
| restoran | hizmet | dukkan_tente | yaklasik |
| eglence | hizmet | tiyatro | yaklasik (tiyatro) |
| insaat | hizmet | insaat | ozel |
| hastane | hizmet | hastane | ozel |
| eczane | hizmet | dukkan_tente | yaklasik |
| ilac | imalat | fabrika_kirmizi_merdiven | yaklasik |
| okul | hizmet | okul | ozel |
| universite | hizmet | universite | ozel (okul + yazi) |
| lojistik | lojistik | lojistik_boy1, lojistik_boy2, lojistik_boy3, lojistik_boy4 | ozel (merdiven; boy4 = buyuk lojistik merkezi: depo + garaj + kamyonet) |
| liman (sehir kurumu, firma degil) | - | liman | ozel (gemili liman; yalniz Liman kurumu) |
| ihracat (sehir kurumu, firma degil) | - | gumruk | ozel (depo + kamyonet + konteyner yigini; yalniz Ihracat kurumu) |
| belediye | sehir | belediye | ozel (tiyatro + yazi) |
| lonca | lonca | lonca | ozel (muze + yazi) |
| banka | hizmet | banka | ozel (muze + yazi) |
| ahir | ahir | ahir | ozel |
| konut | - | ev_villa_beyaz, ev_villa_havuz_1, ev_villa_havuz_2, ev_villa_cit, ev_villa_salincak, ev_villa_teras, ev_modern_gri_1, ev_modern_gri_2, apartman_kahve_kule, apartman_tugla_3kat, apartman_bej_yuksek, apartman_koyu_cam | ozel (12 varyant) |

## Sektor grubu merdivenleri (boy: 1-7, 8-19, 20-49, 50+ calisan)

| grup | boy1 | boy2 | boy3 | boy4 (2 parsel, uzanma r) |
|---|---|---|---|---|
| hammadde | hammadde_boy1 | hammadde_boy2 | hammadde_boy3 | hammadde_boy4 |
| imalat | imalat_boy1 | imalat_boy2 (fabrika_baca_03) | imalat_boy3 (fabrika_silo) | imalat_boy4 |
| hizmet | hizmet_boy1 (dukkan_tente) | hizmet_boy2 (apartman_tugla_3kat) | hizmet_boy3 (ofis) | hizmet_boy4 |
| lojistik | lojistik_boy1 | lojistik_boy2 | lojistik_boy3 | lojistik_boy4 (buyuk lojistik merkezi) |
| lonca | lonca_boy1 (tek boy) | | | |
| sehir | sehir_boy1 = belediye (tek boy) | | | |
| ahir | ahir_boy1 = ahir (tek boy) | | | |

Bos genisleme parseli: `arsa_cimen` (hammadde/imalat/hizmet), `arsa_otopark` (lojistik). Gecis bindirmeleri: `iskele_boy1-4`, `tahtali_boy1-4` (sprite/overlay).

## Eslenemeyen / zayif eslenen

- Hic eslenemeyen tur yok; ama `yaklasik` isaretli turlerin ozgun gorseli yok (pakette ve uretimde karsiligi yok): cam, plastik, deterjan, tekstil, giyim, mobilya, elektronik, bilgisayar, ilac, arge, yazilim, medya, moda, kuyumcu, restoran, eczane, otel, eglence, kola, sise_sut.
- `lojistik_boy4`, `hammadde_boy4`, `imalat_boy4`, `hizmet_boy4` yalnizca yalin surumdedir (tam/yol seritli surum yok).
