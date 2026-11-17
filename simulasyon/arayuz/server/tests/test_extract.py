"""A6: WeekPacket çıkarıcı (saf)."""
from __future__ import annotations

import importlib.util
import json
import math
import re
import unittest
from pathlib import Path

from oyun_server.sim import extract
from oyun_server.sim.extract import extract_world, make_packet

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ROWS = json.loads((HERE / "fixtures" / "rows_k211_base_pm0.078_w1-12.json").read_text("utf-8"))
RECORDING = REPO / "apps" / "web" / "public" / "oyun-kayit" / "kapali" / "pm0.078.json"
TYPES_TS = REPO / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"
MANIFEST = REPO / "simulasyon" / "arayuz" / "export" / "kayit_manifest.json"
EXPORT_VAR = (REPO / "simulasyon" / "arayuz" / "export" / "kayit_aktar.py").is_file()   # açık depoda kayıt üretim aracı (export/) yok: ona bakan iki test atlanır


def load_export():
    spec = importlib.util.spec_from_file_location("kayit_aktar", REPO / "simulasyon" / "arayuz" / "export" / "kayit_aktar.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ts_world_fields() -> set[str]:
    src = TYPES_TS.read_text("utf-8")
    body = re.search(r"export type World = \{(.*?)\n\};", src, re.S).group(1)
    return set(re.findall(r"^\s*([a-z_0-9]+)\??:", body, re.M))


class ExtractTests(unittest.TestCase):
    @unittest.skipUnless(EXPORT_VAR, "kayıt üretim aracı (export/) bu depoda yok")
    def test_parity_with_recording(self):
        ex = load_export()
        rec = json.loads(RECORDING.read_text("utf-8"))["cols"]
        manifest = json.loads(MANIFEST.read_text("utf-8"))
        zero = set(next(s for s in manifest["sets"] if s["id"] == "kapali").get("zero_fill", []))  # P-14
        self.assertTrue(zero)
        for i, row in enumerate(ROWS):
            w = extract_world(row)
            for name, _ in ex.FIELDS:
                if name in zero:
                    continue
                exp = rec[name][i]
                got = ex.fmt(w[name])
                if exp is None:
                    self.assertIsNone(got, (i + 1, name))
                else:
                    self.assertAlmostEqual(got, exp, delta=abs(exp) * 1e-3 + 1e-9, msg=(i + 1, name))

    def test_field_set_equals_types_ts(self):
        ts = ts_world_fields()
        self.assertEqual(set(extract_world({})), ts | set(extract.NEW_WORLD_FIELDS))   # web türü eklenene dek yalnız bekleyen alanlar (S5 düzeltme 1)
        self.assertFalse(set(extract.NEW_WORLD_FIELDS) & ts, "alan types.ts'e eklendi: NEW_WORLD_FIELDS'tan çıkar")

    def test_diagnostic_facts_mapped(self):
        row = {"fon_red": 7, "x_policy_rate": 0.0042, "x_policy_unemployment": 0.2, "x_city_spend_cut": 55.5}
        w = extract_world(row)
        self.assertEqual((w["support_denied"], w["policy_rate"], w["policy_unemployment"], w["city_spend_cut"]), (7, 0.0042, 0.2, 55.5))
        w = extract_world({"fon_red": "", "x_policy_rate": None, "x_policy_unemployment": float("nan")})
        self.assertEqual([w[k] for k in ("support_denied", "policy_rate", "policy_unemployment", "city_spend_cut")], [None] * 4)
        for k in ("support_denied", "policy_unemployment", "city_spend_cut"):
            self.assertIsNone(extract_world(ROWS[0])[k], k)
        for k in extract.NEW_WORLD_FIELDS:                       # satır fikstürü bu olguları taşımaz: eski kayıt paketleri değişmez
            self.assertIsNone(extract_world(ROWS[0])[k])

    @unittest.skipUnless(EXPORT_VAR, "kayıt üretim aracı (export/) bu depoda yok")
    def test_mapping_equals_export_script(self):
        self.assertEqual(extract.FIELDS, load_export().FIELDS)

    def test_every_mapped_field_individually(self):
        """Her eşlenen alana ayrı, sıfırdan farklı, yerel türde değer; yanlış eşleme herhangi birinde düşer."""
        row = {}
        expected = {}
        for k, (name, src) in enumerate(extract.FIELDS):
            if src is None:
                continue
            val = (k + 1) * 3 + 1 if k % 2 == 0 else (k + 1) * 3 + 0.5
            row[src] = val
            expected[name] = val
        expected["unemployment_rate"] = row["issiz"] / (row["calisan"] + row["issiz"])
        expected["loans_granted"] = row["kredi_basvuru"] - row["kredi_ret"]
        self.assertEqual(len({v for v in row.values()}), len(row))
        w = extract_world(row)
        for name, _ in extract.FIELDS:
            self.assertEqual(w[name], expected[name], name)
        self.assertEqual(w["support_weekly"], row["fon_verilen"])
        self.assertEqual(w["reject_reputation"], row["ret_itibar"])

    def test_nan_inf_empty_to_null(self):
        row = {"talep_karsilama": float("nan"), "calisan": float("inf"), "issiz": "", "npc_firma": "abc",
               "oyuncu_firma": "-inf", "batan_kum": "nan", "gini_servet": None, "para_toplam": "1e3", "hiz_satis": " 2 "}
        w = extract_world(row)
        for k in ("served", "employed", "unemployed", "npc_firms", "player_firms", "failed_cum", "gini", "unemployment_rate"):
            self.assertIsNone(w[k], k)
        self.assertEqual(w["money_total"], 1000.0)
        self.assertEqual(w["velocity"], 2)
        json.dumps(make_packet("r", 1, 1, row), allow_nan=False)

    def test_zero_denominator(self):
        self.assertIsNone(extract_world({"calisan": 0, "issiz": 0})["unemployment_rate"])
        self.assertEqual(extract_world({"calisan": 10, "issiz": 0})["unemployment_rate"], 0)
        self.assertEqual(extract_world({"calisan": 30, "issiz": 10})["unemployment_rate"], 0.25)
        self.assertEqual(extract_world({"kredi_basvuru": 5, "kredi_ret": 2})["loans_granted"], 3)
        self.assertIsNone(extract_world({"kredi_basvuru": 5})["loans_granted"])

    def test_unknown_fields_ignored(self):
        w = extract_world({**ROWS[0], "bilinmeyen": 5, "ist_sektor": "x:1"})
        self.assertEqual(w, extract_world(ROWS[0]))

    def test_all_null_row(self):
        w = extract_world({})
        self.assertTrue(all(v is None for v in w.values()))
        p = make_packet("r1", 3, 2, {})
        self.assertEqual((p["v"], p["run_id"], p["week"], p["version"], p["events"]), (1, "r1", 3, 2, []))
        json.dumps(p, allow_nan=False)

    def test_packet_json_safe_for_fixture(self):
        for i, row in enumerate(ROWS):
            p = make_packet("r", i + 1, 1, row)
            json.dumps(p, allow_nan=False)
            self.assertFalse(any(isinstance(v, float) and not math.isfinite(v) for v in p["world"].values()))


if __name__ == "__main__":
    unittest.main()
