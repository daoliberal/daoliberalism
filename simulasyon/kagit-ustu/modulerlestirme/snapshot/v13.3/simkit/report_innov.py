"""simkit.report_innov: inovasyon raporu (K-167): itibar, inovatör DAO'ları, telif akışı, zenginliğin birikmesi; Gini/korelasyon yardımcıları.

ARAYÜZ: _gini, _corr, innov_report
OKUR: R (koşu sonucu; R['rt'] çalışma zamanı durumu). YAZAR: yok (metin üretir).
KATMAN: L10 (rapor; engine/step'ten bağımsız, yalnız R ve alan çekirdeklerini okur).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import isres, isrole
from simkit.tech_core import tech_f


def _gini(vals):
    v = sorted(vals)
    t = sum(v) or 1.0
    n = len(v)
    return sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(v)) / (n * t) if n else 0.0


def _corr(a, b):
    n = len(a)
    if n < 3:
        return 0.0
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va, vb = sum((x - ma) ** 2 for x in a), sum((y - mb) ** 2 for y in b)
    return cov / ((va * vb) ** 0.5) if va > 0 and vb > 0 else 0.0


def innov_report(R, weeks, n_cities):
    """K-167: itibar, inovatör DAO'ları, telif akışı, zenginliğin birikmesi."""
    LAND = R["rt"]["LAND"]      # adım 8: modül durumu yerine R genişletmesi
    REF = R["rt"]["REF"]      # adım 8: modül durumu yerine R genişletmesi
    I, L, people, firms, weekly = R["inn"], R["L"], R["people"], R["firms"], R["weekly"]
    REPv, inc = I["REP"], I["inc"]
    o = ["\n## K-167: inovasyon, itibar ve zenginliğin birikmesi\n"]
    pl = [q for q, i in people.items() if i["who"] == "oyuncu"]
    hown = defaultdict(float)
    for ci_, od_ in R["house"]["own"].items():
        for q_, u_ in od_.items():
            hown[q_] += u_ * R["house"]["rent"][ci_] * CYCLES_PER_WEEK / HOUSE_YIELD * (R["house"]["ratio"].get(ci_, 1.0) if HI_ACT else 1.0)
    mv_ = {q: sum(I["held"][p_].get(q, 0.0) * I["sh_price"][p_] * REF[p_] for p_ in I["held"]) for q in pl} if RESALE_ACT else {}
    wealth_book = {q: L.bal[q] + I["deposits"].get(q, 0.0) + hown.get(q, 0.0) + I["jval"].get(q, 0.0) for q in pl}
    wealth = {q: L.bal[q] + I["deposits"].get(q, 0.0) + hown.get(q, 0.0) + (mv_[q] if RESALE_ACT else I["jval"].get(q, 0.0)) for q in pl}
    # ---- A) itibar
    rv = sorted(REPv.get(q, 0.0) for q in pl)
    qn = lambda f: rv[min(len(rv) - 1, int(len(rv) * f))]
    o += ["### Kişi itibarı (K-11)\n",
          f"Kaynaklar: çalışılan hafta (tavan {REP_WORK_CAP:.0f}, τ={REP_WORK_TAU:.0f} hafta), kesilen fiş = ücreti ödenen çalışan-haftası (×{REP_FIS_RATE}, tavan {REP_FIS_CAP:.0f}), tutulan söz = tam ödenen kredi haftası (×{REP_SOZ_RATE}, tavan {REP_SOZ_CAP:.0f}, kapanış +{REP_SOZ_CLOSE:.0f}); ceza: batan firma/DAO -{REP_BANKRUPT:.0f}, temerrüt -{REP_DEFAULT:.0f}, ücret ödeyememe -{REP_WF} (haftalık %{REP_DECAY * 100:.1f} sönüm). Etkiler ({'açık' if REP_EFFECT else 'kapalı'}): işe alım sırası (itibar önce), kalfa/usta terfisi (eşik {REP_KALFA:.0f}/{REP_USTA:.0f}, sıra tecrübe × (1+itibar/100)), kuruluş kredisi limiti (%{CM_BASE * 100:.0f}–100) ve faizi (×{RM_LO}–{RM_HI}), yeni DAO kurucusu eşiği {REP_DAO:.0f}, lonca sahipliği eşiği {REP_OWNER:.0f}. Kayıt olayı: {L.flows['itibar_olayi_adet']:.0f}.\n",
          f"Dağılım (oyuncu): ortalama {sum(rv) / len(rv):.1f}; p10 {qn(.1):.1f} · p25 {qn(.25):.1f} · medyan {qn(.5):.1f} · p75 {qn(.75):.1f} · p90 {qn(.9):.1f} · en yüksek {rv[-1]:.1f}.\n",
          "| İtibar dilimi | Oyuncu | Ort. itibar | Haftalık gelir (son ~10 hf. ort.) | Servet (ort.) | Çalışıyor % | Kalfa+usta % | Firma sahibi % | Ort. işsizlik (hafta/oyuncu) |", "|---|---|---|---|---|---|---|---|---|"]
    byrep = sorted(pl, key=lambda q: REPv.get(q, 0.0))
    ownerset = {d["owner"] for f_, d in firms.items() if d.get("owner") in people and d["kind"] != "arge" and not d.get("dead")}
    for k in range(5):
        g = byrep[k * len(byrep) // 5:(k + 1) * len(byrep) // 5]
        o.append(f"| {k + 1}. beşte bir | {len(g)} | {sum(REPv.get(q, 0.0) for q in g) / len(g):.1f} | {sum(inc.get(q, 0.0) for q in g) / len(g):.1f} | {sum(wealth[q] for q in g) / len(g):,.0f} | "
                 f"{100 * sum(1 for q in g if people[q]['firm']) / len(g):.0f} | {100 * sum(1 for q in g if people[q]['tier'] >= 1) / len(g):.0f} | {100 * sum(1 for q in g if q in ownerset) / len(g):.1f} | "
                 f"{sum(I['unemp'].get(q, 0) for q in g) / CYCLES_PER_WEEK / len(g):.1f} |")
    o.append(f"\nİtibarın gelir ve servetle ilişkisi: korelasyon (itibar, haftalık gelir) {_corr([REPv.get(q, 0.0) for q in pl], [inc.get(q, 0.0) for q in pl]):.2f}; (itibar, servet) {_corr([REPv.get(q, 0.0) for q in pl], [wealth[q] for q in pl]):.2f}. Yorum: itibar çalışma süresiyle birlikte biriktiği için ve firma sahipleri/lonca sahipleri ek puan kazandığı için gelir/servetle pozitif ilişkilidir; nedensellik yönü iki yönlüdür (itibar kredi ve işe alım avantajı, gelir de itibar kaynağı).\n")
    # ---- B) roller
    roles = {}
    owners_lonca = {v[0]: lo for lo, v in I["lonca_owner"].items()}
    houseowner = {q for od_ in R["house"]["own"].values() for q, u_ in od_.items() if u_ > 0}
    for q in pl:
        i = people[q]
        if i.get("dao_active"):
            r_ = "inovatör DAO kurucusu"
        elif isres(i):
            r_ = "araştırmacı"
        elif q in owners_lonca:
            r_ = "lonca sahibi"
        elif MGR_ACT and isrole(i):
            r_ = "yönetici" if i.get("role") == "yonetici" else "uzman"
        elif q in ownerset:
            r_ = "firma sahibi"
        elif q in houseowner:
            r_ = "ev sahibi"
        elif i["firm"]:
            r_ = "çalışan"
        else:
            r_ = "işsiz"
        roles[q] = r_
    order = ["inovatör DAO kurucusu", "araştırmacı", "lonca sahibi", "yönetici", "uzman", "firma sahibi", "ev sahibi", "çalışan", "işsiz"]
    tw, ti = sum(wealth.values()) or 1.0, sum(inc.get(q, 0.0) for q in pl) or 1.0
    o += ["### Zenginlik ve gelir kimde toplanıyor (rol bazlı; her oyuncu tek role yazılır, öncelik sırası tablo sırasıdır)\n",
          "| Rol | Oyuncu | Oyuncu payı | Ort. servet | Servet payı | Ort. haftalık gelir | Gelir payı | Zengin %1'deki sayı | Zengin %10'daki sayı |", "|---|---|---|---|---|---|---|---|---|"]
    top = sorted(pl, key=lambda q: -wealth[q])
    t1, t10 = set(top[:max(1, len(pl) // 100)]), set(top[:len(pl) // 10])
    for r_ in order:
        g = [q for q in pl if roles[q] == r_]
        if not g:
            if r_ not in ("yönetici", "uzman") or MGR_ACT:
                o.append(f"| {r_} | 0 | – | – | – | – | – | 0 | 0 |")
            continue
        o.append(f"| {r_} | {len(g)} | %{100 * len(g) / len(pl):.1f} | {sum(wealth[q] for q in g) / len(g):,.0f} | %{100 * sum(wealth[q] for q in g) / tw:.1f} | {sum(inc.get(q, 0.0) for q in g) / len(g):.1f} | %{100 * sum(inc.get(q, 0.0) for q in g) / ti:.1f} | {sum(1 for q in g if q in t1)} | {sum(1 for q in g if q in t10)} |")
    sw = sorted(wealth.values())
    si = sorted(inc.get(q, 0.0) for q in pl)
    sh = lambda v, f: sum(v[int(len(v) * f):]) / (sum(v) or 1.0)
    tail = [r_["series"] for r_ in weekly[100:]] or [r_["series"] for r_ in weekly]
    o.append(f"\nServet Gini'si (son hafta) {_gini(sw):.2f} (100. haftadan sonra ort. {sum(x['gini'] for x in tail) / len(tail):.2f}); gelir Gini'si (son ~10 hafta sönümlü) {_gini(si):.2f} (100. haftadan sonra haftalık ort. {sum(x['gini_inc'] for x in tail) / len(tail):.2f}). Servet payları: en zengin %1 {100 * sh(sw, .99):.0f}, %10 {100 * sh(sw, .9):.0f}, alt %50 {100 * (1 - sh(sw, .5)):.1f}. Gelir payları: en zengin %1 {100 * sh(si, .99):.0f}, %10 {100 * sh(si, .9):.0f}, alt %50 {100 * (1 - sh(si, .5)):.0f}. Gerçek dünya: servet Gini'si 0,7–0,85, gelir Gini'si 0,30–0,45.\n")
    # ---- C) DAO
    daos = I["dao_all"]
    alive = [n for n in daos if not firms[n].get("dead")]
    first30 = [n for n in daos if I["dao_info"][n]["initial"]]
    dead = [n for n in daos if firms[n].get("dead")]
    life = [firms[n]["died"] - firms[n]["born"] for n in dead]
    res_now = sum(len(firms[n]["workers"]) for n in alive)
    o += ["### Ar-Ge DAO'ları\n",
          f"Kurulan {len(daos)} (ilk dalga {len(first30)}); hayatta {len(alive)}, batan {len(dead)} (ort. ömür {sum(life) / max(1, len(life)):.0f} hafta). İlk dalgadan hayatta kalan {sum(1 for n in first30 if not firms[n].get('dead'))}/{len(first30)}. Şu an çalışan araştırmacı (kurucu dahil) {res_now}; araştırmacı ücreti toplamı {L.flows['arastirmaci_ucreti']:,.0f}, sözleşme geliri {L.flows['arge_sozlesmesi']:,.0f}, telif geliri {L.flows['telif_uye'] + L.flows['telif_dis']:,.0f} (üye {L.flows['telif_uye']:,.0f} / dış {L.flows['telif_dis']:,.0f}), DAO kâr dağıtımı {L.flows['dao_payi']:,.0f}, batışta lonca havuzu kaybı {L.flows['dao_batis_kayip_akce']:,.0f}, işe alınan araştırmacı {L.flows['arastirmaci_alim_adet']:.0f}, çıkarılan {L.flows['arastirmaci_cikarma_adet']:.0f}. Araştırmacı ücret çarpanı (arz-talep, şehir): " + " / ".join(f"{I['RWI'].get(i, 1.0):.2f}" for i in range(n_cities)) + ".\n",
          "| Hafta | DAO | Araştırmacı | Ar-Ge ücreti (hf.) | Sözleşme (hf.) | Telif (hf.) | Ar-Ge ücreti / tüm ücret | Ort. itibar | Lonca sahibi |", "|---|---|---|---|---|---|---|---|---|"]
    for r_ in weekly:
        if r_["week"] % (10 if weeks <= 200 else 25) == 0 or r_["week"] == weeks:
            x = r_["series"]["inn"]
            o.append(f"| {r_['week']} | {x['dao']} | {x['res']} | {x['resw']:,.0f} | {x['contract']:,.0f} | {x['telif']:,.0f} | %{100 * x['resw'] / max(1.0, x['wages']):.1f} | {x['repm']:.1f} | {x['owners']} |")
    o.append("\nDAO'lar (ilk dalga ve en çok kazanan 12; kazanç = telif + sözleşme geliri − araştırmacı ücreti; kurucu net = kâr dağıtımı):\n")
    o += ["| DAO | Şehir | Lonca | Dal(lar) | Doğum–ölüm | Tepe kadro | Düzey K (en iyi) | Telif | Sözleşme | Ücret ödenen | Net (DAO) | Dağıtılan | Durum |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    net = {n: I["dao_tel"].get(n, 0.0) + I["dao_con"].get(n, 0.0) - I["res_spent"].get(n, 0.0) for n in daos}
    show = list(dict.fromkeys(first30 + sorted(daos, key=lambda n: -net[n])[:12]))
    for n in show:
        d = firms[n]
        inf = I["dao_info"][n]
        o.append(f"| {n} | {d['city']} | {d['lonca']} | {'/'.join(inf['branches'])} | {d['born']}–{d.get('died', '…')} | {inf['peak']} | {max(I['KD'][n].values()):,.0f} | {I['dao_tel'].get(n, 0):,.0f} | {I['dao_con'].get(n, 0):,.0f} | {I['res_spent'].get(n, 0):,.0f} | {net[n]:,.0f} | {I['dao_pay'].get(n, 0):,.0f} | {'batti' if d.get('dead') else 'hayatta'} |")
    tel = sorted(I["dao_tel"].get(n, 0.0) for n in daos)
    win = [n for n in daos if net[n] > 0]
    o.append(f"\nKazanan (net > 0) {len(win)}, kaybeden {len(daos) - len(win)}; telif gelirinin DAO'lar arası Gini'si {_gini(tel):.2f}, en çok kazanan %10'un telif payı %{100 * sh(tel, .9):.0f}; hayatta kalanların (hayatta {len(alive)}) telif payı %{100 * sum(I['dao_tel'].get(n, 0) for n in alive) / max(1.0, sum(tel)):.0f}.\n")
    # ---- D) patent, telif, rekabet
    o += ["### Patent, telif oranı ve rekabet (sahip eki: bağımsız buluş, üye oranı = dış oranın 1/3'ü)\n",
          f"Patent süresi {PATENT_TERM} hafta; süre bitince buluş kamu malı olur (kendiliğinden bedava yayılma yok). Telif tavanı %{TELIF_X0 * 100:.0f}, tabanı %{TELIF_XMIN * 100:.0f}; tekel DAO verim kazancının en çok %{TELIF_KEEP * 100:.0f}'ini ister; rakip varsa oran, rakibin sunduğu net kazancı geçmeyecek şekilde haftalık {UNDERCUT * 100:.2f} puan altına iner. Üye oranı = dış × {TELIF_MEMBER_RATIO:.2f}.\n",
          "| Dal | DAO sayısı (patent düzeyi ≥ 500, hep) | Hayatta | Patentsiz hafta | Tek mucitli hafta (tekel) | Çok mucitli hafta | Kamu malı düzeyi (verim) | Öncü verim |", "|---|---|---|---|---|---|---|---|"]
    for b in BRANCHES:
        inv = [n for n in daos if I["KD"][n].get(b, 0.0) >= 500]
        o.append(f"| {b} | {len(inv)} | {sum(1 for n in inv if not firms[n].get('dead'))} | {I['mono'][b][0]} | {I['mono'][b][1]} | {I['mono'][b][2]} | {tech_f(b, I['PUB'][b]):.2f} | {tech_f(b, I['FRONT'][b]):.2f} |")
    o += ["\nTelif oranlarının seyri (dal: mucit sayısı, en düşük–en yüksek dış oran %):\n", "| Hafta | " + " | ".join(BRANCHES) + " |", "|---|" + "---|" * len(BRANCHES)]
    step = max(1, len(I["xr_hist"]) // 10)
    rows = I["xr_hist"][::step]
    if I["xr_hist"] and rows[-1][0] != I["xr_hist"][-1][0]:
        rows.append(I["xr_hist"][-1])
    for w_, row in rows:
        o.append(f"| {w_} | " + " | ".join((f"{row[b][0]}: %{row[b][1] * 100:.1f}–{row[b][2] * 100:.1f}" if row[b][0] else "–") for b in BRANCHES) + " |")
    if I["lic_hist"]:
        w_, cur, paths = I["lic_hist"][-1]
        o.append(f"\nFirma teknoloji yolu (hafta {w_}): " + ", ".join(f"{k} {v}" for k, v in sorted(paths.items())) + ".")
        o.append("Lisans payları (hangi DAO'nun/loncanın lisansı kaç firmada, en çok 10): " + ", ".join(f"{n} ({'DAO' if n in firms and firms[n]['kind'] == 'arge' else 'lonca'}; {firms[n]['lonca'] if n in firms else n}) {c}" for n, c in sorted(cur.items(), key=lambda kv: -kv[1])[:10]) + ".")
    tmx = I["telif_mx"]
    o += ["\nTelif akışı (kümülatif Akçe; satır ödeyen firmanın şehri, sütun alan DAO/lonca şehri):\n", "| | " + " | ".join(f"→ {j}" for j in range(n_cities)) + " | Toplam |", "|---|" + "---|" * (n_cities + 1)]
    for i in range(n_cities):
        o.append(f"| {i} | " + " | ".join(f"{tmx.get((i, j), 0):,.0f}" for j in range(n_cities)) + f" | {sum(tmx.get((i, j), 0) for j in range(n_cities)):,.0f} |")
    o.append("\nTelifi ödeyen sektör (dal, kümülatif Akçe): " + ", ".join(f"{b} {v:,.0f}" for b, v in sorted(I["telif_br"].items(), key=lambda kv: -kv[1])) + f". DAO ölüm nedeni: ücret ödenemedi {L.flows['batan_dao_ucret_odenemedi']:.0f}, kredi temerrüdü {L.flows['batan_dao_temerrut']:.0f}.")
    o.append(f"\nÜye / dış telif ayrımı: `telif_uye` {L.flows['telif_uye']:,.0f} Akçe, `telif_dis` {L.flows['telif_dis']:,.0f} Akçe (üye payı %{100 * L.flows['telif_uye'] / max(1.0, L.flows['telif_uye'] + L.flows['telif_dis']):.0f}); lonca_fee (DAO'nun telif gelirinden loncaya) dahil. Rakip tasarımla açılan ürün firması: {L.flows['rakip_urun_firmasi_adet']:.0f}.")
    LOL = I["loncas"] if NL_ACT else [f"lonca{i}" for i in range(6)]
    o += ["\nFirmaların lonca dağılımı (canlı, ortak olmayan; üyelik telif indirimini belirler) ve loncanın DAO sayısı:\n", "| Hafta | " + " | ".join(LOL) + " |", "|---|" + "---|" * len(LOL)]
    for w_, cnt in I["mem_hist"][::max(1, len(I["mem_hist"]) // 6)]:
        o.append(f"| {w_} | " + " | ".join(str(cnt.get(l_, 0)) for l_ in LOL) + " |")
    pf = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
    o.append("\nOyuncu firmalarının seçtiği lonca (kurulan, tümü) / canlı DAO / lonca sahibi: " + "; ".join(f"{l_}: {sum(1 for d in pf if d['lonca'] == l_)} / {sum(1 for n in alive if firms[n]['lonca'] == l_)} / {I['lonca_owner'].get(l_, ('–',))[0]}" for l_ in LOL) + ". Not: lonca fee'si tek (%5) olduğundan loncalar arası fee rekabeti modelde yok (sahibe soru); üye akışı yalnız telif indirimi ve kredi bulunurluğuyla belirlenir.")
    # ---- E) lonca sahipleri
    o += ["\n### Lonca sahipleri (kurucu payı sahibe gider; K-73 yalnız sahipsiz loncalar için)\n", "| Lonca | Sahip | Başlangıç haftası | İtibar | Kurucu payı geliri (kümülatif) | Servet | Rol |", "|---|---|---|---|---|---|---|"]
    for lo in sorted(I["lonca_owner"]):
        q, w0 = I["lonca_owner"][lo]
        o.append(f"| {lo} | {q} | {w0} | {REPv.get(q, 0):.1f} | {I['owner_rec'].get(lo, 0):,.0f} | {wealth.get(q, 0):,.0f} | {roles.get(q, '–')} |")
    o.append(f"\nSahipsiz kalan lonca payı şehir kasalarına gitti (`kurucu_payi` toplamı {L.flows['kurucu_payi']:,.0f}, sahiplere giden {sum(I['owner_rec'].values()):,.0f}).")
    # ---- F) ölüm ve hayatta kalma
    causes = defaultdict(float)
    for k, v in L.flows.items():
        if k.startswith("olum_"):
            causes[k.split("_", 2)[2]] += v
    pfs = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
    surv = []
    for h in (4, 13, 26, 52, 104):
        els = [d for d in pfs if weeks - d["born"] >= h]
        surv.append(f"{h} hf. %{100 * sum(1 for d in els if (d.get('died', 10 ** 9) - d['born']) >= h) / max(1, len(els)):.0f} (n={len(els)})")
    o += ["\n### Oyuncu firmalarının hayatta kalması ve ölüm nedeni\n",
          f"Kurulan {len(pfs)}, batan {sum(1 for d in pfs if d.get('dead'))}. Hayatta kalma: " + "; ".join(surv) + ". Ölüm nedeni (küm.): " + ", ".join(f"{k} {v:.0f}" for k, v in sorted(causes.items(), key=lambda kv: -kv[1])) + ". `teknoloji_geride` = ince marjla batan ve verimi öncü seçeneğin %" + f"{GAP_DEATH * 100 / LABOR_SHARE:.1f}" + "'inden fazla geride olan firma (batanlar batar, inovasyon kazanır).\n"]
    # ---- K-170: fee rekabeti, inovatör yolları, yönetici/uzman
    _k170 = len(o)
    o.append("\n### K-170: lonca fee rekabeti\n")
    if FEE_ACT:
        o += [f"Lonca sahibi oyuncu (hafta {OWNER_WEEK}'ten sonra) {FEE_EVERY} haftada bir fee'yi {FEE_STEP * 100:.1f} puan oynatır: tahsilat arttıysa aynı yönde, %3'ten fazla düştüyse ters yönde (tepe tırmanma); taban %{FEE_MIN * 100:.0f}, tavan %{FEE_MAX * 100:.0f}. Firma her {SWITCH_EVAL} haftada bir (kuyruk sırasıyla kaydırılmış) lonca skorunu hesaplar: fee + telif oranı (üyeyse 1/3) − kredi havuzu doluluğu × {CREDIT_W}; en iyi skor mevcuttan en az {SWITCH_GAIN * 100:.1f} puan düşükse geçer, geçişten sonra {SWITCH_COOL} hafta bekler. Toplam geçiş: {L.flows['lonca_gecis_adet']:.0f}; fee değişikliği: {L.flows['fee_degisim_adet']:.0f}.\n",
              "| Hafta | " + " | ".join(LOL) + " | Ortalama |", "|---|" + "---|" * (len(LOL) + 1)]
        fh = I["fee_hist"]
        for w_, fe in fh[::max(1, len(fh) // 10)] + ([fh[-1]] if fh else []):
            o.append(f"| {w_} | " + " | ".join((f"%{fe.get(l_, LONCA_FEE) * 100:.1f}" if (not NL_ACT or l_ in fe) else "–") for l_ in LOL) + f" | %{sum(fe.values()) / len(fe) * 100:.1f} |")
        o += ["", "| Lonca | Son fee | Toplam fee tahsilatı | Kurucu payı (sahibe) | Geçişle gelen firma | Canlı üye firma (son) | Sahip | Sahip serveti |", "|---|---|---|---|---|---|---|---|"]
        mh = I["mem_hist"][-1][1] if I["mem_hist"] else {}
        for lo in LOL:
            q = I["lonca_owner"].get(lo, ("–",))[0]
            o.append(f"| {lo} | %{I['FEES'].get(lo, LONCA_FEE) * 100:.1f} | {I['fee_inc'].get(lo, 0):,.0f} | {I['owner_rec'].get(lo, 0):,.0f} | {I['switches'].get(lo, 0)} | {mh.get(lo, 0)} | {q} | {wealth.get(q, 0):,.0f} |")
        so = sorted((wealth.get(v[0], 0) for v in I["lonca_owner"].values()), reverse=True)
        o.append(f"\nLonca sahibi 6 kişinin toplam servet payı %{100 * sum(so) / tw:.0f} (v11.0: %52, tek fee). Fee dağılımı (en düşük–en yüksek) %{min(I['FEES'].values()) * 100:.1f}–{max(I['FEES'].values()) * 100:.1f}.\n")
    else:
        o.append("Fee rekabeti kapalı (`FEE_ON=0`): tek fee.\n")
    o.append("### K-170: inovatör yolları\n")
    if PATH_ACT:
        paths = defaultdict(list)
        for q in pl:
            if people[q].get("innov"):
                paths[people[q].get("path")].append(q)
        o += [f"Şehirde 30 inovatör sırayla {', '.join(PATH_CYCLE)} yoluna dağılır: DAO adayı (itibar ve sermaye eşikli, kuruluşta hafta {DAO_START}'dan sonra), araştırmacı (Ar-Ge bütçesinin karşıladığı kadarı çalışır), inovatör firma sahibi (kurdukları firmada çalışan başına çıktı +%{INNOV_FIRM_GAIN * 100:.0f} ve lisansta üye oranı), uzman (teknoloji yoğun sektörde yüksek ücretli meslek, düşük eşikle). Diğer 270 oyuncu normal yoldadır.\n",
              "| Yol | Kişi | Ort. servet | Ort. haftalık gelir | Zengin %10'da | Sonda DAO kurucusu / araştırmacı / yönetici-uzman / firma sahibi / çalışan / işsiz | Kurduğu firma (canlı+batan) |", "|---|---|---|---|---|---|---|"]
        for pth in PATH_CYCLE[:1] + ("firma", "uzman", "arastirmaci"):
            g = paths.get(pth, [])
            if not g:
                continue
            rc = defaultdict(int)
            for q in g:
                rc[roles[q]] += 1
            nf = sum(1 for d in firms.values() if d.get("owner") in set(g) and d["kind"] != "arge")
            o.append(f"| {pth} | {len(g)} | {sum(wealth[q] for q in g) / len(g):,.0f} | {sum(inc.get(q, 0.0) for q in g) / len(g):.1f} | {sum(1 for q in g if q in t10)} | {rc['inovatör DAO kurucusu']} / {rc['araştırmacı']} / {rc['yönetici'] + rc['uzman']} / {rc['firma sahibi']} / {rc['çalışan'] + rc['ev sahibi'] + rc['lonca sahibi']} / {rc['işsiz']} | {nf} |")
        rest = [q for q in pl if not people[q].get("innov")]
        o.append(f"| (inovatör değil) | {len(rest)} | {sum(wealth[q] for q in rest) / len(rest):,.0f} | {sum(inc.get(q, 0.0) for q in rest) / len(rest):.1f} | {sum(1 for q in rest if q in t10)} | – | – |")
        ifirms = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
        a = [d for d in ifirms if d.get("innov_owner")]
        b_ = [d for d in ifirms if not d.get("innov_owner")]
        sv = lambda ds, h: 100 * sum(1 for d in ds if (d.get('died', 10 ** 9) - d['born']) >= h) / max(1, sum(1 for d in ds if weeks - d['born'] >= h))
        o.append(f"\nOyuncu firması hayatta kalma, inovatör sahipli (n={len(a)}) / diğer (n={len(b_)}): 26 hf %{sv(a, 26):.0f} / %{sv(b_, 26):.0f}; 52 hf %{sv(a, 52):.0f} / %{sv(b_, 52):.0f}.\n")
    else:
        o.append("Yol dağılımı kapalı (`PATH_ON=0`): tüm inovatörler yalnız DAO kurucusu/araştırmacı.\n")
    o.append("### K-170: yönetici ve uzman (yüksek ücretli meslek katmanı)\n")
    if MGR_ACT:
        mg = [q for q in pl if roles[q] == "yönetici"]
        sp = [q for q in pl if roles[q] == "uzman"]
        avg_w = lambda g: sum(people[q]["wage"] for q in g) / max(1, len(g))
        o += [f"Çalışanı {MGR_MIN}+ olan firma her {MGR_SPAN} çalışana bir yönetici (firma geneli verim +%{MGR_GAIN * 100:.0f}), teknoloji yoğun sektörde ({', '.join(SPEC_KINDS[:6])}…) {SPEC_MIN}+ çalışanlı firma her {SPEC_SPAN} çalışana bir uzman (verim +%{SPEC_GAIN * 100:.0f}) alır. Eşik: yönetici {MGR_WEEKS} hafta özel işyeri kıdemi ve itibar ≥ {MGR_REP:.0f}; uzman {SPEC_WEEKS} hafta ve itibar ≥ {SPEC_REP:.0f} (inovatör: {SPEC_WEEKS_INNOV} hafta, itibar ≥ {SPEC_REP_INNOV:.0f}, öncelikli). Ücret: yönetici usta × {MGR_MULT}, uzman usta × {SPEC_MULT}, × ücret endeksi × arz-talep çarpanı (doldurulamayan kadro varsa ×{1 + MWI_STEP} haftalık, tavan {MWI_MAX}). Son hafta: yönetici {len(mg)} (ort. ücret {avg_w(mg):.1f} Akçe/döngü), uzman {len(sp)} (ort. {avg_w(sp):.1f}); çarpan {I['mgr_stat'][-1][3] if I['mgr_stat'] else 1.0:.2f}; toplam atama: yönetici {L.flows['yonetici_atama_adet']:.0f}, uzman {L.flows['uzman_atama_adet']:.0f}; ödenen yönetici ücreti {L.flows['yonetici_ucreti']:,.0f}, uzman ücreti {L.flows['uzman_ucreti']:,.0f} (tüm ücretlerin %{100 * (L.flows['yonetici_ucreti'] + L.flows['uzman_ucreti']) / max(1.0, L.flows['ucret'] + L.flows['yonetici_ucreti'] + L.flows['uzman_ucreti'] + L.flows['arastirmaci_ucreti']):.1f}'i). İnovatör uzman oranı: {sum(1 for q in sp if people[q].get('innov'))}/{len(sp)}.\n",
              "| Hafta | Yönetici | Uzman | Doldurulamayan kadro | Ücret çarpanı |", "|---|---|---|---|---|"]
        for r_ in weekly:
            if r_["week"] % (25 if weeks > 200 else 10) == 0 or r_["week"] == weeks:
                ms = next((m_ for m_ in I["mgr_stat"] if m_[0] == r_["week"]), None)
                x = r_["series"]["inn"]
                o.append(f"| {r_['week']} | {x['mgr']} | {x['spec']} | {ms[2] if ms else 0} | {x['mwi']:.2f} |")
        top = sorted(pl, key=lambda q: -inc.get(q, 0.0))
        ti10 = sum(inc.get(q, 0.0) for q in top[:len(top) // 10]) / ti
        o.append(f"\nGelir Gini'si (son hafta, sönümlü) {_gini(si):.2f}; en zengin %10'un gelir payı %{100 * ti10:.0f} (hedef ~%30–40; gerçek gelir Gini'si 0,30–0,45). Yönetici/uzman maliyetinin firma marjına etkisi: fiyat çıpası birim emek maliyetini (ulc) ortalama ücretten türettiği için maliyet fiyata yansır; yalnız eşiği aşan firma alır. Yönetici/uzman bulunan firma sayısı (son): {sum(1 for d in firms.values() if d.get('mgr_mult') and not d.get('dead') and d['workers'])}.\n")
    else:
        o.append("Yönetici/uzman kapalı (`MGR_ON=0`).\n")
    if WEALTH_TAX > 0 or RENT_TAX > 0:
        o.append(f"### K-170: servet/kira vergisi (deneme varyantı; varsayılan kapalı)\n\nServet vergisi haftalık %{WEALTH_TAX * 100:.2f} ({WT_FLOOR:,.0f} Akçe üstü), kira vergisi %{RENT_TAX * 100:.0f}: toplanan servet vergisi {L.flows['servet_vergisi']:,.0f}, kira vergisi {L.flows['kira_vergisi']:,.0f} Akçe; şehir kasaları toplamı {sum(L.bal[c_['acct']] for c_ in R['cities']):,.0f}.\n")
    if not (FEE_ACT or PATH_ACT or MGR_ACT or WEALTH_TAX > 0 or RENT_TAX > 0):
        del o[_k170:]
    # ---- K-172: hayat düzeyleri ve lüks tüketim kataloğu
    if LIFE_ACT:
        o.append("\n### K-172: hayat düzeyleri ve lüks tüketim kataloğu\n")
        scale_ = sum(sum(LAND[(ci_, p_)] * q_ for p_, q_ in BASKET.items()) for ci_ in range(n_cities)) / n_cities / sum(REF[p_] * q_ for p_, q_ in BASKET.items())
        hb = I["hab"]
        lvl_of = {q: (lambda m_: 0 if m_ < LEVEL_CUTS[0] else (1 if m_ < LEVEL_CUTS[1] else 2))(hb.get(q, 0.0) * 28 / scale_) for q in pl}
        o += [f"Bütçe = 0,9 × y × (y / yref)^-0,15 + servetin döngü başına %{WSPEND * 100:.1f}'i (tampon üstü); y = son gelir (sönümlü), alışkanlıkla yumuşatılır (artışta %{HAB_UP * 100:.0f}, düşüşte %{HAB_DOWN * 100:.0f} / döngü). Sepet ve kira sonrası kalan, esnekliğe göre kataloğa dağılır (esneklik: dayanıklı {LIFE_CATS['dur'][1]}, yazılım {LIFE_CATS['yazilim'][1]}, donanım {LIFE_CATS['hw'][1]}, restoran {LIFE_CATS['restoran'][1]}, eğlence {LIFE_CATS['eglence'][1]}, moda {LIFE_CATS['moda'][1]}, seyahat {LIFE_CATS['seyahat'][1]}, mücevher {LIFE_CATS['mucevher'][1]}, büyük konut {LIFE_CATS['konut'][1]}). Düzey sınırları (aylık = 28 döngü, bugünkü fiyatla; fiyat ölçeği {scale_:.2f}): normal < {LEVEL_CUTS[0]:.0f} ≤ rahat < {LEVEL_CUTS[1]:.0f} ≤ lüks. Hedef bütçeler: normal ~270, rahat ~800–1.000, lüks ~2.500–3.000.\n",
              "| Düzey | Oyuncu (son hafta) | Ort. aylık harcama (bugünkü fiyat) | Hedef | Kimler (rol dağılımı) |", "|---|---|---|---|---|"]
        for lv, nm, tg in ((0, "Normal", "~270"), (1, "Rahat", "~800–1.000"), (2, "Lüks", "~2.500–3.000")):
            g = [q for q in pl if lvl_of[q] == lv]
            rc = defaultdict(int)
            for q in g:
                rc[roles[q]] += 1
            o.append(f"| {nm} | {len(g)} | {sum(hb.get(q, 0.0) * 28 / scale_ for q in g) / max(1, len(g)):,.0f} | {tg} | " + ", ".join(f"{k} {v}" for k, v in sorted(rc.items(), key=lambda kv: -kv[1])[:5]) + " |")
        ms = sorted(hb.get(q, 0.0) * 28 / scale_ for q in pl)
        o.append(f"\nAylık harcama dağılımı (oyuncu): medyan {ms[len(ms) // 2]:,.0f}, p90 {ms[int(len(ms) * .9)]:,.0f}, p99 {ms[int(len(ms) * .99)]:,.0f}, en yüksek {ms[-1]:,.0f}; en zengin %10 / en zengin %1 harcaması medyanın {sum(ms[int(len(ms) * .9):]) / max(1, len(ms) - int(len(ms) * .9)) / ms[len(ms) // 2]:.1f} / {sum(ms[int(len(ms) * .99):]) / max(1, len(ms) - int(len(ms) * .99)) / ms[len(ms) // 2]:.1f} katı (gerçek: 3–4 / ~10).\n")
        cats = ["dayanıklı", "moda", "donanım", "yazılım", "seyahat", "restoran", "sanat/eğlence", "mücevher", "büyük konut"]
        o += ["Sepet dışı harcamanın kalemlere dağılımı (son 20 hafta, harcama payı %; son sütun toplam harcamanın sepet payı):\n", "| Düzey | " + " | ".join(cats) + " | Sepet payı |", "|---|" + "---|" * (len(cats) + 1)]
        for lv, nm in ((0, "Normal"), (1, "Rahat"), (2, "Lüks")):
            tot = sum(v for (l_, c_), v in I["lvl_cat"].items() if l_ == lv)
            ex = max(1e-9, tot - I["lvl_cat"].get((lv, "sepet"), 0.0))
            o.append(f"| {nm} | " + " | ".join(f"{100 * I['lvl_cat'].get((lv, c_), 0.0) / ex:.0f}" for c_ in cats) + f" | %{100 * I['lvl_cat'].get((lv, 'sepet'), 0.0) / max(1e-9, tot):.0f} |")
        o.append("\n(Seyahat satırı yalnız konaklamadır; seyahat bütçesinin %40'ı yolculuğa gider ve sepet kalemi içinde görünür. Turizm açılmadıysa seyahat payı diğer kalemlere dağılır.)\n")
        o += ["Yeni sektörler (K-172): işyeri, istihdam, ücret, ciro; şehir dağılımı = kümülatif çalışan-döngü payı (şehir 0–4):\n",
              "| Sektör | NPC firma (canlı) | Oyuncu firması (kurulan / canlı) | Çalışan (son) | Ort. ücret (döngü) | Ciro (küm.) | Ücret / ciro | Şehir dağılımı % | Başabaş net/çalışan-döngü |", "|---|---|---|---|---|---|---|---|---|"]
        for k in ("restoran", "eglence", "kuyumcu", "maden_altin", "insaat", "otel", "moda"):
            fs = [d for d in firms.values() if d["kind"] == k]
            npc_alive = sum(1 for d in fs if d["owner"] is None and not d.get("dead"))
            pf_ = [d for d in fs if d["owner"] is not None]
            wk = sum(len(d["workers"]) for d in fs if not d.get("dead"))
            kwv = I["kw"].get(k, 0.0)
            wc = sum(v for (kk, c_), v in I["kcity"].items() if kk == k)
            cs = [I["kcity"].get((k, c_), 0.0) for c_ in range(n_cities)]
            rv = R["kind_stats"][k]["rev"]
            net = (R["kind_stats"][k]["rev"] - R["kind_stats"][k]["inp"] - R["kind_stats"][k]["rent"]) / max(1, R["kind_stats"][k]["wc"])
            o.append(f"| {k} | {npc_alive} | {len(pf_)} / {sum(1 for d in pf_ if not d.get('dead'))} | {wk} | {kwv / max(1.0, wc):.1f} | {rv:,.0f} | %{100 * kwv / max(1.0, rv):.0f} | " + " / ".join(f"{100 * c_ / max(1.0, sum(cs)):.0f}" for c_ in cs) + f" | {net:.1f} |")
        lux_cats = ("moda", "donanım", "yazılım", "seyahat", "restoran", "sanat/eğlence", "mücevher", "büyük konut")
        lux_sp = sum(v for (l_, c_), v in I["lvl_cat"].items() if c_ in lux_cats)
        top_sp = sum(v for (l_, c_), v in I["lvl_cat"].items() if c_ in lux_cats and l_ == 2)
        wr = {"restoran": "restoran", "sanat/eğlence": "eglence", "mücevher": "kuyumcu", "büyük konut": "insaat", "seyahat": "otel", "moda": "moda"}
        wsum = 0.0
        for c_, kd in wr.items():
            sp_ = sum(v for (l_, cc_), v in I["lvl_cat"].items() if cc_ == c_)
            rvk = R["kind_stats"][kd]["rev"]
            wsum += sp_ * (I["kw"].get(kd, 0.0) / max(1.0, rvk) if rvk > 0 else 0.0)
        o.append(f"\nPara dolaşımı: son 20 haftada oyuncuların sepet dışı lüks kalemlere (moda, donanım, yazılım, seyahat, restoran, eğlence, mücevher, büyük konut) harcaması {lux_sp:,.0f} Akçe (lüks düzeyin payı %{100 * top_sp / max(1.0, lux_sp):.0f}); sektörlerin ciro başına ücret oranıyla ağırlıklandırılmış tahmin: bu harcamanın ~%{100 * wsum / max(1.0, lux_sp):.0f}'i ücret olarak çalışanlara döndü, kalanı girdi, fee, vergi ve firma kârına gitti. Şehir kasaları toplamı {sum(L.bal[c_['acct']] for c_ in R['cities']):,.0f}; son hafta istihdam {weekly[-1]['series']['employed']:,}; talep karşılama %{100 * weekly[-1]['series']['got'] / max(1e-9, weekly[-1]['series']['dem']):.0f}.\n")
        pfs_ = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
        newk = ("restoran", "eglence", "kuyumcu", "maden_altin", "insaat")
        a_ = [d for d in pfs_ if d["kind"] in newk]
        b2 = [d for d in pfs_ if d["kind"] not in newk]
        sv2 = lambda ds, h: (100.0 * sum(1 for d in ds if (d.get('died', 10 ** 9) - d['born']) >= h and weeks - d['born'] >= h) / sum(1 for d in ds if weeks - d['born'] >= h)) if any(weeks - d['born'] >= h for d in ds) else float('nan')
        o.append(f"Oyuncu firması 52 hafta hayatta kalma: yeni lüks sektörlerde (n={len(a_)}) %{sv2(a_, 52):.0f}, diğer sektörlerde (n={len(b2)}) %{sv2(b2, 52):.0f}; 26 hafta %{sv2(a_, 26):.0f} / %{sv2(b2, 26):.0f}.\n")
        evs_ = [e for e in R["tech_events"] if "kapandı" in e or "yeniden kuruldu" in e]
        o.append(f"Lonca batışı (K-171): kapanan {L.flows['lonca_kapanis_adet']:.0f}, yeniden kurulan {L.flows['lonca_kurulus_adet']:.0f}; kapalı slot: {', '.join(sorted(I['closed'])) or '–'}. " + (" ".join(evs_[:6]) if evs_ else "Üye sayısı eşiğin (≤ %d) altında 12 hafta kalan ve kasası 500 Akçe altında lonca olmadı." % LONCA_MIN_MEMBERS) + "\n")
        w10 = sorted(wealth.values())
        o.append(f"Servet Gini'si {_gini(w10):.2f} ({'piyasa değeriyle; ' if RESALE_ACT else ''}mücevher ve büyük konut yatırımı dahil; v11.1: 0,88), mücevher + konut yatırımı {'defter ' if RESALE_ACT else 'toplam '}değeri {sum(v_ for q_, v_ in I['jval'].items() if q_ in wealth):,.0f} Akçe{'' if RESALE_ACT else f" (oyuncu servetinin %{100 * sum(v_ for q_, v_ in I['jval'].items() if q_ in wealth) / max(1.0, sum(w10)):.0f}'i)"}.\n")
    # ---- K-174: bütçe önceliği, ikinci el, pazar yeri, lonca gideri
    if LIFE_ACT and (BUDGET_FIRST_ACT or RESALE_ACT or ROOM_ACT or COST_ACT):
        o.append("\n### K-174: bütçe önceliği, ikinci el piyasası, pazar yeri testi, lonca işletme gideri\n")
        cv = R["cov"]
        tm = sum(wealth.values()) or 1.0
        bs_ = I["bf_stat"]
        o.append(f"Bütçe önceliği mekanizma testi: nakdi yetmeyen kişilerde (kalem × kişi-döngü {bs_.get('n', 0):,.0f}) sepet kalemi karşılaması öncelikli dağıtımla %{100 * bs_.get('prio', 0) / max(1.0, bs_.get('n', 1)):.0f}, eski orantılı kısmayla (aynı kişiler) %{100 * bs_.get('aff', 0) / max(1.0, bs_.get('n', 1)):.0f}.\n")
        o.append(f"**Bütçe önceliği ({'açık' if BUDGET_FIRST_ACT else 'kapalı'}):** nakit yetmeyince önce sepet ve kira, sonra dayanıklı, donanım/yazılım, eğlence, restoran, seyahat, moda, mücevher, büyük konut kısılır. Sepet karşılama (son 50 hafta): kişi-döngünün %{100 * cv.get('rok95', 0) / max(1, cv.get('rn', 1)):.1f}'inde tüm sepet kalemleri en az %95 karşılandı, ortalama kalem karşılaması %{100 * cv.get('ravg', 0) / max(1, cv.get('rn', 1)):.1f} (koşunun tamamı: %{100 * cv.get('avg', 0) / max(1, cv.get('n', 1)):.1f}); müşteri parası kısıtı {R['miss_reason'].get('musteri_parasi', 0):,} kişi-döngü; eksik sepet (kişi-döngü, küm.) {sum(R['missed'].values()):,}.\n")
        if RESALE_ACT:
            sh_ = I["sh_stat"]
            bw, mw = sorted(wealth_book.values()), sorted(wealth.values())
            tb, tm = sum(bw) or 1.0, sum(mw) or 1.0
            o.append(f"**İkinci el piyasası:** değer kaybı haftalık mücevher %{DEPR['mucevher'] * 100:.2f}, konut iyileştirmesi %{DEPR['insaat'] * 100:.1f}; satıcı: nakdi 2 haftalık sepet+kira altına düşen (sıkışık) ya da varlığı 3 aylık harcamayı aşan (haftalık %{SELL_RATE * 100:.0f}); alıcı: rahat/lüks düzeyin mücevher/konut talebinin en çok %{SH_SHARE * 100:.0f}'i (arz kadar); satılamayan sıkışık satıcıdan kuyumcu/inşaat firması referansın %{BUYBACK * 100:.0f}'ine geri alır ve ikinci el stoğuna koyar. İkinci el işlem: mücevher {sh_.get('mucevher_adet', 0):,.0f} birim ({sh_.get('mucevher_ciro', 0):,.0f} Akçe), konut iyileştirmesi {sh_.get('insaat_adet', 0):,.0f} birim ({sh_.get('insaat_ciro', 0):,.0f} Akçe); geri alım mücevher {sh_.get('mucevher_geri_alim', 0):,.0f}, konut {sh_.get('insaat_geri_alim', 0):,.0f} birim; son ikinci el fiyat oranı mücevher {I['sh_price']['mucevher']:.2f}, konut {I['sh_price']['insaat']:.2f} (referans = 1); `ikinci_el_satis` {L.flows['ikinci_el_satis']:,.0f}, `ikinci_el_geri_alim` {L.flows['ikinci_el_geri_alim']:,.0f} Akçe.\n")
            o.append(f"Servet değerlemesi: piyasa değeriyle (ikinci el fiyatı, değer kaybı dahil) servet Gini'si **{_gini(mw):.2f}**, defter değeriyle (alış değeri, değer kaybı yok) {_gini(bw):.2f}; mücevher + konut varlığı toplamı piyasa {sum(mv_.values()):,.0f} / defter {sum(I['jval'].get(q, 0.0) for q in pl):,.0f} Akçe (oyuncu servetinin %{100 * sum(mv_.values()) / tm:.0f} / %{100 * sum(I['jval'].get(q, 0.0) for q in pl) / tb:.0f}); en zengin %1 servet payı piyasa %{100 * sum(mw[int(len(mw) * .99):]) / tm:.0f} / defter %{100 * sum(bw[int(len(bw) * .99):]) / tb:.0f}.\n")
        if ROOM_ACT:
            nk = ("restoran", "eglence", "kuyumcu", "maden_altin", "insaat")
            aa = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge" and d["kind"] in nk]
            bb = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge" and d["kind"] not in nk]
            allf = aa + bb
            svf = lambda ds, h: (100.0 * sum(1 for d in ds if (d.get('died', 10 ** 9) - d['born']) >= h and weeks - d['born'] >= h) / sum(1 for d in ds if weeks - d['born'] >= h)) if any(weeks - d['born'] >= h for d in ds) else float('nan')
            o.append(f"**Pazar yeri testi (açık):** talebin son {ROOM_N} haftalık alt çeyreği − mevcut ve yeni (12 haftadan genç, en az 2 çalışanlı sayılır) firma kapasitesi, en az {ROOM_K} çalışanlık çıktı değerini aşmalı; reddedilen giriş denemesi (şehir × ürün × hafta): {L.flows['pazar_yeri_yok_ret']:,.0f}. Yeni lüks sektörlerde oyuncu firması kurulan {len(aa)} (kuyumcu {sum(1 for d in aa if d['kind'] == 'kuyumcu')}, eğlence {sum(1 for d in aa if d['kind'] == 'eglence')}, restoran {sum(1 for d in aa if d['kind'] == 'restoran')}, inşaat {sum(1 for d in aa if d['kind'] == 'insaat')}), canlı {sum(1 for d in aa if not d.get('dead'))}; 52 hafta hayatta kalma yeni lüks sektörlerde %{svf(aa, 52):.0f}, diğerlerinde %{svf(bb, 52):.0f}, tümünde %{svf(allf, 52):.0f} (26 hf: %{svf(aa, 26):.0f} / %{svf(bb, 26):.0f} / %{svf(allf, 26):.0f}).\n")
        if COST_ACT:
            o += [f"**Lonca işletme gideri (açık):** sabit {LC_FIXED:,.0f} + üye başına {LC_MEMBER:,.0f} Akçe / hafta, şehir hizmetlerine (`lonca_gideri`); önce lonca kasasından, yetmezse sermaye havuzundan; ödenemeyen gider 12 hafta sürerse lonca kapanır, her üye firma kendi lonca skoruna göre başka loncaya geçer. Kapanan {L.flows['lonca_kapanis_adet']:.0f}, yeniden kurulan {L.flows['lonca_kurulus_adet']:.0f}.\n",
                  "| Lonca | Son fee | Canlı üye | Ödenen gider (küm.) | Ödenemeyen (küm.) | Fee tahsilatı (küm.) | Gider / fee | Sahip |", "|---|---|---|---|---|---|---|---|"]
            for lo in LOL:
                g_, u_, fi_ = I["cost_stat"].get(lo + "_gider", 0.0), I["cost_stat"].get(lo + "_odenmedi", 0.0), I["fee_inc"].get(lo, 0.0)
                o.append(f"| {lo}{' (kapalı)' if lo in I['closed'] else ''} | %{I['FEES'].get(lo, LONCA_FEE) * 100:.1f} | {I['lo_members'].get(lo, 0)} | {g_:,.0f} | {u_:,.0f} | {fi_:,.0f} | %{100 * g_ / max(1.0, fi_):.0f} | {I['lonca_owner'].get(lo, ('–',))[0]} |")
            evs2 = [e for e in R["tech_events"] if "kapandı" in e or "yeniden kuruldu" in e]
            o.append("\n" + (" ".join(evs2[:8]) if evs2 else "Lonca kapanışı olmadı.") + "\n")
            so2 = sorted((wealth.get(v[0], 0) for v in I["lonca_owner"].values()), reverse=True)
            o.append(f"Fee aralığı %{min(I['FEES'].values()) * 100:.1f}–{max(I['FEES'].values()) * 100:.1f} (ort. %{sum(I['FEES'].values()) / len(I['FEES']) * 100:.1f}); lonca sahipleri ({len(I['lonca_owner'])} kişi) servet payı %{100 * sum(so2) / tm:.0f} (v11.2: %20).\n")

    # ---- K-176: girişimci loncalar
    if NL_ACT:
        li, ns = I["lonca_info"], I["new_slots"]
        o.append("\n### K-176: girişimci loncalar (yerleşik: lonca0–5; girişimci: başarılı inovatörün kurduğu)\n")
        o.append(f"Kural: kurucu adayı itibarı en az {REP_LFOUND:.0f}, likit bakiyesi en az {INNOV_LONCA_CAP:,.0f} Akçe olan, henüz lonca sahibi olmayan bir inovatör; DAO kurucusuysa DAO'nun toplam telif geliri en az {SUCC_TEL:,.0f} Akçe, firma sahibiyse en az {FIRM_OWNER_MIN_WORKERS} çalışanlı ve {FIRM_OWNER_MIN_WEEKS} haftalık inovatör firma. Karar (haftalık, 8 haftalık fee tahsilat izine bağlı): kalmanın getirisi = DAO'nun telif + sözleşme gelirinin yumuşatılmış ortalaması; kurmanın getirisi = beklenen fee geliri × kurucu payı (%{PROGRAM_INNOV['kurucu_payi'] * 100:.0f}) + Ar-Ge fonundan DAO sözleşmesi (en çok gider × {CONTRACT_CAP}) + kendi üyelerinden telif (dışarıdakinin 1/3'ü) − lonca gideri (K-174; küçük ofis: sabit gider (üye/{LC_SCALE_N:.0f})^0,5 ile ölçeklenir, en çok %{(1 - LC_SCALE_MIN) * 100:.0f} indirim). Fark en az {FOUND_MARGIN:,.0f} Akçe/hafta ise kurar. Kuruluş: {INNOV_LONCA_CAP:,.0f} Akçe kredi havuzuna (`lonca_kurulus_sermayesi`), fee = yerleşik ortalamasının %{NEW_UNDERCUT * 100:.0f} altı, DAO (ve kurucunun kendi firmaları) yeni loncaya geçer (`dao_lonca_gecisi_adet`), DAO'nun patentleri loncayla birlikte gider. Kurucu {FOUNDER_BAN} hafta yeniden kurmaz. DAO'lar her {DAO_RELOC_EVERY} haftada bir sözleşme geliri en az %{(DAO_RELOC_GAIN - 1) * 100:.0f} fazla lonca bulursa geçer; lonca DAO kaybedince Ar-Ge payını +{ARGE_BOOST * 100:.0f} puan (en çok +{ARGE_BOOST_MAX * 100:.0f}) artırır (sermaye payından; haftalık ×{ARGE_DECAY} sönümlü). Lonca sayısı sınırsız (K-178): her kuruluş yeni kimlik alır (lonca6, lonca7 ...), kapanan kimlik yeniden kullanılmaz.")
        o += ["", "| Lonca | Grup | Kurucu | Kuruluş | Bitiş | Ömür (hf.) | Sebep | Tepe üye | Son üye | Son fee | Fee tahsilatı (küm.) | Ar-Ge sözleşmesi (küm.) | Telif geliri (küm.) | Canlı DAO | Sahip servet |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        mh_ = I["mem_hist"][-1][1] if I["mem_hist"] else {}
        for lo in sorted(li, key=lambda l_: (l_ in ns, int(l_[5:]))):
            x = li[lo]
            end_ = x["end"] if x.get("end") is not None else weeks
            q_ = I["lonca_owner"].get(lo, (x.get("founder") or "–",))[0]
            o.append(f"| {lo} | {x['grp']} | {x.get('founder') or '–'} | {x['start']} | {x['end'] if x.get('end') is not None else '–'} | {end_ - x['start']} | {x.get('reason', 'sürüyor')} | {x['peak']} | {mh_.get(lo, 0)} | {('%' + format(I['FEES'][lo] * 100, '.1f')) if lo in I['FEES'] else '–'} | {I['fee_inc'].get(lo, 0):,.0f} | {I['arge_sp'].get(lo, 0):,.0f} | {I['telin'].get(lo, 0):,.0f} | {sum(1 for n_ in alive if firms[n_]['lonca'] == lo)} | {wealth.get(q_, 0):,.0f} |")
        gl = lambda lo: "girişimci" if lo in ns else "yerleşik"
        gl_all = lambda dct: {g_: sum(v_ for k_, v_ in dct.items() if k_ in li and gl(k_) == g_) for g_ in ("yerleşik", "girişimci")}
        fi_g, ar_g, te_g = gl_all(I["fee_inc"]), gl_all(I["arge_sp"]), gl_all(I["telin"])
        pc_ = lambda dct, g_: 100.0 * dct[g_] / max(1.0, sum(dct.values()))
        o.append(f"\nKüm. paylar (girişimci / yerleşik): fee tahsilatı %{pc_(fi_g, 'girişimci'):.0f} / %{pc_(fi_g, 'yerleşik'):.0f}; Ar-Ge sözleşmesi %{pc_(ar_g, 'girişimci'):.0f} / %{pc_(ar_g, 'yerleşik'):.0f}; lonca telif geliri %{pc_(te_g, 'girişimci'):.0f} / %{pc_(te_g, 'yerleşik'):.0f}.")
        o += ["", "Zaman içinde grup payı (üye firma sayısı, ortalama fee, canlı lonca sayısı, DAO sayısı):", "", "| Hafta | Yerleşik üye | Girişimci üye | Girişimci üye payı | Yerleşik ort. fee | Girişimci ort. fee | Girişimci lonca sayısı | Girişimci DAO | Yerleşik DAO |", "|---|---|---|---|---|---|---|---|---|"]
        gsl = I["grp_stat"]
        for w_, gs_, _x in gsl[::max(1, len(gsl) // 10)] + ([gsl[-1]] if gsl else []):
            a_, b_ = gs_["yerleşik"], gs_["girişimci"]
            o.append(f"| {w_} | {a_['mem']} | {b_['mem']} | %{100 * b_['mem'] / max(1, a_['mem'] + b_['mem']):.0f} | %{100 * a_['fee'] / max(1, a_['nl']):.1f} | " + (f"%{100 * b_['fee'] / b_['nl']:.1f}" if b_['nl'] else "–") + f" | {b_['nl']} | {b_['dao']} | {a_['dao']} |")
        inc_ = list(I["lonca_log"]) + [dict(x, lo=lo) for lo, x in li.items() if x.get("end") is None]
        fl = [(x["lo"], x) for x in inc_ if x["grp"] == "girişimci"]
        fails = [x for lo, x in fl if x.get("end") is not None]
        lifes = [(x["end"] if x.get("end") is not None else weeks) - x["start"] for lo, x in fl]
        est_closed = [x["lo"] for x in inc_ if x["grp"] != "girişimci" and x.get("end") is not None]
        o.append(f"\nGirişimci lonca: kurulan {len(fl)}, batan {len(fails)} (ortalama ömür {sum(lifes) / max(1, len(lifes)):.0f} hf.; batanların ortalama ömrü {sum(x['end'] - x['start'] for x in fails) / max(1, len(fails)):.0f} hf.), yerleşik loncalardan kapanan {len(est_closed)} (yeniden kurulan yerleşik {sum(1 for x in inc_ if x['grp'] == 'yerleşik (yeniden)')}). DAO lonca geçişi {L.flows['dao_lonca_gecisi_adet']:.0f}, kuruluş sermayesi toplamı {L.flows['girisimci_lonca_sermayesi']:,.0f} Akçe. Kurulum haftaları: " + (", ".join(str(x['start']) for lo, x in fl) or "–") + ".")
        # lonca sahibi servet payı (gruba göre)
        own_g = {"yerleşik": 0.0, "girişimci": 0.0}
        for lo, v in I["lonca_owner"].items():
            own_g[gl(lo)] += wealth.get(v[0], 0)
        tw_ = sum(wealth.values()) or 1.0
        o.append(f"Lonca sahiplerinin servet payı: yerleşik loncaların sahipleri %{100 * own_g['yerleşik'] / tw_:.1f}, girişimci loncaların sahipleri %{100 * own_g['girişimci'] / tw_:.1f} (toplam sahip {len(I['lonca_owner'])} kişi). Fee aralığı %{min(I['FEES'].values()) * 100:.1f}–{max(I['FEES'].values()) * 100:.1f}.")
        inv_ = sorted((wealth[q_] for q_ in wealth if people[q_].get("innov")), reverse=True)
        allw = sorted(wealth.values(), reverse=True)
        fnd = [wealth.get(x.get("founder"), 0) for lo, x in fl]
        o.append(f"İnovatör (%10) servet dağılımı: n={len(inv_)}, toplam servet payı %{100 * sum(inv_) / tw_:.1f}, medyan {inv_[len(inv_) // 2] if inv_ else 0:,.0f}, en zengin {inv_[0] if inv_ else 0:,.0f}, Gini {_gini(sorted(inv_)):.2f}; girişimci lonca kurucuları (n={len(fnd)}) ortalama servet {sum(fnd) / max(1, len(fnd)):,.0f} (tüm oyuncu ortalaması {tw_ / max(1, len(wealth)):,.0f}); ilk %1 servet payı %{100 * sum(allw[:max(1, len(allw) // 100)]) / tw_:.0f}.")
        pfn = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
        a_n = [d for d in pfn if d.get("ever_new")]
        b_n = [d for d in pfn if not d.get("ever_new")]
        svn = lambda ds, h: (100.0 * sum(1 for d in ds if (d.get('died', 10 ** 9) - d['born']) >= h and weeks - d['born'] >= h) / sum(1 for d in ds if weeks - d['born'] >= h)) if any(weeks - d['born'] >= h for d in ds) else float('nan')
        o.append(f"Oyuncu firması 52 hafta hayatta kalma: bir ara girişimci loncaya katılmış olanlar (n={len(a_n)}) %{svn(a_n, 52):.0f}, hiç katılmamışlar (n={len(b_n)}) %{svn(b_n, 52):.0f}; 26 hafta %{svn(a_n, 26):.0f} / %{svn(b_n, 26):.0f} (nedensel değil: switch ile katılım firmanın o ana dek hayatta olmasını gerektirir, yaş yanlılığı).")
        fr_ = I["FRONT"]
        o.append(f"Teknoloji ve Ar-Ge: toplam Ar-Ge sözleşmesi (küm.) {sum(I['arge_sp'].values()):,.0f} Akçe, verim eşiği olayı {sum(1 for e_ in R['tech_events'] if 'verim +%' in e_)}; patentli DAO {sum(1 for n_ in I['dao_info'] if 'patent' in I['dao_info'][n_])}, kurulan DAO {len(I['dao_all'])}. Ar-Ge payı artırımı (son, sönümlü): " + (", ".join(f"{l_} +{v_ * 100:.1f}" for l_, v_ in sorted(I['arge_boost'].items()) if v_ > 0.005) or "yok") + ".")
        o.append("**Sözleşme etkisi:** lonca kuruluşu oyuncu işlemi olur (`lonca_kurulusu`: sahip = oyuncu, kuruluş sermayesi, ilk fee); DAO'nun lonca değiştirmesi `dao_lonca_gecisi`; patent sahipliği DAO/lonca ile birlikte taşınır. **Basitleştirmeler:** DAO'nun kredisi eski loncaya borçlu kalır (faiz ve anapara oraya gider), yeni lonca DAO'ya yeni kredi verebilir; kurucu tek oyuncu ve tek lonca; yerleşik loncalar hayal edilen NPC değil, K-167'deki sahipli loncalardır; lonca sayısı sınırsız.")
        o.append("**Sonraki adım önerisi (onaylanmadı, uygulanmadı):** oyuncular girdikçe NPC firmaların çekilmesi (boşluk dolduran NPC).\n")

    # ---- K-179: servetten harcama, değişken mevduat faizi, konut yatırımı
    if WR_ACT or DV_ACT or HI_ACT:
        H = R["house"]
        ts = H["ts"]
        o.append("\n### K-179: servetten harcama, değişken mevduat faizi, konut yatırımı ve ikinci el piyasası\n")
        parts = []
        if WR_ACT:
            parts.append(f"**Servetten harcama gerçek değere indi (`WEALTH_REAL`):** tampon (20 haftalık ücret) üstü servetin (nakit + mevduat) yılda %{WEALTH_DRAW_YEAR * 100:.1f}'i hayat düzeyi bütçesine eklenir (döngü başına %{WEALTH_DRAW_YEAR / (52 * CYCLES_PER_WEEK) * 100:.4f}; eskiden %{WSPEND * 100:.0f}, yılda ~%97).")
        if DV_ACT:
            parts.append(f"**Mevduat (`DEP_VAR`):** kredi talebine bağlı tavan (×{DEP_MULT:.0f}) kalktı; faiz = havuzun o hafta tahsil ettiği kredi faizinin %{DEP_PAYOUT * 100:.0f}'i / toplam mevduat (üst sınır haftalık %{DEP_RATE * 100:.0f}); mevduat çoğalınca faiz kendiliğinden düşer. Elde tutma {DEP_KEEP_NEW:.0f} haftalık harcama (eskiden {DEP_KEEP}); yeni mevduat en yüksek (4 haftalık sönümlü) faizi veren loncaya gider.")
        if HI_ACT:
            parts.append(f"**Konut yatırımı (`HOUSE_INV`):** oyuncu, konutun beklenen net getirisi (kira × (1 - bakım %{HOUSE_MAINT * 100:.0f}) × doluluk / fiyat + beklenen fiyat değişimi: son ~{HOUSE_EXP_N} haftanın eğilimi × {HOUSE_EXP_DAMP}, haftalık ±%0,3 ile sınırlı) mevduat faizinden (12 haftalık sönümlü, mevduat ağırlıklı) en az haftalık %{HOUSE_RISK_PREM * 100:.2f} yüksekse alır. Kişi başına en çok {HOUSE_INV_MAX} yatırım konutu (sahip kararı; oturduğu ev hariç, fazlası zorla satılmaz). En ucuz arz seçilir: ikinci el (oyuncular arası; alıcı %{HOUSE_TXN * 100:.0f} işlem harcı öder), şehrin boş stoku (birincil fiyat = kira / {HOUSE_YIELD}) ya da yeni inşaat (maliyet = {HOUSE_BUILD:.2f} × birincil fiyat; yalnız kira baskısı varken: kira çarpanı > {BUILD_RM}). Satıcı: nakit + mevduatı {HOUSE_SQUEEZE_W} haftalık harcamanın altına düşen ya da net getirisi mevduatın {HOUSE_SELL_MARGIN * 100:.2f} puan altına inen sahip (haftada birim). İkinci el fiyatı = birincil fiyat × oran; oran her hafta (alıcı - satıcı) / (alıcı + satıcı) × %{HOUSE_PRICE_ADJ * 100:.0f} oynar ve temel değere (net kira / (mevduat faizi + risk primi)) haftada %{HOUSE_ANCHOR * 100:.0f} yaklaşır; boş stok varken oran 1'i aşamaz; sınır {HOUSE_PX_MIN}–{HOUSE_PX_MAX}. Şehir başına haftalık alım üst sınırı {HOUSE_BUY_CAP} (eskiden {HOUSE_BUY_MAX}).")
        o.append(" ".join(parts))
        o.append("**Performans (adım 0):** davranış değişmeden hızlandırma: hayat düzeyi talebi önbelleği (`life_demand`), şehir fiyat tablosu, tüketici sırası sözlüğü, sık sözlük erişimleri yerel değişkende; 500 hafta 239 sn → 181 sn (-%24); 8 ve 500 hafta çıktısı v11.4 ile bayt bayt aynı.")
        if ts:
            nc = n_cities
            c0 = ts[0][1]
            o += ["\nKonut fiyat endeksi (ikinci el fiyatı, ilk ölçüm = 100), kira endeksi ve fiyat / yıllık kira (şehir sırasıyla):\n", "| Hafta | Fiyat endeksi | Kira endeksi (kira çarpanı) | Fiyat / yıllık kira | Net getiri (haftalık, doluluk dahil) | Sahip / birim / stok | İlk 10 sahibin payı |", "|---|---|---|---|---|---|---|"]
            for w_, hr, st_, dp_, ws_ in ts[::max(1, len(ts) // 10)] + ([ts[-1]] if len(ts) > 1 else []):
                o.append(f"| {w_} | " + " / ".join(f"{100 * hr[c]['px'] / c0[c]['px']:.0f}" for c in range(nc)) + " | " + " / ".join(f"{100 * hr[c]['rent'] / c0[c]['rent']:.0f} ({hr[c]['RM']:.2f})" for c in range(nc)) + " | "
                         + " / ".join(f"{hr[c]['px'] / (52 * hr[c]['rent']):.1f}" for c in range(nc)) + " | " + " / ".join(f"{100 * hr[c]['rent'] * (1 - HOUSE_MAINT) / hr[c]['px']:.2f}%" for c in range(nc)) + " | "
                         + " / ".join(f"{hr[c]['owners']}·{hr[c]['units']:.0f}·{hr[c]['hs']:.0f}" for c in range(nc)) + " | " + " / ".join(f"%{100 * hr[c]['top10']:.0f}" for c in range(nc)) + " |")
            mx = [max(100 * t[1][c]["px"] / c0[c]["px"] for t in ts) for c in range(nc)]
            mn = [min(100 * t[1][c]["px"] / c0[c]["px"] for t in ts) for c in range(nc)]
            dd = []
            for c in range(nc):
                pk, md = 0.0, 0.0
                for t in ts:
                    v_ = t[1][c]["px"]
                    pk = max(pk, v_)
                    md = max(md, 1 - v_ / pk)
                dd.append(md)
            st_ = H["st"]
            o.append(f"\nBalon / çöküş: şehir başına fiyat endeksi en yüksek {'/'.join(f'{v:.0f}' for v in mx)}, en düşük {'/'.join(f'{v:.0f}' for v in mn)}, en büyük düşüş (tepeden dibe) {'/'.join(f'%{100 * v:.0f}' for v in dd)}. Konut işlemi: ikinci el {st_.get('sec_n', 0):.0f} (hacim {st_.get('sec_vol', 0):,.0f} Akçe), şehirden birincil alım {st_.get('pri_n', 0):.0f}, yatırımcı inşaatı {st_.get('build_n', 0):.0f}; ödenen işlem harcı {L.flows['konut_islem_harci']:,.0f} Akçe. Konut mülkiyeti: sahip sayısı {sum(1 for od in H['own'].values() for u_ in od.values() if u_ > 0.5)}, birim {sum(sum(od.values()) for od in H['own'].values()):.0f} / stok {sum(H['hs'].values()):.0f}.")
            o += ["\nMevduat ve servet zaman serisi:\n", "| Hafta | Mevduat sahibi | Toplam mevduat | Kalan kredi | Mevduat / kredi | Mevduat faizi (haftalık, ağırlıklı) | Servet Gini'si | İlk %1 payı | Medyan servet |", "|---|---|---|---|---|---|---|---|---|"]
            for w_, hr, st_, dp_, ws_ in ts[::max(1, len(ts) // 10)] + ([ts[-1]] if len(ts) > 1 else []):
                o.append(f"| {w_} | {dp_['n']} | {dp_['tot']:,.0f} | {dp_['loans']:,.0f} | {dp_['tot'] / max(1.0, dp_['loans']):.1f} | %{100 * dp_['rate']:.3f} | {ws_['gini']:.2f} | %{100 * ws_['top1']:.0f} | {ws_['med']:,.0f} |")
            o.append(f"\nToplam: yatırılan mevduat {L.flows['mevduat']:,.0f}, çekilen {L.flows['mevduat_cekim']:,.0f}, ödenen mevduat faizi {L.flows['mevduat_faizi']:,.0f}; tahsil edilen kredi faizi {L.flows['faiz']:,.0f}. Kiracının yükü: kira çarpanı ortalaması son ölçümde {sum(ts[-1][1][c]['RM'] for c in range(nc)) / nc:.2f}, ilk ölçümde {sum(c0[c]['RM'] for c in range(nc)) / nc:.2f} (çırak kirası = ücretin %{RENT_H * 100:.0f} × çarpan).")
        o.append("**Kontrat etkisi:** `konut_alim` (şehirden birincil alım; kayıtta `konut_satisi`), `konut_satis_ikinci_el` (oyuncu → oyuncu, doğrudan; işlem harcı `konut_islem_harci` şehre), konut sahiplik kaydı (şehir, sahip, birim), `mevduat_faizi` değişken oran olayı (haftalık oran = dağıtılan / mevduat). **Basitleştirme:** yatırım konutları fiziksel birim sayısı olarak tutulur, kira havuzdan paya göre dağılır; geliştirici inşaatı şehir kasasına ödenir (inşaat sektörü firmalarına değil).")

    # ---- K-180: DAO/firma payı, kurum itibarı, medya sahipliği
    if EQ_ACT or ORG_ACT or MO_ACT:
        o.append("\n### K-180: pay yatırımı, kurum itibarı (marka) ve medya sahipliği\n")
        if EQ_ACT:
            E = R["eq"]
            by, elog, epx = E["by"], E["log"], E["px"]
            hold_alive = [(f_, q_, h_) for f_, hh_ in by.items() for q_, h_ in hh_.items()]
            nets = []
            for f_, q_, h_ in hold_alive:
                nets.append(h_["div"] + h_["share"] * epx.get(f_, 0.0) - h_["cost"])
            for e_ in elog:
                nets.append(e_["div"] + e_["end"] - e_["cost"])
            win = sum(1 for v_ in nets if v_ > 0)
            invs = {q_ for _, q_, _ in hold_alive} | {e_["inv"] for e_ in elog}
            vol_dao, vol_firm = L.flows["dao_pay_satisi"], L.flows["firma_pay_satisi"]
            dao_eq = {f_ for f_ in list(by) + [e_["f"] for e_ in elog] if firms[f_]["kind"] == "arge"}
            dao_all_ = [n_ for n_ in I["dao_all"]]
            dao_with = [n_ for n_ in dao_all_ if n_ in dao_eq]
            dao_wo = [n_ for n_ in dao_all_ if n_ not in dao_eq]
            surv = lambda ns: 100.0 * sum(1 for n_ in ns if not firms[n_].get("dead")) / max(1, len(ns))
            pk = lambda ns: sum(I["dao_info"][n_]["peak"] for n_ in ns) / max(1, len(ns))
            pat = lambda ns: 100.0 * sum(1 for n_ in ns if "patent" in I["dao_info"][n_]) / max(1, len(ns))
            pf_all = [f_ for f_, d_ in firms.items() if d_.get("owner") in people and d_["kind"] != "arge"]
            eqf = {f_ for f_ in list(by) + [e_["f"] for e_ in elog] if firms[f_]["kind"] != "arge"}
            sv52 = lambda fs: (100.0 * sum(1 for f_ in fs if (firms[f_].get("died", 10 ** 9) - firms[f_]["born"]) >= 52 and weeks - firms[f_]["born"] >= 52) / max(1, sum(1 for f_ in fs if weeks - firms[f_]["born"] >= 52)))
            o.append(f"**Pay yatırımı (`DAO_EQUITY`):** kâr eden (sönümlü haftalık net kâr ≥ {EQ_MIN_PROFIT:.0f} Akçe, yaş ≥ {EQ_MIN_AGE} hf.) firma ve Ar-Ge DAO'su, kadrosu boşken ya da kasası {EQ_CASH_WEEKS:.0f} haftalık ücretin altındayken pay satar (tek seferde %{EQ_TRANCHE * 100:.0f}, dış paylar toplamı en çok %{EQ_MAX_EXT * 100:.0f}, iki satış arası {EQ_COOL} hf.); değerleme = kâr / (mevduat faizi + {EQ_RISK_ISS} + sönümlü batma oranı), ihraç fiyatı değerlemenin %{(1 - EQ_DISC) * 100:.0f}'i. Yatırımcı beklenen getiri (kâr payı) − batma oranı (itibarla ayarlı) > mevduat faizi + {EQ_RISK_INV} ise alır (yatırılabilir paranın en çok %{EQ_FRAC * 100:.0f}'i, en çok {EQ_MAX_HOLD} pay). Toplanan sermaye temettü olarak çıkmaz ({EQ_KEEP:.0f}×), kâr paya göre dağılır (`kar_payi_dagitimi`); firma/DAO batarsa pay değeri sıfırdır.")
            o.append(f"Hacim: DAO payı {vol_dao:,.0f}, firma payı {vol_firm:,.0f} Akçe ({L.flows['pay_kaydi_adet']:.0f} işlem); yatırımcı {len(invs)} kişi, canlı pay kaydı {len(hold_alive)}, sıfırlanan {L.flows['pay_sifirlanan_adet']:.0f}; dağıtılan kâr payı {L.flows['kar_payi_dagitimi']:,.0f}. Yatırımcı getirisi: {win} kazanan / {len(nets) - win} kaybeden (toplam net {sum(nets):,.0f} Akçe; kayıp {E['stat'].get('kayip', 0):,.0f}). Servet payı: yatırımcıların pay değeri {sum(h_['share'] * epx.get(f_, 0.0) for f_, _, h_ in hold_alive):,.0f} Akçe.")
            o.append(f"Etki: pay satan DAO (n={len(dao_with)}) / satmayan (n={len(dao_wo)}): hayatta kalma %{surv(dao_with):.0f} / %{surv(dao_wo):.0f}, tepe kadro {pk(dao_with):.1f} / {pk(dao_wo):.1f}, patentli %{pat(dao_with):.0f} / %{pat(dao_wo):.0f}. Oyuncu firması 52 hf hayatta kalma: pay satan (n={len(eqf)}) %{sv52(eqf):.0f}, satmayan (n={len(pf_all) - len(eqf)}) %{sv52([f_ for f_ in pf_all if f_ not in eqf]):.0f} (yaş yanlılığı: kâr eden olgun firma satabilir). Mevduat: yatırılan pay sermayesi / toplam mevduat girişi = %{100 * (vol_dao + vol_firm) / max(1.0, L.flows['mevduat']):.0f}; son toplam mevduat {R['credit']['dep']:,.0f}. Batma oranı (sönümlü): firma {E['haz']['f'] * 100:.2f}%/hf, DAO {E['haz']['d'] * 100:.2f}%/hf.")
        if ORG_ACT:
            oh = R["orep_hist"]
            o += ["\nKurum itibarı (0-100): lonca, DAO, oyuncu firması, perakende (market) ortalaması ve lonca itibarı aralığı:\n", "| Hafta | Lonca | DAO | Oyuncu firması | Market | Lonca aralığı |", "|---|---|---|---|---|---|"]
            for t_ in oh[::max(1, len(oh) // 10)] + ([oh[-1]] if oh else []):
                o.append(f"| {t_[0]} | {t_[1]:.1f} | {t_[2]:.1f} | {t_[3]:.1f} | {t_[4]:.1f} | {t_[5]:.1f} |")
            orp = R["orep"]
            los = sorted(((orp[l_], l_) for l_ in R["inn"]["loncas"] if l_ in orp), reverse=True)
            dos = sorted(((orp[n_], n_) for n_ in I["dao_all"] if n_ in orp), reverse=True)
            xs = [orp[n_] for n_ in I["dao_all"] if n_ in orp]
            ys = [I["dao_con"].get(n_, 0.0) for n_ in I["dao_all"] if n_ in orp]
            if len(xs) > 2 and max(xs) > min(xs) and max(ys) > min(ys):
                mx_, my_ = sum(xs) / len(xs), sum(ys) / len(ys)
                cor = sum((a_ - mx_) * (b_ - my_) for a_, b_ in zip(xs, ys)) / (sum((a_ - mx_) ** 2 for a_ in xs) ** 0.5 * sum((b_ - my_) ** 2 for b_ in ys) ** 0.5 + 1e-12)
            else:
                cor = float("nan")
            o.append(f"\nSon durum: lonca itibarı " + ", ".join(f"{l_} {v_:.0f}" for v_, l_ in los) + f"; canlı DAO {len(dos)} (en yüksek {dos[0][0] if dos else 0:.0f}, en düşük {dos[-1][0] if dos else 0:.0f}); DAO itibarı ile toplam sözleşme geliri korelasyonu {cor:.2f} (ağırlık 1 + {ORG_CONTRACT_K} × itibar/100). İtibar olayı (eşik 25/50/75 geçişi): {L.flows['orep_olay_adet']:.0f} (yukarı {L.flows['orep_olay_yukari']:.0f}, aşağı {L.flows['orep_olay_asagi']:.0f}).")
            o.append(f"Kaynaklar (lonca): reklam birikimi (haftada %{(1 - ORG_AD_DECAY) * 100:.0f} aşınır; üye başına {ORG_AD_SAT:.0f} Akçe birikimde terim %63), gider/ücret ödenebilirliği, yaş, üye sahiplerinin kişi itibarı (K-11); firma/DAO: ücret ve söz kaydı, yaş, sahibin kişi itibarı, başarı (DAO: telif/patent; firma: girdi temini), medya sahipse reklam birikimi. Etkiler: lonca skoruna - {ORG_LONCA_W} × itibar/100 (K-170), DAO lonca değerine ×(1 + {ORG_DAO_W} × itibar/100), DAO sözleşme ağırlığı, perakende müşteri payı (market firmaları arası, ±%{ORG_SHARE_K * 100:.0f}), yatırımcı batma riski ×(1,5 - itibar/100), kredi faizi çarpanı (1,2 - 0,4 × itibar/100) ve kredi şartı (en az {CX_MIN_OREP:.0f}). **Sınır:** firmalar arası mal alışverişi (TAKAS) şehir fiyatı ve arz oranıyla paylaşıldığı için itibar mal satışında payı değiştirmez (öneri: satıcı seçimi itibar ağırlıklı skorla; K-182).")
        if MO_ACT:
            M = R["media"]
            mo = M["owners"]
            o += ["\nMedya firmaları ve sahipliği:\n", "| Medya | Şehir | Sahip | Son kâr (hf.) | Alım haftası | Fiyat |", "|---|---|---|---|---|---|"]
            lastb = {}
            for e_ in M["log"]:
                if not e_.get("end"):
                    lastb[e_["media"]] = e_
            for f_ in sorted(mo):
                og = mo[f_]
                e_ = lastb.get(f_)
                o.append(f"| {f_} | {firms[f_]['city']} | {(og[0] + ' ' + og[1]) if og else 'şehir (NPC)'} | {M['mprof'].get(f_, 0.0):,.1f} | {e_['week'] if (e_ and og) else '–'} | {(format(e_['price'], ',.0f')) if (e_ and og) else '–'} |")
            ms = M["stat"]
            own_n = sum(1 for og in mo.values() if og)
            cnt = defaultdict(int)
            for og in mo.values():
                if og:
                    cnt[og[1]] += 1
            o.append(f"\nMedya alımı {L.flows['medya_satin_alma_adet']:.0f} (fiyat = {MEDIA_PE:.0f} hf. kâr, en az {MEDIA_PRICE_MIN:,.0f}); sahipli medya {own_n}/{len(mo)}, en çok medya tutan sahip {max(cnt.values()) if cnt else 0} ({', '.join(f'{k_}: {v_}' for k_, v_ in cnt.items()) or '–'}). Sahibin kendi reklamında indirim (liste fiyatın %{MEDIA_OWN_DISC * 100:.0f}'i) toplam tasarruf {ms.get('indirim', 0.0):,.0f} Akçe; medyadan sahibe çekilen kâr (`medya_kar_cekimi`) {L.flows['medya_kar_cekimi']:,.0f}; dışarıdan reklam geliri {sum(v_ for k_, v_ in ms.items() if k_.startswith('dis_reklam_')):,.0f}. Medya sahibi kendi reklam birikimini ucuza büyütür: lonca itibarında reklam terimi.")
            o.append("**Sınır:** medya firması şehir başına bir tane (5); yeni medya kurma yok, yalnız satın alma (kurma için istihdam planı ve kadro mantığı genişletilmeli).")
        o.append("**Kontrat etkisi:** `dao_pay_satisi` / `firma_pay_satisi` (yatırımcı → firma, pay kaydı: sahip, oran, maliyet), `pay_kaydi` (adet sayacı), `kar_payi_dagitimi` (firma → yatırımcı, paya göre), pay devri (şimdilik yok: yatırımcı payını satamaz, yalnız batma sıfırlar), `reklam_ic` (sahibine indirimli reklam), `medya_satin_alma` (alıcı → şehir kasası), `medya_kar_cekimi` (medya → sahibi), `orep_olay` (itibar eşik geçişleri).\n")
    # ---- K-181: kredi genişlemesi
    if CX_ACT:
        cx = R["cx"]["stat"]
        o.append("\n### K-181: kredi genişlemesi (faiz bağı, büyüme/yatırım/medya/konut kredisi)\n")
        o.append(f"**Faiz:** haftalık kredi faizi = mevduat faizi (12 hf. sönümlü) + {CX_MARGIN} (alt sınır {CX_RATE_MIN}, üst sınır eski sabit {LOAN_RATE}) × kişi/kurum itibar çarpanı; {CX_REPRICE} haftada bir yeniden fiyatlanır (havuz zarara girmez: mevduat faizi tahsil edilen faizin %{DEP_PAYOUT * 100:.0f}'inden ödenir). Son kredi tabanı haftalık %{cx.get('faiz_son', 0.0) * 100:.2f} (yıllık ~%{cx.get('faiz_son', 0.0) * 5200:.0f}), mevduat faizi %{R['house']['dep_slow'] * 100:.3f}. **Büyüme kredisi:** nakit açığı kapanır, toplam borç ≤ {CX_GROW_K:.0f} hf. net kâr (eski: tek çalışanlık sermaye × {LOAN_LEV}); iş arayan şartı yerine alıcısız oranı ≤ %15, kâr, yaş ≥ {CX_MIN_AGE} hf., kurum itibarı ≥ {CX_MIN_OREP:.0f}, taksit kaçırmamış. **Yatırım kredisi:** kapasite dolu firma +{CX_CAP_STEP} çalışan kapasitesi için ({CX_CAP_WEEKS:.0f} haftalık ücret/çalışan; bina harcaması şehre) ve Ar-Ge DAO'su kadro/buluş bütçesi için (toplam borç ≤ {CX_INV_K:.0f} hf. kâr). **Medya kredisi:** fiyatın en çok %{CX_MEDIA_LTV * 100:.0f}'i (alıcı lonca ya da DAO; geri ödeme gücü: taksit ≤ medya kazancı; ödeme alıcıdan). **Konut kredisi (ipotek):** fiyatın en çok %{CX_LTV * 100:.0f}'i, vade {CX_MORT_TERM} hf., taksit gelirin en çok %{CX_DSR * 100:.0f}'i, faiz mevduat + {CX_MORT_MARGIN}; {CX_MORT_DEF} hafta ödenmezse haciz: konut kredi veren havuza devredilir ve her hafta ikinci el piyasada satışa çıkar (fiyat düşüşü zinciri).")
        tur = [("kurulus", "kuruluş"), ("arge_kurulus", "Ar-Ge DAO kuruluş"), ("buyume", "büyüme"), ("yatirim", "kapasite yatırımı"), ("arge", "Ar-Ge bütçe"), ("konut", "konut (ipotek)"), ("medya", "medya")]
        o += ["", "| Kredi türü | Adet | Hacim (Akçe) | Temerrüt |", "|---|---|---|---|"]
        for k_, nm_ in tur:
            o.append(f"| {nm_} | {L.flows['kredi_' + k_ + '_adet']:.0f} | {cx.get('hacim_' + k_, 0.0):,.0f} | {cx.get('temerrut_' + k_, 0.0):.0f} |")
        mt = R["cx"]["mort"]
        pool_units = sum(u_ for od_ in R["house"]["own"].values() for q_, u_ in od_.items() if str(q_).endswith("_sermaye"))
        o.append(f"\nİpotek: açık {len(mt)} (kalan borç {sum(m_['out'] for m_ in mt):,.0f}), kapanan {cx.get('ipotek_kapandi', 0):.0f}, haciz {L.flows['haciz_adet']:.0f} (kalan borç kaybı {cx.get('haciz_kayip_borc', 0.0):,.0f}), havuzların elindeki haciz konutu {pool_units:.0f} birim; ödenen ipotek faizi {L.flows['ipotek_faizi']:,.0f}. Toplam kredi (firma/DAO kredisi {R['credit']['out']:,.0f} + ipotek {sum(m_['out'] for m_ in mt):,.0f}) / mevduat (son): {(R['credit']['out'] + sum(m_['out'] for m_ in mt)) / max(1.0, R['credit']['dep']):.2f} (havuz boşta nakdi {R['credit']['pool']:,.0f}); kapasite artışı +{cx.get('kapasite_artis', 0.0):.0f} çalışan.")
        o.append("**Kontrat etkisi:** kredi türü alanı (`kredi_turu`: kuruluş / büyüme / yatırım / Ar-Ge / medya / konut), değişken faiz olayı (4 haftada bir), `ipotek_kredisi`, `ipotek_faizi`, `ipotek_geri`, `ipotek_kapama`, `haciz` (konut teminat devri → havuz), taksit kayıtları. **Basitleştirme:** oturulan ev (kendi evi) modelde yok, yalnız yatırım konutu ipoteği; medya kredisi: borçlu medya firması, ödeyen alıcı hesap, temerrütte medya şehre geri döner.\n")
    # ---- G) gerçek dünya
    last = weekly[-1]["series"]["inn"]
    emp = weekly[-1]["series"]["employed"]
    o.append(f"### Gerçek dünya kıyası (K-108)\n\n- Ar-Ge yoğunluğu: araştırmacı ücreti tüm ücretlerin %{100 * last['resw'] / max(1.0, last['wages']):.1f}'i (gerçek: gelişmiş ekonomide Ar-Ge harcaması GSYH'nin %2–3'ü); araştırmacı istihdam payı %{100 * last['res'] / max(1, emp):.1f} (gerçek ≈ %1–2).\n- Telif/Ar-Ge: telif geliri (hf.) sözleşme gelirinin %{100 * last['telif'] / max(1.0, last['contract']):.0f}'i (gerçekte patent lisans gelirleri Ar-Ge harcamasının küçük bir bölümü; ilk mucit kârı büyük, ikinci mucit gelince telif düşer).\n- Patent süresi {PATENT_TERM} hafta ≈ {PATENT_TERM * 7 / 24:.0f} gerçek gün (K-64 ölçeği); gerçekte 20 yıl.\n")
    return o
