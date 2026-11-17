"""PLAN-KREDI T4b: `labour` bloğu (iş piyasası akışları: açık kadro, işe giriş / çıkış, firma ölümüyle kaybedilen iş, iş aramaya giriş kökeni, ölçülen işsizlik süresi; arayüzde gösterilmez).

Sahte dünya testleri her zaman koşar (iki ardışık hafta elle kurulur, her alan elle hesaplanır); gerçek model testleri OYUN_QUICK ile atlanır (26 hafta, iki dünya)."""
from __future__ import annotations

import json
import re
import time
import tracemalloc
import types
import unittest
from collections import defaultdict

from oyun_server import config
from oyun_server.sim import labour, probes
from oyun_server.sim.extract import extract_world, make_packet
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, snapshot_equal
from tests.test_holdings_para import LABOUR_WORLD, owner_recipe_overrides, size

LAB_REASONS_M = ("ucret", "kuculme", "ayrilma", "dao", "olum", "gecis", "belediye", "goc", "egitim", "diger")        # `cikis_<neden>_<tür>` (labour.REASONS değerleri + ücret)


def emp_by_lab_type(W) -> dict:
    """Firma `workers` listelerinden, modelin damgaladığı türe (W.lab_type) göre çalışan sayısı (sunucu kodundan bağımsız kâhin)."""
    out = dict.fromkeys(labour.TYPES, 0)
    for f, d in W.firms.items():
        if not d.get("dead"):
            out[W.lab_type[f]] += len(d["workers"])
    return out


BLOCK_KEYS = {"emp", "vac", "mismatch", "staffless_npc", "hires", "exits", "wage_fail", "inflow", "inflow_reason", "spells", "pf_death"}
ID_RE = re.compile(r"s\d+_(?:p\d+|[a-z_]+\d+)")                      # kişi ve firma kimlikleri (s0_p3, s1_un2, ...)
TYPES = labour.TYPES


def world(week, firms, seekers=(), pool=(), out=(), deps=(), students=(), n_cities=2, cash=None, weekly=None, lab=None, tgt=None):
    """Sahte dünya. `firms`: ad -> dict(kind, workers, owner=None, org=None, city=0, dead=False, died=None). Kişi: adı `P` ile başlayan oyuncu, öbürü NPC; firma ona yazılır.
    `seekers` / `pool` / `out` / `deps`: şehir -> kişi listesi (sözlük) ya da düz liste (şehir 0)."""
    W = fake_world(n_cities, week)
    W.week_no = week
    W.firms = {}
    W.people = {}
    W.L.bal = defaultdict(float, cash or {})
    for f, spec in firms.items():
        d = dict(kind=spec["kind"], city=spec.get("city", 0), workers=list(spec.get("workers", ())), owner=spec.get("owner"), dead=spec.get("dead", False), capacity=25)
        if spec.get("org") is not None:
            d["org_owner"] = spec["org"]
        if spec.get("died") is not None:
            d["died"] = spec["died"]
        W.firms[f] = d
    names = set()
    for d in W.firms.values():
        names.update(d["workers"])
        if d["owner"] is not None:
            names.add(d["owner"])

    def lists(v):
        return v if isinstance(v, dict) else {0: list(v)}
    for kind, v in (("seekers", seekers), ("pool", pool), ("out", out), ("deps", deps)):
        for ci, qs in lists(v).items():
            names.update(qs)
    names.update(students)
    for q in names:
        W.people[q] = dict(tier=0, wage=10, firm=None, who="oyuncu" if q.startswith("P") else "npc", city=0)
    for f, d in W.firms.items():
        for q in d["workers"]:
            W.people[q]["firm"] = f
    for c in W.cities:
        c.update(players=[], seekers=[], pool=[], out=[], deps=[])
    for kind, v in (("seekers", seekers), ("pool", pool), ("out", out), ("deps", deps)):
        for ci, qs in lists(v).items():
            W.cities[ci][kind] = list(qs)
    W.student = {q: 1 for q in students}
    W.weekly = weekly if weekly is not None else []
    if lab is not None:
        W.lab_stat = defaultdict(float, lab)
    if tgt is not None:
        W.staff_tgt = dict(tgt)
    return W


P_ = params_ns()
FIRMS10 = {
    "n1": dict(kind="un", workers=["w1", "w2", "w3"]),
    "n2": dict(kind="firin", workers=["w4", "w5"]),
    "n3": dict(kind="sut", workers=["w6", "w7"]),
    "pf1": dict(kind="firin", owner="P1", workers=["P1", "w8"]),
    "dao1": dict(kind="arge", owner="P1", workers=["w9"]),
    "ahir0": dict(kind="ahir", workers=["w10", "w11"]),
    "bel0": dict(kind="belediye", workers=["w12"]),
    "n4": dict(kind="un", workers=[]),                                 # işçisiz yerleşik işletme, kasa 0,5
    "n5": dict(kind="un", workers=[]),                                 # işçisiz, kasa 10
    "n6": dict(kind="un", workers=[], org="ORG"),                      # org_owner: yerleşik değil
    "ahir9": dict(kind="ahir", workers=[]),                            # ahır: sayılmaz
}
CASH = {"n4": 0.5, "n5": 10.0, "pf1": 30.0}


def week10():
    return world(10, FIRMS10, seekers=["s_a"], pool={0: ["s_b"], 1: ["s_c"]}, out=["o1"], deps=["dp1"], students=["st1"], cash=CASH)


def week11(**kw):
    """10. haftadan 11'e: w1 işten çıkar, w2 n1->n2, w4 n2->pf1, n3 ölür (w6 işsiz, w7 n1'e geçer), s_a n2'ye, s_c belediyeye girer, o1 ve st1 iş arar, nw1 yeni kişi iş arar,
    nw2 yeni kişi n1'e girer, w10 ahırdan çıkar iş arar, w12 belediyeden işgücü dışına çıkar."""
    firms = {
        "n1": dict(kind="un", workers=["w3", "w7", "nw2"]),
        "n2": dict(kind="firin", workers=["w2", "w5", "s_a"]),
        "n3": dict(kind="sut", workers=[], dead=True, died=11),
        "pf1": dict(kind="firin", owner="P1", workers=["P1", "w8", "w4"]),
        "dao1": dict(kind="arge", owner="P1", workers=["w9"]),
        "ahir0": dict(kind="ahir", workers=["w11"]),
        "bel0": dict(kind="belediye", workers=["s_c"]),
        "n4": dict(kind="un", workers=[]), "n5": dict(kind="un", workers=[]), "n6": dict(kind="un", workers=[], org="ORG"), "ahir9": dict(kind="ahir", workers=[]),
    }
    W = world(11, firms, seekers=["w1", "w6", "o1", "nw1", "w10"], pool={0: ["s_b"], 1: ["st1"]}, out=["w12"], deps=["dp1"], cash=CASH, **kw)
    W.people["w6"]["firm"] = None
    return W


def second_state(W10=None):
    """Hafta 10'un durumu; süreler elle kurulur (sürekli kısa yoldan: s_a 4, s_b 13, s_c 27 hafta sonra 11. haftada)."""
    _, st = labour.build(W10 or week10(), P_, None)
    st.start.update({"s_a": 11 - 4, "s_b": 11 - 13, "s_c": 11 - 27})
    return st


class Transitions(unittest.TestCase):
    def setUp(self):
        self.blk, self.st = labour.build(week11(), P_, second_state())

    def test_transitions_synthetic(self):
        """Giriş, çıkış, firma değiştirme, firma ölümü, yeni kişi, ahırdan çıkış, işgücü dışından dönüş: her alan elle hesaplanmıştır."""
        b = self.blk
        self.assertEqual(set(b), BLOCK_KEYS)
        # stok: n1 3 (w3 w7 nw2), n2 3 (w2 w5 s_a), pf1 3 (P1 w8 w4), dao1 1, ahir0 1 (w11), bel0 1 (s_c)
        self.assertEqual(b["emp"]["by_type"], {"npc": 6, "player": 3, "dao": 1, "public": 2})
        self.assertEqual(b["emp"]["private"], 10)
        self.assertEqual(b["emp"]["sectors"], {"firin": 6, "un": 3, "ahir": 1, "rest": 2})
        # net giriş (yeni firmanın türü): w7 ve nw2 n1'e, w2 ve s_a n2'ye (npc 4); w4 pf1'e (player 1); s_c belediyeye (public 1)
        self.assertEqual(b["hires"]["net"], {"npc": 4, "player": 1, "dao": 0, "public": 1})
        # net çıkış (önceki firmanın türü): w1, w2 (n1), w4 (n2), w6, w7 (n3) npc 5; w10 (ahır), w12 (belediye) public 2
        self.assertEqual(b["exits"]["net"], {"npc": 5, "player": 0, "dao": 0, "public": 2})
        self.assertEqual(b["exits"]["firm_death"], {"npc": 2, "player": 0, "dao": 0, "public": 0})   # n3'ün iki işçisi (w7 başka işe geçse de firması öldü)
        for t, was, now in (("npc", 7, 6), ("player", 2, 3), ("dao", 1, 1), ("public", 3, 2)):
            self.assertEqual(now - was, b["hires"]["net"][t] - b["exits"]["net"][t], t)               # çalışan_t - çalışan_{t-1} = giriş - çıkış
        # iş aramaya giriş: w1 (firması canlı) from_firm, w6 (firması öldü) firm_death, w10 ahır, o1 ve st1 işgücü dışından, nw1 yeni kişi
        self.assertEqual(b["inflow"], {"entrant": 1, "ahir": 1, "firm_death": 1, "from_firm": 1, "from_out": 2, "other": 0})
        # süreler: yeni 6 kişi (w1 w6 o1 st1 nw1 w10) 0 hafta; s_b 13 hafta sürüyor; s_a (4 hf) ve s_c (27 hf) bu hafta işe girdi
        self.assertEqual(b["spells"]["ongoing"], {"lt4": 6, "w4_12": 0, "w13_26": 1, "gt26": 0})
        self.assertEqual(b["spells"]["done"], {"lt4": 0, "w4_12": 1, "w13_26": 0, "gt26": 1})
        self.assertEqual(b["spells"]["censored"], 1)                  # yalnız s_b hafta 10'da yeniden kurulmuş durumdan gelir (başlangıcı bilinmiyor)
        self.assertIsNone(b["hires"]["stable4"])                      # henüz dört hafta geçmedi
        self.assertEqual(b["staffless_npc"], {"n": 2, "cash0": 1})    # n4 (kasa 0,5) ve n5; n6 org_owner'lı, ahır sayılmaz
        for k in ("vac", "mismatch", "inflow_reason", "wage_fail"):          # (M) alanlar ve satırsız wage_fail
            self.assertIsNone(b[k], k)
        self.assertEqual((b["hires"]["events"], b["hires"]["short"], b["exits"]["reason"]), (None, None, None))
        self.assertEqual(b["pf_death"], {})                                   # bu hafta oyuncu işletmesi ölmedi (n3 yerleşik): seyrek sözlük boş

    def test_first_week_nulls_diff_fields_only(self):
        blk, _ = labour.build(week10(), P_, None)
        self.assertEqual(set(blk), BLOCK_KEYS)
        for sec, k in (("hires", "net"), ("hires", "stable4"), ("exits", "net"), ("exits", "firm_death")):
            self.assertIsNone(blk[sec][k], (sec, k))
        for k in ("inflow", "pf_death"):
            self.assertIsNone(blk[k], k)
        self.assertIsNone(blk["spells"]["done"])
        self.assertEqual(blk["emp"]["by_type"], {"npc": 7, "player": 2, "dao": 1, "public": 3})   # stok alanlar yazılır
        self.assertEqual(blk["spells"]["ongoing"], {"lt4": 3, "w4_12": 0, "w13_26": 0, "gt26": 0})
        self.assertEqual(blk["spells"]["censored"], 3)                # ilk hafta: bütün süreler en az
        self.assertEqual(blk["staffless_npc"], {"n": 2, "cash0": 1})

    def test_skipped_week_rebuilds(self):
        """Aradaki hafta atlandıysa (durum 10, dünya 12) farka dayalı alanlar null; 13. haftada (durum 12) yine yazılır."""
        W12 = week11()
        W12.week_no = 12
        blk, st12 = labour.build(W12, P_, second_state())
        self.assertIsNone(blk["hires"]["net"])
        self.assertIsNone(blk["inflow"])
        self.assertEqual(st12.week, 12)
        W13 = week11()
        W13.week_no = 13
        blk, _ = labour.build(W13, P_, st12)
        self.assertEqual(blk["hires"]["net"], {t: 0 for t in TYPES})  # 12 -> 13: aynı dünya

    def test_firm_types_follow_holdings(self):
        """`firm_type` holdings'in işyeri sınıflamasıyla aynıdır (DAO ayrı)."""
        from oyun_server.sim import holdings
        W = week10()
        ctx = holdings.context(W)
        for f in W.firms:
            wp = holdings._workplace(ctx, {"firm": f})
            want = {"municipal": "public", "ahir": "public", "player": "player", "npc": "npc"}[wp]
            self.assertEqual(labour.firm_type(W, f), "dao" if W.firms[f]["kind"] == "arge" else want, f)
        self.assertIsNone(labour.firm_type(W, "yok"))

    def test_type_is_sticky(self):
        """Firma türü ilk görüldüğü haftaya bağlıdır: sahipsiz firma sonradan sahip bulsa da `npc` kalır, böylece kapanış bozulmaz."""
        _, st = labour.build(week10(), P_, None)
        self.assertEqual(st.ftype["n1"], "npc")
        W = week11()
        W.firms["n1"]["owner"] = "P9"
        _, st2 = labour.build(W, P_, st)
        self.assertEqual(st2.ftype["n1"], "npc")
        self.assertEqual(labour.firm_type(W, "n1"), "player")         # ham sınıflama yine güncel sahibi söyler

    def test_notes_cover_every_field(self):
        """Her alan NOTES'ta tanımlı; beş dünya alanının notu probes.FIELD_NOTES'ta."""
        blk, _ = labour.build(week10(), P_, None)
        for sec in ("emp", "hires", "exits", "spells"):
            for k in blk[sec]:
                self.assertIn(f"{sec}.{k}", labour.NOTES, f"{sec}.{k}")
        for k in ("vac", "mismatch", "staffless_npc", "wage_fail", "inflow", "inflow_reason", "pf_death", "types", "week"):
            self.assertTrue(k in labour.NOTES or any(n.startswith(k + ".") for n in labour.NOTES), k)
        for n in LABOUR_WORLD:
            self.assertIn(n, probes.FIELD_NOTES)
            self.assertGreater(len(probes.FIELD_NOTES[n]), 40)
        self.assertIn("TAHMİN", probes.FIELD_NOTES["unemployment_duration"])        # U19: ölçülen süre değil


class Spells(unittest.TestCase):
    def test_spell_buckets(self):
        """Sahte süreler 3, 4, 12, 13, 26, 27 hafta: kova sınırları <4, 4-12, 13-26, >26."""
        qs = {"a3": 3, "a4": 4, "a12": 12, "a13": 13, "a26": 26, "a27": 27}
        _, st = labour.build(world(20, {}, seekers=list(qs)), P_, None)
        st.start.update({q: 21 - d for q, d in qs.items()})
        blk, _ = labour.build(world(21, {}, seekers=list(qs)), P_, st)
        self.assertEqual(blk["spells"]["ongoing"], {"lt4": 1, "w4_12": 2, "w13_26": 2, "gt26": 1})
        self.assertEqual(blk["spells"]["long_share"], round(1 / 6, 4))

    def test_spells_total(self):
        """Sürmekte olan süre toplamı = iş arayan + havuz (aynı kişi iki listede ya da iki şehirde bir kez sayılır)."""
        W = week11()
        blk, _ = labour.build(W, P_, second_state())
        n = sum(len(c["seekers"]) + len(c["pool"]) for c in W.cities)
        self.assertEqual(sum(blk["spells"]["ongoing"].values()), n)
        self.assertEqual(sum(blk["inflow"].values()), n - 1)           # s_b hariç hepsi bu hafta girdi

    def test_long_share(self):
        _, st = labour.build(world(20, {}, seekers=["a", "b", "c", "d"]), P_, None)
        st.start.update({"a": 20 - 30, "b": 20 - 28, "c": 20 - 5, "d": 20 - 40})
        blk, _ = labour.build(world(21, {}, seekers=["a", "b", "c", "d"]), P_, st)
        self.assertEqual(blk["spells"]["ongoing"]["gt26"], 3)
        self.assertEqual(blk["spells"]["long_share"], 0.75)
        empty, _ = labour.build(world(21, {}), P_, None)
        self.assertIsNone(empty["spells"]["long_share"])               # iş arayan yok

    def test_spell_ends_when_leaving_labour_force(self):
        """İşgücü dışına çıkan kişinin süresi biter ama `done`a girmez; dönünce yeni süre sıfırdan başlar."""
        _, st = labour.build(world(20, {}, seekers=["a"]), P_, None)
        st.start["a"] = 5
        _, st = labour.build(world(21, {}, out=["a"]), P_, st)
        self.assertNotIn("a", st.start)
        blk, st = labour.build(world(22, {}, seekers=["a"]), P_, st)
        self.assertEqual(blk["spells"]["ongoing"]["lt4"], 1)
        self.assertEqual(blk["inflow"]["from_out"], 1)
        self.assertEqual(blk["spells"]["censored"], 0)                 # yeni süre başlangıcı biliniyor


class Stable4(unittest.TestCase):
    def test_stable4_lag(self):
        """Haftalık ardışık dünyalar: her hafta bir kişi n1'e girer. 4 hafta gecikme: ilk beş hafta null (yeniden kurma + dört hafta), sonra sayı; ayrılan sayılmaz."""
        st, out = None, []
        workers = []
        for wk in range(1, 9):
            workers.append(f"x{wk}")
            if wk == 7:
                workers.remove("x3")                                   # x3 (2. haftada girmişti) 7. haftada ayrılır
            blk, st = labour.build(world(wk, {"n1": dict(kind="un", workers=list(workers))}), P_, st)
            out.append(blk["hires"]["stable4"])
        self.assertEqual(out[:5], [None] * 5)
        # 6. hafta: 2. haftanın girişi (x2) hâlâ orada -> 1; 7. hafta: 3. haftanın girişi (x3) ayrılmıştı -> 0; 8. hafta: 4. haftanın girişi (x4) -> 1
        self.assertEqual(out[5:], [1, 0, 1])


class FirmDeath(unittest.TestCase):
    def test_firm_death_jobs(self):
        """Ölen firmanın önceki haftaki işçileri `exits.firm_death`'te; yeniden açılan firma canlıya döner (ölüm sayılmaz)."""
        w1 = world(5, {"a": dict(kind="un", workers=["x", "y"]), "b": dict(kind="un", workers=["z"], dead=True, died=3)})
        _, st = labour.build(w1, P_, None)
        w2 = world(6, {"a": dict(kind="un", workers=[], dead=True, died=6), "b": dict(kind="un", workers=["z"])}, seekers=["x"])
        w2.people["z"]["firm"] = "b"
        blk, _ = labour.build(w2, P_, st)
        self.assertEqual(blk["exits"]["firm_death"], {"npc": 2, "player": 0, "dao": 0, "public": 0})
        self.assertEqual(blk["exits"]["net"]["npc"], 2)
        self.assertEqual(blk["hires"]["net"]["npc"], 1)                # z: önceki hafta firması ölüydü, bu hafta çalışıyor
        self.assertEqual(blk["inflow"]["firm_death"], 1)               # x iş aramaya girdi: firması öldü


class PfDeath(unittest.TestCase):
    def deaths(self, founders, flows=(), lab=None):
        """`founders`: ad -> (kurucunun durumu, firma kasası, kurucu şehri). Önceki hafta firma canlı, bu hafta ölü; ölüm haftası 8."""
        firms7, firms8, seekers, cash = {}, {}, [], {}
        W7 = None
        employed = {}
        for f, (state, c, city) in founders.items():
            q = "P" + f
            firms7[f] = dict(kind="firin", owner=q, workers=[q], city=0)
            firms8[f] = dict(kind="firin", owner=q, workers=[], dead=True, died=8, city=0)
            cash[f] = c
            if state == "seek":
                seekers.append(q)
            elif state == "job":
                employed[q] = "host"
        firms7["host"] = dict(kind="un", workers=[])
        firms8["host"] = dict(kind="un", workers=list(employed))
        W7 = world(7, firms7, cash=cash)
        _, st = labour.build(W7, P_, None)
        W8 = world(8, firms8, seekers=seekers, cash=cash, lab=lab)
        for f, (state, c, city) in founders.items():
            W8.people["P" + f]["city"] = city
        for k, v in flows:
            W8.L.flows[k] = v
        st.flows = {"talep": 0.0, "marj": 0.0}
        if lab is not None:
            st.lab = {k: 0.0 for k in lab}
        return labour.build(W8, P_, st)[0]["pf_death"]

    def test_pf_death_cause(self):
        """Kurucu iş arıyor ve kasa < ücret (10) -> founder_wage; kurucu başka firmada -> founder_job; kurucu şehir değiştirdi -> founder_move; kalanlar: kasa < ücret `cash`,
        talep sayacı kadarı `no_buyer`, marj sayacı kadarı `cash`, geri kalan `other`."""
        pf = self.deaths({"a": ("seek", 3.0, 0), "b": ("job", 50.0, 0), "c": ("seek", 50.0, 1), "d": ("seek", 50.0, 0), "e": ("seek", 50.0, 0), "f": ("seek", 50.0, 0),
                          "g": ("seek", 50.0, 0)}, flows=[("olum_le3_talep", 1), ("olum_gt3_marj", 1)])
        # a: seek + kasa 3 < 10 -> founder_wage; b: başka işte -> founder_job; c: şehir değişti -> founder_move; d e f g: kasa yeterli, kurucu iş arıyor -> kalan 4:
        # talep 1 -> no_buyer 1; marj 1 -> cash 1; kalan 2 -> other
        self.assertEqual(pf, {"founder_wage": 1, "founder_job": 1, "founder_move": 1, "no_buyer": 1, "cash": 1, "other": 2})

    def test_pf_death_counts_deaths_born_and_died_same_week(self):
        """Kuruluş haftasında ölen firma önceki haftada hiç canlı değildi; yine de `pf_death`e girer."""
        W7 = world(7, {"host": dict(kind="un", workers=["x"])})
        _, st = labour.build(W7, P_, None)
        W8 = world(8, {"host": dict(kind="un", workers=[]), "new": dict(kind="firin", owner="Pq", workers=[], dead=True, died=8)}, seekers=["x", "Pq"])
        pf = labour.build(W8, P_, st)[0]["pf_death"]
        self.assertEqual(sum(pf.values()), 1)

    def test_pf_death_uses_model_founder_exit_counter(self):
        """(M) `kurucu_ucret_cikis` varsa founder_wage onunla belirlenir (kasa kuralı yerine)."""
        lab = {"kurucu_ucret_cikis": 1.0}
        pf = self.deaths({"a": ("seek", 50.0, 0), "b": ("seek", 50.0, 0)}, lab=lab)
        self.assertEqual(pf["founder_wage"], 1)
        self.assertEqual(pf["other"], 1)

    def test_dao_and_public_deaths_not_counted(self):
        W7 = world(7, {"d": dict(kind="arge", owner="Pq", workers=["Pq"])})
        _, st = labour.build(W7, P_, None)
        W8 = world(8, {"d": dict(kind="arge", owner="Pq", workers=[], dead=True, died=8)}, seekers=["Pq"])
        self.assertEqual(sum(labour.build(W8, P_, st)[0]["pf_death"].values()), 0)


class StafflessNpc(unittest.TestCase):
    def test_staffless_npc(self):
        """`issizlik-inceleme.md` tanımı: canlı, sahipsiz, `org_owner`sız, ahır ve belediye dışı, kadrosu boş. Sahibin 200 hf kaydındaki hf 200 değeri (162) kayıttan
        bağımsız yeniden hesaplanamaz; tanım bu sahte dünyayla kilitlenir. `cash0`: kasası < 1 Akçe."""
        W = week10()
        W.firms["n7"] = dict(kind="firin", city=0, workers=[], owner=None, dead=True, capacity=25)      # ölü: sayılmaz
        W.firms["p9"] = dict(kind="firin", city=0, workers=[], owner="Pz", dead=False, capacity=25)      # oyuncu işletmesi: sayılmaz
        W.firms["bel9"] = dict(kind="belediye", city=0, workers=[], owner=None, dead=False, capacity=25)
        blk, _ = labour.build(W, P_, None)
        self.assertEqual(blk["staffless_npc"], {"n": 2, "cash0": 1})
        W.firms["n1"]["workers"] = []                                   # n1 de boşalır
        self.assertEqual(labour.build(W, P_, None)[0]["staffless_npc"]["n"], 3)
        self.assertEqual(labour.world_facts(labour.build(W, P_, None)[0])["x_staffless_npc"], 3)


class ModelCounters(unittest.TestCase):
    def test_wage_fail_read(self):
        """`wage_fail` = `W.weekly[-1][\"wage_fail\"]` (yalnız o haftanın satırıysa); satır eskiyse ya da yoksa null."""
        W = week11(weekly=[{"week": 11, "wage_fail": 7}])
        self.assertEqual(labour.build(W, P_, second_state())[0]["wage_fail"], 7)
        W = week11(weekly=[{"week": 10, "wage_fail": 7}])
        self.assertIsNone(labour.build(W, P_, second_state())[0]["wage_fail"])
        self.assertIsNone(labour.build(week11(), P_, second_state())[0]["wage_fail"])
        self.assertEqual(labour.world_facts(labour.build(week11(weekly=[{"week": 11, "wage_fail": 7}]), P_, None)[0])["x_wage_fail"], 7)

    def test_M_fields_null_without_model_counters(self):
        blk, _ = labour.build(week11(), P_, second_state())
        self.assertIsNone(blk["vac"])
        self.assertIsNone(blk["mismatch"])
        self.assertIsNone(blk["hires"]["events"])
        self.assertIsNone(blk["hires"]["short"])
        self.assertIsNone(blk["exits"]["reason"])
        self.assertIsNone(blk["inflow_reason"])
        self.assertIsNone(labour.world_facts(blk)["x_vacancies"])

    def test_M_fields_with_fake_counters(self):
        """Sahte `W.lab_stat` (birikimli) ve `W.staff_tgt`: açık kadro, işe alım olayları, aynı hafta alınıp çıkanlar, çıkış nedenleri, uyumsuzluk."""
        prev_lab = {"ise_npc": 10.0, "ise_player": 1.0, "cikis_ucret_npc": 4.0}
        _, st = labour.build(week10(), P_, None)
        st.start.update({"s_a": 7, "s_b": -2, "s_c": -16})
        st.lab = dict(prev_lab)
        lab = {"ise_npc": 10 + 7, "ise_player": 1 + 1, "ise_public": 2, "cikis_ucret_npc": 4 + 3, "cikis_ucret_player": 1, "cikis_kuculme_npc": 2, "cikis_ayrilma_npc": 1,
               "cikis_ayrilma_public": 1, "cikis_olum_npc": 2, "cikis_gecis_npc": 1, "cikis_belediye_public": 1, "cikis_goc_npc": 1}
        # hedefler: n1 (şehir 0, 3 çalışan) 5 -> açık 2; n2 (şehir 0, 3 çalışan) 3 -> 0; pf1 (oyuncu, şehir 1) 7 -> açık 4 (şehir 1'e taşınmış); dao1 hedefi 2 (çalışan 1) -> açık 1 (oyuncu sayılır);
        # ölü n3 ve bilinmeyen firma sayılmaz
        W = week11(lab={}, tgt={"n1": 5, "n2": 3, "pf1": 7, "dao1": 2, "n3": 9, "yok": 4})
        W.firms["pf1"]["city"] = 1
        W.lab_stat = defaultdict(float, lab)
        blk, _ = labour.build(W, P_, st)
        self.assertEqual(blk["vac"]["npc"], 2)
        self.assertEqual(blk["vac"]["player"], 5)
        self.assertEqual(blk["vac"]["sectors"], {"firin": 4, "un": 2, "rest": 1})
        self.assertEqual(blk["vac"]["cities"], [3, 4])
        # iş arayan: şehir 0'da 5 kişi (w1 w6 o1 nw1 w10 + s_b = 6), şehir 1'de st1 = 1; toplam 7. açık: 3 ve 4 (A = 7)
        self.assertEqual(blk["mismatch"], round(0.5 * (abs(6 / 7 - 3 / 7) + abs(1 / 7 - 4 / 7)), 4))
        self.assertEqual(blk["hires"]["events"], {"npc": 7, "player": 1, "dao": 0, "public": 2})
        self.assertEqual(blk["hires"]["short"], {"npc": 7 - 4, "player": 1 - 1, "dao": 0, "public": 2 - 1})      # events - net
        r = blk["exits"]["reason"]
        self.assertEqual(r["wage"], {"npc": 3, "player": 1, "dao": 0, "public": 0})
        self.assertEqual((r["layoff"], r["quit"], r["firm_death"], r["switch"], r["muni"], r["other"]), (2, 2, 2, 1, 1, 1))     # layoff = küçültme (2) + DAO (0); other = göç (1) + eğitim (0) + diğer (0)
        self.assertEqual(blk["inflow_reason"], {"wage": 4, "layoff": 2, "quit": 2})
        self.assertEqual(labour.world_facts(blk)["x_vacancies"], 7)
        self.assertEqual(set(blk["exits"]["reason"]), {"wage", *labour.REASONS})

    def test_decreasing_cumulative_key_gives_null_not_zero(self):
        """T5 kararı: W.lab_stat birikimlidir; bir anahtar haftadan haftaya AZALIRSA ondan türeyen alan `max(0, ...)` ile bastırılmaz, null yazılır (öteki alanlar yazılır)."""
        def blk(lab_now, lab_prev):
            _, st = labour.build(week10(), P_, None)
            st.lab = dict(lab_prev)
            W = week11(lab={}, tgt={"n1": 5})
            W.lab_stat = defaultdict(float, lab_now)
            return labour.build(W, P_, st)[0]
        ok = blk({"ise_npc": 12.0, "cikis_ucret_npc": 6.0}, {"ise_npc": 10.0, "cikis_ucret_npc": 4.0})
        self.assertEqual(ok["hires"]["events"]["npc"], 2)
        self.assertEqual(ok["exits"]["reason"]["wage"]["npc"], 2)
        down_hire = blk({"ise_npc": 7.0, "cikis_ucret_npc": 6.0}, {"ise_npc": 10.0, "cikis_ucret_npc": 4.0})
        self.assertIsNone(down_hire["hires"]["events"])
        self.assertIsNone(down_hire["hires"]["short"])
        self.assertIsNotNone(down_hire["exits"]["reason"])                                   # çıkış anahtarları azalmadı
        down_exit = blk({"ise_npc": 12.0, "cikis_ucret_npc": 3.0}, {"ise_npc": 10.0, "cikis_ucret_npc": 4.0})
        self.assertIsNotNone(down_exit["hires"]["events"])
        self.assertIsNone(down_exit["exits"]["reason"])
        self.assertIsNone(down_exit["inflow_reason"])
        gone = blk({"ise_npc": 12.0}, {"ise_npc": 10.0, "cikis_ucret_npc": 4.0})             # anahtar kayboldu = azalma
        self.assertIsNone(gone["exits"]["reason"])

    def test_lab_type_stamp_wins_over_first_sighting(self):
        """Modelin `W.lab_type` damgası varsa tür oradan gelir ve firmanın sınıfı sonradan değişse de sabit kalır (özelleşme / medya satışı); yoksa ilk görülen sınıf."""
        W10, W11 = week10(), week11()
        for W in (W10, W11):
            W.lab_type = {"pf1": "npc", "n1": "player"}                                       # pf1 sahipli ama damga npc; n1 sahipsiz ama damga player
        blk10, st = labour.build(W10, P_, None)
        blk11, _ = labour.build(W11, P_, st)
        plain10, _ = labour.build(week10(), P_, None)
        self.assertEqual(blk10["emp"]["by_type"]["npc"], plain10["emp"]["by_type"]["npc"] + 2 - 3)      # pf1 (2 çalışan) npc'ye, n1 (3 çalışan) player'a
        self.assertEqual(blk10["emp"]["by_type"]["player"], plain10["emp"]["by_type"]["player"] - 2 + 3)
        self.assertEqual(st.ftype["pf1"], "npc")
        self.assertEqual(sum(blk11["hires"]["net"].values()), sum(labour.build(week11(), P_, second_state())[0]["hires"]["net"].values()))
        for t in TYPES:                                                                       # D kapanışı damgalı türle de tutar
            self.assertEqual(blk11["emp"]["by_type"][t] - blk10["emp"]["by_type"][t], blk11["hires"]["net"][t] - blk11["exits"]["net"][t], t)
        W11.firms["pf1"].pop("owner")                                                         # sınıf değişti, damga aynı
        W11.firms["pf1"]["owner"] = None
        blk11b, _ = labour.build(W11, P_, st)
        self.assertEqual(blk11b["emp"]["by_type"], blk11["emp"]["by_type"])

    def test_M_fields_null_on_first_week(self):
        """Birikimli sayaç farkı önceki hafta olmadan alınamaz: ilk hafta olay alanları null (açık kadro stoktur, yazılır)."""
        W = week11(lab={"ise_npc": 5.0}, tgt={"n1": 5})
        blk, _ = labour.build(W, P_, None)
        self.assertIsNone(blk["hires"]["events"])
        self.assertEqual(blk["vac"]["npc"], 2)

    def test_no_mismatch_without_vacancies(self):
        W = week11(tgt={"n1": 3})
        blk, _ = labour.build(W, P_, second_state())
        self.assertEqual(blk["vac"]["npc"], 0)
        self.assertIsNone(blk["mismatch"])


class Purity(unittest.TestCase):
    def test_does_not_mutate(self):
        W = week11(weekly=[{"week": 11, "wage_fail": 1}], lab={"ise_npc": 3.0}, tgt={"n1": 5})
        st = second_state()
        before = deep(W)
        st_before = deep({k: getattr(st, k) for k in labour.LabourState.__slots__})
        labour.build(W, P_, st)
        labour.build(W, P_, None)
        snapshot_equal(self, W, before, "labour.build")
        self.assertEqual({k: getattr(st, k) for k in labour.LabourState.__slots__}, st_before)    # eski durum da değişmez (yeni durum döner)

    def test_no_defaultdict_insert(self):
        """`W.lab_stat`, `L.flows`, `L.bal` gibi defaultdict'lere okuma anahtar eklemez."""
        W = week11(lab={"ise_npc": 3.0}, tgt={"n1": 5})
        W.L.flows.clear()
        n = (len(W.lab_stat), len(W.L.flows), len(W.L.bal))
        labour.build(W, P_, second_state())
        self.assertEqual((len(W.lab_stat), len(W.L.flows), len(W.L.bal)), n)

    def test_json_safe_and_no_ids(self):
        blk, _ = labour.build(week11(lab={"ise_npc": 1.0}, tgt={"n1": 5}), P_, second_state())
        text = json.dumps(blk, allow_nan=False)
        for name in ("w1", "w2", "n1", "n2", "pf1", "P1", "s_a", "ahir0", "bel0", "dao1"):
            self.assertNotIn(f'"{name}"', text, name)
        self.assertIsNone(ID_RE.search(text))


class Size(unittest.TestCase):
    def worst_world(self):
        """§3.6 en kötü sentetik: 9 şehir, 8 sektör + kalan, bütün sayaçlar 6 basamak, (M) alanların hepsi dolu."""
        kinds = [f"k{i:02d}" for i in range(14)]
        firms = {f"f{i}": dict(kind=kinds[i % 14], city=i % 9, workers=[f"w{i}_{j}" for j in range(3)]) for i in range(40)}
        firms["f0"]["owner"] = "P0"
        W = world(11, firms, n_cities=9, seekers={c: [f"s{c}_{j}" for j in range(3)] for c in range(9)})
        W.lab_stat = defaultdict(float)
        for t in TYPES:
            W.lab_stat["ise_" + t] = 123456.0
            W.lab_stat["cikis_ucret_" + t] = 123456.0
        for ads in labour.REASONS.values():
            for ad in ads:
                W.lab_stat[f"cikis_{ad}_npc"] = 123456.0
        W.staff_tgt = {f: 999999 for f in firms}
        W.weekly = [{"week": 11, "wage_fail": 999999}]
        return W

    def test_labour_size_worst_synthetic(self):
        W = self.worst_world()
        _, st = labour.build(W, P_, None)
        st.lab = {k: 0.0 for k in W.lab_stat}
        st.flows = {"talep": 0.0, "marj": 0.0}
        for q in list(st.start):
            st.start[q] = 11 - 40
        for i in range(8):
            st.net.append({})
        W.week_no = 12
        W.weekly = [{"week": 12, "wage_fail": 999999}]
        for k in list(W.lab_stat):
            W.lab_stat[k] += 123456.0
        for f in ("f0", "f1", "f2", "f3", "f4", "f5"):
            W.firms[f].update(dead=True, died=12, workers=[], owner="P" + f)
        W.L.flows["olum_le3_talep"] = 5
        st.week = 11
        blk, _ = labour.build(W, P_, st)
        worst = size(blk)
        self.assertLessEqual(worst, 1600, worst)
        self.assertEqual(set(blk), BLOCK_KEYS)
        self.assertIsNotNone(blk["exits"]["reason"])

    def test_labour_memory_10k_people(self):
        """Host belleği: durum eşlemeleri <= 5 MB (10.000 kişi; 1.500 işyeri, 2.500 iş arayan, 4 haftalık net giriş)."""
        firms = {f"f{i}": dict(kind="un", workers=[f"w{i}_{j}" for j in range(5)]) for i in range(1500)}
        seekers = [f"sk{i}" for i in range(2500)]
        W = world(11, firms, seekers=seekers)
        _, st = labour.build(W, P_, None)
        W.week_no = 12
        for f in list(firms)[:200]:                                    # 200 işyerinde kadro değişir (net giriş / çıkış)
            W.firms[f]["workers"] = [f"v{f}_{j}" for j in range(5)]
            for j in range(5):
                W.people[f"v{f}_{j}"] = dict(tier=0, wage=10, firm=f, who="npc", city=0)
        tracemalloc.start()
        try:
            base = tracemalloc.get_traced_memory()[0]
            for wk in range(12, 17):                                   # beş hafta: kuyruk dolar, eski durumlar atılır
                W.week_no = wk
                _, st = labour.build(W, P_, st)
            used = tracemalloc.get_traced_memory()[0] - base
        finally:
            tracemalloc.stop()
        self.assertLess(used, 5 * 1024 * 1024, used)
        self.assertGreater(len(st.emp), 7000)


class PacketCarriesLabour(unittest.TestCase):
    def test_make_packet_labour_optional(self):
        row = {"calisan": 1, "issiz": 1}
        self.assertNotIn("labour", make_packet("r", 1, 1, row))
        self.assertEqual(make_packet("r", 1, 1, row, labour={"emp": {}})["labour"], {"emp": {}})
        p = make_packet("r", 1, 1, row, holdings={"money": {}}, credit={"found": None}, housing={"stock": 1}, labour={"emp": {}})
        self.assertEqual((p["holdings"], p["credit"], p["housing"], p["labour"]), ({"money": {}}, {"found": None}, {"stock": 1}, {"emp": {}}))

    def test_world_fields_from_facts(self):
        w = extract_world({"x_vacancies": 12, "x_staffless_npc": 3, "x_wage_fail": 40, "x_unemp_long_share": 0.25, "x_hires_stable4": 9})
        self.assertEqual([w[k] for k in LABOUR_WORLD], [12, 3, 40, 0.25, 9])
        self.assertTrue(all(extract_world({})[k] is None for k in LABOUR_WORLD))
        self.assertEqual(labour.world_facts(None), {"x_" + k: None for k in LABOUR_WORLD})


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    WEEKS = 26
    OVERRIDES = {"varsayilan": {"KR_MEAS": 1}, "sahibin_tarifi": None}   # sahibin tarifi `setUpClass`ta çözülür (kayıt dosyasını okur); KR_MEAS=1: modelin davranışsız iş piyasası sayaçları (T5)
    runs: dict = {}

    @classmethod
    def setUpClass(cls):
        cls.OVERRIDES["sahibin_tarifi"] = {**owner_recipe_overrides(), "KR_MEAS": 1}
        for name, ov in cls.OVERRIDES.items():
            host = ModelHost(str(config.MODEL_ROOT), dict(ov), 200)
            try:
                weeks = []
                for _ in range(cls.WEEKS):
                    t0 = time.perf_counter()
                    row = host.step()
                    t_step = time.perf_counter() - t0
                    W = host._W
                    prev = host._labour_state
                    t1 = time.perf_counter()
                    labour.build(W, host._P, prev, row)
                    t_build = time.perf_counter() - t1
                    row = {**row, **host.facts()}
                    snap = host.snapshot()
                    weeks.append({
                        "row": row, "blk": snap["labour"], "t_step": t_step, "t_build": t_build,
                        # bağımsız kâhin: model listelerinden (firma `workers` listeleri, şehir listeleri); kodun kendi eşlemesi kullanılmaz
                        "emp": {q: f for f, d in W.firms.items() if not d.get("dead") for q in d["workers"]},
                        "seek": {q for c in W.cities for q in list(c["seekers"]) + list(c["pool"])},
                        "seek_n": sum(len(c["seekers"]) + len(c["pool"]) for c in W.cities),
                        "kind": {f: d["kind"] for f, d in W.firms.items()},
                        "weekly": dict(W.weekly[-1]) if W.weekly else None,
                        "week_no": W.week_no,
                        "pf_flow": float(W.L.flows.get("batan_oyuncu_firmasi_adet", 0.0)),
                        # bağımsız kâhin (M): firma listelerinden tür başına çalışan, modelin damgaladığı tür (`W.lab_type`) ve birikimli sayaç kopyası
                        "emp_t": emp_by_lab_type(W),
                        "lab": dict(W.lab_stat),
                        "tgt": dict(W.staff_tgt),
                        "dead_now": {f for f, d in W.firms.items() if d.get("dead") and d.get("died") == W.week_no},
                    })
                cls.runs[name] = {"weeks": weeks, "state": host._labour_state, "snap2": (host.snapshot()["labour"], host.snapshot()["labour"])}
            finally:
                host.close()

    def test_employment_closes(self):
        """(D) Her hafta ve tür için: çalışan_t - çalışan_{t-1} = hires.net - exits.net; toplam çalışan modelin `calisan` sütunuyla ve firma listeleriyle aynı."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                prev = None
                for i, w in enumerate(r["weeks"], 1):
                    b = w["blk"]
                    self.assertEqual(set(b), BLOCK_KEYS)
                    self.assertEqual(w["week_no"], i)
                    tot = sum(b["emp"]["by_type"].values())
                    self.assertEqual(tot, len(w["emp"]), (name, i))                  # kişi bazlı sayım = firma listeleri
                    self.assertEqual(tot, int(w["row"]["calisan"]), (name, i))
                    self.assertEqual(b["emp"]["private"], tot - b["emp"]["by_type"]["public"])
                    self.assertEqual(sum(b["emp"]["sectors"].values()), tot)
                    if prev is None:
                        self.assertIsNone(b["hires"]["net"])
                    else:
                        for t in TYPES:
                            self.assertEqual(b["emp"]["by_type"][t] - prev["emp"]["by_type"][t], b["hires"]["net"][t] - b["exits"]["net"][t], (name, i, t))
                        self.assertEqual(sum(b["hires"]["net"].values()), sum(1 for q, f in w["emp"].items() if prev_emp.get(q) != f), (name, i))
                        self.assertEqual(sum(b["exits"]["net"].values()), sum(1 for q, f in prev_emp.items() if w["emp"].get(q) != f), (name, i))
                        for t in TYPES:
                            self.assertLessEqual(b["exits"]["firm_death"][t], b["exits"]["net"][t])
                    prev, prev_emp = b, w["emp"]

    def test_inflow_closes(self):
        """Σ inflow = iş arayan + havuz girişleri (önceki hafta aramayan, bu hafta arayan); kök dağılımı negatif değil."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                prev = None
                got = 0
                for i, w in enumerate(r["weeks"], 1):
                    if prev is None:
                        self.assertIsNone(w["blk"]["inflow"])
                    else:
                        want = len(w["seek"] - prev["seek"])
                        self.assertEqual(sum(w["blk"]["inflow"].values()), want, (name, i))
                        self.assertTrue(all(v >= 0 for v in w["blk"]["inflow"].values()))
                        got += want
                    prev = w
                self.assertGreater(got, 0, name)

    def test_spells_total(self):
        """Sürmekte olan süre toplamı = iş arayan + havuz; bu hafta işe girenlerin süresi `done`da; ilk haftada hepsi `censored`."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                for i, w in enumerate(r["weeks"], 1):
                    sp = w["blk"]["spells"]
                    self.assertEqual(sum(sp["ongoing"].values()), len(w["seek"]), (name, i))
                    self.assertEqual(sum(sp["ongoing"].values()), int(w["row"]["x_players_seeking"] + w["row"]["x_npc_pool"]), (name, i))
                    if i == 1:
                        self.assertEqual(sp["censored"], len(w["seek"]))
                    else:
                        self.assertLessEqual(sum(sp["done"].values()), len(r["weeks"][i - 2]["seek"]))
                        self.assertEqual(sum(sp["done"].values()), len(r["weeks"][i - 2]["seek"] & set(w["emp"])), (name, i))
                    if len(w["seek"]):
                        self.assertAlmostEqual(sp["long_share"], sp["ongoing"]["gt26"] / len(w["seek"]), places=4)
                self.assertEqual(r["weeks"][-1]["blk"]["spells"]["ongoing"]["gt26"], 0)         # 26 haftada >26 hafta ölçülemez (en çok 25 hafta + sıfırdan başlama)

    def test_stable4_lag(self):
        for name, r in self.runs.items():
            with self.subTest(world=name):
                vals = [w["blk"]["hires"]["stable4"] for w in r["weeks"]]
                self.assertEqual(vals[:5], [None] * 5)
                self.assertTrue(all(isinstance(v, int) and v >= 0 for v in vals[5:]), vals)
                hires = [w["blk"]["hires"]["net"] for w in r["weeks"]]
                for i in range(5, len(vals)):
                    self.assertLessEqual(vals[i], sum(hires[i - 4].values()))

    def test_M_fields_filled(self):
        """T5: modelin sayaçları açıkken (M) alanlar dolu (ilk hafta hariç): açık kadro, olaylar, nedenler."""
        for name, r in self.runs.items():
            for i, w in enumerate(r["weeks"], 1):
                b = w["blk"]
                self.assertIsNotNone(b["vac"], (name, i))                     # açık kadro stoktur: ilk haftada da yazılır
                self.assertIsNotNone(w["row"]["x_vacancies"])
                if i == 1:
                    self.assertIsNone(b["hires"]["events"])
                    continue
                self.assertIsNotNone(b["hires"]["events"], (name, i))
                self.assertIsNotNone(b["hires"]["short"])
                self.assertIsNotNone(b["exits"]["reason"])
                self.assertIsNotNone(b["inflow_reason"])
            self.assertGreater(sum(w["blk"]["vac"]["npc"] for w in r["weeks"]), 0, name)

    def test_M_closure_per_type_real_model(self):
        """§8 (M): her hafta ve firma türü için Σ işe alım olayı - Σ çıkış olayı (bütün nedenler) = çalışan değişimi; model sayaçları bağımsız kâhinle (firma listeleri + W.lab_type) kapanır.
        Sunucu bloğu da aynı sayıları yazar; ücret çıkışı = modelin haftalık wage_fail'i; her tür için net giriş <= olay."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                prev = None
                ev_total = ex_total = 0
                for i, w in enumerate(r["weeks"], 1):
                    if prev is not None:
                        b = w["blk"]
                        hev = {t: w["lab"].get(f"ise_{t}", 0.0) - prev["lab"].get(f"ise_{t}", 0.0) for t in TYPES}
                        exv = {t: sum(w["lab"].get(f"cikis_{rr}_{t}", 0.0) - prev["lab"].get(f"cikis_{rr}_{t}", 0.0) for rr in LAB_REASONS_M) for t in TYPES}
                        for t in TYPES:
                            self.assertEqual(w["emp_t"][t] - prev["emp_t"][t], hev[t] - exv[t], (name, i, t))
                            self.assertEqual(b["hires"]["events"][t], int(hev[t]), (name, i, t))
                            self.assertGreaterEqual(b["hires"]["short"][t], 0, (name, i, t))
                            self.assertEqual(b["hires"]["short"][t], b["hires"]["events"][t] - b["hires"]["net"][t])
                        self.assertEqual(sum(b["exits"]["reason"]["wage"].values()), w["weekly"]["wage_fail"], (name, i))
                        self.assertEqual(b["wage_fail"], sum(b["exits"]["reason"]["wage"].values()))
                        tot_reason = sum(b["exits"]["reason"]["wage"].values()) + sum(v for k, v in b["exits"]["reason"].items() if k != "wage")
                        self.assertEqual(tot_reason, int(sum(exv.values())), (name, i))           # her çıkış tam bir nedende
                        ev_total += sum(hev.values())
                        ex_total += sum(exv.values())
                    prev = w
                self.assertGreater(ev_total, 0, name)
                self.assertGreater(ex_total, 0, name)

    def test_M_firm_death_matches(self):
        """(D) firma ölümüyle kaybedilen iş ile (M) ölüm çıkış olayları. Yerleşik işletme (`npc_die`) ölürken çalışanları listede durur: D = M. Oyuncu işletmesi ve DAO ise
        işçisi kalmayınca ölür (çıkışlar önce ücret / küçültme olarak sayılır): D, o türün çıkış olaylarının içindedir (D <= bütün nedenler), M ölüm yalnız temerrüt ölümleridir."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                prev = None
                for i, w in enumerate(r["weeks"], 1):
                    if prev is not None:
                        b = w["blk"]
                        m_death = {t: w["lab"].get(f"cikis_olum_{t}", 0.0) - prev["lab"].get(f"cikis_olum_{t}", 0.0) for t in TYPES}
                        self.assertEqual(b["exits"]["reason"]["firm_death"], int(sum(m_death.values())), (name, i))
                        self.assertEqual(b["exits"]["firm_death"]["npc"], int(m_death["npc"]), (name, i))
                        for t in TYPES:
                            all_ex = sum(w["lab"].get(f"cikis_{rr}_{t}", 0.0) - prev["lab"].get(f"cikis_{rr}_{t}", 0.0) for rr in LAB_REASONS_M)
                            self.assertLessEqual(b["exits"]["firm_death"][t], all_ex, (name, i, t))
                    prev = w

    def test_M_vacancies_match_oracle(self):
        """Açık kadro = Σ max(0, W.staff_tgt - çalışan), canlı firmalar, bağımsız kâhinle; DAO oyuncu tarafında."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                for i, w in enumerate(r["weeks"], 1):
                    vac = w["blk"]["vac"]
                    self.assertEqual(vac["npc"] + vac["player"], w["row"]["x_vacancies"])
                    self.assertEqual(sum(vac["cities"]), vac["npc"] + vac["player"])
                    self.assertGreaterEqual(vac["npc"], 0)
                    self.assertGreaterEqual(vac["player"], 0)
                    self.assertTrue(all(isinstance(v, (int, float)) for v in vac["cities"]))
                self.assertTrue(any(w["blk"]["mismatch"] is not None for w in r["weeks"]), name)

    def test_lab_stat_cumulative_real(self):
        for name, r in self.runs.items():
            prev = {}
            for w in r["weeks"]:
                for k, v in prev.items():
                    self.assertGreaterEqual(w["lab"].get(k, 0.0), v, (name, k))
                prev = w["lab"]

    def test_wage_fail_read(self):
        for name, r in self.runs.items():
            for i, w in enumerate(r["weeks"], 1):
                self.assertEqual(w["blk"]["wage_fail"], w["weekly"]["wage_fail"], (name, i))
                self.assertEqual(w["row"]["x_wage_fail"], w["weekly"]["wage_fail"])
            self.assertGreater(sum(w["blk"]["wage_fail"] for w in r["weeks"]), 0, name)       # döner kapının nedeni gerçekten ölçülüyor

    def test_world_fields_match_block(self):
        for name, r in self.runs.items():
            for w in r["weeks"]:
                wd = extract_world(w["row"])
                self.assertEqual(wd["staffless_npc"], w["blk"]["staffless_npc"]["n"])
                self.assertEqual(wd["wage_fail"], w["blk"]["wage_fail"])
                self.assertEqual(wd["unemp_long_share"], w["blk"]["spells"]["long_share"])
                self.assertEqual(wd["hires_stable4"], w["blk"]["hires"]["stable4"])

    def test_pf_death_counts_match_model(self):
        """Haftalık `pf_death` toplamı = modelin `batan_oyuncu_firmasi_adet` sayacının haftalık farkı (kuruluş haftasında ölenler dahil); ilk hafta null."""
        total = 0
        for name, r in self.runs.items():
            self.assertIsNone(r["weeks"][0]["blk"]["pf_death"])
            for i in range(1, len(r["weeks"])):
                got = sum(r["weeks"][i]["blk"]["pf_death"].values())
                self.assertEqual(got, round(r["weeks"][i]["pf_flow"] - r["weeks"][i - 1]["pf_flow"]), (name, i + 1))
                total += got
        # 26 haftada iki dünyada da oyuncu işletmesi ölümü yok (kurucu aday hunisi ilk haftalarda kapalı): toplam 0 olabilir; pozitif yol `PfDeath` sahte testlerindedir
        self.assertGreaterEqual(total, 0)

    def test_snapshot_idempotent(self):
        for name, r in self.runs.items():
            a, b = r["snap2"]
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(r["weeks"][-1]["blk"], sort_keys=True))

    def test_no_ids_real(self):
        for name, r in self.runs.items():
            for w in r["weeks"]:
                self.assertIsNone(ID_RE.search(json.dumps(w["blk"])))

    def test_labour_size_and_time(self):
        """§3.6: gerçek 26 hf ortalaması <= 1.100 bayt; hesap süresi <= hafta süresinin %2'si."""
        for name, r in self.runs.items():
            sizes = [size(w["blk"]) for w in r["weeks"]]
            self.assertLessEqual(sum(sizes) / len(sizes), 1100, (name, sizes))
            t_step = sum(w["t_step"] for w in r["weeks"])
            t_build = sum(w["t_build"] for w in r["weeks"])
            self.assertLessEqual(t_build, 0.02 * t_step, (name, t_build, t_step))

    def test_does_not_mutate_real(self):
        host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            for _ in range(3):
                host.step()
            host.snapshot()
            before = deep(host._W)
            st = host._labour_state
            labour.build(host._W, host._P, st)
            host.step()
            before = deep(host._W)
            labour.build(host._W, host._P, st)
            snapshot_equal(self, host._W, before, "labour.build (gerçek model)")
        finally:
            host.close()

    def test_firm_death_jobs_real(self):
        """`npc_die` ile öldürülen yerleşik işletmenin önceki haftaki işçileri `exits.firm_death.npc`'de (bağımsız kâhin: ölümden önceki firma listesi)."""
        host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            for _ in range(3):
                host.step()
                host.facts()
                host.snapshot()
            W = host._W
            f, d = next((f, d) for f, d in W.firms.items() if d["owner"] is None and not d.get("dead") and d["kind"] not in ("ahir", "belediye") and len(d["workers"]) >= 2)
            n = len(d["workers"])
            host._mods["simkit.firm_exit"].npc_die(W, f, d, W.cities[d["city"]])
            self.assertTrue(d["dead"])
            host.step()
            blk = host.snapshot()["labour"]
            self.assertGreaterEqual(blk["exits"]["firm_death"]["npc"], n)
        finally:
            host.close()

    def test_fork_rebuilds_state(self):
        """Yeni host (çatallanma / yeniden kurma) ve atlanan hafta: ilk yazılan haftada farka dayalı alanlar null, stok alanlar dolu; sonraki hafta fark yazılır."""
        host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            for _ in range(3):
                host.step()                                              # facts / snapshot çağrılmadı: durum yok
            host.facts()
            b3 = host.snapshot()["labour"]
            self.assertIsNone(b3["hires"]["net"])
            self.assertIsNone(b3["inflow"])
            self.assertEqual(b3["spells"]["censored"], sum(b3["spells"]["ongoing"].values()))
            self.assertGreater(sum(b3["emp"]["by_type"].values()), 0)
            host.step()
            host.facts()
            b4 = host.snapshot()["labour"]
            self.assertIsNotNone(b4["hires"]["net"])
            host.step()
            host.step()                                                  # 5. hafta atlandı (facts / snapshot çağrılmadı)
            host.facts()
            b6 = host.snapshot()["labour"]
            self.assertIsNone(b6["hires"]["net"])
            host.step()
            host.facts()
            self.assertIsNotNone(host.snapshot()["labour"]["hires"]["net"])
            host.revert_to({})                                           # parametre geri alma durumu bozmaz
            host.step()
            host.facts()
            self.assertIsNotNone(host.snapshot()["labour"]["hires"]["net"])
        finally:
            host.close()


class ErrorPath(unittest.TestCase):
    @unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
    def test_persistent_labour_error_prints_once_and_drops_only_labour(self):
        import contextlib
        import io
        orig, labour.build = labour.build, lambda *a, **k: 1 / 0
        buf = io.StringIO()
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            with contextlib.redirect_stderr(buf):
                from tests.test_holdings_para import stepped
                pk = stepped(h, 3, True)
        finally:
            labour.build = orig
            h.close()
        self.assertEqual(buf.getvalue().count("Traceback"), 1)
        for p in pk:
            self.assertNotIn("labour", p)
            self.assertIn("credit", p)
            self.assertIn("housing", p)
            self.assertIn("holdings", p)
            self.assertTrue(all(extract_world(p["row"])[k] is None for k in LABOUR_WORLD))


if __name__ == "__main__":
    unittest.main()
