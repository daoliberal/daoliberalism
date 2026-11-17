"""simkit.cash_rules: K-219 şehir kasası kuralı (TREASURY_RULE) ve K-220 kâr firmada/hanede kalır (PROFIT_KEEP).

AMAÇ: iki sahip kararı (2026-10-28), ikisi de varsayılan KAPALI bayrak; kapalıyken hiçbir işlev çağrılmaz (çıktı v13.0 ile bayt bayt aynı).
  K-219  tr_step(W, w): her hafta şehir başına sönümlü kendi gideri (L.cexp farkı, kendi harcamamız çıkarılır) ölçülür; kasa hedefi = TR_WEEKS x gider.
         Fazla = kasa - hedef; haftada TR_CONV (0,25) kadarı geri harcanır: önce açık tahvil (erken itfa, para loncaya geri döner), kalan TR_SPLIT
         ile hane transferi (kamu_transferi, şehrin bütün hanelerine kişi başı eşit), yerel NPC firmalardan hizmet alımı (kamu_hizmet_alimi, kadro ağırlıklı;
         kurtarma DEĞİL: yalnız çalışan, kamu altyapısı olmayan, özelleşmemiş firmaya) ve belediye istihdam payı (W.kk["muni"][ci]: labor.staffing
         belediye kadro bütçesine eklenir; ödenmeyen kısım kasada kalır). Basım yok: yalnız pozitif kasadan harcanır.
  K-220  pk_div(W, ci, f, d, x): NPC firma kasası PK_MULT x işletme sermayesini (= PK_WEEKS haftalık gider) aşınca fazlası kurumlar vergisi (CORP_TAX) ve
         temettü stopajı (DIV_TAX) sonrası şehir havuzuna (KPAY<i>) ödenir; pk_distribute(W, ci) havuzu şehrin hanelerine (NPC + oyuncu) (nakit + mevduat)^PK_DIV_EXP
         oranında dağıtır (hisse sahipliği servetle orantılı). Şehre süpürülmez (yalnız vergi şehre gider). NPC_EXEMPT (kamu altyapısı) eskisi gibi süpürülür.
         pk_grow_ok: Caiani birikim kuralı (NPC kapasite büyümesi). CX_CAP_MAX tavanı bayrak açıkken firms.capex_plan'da uygulanmaz.
  Ölçüm: cash_meas (kk_week_row, kk_results); durum/sabitler: cash_core (kk_state, PK_MULT).
ARAYÜZ: tr_step, tr_muni, pk_div, pk_distribute, pk_rbar_update, pk_grow_ok
OKUR/YAZAR: W.L, W.people, W.firms, W.cities, W.bonds, W.deposits; W.kk. KATMAN: L2 (params, fiscal, credit_core).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.cash_core import PK_MULT, TR_NOSPEND, kk_state
from simkit.credit_core import cx_costs, capex_eligible
from simkit.fiscal import corp_tax_pay, pay_div_tax, div_net



def _residents(W):
    S = kk_state(W)
    if S["res_w"] != W.week_no:
        res = defaultdict(list)
        for q, i in W.people.items():
            res[i["city"]].append(q)                # NPC ve oyuncu hanelerinin tümü (şehir sakinleri)
        S["res"], S["res_w"] = res, W.week_no
    return S["res"]


# ------------------------------------------------------------------ K-219
def tr_step(W, w):
    """şehir kasası kuralı (phase_dividends başında çağrılır)."""
    L, S, cities = W.L, kk_state(W), W.cities
    st = S["stat"]
    sp = sum(TR_SPLIT)
    for c in cities:
        a, ci = c["acct"], c["i"]
        cum = L.cexp[a]
        d_ = cum - S["prev"].get(a, 0.0) - S["mine"].get(a, 0.0)
        S["ema"][a] = d_ if a not in S["ema"] else 0.8 * S["ema"][a] + 0.2 * d_      # Ledger.mand ile aynı sönüm
        S["prev"][a] = cum
        S["mine"][a] = 0.0
        S["muni"][ci] = 0.0
        ex = L.bal[a] - TR_WEEKS * S["ema"][a]
        if TREASURY_SYM:
            hist = S.setdefault("inc_hist", {}).setdefault(a, [])
            hist.append(L.inflow.get(a, 0.0))             # Ledger.inflow her hafta basi sifirlanir (week_open): tr_step'te bu haftanin geliri
            del hist[:-TS_AVG]
            S.setdefault("inc_avg", {})[a] = sum(hist) / len(hist)
        st["kasa_fazla_kum"] += max(0.0, ex) if w > TR_START else 0.0
        if w <= TR_START or ex <= 1e-9:
            continue
        spend = TR_CONV * ex
        if TR_BOND_FIRST and W.BOND_ON and W.bonds:
            for b in list(W.bonds):
                if b["city"] != a or spend <= 1e-9:
                    continue
                pa = L.pay(a, f"{b['lo']}_sermaye", min(spend, b.get("arr", 0.0)), "tahvil_faizi")
                b["arr"] = b.get("arr", 0.0) - pa
                spend -= pa
                pp = L.pay(a, f"{b['lo']}_sermaye", min(spend, b["out"]), "tahvil_itfa")
                b["out"] -= pp
                spend -= pp
                W.bond_stat["itfa"] += pp
                st["tahvil_erken_kum"] += pp + pa
                if b["out"] <= 1e-6 and b.get("arr", 0.0) <= 1e-6:
                    W.bonds.remove(b)
        if spend <= 1e-9:
            continue
        s_h, s_p, s_m = (spend * TR_SPLIT[0] / sp, spend * TR_SPLIT[1] / sp, spend * TR_SPLIT[2] / sp)
        if TREASURY_SYM:                                  # transfer tavani: haftalik hane transferi <= TS_CAP x 26 hf ort. gelir; asan kisim kasada kalir
            s_h0 = s_h
            s_h = min(s_h, TS_CAP * S["inc_avg"][a])
            s_p += s_h0 - s_h                             # tavani asan kisim hizmet alimi kanalina akar (fazla harca/dagit)
        paid = 0.0
        res = _residents(W).get(ci, [])
        if res and s_h > 1e-9:
            per = s_h / len(res)
            for q in res:
                paid += L.pay(a, q, per, "kamu_transferi")
            st["hane_transfer_kum"] += paid
        firms = W.firms
        buy = [f for f in c["firms"] if firms[f]["owner"] is None and not firms[f].get("dead") and firms[f]["workers"] and not firms[f].get("priv")
               and firms[f]["kind"] not in NPC_EXEMPT and firms[f]["kind"] not in TR_NOSPEND]
        tw = sum(len(firms[f]["workers"]) for f in buy)
        pb = 0.0
        if tw > 0 and s_p > 1e-9:
            for f in buy:
                pb += L.pay(a, f, s_p * len(firms[f]["workers"]) / tw, "kamu_hizmet_alimi")
            st["hizmet_alim_kum"] += pb
        S["mine"][a] = paid + pb
        S["muni"][ci] = s_m
        st["muni_izin_kum"] += s_m


def tr_muni(W, ci):
    return kk_state(W)["muni"].get(ci, 0.0)


# ------------------------------------------------------------------ K-220
def pk_div(W, ci, f, d, x):
    """NPC firma fazlası: kurumlar vergisi + stopaj şehre, kalan şehir temettü havuzuna. Dönen: havuza giden tutar."""
    L = W.L
    acct = W.cities[ci]["acct"]
    st = kk_state(W)["stat"]
    t0 = L.bal[acct]
    y = corp_tax_pay(L, f, acct, x)
    pay_div_tax(L, f, acct, y)
    st["vergi_kum"] += L.bal[acct] - t0
    got = L.pay(f, f"KPAY{ci}", div_net(y), "npc_kar_payi")
    return got


def pk_distribute(W, ci):
    """şehir temettü havuzunu şehir hanelerine (NPC ve oyuncu) servetle orantılı dağıtır (havuz her hafta boşalır)."""
    L, people = W.L, W.people
    pool = f"KPAY{ci}"
    amt = L.bal[pool]
    if amt <= 1e-9:
        return
    st = kk_state(W)["stat"]
    res = _residents(W).get(ci, [])
    dep = getattr(W, "deposits", None) or {}
    if not res:
        L.pay(pool, W.cities[ci]["acct"], amt, "npc_kar_payi_iade")
        st["temettu_iade_kum"] += amt
        return
    wt = [(max(0.0, L.bal[q] + (dep[q][1] if q in dep else 0.0)) + 1.0) ** PK_DIV_EXP for q in res]
    tot = sum(wt)
    for q, x in zip(res, wt):
        st["temettu_kum"] += L.pay(pool, q, amt * x / tot, "npc_kar_payi")


def pk_rbar_update(W, w):
    """sektör ortalama kâr oranı (sermaye ağırlıklı, NPC, haftalık) üstel ortalaması; haftada bir hesaplanır."""
    S = kk_state(W)
    if S["rbar_w"] == w:
        return
    S["rbar_w"] = w
    mc, bc = cx_costs(W)
    sp = sk = 0.0
    for d in W.firms.values():
        if d["owner"] is None and "mach" in d and capex_eligible(W, d):
            sp += d.get("prof", 0.0)
            sk += d["mach"] * mc + d["bld"] * bc
    if sk > 1e-9:
        S["rbar_raw"] = sp / sk
        S["rbar"] = (1 - PK_RBAR_EMA) * S["rbar"] + PK_RBAR_EMA * S["rbar_raw"]


def pk_grow_ok(W, f, d, n):
    """Caiani birikim kuralı (haftalık): g = (G1 (r - rbar)/rbar + G2 (u - ubar)/ubar) / 13; birikim kapasite adımına ulaşınca +CX_CAP_STEP."""
    S = kk_state(W)
    mc, bc = cx_costs(W)
    cap = d["capacity"]
    K = d["mach"] * mc + d["bld"] * bc
    r = d.get("prof", 0.0) / max(1e-9, K)
    rb = S["rbar"]
    g1 = PK_G1 * max(-1.0, min(2.0, (r - rb) / rb)) if rb > 1e-9 else 0.0       # sektör ortalaması <= 0: kâr terimi bilgi taşımaz
    g2 = PK_G2 * (n / max(1.0, cap) - PK_UBAR) / PK_UBAR
    acc = max(0.0, d.get("pk_acc", 0.0) + (g1 + g2) / 13.0 * cap)
    if acc >= CX_CAP_STEP:
        d["pk_acc"] = acc - CX_CAP_STEP
        S["stat"]["kapasite_artis_kum"] += CX_CAP_STEP
        return True
    d["pk_acc"] = acc
    return False
