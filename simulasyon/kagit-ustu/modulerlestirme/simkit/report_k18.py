"""simkit.report_k18: K-183/K-185/K-187 rapor bölümleri: firma fiyatı/kalite/medya, para arzı/kurtarma/lonca paketi/tahvil/politika, fiyatlandırma V2.

ARAYÜZ: k183_report, K_cx_fund, k187_report, k185_report
OKUR: R. YAZAR: yok (metin üretir).
KATMAN: L10 (rapor).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def k183_report(R, weeks, n_cities):
    """K-183: firma fiyatı, inovasyon rantı, kalite, doğrudan reklam, medya loncaları."""
    REF = R["rt"]["REF"]      # adım 8: modül durumu yerine R genişletmesi
    K = R["k183"]
    firms, people, L = R["firms"], R["people"], R["L"]
    o = []
    if FP_ACT:
        fd = K["fp_disp"]
        o.append("### K-183.1: firma fiyatı (aynı ürün için firmalar arası fiyat yayılımı)\n")
        o.append("Her satıcı fiyatını kendi koyar (şehir referansı × firma çarpanı: satamıyorsa indirir, stok bitince artırır, kalite farkıyla rakiplere göre konumlanır, birim maliyetin %85'inin altına inmez). "
                 "Değişim katsayısı = aynı ürünü satan (≥2 firma) tüm firmaların üretim ağırlıklı fiyat std / ortalama; max/min = en pahalı / en ucuz satıcının fiyat oranı.\n")
        o.append("| Hafta | Fiyat değişim katsayısı | Ort. max/min fiyat | Kalite std | Ürün sayısı |\n|---|---|---|---|---|")
        for (w_, cv_, rg_, qs_, n_) in fd[:: max(1, len(fd) // 12)]:
            o.append(f"| {w_} | {cv_:.3f} | {rg_:.2f} | {qs_:.3f} | {n_} |")
        tl = fd[-min(50, len(fd)):]
        if tl:
            o.append(f"\nSon {len(tl)} hafta ortalaması: değişim katsayısı {sum(x[1] for x in tl) / len(tl):.3f}, max/min {sum(x[2] for x in tl) / len(tl):.2f}, kalite std {sum(x[3] for x in tl) / len(tl):.3f}.")
    if RENT_ACT:
        o.append("\n### K-183.2: geçici inovasyon rantı\n")
        o.append(f"Piyasa fiyat çıpası öncünün değil rakiplerin (kadro × verim ağırlıklı) ortalama maliyetini izler ve haftada en çok %{RENT_FALL * 100:.1f} düşer. Rant = firmanın birim maliyeti rakip ortalamasından düşükse satılan değerin maliyet avantajı oranı (normal üstü kâr). Rant dönemi = rant payı > %0,5 olan ardışık ≥3 hafta.\n")
        o.append("| Dal | Toplam rant (Akçe) | Rant dönemi sayısı | Ort. dönem (hf.) | En uzun (hf.) | Rantlı hafta payı | Fiyat çıpası öncü maliyetinin üstünde: ort. / son 50 hf. | Tepe uzaklık (5 hf. ort.) ve yarıya inme süresi |\n|---|---|---|---|---|---|---|---|")
        for b in BRANCHES:
            h = K["rent_hist"].get(b, [])
            sp = list(K["rent_spells"].get(b, []))
            if K["rent_run"].get(b, 0) >= 3:
                sp.append((weeks - K["rent_run"][b], K["rent_run"][b]))
            nz = sum(1 for x in h if x[2] > 0.005)
            gp = [x[3] for x in h]
            ma = [sum(gp[max(0, i_ - 4):i_ + 1]) / len(gp[max(0, i_ - 4):i_ + 1]) for i_ in range(len(gp))]
            pk = max(range(len(ma)), key=lambda i_: ma[i_]) if ma else 0
            half = next((i_ - pk for i_ in range(pk, len(ma)) if ma[i_] <= 0.5 * ma[pk]), None) if (ma and ma[pk] > 0.02) else None
            o.append(f"| {b} | {K['rent_tot'].get(b, 0.0):,.0f} | {len(sp)} | {(sum(x[1] for x in sp) / len(sp)) if sp else 0:.1f} | {max([x[1] for x in sp] or [0])} | %{100 * nz / max(1, len(h)):.0f} | %{100 * sum(gp) / max(1, len(gp)):.1f} / %{100 * sum(gp[-50:]) / max(1, len(gp[-50:])):.1f} | " + (f"%{100 * ma[pk]:.0f} (h{h[pk][0]}); " + (f"{half} hf." if half is not None else "yarıya inmedi") if (ma and ma[pk] > 0.02) else "yok (<%2)") + " |")
        if any(K["rent_hist"].values()):
            o.append("\nFiyat çıpasının öncü maliyetine uzaklığı (yakınsama, dal ortalaması, %), her 50 haftada:\n")
            hdr = sorted({x[0] for h in K["rent_hist"].values() for x in h if x[0] % 50 == 0 or x[0] == weeks})
            o.append("| Dal | " + " | ".join(f"h{w_}" for w_ in hdr) + " |\n|---|" + "---|" * len(hdr))
            for b in BRANCHES:
                dd = {x[0]: x[3] for x in K["rent_hist"].get(b, [])}
                o.append(f"| {b} | " + " | ".join(f"{100 * dd[w_]:.1f}" if w_ in dd else "-" for w_ in hdr) + " |")
        ro = K["rent_owner"]
        tot_r = sum(ro.values()) or 1.0
        tel = sum(R["telif_in"].values())
        o.append(f"\nRantın kimde toplandığı (küm.): " + ", ".join(f"{k} {v:,.0f} (%{100 * v / tot_r:.0f})" for k, v in sorted(ro.items(), key=lambda kv: -kv[1])) + f". Toplam rant {sum(ro.values()):,.0f} Akçe; aynı sürede toplam telif {tel:,.0f} Akçe (rant / telif = {sum(ro.values()) / max(1.0, tel):.2f}).")
        dep = R["inn"].get("deposits", {})
        wl = lambda q: L.bal[q] + dep.get(q, 0.0)
        pl = [q for q, i in people.items() if i["who"] == "oyuncu"]
        inv = [q for q in pl if people[q].get("innov")]
        rent_pl = sorted(K["rent_by_player"].items(), key=lambda kv: -kv[1])
        if rent_pl:
            top = rent_pl[: max(1, len(rent_pl) // 10)]
            o.append(f"Rant alan oyuncu firması sahibi {len(rent_pl)}; en çok rant alan %10'un (n={len(top)}) toplam rantı %{100 * sum(v for _, v in top) / max(1.0, sum(v for _, v in rent_pl)):.0f}, ortalama serveti {sum(wl(q) for q, _ in top) / len(top):,.0f} Akçe; tüm oyuncuların ortalama serveti {sum(wl(q) for q in pl) / max(1, len(pl)):,.0f}; inovatörlerin (n={len(inv)}) ortalama serveti {sum(wl(q) for q in inv) / max(1, len(inv)):,.0f}.")
    if QL_ACT:
        fs = K["fstat"]
        o.append("\n### K-183.3 ve K-183.4: kalite, strateji ve segmentler\n")
        o.append(f"Kalite = {QB} + {QWI}·girdi kalitesi + {QWX}·tecrübe + {QWR}·ürün Ar-Ge'si ± strateji; strateji ucuz / orta / pahalı (işçi başına çıktı ×{QG_RATE[0]} / ×{QG_RATE[1]} / ×{QG_RATE[2]}, kalite {QG_SHIFT[0]:+.2f} / 0 / {QG_SHIFT[2]:+.2f}). Hane katmanı ağırlıkları (fiyat, kalite, itibar): normal {SEG_W[0]}, rahat {SEG_W[1]}, lüks {SEG_W[2]}.\n")
        rows = []
        for f_, v in fs.items():
            if v["n"] > 0 and v["prod"] > 0 and firms[f_]["kind"] not in ("ahir", "belediye", "arge", "market", "medya", "lojistik"):
                d_ = firms[f_]
                rows.append((v["q"] / v["n"], f_, v, d_))
        if rows:
            qs_sorted = sorted(rows, key=lambda x: x[0])
            totp = sum(x[2]["prod"] for x in rows) or 1.0
            cum, cuts = 0.0, []
            for x in qs_sorted:
                cum += x[2]["prod"]
                if len(cuts) == 0 and cum >= totp / 3:
                    cuts.append(x[0])
                elif len(cuts) == 1 and cum >= 2 * totp / 3:
                    cuts.append(x[0])
            tiers = [("düşük kalite", lambda q: q < cuts[0]), ("orta kalite", lambda q: cuts[0] <= q < cuts[1]), ("yüksek kalite", lambda q: q >= cuts[1])] if len(cuts) == 2 else []
            o.append(f"Kalite dilimleri (son 100 hafta, üretim ağırlıklı üçte birlik dilimler; kesimler q={cuts[0] if cuts else 0:.2f} / {cuts[1] if len(cuts) > 1 else 0:.2f}):\n")
            o.append("| Dilim | Firma (ort.) | Oyuncu firması (ort.) | Üretim payı | Ort. kalite | Gelir / çalışan-hf. | Kâr marjı (gelir - alım - ücret) / gelir | Marj > 0 olan firma payı |\n|---|---|---|---|---|---|---|---|")
            for nm, fn in tiers:
                g = [x for x in rows if fn(x[0])]
                if not g:
                    continue
                pn = sum(x[2]["prod"] for x in g)
                rev = sum(x[2]["rev"] for x in g)
                wk = sum(x[2]["w"] for x in g)
                prof = sum(x[2]["rev"] - x[2]["buy"] - x[2]["wage"] for x in g)
                pos = sum(1 for x in g if x[2]["rev"] - x[2]["buy"] - x[2]["wage"] > 0)
                o.append(f"| {nm} | {sum(x[2]['n'] for x in g) / 100:.0f} | {sum(x[2]['n'] for x in g if x[3]['owner'] is not None) / 100:.1f} | %{100 * pn / totp:.0f} | {sum(x[0] * x[2]['prod'] for x in g) / max(1e-9, pn):.2f} | {rev / max(1, wk):,.1f} | %{100 * prof / max(1.0, rev):.1f} | %{100 * pos / len(g):.0f} |")
        if rows:
            og = {}
            for x in rows:
                d_ = x[3]
                typ = "inovatör firma sahibi" if d_.get("innov_owner") else ("oyuncu firması" if d_["owner"] is not None else "NPC firma")
                og.setdefault(typ, []).append(x)
            o.append("\nOyuncu firması NPC'yi geçiyor mu? (son 100 hafta, firma bazlı; aynı ürünü üretenlerle karışık, üretim ağırlıklı):\n")
            o.append("| Tür | Firma (ort.) | Üretim payı | Teknoloji verimi | Kalite | Kurum itibarı | Gelir / çalışan-hf. | Kâr marjı | Marj > 0 olan firma payı |\n|---|---|---|---|---|---|---|---|---|")
            for typ in ("NPC firma", "oyuncu firması", "inovatör firma sahibi"):
                g = og.get(typ)
                if not g:
                    continue
                pn = sum(x[2]["prod"] for x in g)
                rev = sum(x[2]["rev"] for x in g)
                wk = sum(x[2]["w"] for x in g)
                prof = sum(x[2]["rev"] - x[2]["buy"] - x[2]["wage"] for x in g)
                pos = sum(1 for x in g if x[2]["rev"] - x[2]["buy"] - x[2]["wage"] > 0)
                wtd = lambda fn: sum(fn(x) * x[2]["prod"] for x in g) / max(1e-9, pn)
                o.append(f"| {typ} | {sum(x[2]['n'] for x in g) / 100:.1f} | %{100 * pn / totp:.0f} | {wtd(lambda x: x[3].get('tech', 1.0)):.3f} | {wtd(lambda x: x[0]):.2f} | {wtd(lambda x: K['orep'].get(x[1], 50.0)):.0f} | {rev / max(1, wk):,.1f} | %{100 * prof / max(1.0, rev):.1f} | %{100 * pos / len(g):.0f} |")
            pl_all = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge"]
            sv_ = []
            for nm_, fl_ in (("inovatör firma sahibi", lambda d: d.get("innov_owner")), ("diğer oyuncu firması", lambda d: not d.get("innov_owner"))):
                grp_ = [d for d in pl_all if fl_(d)]
                cells = []
                for h in (13, 26, 52, 104):
                    els = [d for d in grp_ if weeks - d["born"] >= h]
                    cells.append(f"{h} hf. %{100 * sum(1 for d in els if (d.get('died', 10 ** 9) - d['born']) >= h) / max(1, len(els)):.0f} (n={len(els)})")
                sv_.append(f"{nm_}: " + ", ".join(cells))
            o.append("\nHayatta kalma: " + "; ".join(sv_) + ".")
        pfs = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge" and d.get("grade0") is not None]
        sd_ = K["segd"]
        dsh = [sum(v for (p_, g_), v in sd_.items() if g_ == g) for g in (0, 1, 2)]
        o.append(f"\nHane talebinin katman payı (ürün sayısı ağırlıksız, sönümlü son hafta): normal %{100 * dsh[0] / max(1e-9, sum(dsh)):.0f}, rahat %{100 * dsh[1] / max(1e-9, sum(dsh)):.0f}, lüks %{100 * dsh[2] / max(1e-9, sum(dsh)):.0f}. Oyuncu firması stratejisini kuruluşta ve 13 haftada bir, açık kalan katman payına göre seçer.")
        o.append("\nOyuncu firmalarının KURULUŞTAKİ stratejisine göre hayatta kalma (strateji sonradan değişmiş olabilir) ve son 100 haftanın kârlılığı (son stratejiye göre):\n")
        o.append("| Strateji | Kurulan | Batan | 13 hf. | 26 hf. | 52 hf. | 104 hf. | Ort. kalite (son) | Gelir / çalışan-hf. | Kâr marjı |\n|---|---|---|---|---|---|---|---|---|---|")
        for g, nm in ((0, "ucuz"), (1, "orta"), (2, "pahalı")):
            gl = [d for d in pfs if d["grade0"] == g]
            gr_ = [x for x in rows if x[2]["grade"] == g and x[3]["owner"] is not None]
            rv_ = sum(x[2]["rev"] for x in gr_)
            wk_ = sum(x[2]["w"] for x in gr_)
            pf_ = sum(x[2]["rev"] - x[2]["buy"] - x[2]["wage"] for x in gr_)
            sv = []
            for h in (13, 26, 52, 104):
                els = [d for d in gl if weeks - d["born"] >= h]
                sv.append(f"%{100 * sum(1 for d in els if (d.get('died', 10 ** 9) - d['born']) >= h) / max(1, len(els)):.0f} (n={len(els)})")
            o.append(f"| {nm} | {len(gl)} | {sum(1 for d in gl if d.get('dead'))} | " + " | ".join(sv) + f" | {sum(d.get('q', QDEF) for d in gl) / max(1, len(gl)):.2f} | {rv_ / max(1, wk_):,.1f} | %{100 * pf_ / max(1.0, rv_):.1f} |")
        o.append("\nStrateji geçişleri (eski → yeni, adet): " + (", ".join(f"{a}→{b}: {n}" for (a, b), n in sorted(K["grade_log"].items())) or "yok") + ".")
        qs = K["qseg"]
        o.append("\nHane katmanının tükettiği kalite ve ödediği fiyat düzeyi (son 20 hafta; ürün değeri REF ile ağırlıklı):\n")
        o.append("| Hane katmanı | Ort. tüketilen kalite | Aynı ürünün tüm alıcılarına göre kalite farkı (ürün içi) | Teslim fiyat / referans |\n|---|---|---|---|")
        tot_u = defaultdict(float)
        tot_q = defaultdict(float)
        for (g, p), v in qs.items():
            tot_u[p] += v[0]
            tot_q[p] += v[1]
        for sg, nm in ((0, "normal"), (1, "rahat"), (2, "lüks")):
            wsum = sum(v[0] * REF[p] for (g, p), v in qs.items() if g == sg)
            dif = sum(v[0] * REF[p] * (v[1] / v[0] - tot_q[p] / tot_u[p]) for (g, p), v in qs.items() if g == sg and v[0] > 0 and tot_u[p] > 0) / max(1e-9, wsum)
            o.append(f"| {nm} | {sum(v[1] * REF[p] for (g, p), v in qs.items() if g == sg) / max(1e-9, wsum):.3f} | {dif:+.3f} | {sum(v[2] for (g, p), v in qs.items() if g == sg) / max(1e-9, wsum):.3f} |")
        o.append("\nÜrün Ar-Ge yolu (K-183.3): DAO yol değişimi: " + ", ".join(f"{k} {v}" for k, v in K["path_log"].items()) + ". Dal bazında öncü kalite düzeyi / kamu malı düzeyi (kalite katkısı = 1 - exp(-L/%d)): " % QK_SCALE
                 + ", ".join(f"{b} {K['FRONTQ'][b]:,.0f}/{K['PUBQ'][b]:,.0f}" for b in BRANCHES) + ".")
        npath = defaultdict(int)
        for n, d in firms.items():
            if d["kind"] == "arge" and not d.get("dead"):
                npath[d.get("path", "surec")] += 1
        o.append(f"Canlı DAO'lar yola göre: " + ", ".join(f"{k} {v}" for k, v in npath.items()) + ".")
    if DA_ACT:
        fl_ = L.flows
        ar = K["ad_rev_all"]
        tot_a = sum(ar.values()) or 1.0
        hhi = sum((v / tot_a) ** 2 for v in ar.values())
        ads_f = [d for d in firms.values() if d["kind"] == "medya" and not d.get("dead")]
        o.append("\n### K-183.5: doğrudan reklam ve kurum itibarı\n")
        o.append(f"DAO ve oyuncu firmaları medyadan (medya sahibi olmadan) doğrudan reklam alır: firma gelirinin %{AD_FIRM * 100:.0f}'i (fazla nakit şartıyla), DAO fazlasının %{AD_DAO * 100:.0f}'u. Reklam kurum itibarına birikim olarak yazılır (haftada %{(1 - ORG_AD_DECAY) * 100:.0f} aşınır), itibar alıcı seçiminde ve lonca/DAO/yatırımcı çekiminde ikinci katman.\n")
        o.append(f"- Doğrudan reklam alımı (küm.): {fl_.get('reklam_alimi', 0.0):,.0f} Akçe (firmalar {K['ad_stat'].get('firma', 0.0):,.0f}, DAO'lar {K['ad_stat'].get('dao', 0.0):,.0f}); lonca programı reklamı {fl_.get('reklam', 0.0) + fl_.get('reklam_ic', 0.0):,.0f}; toplam reklam geliri {sum(ar.values()):,.0f}, doğrudan payı %{100 * fl_.get('reklam_alimi', 0.0) / tot_a:.0f}.")
        o.append(f"- Reklam yoğunlaşması: medya firması sayısı {len(ads_f)}, reklam gelirinde HHI {hhi:.2f} (1/n = {1 / max(1, len(ar)):.2f}); en büyük medya payı %{100 * max(ar.values() or [0]) / tot_a:.0f}.")
    if MEDIA_ACT:
        ms = K["media_series"]
        o.append("\n### K-183.6: medya kanalları, medya DAO'ları ve medya loncaları\n")
        o.append(f"Medya yeni teknoloji dalı: Ar-Ge düzeyi eşikleri gazete → radyo ({MEDIA_CH_K[1]:,.0f}) → televizyon ({MEDIA_CH_K[2]:,.0f}) → internet ({MEDIA_CH_K[3]:,.0f}; yazılım ve donanım altyapısı şart); kanal Akçe başına etkili erişimi {MEDIA_REACH} katlar. Reklamveren medyayı etkili erişim^{MEDIA_GAMMA:g} × itibar ağırlığıyla seçer (eski kanal küçülür). "
                 f"Piyasanın gördüğü erişim rakip ortalamasını haftada en çok %{RENT_FALL * 100:.1f} izler (geçici rant). Yeni medya DAO'su: şehir başına tek medya sınırı yok; şehirdeki reklam geliri firma başına işletme giderinin {MEDIA_ENTRY_K} katını aşınca kurulur.\n")
        if ms:
            o.append("| Hafta | Medya sayısı | Ort. erişim (rakip) | Piyasanın gördüğü erişim | En iyi kanal erişimi | Reklam maliyeti (Akçe / etkili erişim) | Reklam gelirinde kanal payı (gazete/radyo/TV/internet, %) | İnovatör rantı (Akçe/hf) |\n|---|---|---|---|---|---|---|---|")
            for (w_, n_, et_, em_, mx_, cp_, bc_, iw_) in ms[:: max(1, len(ms) // 14)] + ([ms[-1]] if (len(ms) - 1) % max(1, len(ms) // 14) else []):
                tc_ = sum(bc_) or 1.0
                o.append(f"| {w_} | {n_} | {et_:.2f} | {em_:.2f} | {mx_:.1f} | {cp_:.3f} | " + "/".join(f"{100 * x_ / tc_:.0f}" for x_ in bc_) + f" | {iw_:,.0f} |")
        li = K["lonca_info"]
        ml = {l_: v_ for l_, v_ in li.items() if v_.get("focus") == "medya"}
        mfirms = [d for d in firms.values() if d["kind"] == "medya"]
        o.append(f"\n- Medya firması: şu an canlı {sum(1 for d in mfirms if not d.get('dead'))} (NPC {sum(1 for d in mfirms if not d.get('dead') and d['owner'] is None)}, oyuncu medya DAO'su {sum(1 for d in mfirms if not d.get('dead') and d['owner'] is not None)}), toplam kurulan oyuncu medya DAO'su {sum(1 for d in mfirms if d['owner'] is not None)}, batan {sum(1 for d in mfirms if d['owner'] is not None and d.get('dead'))}.")
        o.append("- Medya loncası kuruluş filtresi (aday-hafta sayıları): " + (", ".join(f"{k_.strip()} {v_}" for k_, v_ in K["nl_dbg"].items()) or "aday yok") + ".")
        o.append(f"- Medya loncası: kurulan {len(ml)}, kapanan {sum(1 for v_ in ml.values() if v_.get('end') is not None)}; şu an üyesi olan medya firması {sum(1 for d in mfirms if not d.get('dead') and d['lonca'] in ml)}. " + ("; ".join(f"{l_} (kurucu {v_['founder']}, h{v_['start']}" + (f"–h{v_['end']}: {v_.get('reason', '')}" if v_.get('end') is not None else "") + f", açılış fee %{v_.get('fee0', 0) * 100:.1f})" for l_, v_ in list(ml.items())[:8])))
        mdao = [n_ for n_ in R["inn"]["dao_all"] if firms[n_].get("branch") == "medya"]
        o.append(f"- Medya dalında Ar-Ge DAO'su (şu an dalı medya olan): {len(mdao)} (canlı {sum(1 for n_ in mdao if not firms[n_].get('dead'))}); medya öncü Ar-Ge düzeyi {K['FRONT'].get('medya', 0.0):,.0f}.")
    return (["\n## K-183: firma fiyatı, rant, kalite, reklam, medya\n"] + o) if o else []


def K_cx_fund(R):
    return R["k185"]["capex_stat"].get("fon_ayrilan", 0.0)


def k187_report(R, weeks, n_cities):
    """K-187: fiyatlandırma V2, sektör kârlılığı, tipik firma dökümü, kamu hizmet sözleşmesi."""
    LOG_MULT = R["rt"]["LOG_MULT"]      # adım 8: modül durumu yerine R genişletmesi
    MARKET_MARKUP = R["rt"]["MARKET_MARKUP"]      # adım 8: modül durumu yerine R genişletmesi
    MM_BASE = R["rt"]["MM_BASE"]      # adım 8: modül durumu yerine R genişletmesi
    TAXV = R["rt"]["TAXV"]      # adım 8: modül durumu yerine R genişletmesi
    if not (PRICE_V2 or PV2_ACCT):
        return []

    def find(d, key):
        if isinstance(d, dict):
            if key in d:
                return d[key]
            for v in d.values():
                r = find(v, key) if isinstance(v, dict) else None
                if r is not None:
                    return r
    v2k, snap = find(R, "v2k") or {}, find(R, "v2snap") or {}
    L = R["L"]
    o = ["\n## K-187: firma fiyatlandırması V2 (`PRICE_V2`), makine/bina kalibrasyonu, kamu hizmet sözleşmesi, kredi şartları (sahip kararı 2026-10-27)\n"]
    o.append(f"Fiyat katmanları (v12.2: REF, çıpa, PM, FPM, RENT_FALL, normalizasyon) yerine: her firma fiyatını kendi TAM birim maliyetinden belirler. Maliyet, firmanın gerçekte ödediği her giderin (ücret, yönetici/uzman, girdi, navlun, lonca fee ve işletme gideri, telif, satış vergisi, kira, faiz, depo, sigorta, makine/bina; sermaye/dağıtım kalemleri `NONCOST_KINDS` dışında) firma gider defterinden (Ledger.pay: `fexp`) sönümlü (%{PV2_EMA * 100:.0f}/hf) toplamıdır; yeni bir gider türü kendiliğinden fiyata yansır. Fiyat = birim maliyet × (1 + marj): hedef marj %{PV2_M0 * 100:.0f}; satılamayan (%{FP_TOL * 100:.0f} üstü) fiyatı indirir, stok bitince/kıtlıkta artırır (rakip tavanı ×{FP_RIVAL_CAP}), değişken maliyetin altına inmez, rekabet rantı (hedefin %{PV2_EXTRA * 100:.0f} üstü) kıtlık yokken aşınır. Normalizasyon yok: şehir fiyatı firma fiyatlarının üretim ağırlıklı ortalaması; PM yalnız piyasa sıkılığı göstergesi. Perakende marjı ve navlun, gider/gelir oranından (hedef %{PV2_MM_M * 100:.0f}) denetleyiciyle türer (son raf çarpanı {MARKET_MARKUP / MM_BASE[0]:.2f}, navlun çarpanı {LOG_MULT[0]:.2f}). Makine/bina yuvası {MACH_AL:g}+{MACH_BI:g} birim / {BLD_INS:g} inşaat ({'kalibre: yuva başına ≈107 Akçe ≈ 7 haftalık çırak ücreti; eski ≈1188 Akçe = 76 hafta, sermaye stoku para arzının ~4 katıydı' if CAPEX_CAL else 'eski'}).\n")
    wins = [(2, 26), (27, 52), (53, 104), (max(105, weeks - 51), weeks)] if weeks >= 110 else [(2, min(26, weeks)), (min(27, weeks), weeks)]
    for a, b in wins:
        if b < a:
            continue
        agg = defaultdict(lambda: [0.0] * 8)
        for w_ in range(a, b + 1):
            for k_, v_ in v2k.get(w_, {}).items():
                for i_ in range(8):
                    agg[k_][i_] += v_[i_]
        if not agg:
            continue
        o.append(f"\n### Sektör kârlılığı, hafta {a}-{b} (gelir = satış; gider = gider defteri; marj = (gelir-gider)/gelir; zararlı = haftada gideri geliri aşan firma-hafta payı)\n")
        o.append("| Sektör | Firma-hafta | Gelir/hf | Gider/hf | Marj | Zararlı firma payı | NPC marjı | Oyuncu/özel marjı |")
        o.append("|---|---|---|---|---|---|---|---|")
        n_ = b - a + 1
        tot = [0.0] * 8
        for k_, v_ in sorted(agg.items()):
            for i_ in range(8):
                tot[i_] += v_[i_]
            mg = 100 * (v_[0] - v_[1]) / v_[0] if v_[0] > 0 else float("nan")
            nm = f"%{100 * (v_[4] - v_[5]) / v_[4]:.1f}" if v_[4] > 0 else "-"
            pm = f"%{100 * (v_[6] - v_[7]) / v_[6]:.1f}" if v_[6] > 0 else "-"
            o.append(f"| {k_} | {v_[2]:.0f} | {v_[0] / n_:,.0f} | {v_[1] / n_:,.0f} | %{mg:.1f} | %{100 * v_[3] / max(1.0, v_[2]):.0f} | {nm} | {pm} |")
        o.append(f"| **Toplam** | {tot[2]:.0f} | {tot[0] / n_:,.0f} | {tot[1] / n_:,.0f} | %{100 * (tot[0] - tot[1]) / max(1.0, tot[0]):.1f} | %{100 * tot[3] / max(1.0, tot[2]):.0f} | %{100 * (tot[4] - tot[5]) / max(1.0, tot[4]):.1f} | %{100 * (tot[6] - tot[7]) / max(1.0, tot[6]):.1f} |")
    o.append("\n### Tipik firma gelir-gider tablosu (sektör toplamı/firma sayısı; haftalık, Akçe)\n")
    for w_ in sorted(snap):
        o.append(f"\n**Hafta {w_}**\n")
        o.append("| Sektör | NPC / oyuncu firma | Satış geliri/firma | Gider/firma | Marj | Fiyat (ağırlıklı) | Birim maliyet (defter) | Gider kalemleri (payı) |")
        o.append("|---|---|---|---|---|---|---|---|")
        by = defaultdict(list)
        for f_, x_ in snap[w_].items():
            by[x_["kind"]].append(x_)
        for k_ in ("tarla_bugday", "un", "firin", "market", "lojistik", "santral", "guvenlik", "maden_aluminyum", "kola", "cam", "restoran"):
            xs = by.get(k_)
            if not xs:
                continue
            n_ = len(xs)
            rev = sum(x_["rev"] for x_ in xs)
            cost = sum(x_["tot"] for x_ in xs)
            pr = sum(x_["prod"] for x_ in xs)
            cat = defaultdict(float)
            for x_ in xs:
                for c_, v_ in x_["cat"].items():
                    cat[c_] += v_
            top = ", ".join(f"{c_} %{100 * v_ / max(1e-9, cost):.0f}" for c_, v_ in sorted(cat.items(), key=lambda kv: -kv[1])[:5])
            fpr = sum(x_["price"] * x_["prod"] for x_ in xs) / max(1e-9, pr)
            ucu = sum(x_["uc"] * x_["prod"] for x_ in xs) / max(1e-9, pr)
            o.append(f"| {k_} | {sum(1 for x_ in xs if x_['npc'])} / {sum(1 for x_ in xs if not x_['npc'])} | {rev / n_:,.0f} | {cost / n_:,.0f} | %{100 * (rev - cost) / max(1.0, rev):.1f} | {fpr:.3f} | {ucu:.3f} | {top} |")
    o.append(f"\n### Kamu hizmet sözleşmesi (`PUBSVC`), kredi şartları (`CRED_V2`), diğer\n")
    o.append(f"`kamu_hizmet_sozlesmesi` (düzenlenen altyapı: {', '.join(PV2_REG)}; fiyat tam maliyet tarifesi, sönümlü yapısal açığın %{PUBSVC_SHARE * 100:.0f}'i şehir kendi gelirinden, basımsız, özelleştirilince de sürer): toplam {L.city_out.get('kamu_hizmet_sozlesmesi', 0.0):,.0f} Akçe; `altyapi_hizmet_sozlesmesi` (işletme sermayesi tamamlama) {L.city_out.get('altyapi_hizmet_sozlesmesi', 0.0):,.0f}. Kredi (`CRED_V2`): yeni kurulan (ilk {YOUNG_WEEKS} hf) ve özelleştirmeyle devralınan firma yaş şartından muaf; devralınanda kâr şartı ilk {CRED_PLAN_WEEKS} hf devir planıyla değerlendirilir. KDV kuralı (`TAX_RULE`): {'açık' if TAX_RULE else 'kapalı'}; son KDV {TAXV[0] * 100:.1f}%. İşsiz deneyimli oyuncunun firma kurması (`ENTRY_JOBLESS`): {'açık' if ENTRY_JOBLESS else 'kapalı'}.\n")
    return o


def k185_report(R, weeks, n_cities):
    """K-185 (v12.2): sahip kararları: para arzı tavanı, NPC kurtarma, lonca sosyal paketi, tahvil, politika faizi, kaldıraç, yatırım, konut, medya, tasfiye, sigorta, sağlık, eğitim; çöküş tanıları."""
    WI = R["rt"]["WI"]      # adım 8: modül durumu yerine R genişletmesi
    if not any((INVENTORY, NPC_LABOR, WEALTH_RULE, NPC_POOL_CONS, MONEY_CAP, NO_BAILOUT, LONCA_WELFARE, CITY_BOND, RATE_POLICY, LONCA_LEVERAGE, CAPEX, HOUSE_BUILD_X, MEDIA_LONCA_EASY, LIQUIDATION, INSURANCE, HEALTH, EDUCATION, ENTRY_FIX, YOUNG_CREDIT, RENEW_FUND)):
        return []
    K, L, weekly, firms, people = R["k185"], R["L"], R["weekly"], R["firms"], R["people"]
    o = ["\n## K-185: v12.2 (sahip kararları 2026-10-27)\n"]
    # --- 1) para arzı tavanı
    last = weekly[-1]
    yrs = weeks / 52.0
    op_ = weekly[min(len(weekly), MINT_OPEN_WEEKS) - 1]["minted"]
    post = L.minted - op_
    sup0 = weekly[min(len(weekly) - 1, MINT_OPEN_WEEKS)]["series"]
    o += ["### K-185.1: para arzı tavanı (`MONEY_CAP`)\n",
          f"Tavan: yılda para arzının %{100 * MINT_YEAR:.0f}'si (haftalık izin birikimli); açılış {MINT_OPEN_WEEKS} hafta muaf. **Toplam basım {L.minted:,.0f}** (açılış {op_:,.0f}; açılış sonrası {post:,.0f}); açılış sonrası yıllık basım / son para arzı: %{100 * post / max(1.0, yrs - MINT_OPEN_WEEKS / 52.0) / max(1.0, L.minted):.2f}; verilen toplam izin {K['mint_allow']:,.0f}; "
          f"tavan {'tuttu' if post <= K['mint_allow'] * 1.001 + 1 else 'AŞILDI'}. Yeni oyuncu girişi modelde yok (nüfus kapalı), izin şehir kasalarına gider.\n",
          "Kısılan şehir harcaması (tür, Akçe): " + ", ".join(f"`{k_}` {v_:,.0f}" for k_, v_ in sorted(K["cut"].items(), key=lambda t: -t[1])) + ".\n",
          "| Hafta | Para arzı | Sepet fiyat endeksi | Şehir kasaları | Toplam basım |", "|---|---|---|---|---|"]
    for r_ in weekly:
        if r_["week"] in (1, 13, 26, 52, 100, 150, 200, 250, 300, 400, 500) or r_["week"] == weeks:
            o.append(f"| {r_['week']} | {sum(L_ for L_ in [r_['players'], r_['npcs'], r_['firms'], r_['loncas'], r_['cities']]):,.0f} | {r_['series']['pidx']:.0f} | {r_['series']['treasury']:,.0f} | {r_['minted']:,.0f} |")
    pid = [r_["series"]["pidx"] for r_ in weekly]
    o.append(f"\nSepet fiyat endeksi: yıllık ortalama değişim (ilk 52 hf sonrası, 10 yıllık parçalar): " + ", ".join(
        f"{pid[min(len(pid) - 1, i + 520)] / max(1e-9, pid[i + 52]) - 1:+.0%}" for i in range(52, max(53, len(pid) - 520), 520)) if len(pid) > 600 else "\nSepet fiyat endeksi seyri tabloda.")
    # --- 2) NPC
    nl = K["npc_log"]
    died = [(w_, c_, k_) for w_, c_, k_, e_ in nl if e_ in ("battı", "temerrut")]
    rev = [(w_, c_, k_) for w_, c_, k_, e_ in nl if e_ == "canlandi"]
    pf_born = [(d_["born"], d_["city"], d_["kind"]) for d_ in firms.values() if d_.get("owner") in people and d_["kind"] != "arge" and "born" in d_]
    filled_p = filled_r = 0
    for w_, c_, k_ in died:
        if any(c2 == c_ and k2 == k_ and w_ <= w2 <= w_ + 26 for w2, c2, k2 in rev):
            filled_r += 1
        elif any(c2 == c_ and k2 == k_ and w_ <= w2 <= w_ + 52 for w2, c2, k2 in pf_born):
            filled_p += 1
    fl = L.flows
    o += ["\n### K-185.2: NPC kurtarma yok (`NO_BAILOUT`)\n",
          f"Açılış geçişi {NPC_GRACE} hf; sonra kronik zararlı NPC kurtarılmaz (sönümlü işletme nakit akışı < -%{100 * NPC_FAIL:.0f} × işletme sermayesi, {NPC_DIE_WEEKS} hafta ödeme gücü yok). Sağlıklı ama nakit sıkışık NPC'ye şehir yalnız KENDİ gelirinden (basımsız, tahvilsiz) iade edilen avans (`NPC_FLOAT`): {fl['npc_likidite_avansi_adet']:.0f} adet. "
          f"Kamu altyapısı istisna (kurtarma değil, süregelen destek): {', '.join(NPC_EXEMPT)}. Lonca köprü kredisi {fl['npc_kopru_kredisi_adet']:.0f} adet / {fl['npc_kopru_kredisi']:,.0f} Akçe.\n",
          f"**NPC batışı {len(died)}**, lonca kredisiyle yeniden kurulan {len(rev)}; batanın yerini dolduran: lonca kredili yeni NPC %{100 * filled_r / max(1, len(died)):.0f}, oyuncu firması (52 hf içinde aynı şehir ve tür) %{100 * filled_p / max(1, len(died)):.0f}, boş kalan %{100 * (len(died) - filled_r - filled_p) / max(1, len(died)):.0f}. "
          f"Batış zararı lonca havuzuna {fl['npc_batis_kayip_akce']:,.0f} Akçe. Şehir kasasından `npc_kurulus_sermayesi`: {L.city_out.get('npc_kurulus_sermayesi', 0.0):,.0f} (eski v12.1: 11,7 M). İşsiz NPC havuzunun atıl nakdi şehir kasasına vergi: {fl['npc_havuz_vergisi']:,.0f} (kök bulgu: aksi halde para arzının %60+'ı talepten kaçıyordu).\n"]
    kc = defaultdict(lambda: [0, 0])
    for w_, c_, k_ in died:
        kc[k_][0] += 1
    for w_, c_, k_ in rev:
        kc[k_][1] += 1
    o.append("Batış / yeniden kuruluş (tür): " + ", ".join(f"{k_} {a_}/{b_}" for k_, (a_, b_) in sorted(kc.items(), key=lambda t: -t[1][0])[:14]) + ".\n")
    # --- 2b) özelleştirme
    if PRIVATIZE and NO_BAILOUT:
        ps, pl, pt = K["priv_stat"], K["priv_log"], K["priv_ts"]
        pf_ = K["priv_firms"]
        n_ = max(1, ps.get("devir", 0))
        alive_ = [x_ for x_ in pf_.values() if not x_["dead"]]
        al2_ = [e_ for e_ in pl if e_["end"] is None]
        o += ["\n### K-185.17: özelleştirme (`PRIVATIZE`, sahip kararı) ve yenileme fonu (`RENEW_SOFT`)\n",
              f"Zarara düşen NPC firma (sönümlü işletme nakit akışı < -%{100 * PRIV_LOSS:.0f} × işletme sermayesi {PRIV_WEEKS} hafta üst üste, ya da ödeme gücü sayacı >= {PRIV_INSOLV}) batmadan ihaleye çıkar; üretim ve kadro durmaz; işletme bütün olarak (makine, bina, stok, işçi, müşteri, borç) devredilir. "
              f"Fiyat = (tasfiye değeri + %{100 * PRIV_F0:.0f} × (devam eden değer - tasfiye)) × düşen çarpan (her tur -%{100 * PRIV_FSTEP:.0f} puan, taban %{100 * PRIV_FLOOR:.0f}) - devralınan borç; {PRIV_ROUNDS} hafta alıcı yoksa zayıf firma tasfiye, sağlıklı olan {PRIV_RETRY} hafta bekler. Alıcı: en yüksek puanlı oyuncu (itibar, sektör deneyimi, nakit); "
              f"oyuncu yoksa ya da puanı < {PRIV_LONCA_SCORE} ise (ihale turu >= {PRIV_LONCA_FROM}) **lonca devralır (istisna: lonca firma KURMAZ, yalnız özelleştirmede devralır)**. DAO alıcı yok (üretim DAO'su modelde yok; sadeleştirme). Kâr: oyuncuya temettü (stopaj şehre), loncaya havuz kârı.\n",
              f"Özelleştirme kredisi: bedelin %{100 * PRIV_LTV:.0f}'i + işletme sermayesi desteği, lonca havuzundan (devir başına en çok %{100 * PRIV_POOL_SHARE:.0f}), faiz ×{PRIV_RATE_MULT}, ilk {PRIV_GRACE} hf yalnız faiz, vade {PRIV_TERM} hf, teminat devralınan varlık; eski NPC borcu işletmeyle devredilir (fiyattan düşülür).\n",
              f"**İhale {ps.get('ihale', 0):.0f}, devir {ps.get('devir', 0):.0f}** (oyuncu {ps.get('devir_oyuncu', 0):.0f}, lonca {ps.get('devir_lonca', 0):.0f}); ortalama ihale turu {ps.get('tur_toplam', 0) / n_:.1f}; alıcı bulunamayan tur {ps.get('alici_yok_tur', 0):.0f}; tasfiye {ps.get('tasfiye', 0):.0f}; bekletilen {ps.get('alici_yok_bekle', 0):.0f}.\n",
              f"Devir bedeli toplam {ps.get('bedel', 0):,.0f} Akçe (şehir kasasına), devam eden değer {ps.get('defter', 0):,.0f}, tasfiye değeri {ps.get('tasfiye_degeri', 0):,.0f}; bedel / devam eden değer %{100 * ps.get('bedel', 0) / max(1.0, ps.get('defter', 0)):.0f}. Kredi hacmi {ps.get('kredi_hacim', 0):,.0f} Akçe, açık bakiye son haftada {(pt[-1][8] if pt else 0):,.0f}.\n",
              f"Sonuç: devredilen {len(pl)} işletmeden {len(al2_)} hala özel ve ayakta ({100 * len(al2_) / max(1, len(pl)):.0f}%); biten: batış {ps.get('biten_bati', 0):.0f}, temerrüt {ps.get('biten_temerrut', 0):.0f}; ortalama ömür (biten) {ps.get('omur_hafta', 0) / max(1.0, ps.get('biten_bati', 0) + ps.get('biten_temerrut', 0)):.0f} hf; ayaktakilerin ortalama sönümlü haftalık kâr {sum(x_['prof'] for x_ in alive_) / max(1, len(alive_)):,.0f}. Oyuncu adayı reddi (aday-tur): uygun değil {ps.get('red_uygun_degil', 0):.0f}, nakit yetmedi {ps.get('red_nakit', 0):.0f}, fiyat eşiği {ps.get('red_fiyat', 0):.0f}. Oyuncuya akan temettü {ps.get('temettu_oyuncu', 0):,.0f}, loncaya kâr {ps.get('kar_lonca', 0):,.0f}.\n",
              f"Altyapı (şeffaf kalem): özelleştirilene kadar kamu altyapısı kesintisiz çalışır, şehir gelirinden (BASIMSIZ) `altyapi_hizmet_sozlesmesi` ile finanse edilir: toplam {L.city_out.get('altyapi_hizmet_sozlesmesi', 0.0):,.0f} Akçe. Aynı yöntemle özelleştirilebilir.\n",
              "| Hafta | NPC firma | NPC işçi | Özel (oyuncu) firma | işçi | Lonca firma | işçi | Açık ihale | Özelleştirme kredi bakiyesi |", "|---|---|---|---|---|---|---|---|---|"]
        for r_ in pt:
            if r_[0] in (30, 50, 100, 150, 200, 250, 300, 400, 500) or r_[0] == weeks:
                o.append("| " + " | ".join(f"{x_:,.0f}" for x_ in r_) + " |")
        kc2 = defaultdict(lambda: [0, 0])
        for e_ in pl:
            kc2[e_["kind"]][0] += 1
            kc2[e_["kind"]][1] += e_["end"] is None
        o.append("\nDevir (tür; devredilen / hala özel): " + ", ".join(f"{k_} {a_}/{b_}" for k_, (a_, b_) in sorted(kc2.items(), key=lambda t: -t[1][0])[:14]) + ".\n")
        if RENEW_SOFT:
            o.append(f"Yenileme fonu (`RENEW_SOFT`): fon nakit çekmez; firma kasasında kalır, yalnız temettü ve şehre kâr süpürmesi kısıtlanır (ayrılan {K_cx_fund(R):,.0f} Akçe).\n")
    # --- 3) lonca refah
    if LONCA_WELFARE:
        ws = K["wf_stat"]
        o += ["### K-185.3: lonca sosyal paketi (`LONCA_WELFARE`, zorunlu değil)\n",
              f"Şehir yalnız asgari güvence: işsizlik ödeneği ×{WELF_CITY_MULT}, çıraklık ocağı ücreti ×{WELF_AHIR_MULT}. Lonca paketi: işsizlik ödeneği ek (cömertlik = ücret payı, en çok {WELF_GMAX}), çıraklık bursu (cömertlik × {WELF_BURS_RATIO}); fee gelirinin en çok %{100 * WELF_SHARE_MAX:.0f}'i; rezerv şartı {WELF_RES_WEEKS} hafta; kriz anında kesinti. Hastalık/yaşlılık: hastalık madde 12 (sağlık sigortası), yaşlılık modelde yok (yaş yok).\n",
              f"İşsiz-döngü {ws.get('issiz_dongu', 0):,.0f}; lonca paketi alan {ws.get('lonca_issiz_dongu', 0):,.0f} (%{100 * ws.get('lonca_issiz_dongu', 0) / max(1.0, ws.get('issiz_dongu', 0)):.0f}); yalnız asgari alan (açıkta kalan) {ws.get('asgari_kalan_dongu', 0):,.0f} (%{100 * ws.get('asgari_kalan_dongu', 0) / max(1.0, ws.get('issiz_dongu', 0)):.0f}); lonca ödenek {ws.get('lonca_issiz_akce', 0):,.0f} (sigortadan {ws.get('sigorta_issiz_akce', 0):,.0f}); lonca burs {ws.get('burs_akce', 0):,.0f}; kriz kesintisi (cömertlik azaltma) {ws.get('kesinti', 0):.0f} kez.\n",
              "| Hafta | Yaşayan lonca | Paket sunan | Cömertlik dağılımı | Ort. etkin | Refah fonu |", "|---|---|---|---|---|---|"]
        for h in K["wf_hist"]:
            if h[0] % 50 == 0 or h[0] == weeks:
                o.append(f"| {h[0]} | {h[1]} | {h[2]} | {', '.join(f'{x:.2f}' for x in h[3])} | {h[4]:.3f} | {h[5]:,.0f} |")
    # --- 4) tahvil
    bs = K["bond_stat"]
    rev_tot = sum(r_["series"].get("treasury", 0.0) for r_ in weekly[-1:])
    o += ["\n### K-185.4: şehir tahvili (`CITY_BOND`)\n",
          f"Şehir kasası açık verince (basım izni dolunca) lonca havuzlarına tahvil satar; vade {BOND_TERM} hf eşit taksit; faiz = taban × {BOND_RATE_MULT} + {BOND_MARGIN}; borç tavanı {BOND_DEBT_MAX_W} haftalık (yavaş sönümlenen) referans gelir; tavanda harcama kısılır (temerrüt yok, ödenemeyen kupon ertelenir ve faiz işlemez). "
          f"İhraç {bs.get('ihrac', 0):,.0f} ({bs.get('ihrac_adet', 0):.0f} işlem); ödenen faiz {bs.get('faiz', 0):,.0f}; itfa {bs.get('itfa', 0):,.0f}; son borç {K['bonds_out']:,.0f}; ertelenen kupon {bs.get('ertelenen_kupon', 0):,.0f}; kısma (ihraç talebi reddi) {bs.get('kisma_adet', 0):,.0f} kez. "
          f"Faiz yükü / toplam şehir geliri: %{100 * bs.get('faiz', 0) / max(1.0, sum(L.flows[k_] for k_ in ('npc_kar', 'satis_vergisi', 'konut_kirasi_sehir', 'gelir_vergisi', 'temettu_vergisi', 'npc_havuz_vergisi'))):.1f} (başlıca gelir kalemleri).\n"]
    # --- 5) politika faizi
    ph = K["pol_hist"]
    if ph:
        o += ["### K-185.5: politika faizi (`RATE_POLICY`)\n",
              f"Kural (zincirde açık): hedef = {POL_NEUT} + {POL_A_INF}×(yıllık sepet enflasyonu - {POL_INF_TGT}) - {POL_A_U}×(işsizlik - {POL_U_STAR}) - {POL_A_IDLE}×(boşta mevduat payı - {POL_IDLE_STAR}); haftalık en çok ±{POL_STEP}; [{POL_MIN}, {POL_MAX}]. Lonca kredi faizi = (politika + {CX_MARGIN} + lonca risk marjı) × itibar çarpanı; tahvil faizi = taban × {BOND_RATE_MULT}. `politika_faizi` olayı: {L.flows['politika_faizi_olayi']:.0f} değişim.\n",
              "| Hafta | Politika faizi (hf.) | İşsizlik | Enflasyon (yıllık) | Boşta mevduat payı |", "|---|---|---|---|---|"]
        for h in ph:
            if h[0] % 50 == 0 or h[0] == weeks:
                o.append(f"| {h[0]} | %{100 * h[1]:.3f} | %{100 * h[2]:.0f} | %{100 * h[3]:.0f} | %{100 * h[4]:.0f} |")
        o.append("\nKredi/mevduat (kredi + ipotek + tahvil) ve politika faizi seyri: " + ", ".join(f"hf{h[0]} %{100 * h[1]:.2f}/oran {h[5]:.2f}" for h in ph if h[0] % 50 == 0) + f". Hedef oran {POL_CD_STAR} (`POL_CD`, katsayı {POL_A_CD}); mevduat faizi kredi faizinden ödenir, negatif faiz yok.")
        o.append("Kredi kapısı (firma kredisi uygunluk testi) sayaç: " + ", ".join(f"{k_} {v_:,.0f}" for k_, v_ in sorted(K.get("cx_ref", {}).items(), key=lambda t: -t[1])) + ".")
        o.append("Oyuncu harcama / gelir (servet onda birlikleri): ondalık | ort. servet | haftalık gelir (sönümlü) | haftalık harcama (alışkanlık) | harcama/gelir: " + "; ".join(f"{a_} {b_:,.0f} {c_:,.0f} {d_ * CYCLES_PER_WEEK:,.0f} {d_ * CYCLES_PER_WEEK / max(1e-9, c_):.2f}" for a_, b_, c_, d_ in K.get("spend_diag", [])))
        o.append(f"\nPolitika faizi ortalama %{100 * sum(h[1] for h in ph) / len(ph):.3f}, en düşük %{100 * min(h[1] for h in ph):.3f}, en yüksek %{100 * max(h[1] for h in ph):.3f}.")
    # --- 6) kaldıraç ve mevduat kaybı
    ls = K["liq_stat"]
    o += ["\n### K-185.6: lonca kaldıracı (`LONCA_LEVERAGE`)\n",
          f"Kredi (firma + konut) en çok k={LEV_K:g} × özkaynak (nakit + krediler + tahviller - mevduat). Mevduat sigortası yok. Batan lonca: mevduat kaybı {L.flows['mevduat_kaybi_akce']:,.0f} Akçe ({L.flows['mevduat_kayipli_lonca_adet']:.0f} lonca); lonca kapanışı {L.flows['lonca_kapanis_adet']:.0f}; tasfiyede mevduat {ls.get('mevduat_tasfiye', 0):,.0f} (ödenen {ls.get('mevduat_odenen', 0):,.0f}).\n"]
    # --- 7) capex
    cs = K["capex_stat"]
    o += ["### K-185.7: makine ve bina yatırımı (`CAPEX`)\n",
          f"Üretim = çalışan × min(1, yuva/çalışan); makine yuvası = {MACH_AL:g} alüminyum + {MACH_BI:g} bileşen, bina yuvası = {BLD_INS:g} inşaat birimi (gerçek takas); amortisman makine %{100 * DEPR_M:.2f}/hf, bina %{100 * DEPR_B:.2f}/hf; açılıştan {CAPEX_START} hf sonra; yenileme fonu (`RENEW_FUND`): firma temettü ve NPC kâr süpürmesinden önce amortisman kadarını ayırır (ayrılan {cs.get('fon_ayrilan', 0):,.0f}, kullanılan {cs.get('fon_kullanilan', 0):,.0f}). "
          f"Makine alımı {cs.get('makine_akce', 0):,.0f} (yuva {cs.get('makine_yuva', 0):,.0f}), bina {cs.get('bina_akce', 0):,.0f} (yuva {cs.get('bina_yuva', 0):,.0f}); amortisman {cs.get('amortisman_akce', 0):,.0f}; yatırım+yenileme kredisi {cs.get('kredi_akce', 0):,.0f} (yenileme/NPC dahil {cs.get('yenileme_kredisi', 0):,.0f}); kapasite artışı +{cs.get('kapasite_artis', 0):.0f} çalışan.\n",
          "| Hafta | Yuva | Çalışan | Sermaye eksiği olan firma | Firma | Küm. makine | Küm. bina | Küm. amortisman | İnşaat çalışanı | Elektronik+alüminyum çalışanı |", "|---|---|---|---|---|---|---|---|---|---|"]
    for h in K["capex_ts"]:
        if h[0] % 50 == 0 or h[0] == weeks:
            o.append(f"| {h[0]} | {h[1]:,.0f} | {h[2]:,.0f} | {h[3]} | {h[4]} | {h[5]:,.0f} | {h[6]:,.0f} | {h[7]:,.0f} | {h[9]} | {h[10]} |")
    # --- 8) konut
    hd = K["hdev_stat"]
    o += ["\n### K-185.8: konut inşaatı (`HOUSE_BUILD_X`)\n",
          f"Neden tetiklenmiyordu: geliştirici seçeneği yalnız şehrin satılmamış kira stoku ve ikinci el arzı bittikten sonra devreye giriyordu; şehir stoğu (sahipsiz kiralık) 'boş' sayıldığı için hep daha ucuz birincil seçenek vardı; maliyet gerçek girdi değil 0,95 × birincil fiyat varsayımıydı. Yeni kural: ikinci el fiyatı > gerçek maliyet (inşaat malı {HOUSE_INS_UNITS:g} birim × piyasa fiyatı × (1 + emek %{100 * HOUSE_LABOR:.0f}) + arsa) × (1+%{100 * HOUSE_DEV_MARGIN:.0f}) VE faiz < {HOUSE_RATE_MAX} VE fiziksel boşluk < %{100 * HOUSE_VAC_MAX:.1f}. "
          f"Gözlem {hd.get('gozlem', 0):.0f} şehir-hafta; reddedilen: fiyat {hd.get('red_fiyat', 0):.0f}, faiz {hd.get('red_faiz', 0):.0f}, boşluk {hd.get('red_bosluk', 0):.0f}, getiri {hd.get('red_getiri', 0):.0f}; ortalama fiyat/maliyet {hd.get('oran_toplam', 0) / max(1.0, hd.get('gozlem', 1)):.2f}. Başlayan {hd.get('basladi', 0):.0f}, tamamlanan {hd.get('tamamlandi', 0):.0f}, ipotekli {hd.get('ipotekli', 0):.0f}; malzeme alımı {hd.get('malzeme_akce', 0):,.0f} Akçe. Stok: " + ", ".join(f"{v:.0f}" for v in R["house"]["hs"].values()) + ".\n"]
    # --- 9) medya
    o.append(f"### K-185.9: medya loncası (`MEDIA_LONCA_EASY`)\n\nKurucu medya firması sahibi, kuruluş sermayesi {MEDIA_EASY_CAP:g} Akçe (+{MEDIA_EASY_BUF:g} tampon), kazanç şartı yok. Kurulan medya loncası: {L.flows['medya_lonca_kurulus_adet']:.0f}.\n")
    # --- 10) tasfiye
    o += ["### K-185.10: tasfiye ve ikinci el sermaye malı (`LIQUIDATION`)\n",
          f"Batan firma: açılan masa {ls.get('acilan', 0):.0f}, kapanan {ls.get('kapanan', 0):.0f}; tasfiye edilen yeni değer {ls.get('varlik_yeni_deger', 0):,.0f} Akçe (yuva: makine {ls.get('yuva_m_acilis', 0):,.0f}, bina {ls.get('yuva_b_acilis', 0):,.0f}). İkinci el işlem: makine {ls.get('makine_islem', 0):.0f} ({ls.get('makine_yuva_satilan', 0):,.0f} yuva, {ls.get('makine_gelir', 0):,.0f} Akçe, iskonto %{100 * LIQ_DISC_M:.0f}, alıcı aynı sektör), bina {ls.get('bina_islem', 0):.0f} ({ls.get('bina_yuva_satilan', 0):,.0f} yuva, {ls.get('bina_gelir', 0):,.0f} Akçe, iskonto %{100 * LIQ_DISC_B:.0f}, aynı şehir). "
          f"Satılan oranı: makine %{100 * ls.get('makine_yuva_satilan', 0) / max(1.0, ls.get('yuva_m_acilis', 0)):.0f}, bina %{100 * ls.get('bina_yuva_satilan', 0) / max(1.0, ls.get('yuva_b_acilis', 0)):.0f}; hurda (alıcısız) makine {ls.get('hurda_m', 0):,.0f}, bina {ls.get('hurda_b', 0):,.0f} yuva.\n",
          f"Şelale (kapanan masalar): ücret borcu {ls.get('ucret_borcu', 0):,.0f} (ödenen {ls.get('ucret_odenen', 0):,.0f}); kredi alacağı {ls.get('kredi_alacak', 0):,.0f}, geri kazanım %{100 * ls.get('kredi_geri', 0) / max(1.0, ls.get('kredi_alacak', 0)):.0f}; pay sahipleri maliyet {ls.get('pay_cost', 0):,.0f}, ödenen {ls.get('pay_odenen', 0):,.0f}; kurucuya kalan {ls.get('kurucu_kalan', 0):,.0f}. "
          f"Batan lonca: kredi portföyü satışı {ls.get('portfoy_adet', 0):.0f} kayıt, defter {ls.get('portfoy_defter', 0):,.0f}, satış geliri {ls.get('portfoy_satis', 0):,.0f}.\n"]
    # --- 11) sigorta
    ins_s = K["ins_stat"]
    o += ["### K-185.11: sigorta sektörü (`INSURANCE`)\n",
          f"Sigorta DAO'ları (kuruluş sermayesi {INS_CAPITAL:g}, en çok {INS_MAX}); poliçe sigortacıda durur (lonca batarsa yeni loncaya devredilir); rezerv şartı = beklenen haftalık hasarın {INS_RES_WEEKS} haftası; reasürans payı %{100 * INS_REINS_SHARE:.0f} (başka sigortacıya); batış kuralı: şart karşılanamazsa {INS_FAIL_WEEKS} hf sonra poliçeler devredilir; ödemeler rezerv/şart oranında kısılır (en az %{100 * INS_MIN_PAYOUT:.0f}); rezerv fazlası mevduata (yatırım). İnovasyon/itibar indirimi en çok %{100 * INS_DISC_MAX:.0f}.\n",
          f"Kurulan {ins_s.get('kurulan', 0):.0f}, batan {ins_s.get('batan', 0):.0f}, devredilen poliçe {ins_s.get('devredilen_polise', 0):.0f}, poliçe geçişi {ins_s.get('gecis', 0):.0f}. Prim {ins_s.get('prim', 0):,.0f}, hasar {ins_s.get('hasar', 0):,.0f} (işsizlik) + {ins_s.get('saglik_hasar', 0):,.0f} (sağlık), ödenemeyen {ins_s.get('odenmeyen', 0):,.0f}; hasar/prim %{100 * (ins_s.get('hasar', 0) + ins_s.get('saglik_hasar', 0)) / max(1.0, ins_s.get('prim', 0)):.0f}; reasürans primi {ins_s.get('reasurans_prim', 0):,.0f}, reasürans geri ödeme {ins_s.get('reasurans_hasar', 0):,.0f}; mevduata yatırılan {ins_s.get('mevduata_yatirilan', 0):,.0f}; kâr payı {ins_s.get('kar_payi', 0):,.0f}.\n",
          "| Hafta | Canlı | Toplam kurulan | Sigortalı lonca | Rezerv | Şart | Küm. prim | Küm. hasar | Küm. ödenemeyen |", "|---|---|---|---|---|---|---|---|---|"]
    for h in K["ins_hist"]:
        if h[0] % 50 == 0 or h[0] == weeks:
            o.append(f"| {h[0]} | {h[1]} | {h[2]} | {h[3]} | {h[4]:,.0f} | {h[5]:,.0f} | {h[6]:,.0f} | {h[7]:,.0f} | {h[8]:,.0f} |")
    # --- 12) sağlık
    hs = K["health_stat"]
    o += ["\n### K-185.12 (madde 12): sağlık sektörü (`HEALTH`, sade ilk sürüm)\n",
          f"Kinds: hastane, eczane, ilaç sanayi (hizmet sektörleri: gelir hasta ödemelerinden; ilaç sanayii gelirini hastane/eczane toptan alımından alır, kimya Ar-Ge verimi kadroyu azaltır). Hastalık deterministik: haftalık oran %{100 * SICK_RATE:.0f} × (1 - sağlık düzeyi × %{100 * HEALTH_LVL_EFF:.0f}) × gelir faktörü, golden-ratio dizisi (rastgelelik yok); hasta verim kaybı %{100 * SICK_LOSS:.0f}; tedavi {TREAT_COST:g}/{2 * TREAT_COST:g}/{4 * TREAT_COST:g} Akçe (gelire göre), sigortalıysa %{100 * HEALTH_COVER:.0f}; tedavisiz hastalık {SICK_DUR_UNTREATED} hf. Sadeleştirme: NPC çalışanlar hasta olmaz; eczane ayrı perakende kuralı yok (ödeme payı); doktor/hemşire ücret karışımı tek çarpan ({HEALTH_WAGE_MULT}); ilaç patent/telif ayrıca modellenmedi.\n",
          f"Hastalanma {hs.get('hastalanma', 0):,.0f}, hasta-hafta {hs.get('hasta_hafta', 0):,.0f}, tedavi (düzey 0/1/2) {hs.get('tedavi_n_0', 0):,.0f}/{hs.get('tedavi_n_1', 0):,.0f}/{hs.get('tedavi_n_2', 0):,.0f}, tedavisiz hasta-hafta {hs.get('tedavisiz_hafta', 0):,.0f} (%{100 * hs.get('tedavisiz_hafta', 0) / max(1.0, hs.get('hasta_hafta', 0)):.0f}), sigortalı tedavi %{100 * hs.get('sigortali_tedavi', 0) / max(1.0, sum(hs.get('tedavi_n_' + str(i), 0) for i in range(3))):.0f}, kayıp iş günü {hs.get('kayip_gun', 0):,.0f}, tedavi harcaması {hs.get('tedavi_akce', 0):,.0f}, koruyucu sağlık {hs.get('koruyucu_akce', 0):,.0f}, ilaç alımı (sanayiye) {hs.get('ilac_akce', 0):,.0f}.\n",
          "Sağlık sektörü çalışanı / şehir sağlık düzeyi (son): " + ", ".join(f"{x:.2f}" for x in (K['health_hist'][-1][2] if K['health_hist'] else [])) + f"; sağlık sektörü çalışanı {K['health_hist'][-1][3] if K['health_hist'] else 0}; hastane çalışanı {sum(len(d['workers']) for d in firms.values() if d['kind'] == 'hastane')}, eczane {sum(len(d['workers']) for d in firms.values() if d['kind'] == 'eczane')}, ilaç {sum(len(d['workers']) for d in firms.values() if d['kind'] == 'ilac')}.\n"]
    # --- 13) eğitim
    es = K["edu_stat"]
    el = K["edu_lvl"]
    pl_ = [q for q, i in people.items() if i["who"] == "oyuncu"]
    o += ["### K-185.12 (madde 13): eğitim sektörü (`EDUCATION`, sade ilk sürüm)\n",
          f"Okul ({EDU_WEEKS[0]} hf, {TUI_B:g}/hf) ve üniversite ({EDU_WEEKS[1]} hf, {TUI_U:g}/hf); hizmet sektörü (gelir öğrenim ücretinden); kayıt: ödeme gücü (≥ {EDU_AFFORD_WEEKS} hf ücret ya da lonca bursu) olanlar servet sırasıyla, şehirde haftalık en çok %{100 * EDU_INTAKE:.1f}; lonca burs (isteğe bağlı) ücretin %{100 * EDU_BURS:.0f}'ı; öğrenci verimi %{100 * EDU_TIME:.0f} düşer (fırsat maliyeti); terfi eşiği (tecrübe haftası) × (1 + {EDU_SPEED[1]}/{EDU_SPEED[2]}); her {EDU_INNOV_EVERY}. üniversite mezunu inovatör. Sadeleştirme: tek yol (okul → üniversite), yaş yok; doktor/uzman şartı bağlanmadı (terfi hızı ve inovatör etkisi var).\n",
          f"Kayıt okul {es.get('kayit_0', 0):.0f}, üniversite {es.get('kayit_1', 0):.0f}; mezun okul {es.get('mezun_0', 0):.0f}, üniversite {es.get('mezun_1', 0):.0f}; bırakan {es.get('birakan', 0):.0f}; yeni inovatör {es.get('yeni_inovator', 0):.0f}; ücret geliri {es.get('ucret_akce', 0):,.0f}, burs {es.get('burs_akce', 0):,.0f}. Eğitimli payı (oyuncu) okul+ %{100 * sum(1 for q in pl_ if el.get(q, 0) >= 1) / max(1, len(pl_)):.0f}, üniversite %{100 * sum(1 for q in pl_ if el.get(q, 0) >= 2) / max(1, len(pl_)):.0f}. "
          f"Erişim (kayıt, servet çeyreği 0=en yoksul → 3): " + ", ".join(f"{es.get(f'kayit_ceyrek{i}', 0):.0f}" for i in range(4)) + f". Eğitimli terfi: usta/kalfa payı eğitimli %{100 * sum(1 for q in pl_ if el.get(q, 0) >= 1 and people[q]['tier'] >= 1) / max(1, sum(1 for q in pl_ if el.get(q, 0) >= 1)):.0f} / eğitimsiz %{100 * sum(1 for q in pl_ if el.get(q, 0) < 1 and people[q]['tier'] >= 1) / max(1, sum(1 for q in pl_ if el.get(q, 0) < 1)):.0f}. Eğitim çalışanı: okul {sum(len(d['workers']) for d in firms.values() if d['kind'] == 'okul')}, üniversite {sum(len(d['workers']) for d in firms.values() if d['kind'] == 'universite')}.\n"]
    # --- 14) genç kredi
    ys = K["young_stat"]
    pfs = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge" and "born" in d and d["born"] <= weeks - YOUNG_WEEKS]
    def surv(sel):
        a_ = [d for d in sel]
        return (100.0 * sum(1 for d in a_ if not d.get("dead") or d.get("died", weeks) - d["born"] >= YOUNG_WEEKS) / len(a_)) if a_ else float("nan")
    o += ["### K-185.12: genç firma kredisi (`YOUNG_CREDIT`), girişimci kapısı (`ENTRY_FIX`)\n",
          f"İlk {YOUNG_WEEKS} hafta: faiz ×{YOUNG_RATE_MULT}, ilk {YOUNG_GRACE} hf yalnız faiz, yaş/kâr şartı yok; limit = {YOUNG_LIM_MULT} × (işletme sermayesi + başlangıç yuvası) × itibar; havuz payı ≤ %{100 * YOUNG_POOL_SHARE:.0f}. Genç firma kredisi {ys.get('adet', 0):.0f} adet / {ys.get('hacim', 0):,.0f} Akçe; ret {ys.get('red', 0):.0f}; temerrüt (tüm kredi) {L.flows['temerrut_adet']:.0f}. 52 hf hayatta kalma (en az 52 hf yaşayabilen firmalar): genç kredi alan %{surv([d for d in pfs if d.get('young_credit')]):.0f} ({sum(1 for d in pfs if d.get('young_credit'))} firma), almayan %{surv([d for d in pfs if not d.get('young_credit')]):.0f} ({sum(1 for d in pfs if not d.get('young_credit'))}). "
          f"Girdi eksiği eşiği {WORTH_SHORT_X} (eski {WORTH_SHORT}); kök eksiklik eşiği fiyat çarpanıyla ≥ {THR_MIN} kata iner.\n"]
    # --- 15) çöküş tanıları
    g = K["gate"]
    ws_ = sorted({w_ for w_, _ in g})
    o += ["### K-185 tanı: girişimci kapısı, hane talebi, havuz (25 haftalık dilimler; haftalık/şehir-haftalık toplamların ortalaması)\n",
          "| Dilim başı | Sinyal ≥ eşik / şehir-hf | Fizibilite+girdi+diğer elenen / şehir-hf | Aday oyuncu / şehir-hf | Kredi yetersiz / hf | Canlı oyuncu firması (ort.) | İşsiz hane ort. nakit | İşsiz hane karşılama | Havuz nakdi | Kredilenebilir (kaldıraçlı) | Mevduat | Tahvil | Politika faizi |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for w_ in ws_:
        hn = max(1.0, g.get((w_, "haf_n"), 1))
        cw = max(1.0, g.get((w_, "hafta_sehir"), 1))
        out_ = sum(g.get((w_, k_), 0) for k_ in ("girdi_kit", "fizibilite", "cooldown", "pazar_yeri", "arz_fazlasi", "fiyat_ithal_ucuz"))
        o.append(f"| {w_} | {g.get((w_, 'sinyal_esik'), 0) / cw:.1f} | {out_ / cw:.1f} | {g.get((w_, 'aday_son'), 0) / cw:.1f} | {g.get((w_, 'kredi_yetersiz'), 0) / hn:.1f} | {g.get((w_, 'oyuncu_firma_canli'), 0) / hn:.0f} | "
                 f"{g.get((w_, 'tuk_cash_issiz'), 0) / max(1.0, g.get((w_, 'tuk_n_issiz'), 1)):.0f} | {g.get((w_, 'tuk_aff_issiz'), 0) / max(1.0, g.get((w_, 'tuk_n_issiz'), 1)):.2f} | {g.get((w_, 'havuz_nakit'), 0) / hn:,.0f} | {g.get((w_, 'havuz_lendable'), 0) / hn:,.0f} | {g.get((w_, 'mevduat'), 0) / hn:,.0f} | {g.get((w_, 'tahvil_acik'), 0) / hn:,.0f} | %{100 * g.get((w_, 'pol_faiz'), 0) / hn:.3f} |")
    # --- 13) NPC tüketimi, servet kuralı
    ct = K.get("cons_ts", [])
    o += ["### K-185.13: NPC tüketici + servet bazlı harcama (`NPC_POOL_CONS`, `WEALTH_RULE`)\n",
          f"İşsiz (havuzdaki) NPC de hane olarak tüketir (nakdi ≥ {NPC_MIN_BAL:g}); kira modellenmez (konut stoku oyuncu + çalışan NPC için). Servet kuralı: birikim {WR_WEEKS} haftalık normal harcamanın altındaysa ya da işsizse zorunlu sepet + kira birikimden tam, ek harcama birikimin haftalık %{100 * POOR_SHARE:.0f}'ü; varlıklıysa eşik üstü servetin yılda %{100 * WEALTH_DRAW_YEAR:.1f}'i + gelirden harcama (gerçek gelir: ücret, ödenek, faiz, temettü); {WR_BLEND[0]}–{WR_BLEND[1]} × eşik arası doğrusal karışım. `NPC_POOL_TAX` = {NPC_POOL_TAX:g} (kaldırıldı). Şehir asgari güvencesi işsiz NPC'ye `NPC_ASGARI` = {NPC_ASGARI}.\n",
          "| Hafta | Para arzı | İşsiz NPC nakdi | Pay | Tüm NPC nakdi | Oyuncu nakdi | Haftalık tüketim | Nakdi < sepet olan havuz NPC payı | Havuz NPC |", "|---|---|---|---|---|---|---|---|---|"]
    for r_ in ct:
        if r_[0] % 50 == 0 or r_[0] == weeks:
            o.append(f"| {r_[0]} | {r_[1]:,.0f} | {r_[2]:,.0f} | %{100 * r_[2] / max(1.0, r_[1]):.0f} | {r_[3]:,.0f} | {r_[4]:,.0f} | {r_[5]:,.0f} | %{100 * r_[6]:.0f} | {r_[7]} |")
    o.append("")
    # --- 15) NPC işgücü
    pl_all = [q for q, i in people.items() if i["who"] == "oyuncu"]
    npc_emp = sum(1 for q, i in people.items() if i["who"] == "npc" and i["firm"])
    pl_emp = sum(1 for q in pl_all if people[q]["firm"])
    n_npc = sum(1 for i in people.values() if i["who"] == "npc")
    pf_ = [d for d in firms.values() if d.get("owner") in people and d["kind"] != "arge" and not d.get("dead") and d["workers"]]
    npc_in_pf = sum(1 for d in pf_ for q in d["workers"] if people[q]["who"] == "npc")
    w_pl = [people[q]["wage"] for q in pl_all if people[q]["firm"]]
    w_np = [people[q]["wage"] for q, i in people.items() if i["who"] == "npc" and i["firm"]]
    o += ["### K-185.15: NPC gerçek işgücü (`NPC_LABOR`)\n",
          f"İşveren seçimi deterministik skorla (tecrübe basamağı + itibar + oyuncu önceliği {PLAYER_PRIO}); oyuncu firmaları NPC işçi alır; ücret endeksi işgücü kıtlığında yükselir, bollukta yavaş düşer (×{LAB_DOWN}). Sadeleştirme: firma düzeyinde ücret farkı yok (ücret basamak × şehir endeksi), bu yüzden iş değiştirme yalnız ahır→özel ve şehirler arası göç; NPC tecrübe basamağı sabit dağılım (%60/30/10); NPC itibarı yok.\n",
          f"İstihdam: oyuncu {pl_emp} / {len(pl_all)} (işsizlik %{100 * (1 - pl_emp / max(1, len(pl_all))):.0f}), NPC {npc_emp} / {n_npc}; toplam nüfus üzerinden işsizlik %{100 * (1 - (pl_emp + npc_emp) / max(1, len(pl_all) + n_npc)):.0f}. NPC seçilip işe alındı {L.flows['npc_isbasi_secim']:.0f} kez (skorla oyuncuya karşı), oyuncu firması NPC işe aldı {L.flows['oyuncu_firmasi_npc_ise_alim']:.0f} kez. Oyuncu firması başına çalışan {sum(len(d['workers']) for d in pf_) / max(1, len(pf_)):.2f} (NPC payı %{100 * npc_in_pf / max(1, sum(len(d['workers']) for d in pf_)):.0f}). Ücret (döngü): oyuncu ort. {sum(w_pl) / max(1, len(w_pl)):.1f}, NPC ort. {sum(w_np) / max(1, len(w_np)):.1f}; ücret endeksi (şehirler): " + "/".join(f"{WI[i]:.2f}" for i in range(n_cities)) + ".\n"]
    # --- 16) envanter
    ist = K.get("inv_stat", {})
    o += ["### K-185.16: envanter (`INVENTORY`)\n",
          f"Firma stoğu: satılmayan çıktı stoğa girer (bozunur: hızlı ekmek/süt/yemek %5–10/döngü, orta kola/deterjan/un, yavaş metal/mobilya/elektronik; hizmetler stoklanamaz: {', '.join(NO_STOCK)}); depo gideri döngüde stok değerinin %{100 * INV_HOLD:.2f}'i; stok örtüsü > {INV_HI:g} döngü ise üretim kısılır, < {INV_LO:g} ise NPC hedefi artar; girdi tamponu hedefi {INV_IN_CYC:g} döngülük kullanım (artık arzdan alınır, kıtlık sinyali sayılmaz); batan firmanın stoğu piyasa fiyatının %{100 * INV_LIQ_DISC:.0f}'ından satılır (gelir masaya: alacaklı sırası).\n",
          f"Bozulma kaybı {ist.get('bozulma_akce', 0):,.0f} Akçe (ref. değer); taşma (üst sınır) {ist.get('tasma_akce', 0):,.0f}; stoklanamayan hizmet kaybı {ist.get('hizmet_kayip_akce', 0):,.0f}; depo gideri {ist.get('depo_gideri', 0):,.0f}; üretim kısma {ist.get('uretim_kisma', 0):,.0f} / artırma {ist.get('uretim_artirma', 0):,.0f} firma-döngü; girdi tamponu alımı {ist.get('girdi_tamponu_alim_akce', 0):,.0f}; **girdi stoğu sayesinde önlenen girdi açığı (üretimde stoktan kullanılan, ref. değer) {ist.get('girdi_stok_kullanim_akce', 0):,.0f}**; tasfiyeye giren stok değeri {ls.get('stok_deger', 0):,.0f}, satılamayan (hurda) {ls.get('stok_hurda', 0):,.0f}.\n",
          "| Hafta | Toplam çıktı stoğu (ref. değer) | Girdi stoğu | Stok / haftalık tüketim | En büyük 4 stok (ürün: değer) |", "|---|---|---|---|---|"]
    for h in K.get("inv_ts", []):
        outs = {k_: v_ for k_, v_ in h[1].items() if not k_.startswith("girdi:")}
        ins_ = sum(v_ for k_, v_ in h[1].items() if k_.startswith("girdi:"))
        o.append(f"| {h[0]} | {sum(outs.values()):,.0f} | {ins_:,.0f} | {sum(outs.values()) / max(1.0, h[2]):.2f} | " + ", ".join(f"{k_}: {v_:,.0f}" for k_, v_ in sorted(outs.items(), key=lambda t: -t[1])[:4]) + " |")
    o.append("")
    # --- servet birikimi (oyuncularda para toplanması)
    pl_b = sorted(L.bal[q] for q in pl_all)
    dep_ = R["inn"]["deposits"]
    inc_k = ("ucret", "yonetici_ucreti", "uzman_ucreti", "arastirmaci_ucreti", "temettu", "kurucu_payi", "kar_payi_dagitimi", "mevduat_faizi", "konut_kira_geliri", "issizlik_odenegi", "lonca_issizlik_odenegi", "ciraklik_bursu", "lonca_ciraklik_bursu", "dao_payi", "tasfiye_kurucu", "sigorta_kar_payi")
    tot_inc = sum(L.flows[k_] for k_ in inc_k)
    o += ["### K-185 tanı: para kimde birikiyor (oyuncu gelir kalemleri ve servet)\n",
          f"Son bakiye dağılımı: oyuncu nakdi {sum(pl_b):,.0f} (en zengin %1 {sum(pl_b[-15:]):,.0f}, %10 {sum(pl_b[-150:]):,.0f}, medyan {pl_b[len(pl_b) // 2]:.0f}); oyuncu mevduatı (alacak) {sum(v_ for q_, v_ in dep_.items() if q_ in people):,.0f}; NPC nakdi {sum(L.bal[q] for q, i in people.items() if i['who'] == 'npc'):,.0f}; firmalar {sum(L.bal[f] for f in firms):,.0f}; şehir kasaları {sum(L.bal[c_] for c_ in L.city_accounts):,.0f}; lonca havuzları {sum(L.bal[k_] for k_ in list(L.bal) if k_.endswith('_sermaye')):,.0f}.\n",
          "Oyuncu gelirinin türü (küm. Akçe, pay): " + ", ".join(f"`{k_}` {L.flows[k_]:,.0f} (%{100 * L.flows[k_] / max(1.0, tot_inc):.0f})" for k_ in sorted(inc_k, key=lambda k_: -L.flows[k_]) if L.flows[k_] > 0) + ". Sermaye geliri (temettü, kurucu payı, kâr payı, faiz, kira) yalnız oyunculara akar; NPC işletmelerinin kârı şehre (vergi) gider; harcama eğilimi gelirle düşer (K-172: ×(y/yref)^-0,15) ve eşik üstü servetin yalnız %4,5'i harcanır: bu yüzden üst dilimde birikim ve yüksek Gini.\n"]
    # --- 16) tedarik zinciri izleme
    ch, csh = K["chain"], K["chain_sh"]
    reasons_main = ("girdi_kit", "fizibilite", "fiyat_ithal_ucuz", "arz_fazlasi", "cooldown", "pazar_yeri", "sinyal_esigi", "kurucu_yok", "kredi_yetersiz", "kuruldu")

    def trace(sl, p_, depth, seen):
        r_ = ch.get((sl, p_), {})
        tot_ = sum(r_.get(k_, 0) for k_ in reasons_main)
        if tot_ == 0:
            return f"{p_}: aday yok (sinyal eşiği altında / hiç sinyal)", (p_, "sinyal yok")
        top_ = max(reasons_main, key=lambda k_: r_.get(k_, 0))
        if top_ == "girdi_kit" and depth < 4:
            ins_ = {k_[6:]: v_ for k_, v_ in r_.items() if k_.startswith("girdi:") and k_[6:] not in seen}
            if ins_:
                q_ = max(ins_, key=lambda k_: ins_[k_])
                sub, root = trace(sl, q_, depth + 1, seen | {p_})
                return f"{p_} adayı {tot_}, %{100 * r_.get('girdi_kit', 0) // tot_} girdi kıt: {q_} ← {sub}", root
        return f"{p_} adayı {tot_}, %{100 * r_.get(top_, 0) // tot_} {top_.replace('_', ' ')}", (p_, top_)
    o += ["### K-185.14: tedarik zinciri izleme (bayraksız teşhis; davranışı değiştirmez)\n",
          "Her 25 haftalık dilim ve her kıt ürün: eksik oranı (eksik/talep), üretim, talep, fiyat çarpanı (PM), ithal teslim/yerel fiyat; ürünün üreticisi için kuruluş adayı (şehir-hafta sinyal sayısı) ve eleme nedenleri; 'girdi kıt' ise o girdiye özyinelemeli iner (en çok 4 seviye), en alt tıkalı halka KÖK olarak işaretlenir.\n",
          "| Dilim | Ürün | Eksik % | Üretim/hf | Talep/hf | PM | İthal/yerel fiyat | Zincir (aday, ilk neden) → KÖK |", "|---|---|---|---|---|---|---|---|"]
    roots_ts = []
    for sl in sorted({k_[0] for k_ in csh}):
        rows = []
        for (sl2, p_), rec_ in csh.items():
            if sl2 != sl or rec_[1] <= 0:
                continue
            fr = rec_[0] / rec_[1]
            if fr > 0.15 and rec_[6] >= 3:
                rows.append((rec_[5] / rec_[6], p_, fr, rec_))
        rows.sort(reverse=True)
        agg = defaultdict(float)
        for val, p_, fr, rec_ in rows:
            line, root = trace(sl, p_, 0, frozenset())
            agg[root] += val
            if len([1 for x in rows if x[0] > val]) < 6:
                o.append(f"| {sl} | {p_} | %{100 * fr:.0f} | {rec_[2] / rec_[6]:,.0f} | {rec_[1] / rec_[6]:,.0f} | {rec_[3] / rec_[6]:.2f} | {rec_[4] / rec_[6]:.2f} | {line} → **KÖK: {root[0]} ({root[1].replace('_', ' ')})** |")
        roots_ts.append((sl, sorted(agg.items(), key=lambda t: -t[1])[:5]))
    o.append("\nZincir zaman serisi: her 25 haftada en çok tıkalı 5 kök halka (ürün, neden; haftalık eksik değeri):\n")
    for sl, rs in roots_ts:
        o.append(f"- Dilim {sl}: " + "; ".join(f"{r_[0]} ({r_[1].replace('_', ' ')}) {v_:,.0f}" for r_, v_ in rs) if rs else f"- Dilim {sl}: kıt ürün yok")
    o.append("")
    o.append("**Kontrat etkisi (K-185):** basım tavanı kuralı (zincirde: yıllık %2, haftalık izin birikimi), `sehir_tahvili` (ihraç `tahvil_ihrac`, faiz `tahvil_faizi`, itfa `tahvil_itfa`), `politika_faizi` olayı, `lonca_sosyal_paket` (taahhüt, rezerv `lonca_refah_fonu`, ödeme türleri `lonca_issizlik_odenegi`, `lonca_ciraklik_bursu`), lonca kaldıraç sınırı, `makine_alimi`/`bina_insaati`/amortisman kaydı (`amortisman_akce`), `yenileme_fonu`, konut inşaatı (`konut_insaat_bedeli`, `konut_arsa_emek`, tamamlanma kaydı), `tasfiye_satisi`, tasfiye şelalesi (`tasfiye_ucret`, `kredi_tasfiye`, `tasfiye_pay_sahibi`, `tasfiye_kurucu`), `kredi_portfoy_devri`, `mevduat_tasfiye`, `sigorta_policesi` (lonca→sigortacı atama), `sigorta_primi`, `sigorta_odemesi`, `reasurans_primi`, `reasurans`, sigortacı rezerv kaydı (`{id}_rezerv`), `saglik_hizmeti`, `ilac_satisi`, `ilac_alimi`, `koruyucu_saglik`, `egitim_ucreti`, `burs`, hastalık/tedavi kaydı (zincir dışı, panodan), diploma kaydı (kişi itibarına bağlı kimlik).\n")
    return o
