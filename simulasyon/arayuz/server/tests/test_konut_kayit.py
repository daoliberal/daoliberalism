"""PLAN-KREDI T4: `housing` bloğu (ev sahipleri, konut birimleri, kira paylaşımı; arayüzde gösterilmez).

Sahte dünya testleri her zaman koşar; gerçek model testleri OYUN_QUICK ile atlanır (26 hafta, iki dünya)."""
from __future__ import annotations

import json
import unittest
from collections import defaultdict

from oyun_server import config
from oyun_server.sim import housing_rec
from oyun_server.sim.extract import make_packet
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, params_ns, snapshot_equal
from tests.test_holdings_para import holdings_world, owner_recipe_overrides, size, stepped

SHAPE = set(housing_rec.FIELDS)


def housing_world(week: int = 5):
    """T1 sahte dünyası + konut: iki şehir; 0: oyuncu p0 (2), p1 (1), lonca0 havuzu (1, haciz), 5 stok birimi (1 boş); 1: oyuncu s1_p2 (1) + p0 (1, ikinci şehir)."""
    W, P = holdings_world()
    P.HOUSE_ON = True
    W.week_no = week
    W.hs = defaultdict(float, {0: 5.0, 1: 3.0})
    W.own = defaultdict(lambda: defaultdict(float))
    W.own[0].update({"s0_p0": 2.0, "s0_p1": 1.0, "lonca0_sermaye": 1.0})
    W.own[1].update({"s1_p2": 1.0, "s0_p0": 1.0, "ek_hesap": 1.0})
    W.L.flows.update({"konut_kirasi": 1000.4, "konut_kira_geliri": 640.0, "konut_kirasi_sehir": 360.0, "kira_vergisi": 12.0})
    return W, P


class OwnerClasses(unittest.TestCase):
    def test_owner_classes(self):
        W, P = housing_world()
        h = housing_rec.build(W, P, None)
        self.assertEqual(set(h), SHAPE)
        self.assertEqual((h["stock"], h["owners"], h["units_players"], h["units_lonca"], h["units_other"]), (8, 3, 5, 1, 1))
        self.assertEqual(h["units_players"] + h["units_lonca"] + h["units_other"], round(sum(sum(d.values()) for d in W.own.values())))   # birim toplamı = Σ own
        self.assertEqual(h["owners"], 3)                                  # s0_p0 iki şehirde de sayılır, bir kez
        W.own[0]["s0_p1"] = 0.4                                           # bir birimden küçük kalıntı sahip sayılmaz
        self.assertEqual(housing_rec.build(W, P, None)["owners"], 2)

    def test_first_week_null_then_weekly(self):
        W, P = housing_world()
        prev = housing_rec.totals(W, P)
        self.assertTrue(all(housing_rec.build(W, P, None)[k] is None for k in housing_rec.FLOWS))   # ilk hafta
        W.week_no += 1
        W.L.flows.update({"konut_kirasi": 2000.4, "konut_kira_geliri": 1300.0, "konut_kirasi_sehir": 700.2, "kira_vergisi": 30.0})
        h = housing_rec.build(W, P, prev)
        self.assertEqual((h["rent_paid"], h["rent_owners"], h["rent_city"], h["rent_tax"]), (1000, 660, 340, 18))
        W.week_no += 1                                                    # aradaki hafta atlandı: null
        self.assertTrue(all(housing_rec.build(W, P, prev)[k] is None for k in housing_rec.FLOWS))

    def test_notes_cover_every_field(self):
        self.assertEqual(set(housing_rec.NOTES), SHAPE)


class HouseOff(unittest.TestCase):
    def test_house_off_nulls(self):
        W, P = housing_world()
        P.HOUSE_ON = False
        prev = housing_rec.totals(W, P)
        h = housing_rec.build(W, P, prev)
        self.assertEqual(h, {k: None for k in housing_rec.FIELDS})
        json.dumps(h, allow_nan=False)


class Purity(unittest.TestCase):
    def test_does_not_mutate(self):
        W, P = housing_world()
        before = deep(W)
        prev = housing_rec.totals(W, P)
        housing_rec.build(W, P, prev)
        housing_rec.build(W, P, None)
        housing_rec.stocks(W)
        snapshot_equal(self, W, before, "housing_rec.build")

    def test_no_defaultdict_insert(self):
        W, P = housing_world()
        W.L.flows.clear()                                                 # kira vergisi kapalı: anahtar hiç yazılmamış olabilir
        n_flows, n_own, n_hs = len(W.L.flows), len(W.own), len(W.hs)
        per = {ci: len(d) for ci, d in W.own.items()}
        housing_rec.build(W, P, housing_rec.totals(W, P))
        self.assertEqual((len(W.L.flows), len(W.own), len(W.hs)), (n_flows, n_own, n_hs))
        self.assertEqual({ci: len(d) for ci, d in W.own.items()}, per)


class Size(unittest.TestCase):
    def test_housing_size_worst_synthetic(self):
        W, P = housing_world(week=9999)
        prev = housing_rec.totals(W, P)
        W.week_no += 1
        for k in W.L.flows:
            W.L.flows[k] += 12345678.0
        for ci in W.hs:
            W.hs[ci] = 99999.0
        for i in range(2000):
            W.own[0][f"s0_p{i}"] = 1.0
        W.people.update({f"s0_p{i}": dict(who="oyuncu") for i in range(2000)})
        worst = size(housing_rec.build(W, P, prev))
        self.assertLessEqual(worst, 300, worst)


class PacketCarriesHousing(unittest.TestCase):
    def test_make_packet_housing_optional(self):
        row = {"calisan": 1, "issiz": 1}
        self.assertNotIn("housing", make_packet("r", 1, 1, row))
        self.assertEqual(make_packet("r", 1, 1, row, housing={"stock": 1})["housing"], {"stock": 1})
        p = make_packet("r", 1, 1, row, holdings={"money": {}}, credit={"found": None}, housing={"stock": 1})
        self.assertEqual((p["holdings"], p["credit"], p["housing"]), ({"money": {}}, {"found": None}, {"stock": 1}))


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    WEEKS = 26
    OVERRIDES = {"varsayilan": {}, "sahibin_tarifi": None}            # sahibin tarifi `setUpClass`ta çözülür (kayıt dosyasını okur)
    runs: dict = {}

    @classmethod
    def setUpClass(cls):
        cls.OVERRIDES["sahibin_tarifi"] = owner_recipe_overrides()
        for name, ov in cls.OVERRIDES.items():
            host = ModelHost(str(config.MODEL_ROOT), dict(ov), 200)
            try:
                packets, totals = [], []
                for _ in range(cls.WEEKS):
                    packets += stepped(host, 1, True)
                    totals.append(dict(host._credit_prev))
                units = sum(sum(d.values()) for d in host._W.own.values())
                cls.runs[name] = {"packets": packets, "totals": totals, "own_units": units, "snap": (host.snapshot()["housing"], host.snapshot()["housing"])}
            finally:
                host.close()

    def test_rent_closes(self):
        """Her hafta: ödenen kira = ev sahiplerine + şehre (± 1 Akçe, yuvarlama); birim toplamı = Σ own; haftalık toplam = birikimli fark; sahiplik gerçekten var."""
        for name, r in self.runs.items():
            with self.subTest(world=name):
                self._rent_closes(name, r)

    def _rent_closes(self, name, r):
        seen = 0
        for w, p in enumerate(r["packets"], 1):
            h = p["housing"]
            self.assertEqual(set(h), SHAPE)
            if w == 1:
                self.assertTrue(all(h[k] is None for k in housing_rec.FLOWS), f"hafta 1 {name}")
                continue
            seen += 1
            self.assertLessEqual(abs(h["rent_paid"] - h["rent_owners"] - h["rent_city"]), 2, (name, w, h))
            self.assertGreaterEqual(h["rent_owners"], 0)
        self.assertGreater(seen, 0)
        last = r["packets"][-1]["housing"]
        self.assertEqual(last["units_players"] + last["units_lonca"] + last["units_other"], round(r["own_units"]))
        self.assertEqual(last["owners"], 0, name)             # 26 haftada hiçbir oyuncu konut almıyor (B9: bkz. rapor); sahiplik ayrı testte (`OwnedHouses`) zorlanır
        self.assertEqual(last["rent_owners"], 0, name)
        self.assertAlmostEqual(last["rent_city"], last["rent_paid"], delta=1, msg=name)    # sahipsiz konutun kirası şehre gider
        self.assertGreater(sum(p["housing"]["rent_paid"] for p in r["packets"][1:]), 0, name)
        for k in housing_rec.FLOWS:                                  # haftalık fark toplamı = birikimli fark (ilk hafta tabana alınır)
            tot = sum(p["housing"][k] for p in r["packets"][1:])
            span = r["totals"][-1]["housing." + k] - r["totals"][0]["housing." + k]
            self.assertAlmostEqual(tot, span, delta=0.5 * self.WEEKS + 1e-9, msg=(name, k))
        paid = r["totals"][-1]["housing.rent_paid"] - r["totals"][0]["housing.rent_paid"]
        split = sum(r["totals"][-1]["housing." + k] - r["totals"][0]["housing." + k] for k in ("rent_owners", "rent_city"))
        self.assertAlmostEqual(paid, split, delta=1.0, msg=name)    # toplamda da kapanır (birikimli, yuvarlamasız)

    def test_snapshot_idempotent_and_prev_prefix(self):
        for name, r in self.runs.items():
            a, b = r["snap"]
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(r["packets"][-1]["housing"], sort_keys=True))
            self.assertTrue(any(k.startswith("housing.") for k in r["totals"][-1]))
            self.assertIn("gate.cand.cities", r["totals"][-1])           # kredi farkları ezilmedi

    def test_housing_size(self):
        for name, r in self.runs.items():
            sizes = [size(p["housing"]) for p in r["packets"]]
            self.assertLessEqual(sum(sizes) / len(sizes), 220, (name, sizes))
            self.assertLessEqual(max(sizes), 300, (name, sizes))

    def test_json_safe_and_no_person_ids(self):
        for name, r in self.runs.items():
            for p in r["packets"]:
                self.assertNotRegex(json.dumps(p["housing"], allow_nan=False), r"s\d+_p\d+")

    def test_does_not_mutate_real(self):
        host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            stepped(host, 3, True)
            before = deep(host._W)
            housing_rec.build(host._W, host._P, housing_rec.totals(host._W, host._P))
            snapshot_equal(self, host._W, before, "housing_rec.build (gerçek model)")
        finally:
            host.close()


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class OwnedHouses(unittest.TestCase):
    """Doğal 26 haftada kimse konut almadığından (bkz. `RealModel`) sahipli dünya zorlanır: 6. haftadan sonra her şehirde bütün konutlar bir oyuncunun (yarısı
    ipotek haczindeki loncanın havuzunun) olur. Model kirayı kendisi paylaştırır; kayıt onu aynen okumalıdır: ev sahiplerine (1 - HOUSE_MAINT) x kira, kalanı şehre."""

    def test_rent_split_with_owners(self):
        host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            stepped(host, 5, True)
            W = host._W
            lo_pool = f"{W.loncas[0]}_sermaye"
            for c in W.cities:
                ci = c["i"]
                W.own[ci].clear()
                W.own[ci][c["players"][0]] = W.hs[ci] / 2
                W.own[ci][lo_pool] += W.hs[ci] / 2
            pk = stepped(host, 4, True)
            maint = host._P.HOUSE_MAINT
            h = pk[-1]["housing"]
            self.assertEqual(h["owners"], len(W.cities))
            self.assertAlmostEqual(h["units_players"] + h["units_lonca"], h["stock"], delta=1)    # yarım birimler ayrı ayrı yuvarlanır
            self.assertEqual(h["units_other"], 0)
            self.assertGreater(h["units_lonca"], 0)
            for p in pk:
                x = p["housing"]
                self.assertGreater(x["rent_owners"], 0)
                self.assertAlmostEqual(x["rent_owners"], (1 - maint) * x["rent_paid"], delta=2)       # bütün konutlar sahipli: sahip payı (1 - bakım payı)
                self.assertAlmostEqual(x["rent_city"], maint * x["rent_paid"], delta=2)
                self.assertLessEqual(abs(x["rent_paid"] - x["rent_owners"] - x["rent_city"]), 2)
                self.assertEqual(x["rent_tax"], 0)                                                   # kira vergisi kapalı
        finally:
            host.close()


class ErrorPath(unittest.TestCase):
    @unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
    def test_persistent_housing_error_prints_once_and_drops_only_housing(self):
        import contextlib
        import io
        orig, housing_rec.build = housing_rec.build, lambda *a, **k: 1 / 0
        buf = io.StringIO()
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            with contextlib.redirect_stderr(buf):
                pk = stepped(h, 3, True)
        finally:
            housing_rec.build = orig
            h.close()
        self.assertEqual(buf.getvalue().count("Traceback"), 1)
        for p in pk:
            self.assertNotIn("housing", p)
            self.assertIn("credit", p)
            self.assertIn("holdings", p)


if __name__ == "__main__":
    unittest.main()
