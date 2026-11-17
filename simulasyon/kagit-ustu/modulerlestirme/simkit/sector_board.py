"""simkit.sector_board: K-212 sektör panosu: (şehir x ürün) durumu ve üretici firma sağlığı; firma/lonca kararları buradan okur.

AMAÇ: sahip kararı (2026-10-28): firmalar tedarikçilerini ve sektörün durumunu görür, ona göre karar verir. Pano hafta sonunda (phase_close, ölçümden önce)
YALNIZ zincirden türetilebilen veriyle hesaplanır (hane/firma/pazar sayaçları; gizli bilgi yok) ve W.board'a konur; bir sonraki haftanın kararları okur.
Pano içeriği:
  cells[(ci, p)]  : dem (hf talep), prod (hf üretim), stock (firma stoğu), n_prod, n_healthy (çalışan / sağlıklı üretici), pm (fiyat çarpanı)
  prod[p]         : dünya düzeyi: want, short (karşılanmayan), short_share, persist (kalıcı kıtlık: üstel ort.), stock, cover (stok örtüsü, döngü=gün),
                    n_all, n_h (çalışan / sağlıklı üretici sayısı), ptrend (fiyat indeksi eğilimi)
  fh[f]           : firma sağlığı: h (0..1), cover_w (kasa kaç haftalık gider), streak (zarar serisi hf), staffless, exiting (batık/tasfiye/özelleştirme ihalesi)
  lo[lonca]       : üye firmaların sektörlerindeki kıtlık (ort. kalıcı kıtlık) - lonca izleme
Karar okuyucuları (sb_*) `simkit.sector_core` modülündedir (L0; fiyat/üretim/alım modülleri onu içe aktarır). Kurallar (W.board varken; kaynaklar params.py SB_*):
  sb_buf_mult      girdi tampon hedefi çarpanı (tedarikçi riski)
  sb_split_row     alımda sağlıksız baskın tedarikçinin payını sınırlar (ikinci kaynak)
  sb_need_mult     kadro hedefi çarpanı (kalıcı kıtlık: büyür; stok fazlası: frenlenir)
  sb_scale_mult    üretim ölçeği çarpanı (sektör stoku) ve NPC artırımı için kıtlık bayrağı
  sb_price_target  fiyat hedefi primi/indirimi (sınırlı, tam maliyet tabanı korunur)
  sb_entry_ok      oyuncu girişi (kalıcı kıtlık, girdi tedarikçisi sağlığı)
  sb_hire_ok       oyuncu firması işe alımı (stok fazlasında beklet)
  sb_firm_scarcity firma ana ürününün kalıcı kıtlığı (lonca kredi önceliği)
ARAYÜZ: board_update, board_week_row, board_report_text
OKUR: W.firms, W.cities, W.people, W.L, W.want_units, W.short_units, W.prod_w, W.PM, W.PRICE, W.REF, W.RECIPES, W.priv_q, W.estate. YAZAR: yalnız W.board.
KATMAN: L1 (econ_core'a bağlı).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import working_capital
from simkit.sector_core import board_stat_add  # noqa: F401

_FREE = ("ahir", "belediye")


def board_update(W):
    """hafta sonu: panoyu kur (kalıcı durum: persist, ptrend, streak önceki panodan taşınır)."""
    L, firms, people, cities = W.L, W.firms, W.people, W.cities
    old = getattr(W, "board", None) or dict(persist={}, pidx={}, ptrend={}, streak={})
    persist, pidx, ptrend, streak = old["persist"], old["pidx"], old["ptrend"], old["streak"]
    want, short, prod_w, PM, PRICE, REF = W.want_units, W.short_units, W.prod_w, W.PM, W.PRICE, W.REF
    priv_q = getattr(W, "priv_q", {})
    estate = getattr(W, "estate", {})
    ncity = len(cities)
    # 1) firma sağlığı
    fh = {}
    n_all = defaultdict(int)
    n_h = defaultdict(int)
    n_cell = defaultdict(int)
    n_cell_h = defaultdict(int)
    stock_cell = defaultdict(float)
    for f, d in firms.items():
        k = d["kind"]
        if k in _FREE or k not in PROD_OF:
            continue
        p = PROD_OF[k]
        ci = d["city"]
        exiting = bool(d.get("dead") or f in priv_q or f in estate)
        staffless = not d["workers"]
        prof = d.get("prof", 0.0) if d.get("owner") is None else W.prof_ema.get(f, 0.0)
        if prof < 0:
            streak[f] = streak.get(f, 0) + 1
        else:
            streak[f] = 0
        if exiting:
            h, cw = 0.0, 0.0
        elif staffless:
            h, cw = 0.0, 0.0
        else:
            wc = working_capital(W, firms, people, f)
            wk_cost = max(1e-9, wc / WORKING_CAPITAL_CYCLES * CYCLES_PER_WEEK)
            cw = max(0.0, L.bal[f]) / wk_cost
            tgt_w = SB_HEALTH_WEEKS                      # oyuncu/özelleşmiş: 4 hf (JPMC medyanı)
            if d.get("owner") is None and not d.get("priv"):
                tgt_w = min(SB_HEALTH_WEEKS, (NPC_KEEP if (NO_BAILOUT and d["kind"] not in NPC_EXEMPT) else 1.0) * WORKING_CAPITAL_CYCLES / CYCLES_PER_WEEK)      # NPC kasayı politika gereği (NPC_KEEP x işletme sermayesi) tutar, fazlası şehre süpürülür: sağlık bu politika tamponuna göre
            h = min(1.0, cw / tgt_w)
            h *= 1.0 - 0.5 * min(1.0, streak[f] / SB_LOSS_WEEKS)
            if d.get("insolv", 0) > 0:
                h *= 0.5
        fh[f] = dict(h=h, cover_w=cw, streak=streak[f], staffless=staffless, exiting=exiting)
        if not exiting and not staffless:
            n_all[p] += 1
            n_cell[(ci, p)] += 1
            if h >= SB_H_OK:
                n_h[p] += 1
                n_cell_h[(ci, p)] += 1
        for pp, q in d.get("stock", {}).items():
            if q > 1e-9:
                stock_cell[(ci, pp)] += q
    # 2) ürün düzeyi
    prod = {}
    stock_p = defaultdict(float)
    for (ci, pp), q in stock_cell.items():
        stock_p[pp] += q
    for p in PRODUCER:
        if PRODUCER[p] in _FREE:
            continue
        wnt = want.get(p, 0.0)
        sh = short.get(p, 0.0) / wnt if wnt > 1e-9 else 0.0
        persist[p] = persist.get(p, 0.0) + SB_PERSIST_A * (min(1.0, sh) - persist.get(p, 0.0))
        pi = sum(PRICE[(ci, p)] for ci in range(ncity)) / ncity / max(1e-9, REF[p])
        if p in pidx:
            ptrend[p] = ptrend.get(p, 0.0) + 0.3 * ((pi / max(1e-9, pidx[p]) - 1.0) - ptrend.get(p, 0.0))
        pidx[p] = pi
        daily = wnt / CYCLES_PER_WEEK
        cover = stock_p.get(p, 0.0) / daily if daily > 1e-9 else 0.0
        prod[p] = dict(want=wnt, short=short.get(p, 0.0), short_share=sh, persist=persist[p], stock=stock_p.get(p, 0.0), cover=cover,
                       n_all=n_all.get(p, 0), n_h=n_h.get(p, 0), ptrend=ptrend.get(p, 0.0), pidx=pi,
                       prod=sum(prod_w.get((ci, p), 0.0) for ci in range(ncity)))
    # 3) hücreler
    cells = {}
    for c in cities:
        ci = c["i"]
        for p in prod:
            cells[(ci, p)] = dict(dem=c["last_demand"].get(p, 0.0), prod=c["last_output"].get(p, 0.0), stock=stock_cell.get((ci, p), 0.0),
                                  n_prod=n_cell.get((ci, p), 0), n_healthy=n_cell_h.get((ci, p), 0), pm=PM[(ci, p)])
    # 4) lonca izleme: üyelerinin sektörlerindeki kıtlık
    lo_sum = defaultdict(lambda: [0.0, 0])
    for f, d in firms.items():
        k = d["kind"]
        if k in _FREE or k not in PROD_OF or d.get("dead") or d.get("lonca") is None:
            continue
        lo_sum[d["lonca"]][0] += persist.get(PROD_OF[k], 0.0)
        lo_sum[d["lonca"]][1] += 1
    lo = {l_: (s_ / n_ if n_ else 0.0) for l_, (s_, n_) in lo_sum.items()}
    W.board = dict(week=W.week_no, cells=cells, prod=prod, fh=fh, lo=lo, persist=persist, pidx=pidx, ptrend=ptrend, streak=streak)


# ---- ölçüm / rapor ----

def board_week_row(W):
    b = getattr(W, "board", None)
    if b is None:
        return {}
    pr = b["prod"]
    live = [r for r in pr.values() if r["n_all"] > 0]
    top = sorted(pr.items(), key=lambda kv: -kv[1]["persist"])[:3]
    fh = [r for r in b["fh"].values() if not r["exiting"] and not r["staffless"]]
    return dict(pano_kitlik_ort=round(sum(r["persist"] for r in pr.values()) / max(1, len(pr)), 4),
                pano_kitlik_top=";".join(f"{p}:{r['persist']:.2f}" for p, r in top),
                pano_tek_tedarikci=sum(1 for r in live if r["n_all"] == 1),
                pano_saglikli_yok=sum(1 for r in live if r["n_h"] == 0),
                pano_saglikli_firma=sum(1 for r in fh if r["h"] >= SB_H_OK), pano_firma=len(fh),
                pano_urun_uretici_yok=sum(1 for r in pr.values() if r["n_all"] == 0))


def board_report_text(R, weeks):
    t = R["sbrd"]
    o = ["\n## Sektör panosu (K-212)\n",
         f"Pano her hafta sonunda zincirden türetilir; firma kararları ertesi hafta okur. Kural sayaçları: {', '.join(f'{k}={v:,.0f}' for k, v in sorted(t['stat'].items())) or 'yok'}.\n",
         "En kıt 10 halka (son hafta panosu; kalıcı kıtlık = karşılanmayan payın üstel ortalaması):", "",
         "| ürün | kalıcı kıtlık | bu hf karşılanmayan | üretici (çalışan/sağlıklı) | stok örtüsü (gün) | fiyat eğilimi |", "|---|---|---|---|---|---|"]
    for p, r in sorted(t["prod"].items(), key=lambda kv: -kv[1]["persist"])[:10]:
        o.append(f"| {p} | {r['persist']:.3f} | {r['short_share']:.3f} | {r['n_all']}/{r['n_h']} | {r['cover']:.1f} | {r['ptrend']:+.3f} |")
    fh = [r for r in t["fh"].values() if not r["exiting"] and not r["staffless"]]
    pr = [r for r in t["prod"].values() if r["n_all"] > 0]
    o += ["", f"Tedarikçi sağlığı özeti: çalışan üretici firma {len(fh)}, sağlıklı (h>={SB_H_OK}) {sum(1 for r in fh if r['h'] >= SB_H_OK)}; "
              f"ürün sayısı {len(pr)}, tek tedarikçili {sum(1 for r in pr if r['n_all'] == 1)}, hiç sağlıklı tedarikçisi olmayan {sum(1 for r in pr if r['n_h'] == 0)}; "
              f"üreticisi hiç kalmamış ürün {sum(1 for r in t['prod'].values() if r['n_all'] == 0)}.",
          "", "Karar kuralları (pano bilgisi -> karar):",
          "- tedarikçi sağlığı (etkin sağlıklı tedarikçi sayısı), kalıcı kıtlık -> girdi tampon hedefi (0,5-4 hf)",
          "- baskın tedarikçi sağlıksız (h<%.1f) ve pay > %%75 -> alımın %%25'i ikinci kaynağa (komşu şehir dahil, navlunla)" % SB_H_OK,
          "- kalıcı kıtlık / sektör stoku -> kadro hedefi ve NPC üretim ölçeği (büyür / frenlenir)",
          "- kalıcı kıtlık, stok fazlası, fiyat eğilimi -> fiyat hedefine sınırlı prim/indirim (tam maliyet tabanı korunur)",
          "- kalıcı kıtlık ve girdi tedarikçisi sağlığı -> oyuncu girişi; sektör stoku fazlaysa oyuncu işe alımı bekler",
          "- üyelerin sektöründeki kıtlık -> lonca kredi önceliği (kıt halkadaki üye önce)"]
    return o
