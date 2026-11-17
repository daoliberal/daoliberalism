"""simkit.cash_meas: K-219/K-220 ölçüm satırları (WEEKLY_CSV kk_* sütunları) ve sonuç sözlüğü R["kk"] (yalnız bayrak açıkken çağrılır).

ARAYÜZ: kk_week_row(W), kk_results(W)
OKUR: W.firms, W.cities, W.L, W.kk. YAZAR: yok. KATMAN: L1 (params, cash_core).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.cash_core import TR_NOSPEND, kk_state


def _sizes(W):
    sz = sorted(len(d["workers"]) for d in W.firms.values() if d["owner"] is None and not d.get("dead") and d["workers"] and d["kind"] not in NPC_EXEMPT and d["kind"] not in TR_NOSPEND)
    if not sz:
        return 0, 0, 0, 0.0
    return sz[len(sz) // 2], sz[int(0.9 * (len(sz) - 1))], sz[-1], sum(sz) / len(sz)


def _kar_defter(W):
    """birleşik ölçüm: haftalık toplam firma kârı (gelir-gider defteri: satış geliri - tüm giderler; K-218 raporundaki tanım), defter yoksa 0."""
    L = W.L
    if L.fexp is None:
        return 0.0
    return sum(L.frev.get(f, 0.0) - sum(L.fexp[f].values()) for f in list(L.fexp))


def kk_week_row(W):
    st = kk_state(W)["stat"]
    p50, p90, mx, mean = _sizes(W)
    cap = [d["capacity"] for d in W.firms.values() if d["owner"] is None and not d.get("dead") and d["workers"] and d["kind"] not in NPC_EXEMPT and d["kind"] not in TR_NOSPEND]
    return dict(kk_tr_hane_kum=round(st["hane_transfer_kum"]), kk_tr_alim_kum=round(st["hizmet_alim_kum"]), kk_tr_tahvil_kum=round(st["tahvil_erken_kum"]),
                kk_tr_muni_izin_kum=round(st["muni_izin_kum"]), kk_pk_temettu_kum=round(st["temettu_kum"]), kk_pk_vergi_kum=round(st["vergi_kum"]),
                kk_pk_havuz=round(sum(W.L.bal[f"KPAY{c['i']}"] for c in W.cities)), kk_kadro_p50=p50, kk_kadro_p90=p90, kk_kadro_max=mx, kk_kadro_ort=round(mean, 2),
                kk_kapasite_ort=round(sum(cap) / max(1, len(cap)), 1), kk_kapasite_max=max(cap) if cap else 0, kk_rbar=round(kk_state(W)["rbar"], 5),
                bm_kar_defter=round(_kar_defter(W)), bm_kar_ema=round(sum(v for f, v in W.prof_ema.items() if f in W.firms and not W.firms[f].get("dead") and W.firms[f]["workers"])))


def kk_results(W):
    return dict(stat=dict(kk_state(W)["stat"]))
