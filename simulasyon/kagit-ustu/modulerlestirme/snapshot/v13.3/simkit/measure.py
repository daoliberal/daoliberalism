"""simkit.measure: ölçüm/teşhis kancaları (PX; davranışsız: kapalıyken çıktı bayt bayt aynı, ayrıntı README "Ölçüm kancaları").

AMAÇ: deney dalında (tur 3-20) eklenen teşhis ölçümlerini tek modülde toplar. Hiçbiri para/durum değiştirmez; yalnız dosya yazar.
  WEEKLY_CSV=yol     haftalık seri CSV (talep karşılama, çalışan/işsiz, firma sayıları, para stoku dağılımı, dolaşım hızı, f_para/f_mag/f_mal,
                     kıt ürünler); yanına `.sx/.st` (SECDUMP), `.bd` (BDUMP), `.kd` (KDUMP=firma türü), `.pf` (PFDUMP), `.sz` (SDUMP) dosyaları.
  SECDUMP=1          sektörler arası haftalık akış matrisi (`<csv>.sx`) ve sektör stokları (`<csv>.st`): sektörel denge / Kalecki (Ledger.sx, install_secfn).
  BDUMP, KDUMP, PFDUMP, SDUMP: haftalık bloktaki teşhis dökümleri (SCDUMP/CDUMP: week_diag_dumps).
ARAYÜZ: install_secfn(W) (World kurulumunda, L.sx açıkken), measure_week(W, w) (hafta sonu, phase_close içinden), measure_finish(W) (koşu sonunda CSV yazar).
OKUR: W (yalnız okuma) ve W.WKC/W.wk_csv/W.DL_PREV/W.FL_PREV/W.SPCLS (bu modülün ve hafta fazlarındaki `if WEEKLY_CSV:` sayaçlarının durumu).
YAZAR: yalnız dosyalar; L.sx/L.bd haftalık boşaltılır.
KATMAN: L8 (hafta fazlarının üstünde; yalnız okur).
"""
import csv
import os
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import lendable, lo_classes
from simkit.transition import trans_week_row
from simkit.sector_board import board_week_row
from simkit.entry_open_meas import eo_week_row, eo_extra_row, eo_dump
from simkit.young_meas import yk_week_row
from simkit.rate_behav import rb_week_row
from simkit.cash_meas import kk_week_row
from simkit.credit_meas import kr_week_row


def install_secfn(W):
    """tur 19: hesap -> sektör eşlemesi (yalnız teşhis; L.sx açıkken)."""
    L, firms, people = W.L, W.firms, W.people
    _sc = {}
    def _secfn(a_):
        r_ = _sc.get(a_)
        if r_ is not None:
            return r_
        if a_ in L.city_accounts:
            r_ = "sehir"
        elif a_ in firms:
            d_ = firms[a_]
            if d_["kind"] in ("belediye", "ahir", "lojistik", "market", "medya", "arge"):
                r_ = ("kamu_" if d_["owner"] is None else "oyuncu_") + d_["kind"] if d_["kind"] in ("belediye", "ahir") else ("npc_" if d_["owner"] is None else "oyuncu_") + "firma"
            else:
                r_ = "npc_firma" if d_["owner"] is None else "oyuncu_firma"
        elif a_ in people:
            p_ = people[a_]
            r_ = ("oyuncu_hane" if p_["who"] == "oyuncu" else "npc_hane_t%d" % p_["tier"])
        elif a_.endswith("_sermaye"):
            r_ = "lonca_sermaye"
        elif a_.endswith("_refah"):
            r_ = "lonca_refah"
        elif a_.endswith("_rezerv"):
            r_ = "sigorta_rezerv"
        elif a_.startswith("lonca"):
            r_ = "lonca_kasa"
        elif a_.startswith("emanet"):
            r_ = "konut_emanet"
        else:
            r_ = "diger"
        if a_ in firms or a_ in people:
            return r_                                 # firma/kişi sektörü değişebilir (özelleşme, ölüm): önbelleğe alma
        _sc[a_] = r_
        return r_
    L.secfn = _secfn


def measure_week(W, w):
    """hafta sonu ölçümü: SECDUMP/BDUMP/KDUMP/PFDUMP/SDUMP dökümleri ve WEEKLY_CSV satırı (davranışsız)."""
    if not WEEKLY_CSV:
        return
    DL_PREV = W.DL_PREV
    FL_PREV = W.FL_PREV
    L = W.L
    REF = W.REF
    SPCLS = W.SPCLS
    WKC = W.WKC
    bond_stat = W.bond_stat
    bonds = W.bonds
    cities = W.cities
    city_ref = W.city_ref
    closed = W.closed
    deposits = W.deposits
    firms = W.firms
    fwk_prod = W.fwk_prod
    loans = W.loans
    loncas = W.loncas
    people = W.people
    player_firms = W.player_firms
    priv_stat = W.priv_stat
    series = W.series
    stats = W.stats
    wk_csv = W.wk_csv
    if WEEKLY_CSV and L.sx is not None:        # tur 19: sektörel denge dökümü (davranışı etkilemez)
        with open(WEEKLY_CSV + ".sx", "a") as _sx:
            for (_a, _b, _k), _v in L.sx.items():
                _sx.write(f"{w},{_a},{_b},{_k},{_v:.0f}\n")
            L.sx.clear()
        with open(WEEKLY_CSV + ".st", "a") as _st:
            _stk = defaultdict(float)
            for _q, _v in L.bal.items():
                _stk[L.secfn(_q)] += _v
            _stk["mevduat_alacak_oyuncu"] = sum(v_[1] for q_, v_ in deposits.items() if q_ in people and people[q_]["who"] == "oyuncu")
            _stk["mevduat_alacak_npc"] = sum(v_[1] for q_, v_ in deposits.items() if q_ in people and people[q_]["who"] != "oyuncu")
            _stk["tahvil_stok"] = sum(b_["out"] for b_ in bonds)
            _stk["kredi_stok"] = sum(l_["out"] for l_ in loans.values())
            _stk["bond_kisma_tavan_kum"] = bond_stat["kisma_tavan_tl"]
            _stk["bond_kisma_havuz_kum"] = bond_stat["kisma_havuz_tl"]
            _stk["sehir_kisma_ihrac_dis_kum"] = sum(L.cut.values())
            _stk["kisma_issizlik_odenegi_kum"] = L.cut.get("issizlik_odenegi", 0.0)
            _stk["kisma_altyapi_kum"] = L.cut.get("altyapi_hizmet_sozlesmesi", 0.0)
            _stk["sehir_ref_gelir_toplam"] = sum(city_ref.values())
            for _k, _v in _stk.items():
                _st.write(f"{w},{_k},{_v:.0f}\n")
    if WEEKLY_CSV and L.bd is not None:
        with open(WEEKLY_CSV + ".bd", "a") as _bd:
            _agg = defaultdict(float)
            for (_dr, _k, _to), _v in L.bd.items():
                _sec = firms[_to]["kind"] if _to in firms else ""
                _agg[(_dr, _k, _sec)] += _v
            for (_dr, _k, _sec), _v in _agg.items():
                _bd.write(f"{w},{_dr},{_k},{_sec},{_v:.0f}\n")
            if w % 5 == 0:
                _z = defaultdict(int)
                for _f, _d in firms.items():
                    if _d["owner"] is None and not _d.get("dead") and not _d.get("priv") and _d["kind"] not in ("ahir", "belediye") and not _d["workers"] and L.bal[_f] < 5.0:
                        _z[_d["kind"]] += 1
                for _k, _v in _z.items():
                    _bd.write(f"{w},zombi,{_k},{_k},{_v}\n")
            L.bd.clear()
    if WEEKLY_CSV and os.environ.get("KDUMP"):
        with open(WEEKLY_CSV + ".kd", "a") as _kd:
            for f_, d_ in firms.items():
                if d_["kind"] == os.environ["KDUMP"]:
                    _ln = loans.get(f_)
                    _kd.write(f"{w},{f_},{len(d_['workers'])},{L.bal[f_]:.0f},{_ln['out'] if _ln else 0:.0f},{_ln['miss'] if _ln else 0},{d_.get('prof', 0.0):.0f},{int(bool(d_.get('priv')))},{int(bool(d_.get('dead')))},{d_.get('insolv', 0)},{d_.get('owner')},{L.fexp.get(f_, {}).get('ucret', 0) if L.fexp else 0:.0f},{(L.frev.get(f_, 0) if L.frev else 0):.0f}\n")
    if WEEKLY_CSV and os.environ.get("PFDUMP"):
        with open(WEEKLY_CSV + ".pf", "a") as _pf:
            for f_ in player_firms:
                d_ = firms[f_]
                if not d_.get("dead"):
                    _ex = L.fexp.get(f_) or {}
                    _pf.write(f"{w},{f_},{d_['kind']},{w - d_.get('born', w)},{len(d_['workers'])},{L.bal[f_]:.0f},{loans[f_]['out'] if f_ in loans else 0:.0f},{d_.get('unsold_acc', 0.0) / max(1e-9, d_.get('prod_acc', 0.0)):.2f},{d_.get('life_ok', 0.0) / max(1, d_.get('life_n', 0)):.2f},{sum(_ex.values()):.0f},{sum(v_ for k_, v_ in _ex.items() if k_ == 'ucret'):.0f}\n")
    if WEEKLY_CSV:
        _fl = L.flows
        _npcf = [d_ for d_ in firms.values() if d_["owner"] is None and d_["kind"] not in ("ahir", "belediye") and not d_.get("dead") and not d_.get("org_owner")]
        _priv = [d_ for d_ in firms.values() if d_.get("priv") and not d_.get("dead")]
        if SDUMP_ON and w % 10 == 0:
            with open(WEEKLY_CSV + ".sz", "a") as _sz:
                for f_, d_ in firms.items():
                    if d_ in _npcf:
                        _sz.write(f"{w},{f_},{d_['kind']},{d_['city']},{len(d_['workers'])},{d_.get('prof', 0.0):.0f},{L.bal[f_]:.0f},{loans[f_]['out'] if f_ in loans else 0:.0f},{int(bool(d_.get('priv')))},{fwk_prod.get(f_, 0.0):.1f}\n")
        wk_csv.append(dict(hafta=w, talep_karsilama=round(series["got"] / max(1e-9, series["dem"]), 4), calisan=series["employed"], calisan_npc=series["emp_npc"], issiz=series["seekers"],
                           npc_firma=len(_npcf), npc_zarar=sum(1 for d_ in _npcf if d_.get("prof", 0.0) < 0), ozellesen_firma=len(_priv), oyuncu_firma=sum(1 for f_ in player_firms if not firms[f_].get("dead")),
                           batan_kum=_fl.get("npc_batis_adet", 0), devir_kum=priv_stat.get("devir", 0), devir_oyuncu_kum=priv_stat.get("devir_oyuncu", 0), devir_lonca_kum=priv_stat.get("devir_lonca", 0), ihale_kum=priv_stat.get("ihale", 0),
                           alici_yok_kum=priv_stat.get("alici_yok_tur", 0), tasfiye_kum=priv_stat.get("tasfiye", 0), canlandi_kum=_fl.get("npc_canlandirma_adet", 0),
                           kredi_basvuru=WKC["kredi_basvuru"], kredi_ret=WKC["kredi_ret"], kurucu_yok=WKC["kurucu_yok"], tavan_orani_ort=round(WKC["tavan_orani_toplam"] / max(1, WKC["kredi_basvuru"]), 3),
                           ret_nedeni=";".join(f"{k_[4:]}:{int(v_)}" for k_, v_ in sorted(WKC.items()) if k_.startswith("ret_") and v_), akis=";".join(f"{k_}:{_fl.get(k_, 0.0):.0f}" for k_ in ("ciraklik_bursu", "belediye_ucreti", "issizlik_odenegi", "kamu_hizmet_destegi", "kamu_hizmet_sozlesmesi", "altyapi_hizmet_sozlesmesi", "npc_kar", "satis_vergisi", "gelir_vergisi", "konut_kirasi", "temettu_vergisi", "ozellestirme_bedeli", "kurulus_harci", "ciraklik_payi")), ist_sektor=";".join(f"{k_}:{v_}" for k_, v_ in sorted(((k2_, sum(len(d_["workers"]) for d_ in firms.values() if d_["kind"] == k2_)) for k2_ in {d_["kind"] for d_ in firms.values()}), key=lambda t_: -t_[1])[:9]), ret_havuz=int(WKC["nd_havuz"]), ret_itibar=int(WKC["nd_itibar"]),
                           sehir_kasasi=round(sum(L.bal[c_["acct"]] for c_ in cities)), havuz_lendable=round(sum(lendable(W, l_) for l_ in loncas if l_ not in closed))))
        if wk_csv:
            _r = wk_csv[-1]
            _M = defaultdict(float)
            _DG = defaultdict(float)
            _cls_w = []
            for q_, i_ in people.items():
                if i_["who"] == "oyuncu":
                    _cls_w.append((L.bal[q_] + (deposits[q_][1] if q_ in deposits else 0.0), q_))
            _cls_w.sort()
            _nn = len(_cls_w)
            SPCLS.clear()
            for _i, (_w_, q_) in enumerate(_cls_w):
                _c = "yoksul" if _i < _nn * 0.5 else ("orta" if _i < _nn * 0.9 else "zengin")
                SPCLS[q_] = _c
                _M["para_" + _c] += L.bal[q_]
                _M["mev_" + _c] += deposits[q_][1] if q_ in deposits else 0.0
            _cacc = {c_["acct"] for c_ in cities}
            for k_, v_ in L.bal.items():
                if k_ in people:
                    if people[k_]["who"] == "npc":
                        _M["para_npc_hane"] += v_
                elif k_ in firms:
                    _fd = firms[k_]
                    _M["para_firma_" + ("oyuncu" if (_fd.get("owner") is not None or _fd.get("org_owner")) else ("kamu" if _fd["kind"] in ("belediye", "ahir") else "npc"))] += v_
                elif k_ in _cacc:
                    _M["para_sehir"] += v_
                else:
                    _sf = k_.rsplit("_", 1)[-1]
                    if _sf in ("sermaye", "refah", "rezerv"):
                        _M["para_lonca_" + _sf] += v_
                    elif k_.split("_")[0] in loncas:
                        _M["para_lonca_diger"] += v_
                    elif _sf in ("yenileme",):
                        _M["para_firma_yenileme"] += v_
                    else:
                        _M["para_diger"] += v_
                        _DG[k_] += v_
            _tot = L.total()
            for k_ in ("para_yoksul", "para_orta", "para_zengin", "para_npc_hane", "para_firma_npc", "para_firma_oyuncu", "para_firma_kamu", "para_firma_yenileme", "para_sehir", "para_lonca_sermaye", "para_lonca_refah", "para_lonca_rezerv", "para_lonca_diger", "para_diger", "mev_yoksul", "mev_orta", "mev_zengin"):
                _r[k_] = round(_M[k_])
            _r["para_toplam"] = round(_tot)
            _r["tahvil_acik"] = round(sum(b_["out"] for b_ in bonds))
            _r["kredi_acik"] = round(sum(l_["out"] for l_ in loans.values()))
            _dfl = {k_: v_ - FL_PREV[k_] for k_, v_ in L.flows.items() if not k_.startswith("basim")}
            for k_, v_ in L.flows.items():
                FL_PREV[k_] = v_
            _sp = _dfl.get("satis", 0.0)
            _r["harcama_satis"] = round(_sp)
            _r["harcama_ucret"] = round(_dfl.get("ucret", 0.0))
            _r["hiz_satis"] = round(_sp / max(1e-9, _tot), 4)
            _r["hiz_hane"] = round(_sp / max(1e-9, _M["para_yoksul"] + _M["para_orta"] + _M["para_zengin"] + _M["para_npc_hane"]), 4)
            for _c in ("yoksul", "orta", "zengin", "npc"):
                _r["harc_" + _c] = round(WKC["sp_" + _c])
            _r["dem_ham"] = round(WKC["dem_ham"])
            _r["dem_aff"] = round(WKC["dem_aff"])
            _r["kapasite_u"] = round(WKC["cap_u"])
            _r["f_para"] = round(WKC["dem_aff"] / max(1e-9, WKC["dem_ham"]), 3)
            _r["f_mag"] = round(WKC["sold_u"] / max(1e-9, WKC["dem_aff"]), 3)
            _r["f_mal"] = round(series["got"] / max(1e-9, WKC["sold_u"]), 3)
            _r["gini_servet"] = round(series["gini"], 3)
            _ds = getattr(W, "_dead_seen", None)
            if _ds is None:
                _ds = W._dead_seen = [set(), 0, 0]            # K-212 ölçümü (yalnız WEEKLY_CSV): ölen firmalar; girdi bulunurluğu (ok_prev) < 0,9 olanlar "tedarikçi kaynaklı"
            for _f2, _d2 in firms.items():
                if _d2.get("dead") and _f2 not in _ds[0] and _d2["kind"] not in ("ahir", "belediye"):
                    _ds[0].add(_f2)
                    _ds[1] += 1
                    _ds[2] += 1 if _d2.get("ok_prev", 1.0) < 0.9 else 0
            _r["olum_kum"] = _ds[1]
            _r["olum_girdi_kum"] = _ds[2]
            if SECTOR_BOARD:
                _r.update(board_week_row(W))               # K-212: pano sütunları
            if ENTRY_OPEN or ENTRY_EXP:
                _r.update(eo_week_row(W))                  # K-213: kohort/organik kuruluş, havuz gecikmesi, kadro
                _r.update(eo_extra_row(W))
            if YOUNG_KIT or FOUND_FUND:
                _r.update(yk_week_row(W))                  # K-215/K-216: kuruluş fonu izi, genç firma kadrosu, işe alım/çıkarma/salınım sayaçları
            if RATE_BEHAV:
                _r.update(rb_week_row(W))                  # faiz davranışı: sinyaller ve çarpanlar
            if TREASURY_RULE or PROFIT_KEEP or KK_MEAS:
                _r.update(kk_week_row(W))                  # K-219/K-220: kasa kuralı harcamaları, temettü, firma boyutu dağılımı
            if KR_MEAS:
                _r.update(kr_week_row(W, lo_classes(W)))                  # PLAN-KREDI T5: kredi, mevduat, lonca ve iş piyasası ölçümleri (davranışsız)
            if TRANS_SUPPORT:
                _r.update(trans_week_row(W))               # K-211: kamu destek fonu izi (verilen/dönen/net, sıfırlanan tür sayısı)
            _r["diger_top"] = ";".join(f"{k_}:{v_:.0f}" for k_, v_ in sorted(_DG.items(), key=lambda t_: -t_[1])[:3])
            _dm, _dl = stats["demanded"], stats["delivered"]
            _sh = sorted(((_dm[p_] - DL_PREV[("d", p_)]) - (_dl[p_] - DL_PREV[("g", p_)]), p_, _dm[p_] - DL_PREV[("d", p_)]) for p_ in list(_dm))
            _r["kit_urun"] = ";".join(f"{p_}:{100 * x_ / max(1e-9, d_):.0f}%" for x_, p_, d_ in sorted(_sh, key=lambda t_: -t_[0] * REF.get(t_[1], 1.0))[:6] if d_ > 0)
            for p_ in list(_dm):
                DL_PREV[("d", p_)] = _dm[p_]
                DL_PREV[("g", p_)] = _dl[p_]
        for k_ in [k_ for k_ in WKC if k_ != "tavan_orani_toplam" or True]:
            WKC[k_] = 0.0


def measure_finish(W):
    """koşu sonu: WEEKLY_CSV açıksa haftalık satırları CSV'ye yazar."""
    wk_csv = W.wk_csv
    if WEEKLY_CSV and (ENTRY_OPEN or ENTRY_EXP):
        eo_dump(W, WEEKLY_CSV + ".eo.json")                          # K-213: kuruluş kayıtları (ölçüm; davranışsız)
    if WEEKLY_CSV and wk_csv:
        with open(WEEKLY_CSV, "w", newline="") as _fh:
            _wr = csv.DictWriter(_fh, fieldnames=list(wk_csv[0].keys()))
            _wr.writeheader()
            _wr.writerows(wk_csv)
