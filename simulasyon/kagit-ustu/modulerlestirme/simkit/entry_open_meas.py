"""simkit.entry_open_meas: K-213 girişim kapıları: durum kapsayıcısı (W.eo) ve ölçüm satırları (WEEKLY_CSV eo_* sütunları, sonuç sözlüğü R["eo"]).

ARAYÜZ: eo_state, eo_stat_add, eo_week_row, eo_extra_row, eo_results
OKUR: W.firms, W.people, W.L, W.REF, W.deposits, W.eo. YAZAR: W.eo (yalnız eo_state ile ilk kurulum).
KATMAN: L1 (yalnız params; measure ve results okur).
"""
import random  # noqa: F401
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def eo_state(W):
    s = getattr(W, "eo", None)
    if s is None:
        s = W.eo = dict(acc=defaultdict(float), plan=None, firms=[], delayed=set(), ptr={}, stat=defaultdict(float), rec={}, ev=[])
    return s


def eo_stat_add(W, key, v=1.0):
    eo_state(W)["stat"][key] += v


def eo_week_row(W):
    S = eo_state(W)
    st = S["stat"]
    firms = W.firms
    live = [f for f in S["firms"] if not firms[f].get("dead")]
    coh = [f for f in S["firms"] if firms[f].get("cohort")]
    pend = sum(1 for it in (S["plan"] or []) if not it["done"])
    row = dict(eo_organik_kum=int(st["kurulan_organik"]), eo_kohort_kum=int(st["kurulan_kohort"]), eo_kohort_bekleyen=pend,
                eo_havuz_gecikme_firma=int(st["havuz_gecikme_kuruluş"]), eo_havuz_gecikme_deneme=int(st["havuz_gecikme_deneme"]), eo_sonraki_lonca=int(st["sonraki_lonca"]),
                eo_canli=len(live), eo_kohort_canli=sum(1 for f in coh if not firms[f].get("dead")),
                eo_kadro_ort=round(sum(len(firms[f]["workers"]) for f in live) / max(1, len(live)), 2),
                eo_kadro_1_2=sum(1 for f in live if len(firms[f]["workers"]) <= 2))
    if ENTRY_EXP:                                                    # beklenen kâra bağlı kuruluş göstergeleri
        row.update(ee_kurulan_kum=int(st["ee_kurulan"]), ee_oran_ort=round(st["ee_oran_toplam"] / max(1.0, st["ee_oran_adet"]), 3),
                   ee_amax_ort=round(st["ee_amax_toplam"] / max(1.0, st["ee_amax_adet"]), 4), ee_kurulan_oran_ort=round(st["ee_kurulan_oran_toplam"] / max(1.0, st["ee_kurulan"]), 3),
                   ee_secilen_kum=int(st["ee_secilen"]), ee_gerc_kar_isci_ort=round(st["ee_real_toplam"] / max(1.0, st["ee_real_adet"]), 3))
        st["ee_oran_toplam"] = st["ee_oran_adet"] = st["ee_amax_toplam"] = st["ee_amax_adet"] = st["ee_real_toplam"] = st["ee_real_adet"] = 0.0      # haftalık ortalama için sıfırla
    return row


def eo_results(W):
    S = eo_state(W)
    return dict(stat=dict(S["stat"]), rec={f: dict(r) for f, r in S["rec"].items()}, plan_n=len(S["plan"] or []))


def eo_extra_row(W):
    """ölçüm: NPC/oyuncu satılan üretim değeri payı, oyuncu servet dağılımı (kurucu / diğer), temerrüt ve genç kredi sayaçları, sektör başına rakip sayısı özeti."""
    L, firms, people, deposits, REF = W.L, W.firms, W.people, W.deposits, W.REF
    fp, fu = W.fwk_prod, W.fwk_uns
    v_np = v_pl = 0.0
    for f, d in firms.items():
        k = d["kind"]
        if k in ("ahir", "belediye") or k not in PROD_OF:
            continue
        v = max(0.0, fp.get(f, 0.0) - fu.get(f, 0.0)) * REF.get(PROD_OF[k], 1.0)
        if d["owner"] is None:
            v_np += v
        else:
            v_pl += v
    fo, ot = [], []
    for q, i_ in people.items():
        if i_["who"] == "oyuncu":
            (fo if i_.get("founder") else ot).append(L.bal[q] + (deposits[q][1] if q in deposits else 0.0))
    fo.sort()
    ot.sort()
    med = lambda a: round(a[len(a) // 2], 1) if a else 0.0
    own = defaultdict(int)
    for d in firms.values():
        if d["owner"] is not None and not d.get("dead") and d["kind"] in PROD_OF:
            own[(d["city"], d["kind"])] += 1
    return dict(eo_pay_npc=round(v_np / max(1e-9, v_np + v_pl), 4), eo_pay_oyuncu=round(v_pl / max(1e-9, v_np + v_pl), 4),
                eo_servet_kurucu_med=med(fo), eo_servet_diger_med=med(ot), eo_kurucu_n=len(fo),
                eo_temerrut_kum=int(L.flows["temerrut_adet"]), eo_genc_kredi_kum=int(L.flows["kredi_genc_adet"]), eo_kurulus_kredi_kum=int(L.flows["kredi_adet"]),
                eo_rakip_hucre=len(own), eo_rakip_ort=round(sum(own.values()) / max(1, len(own)), 2))


def eo_dump(W, path):
    """koşu sonu (yalnız WEEKLY_CSV + ENTRY_OPEN): kuruluş kayıtları, son kadro, servet dağılımı JSON (ölçüm; davranışsız)."""
    import json
    S = eo_state(W)
    L, firms, people, deposits = W.L, W.firms, W.people, W.deposits
    rec = {}
    for f, r in S["rec"].items():
        d = firms[f]
        rr = dict(r)
        rr["snap"] = {str(k): v for k, v in r["snap"].items()}
        rr["workers_end"] = 0 if d.get("dead") else len(d["workers"])
        rr["dead_end"] = bool(d.get("dead"))
        rr["owner_wealth"] = round(L.bal[r["owner"]] + (deposits[r["owner"]][1] if r["owner"] in deposits else 0.0), 2)
        rec[f] = rr
    wl = sorted((round(L.bal[q] + (deposits[q][1] if q in deposits else 0.0), 2), bool(i_.get("founder")), bool(i_["firm"] and not firms[i_["firm"]].get("dead") and firms[i_["firm"]]["owner"] == q)) for q, i_ in people.items() if i_["who"] == "oyuncu")
    n = len(wl)
    tot = sum(x[0] for x in wl)
    gini = (2 * sum((i + 1) * x[0] for i, x in enumerate(wl)) / (n * tot) - (n + 1) / n) if tot > 0 and n else 0.0
    json.dump(dict(stat=dict(S["stat"]), rec=rec, wealth=wl, gini=gini, plan=[dict(npc=i["npc"], kind=i["kind"], city=i["city"], slot=i["slot"], week=i["week"], done=i["done"], fw=i.get("fw")) for i in (S["plan"] or [])]), open(path, "w"))
