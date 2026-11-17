"""PLAN-KREDI T2: `credit` bloğu (kredi red ve eleme nedenleri kaydı; arayüzde gösterilmez), farklı kurucu sayımı (U4) ve tanı eşiği (U14).

Sahte dünya testleri her zaman koşar; gerçek model testleri OYUN_QUICK ile atlanır (26 hafta ~16 sn)."""
from __future__ import annotations

import json
import unittest
from collections import defaultdict

from oyun_server import config
from oyun_server.sim import credit, probes
from oyun_server.sim.extract import extract_world, make_packet
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, snapshot_equal
from tests.test_holdings_para import holdings_world, size, stepped

JSON_SEP = (",", ":")


def credit_world(week: int = 5, **extra):
    """T1 sahte dünyası (lonca0 açık, lonca1 kapalı) + kredi kaydının okuduğu modelin yapıları. Hepsi gerçek modeldeki tür: defaultdict'ler eklemeyi yakalar."""
    W, P = holdings_world()
    P.LEV_K = 25.0
    W.LEV_ON = True
    W.week_no = week
    W.gate = defaultdict(int, {(0, "hafta_sehir"): 10, (25, "hafta_sehir"): 4, (0, "aday_son"): 7, (0, "oyuncu_toplam"): 100, (0, "kredi_yetersiz"): 3,
                               (0, "girdi_kit:un"): 2})
    W.chain = defaultdict(lambda: defaultdict(int))
    W.chain[(0, "un")].update({"sinyal_hafta": 9, "sinyal_esigi": 2, "girdi_kit": 3, "girdi:sut": 3, "sb_kitlik": 2, "sb_saglik": 1, "kuruldu": 1,
                               "kurucu_yok": 4, "kredi_yetersiz": 6})
    W.chain[(25, "ekmek")].update({"sinyal_hafta": 1, "cooldown": 5})
    W.cx_ref = defaultdict(int, {"yas": 8, "kar": 5, "gecikme": 1, "itibar": 0, "satilamayan": 2, "gecti": 3, "limit_kar_katı": 4, "havuz_yetmez": 6})
    W.young_stat = defaultdict(float, {"red": 2.0, "adet": 5.0, "hacim": 100.0})
    W.npc_log = [(3, 0, "un", "battı"), (4, 0, "un", "temerrut"), (5, 1, "firin", "canlandi"), (5, 1, "firin", "temerrut")]
    W.L.flows.update({"kredi_kurulus_adet": 5, "buyume_kredisi_adet": 2, "kredi_buyume_adet": 1, "kredi_genc_adet": 4, "kredi_arge_adet": 2,
                      "kredi_arge_kurulus_adet": 1, "temerrut_adet": 3, "temerrut_kayip_akce": 900.4, "batis_kayip_akce": 50,
                      "npc_batis_kayip_akce": 20, "dao_batis_kayip_akce": 10, "batan_oyuncu_firmasi_adet": 6, "batis_yas_le3": 2, "batis_yas_hafta": 40,
                      "olum_le3_girdi": 1, "olum_gt3_girdi": 2, "olum_le3_talep": 1, "olum_gt3_marj": 2, "olum_gt3_teknoloji_geride": 1,
                      "lonca_kapanis_adet": 1, "girisimci_lonca_kurulus_adet": 1, "lonca_kurulus_adet": 2, "npc_batis_adet": 3})
    for k, v in extra.items():
        setattr(W, k, v)
    return W, P


ROW = {"kredi_basvuru": 8.0, "kredi_ret": 6.0, "ret_havuz": 6.0, "ret_itibar": 0.0, "ret_nedeni": "firin:6", "tavan_orani_ort": 0.5567}


def leaves(d, path=""):
    for k, v in d.items():
        p = f"{path}.{k}" if path else k
        if isinstance(v, dict) and k not in ("kinds",):
            yield from leaves(v, p)
        else:
            yield p, v


def defaultdict_sizes(W):
    out = {}
    for name in ("gate", "chain", "cx_ref", "young_stat", "dep_tot"):
        out[name] = len(getattr(W, name))
    out["flows"], out["bal"] = len(W.L.flows), len(W.L.bal)
    out["chain_inner"] = {k: len(v) for k, v in W.chain.items()}
    return out


class Founders(unittest.TestCase):
    def test_arithmetic(self):
        self.assertEqual(credit.founders({"kredi_basvuru": 8, "kredi_ret": 6}, 6), (3, 1))       # 2 verilen + 1 farklı reddedilen kurucu
        self.assertEqual(credit.founders({"kredi_basvuru": "8.0", "kredi_ret": "0.0"}, 6), (8, 0))
        self.assertEqual(credit.founders({"kredi_basvuru": 12.0, "kredi_ret": 12.0}, 6), (2, 2))
        self.assertEqual(credit.founders({"kredi_basvuru": 8, "kredi_ret": 4}, 6), (None, None))  # lonca sayısına bölünmüyor
        self.assertEqual(credit.founders({"kredi_basvuru": 3, "kredi_ret": 6}, 6), (None, None))  # ret > deneme: tutarsız
        self.assertEqual(credit.founders({"kredi_basvuru": 0, "kredi_ret": 0}, 6), (0, 0))
        self.assertEqual(credit.founders({"kredi_basvuru": 6, "kredi_ret": 6}, 0), (None, None))
        self.assertEqual(credit.founders({"kredi_basvuru": None, "kredi_ret": 0}, 6), (None, None))
        self.assertEqual(credit.founders({}, 6), (None, None))
        self.assertEqual(credit.founders(None, 6), (None, None))

    def test_probe_facts(self):
        W, P = credit_world()
        W.loncas = ["a", "b", "c", "d", "e", "f"]
        f = probes.credit_facts(W, P, ROW)
        self.assertEqual((f["x_founders_applied"], f["x_founders_rejected"]), (3, 1))
        f = probes.credit_facts(W, P, None)
        self.assertEqual((f["x_founders_applied"], f["x_founders_rejected"]), (None, None))
        self.assertEqual(set(f), {"x_" + n for n in ("founders_applied", "founders_rejected", "failed_player_cum", "failed_dao_cum", "failed_npc_default_cum")})   # T3: ölüm sayıları

    def test_world_fields_and_notes(self):
        w = extract_world({"kredi_basvuru": 8, "kredi_ret": 6, "x_founders_applied": 3, "x_founders_rejected": 1})
        self.assertEqual((w["founders_applied"], w["founders_rejected"]), (3, 1))
        self.assertEqual((w["loans_applied"], w["loans_rejected"]), (8, 6))              # eski anlam (deneme sayısı) değişmez
        self.assertIsNone(extract_world({})["founders_applied"])
        for n in ("founders_applied", "founders_rejected"):
            self.assertIn(n, probes.FIELD_NOTES)


class Block(unittest.TestCase):
    def test_first_week_null_then_weekly(self):
        W, P = credit_world()
        first = credit.build(W, P, ROW, None)
        flat = dict(leaves(first))
        self.assertIsNone(flat["gate.cand.cities"])
        self.assertIsNone(flat["chan.found"])
        self.assertIsNone(flat["deaths.cause.girdi"])
        self.assertIsNone(flat["lonca.founded"])
        self.assertEqual(flat["found.tries"], 8)                                         # satırdan: ilk haftada da var
        self.assertEqual((flat["found.founders"], flat["found.founders_rej"]), (5, 3))                  # 2 lonca: ret 6 = 3 farklı kurucu x 2 tur; 2 verilen + 3
        self.assertIsNotNone(flat["lonca.lendable"])                                     # stok: ilk haftada da var
        prev = credit.totals(W, P)
        W.week_no += 1
        W.L.flows["kredi_kurulus_adet"] += 2
        W.gate[(25, "hafta_sehir")] += 3
        second = dict(leaves(credit.build(W, P, ROW, prev)))
        self.assertEqual((second["chan.found"], second["gate.cand.cities"], second["chan.growth"]), (2, 3, 0))

    def test_gap_in_weeks_gives_null(self):
        W, P = credit_world()
        prev = credit.totals(W, P)
        W.week_no += 2                                                                   # arada bir hafta atlandı (anlık görüntü alınmadı)
        W.L.flows["kredi_kurulus_adet"] += 2
        self.assertIsNone(dict(leaves(credit.build(W, P, ROW, prev)))["chan.found"])

    def test_deltas_sum(self):
        W, P = credit_world(week=1)
        base = prev = credit.totals(W, P)
        total = defaultdict(int)
        for w in range(2, 12):
            W.week_no = w
            W.L.flows["kredi_kurulus_adet"] += w % 3
            W.L.flows["temerrut_kayip_akce"] += 100.3 * w
            W.L.flows["olum_gt3_girdi"] += w % 2
            W.chain[(0, "un")]["sb_kitlik"] += w % 4
            W.chain[(50, "un")]["sinyal_hafta"] += 1                                     # yeni kova doğdu
            W.gate[(50, "aday_son")] += w
            W.cx_ref["yas"] += 2
            W.npc_log.append((w, 0, "un", "temerrut"))
            cur = credit.totals(W, P)
            for p, v in leaves(credit.build(W, P, ROW, prev, cur)):
                if p.startswith(("found", "lonca.lendable", "lonca.insolvent", "lonca.dep_", "lonca.closed_insolv", "lonca.insolv_wait")):
                    continue                                                             # satır / stok / yeni modele özgü alanlar
                self.assertIsNotNone(v, p)
                total[p] += v
            prev = cur
        for p, v in total.items():
            exact = cur[p] - base[p]
            self.assertAlmostEqual(v, exact, delta=0.5 * 10 + 1e-9, msg=p)                # her haftanın yuvarlaması <= 0,5 Akçe
            if p not in ("loss.default_loss",):
                self.assertEqual(v, round(exact), p)
        self.assertGreater(total["gate.prod.board"], 0)
        self.assertEqual(total["deaths.npc_default"], 10)

    def test_shape_and_values(self):
        W, P = credit_world()
        prev = credit.totals(W, P)
        W.week_no += 1
        W.L.flows["kredi_arge_kurulus_adet"] += 1
        W.L.flows["olum_le3_teknoloji_geride"] += 1
        b = credit.build(W, P, ROW, prev)
        self.assertEqual(set(b), {"found", "gate", "firm", "chan", "loss", "deaths", "lonca"})
        self.assertEqual(set(b["found"]), {"tries", "rej", "granted", "founders", "founders_rej", "why", "kinds", "cover"})
        self.assertEqual(set(b["gate"]), {"cand", "prod"})
        self.assertEqual(set(b["gate"]["cand"]), set(credit.CAND))
        self.assertEqual(set(b["gate"]["prod"]), set(credit.PROD) | {"board"})
        self.assertEqual(set(b["firm"]), set(credit.FIRM))
        self.assertEqual(set(b["chan"]), set(credit.CHAN) | {"young_rej"})
        self.assertEqual(set(b["loss"]), set(credit.LOSS))
        self.assertEqual(set(b["deaths"]), set(credit.DEATHS) | {"cause", "npc_default"})
        self.assertEqual(set(b["deaths"]["cause"]), set(credit.CAUSE))
        self.assertEqual(set(b["lonca"]), {"lendable", "insolvent", "dep_lendable", "dep_insolvent", "dep_top_share", "moved", "founded", "refounded", "closed",
                                           "closed_insolv", "insolv_wait"})
        self.assertEqual(b["chan"]["rnd"], 1)                                            # Ar-Ge kuruluş kredisi Ar-Ge kanalına girer
        self.assertEqual(b["deaths"]["cause"]["tekno"], 1)
        json.dumps(b, allow_nan=False)

    def test_found_block_six_lonca(self):
        W, P = credit_world()
        W.loncas = ["l%d" % i for i in range(6)]
        W.closed = set()
        for lo in W.loncas:
            W.dep_tot.setdefault(lo, 0.0)
        f = credit.build(W, P, ROW, None)["found"]
        self.assertEqual(f, {"tries": 8, "rej": 6, "granted": 2, "founders": 3, "founders_rej": 1, "why": {"pool": 1, "rep": 0}, "kinds": {"firin": 1}, "cover": 0.557})
        row = {**ROW, "kredi_ret": 12.0, "kredi_basvuru": 14.0, "ret_havuz": 6.0, "ret_itibar": 6.0, "ret_nedeni": "firin:6;un:6"}
        f = credit.build(W, P, row, None)["found"]
        self.assertEqual((f["rej"], f["founders"], f["founders_rej"], f["why"], f["kinds"]), (12, 4, 2, {"pool": 1, "rep": 1}, {"firin": 1, "un": 1}))
        odd = credit.build(W, P, {**ROW, "kredi_ret": 4.0}, None)["found"]                # bölünmez: farklı kurucu düzeyi null, ham sayılar kalır
        self.assertEqual((odd["rej"], odd["founders"], odd["founders_rej"], odd["why"], odd["kinds"]), (4, None, None, None, None))
        none = credit.build(W, P, {"kredi_basvuru": 0.0, "kredi_ret": 0.0, "ret_nedeni": "", "tavan_orani_ort": 0.0}, None)["found"]
        self.assertEqual((none["tries"], none["founders"], none["founders_rej"], none["cover"], none["kinds"]), (0, 0, 0, None, {}))
        self.assertIsNone(credit.build(W, P, None, None)["found"])

    def test_old_model_tolerant(self):
        """`mevduat_tasima` akışı ve `W.lo_stat` yoksa (T5-T7 öncesi model): taşınan 0, batık kapanış / bekleme null; öbür alanlar eskisi gibi."""
        W, P = credit_world()
        self.assertFalse(hasattr(W, "lo_stat"))
        prev = credit.totals(W, P)
        W.week_no += 1
        b = credit.build(W, P, ROW, prev)
        self.assertEqual(b["lonca"]["moved"], 0)
        self.assertIsNone(b["lonca"]["closed_insolv"])
        self.assertIsNone(b["lonca"]["insolv_wait"])
        W.lo_stat = defaultdict(float, {"kapanis_batik": 2.0, "batik_bekleme_hafta": 5.0})
        prev = credit.totals(W, P)
        W.week_no += 1
        W.lo_stat["kapanis_batik"] += 1
        W.L.flows["mevduat_tasima"] += 321.4
        b = credit.build(W, P, ROW, prev)
        self.assertEqual((b["lonca"]["closed_insolv"], b["lonca"]["insolv_wait"], b["lonca"]["moved"]), (1, 0, 321))

    def test_missing_model_structures_do_not_crash(self):
        from tests.extract_v2_helpers import fake_world, params_ns
        W = fake_world(1)                                                                # gate, chain, cx_ref, young_stat, npc_log, mortgages, LEV_ON yok
        b = credit.build(W, params_ns(), None, None)
        self.assertEqual(b["lonca"]["lendable"], 0)
        self.assertIsNone(b["lonca"]["dep_top_share"])
        self.assertEqual(b["gate"]["cand"]["cities"], None)
        json.dumps(b, allow_nan=False)

    def test_notes_cover_every_field(self):
        W, P = credit_world()
        W.lo_stat = defaultdict(float)
        for p, _ in leaves(credit.build(W, P, ROW, None)):
            top = p.split(".")
            group = ".".join(top[:2]) if top[0] == "gate" else top[0]
            self.assertIn(group, credit.NOTES, p)
            leaf = top[-1]
            self.assertIn("`%s`" % leaf, credit.NOTES[group], p)
        self.assertTrue(all(isinstance(v, str) and v.strip() for v in credit.NOTES.values()))
        self.assertEqual(set(credit.NOTES), {"found", "gate.cand", "gate.prod", "firm", "chan", "loss", "deaths", "lonca"})


class LoncaClasses(unittest.TestCase):
    def test_by_hand(self):
        W, P = credit_world()
        W.loncas = ["a", "b", "c", "d"]
        W.closed = {"d"}
        W.loans = {"f1": dict(lo="a", out=100.0), "f2": dict(lo="b", out=100.0)}
        W.mortgages = [dict(lo="a", out=50.0)]
        W.bonds = [dict(lo="a", city=0, out=10.0), dict(lo="c", city=0, out=500.0)]
        W.dep_tot = defaultdict(float, {"a": 20.0, "b": 400.0, "c": 100.0, "d": 0.0})
        W.L.bal.update({"a_sermaye": 100.0, "b_sermaye": 100.0, "c_sermaye": 10.0, "d_sermaye": 500.0})
        # a: öz kaynak 100 + 150 + 10 - 20 = 240, h = 25 x 240 - 150 = 5850 > 0 -> verebilen
        # b: 100 + 100 - 400 = -200 -> batık
        # c: 10 + 0 + 500 - 100 = 410, kredi 0 -> verebilen
        # d: kapalı -> ara (öz kaynak 500 > 0 ama kapalı)
        cl = credit.lonca_classes(W, P)
        self.assertEqual(cl, {"lendable": ["a", "c"], "insolvent": ["b"], "middle": ["d"]})
        P.LEV_K = 0.5                                                                    # h = 0,5 x 240 - 150 < 0: a artık verebilen değil (ara); c: h = 205 > 0
        self.assertEqual(credit.lonca_classes(W, P), {"lendable": ["c"], "insolvent": ["b"], "middle": ["a", "d"]})
        W.LEV_ON = False                                                                 # kaldıraç kapalı: yalnız öz kaynak > 0 ve açık olmak
        self.assertEqual(credit.lonca_classes(W, P), {"lendable": ["a", "c"], "insolvent": ["b"], "middle": ["d"]})
        W.dep_tot["c"] = 510.0                                                           # c: öz kaynak = 0 -> ne verebilen ne batık
        self.assertEqual(credit.lonca_classes(W, P)["middle"], ["c", "d"])

    def test_block_stocks(self):
        W, P = credit_world()
        W.loncas = ["a", "b"]
        W.closed = set()
        W.loans, W.mortgages, W.bonds = {}, [], []
        W.dep_tot = defaultdict(float, {"a": 300.0, "b": 100.0})
        W.L.bal.update({"a_sermaye": 1000.0, "b_sermaye": 10.0})
        lo = credit.build(W, P, ROW, None)["lonca"]
        self.assertEqual((lo["lendable"], lo["insolvent"], lo["dep_lendable"], lo["dep_insolvent"], lo["dep_top_share"]), (1, 1, 300, 100, 0.75))


class Purity(unittest.TestCase):
    def test_does_not_mutate(self):
        W, P = credit_world()
        before = deep(W)
        prev = credit.totals(W, P)
        credit.build(W, P, ROW, prev)
        credit.build(W, P, ROW, None)
        credit.lonca_classes(W, P)
        credit.founders(ROW, 6)
        probes.credit_facts(W, P, ROW)
        snapshot_equal(self, W, before, "credit.build")

    def test_no_defaultdict_insert(self):
        W, P = credit_world()
        W.lo_stat = defaultdict(float)
        W.mortgages = []
        before = defaultdict_sizes(W)
        lo_stat_before = len(W.lo_stat)
        prev = credit.totals(W, P)
        credit.build(W, P, ROW, prev)
        credit.lonca_classes(W, P)
        self.assertEqual(defaultdict_sizes(W), before)
        self.assertEqual(len(W.lo_stat), lo_stat_before)


class Size(unittest.TestCase):
    def test_worst_case_synthetic(self):
        """Sentetik en kötü: bütün sayaçlar 7 basamak, 6 ret türü, 6 lonca, ondalıklı oranlar."""
        W, P = credit_world(week=9999)
        W.loncas = ["l%d" % i for i in range(6)]
        W.closed = set()
        for lo in W.loncas:
            W.dep_tot[lo] = 123456.0 + 1000 * len(lo)
        W.lo_stat = defaultdict(float)
        prev = credit.totals(W, P)
        W.week_no += 1
        for k in list(W.L.flows):
            W.L.flows[k] += 1234567.0
        for k in list(W.gate):
            W.gate[k] += 1234567
        for d in W.chain.values():
            for k in d:
                d[k] += 1234567
        for k in W.cx_ref:
            W.cx_ref[k] += 1234567
        for k in ("mevduat_tasima", "mevduat_kaybi_akce", "haciz_adet", "npc_kopru_kredisi_adet", "kredi_konut_adet", "kredi_yatirim_adet", "kredi_yenileme_adet",
                  "kredi_medya_adet", "kredi_ozellestirme_adet", "npc_canlandirma_adet", "batan_dao_adet"):
            W.L.flows[k] += 1234567.0
        W.lo_stat["kapanis_batik"] += 1234567
        W.lo_stat["batik_bekleme_hafta"] += 1234567
        row = {"kredi_basvuru": 36.0, "kredi_ret": 36.0, "ret_havuz": 30.0, "ret_itibar": 6.0,
               "ret_nedeni": ";".join(f"{k}:6" for k in ("firin", "un", "ekmek", "demir", "kumas", "arge")), "tavan_orani_ort": 0.5567}
        worst = len(json.dumps(credit.build(W, P, row, prev), separators=JSON_SEP, ensure_ascii=False).encode("utf-8"))
        self.assertLessEqual(worst, 1800, worst)


class PacketCarriesCredit(unittest.TestCase):
    def test_make_packet_credit_optional(self):
        row = {"calisan": 1, "issiz": 1}
        self.assertNotIn("credit", make_packet("r", 1, 1, row))
        self.assertEqual(make_packet("r", 1, 1, row, credit={"found": None})["credit"], {"found": None})
        self.assertEqual(make_packet("r", 1, 1, row, holdings={"money": {}}, credit={"found": None})["holdings"], {"money": {}})


# ---------------------------------------------------------------- gerçek model

@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    WEEKS = 26

    @classmethod
    def setUpClass(cls):
        cls.host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        cls.packets, cls.totals = [], []
        for _ in range(cls.WEEKS):
            cls.packets += stepped(cls.host, 1, True)
            cls.totals.append(dict(cls.host._credit_prev))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_first_week_null(self):
        first = dict(leaves(self.packets[0]["credit"]))
        for p, v in first.items():
            if p.startswith(("gate", "firm", "chan", "loss", "deaths")) or p in ("lonca.moved", "lonca.founded", "lonca.closed"):
                self.assertIsNone(v, p)
        self.assertIsNotNone(first["found.tries"])
        second = dict(leaves(self.packets[1]["credit"]))
        self.assertIsNotNone(second["gate.cand.cities"])
        self.assertIsNotNone(second["chan.found"])

    def test_snapshot_idempotent(self):
        h = self.host
        a, b = h.snapshot(), h.snapshot()
        self.assertEqual(json.dumps(a["credit"], sort_keys=True), json.dumps(b["credit"], sort_keys=True))
        self.assertEqual(json.dumps(a["credit"], sort_keys=True), json.dumps(self.packets[-1]["credit"], sort_keys=True))
        self.assertEqual(h._credit_prev, self.totals[-1])
        self.assertEqual(h.facts(), h.facts())

    def test_deltas_sum(self):
        """Haftalık farkların toplamı = birikimli sayaç (ilk hafta tabana alınır, M7)."""
        total = defaultdict(float)
        for p in self.packets[1:]:
            for path, v in leaves(p["credit"]):
                if path.startswith(("gate", "firm", "chan", "loss", "deaths")) or path in ("lonca.moved", "lonca.founded", "lonca.refounded", "lonca.closed"):
                    self.assertIsNotNone(v, path)
                    total[path] += v
        base, last = self.totals[0], self.totals[-1]
        self.assertGreater(sum(total.values()), 0)
        for path, v in total.items():
            self.assertAlmostEqual(v, last[path] - base[path], delta=0.5 * self.WEEKS + 1e-9, msg=path)
            if path not in ("loss.default_loss", "loss.exit_loss", "loss.npc_loss", "loss.dep_loss", "lonca.moved"):
                self.assertEqual(v, round(last[path] - base[path]), path)

    def test_founders_bound(self):
        """Bağımsız sınır: haftalık farklı kurucu (verilen + reddedilen) <= o haftanın kurucu adayı sayısı (`gate.cand.cands`)."""
        seen = 0
        for w, p in enumerate(self.packets[1:], 2):
            c = p["credit"]
            if c["found"]["founders"] is not None:
                seen += 1
                self.assertLessEqual(c["found"]["founders"], c["gate"]["cand"]["cands"], f"hafta {w}")
                self.assertEqual(c["found"]["founders"], c["found"]["granted"] + c["found"]["founders_rej"])
        self.assertGreater(seen, 0)

    def test_world_fields_follow_block(self):
        for p in self.packets:
            world = extract_world(p["row"])
            self.assertEqual(world["founders_applied"], p["credit"]["found"]["founders"])
            self.assertEqual(world["founders_rejected"], p["credit"]["found"]["founders_rej"])

    def test_lonca_classes_match_model(self):
        """Sınıflar modelin KENDİ `credit_core.lo_equity` / `lo_credit` işlevleriyle (gerçek dünya) aynı; mevduat artırılarak batık lonca da sınanır."""
        W, P = self.host._W, self.host._P
        cc = self.host._mods["simkit.credit_core"]

        def model_classes():
            out = {"lendable": [], "insolvent": [], "middle": []}
            for lo in W.loncas:
                eq = cc.lo_equity(W, lo)
                h = P.LEV_K * eq - cc.lo_credit(W, lo) if W.LEV_ON else 1.0
                if eq < 0:
                    out["insolvent"].append(lo)
                elif lo not in W.closed and eq > 0 and h > 0:
                    out["lendable"].append(lo)
                else:
                    out["middle"].append(lo)
            return out
        self.assertEqual(credit.lonca_classes(W, P), model_classes())
        self.assertTrue(credit.lonca_classes(W, P)["lendable"])                            # sınama boş değil
        lo0 = W.loncas[0]
        old = W.dep_tot[lo0]
        W.dep_tot[lo0] = old + 1e7
        try:
            self.assertEqual(credit.lonca_classes(W, P), model_classes())
            self.assertIn(lo0, credit.lonca_classes(W, P)["insolvent"])
        finally:
            W.dep_tot[lo0] = old
        lev = W.LEV_ON
        W.LEV_ON = False
        try:
            self.assertEqual(credit.lonca_classes(W, P), model_classes())
        finally:
            W.LEV_ON = lev
        lo = self.packets[-1]["credit"]["lonca"]
        self.assertEqual((lo["lendable"], lo["insolvent"]), (len(credit.lonca_classes(W, P)["lendable"]), len(credit.lonca_classes(W, P)["insolvent"])))

    def test_credit_size(self):
        sizes = [size(p["credit"]) for p in self.packets]
        self.assertLessEqual(sum(sizes) / len(sizes), 1150, sizes)
        self.assertLessEqual(max(sizes), 1800, sizes)

    def test_json_safe_and_no_person_ids(self):
        for p in self.packets:
            s = json.dumps(p["credit"], allow_nan=False)
            self.assertNotRegex(s, r"s\d+_p\d+")


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class FoundersOracle(unittest.TestCase):
    def test_founders_oracle(self):
        """U4 kâhini: `week_people.working_capital` sarılır; kuruluş denemesinin firma adı (`extra_workers=1` ile çağrılan, çalışansız yeni firma) kaydedilir.
        Reddedilen deneme firmayı siler: o haftanın denemelerinden hafta sonunda `W.firms`ta olmayan adlar = farklı reddedilen kurucu. Karşılaştırılan
        `credit.founders` (ret / lonca sayısı) bu sayımla birebir aynı olmalı. FOUND_BUF yüksek: gerçek ret üretmek için (varsayılan dünyada 26 haftada ret yok; v13.3 dünyasında 40 yetmiyor, 70 karma hafta verir: ret ve kabul)."""
        h = ModelHost(str(config.MODEL_ROOT), {"FOUND_BUF": 70}, 200)
        try:
            mod = h._mods["simkit.week_people"]
            W = h._W
            orig = mod.working_capital
            attempts: list[str] = []

            def spy(W_, firms, people, fname, *a, **kw):
                d = firms.get(fname)
                if kw.get("extra_workers") == 1 and d is not None and not d["workers"] and d.get("born") == W_.week_no and d.get("capitalized"):
                    attempts.append(fname)
                return orig(W_, firms, people, fname, *a, **kw)
            mod.working_capital = spy
            rejected_weeks = mixed = 0
            for w in range(26):
                attempts.clear()
                row = h.step()
                names = set(attempts)
                rej_names = {n for n in names if n not in W.firms}
                app, rej = credit.founders(row, len(W.loncas))
                self.assertEqual((app, rej), (len(names), len(rej_names)), f"hafta {w + 1}: {row['kredi_basvuru']}/{row['kredi_ret']}")
                rejected_weeks += bool(rej_names)
                mixed += bool(rej_names) and len(names) > len(rej_names)
                self.assertEqual(h.facts()["x_founders_rejected"], len(rej_names))
            self.assertGreater(rejected_weeks, 0, "sınama boş: hiç ret olmadı")
        finally:
            h.close()


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class ErrorPath(unittest.TestCase):
    def test_persistent_credit_error_prints_once_and_drops_only_credit(self):
        import contextlib
        import io
        orig, credit.build = credit.build, lambda *a, **k: 1 / 0
        buf = io.StringIO()
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            with contextlib.redirect_stderr(buf):
                pk = stepped(h, 3, True)
        finally:
            credit.build = orig
            h.close()
        self.assertEqual(buf.getvalue().count("Traceback"), 1)
        for p in pk:
            self.assertNotIn("credit", p)
            self.assertIn("holdings", p)                                              # öbür bloklar düşmedi
            self.assertIsNotNone(p["row"]["x_founders_applied"] if p["row"]["kredi_ret"] == 0 else 0)


if __name__ == "__main__":
    unittest.main()
