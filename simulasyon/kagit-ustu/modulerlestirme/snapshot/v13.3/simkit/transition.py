"""simkit.transition: K-211 geçiş desteği (kamu destek fonu): şehir, KENDİ kasasından (basımsız) zarar eden NPC firmaya işletme sermayesi verir.

AMAÇ: sahip kararı (2026-10-28): kurtarma yasağı (K-185.2) yumuşatıldı; destek takvime değil GEÇİŞE bağlıdır. Her (şehir × tür) için
  destek oranı s = max(0, 1 - ozel_pay / TRANS_THRESH),  ozel_pay = oyuncu/özelleşmiş firmaların kadrosu / türün talep kadro ihtiyacı (0..1)
yani özel kesim sektörü eşik kadar taşıyınca destek 0 olur. Destek tutarı = s × (işletme sermayesi açığı); sınırlar: (1) şehrin haftalık payı
TRANS_CAP × (şehrin hane payı), (2) kasa tabanı: kasa - destek >= TRANS_FLOOR_WEEKS × sönümlü zorunlu haftalık gider (Ledger.mand: cexp). Para YALNIZ şehir kasasından
(`Ledger.pay`, kind `kamu_destek_fonu` ∈ MINT_NOPRINT): basım yok, tahvil yok (nobond). Destek alan firmanın d["fon"] borcu, firma kârını şehre süpürünce
(`npc_kar`) o kadarı "dönen" sayılır (fon izi). Özelleşmiş (d["priv"]) ve kamu altyapısı (NPC_EXEMPT) firmalara bu fon verilmez.
ARAYÜZ:
  trans_scan(W, ci, need)                        restaff başında (şehir başına bir kez): şehrin hafta durumunu (cap, taban, (tür -> s)) kurar
  trans_support(W, ci, f, d, c, ob_x)            köprü yetmeyen NPC için destek öder; ödediyse True (ödeme gücü sayacı sıfırlanır)
  trans_return(W, f, d, amt)                     firmanın kâr süpürmesinde (npc_kar) borcun geri dönen kısmını kaydeder
  trans_week_row(W)                              WEEKLY_CSV için haftalık fon sütunları (sözlük)
  trans_report_text(R, weeks)                    rapor bölümü (R["tsup"] results.py'de derlenir: katman gereği orada)
OKUR: W.firms, W.people, W.cities, W.L; params TRANS_*. YAZAR: W.tsup (bu modülün durumu), L.pay.
KATMAN: L1 (econ_core'a bağlı; labor çağırır).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import working_capital


def _st(W):
    st = getattr(W, "tsup", None)
    if st is None:
        st = W.tsup = dict(week=-1, cap_left={}, s={}, share={}, given_w=0.0, ret_w=0.0, denied_w=0.0, cap_bind=0, floor_bind=0,
                           given=0.0, ret=0.0, by_kind=defaultdict(lambda: [0.0, 0.0]), hist=[], zero_pairs=0, pairs=0, share_sum=0.0, wk_n=0)
    return st


def _new_week(W, st):
    """haftanın ilk çağrısında: sönümlü zorunlu gider, hane payları, haftalık sayaçlar."""
    people, cities = W.people, W.cities
    if st["week"] >= 0:
        st["hist"].append((st["week"], st["given_w"], st["ret_w"], st["zero_pairs"], st["pairs"], (st["share_sum"] / st["pairs"]) if st["pairs"] else 0.0, st["denied_w"]))
    st["week"] = W.week_no
    pop = defaultdict(int)
    for q_, i_ in people.items():
        pop[i_["city"]] += 1
    tot = max(1, sum(pop.values()))
    st["cap_left"] = {c_["i"]: TRANS_CAP * pop[c_["i"]] / tot for c_ in cities}
    st["s"] = {}
    st["share"] = {}
    st["given_w"] = st["ret_w"] = st["denied_w"] = 0.0
    st["zero_pairs"] = st["pairs"] = 0
    st["share_sum"] = 0.0


def trans_scan(W, ci, need):
    """şehirdeki her NPC türü için özel kesim payı ve destek oranı (hafta başına bir kez, restaff girişinde)."""
    st = _st(W)
    if st["week"] != W.week_no:
        _new_week(W, st)
    firms = W.firms
    c = W.cities[ci]
    priv_w = defaultdict(int)
    sal = st.get("sales") if TRANS_SHARE_DEF == "sales" else None
    priv_s, tot_s = defaultdict(float), defaultdict(float)
    npc_kinds = set()
    for f in c["firms"]:
        d = firms[f]
        if d.get("dead") or d["kind"] in ("ahir", "belediye"):
            if TRANS_SUPPORT == 2 and TRANS_REVIVE and d.get("dead") and d["owner"] is None and d["kind"] not in ("ahir", "belediye") and d["kind"] not in NPC_EXEMPT and not d.get("priv"):
                npc_kinds.add(d["kind"])                       # mod 2: yalnız batmış NPC'si olan tür de destek oranı alır (yeniden açılış)
            continue
        if sal is not None:
            tot_s[d["kind"]] += sal.get(f, 0.0)
        if d["owner"] is not None or d.get("priv"):
            priv_w[d["kind"]] += len(d["workers"])
            if sal is not None:
                priv_s[d["kind"]] += sal.get(f, 0.0)
        elif d["kind"] not in NPC_EXEMPT:
            npc_kinds.add(d["kind"])
    for k in sorted(npc_kinds):
        n_ = need.get(k, 0.0) if hasattr(need, "get") else need[k]
        if sal is not None:
            sh = 0.0 if tot_s[k] <= 1e-9 else min(1.0, priv_s[k] / tot_s[k])        # satış payı tanımı (veri yoksa pay 0: tam destek oranı)
        else:
            sh = 1.0 if n_ <= 1e-9 else min(1.0, priv_w[k] / n_)
        s = max(0.0, 1.0 - sh / TRANS_THRESH)
        st["share"][(ci, k)] = sh
        st["s"][(ci, k)] = s
        st["pairs"] += 1
        st["share_sum"] += sh
        if s <= 1e-12:
            st["zero_pairs"] += 1


def trans_sales_note(W, fsold):
    """K-211 v2 (TRANS_SHARE_DEF=sales): haftalık firma satış birimini sönümlü (0,8/0,2) biriktirir; fp_step'te fsold temizlenmeden önce çağrılır."""
    st = _st(W)
    sal = st.setdefault("sales", {})
    for f_, d_ in W.firms.items():
        if d_.get("dead"):
            sal.pop(f_, None)
            continue
        v = fsold.get(f_, 0.0)
        if v or f_ in sal:
            sal[f_] = 0.8 * sal.get(f_, 0.0) + 0.2 * v


def trans_s(W, ci, d):
    """mod 2: bu firmanın (şehir × tür) destek oranı (restaff'ta trans_scan'dan sonra); özel/kamu altyapı firmasına 0."""
    if d.get("priv") or d["kind"] in NPC_EXEMPT:
        return 0.0
    st = _st(W)
    if st["week"] != W.week_no:
        _new_week(W, st)
    return st["s"].get((ci, d["kind"]), 0.0)


def trans_blocks_priv(W, d):
    """mod 2, TRANS_PRIV_OK=0: destek alan (şehir × tür) çiftinde (s > 0) zarar eden NPC özelleştirmeye çıkarılmaz: önce destekle ayakta kalır, geçiş özel kesimin gönüllü girişiyle (oyuncu firması) ilerler; s=0 olunca özelleştirme/batış serbest."""
    if TRANS_PRIV_OK or d["kind"] in NPC_EXEMPT:
        return False
    st = getattr(W, "tsup", None)
    return bool(st) and st["s"].get((d["city"], d["kind"]), 0.0) > 1e-12


def trans_grant(W, ci, f, d, c, gap):
    """mod 2 (TRANS_SUPPORT=2): kurtarmalı rejimin kanalı (şehir -> NPC işletme sermayesi açığı, restaff sonunda) ama kind kamu_destek_fonu:
    verilen = s × açık; sınırlar: haftalık tavan payı, derin kasa tabanı (TRANS_FLOOR2 × sönümlü zorunlu gider). Basım yok. Ödenen tutarı döndürür."""
    st = _st(W)
    if st["week"] != W.week_no:
        _new_week(W, st)
    s = st["s"].get((ci, d["kind"]), 0.0)
    want = s * gap
    if want <= 1e-9:
        return 0.0
    give = want
    if give > st["cap_left"][ci]:
        give = st["cap_left"][ci]
        st["cap_bind"] += 1
    room = max(0.0, W.L.bal[c["acct"]] - TRANS_FLOOR2 * W.L.mand.get(c["acct"], 0.0))
    if give > room:
        give = room
        st["floor_bind"] += 1
    if give <= 1e-9:
        st["denied_w"] += want
        return 0.0
    paid = W.L.pay(c["acct"], f, give, "kamu_destek_fonu")
    if paid <= 1e-9:
        st["denied_w"] += want
        return 0.0
    st["denied_w"] += max(0.0, want - paid)
    st["cap_left"][ci] -= paid
    st["given_w"] += paid
    st["given"] += paid
    st["by_kind"][d["kind"]][0] += paid
    d["fon"] = d.get("fon", 0.0) + paid
    d["insolv"] = 0
    return paid


def trans_support(W, ci, f, d, c, ob_x):
    st = _st(W)
    if st["week"] != W.week_no:
        _new_week(W, st)
    if d.get("priv") or d["kind"] in NPC_EXEMPT:
        return False
    s = st["s"].get((ci, d["kind"]), 0.0)
    if s <= 1e-12:
        return False
    L, firms, people = W.L, W.firms, W.people
    acct = c["acct"]
    want = s * max(0.0, working_capital(W, firms, people, f, ob_x) - L.bal[f])
    if want <= 1e-9:
        return False
    give = want
    if give > st["cap_left"][ci]:
        give = st["cap_left"][ci]
        st["cap_bind"] += 1
    room = max(0.0, L.bal[acct] - TRANS_FLOOR_WEEKS * L.mand.get(acct, 0.0))
    if give > room:
        give = room
        st["floor_bind"] += 1
    if give <= 1e-9:
        st["denied_w"] += want
        return False
    paid = L.pay(acct, f, give, "kamu_destek_fonu")
    if paid <= 1e-9:
        st["denied_w"] += want
        return False
    st["cap_left"][ci] -= paid
    st["given_w"] += paid
    st["given"] += paid
    st["by_kind"][d["kind"]][0] += paid
    d["fon"] = d.get("fon", 0.0) + paid
    d["insolv"] = 0
    return True


def trans_return(W, f, d, amt):
    """firma kârını şehre süpürdü (npc_kar): fon borcunun kadarı dönen sayılır."""
    fon = d.get("fon", 0.0)
    if fon <= 1e-9 or amt <= 1e-9:
        return
    st = _st(W)
    r = min(fon, amt)
    d["fon"] = fon - r
    st["ret"] += r
    st["ret_w"] += r
    st["by_kind"][d["kind"]][1] += r


def trans_week_row(W):
    st = _st(W)
    if st["week"] != W.week_no:                  # bu hafta destek akışı yok (açılış/geçiş dönemi): haftalık sayaçlar 0
        return dict(fon_verilen=0, fon_donen=0, fon_net_kum=round(st["given"] - st["ret"]), fon_sifir_tur=0, fon_tur_sayisi=0, fon_ozel_pay_ort=0.0, fon_red=0,
                    fon_tavan_kum=st["cap_bind"], fon_taban_kum=st["floor_bind"])
    return dict(fon_verilen=round(st["given_w"]), fon_donen=round(st["ret_w"]), fon_net_kum=round(st["given"] - st["ret"]), fon_sifir_tur=st["zero_pairs"],
                fon_tur_sayisi=st["pairs"], fon_ozel_pay_ort=round((st["share_sum"] / st["pairs"]) if st["pairs"] else 0.0, 3), fon_red=round(st["denied_w"]),
                fon_tavan_kum=st["cap_bind"], fon_taban_kum=st["floor_bind"])


def trans_report_text(R, weeks):
    """rapor bölümü (K-211): fon izi dönemlere göre, sektör kırılımı, bağlayıcı sınırlar."""
    t = R["tsup"]
    o = ["\n## Kamu destek fonu (K-211, geçiş desteği)\n",
         f"Toplam verilen {t['given']:,.0f} Akçe, NPC kârı olarak şehre dönen {t['ret']:,.0f}, net maliyet {t['given'] - t['ret']:,.0f}. "
         f"Tavan bağlayıcı olduğu firma-hafta {t['cap_bind']}, kasa tabanı bağlayıcı olduğu {t['floor_bind']}. Para yalnız şehir kasasından (basımsız).\n",
         "| dönem (hf) | verilen/hf | dönen/hf | net/hf | sıfırlanan (şehir×tür)/toplam | ort. özel pay |", "|---|---|---|---|---|---|"]
    h = t["hist"]
    for a, b in ((1, 26), (27, 60), (61, 100), (101, 200), (201, 300), (301, 500)):
        rows = [x for x in h if a <= x[0] <= b]
        if rows:
            n = len(rows)
            o.append(f"| {a}-{min(b, rows[-1][0])} | {sum(x[1] for x in rows) / n:,.0f} | {sum(x[2] for x in rows) / n:,.0f} | {sum(x[1] - x[2] for x in rows) / n:,.0f} | "
                     f"{sum(x[3] for x in rows) / n:.1f}/{sum(x[4] for x in rows) / n:.1f} | {sum(x[5] for x in rows) / n:.2f} |")
    o += ["", "Sektör kırılımı (verilen / dönen, Akçe; en çok alan 10 tür):", ""]
    for k, (g, r) in sorted(t["by_kind"].items(), key=lambda kv: -kv[1][0])[:10]:
        o.append(f"- {k}: {g:,.0f} / {r:,.0f}")
    return o
