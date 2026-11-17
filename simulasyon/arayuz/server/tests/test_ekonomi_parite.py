"""M10 Görev 7: sözleşme parite kapısı (gerçek model).
1) Gerçek ModelHost'un `ekonomi` bloğu (birkaç hafta) `wire_contract.json` fikstürüyle anahtar ağacı + tür olarak eşleşmeli.
2) Web'deki ürün kimliği listesi (modelUrunKimlikleri.ts) ve ürün adı sözlüğü (tr.ts `urun.ad.*`) modelin PRODUCER anahtarlarıyla eşit olmalı:
   model yeni ürün eklerse ya da çıkarırsa bu test kırılır (web kopyası elle güncellenir)."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from tests.extract_v2_helpers import QUICK
from tests.test_wire_contract import FIX, shape_diff

REPO = Path(__file__).resolve().parents[4]
KIMLIK_TS = REPO / "apps" / "web" / "tests" / "oyun" / "copy" / "modelUrunKimlikleri.ts"
TR_TS = REPO / "apps" / "web" / "src" / "oyun" / "copy" / "tr.ts"


@unittest.skipIf(QUICK, "gerçek model")
class Parite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        cls.host = ModelHost(str(config.MODEL_ROOT), {}, 200)
        cls.addClassCleanup(cls.host.close)
        cls.bloklar = []
        cls.makrolar = []
        for _ in range(3):
            cls.host.step()
            snap = cls.host.snapshot()
            cls.bloklar.append(snap["ekonomi"])
            cls.makrolar.append(snap["makro"])

    def test_gercek_ekonomi_blogu_fikstur_sekliyle_eslesir(self):
        for kaynak in ("packet", "packet_dao"):
            want = FIX[kaynak]["ekonomi"]
            for i, blok in enumerate(self.bloklar, 1):
                diff = shape_diff(blok, want, "$.ekonomi")
                self.assertEqual(diff, [], f"{kaynak}, hafta {i}: {diff}")

    def test_gercek_makro_blogu_fikstur_sekliyle_eslesir(self):
        """M10 Makro göstergeler: gerçek ModelHost `makro` bloğu fikstürle anahtar ağacı ve tür olarak eşleşir (ölçülmeyen alan null olabilir)."""
        for kaynak in ("packet", "packet_dao"):
            want = FIX[kaynak]["makro"]
            for i, blok in enumerate(self.makrolar, 1):
                diff = shape_diff(blok, want, "$.makro")
                self.assertEqual(diff, [], f"{kaynak}, hafta {i}: {diff}")

    def test_gercek_blokta_olculen_alanlar_bos_degil(self):
        """Şekil denetimi null'a izin verdiği için ayrıca: 3. haftada temel alanlar gerçekten ölçülmüş olmalı."""
        b = self.bloklar[-1]
        self.assertIsNotNone(b["tuketim"]["hane"]["ise"])
        self.assertIsNotNone(b["isletme"]["hareket"])
        self.assertTrue(b["isletme"]["sektor"])
        self.assertEqual(len(b["isletme"]["sehir"]), len(b["tuketim"]["hane"]["sehir"]))

    def test_urun_kimlikleri_web_kopyasiyla_esit(self):
        producer = set(self.host._mods["simkit.params"].PRODUCER)
        metin = KIMLIK_TS.read_text(encoding="utf-8")
        govde = metin.split("= [", 1)[1].split("];", 1)[0]
        web = re.findall(r'"([^"]+)"', govde)
        self.assertEqual(len(web), len(set(web)), "web listesinde yinelenen kimlik")
        self.assertEqual(set(web), producer, f"yalnız modelde: {sorted(producer - set(web))}, yalnız web listesinde: {sorted(set(web) - producer)}")

    def test_urun_ad_sozlugu_modelle_esit(self):
        producer = set(self.host._mods["simkit.params"].PRODUCER)
        sozluk = set(re.findall(r'^\s*"urun\.ad\.([a-z0-9_]+)"\s*:', TR_TS.read_text(encoding="utf-8"), re.M))
        self.assertEqual(sozluk, producer, f"sözlükte eksik: {sorted(producer - sozluk)}, sözlükte fazla: {sorted(sozluk - producer)}")


if __name__ == "__main__":
    unittest.main()
