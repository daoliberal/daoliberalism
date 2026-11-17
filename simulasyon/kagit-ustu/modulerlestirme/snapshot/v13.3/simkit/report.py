"""simkit.report: rapor metninin derlenmesi: koşu sonucu R'den başlık, zaman serileri ve bölüm raporlarını (inovasyon, K-183/185/187) birleştirir.

ARAYÜZ: build_report
OKUR: R (R['rt'] dahil), ahir_kamu bayrağı (çağıran verir). YAZAR: yok.
KATMAN: L11 (en üst rapor katmanı).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.report_innov import innov_report
from simkit.report_k18 import k183_report, k185_report, k187_report
from simkit.tech_core import tech_f
from simkit.transition import trans_report_text
from simkit.young_meas import yk_report_text
from simkit.sector_board import board_report_text


def build_report(R, weeks, n_cities, ahir_kamu):
    """R sözlüğünden rapor metnini üretir (adım 8-9: run() çağrısı ve AHIR_KAMU bayrağı çağırandadır)."""
    BRAND = R["rt"]["BRAND"]      # adım 8: modül durumu yerine R genişletmesi
    FRONT = R["rt"]["FRONT"]      # adım 8: modül durumu yerine R genişletmesi
    HW_STATE = R["rt"]["HW_STATE"]      # adım 8: modül durumu yerine R genişletmesi
    LAND = R["rt"]["LAND"]      # adım 8: modül durumu yerine R genişletmesi
    MARKET_MARKUP = R["rt"]["MARKET_MARKUP"]      # adım 8: modül durumu yerine R genişletmesi
    MODA_STATE = R["rt"]["MODA_STATE"]      # adım 8: modül durumu yerine R genişletmesi
    PM = R["rt"]["PM"]      # adım 8: modül durumu yerine R genişletmesi
    REF = R["rt"]["REF"]      # adım 8: modül durumu yerine R genişletmesi
    SW_STATE = R["rt"]["SW_STATE"]      # adım 8: modül durumu yerine R genişletmesi
    TOPO = R["rt"]["TOPO"]      # adım 8: modül durumu yerine R genişletmesi
    TOUR_STATE = R["rt"]["TOUR_STATE"]      # adım 8: modül durumu yerine R genişletmesi
    WI = R["rt"]["WI"]      # adım 8: modül durumu yerine R genişletmesi
    L, weekly, S, K, cities = R["L"], R["weekly"], R["stats"], R["kind_stats"], R["cities"]
    basket_local = sum(q * REF[p] for p, q in BASKET.items()) * MARKET_MARKUP
    _pws = [R["people"][q]["wage"] for d_ in R["firms"].values() if d_["kind"] not in ("ahir", "belediye", "arge") for q in d_["workers"]]
    _pw_avg = sum(_pws) / max(1, len(_pws))
    _bk_avg = sum(sum(LAND[(ci_, p_)] * q_ for p_, q_ in BASKET.items()) for ci_ in range(n_cities)) / n_cities * MARKET_MARKUP / CYCLES_PER_WEEK
    _tail = [r_["series"] for r_ in weekly[100:]] or [r_["series"] for r_ in weekly]
    _g_w, _g_i, _t_i = (sum(x_[k_] for x_ in _tail) / len(_tail) for k_ in ("gini", "gini_inc", "top10_inc"))
    o = [f"# Kâğıt üstü oyun {VERSION} — {n_cities} şehir, kapalı dünya · {weeks} hafta · çıraklık ocağı: {'var' if ahir_kamu else 'yok'}\n",
         f"Şehir başına {PLAYERS_PER_CITY} oyuncu (ahırda çırak); NPC havuzu {NPC_X}+{NPC_Y}·{PLAYERS_PER_CITY * n_cities} = {NPC_X + NPC_Y * PLAYERS_PER_CITY * n_cities} (tek havuz, K-87); açılış kadrosu NPC, sonraki boşluklar oyuncuya (K-77, K-81) · kadro ve üretim talebe göre ×{STAFF_BUFFER} (K-88) · TAKAS: yerli önce, sonra mesafe; kıtlıkta orantılı; dışsal dünya yok, navlun %{int(NAVLUN * 100)}×mesafe (K-52, K-92 →) · harcama gelirin %{int(SPEND_SHARE * 100)}'ı (K-97) · firma kurma {FOUND_WEEK}. haftadan, sermaye loncadan (K-98, K-34) · lonca programı {'sermaye %d / reklam %d / kurucu payı %d (lonca sahibi oyuncuya) / Ar-Ge %d (üye DAO sözleşmesi)' % tuple(round(100 * PROGRAM_INNOV[k_]) for k_ in ('sermaye', 'reklam', 'kurucu_payi', 'arge')) if INNOV_ON else 'sermaye 50 / reklam 25 / kurucu 25'} · fiyat maliyet artı, marj %{int(PRICE_MARGIN * 100)} (K-93, K-96), raf alış×{MARKET_MARKUP:.3f}\n",
         f"Referans fiyatlar: " + ", ".join(f"{p} {v:.2f}" for p, v in REF.items()) + f". Haftalık sepet {basket_local:.1f} Akçe = çırak ücretinin %{basket_local / 70 * 100:.0f}'i; kalan, %90'a kadar kot ve sandalyeye.\n",
         "## Dünya: hafta sonu\n",
         "| Hafta | Oyuncular | NPC'ler | Firmalar | Loncalar | Şehirler | Basılan (hafta) | Basılan (toplam) | Oyuncu firması (adet / çalışan) | Ücret başarısız | Eksik sepet (kişi-döngü, küm.) |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in weekly:
        o.append(f"| {r['week']} | {r['players']:,.0f} | {r['npcs']:,.0f} | {r['firms']:,.0f} | {r['loncas']:,.0f} | {r['cities']:,.0f} | {r['mint_w']:,.0f} | {r['minted']:,.0f} | {r['pfirms']} / {r['in_pf']} | {r['wage_fail']} | {r['missed']} |")
    o += ["\n## Zaman serisi (K-108; her 10 haftada ve ilk 8 haftada)\n",
          "Gerçek gün = hafta × 7 saat / 24 (K-64). Çalışan = tüm işyerleri; işsiz = iş arayan oyuncu; para arzı = Σ bakiye.\n",
          "| Hafta | Gerçek gün | Çalışan (NPC) | İş arayan | Oyuncu firması | Talep karşıl. | İthalat/tüketim | Sepet fiyat endeksi | Para arzı | Şehir kasaları | Gini (oyuncu) | En zengin %10 | Uzmanlaşma | İtibar | İthalata tam bağımlı tür (ort./en çok) |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in weekly:
        if r["week"] <= 8 or r["week"] % 10 == 0 or r["week"] == weeks:
            sr = r["series"]
            o.append(f"| {r['week']} | {r['week'] * 7 / 24:.1f} | {sr['employed']:,} ({sr['emp_npc']:,}) | {sr['seekers']} | {r['pfirms']} | {sr['got'] / max(1e-9, sr['dem']):.0%} | {sr['imp'] / max(1.0, sr['cons']):.0%} | {sr['pidx']:.0f} | {r['players'] + r['npcs'] + r['firms'] + r['loncas'] + r['cities']:,.0f} | {sr['treasury']:,.0f} | {sr['gini']:.2f} | {sr['top10']:.0%} | {sr['spec']:.2f} | {sr['rep']:.0f} | {sr['dep']:.1f} / {sr['dep_max']} |")
    if ARGE_ON:
        o += ["\n## Ar-Ge, teknoloji ve telif (K-134)\n",
              "Verim çarpanı = 1 + k·√birikmiş Ar-Ge (dal başına k farklı). Öncü = en yüksek loncanın düzeyi; fiyat çıpası öncü verimini izler (ucuzlama). Reel fiyat endeksi: dalın ürünlerinin ortalama teslim fiyatı / başlangıç referansı × 100.\n",
              "| Hafta | Gün | " + " | ".join(f"{b} verim / fiyat endeksi" for b in BRANCHES) + " | Temiz elektrik payı |", "|---|---|" + "---|" * (len(BRANCHES) + 1)]
        for r in weekly:
            if r["week"] % 50 == 0 or r["week"] == weeks:
                sr = r["series"]
                o.append(f"| {r['week']} | {r['week'] * 7 / 24:.0f} | " + " | ".join((f"{sr['front'][b]:.2f} / {sr['bidx'][b]:.0f}" if (b != "donanim" or sr["hw_on"]) else "– / –") for b in BRANCHES) + f" | {sr['green']:.0%} |")
        o += ["\nLonca başına birikmiş Ar-Ge (dal), harcama ve telif geliri (son hafta):\n", "| Lonca | " + " | ".join(BRANCHES) + " | Ar-Ge harcaması | Telif geliri | Telif / Ar-Ge |", "|---|" + "---|" * (len(BRANCHES) + 3)]
        for lo in sorted(R["KN"]):
            sp, ti = R["arge_spent"].get(lo, 0.0), R["telif_in"].get(lo, 0.0)
            o.append(f"| {lo} | " + " | ".join(f"{R['KN'][lo][b]:,.0f}" for b in BRANCHES) + f" | {sp:,.0f} | {ti:,.0f} | {ti / sp:.0%} |" if sp else f"| {lo} | " + " | ".join("0" for _ in BRANCHES) + " | 0 | 0 | – |")
        o.append("\nFirmaların teknoloji yolu (son hafta): " + ", ".join(f"{k} {v}" for k, v in sorted(R["tech_paths"].items())) + ".\n")
        o.append("Teknoloji olayları (hafta, lonca, dal):\n")
        for e in R["tech_events"][:40]:
            o.append(f"- {e}")
    o += ["\n## Denge özdeşliği, akış bazında (K-47, K-83)\n",
          "Basılan = Δoyuncu + ΔNPC + Δfirma + Δlonca + Δşehir (korunum). Kapalı dünyada basımın tek kaynağı şehir açıklarıdır.\n",
          "| Hafta | Basılan | Δoyuncu | ΔNPC | Δfirma | Δlonca | Δşehir |", "|---|---|---|---|---|---|---|"]
    for r in weekly:
        o.append(f"| {r['week']} | {r['mint_w']:,.0f} | {r['d_players']:,.0f} | {r['d_npcs']:,.0f} | {r['d_firms']:,.0f} | {r['d_loncas']:,.0f} | {r['d_cities']:,.0f} |")
    last = weekly[-1]
    o += [f"\n## Şehirler, {weeks}. hafta\n",
          "| Şehir | İtibar (K-86) | Oyuncu: ahırda / NPC firmada / kendi firmasında / belediyede / iş arıyor | NPC çalışan / işsiz | Oyuncu firması | İthalat | İhracat | Denge | Talep karşılanan | Ücret ödenen | Şehir kasası |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, c in enumerate(last["per_city"]):
        paid = f"{c['paid'] / max(1, c['paid'] + c['unpaid']):.0%}"
        o.append(f"| {i} | {c['rep']:.0f} | {c['in_ahir']} / {c['in_npc']} / {c['in_pf']} / {c['in_muni']} / {c['seekers']}{(' / Ar-Ge ' + str(c['in_res'])) if INNOV_ON else ''} | {c['npc_emp']} / {c['pool']} | {c['pfirms']} | {c['imp']:,.0f} | {c['exp']:,.0f} | {c['exp'] - c['imp']:,.0f} | {c['met']:.0%} | {paid} | {c['bal']:,.0f} |")
    o += ["\n### Şehir itibarı, haftalara göre\n", "| Hafta | " + " | ".join(f"Şehir {i}" for i in range(n_cities)) + " |", "|---|" + "---|" * n_cities]
    for r in weekly:
        o.append(f"| {r['week']} | " + " | ".join(f"{c['rep']:.0f}" for c in r["per_city"]) + " |")
    o += ["\n## Şehirler arası ticaret (kümülatif Akçe; satır satıcı, sütun alıcı)\n",
          "| | " + " | ".join(f"→ {j}" for j in range(n_cities)) + " |", "|---|" + "---|" * n_cities]
    for i in range(n_cities):
        o.append(f"| {i} | " + " | ".join(f"{R['trade'][(i, j)]:,.0f}" for j in range(n_cities)) + " |")
    o += ["\n## Ürünler (kümülatif)\n", "| Ürün | Yerli satış | Şehirler arası | Alıcısız (ref.) | Talep karşılanan |", "|---|---|---|---|---|"]
    for p in list(REF) + ["luks"]:
        ls, li, un = S["local"][p], S["imported"][p], S["unsold"][p]
        if ls or li or un or S["demanded"][p]:
            met = f"{S['delivered'][p] / S['demanded'][p]:.0%}" if S["demanded"][p] else "–"
            o.append(f"| {p} | {ls:,.0f} | {li:,.0f} | {un:,.0f} | {met} |")
    o += ["\n## Akışlar (tür etiketli, K-36; kümülatif)\n", "| Tür | Akçe |", "|---|---|"]
    for k, v in sorted(L.flows.items(), key=lambda kv: -kv[1]):
        o.append(f"| `{k}` | {v:,.0f} |")
    o += ["\n## Başabaş (K-83): çalışan-döngü başına net gelir (koşu)\n", "| Firma tipi | Çalışan-döngü | Net | ≥ 12,5? |", "|---|---|---|---|"]
    for kind, s in sorted(K.items()):
        if s["wc"]:
            net = (s["rev"] - s["inp"] - s["rent"]) / s["wc"]
            o.append(f"| {kind} | {s['wc']} | {net:.2f} | {'✅' if net >= 12.5 else '❌'} |")
    tot_out = sum(L.city_out.values()) or 1.0
    o += ["\n## Şehir kasalarından çıkan akışlar (basımın nereye gittiği; K-105 'NPC batma dolgusu görünür')\n", "| Tür | Akçe | Pay |", "|---|---|---|"]
    for k, v in sorted(L.city_out.items(), key=lambda kv: -kv[1]):
        o.append(f"| `{k}` | {v:,.0f} | {v / tot_out:.0%} |")
    o.append(f"\nToplam basım {L.minted:,.0f} Akçe = şehir kasalarının eksi bakiyeye düştüğü anların toplamı.")
    tot = L.total()
    checks = [("Para korunumu: Σ bakiye = basılan", abs(tot - L.minted) < 1e-9 * max(1.0, L.minted), f"Σ={tot:,.2f} basılan={L.minted:,.2f}"),
              ("Negatif bakiye yok", not [k for k, v in L.bal.items() if v < -1e-6], "—"),
              ("Her ücret ödendi ya da ayrılma kaydı düşüldü (K-23, K-57)", sum(r["wage_fail"] for r in weekly) == sum(r["separations"] for r in weekly), f"ödenemeyen: {sum(r['wage_fail'] for r in weekly)}, ayrılma kaydı: {sum(r['separations'] for r in weekly)}"),
              ("Her oyuncu ve çalışan NPC her döngü tam sepetini aldı (K-30, K-75)", sum(R["missed"].values()) == 0, f"eksik: {sum(R['missed'].values())} kişi-döngü")]
    o.append("\n## Değişmezler\n")
    for name, ok, detail in checks:
        o.append(f"- {'✅' if ok else '❌'} **{name}** — {detail}")
    dem, dl = sum(S["demanded"].values()), sum(S["delivered"].values())
    o += ["\n## Bilgi satırları\n",
          f"- Talebin karşılanan payı (birim): {dl / dem:.0%}" if dem else "- Talep yok",
          f"- Oyuncu firması: {len(R['player_firms'])}; içinde çalışan oyuncu: {last['in_pf']}",
          f"- NPC firma yeniden kuruluşu (batıp tekrar açılma): {L.flows['npc_yeniden_kurulus_adet']:.0f}; batan oyuncu firması: {L.flows['batan_oyuncu_firmasi_adet']:.0f}",
          f"- NPC göçü (kişi-hafta): {L.flows['goc_npc']:.0f}",
          "- Eksik sepet kalemi (kişi-döngü, bir kişi birden çok kalemde eksik olabilir): " + ", ".join(f"{k} {v}" for k, v in sorted(R["miss_item"].items(), key=lambda kv: -kv[1])),
          "- Sepet karşılama (K-153): kişi-döngünün %%%.1f'inde tüm sepet kalemleri en az %%95 karşılandı; ortalama kalem karşılaması %%%.1f (katı değişmez: her kalem %%99,9 ve herkes için; orantılı kıtlık paylaşımında hep ❌ çıkar)." % (100 * R["cov"].get("ok95", 0) / max(1, R["cov"].get("n", 1)), 100 * R["cov"].get("avg", 0) / max(1, R["cov"].get("n", 1))),
          "- Kısıt sayaçları (kişi-döngü): " + ", ".join(f"{k} {v}" for k, v in sorted(R["miss_reason"].items(), key=lambda kv: -kv[1])),
          "- Enerji (K-130): elektrik girdisi talebi %.0f birim, karşılanmayan %.0f (%.1f%%); kömür girdisi talebi %.0f, karşılanmayan %.0f. Son fiyat çarpanı (şehir 0–%d): elektrik %s, kömür %s. Kömür çıkaran şehirler: %s." % (
              S["in_want"][("elektrik", "girdi")], S["in_short"][("elektrik", "girdi")], 100 * S["in_short"][("elektrik", "girdi")] / max(1e-9, S["in_want"][("elektrik", "girdi")]),
              S["in_want"][("komur", "girdi")], S["in_short"][("komur", "girdi")], n_cities - 1,
              "/".join(f"{PM[(i, 'elektrik')]:.2f}" for i in range(n_cities)), "/".join(f"{PM[(i, 'komur')]:.2f}" for i in range(n_cities)), COAL_CITIES),
          "- Ulaşım ve güvenlik (K-140): çalışan sayısı ulaşım %d, güvenlik %d (ahırdan geçiş: oyuncu çıraklık ocağındaki sayı %d); şehir güvenlik düzeyi (koruma bulunurluğu) %s; ulaşım talebi (yolculuk) karşılanan %%%.0f; koruma girdisi karşılanan %%%.0f." % (
              sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "ulasim"), sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "guvenlik"),
              last["per_city"] and sum(c_["in_ahir"] for c_ in last["per_city"]),
              "/".join(f"{c.get('sec', 1.0):.2f}" for c in cities), 100 * S["delivered"]["yolculuk"] / max(1e-9, S["demanded"]["yolculuk"]),
              100 * (1 - S["in_short"][("koruma", "girdi")] / max(1e-9, S["in_want"][("koruma", "girdi")]))),
          ("- Turizm (K-138): sektör açılmadı." if not TOUR_STATE["on"] else
           "- Turizm (K-138): konaklama gelirinin şehir başına dağılımı (toplam / başka şehirden gelen turist payı): " + "; ".join(
               f"şehir {i} {R['tour_stat'].get(('gelir', i), 0.0):,.0f} / %{100 * R['tour_stat'].get(('turist', i), 0.0) / max(1.0, R['tour_stat'].get(('gelir', i), 0.0)):.0f}" for i in range(n_cities))
           + ". Şehir itibarı (tanıtım dahil): " + "/".join(f"{c['rep']:.0f}" for c in cities) + ". Turizm çalışanı: %d." % sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "otel" and not d.get("dead"))),
          "- Tecrübe basamağı (K-148, K-150): oyuncu çırak / kalfa / usta = %s; özel işyeri çalışanı (oyuncu+NPC) ortalama ücreti %.1f Akçe/döngü (çırak 10); **sepet / ortalama özel işyeri ücreti (şehir ortalaması, şehrin kendi fiyatı ve ücret endeksiyle) %%%.0f** (çırak ücretinde %%%.0f; hedef %%50–70); tecrübe verimi (şehir) %s. **Gini (iki ölçü, 100. haftadan sonra ortalama):** oyuncu likit-para (servet benzeri) Gini'si %.2f (gerçek servet ≈ 0,7–0,85), oyuncu haftalık gelir Gini'si %.2f (gerçek gelir ≈ 0,3–0,45), en zengin %%10'un gelir payı %%%.0f." % (
              " / ".join(str(sum(1 for i in R["people"].values() if i["who"] == "oyuncu" and i["tier"] == t_)) for t_ in range(3)),
              _pw_avg, 100 * _bk_avg / max(1e-9, _pw_avg), 100 * _bk_avg / max(1e-9, TIER_WAGE[0] * sum(WI.values()) / len(WI)),
              "/".join(f"{c.get('skill', 1.0):.2f}" for c in cities),
              _g_w, _g_i, 100 * _t_i),
          ("- Elektronik donanım (K-142): sektör açılmadı." if not HW_STATE["on"] else
           "- Elektronik donanım (K-142): açıldı hafta %d; bileşen firması %d (çalışan %d), bilgisayar/telefon firması %d (çalışan %d), kümülatif gelir bileşen %s / bilgisayar %s Akçe; üretim şehirleri (bileşen: %s; bilgisayar: %s); hane alımı (birim) %.0f; firmaların bilgisayar bulunurluğu (ort.) %.0f%%; verim çarpanı öncü %.2f (Ar-Ge dalı); donanım reel fiyat endeksi (başlangıç = 100, ücret endeksine bölünmüş) %.0f." % (
               HW_STATE["since"], sum(1 for d in R["firms"].values() if d["kind"] == "elektronik" and d["workers"]), sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "elektronik"),
               sum(1 for d in R["firms"].values() if d["kind"] == "bilgisayar" and d["workers"]), sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "bilgisayar"),
               f"{K['elektronik']['rev']:,.0f}", f"{K['bilgisayar']['rev']:,.0f}",
               "/".join(sorted({str(d["city"]) for d in R["firms"].values() if d["kind"] == "elektronik" and d["workers"]})) or "–", "/".join(sorted({str(d["city"]) for d in R["firms"].values() if d["kind"] == "bilgisayar" and d["workers"]})) or "–",
               S["delivered"]["bilgisayar"], 100 * (lambda v: sum(v) / len(v) if v else 0.0)([d.get("pc", 0.0) for d in R["firms"].values() if d["kind"] not in HW_CHAIN and d["workers"] and not d.get("dead")]),
               tech_f("donanim", FRONT["donanim"]), 100 * sum(LAND[(ci, "bilgisayar")] for ci in range(n_cities)) / n_cities / REF["bilgisayar"] / (sum(WI.values()) / len(WI)))),
          ("- Moda ve marka (K-147): sektör açılmadı." if not MODA_STATE["on"] else
           "- Moda ve marka (K-147): açıldı hafta %d; moda evi çalışanı şehir başına %s, kümülatif gelir %s Akçe; şehir marka düzeyi (reklam birikimi, 0–1) %s; moda çarpanı (fiyat primi dahil, teslim/başlangıç) %s; hane alımı (birim) %.0f; turizm konaklama gelirinin payı marka/itibar farkıyla birlikte yukarıda; şehir itibarı %s." % (
               MODA_STATE["since"], "/".join(str(sum(len(d["workers"]) for d in R["firms"].values() if d["kind"] == "moda" and d["city"] == i)) for i in range(n_cities)), f"{K['moda']['rev']:,.0f}",
               "/".join(f"{BRAND.get(i, 0.0):.2f}" for i in range(n_cities)), "/".join(f"{LAND[(i, 'moda')] / REF['moda']:.2f}" for i in range(n_cities)), S["delivered"]["moda"], "/".join(f"{c['rep']:.0f}" for c in cities))),
          "- Şehir uzmanlaşması (en çok çalışanlı üç ortak olmayan sektör; K-147): " + "; ".join(
              f"şehir {i}: " + ", ".join(f"{k} {n}" for k, n in sorted(((k, sum(len(d['workers']) for d in R['firms'].values() if d['kind'] == k and d['city'] == i)) for k in TOPO if k not in ('ahir', 'market', 'medya', 'belediye', 'lojistik', 'guvenlik', 'ulasim', 'firin', 'un')), key=lambda kv: -kv[1])[:3]) for i in range(n_cities))
          + ". Uzmanlaşma endeksi (sektör istihdam dağılımlarının birbirinden uzaklığı): 1. hafta %.2f, 8. hafta %.2f, 100. hafta %.2f, son hafta %.2f." % (
              weekly[0]["series"]["spec"], weekly[min(7, len(weekly) - 1)]["series"]["spec"], weekly[min(99, len(weekly) - 1)]["series"]["spec"], weekly[-1]["series"]["spec"]),
          ("- Yazılım (K-136): sektör açılmadı." if not SW_STATE["on"] else
           "- Yazılım (K-136): açıldı (olay listesine bakın); yazılım firması %d (oyuncu sahibi %d), kümülatif gelir %s Akçe, çalışan-döngü başına net %.1f Akçe (başabaş 12,5), firmaların ortalama benimsemesi %.0f%%; oyuncu servetinin %.0f%%'i yazılım firması sahiplerinde; yazılım alım bedeli şehirler arası navlunsuz." % (
               sum(1 for d in R["firms"].values() if d["kind"] == "yazilim" and not d.get("dead")), sum(1 for d in R["firms"].values() if d["kind"] == "yazilim" and d["owner"] and not d.get("dead")),
               f"{K['yazilim']['rev']:,.0f}", (K["yazilim"]["rev"] - K["yazilim"]["inp"] - K["yazilim"]["rent"]) / max(1, K["yazilim"]["wc"]), 100 * SW_STATE["adopt"],
               100 * sum(L.bal[d["owner"]] for d in R["firms"].values() if d["kind"] == "yazilim" and d["owner"] and not d.get("dead")) / max(1.0, sum(L.bal[q] for q, i in R["people"].items() if i["who"] == "oyuncu")))),
          "- Kredi ve faiz (K-158): %s; verilen kredi %.0f Akçe (%.0f adet), geri ödenen anapara %.0f, ödenen faiz %.0f, temerrüt %.0f firma (kayıp %.0f Akçe), kurucu ayrılıp batan %.0f (kayıp %.0f), büyüme kredisi %.0f adet, kalan kredi %.0f (%d firma); mevduat %.0f Akçe (%d mevduat sahibi), mevduat faizi geliri %.0f, havuz nakdi %.0f." % (
              "açık" if CREDIT_ON else "kapalı", L.flows["kredi_verilen"], L.flows["kredi_adet"], L.flows["kredi_geri"], L.flows["faiz"], L.flows["temerrut_adet"], L.flows["temerrut_kayip_akce"], L.flows["kurucu_ayrildi_batis_adet"], L.flows["batis_kayip_akce"], L.flows["buyume_kredisi_adet"], R["credit"]["out"], R["credit"]["n"], R["credit"]["dep"], R["credit"]["ndep"], L.flows["mevduat_faizi"], R["credit"]["pool"]),
          ("- Konut ve kira (K-159): kapalı." if not HOUSE_ON else
           "- Konut ve kira (K-159): kira toplam %.0f Akçe (konut_kirasi), ev sahibi kira geliri %.0f, konut satışı %.0f (şehir kasasına), yeni konut %d adet (inşaat harcaması %.0f); son konut stoku (şehir) %s, kira çarpanı %s; döngülük kira (çırak ücreti 10) %s; ev sahibi oyuncu sayısı %d (en çok sahip olan %d konut), konut mülkiyetinin en çok sahip olan %%10'daki payı %%%.0f; kira geliri / toplam oyuncu geliri son haftalık: bkz. gelir Gini'si." % (
               L.flows["konut_kirasi"], L.flows["konut_kira_geliri"], L.flows["konut_satisi"], L.flows["konut_yeni_adet"], L.flows["konut_insaat"],
               "/".join(f"{R['house']['hs'].get(i, 0):.0f}" for i in range(n_cities)), "/".join(f"{R['house']['RM'].get(i, 1.0):.2f}" for i in range(n_cities)), "/".join(f"{R['house']['rent'].get(i, 0):.2f}" for i in range(n_cities)),
               sum(1 for od_ in R["house"]["own"].values() for u_ in od_.values() if u_ > 0), max([u_ for od_ in R["house"]["own"].values() for u_ in od_.values()] or [0]),
               (lambda us: 100 * sum(sorted(us)[int(len(us) * 0.9):]) / max(1e-9, sum(us)))([u_ for od_ in R["house"]["own"].values() for u_ in od_.values()] or [0.0]))),
          f"- Alıcısız üretim (ref. değer, küm.): {sum(S['unsold'].values()):,.0f}"]
    if INNOV_ON:
        o += innov_report(R, weeks, n_cities)
    o += k183_report(R, weeks, n_cities)
    o += k185_report(R, weeks, n_cities)
    o += k187_report(R, weeks, n_cities)
    if "tsup" in R:
        o += trans_report_text(R, weeks)                  # K-211: yalnız TRANS_SUPPORT açıkken
    if "yk" in R:
        o += yk_report_text(R, weeks)                     # K-215/K-216: yalnız YOUNG_KIT/FOUND_FUND açıkken
    if "sbrd" in R:
        o += board_report_text(R, weeks)                  # K-212: yalnız SECTOR_BOARD açıkken
    evs = [e for r in weekly for e in r["events"]]
    o.append(f"\n## Olaylar\n\nToplam {len(evs)}.\n")
    for e in evs[:12]:
        o.append(f"- {e}")
    return "\n".join(o) + "\n"
