"""M10 Görev 3: `urun` çekmecesi (istek üzerine ürün ayrıntısı, şehir kırılımlı). Salt okunur."""
from __future__ import annotations

import unittest

from oyun_server.sim import drawers
from oyun_server.testing import FakeHost

from tests.extract_v2_helpers import deep, fake_world, params_ns
from tests.route_helpers import call, create_run, live_app
from tests.test_chain_drawers import drawer, step_to
from tests.test_wire_contract import FIX, shape_diff


def pano_dunya():
    W = fake_world(n_cities=3)
    W.board["prod"] = {"un": dict(want=100.0, short=20.0, short_share=0.2, persist=0.1, stock=30.0, cover=14.0, n_all=6, n_h=4, ptrend=0.0, pidx=1.1, prod=60.0)}
    for ci in range(3):
        W.board["cells"][(ci, "un")] = dict(dem=30.0 + ci, prod=20.0, stock=10.0, n_prod=2, n_healthy=1 + (ci % 2), pm=1.0)
    return W


class UrunCekmecesi(unittest.TestCase):
    def setUp(self):
        self.P = params_ns(SECTOR_BOARD=1, CYCLES_PER_WEEK=7)

    def test_urun_cekmecesi_alanlari_ve_sehir_kirilimi(self):
        out = drawers.build(pano_dunya(), self.P, "urun", "un")
        f = out["fields"]
        self.assertEqual((out["kind"], out["ref"]), ("urun", "un"))
        self.assertEqual(len(f["sehirler"]), 3)
        self.assertAlmostEqual(sum(s["uretim"] for s in f["sehirler"]), f["uretim"], delta=1e-6)
        self.assertEqual((f["istek"], f["karsilanmayan"], f["firma"], f["saglikli"], f["fiyat_endeksi"]), (100.0, 20.0, 6, 4, 1.1))
        self.assertAlmostEqual(f["kapsama_hf"], 2.0)

    def test_bilinmeyen_urun_unknown_ref(self):
        with self.assertRaises(drawers.UnknownRef):
            drawers.build(pano_dunya(), self.P, "urun", "yok")
        with self.assertRaises(drawers.UnknownRef):
            drawers.build(pano_dunya(), self.P, "urun", "sut")        # tarifte var, panoda yok
        with self.assertRaises(drawers.UnknownRef):
            drawers.from_packet("urun", "un", {})
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            s, _h, b = drawer(srv, rid, "urun", "yok", 2)
            self.assertEqual((s, b), (404, FIX["error_404_drawer"]))

    def test_pano_kapaliyken_unknown_ref(self):
        W = fake_world(n_cities=3, with_board=False)
        with self.assertRaises(drawers.UnknownRef):
            drawers.build(W, self.P, "urun", "un")
        W2 = pano_dunya()
        with self.assertRaises(drawers.UnknownRef):
            drawers.build(W2, params_ns(SECTOR_BOARD=0), "urun", "un")

    def test_yalniz_beyaz_liste_alanlari(self):
        f = drawers.build(pano_dunya(), self.P, "urun", "un")["fields"]
        self.assertEqual(set(f), set(drawers.URUN_FIELDS))

    def test_W_degismez(self):
        W = pano_dunya()
        once = deep(W.board)
        drawers.build(W, self.P, "urun", "un")
        self.assertEqual(deep(W.board), once)

    def test_http_sahte_host_ve_sozlesme(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            s, _h, b = drawer(srv, rid, "urun", "un", 3)
            self.assertEqual(s, 200)
            self.assertEqual(shape_diff(b, FIX["drawer_urun"]), [])
            self.assertEqual(set(b["fields"]), set(drawers.URUN_FIELDS))
        self.assertIn("urun", FIX["enums"]["drawerKinds"])


if __name__ == "__main__":
    unittest.main()
