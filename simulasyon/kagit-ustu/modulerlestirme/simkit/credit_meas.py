"""simkit.credit_meas: PLAN-KREDI T5 ölçüm sütunları (WEEKLY_CSV `kr_*`; yalnız KR_MEAS=1 iken çağrılır; davranışsız).

AMAÇ: kredi, mevduat, lonca, oyuncu firması, kuruluş kredisi, şehir tahvili ve iş piyasası ölçümlerini haftalık satıra yazar (PLAN-KREDI §4.5). Hiçbiri para ya da durum değiştirmez.
  Kredi/mevduat/lonca sütunları modelin mevcut durumundan ve sayaçlarından (`L.flows`, `W.bond_stat`, `W.lo_stat`) türer; lonca kapanış ve devir sütunları T6 sayaçlarından (`kapanis_batik/uyesiz/gider`, `batik_bekleme_hafta`, `devir_acik_akce`), kuruluş sütunları T7 sayaçlarından (`kurulus_yeni`: girişimci loncası, `kurulus_yeniden`: kapanmış yuvanın yeniden kurulması; LONCA_EASY açık olsun olmasın sayılır).
  İş piyasası sütunları `W.lab_stat`, `W.lab_type`, `W.staff_tgt` (simkit.lab_meas) ve KENDİ önceki hafta eşlemesinden (`W._kr_lab`; yalnız KR_MEAS=1 iken oluşur) türer.
  Sütun adları `_kum` ile bitenler birikimli, öbürleri o haftanındır.
ARAYÜZ: kr_week_row(W, cls), lonca_rows(W), _lonca_rows(W), ls_say(W, w, lo, sebep, **kayit), ls_say_b(W, lo, sebep), ls_say_b_onay(W, lo, eski), ks_karar(W, sonuc), gs_kayit(W, f, lo, tur, amt, rate, pd, cov, w), gs_izle(W, w) (REKABET G15 GROW_SELECT ölçümü), _ls_hucre, _ks_faiz
OKUR: W.L, W.loans, W.mortgages, W.bonds, W.deposits, W.dep_tot, W.firms, W.people, W.cities, W.lab_*, W.staff_tgt, W.lo_stat, W.bond_stat, W.hire_stat. W.lo_loss, W.FEES, W.dep_rate_w, W.lo_terms (varsa), W.ls_stat (varsa). YAZAR: yalnız W._kr_lab (kendi durumu).
KATMAN: L0 (yalnız params; lonca sınıflarını çağıran verir).
"""
from collections import deque
from simkit.params import *          # noqa: F401,F403

KAYIP_TURLERI = ("kurulus", "genc", "yenileme", "buyume", "yatirim", "arge", "wc", "npc", "medya", "ozellestirme", "diger")      # REKABET G5: kayip_<tur> ölçüm sütunlarının sabit kümesi (kayıp kaydı credit_core.kayip_say)

_TYPES = ("npc", "player", "dao", "public")
_ORIGINS = ("entrant", "ahir", "firm_death", "from_firm", "from_out")
_STABLE_LAG = 4


def _lab_sum(lab, prefix):
    return sum(v for k, v in lab.items() if k.startswith(prefix))


def _credit_cols(W, cls):
    L, fl = W.L, W.L.flows
    firms = W.firms
    k_firma = k_oyuncu = 0.0
    for f, ln in W.loans.items():
        d = firms.get(f)
        if d is not None and d["owner"] is None:
            k_firma += ln["out"]
        else:
            k_oyuncu += ln["out"]
    ver, bat = cls[0], cls[1]
    tot = sum(W.dep_tot[lo] for lo in W.loncas)
    pay = (lambda xs: round(sum(W.dep_tot[lo] for lo in xs) / tot, 4)) if tot > 1e-9 else (lambda xs: 0.0)
    biggest = round(max(W.dep_tot[lo] for lo in W.loncas) / tot, 4) if tot > 1e-9 else 0.0
    ls = W.lo_stat
    bs = W.bond_stat
    now = W.week_no
    live_pf = [now - d.get("born", now) for f in W.player_firms for d in (firms[f],) if not d.get("dead")]
    n_dead = fl.get("batan_oyuncu_firmasi_adet", 0.0)
    wkc = getattr(W, "WKC", None) or {}
    return dict(
        kr_kredi_firma=round(k_firma), kr_kredi_oyuncu=round(k_oyuncu), kr_ipotek=round(sum(m["out"] for m in W.mortgages)), kr_tahvil=round(sum(b["out"] for b in W.bonds)),
        kr_mev_toplam=round(tot), kr_mev_verebilen_pay=pay(ver), kr_mev_batik_pay=pay(bat), kr_mev_en_buyuk_pay=biggest,
        kr_mev_sigorta=round(sum(v[1] for a, v in W.deposits.items() if a.endswith("_rezerv"))),
        kr_tasima_kum=round(fl.get("mevduat_tasima", 0.0)), kr_tasinamayan=int(ls.get("tasinamayan_hesap", 0)), kr_hedef_yok_kum=int(fl.get("mevduat_hedef_yok_hafta", 0.0)),
        kr_lonca_canli=len(W.loncas) - len(W.closed), kr_lonca_batik=len(bat),
        kr_lonca_kurulus_yeni_kum=int(ls.get("kurulus_yeni", 0)), kr_lonca_yeniden_kum=int(ls.get("kurulus_yeniden", 0)),
        kr_lonca_kapanis_batik_kum=int(ls.get("kapanis_batik", 0)), kr_lonca_kapanis_diger_kum=int(ls.get("kapanis_uyesiz", 0) + ls.get("kapanis_gider", 0)),
        kr_batik_bekleme_kum=int(ls.get("batik_bekleme_hafta", 0)), kr_devir_acik_kum=round(ls.get("devir_acik_akce", 0.0)),
        kr_oyuncu_olum_kum=int(n_dead), kr_oyuncu_olum_yas_ort=round(fl.get("batis_yas_hafta", 0.0) / n_dead, 2) if n_dead else 0.0,
        kr_oyuncu_le3_kum=int(fl.get("batis_yas_le3", 0.0)), kr_oyuncu_canli_yas_ort=round(sum(live_pf) / len(live_pf), 2) if live_pf else 0.0,
        kr_kurulus_kredi_kum=int(fl.get("kredi_adet", 0.0)), kr_kurucu_ret=round(wkc.get("kredi_ret", 0.0) / max(1, len(W.loncas)), 2),
        kr_sehir_kisinti_kum=round(bs.get("kisma_tavan_tl", 0.0) + bs.get("kisma_havuz_tl", 0.0)), kr_tahvil_kisma_adet=int(bs.get("kisma_adet", 0.0)),
        kr_kayip_kum=round(sum(v for k, v in fl.items() if k.endswith("kayip_akce"))),
        kr_ks_verilen_kum=round(ls.get("ks_verilen", 0.0), 2), kr_ks_kayip_kum=round(ls.get("ks_kayip", 0.0), 2),
        kr_ks_basvuru_karar_kum=int(ls.get("ks_basvuru_karar", 0)), kr_ks_onay_karar_kum=int(ls.get("ks_onay_karar", 0)), kr_ks_ret_karar_kum=int(ls.get("ks_ret_karar", 0)), kr_ks_riskli_karar_kum=int(ls.get("ks_riskli_karar", 0)),
        kr_kendi_parasiyla_kum=int(ls.get("ks_kendi_parasiyla", 0)), kr_ks_kendi_karar_kum=int(ls.get("ks_kendi_parasiyla_karar", 0)), kr_cov_yok_kum=int(ls.get("ks_cov_yok", 0)), **_ks_faiz(W))      # REKABET G4: karar düzeyi sayaçlar, kendi parasıyla kuruluş, ciro bilgisi yok (cov=1) sayısı, açık kuruluş kredilerinin faiz dağılımı      # REKABET G0: kuruluş kredisi (tur="kurulus") verilen ve kaybedilen TUTAR, Akçe, birikimli


def _ks_faiz(W):
    """REKABET G4: açık kuruluş kredilerinin (tur="kurulus") o haftaki haftalık faiz en düşük/ortanca/en yüksek değeri (ölçüm)."""
    r = sorted(ln["rate"] for ln in W.loans.values() if ln.get("tur") == "kurulus" and ln["out"] > 1e-9 and "rate" in ln)
    if not r:
        return dict(kr_ks_faiz_min="", kr_ks_faiz_med="", kr_ks_faiz_max="")
    return dict(kr_ks_faiz_min=round(r[0], 6), kr_ks_faiz_med=round(r[len(r) // 2], 6), kr_ks_faiz_max=round(r[-1], 6))


def _state(W):
    st = getattr(W, "_kr_lab", None)
    if st is None:
        st = W._kr_lab = dict(week=-1, emp={}, seek=set(), known=set(), start={}, net=deque(maxlen=_STABLE_LAG), base=deque(maxlen=_STABLE_LAG), lab={}, hs={})
    return st


def _labour_cols(W):
    firms, people, cities = W.firms, W.people, W.cities
    lab, lt, tgt = W.lab_stat, W.lab_type, W.staff_tgt
    st = _state(W)
    wk = W.week_no
    emp = {}
    n_priv = 0
    staffless = 0
    for f, d in firms.items():
        if d.get("dead"):
            continue
        t = lt.get(f) or "npc"
        for q in d["workers"]:
            emp[q] = f
        if t != "public":
            n_priv += len(d["workers"])
        if t == "npc" and d["owner"] is None and not d.get("org_owner") and not d["workers"]:
            staffless += 1
    vac_n = vac_p = 0
    v_c = [0] * len(cities)
    for f, t_ in tgt.items():
        d = firms.get(f)
        if d is None or d.get("dead"):
            continue
        v = max(0, int(round(float(t_))) - len(d["workers"]))
        if not v:
            continue
        ty = lt.get(f) or "npc"
        if ty == "npc":
            vac_n += v
        elif ty in ("player", "dao"):
            vac_p += v
        else:
            continue
        ci = d.get("city")
        if isinstance(ci, int) and 0 <= ci < len(v_c):
            v_c[ci] += v
    seek_city = []
    seek = set()
    for c in cities:
        s = set(c["seekers"]) | set(c["pool"])
        seek_city.append(len(s))
        seek |= s
    n_seek = len(seek)
    vac = vac_n + vac_p
    mism = round(0.5 * sum(abs(seek_city[i] / n_seek - v_c[i] / vac) for i in range(len(v_c))), 4) if (vac > 0 and n_seek > 0) else 0.0
    hs = W.hire_stat
    ev_hire = _lab_sum(lab, "ise_")
    cols = dict(kr_acik_kadro_npc=vac_n, kr_acik_kadro_oyuncu=vac_p, kr_kadrosuz_npc=staffless, kr_istihdam_ozel=n_priv,
                kr_cikis_ucret_kum=int(_lab_sum(lab, "cikis_ucret_")), kr_cikis_kuculme_kum=int(_lab_sum(lab, "cikis_kuculme_")),
                kr_cikis_ayrilma_kum=int(_lab_sum(lab, "cikis_ayrilma_")), kr_cikis_firma_olumu_kum=int(_lab_sum(lab, "cikis_olum_")), kr_uyumsuzluk=mism,
                kr_ise_alim_olay=0, kr_ise_alim_kisa=0, kr_ise_alim_kalici4=0, kr_uzun_issiz_pay=0.0, kr_uzun_issiz_oyuncu_pay=0.0, kr_is_bulma_orani=0.0, kr_is_bulma_kalici=0.0,
                **{"kr_issizlige_giris_" + o: 0 for o in _ORIGINS})
    prev = st["week"] == wk - 1
    start = {}
    for q in seek:
        s = st["start"].get(q) if prev else None
        start[q] = wk if s is None else s
    cols["kr_uzun_issiz_pay"] = round(sum(1 for q in seek if wk - start[q] > 26) / n_seek, 4) if n_seek else 0.0
    # Son düzeltme I2: `kr_uzun_issiz_pay` havuzdaki NPC'leri de sayar (hafta 1'den beri hiç çalışmamış, gerçekte iş aramayan kitle dahil; bu yüzden %80-94 çıkar).
    # `kr_uzun_issiz_oyuncu_pay` yalnız iş arayan OYUNCULARI sayar: 26 haftadan uzun süredir iş arayan oyuncu / iş arayan oyuncu (seekers). Rapor ve kart bu sütunu kullanır.
    seek_oy = [q for q in seek if people.get(q, {}).get("who") == "oyuncu"]
    cols["kr_uzun_issiz_oyuncu_pay"] = round(sum(1 for q in seek_oy if wk - start[q] > 26) / len(seek_oy), 4) if seek_oy else 0.0
    d_hs = hs.get("ise_giren_issiz", 0.0) - st["hs"].get("ise_giren_issiz", 0.0)
    d_base = hs.get("issiz_haftabasi", 0.0) - st["hs"].get("issiz_haftabasi", 0.0)
    if prev:
        pe = st["emp"]
        newhire = {q: f for q, f in emp.items() if pe.get(q) != f}
        cols["kr_ise_alim_olay"] = int(round(ev_hire - _lab_sum(st["lab"], "ise_")))
        cols["kr_ise_alim_kisa"] = max(0, cols["kr_ise_alim_olay"] - len(newhire))
        if len(st["net"]) == _STABLE_LAG:
            cols["kr_ise_alim_kalici4"] = sum(1 for q, f in st["net"][0].items() if emp.get(q) == f)
            if st["base"][0] > 0:
                cols["kr_is_bulma_kalici"] = round(cols["kr_ise_alim_kalici4"] / st["base"][0], 4)
        cols["kr_is_bulma_orani"] = round(d_hs / d_base, 4) if d_base > 0 else 0.0
        for q in seek - st["seek"]:
            if q not in st["known"]:
                cols["kr_issizlige_giris_entrant"] += 1
                continue
            f = pe.get(q)
            if f is None:
                cols["kr_issizlige_giris_from_out"] += 1
            elif firms[f]["kind"] == "ahir":
                cols["kr_issizlige_giris_ahir"] += 1
            elif firms[f].get("dead"):
                cols["kr_issizlige_giris_firm_death"] += 1
            else:
                cols["kr_issizlige_giris_from_firm"] += 1
        st["net"].append(newhire)
        st["base"].append(d_base)
    st.update(week=wk, emp=emp, seek=seek, known=set(people), start=start, lab=dict(lab), hs={"ise_giren_issiz": hs.get("ise_giren_issiz", 0.0), "issiz_haftabasi": hs.get("issiz_haftabasi", 0.0)})
    return cols


def kr_week_row(W, cls):
    """KR_MEAS=1: bir haftanın `kr_*` sütunları (sözlük); WEEKLY_CSV satırına measure.measure_week ekler. cls: credit_core.lo_classes(W) sonucu (sınıflamayı çağıran verir: katman L0 kalır)."""
    row = _credit_cols(W, cls)
    row.update(_labour_cols(W))
    return row


def lonca_rows(W):
    """REKABET G0: KR_MEAS=1 iken haftada lonca başına bir satır; KR_MEAS kapalıysa boş liste. Satır alanları `_lonca_rows` içinde."""
    if not KR_MEAS:
        return []
    return _lonca_rows(W)


def _lonca_rows(W):
    """Bayrak denetimsiz gövde (denge_kos.lonca_yaz koşunun KENDİ modül kopyasını bilmez; KR_MEAS'ı ana csv'deki kr_* sütunundan anlar). Satır (kapanmış loncalar `kapali`=1 ile): hafta, lonca, uye (canlı üye firma), kredi (stok), kayip (lo_loss), mevduat, fee,
    spread, risk_tol, dep_pay (W.lo_terms yoksa boş), mev_faiz (dep_rate_w), mev_tasi_gelen/giden_adet ve _akce (REKABET G5: loncaya gelen/giden mevduat hesabı taşıma, kümülatif; W.lt_stat yoksa boş), uye_gelen_kum (W.switches: loncaya kümülatif gelen firma geçişi), mev_kaybi_kum (lonca başına kapanışta mevduat kaybı, kümülatif; lt_stat) ve dunya_mev_kaybi_kum (L.flows mevduat_kaybi_akce, dünya toplamı), mev_tasi_nakit_yok (likidite tavanına takılan taşıma), kayip_<tur> (W.kk_tur: kredi kaybının türe göre dökümü), basvuru, onay, ret (W.ls_stat[lo] yoksa boş) ve W.ls_stat[lo]["ret_sebep"] sözlüğündeki her sebep kodu için `ret_<kod>` (sözlük yoksa sütun yok). Yalnız ölçüm; model durumuna yazmaz."""
    uye, kredi = {}, {}
    for d in W.firms.values():
        if not d.get("dead") and d.get("lonca") is not None:
            uye[d["lonca"]] = uye.get(d["lonca"], 0) + 1
    for ln in W.loans.values():
        kredi[ln["lo"]] = kredi.get(ln["lo"], 0.0) + ln["out"]
    terms = W.__dict__.get("lo_terms") or {}
    ls = W.__dict__.get("ls_stat") or {}
    lts = W.__dict__.get("lt_stat") or {}
    lgd = W.__dict__.get("lt_gelir") or {}
    sp_stok = {}
    for ln in W.loans.values():
        if "spread" in ln:                                                       # damgalı kredi (sıfır spread'le açılanlar dahil)
            sp_stok[ln["lo"]] = sp_stok.get(ln["lo"], 0.0) + ln["out"]
    kk = W.__dict__.get("kk_tur") or {}
    rows = []
    for lo in W.loncas:
        t = terms.get(lo) or {}
        s = ls.get(lo) or {}
        ts = lts.get(lo) or {}
        gd = lgd.get(lo) or {}
        r = dict(hafta=W.week_no, lonca=lo, uye=uye.get(lo, 0), kredi=round(kredi.get(lo, 0.0), 2), kayip=round(W.lo_loss.get(lo, 0.0), 2), mevduat=round(W.dep_tot.get(lo, 0.0), 2),
                 fee=W.FEES.get(lo, ""), spread=t.get("spread", ""), risk_tol=t.get("risk_tol", ""), dep_pay=t.get("dep_pay", ""), mev_faiz=W.dep_rate_w.get(lo, ""),
                 mev_tasi_gelen_adet=ts.get("tasi_gelen_adet", ""), mev_tasi_giden_adet=ts.get("tasi_giden_adet", ""), mev_tasi_gelen_akce=round(ts.get("tasi_gelen_akce", 0.0), 2) if ts else "", mev_tasi_giden_akce=round(ts.get("tasi_giden_akce", 0.0), 2) if ts else "", mev_tasi_nakit_yok=ts.get("tasi_nakit_yok", ""),
                 mev_tasi_geri_adet=ts.get("tasi_geri_adet", ""), devir_alinan=ts.get("devir_alinan", ""), net_faiz_kum=round(gd.get("faiz", 0.0), 2) if gd else "", net_dagit_kum=round(gd.get("dagit", 0.0), 2) if gd else "", net_kayip_kum=round(gd.get("kayip", 0.0), 2) if gd else "",
                 goreli_getiri=round(gd.get("g_son", 0.0), 6) if gd else "", yon_spread=(gd.get("yon", {}).get("spread") or {}).get("dir", "") if gd else "", yon_dep_pay=(gd.get("yon", {}).get("dep_pay") or {}).get("dir", "") if gd else "",
                 spreadli_stok_pay=round(sp_stok.get(lo, 0.0) / kredi[lo], 4) if kredi.get(lo) else "",
                 uye_gelen_kum=W.switches.get(lo, 0), mev_kaybi_kum=round(ts.get("mev_kaybi", 0.0), 2), dunya_mev_kaybi_kum=round(W.L.flows.get("mevduat_kaybi_akce", 0.0), 2),
                 basvuru=s.get("basvuru", ""), onay=s.get("onay", ""), ret=s.get("ret", ""), buyume_basvuru=s.get("buyume_basvuru", ""), buyume_onay=s.get("buyume_onay", ""), buyume_ret=s.get("buyume_ret", ""), kapali=1 if lo in W.closed else 0)
        for kod, n in sorted((s.get("ret_sebep") or {}).items()):
            r["ret_" + str(kod)] = n
        if lts:
            for nd_ in ("kapali", "miss", "risk", "nakit"):
                r["devir_red_" + nd_] = (ts.get("devir_red") or {}).get(nd_, 0)        # REKABET G5: devir denemesinin red nedenleri (deneme başına)
        if kk:
            for tur_ in KAYIP_TURLERI:
                r["kayip_" + tur_] = round(kk.get(lo, {}).get(tur_, 0.0), 2)           # REKABET G5 (davranışsız): kredi kaybının türe göre dökümü (sabit tür kümesi, sıfır da yazılır)
        rows.append(r)
    return rows


def _ls_hucre(W, lo):
    ls = W.__dict__.get("ls_stat")
    if ls is None:
        ls = W.ls_stat = {}
    s = ls.get(lo)
    if s is None:
        s = ls[lo] = dict(basvuru=0, onay=0, ret=0, ret_sebep={}, buyume_basvuru=0, buyume_onay=0, buyume_ret=0)
    return s


def ls_say(W, w, lo, sebep=None, **kayit):
    """REKABET G4: loncanın KURULUŞ kredisi kararını sayar (yalnız KR_MEAS=1; DAVRANIŞSIZ: RNG yok, hiçbir karar okumaz). W.ls_stat[lo] = dict(basvuru, onay, ret, ret_sebep={kod: adet}, buyume_basvuru, buyume_onay, buyume_ret).
    BİRİM: bu sayaçlar TEKLİF düzeyindedir. LONCA_SELECT'te bir kurucu başvurusu her canlı loncaya birer basvuru yazar (onay = o lonca teklif verdi, kredi açıldı demek değil); eski yolda ve eo_found/medyada yalnız denenen loncaya.
    KARAR düzeyi (sektör başvurusu başına bir sayım) `W.lo_stat["ks_basvuru_karar"/"ks_onay_karar"/"ks_ret_karar"/"ks_kendi_parasiyla_karar"]` (ks_karar; basvuru = onay + ret + kendi_parasiyla). Eski WKC sayaçları (kredi_basvuru, kredi_ret, ret_<tür>, kredi_yetersiz, kr_kurucu_ret) ADAY DENEMESİ başına artar; karar düzeyi için ks_*_karar kullanın. Büyüme/yatırım/Ar-Ge kredisi kararları ayrı: buyume_* anahtarları (ls_say_b), kuruluş sayaçlarına karışmaz.
    Kuruluş sebep kodları (küçük harf ASCII): risk (pd > risk_tol), kasa_yetersiz (lonca havuzu + kurucu nakdi işletme sermayesini karşılamıyor), limit (itibar kredi tavanı ya da kurucu payı kuruluşu karşılamıyor), fon_yetersiz (şehir kuruluş fonu yetmiyor; eo_found).
    Ret satırı FIRM_LIFE_LOG açıkken W.ls_ret listesine (sebep, pd, cov, risk_tol, şehir, ürün) eklenir; firm_log.write bunu yasam.jsonl'a `satir="ret"` olarak yazar (kayıt kurulmadan önceki retler de kaybolmaz)."""
    if not KR_MEAS:
        return
    s = _ls_hucre(W, lo)
    s["basvuru"] += 1
    if sebep is None:
        s["onay"] += 1
        return
    s["ret"] += 1
    s["ret_sebep"][sebep] = s["ret_sebep"].get(sebep, 0) + 1
    if FIRM_LIFE_LOG:
        W.__dict__.setdefault("ls_ret", []).append(dict(satir="ret", hafta=w, lonca=lo, sebep=sebep, **kayit))


def ls_say_b(W, lo, sebep=None):
    """REKABET G4: BÜYÜME ailesi (cx_ok eleme + cx_lend: büyüme, yatırım, Ar-Ge) kredi kararını lonca başına sayar (yalnız KR_MEAS; davranışsız). sebep None = verildi (buyume_onay), değilse buyume_ret + ret_sebep[sebep].
    Kodlar: buyume_yas, buyume_kar, buyume_gecikme, buyume_itibar, buyume_satilamayan (cx_ok), <tur>_kar_limiti, <tur>_fon, <tur>_havuz, <tur>_pd (cx_lend; tur = buyume, yatirim, arge). Kuruluş sayaçlarına karışmaz."""
    if not KR_MEAS or not lo:
        return
    s = _ls_hucre(W, lo)
    s["buyume_basvuru"] += 1
    if sebep is None:
        s["buyume_onay"] += 1
        return
    s["buyume_ret"] += 1
    s["ret_sebep"][sebep] = s["ret_sebep"].get(sebep, 0) + 1


def ls_say_b_onay(W, lo, eski):
    """REKABET G4 (yalnız KR_MEAS; davranışsız): aynı firma-hafta-aile için daha önce `eski` sebebiyle ret yazılmışsa ve sonra onay geldiyse ret düzeltilir: buyume_ret ve ret_sebep[eski] bir azalır, buyume_onay bir artar; buyume_basvuru değişmez ("onay kazanır")."""
    if not KR_MEAS or not lo:
        return
    s = _ls_hucre(W, lo)
    s["buyume_ret"] -= 1
    s["buyume_onay"] += 1
    s["ret_sebep"][eski] = s["ret_sebep"].get(eski, 0) - 1
    if s["ret_sebep"][eski] <= 0:
        del s["ret_sebep"][eski]


def gs_kayit(W, f, lo, tur, amt, rate, pd, cov, w):
    """REKABET G15 (yalnız KR_MEAS; davranışsız, RNG yok): GROW_SELECT ile verilen büyüme/yatırım kredisini W.gs_log'a yazar: hafta, firma, lonca, tür, tutar, faiz (haftalık), pd, cov, verildiği andaki işçi sayısı (isci0); isci26 ve olu26 gs_izle ile 26 hf sonra doldurulur."""
    r = dict(w=w, f=f, lo=lo, tur=tur, amt=round(amt, 4), rate=round(rate, 6), pd=round(pd, 4), cov=round(cov, 4), isci0=len(W.firms[f]["workers"]))
    if GROW_PURPOSE:
        d = W.firms[f]
        r.update(hedef=d.get("sp_hedef") if d.get("sp_hedef_w") == w else None, kadro0=len(d["workers"]), ardisik_hedef_acik=d.get("gp_ard", 0))      # REKABET G17d: kadro planı (hedef), verildiği andaki kadro, hedef > kadro iken ardışık hafta; isci4 gs_izle ile 4 hf sonra
    W.__dict__.setdefault("gs_log", []).append(r)


def gs_izle(W, w):
    """REKABET G15 (yalnız KR_MEAS; davranışsız): verilişinden 26 hf geçen kayıtlara firmanın o haftaki işçi sayısı (isci26; ölmüşse 0, olu26 = 1) yazılır; GROW_PURPOSE açıkken 4 hf geçen kayıtlara isci4 (G17d)."""
    for r in W.__dict__.get("gs_log") or ():
        if "isci26" not in r and w - r["w"] >= 26:
            d = W.firms.get(r["f"])
            r["isci26"] = 0 if (d is None or d.get("dead")) else len(d["workers"])
            r["olu26"] = 1 if (d is None or d.get("dead")) else 0
        if GROW_PURPOSE and "isci4" not in r and w - r["w"] >= 4:
            d = W.firms.get(r["f"])
            r["isci4"] = 0 if (d is None or d.get("dead")) else len(d["workers"])               # REKABET G17d: kredi sonrası 4 hf kadro (referans artış +0,09 / 4 hf)


def ks_karar(W, sonuc):
    """REKABET G4: kurucu başına KARAR düzeyi sayaç (yalnız KR_MEAS; davranışsız): sonuc onay | ret | riskli (en az bir lonca riskle reddetti ve kimse vermedi; ret'in alt kümesi) | kendi (kendi parasıyla kuruldu; onay'ın alt kümesi) | cov_yok (ciro bilgisi yok, cov=1 varsayıldı)."""
    if not KR_MEAS:
        return
    st = W.lo_stat
    if sonuc in ("onay", "ret"):
        st["ks_basvuru_karar"] += 1
        st["ks_" + sonuc + "_karar"] += 1
    elif sonuc == "kendi_karar":
        st["ks_basvuru_karar"] += 1
        st["ks_kendi_parasiyla_karar"] += 1
    elif sonuc == "riskli":
        st["ks_riskli_karar"] += 1
    elif sonuc == "kendi":
        st["ks_kendi_parasiyla"] += 1
    elif sonuc == "cov_yok":
        st["ks_cov_yok"] += 1
