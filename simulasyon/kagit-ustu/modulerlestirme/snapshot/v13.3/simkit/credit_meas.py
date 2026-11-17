"""simkit.credit_meas: PLAN-KREDI T5 ölçüm sütunları (WEEKLY_CSV `kr_*`; yalnız KR_MEAS=1 iken çağrılır; davranışsız).

AMAÇ: kredi, mevduat, lonca, oyuncu firması, kuruluş kredisi, şehir tahvili ve iş piyasası ölçümlerini haftalık satıra yazar (PLAN-KREDI §4.5). Hiçbiri para ya da durum değiştirmez.
  Kredi/mevduat/lonca sütunları modelin mevcut durumundan ve sayaçlarından (`L.flows`, `W.bond_stat`, `W.lo_stat`) türer; lonca kapanış ve devir sütunları T6 sayaçlarından (`kapanis_batik/uyesiz/gider`, `batik_bekleme_hafta`, `devir_acik_akce`), kuruluş sütunları T7 sayaçlarından (`kurulus_yeni`: girişimci loncası, `kurulus_yeniden`: kapanmış yuvanın yeniden kurulması; LONCA_EASY açık olsun olmasın sayılır).
  İş piyasası sütunları `W.lab_stat`, `W.lab_type`, `W.staff_tgt` (simkit.lab_meas) ve KENDİ önceki hafta eşlemesinden (`W._kr_lab`; yalnız KR_MEAS=1 iken oluşur) türer.
  Sütun adları `_kum` ile bitenler birikimli, öbürleri o haftanındır.
ARAYÜZ: kr_week_row(W, cls)
OKUR: W.L, W.loans, W.mortgages, W.bonds, W.deposits, W.dep_tot, W.firms, W.people, W.cities, W.lab_*, W.staff_tgt, W.lo_stat, W.bond_stat, W.hire_stat. YAZAR: yalnız W._kr_lab (kendi durumu).
KATMAN: L0 (yalnız params; lonca sınıflarını çağıran verir).
"""
from collections import deque
from simkit.params import *          # noqa: F401,F403

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
        kr_kayip_kum=round(sum(v for k, v in fl.items() if k.endswith("kayip_akce"))))


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
