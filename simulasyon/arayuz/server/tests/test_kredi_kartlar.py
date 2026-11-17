"""PLAN-KREDI T10: kredi yönlendirme, lonca ve iş piyasası kartları (kayıt, metin, kapsam, 4 haftalık koşuda geçersiz kılma)."""
from __future__ import annotations

import re
import unittest

from oyun_server.config import MODEL_ROOT
from oyun_server.sim.host import ModelHost

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

KARTLAR = {
    "mevduat_yonlendirme": ("V", "dunya", "DEP_ROUTE"),
    "lonca_batik_kapanis": ("P", "bankacilik", "LONCA_INSOLV_CLOSE"),
    "lonca_kolay_kurulus": ("P", "loncalar", "LONCA_EASY"),
    "kadro_talebi_gorur": ("P", "is_piyasasi", "STAFF_DEMAND"),
    "ise_alim_kasa_sarti": ("P", "is_piyasasi", "HIRE_CASH_GATE"),
    "issiz_kurucu": ("V", "dunya", "ENTRY_JOBLESS"),
}
V131_ACIK = {"DEP_ROUTE", "STAFF_DEMAND", "HIRE_CASH_GATE"}      # v13.1 (K-221) varsayılanı açık olanlar
YASAK = re.compile(r"\b(K-\d+|[A-Z]{2,}_[A-Z_]+|modelde)\b")


class KrediKartlari(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_kayit_ve_varsayilan_kapali(self):
        for k, (layer, group, param) in KARTLAR.items():
            with self.subTest(card=k):
                s = self.reg.by_id[k]
                self.assertEqual((s.layer, s.group, list(s.params)), (layer, group, [param]))
                self.assertTrue(s.editable)
                self.assertNotEqual(s.apply, "unknown")
                if param in V131_ACIK:
                    self.assertTrue(self.d[param])                      # v13.1 varsayılanı açık
                    self.assertTrue(self.reg.default_ui(s))
                    continue
                self.assertFalse(self.d[param])
                ui = self.reg.default_ui(s)
                self.assertIn(ui, (False, 0))

    def test_metinler_temiz_ve_oyuncu_dilinde(self):
        for k in KARTLAR:
            t = self.texts[k]
            for f in ("title", "what", "changes"):
                self.assertTrue(t[f].strip(), (k, f))
                self.assertIsNone(YASAK.search(t[f]), (k, f, t[f]))

    def test_tahvil_payi_adimi_5(self):
        c = self.reg.by_id["lonca_tahvil_payi"].codec
        self.assertEqual((c["step"], c["scale"]), (5, 100))

    def test_kapsam_kapisi_baseline_cikarildi(self):
        names = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        for _, _, p in KARTLAR.values():
            self.assertNotIn(p, names)
        for alt in ("DEP_RUN", "STAFF_DEMAND_SHARE", "HIRE_CASH_CYCLES"):
            self.assertIn(alt, names)

    def test_acik_kart_modele_ulasir(self):
        """Her yeni kart açıkken 4 haftalık gerçek koşuda geçersiz kılma modelde görünür."""
        for k, (_, _, param) in KARTLAR.items():
            with self.subTest(card=k):
                on = True if isinstance(self.d[param], bool) else 1
                h = ModelHost(str(MODEL_ROOT), {param: on}, 200, 5)
                try:
                    for _ in range(4):
                        h.step()
                    self.assertEqual(h._model._modules["simkit.params"].__dict__[param], on)
                    self.assertEqual(h.effective, {param: on})
                finally:
                    h.close()


if __name__ == "__main__":
    unittest.main()
