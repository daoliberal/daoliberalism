"""A7b: tel biçimi sözleşmesi. Ortak örnekler `tests/fixtures/wire_contract.json`; web tarafı aynı dosyayı
`apps/web/tests/oyun/sim/live/wireContract.test.ts` ile `wire.ts` ayrıştırıcılarından geçirir.
Burada GERÇEK sunucu yanıtlarının biçimi (anahtar kümesi + tür) örneklerle birebir aynı olmalı."""
from __future__ import annotations

import json
import time
import unittest
from pathlib import Path

from tests.route_helpers import CONFIG, Stream, call, create_run, live_app
from tests.test_sse import read_until, wait_week

FIX = json.loads((Path(__file__).parent / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
OPTIONAL = {"modelWeeksPerSec", "endedReason", "error", "buffering", "preparing", "parentRunId", "forkWeek", "worldScenarioValues", "settingLocks", "mode", "dunyaKodu"}     # RunState isteğe bağlı alanları (`mode` yalnız DAO koşusunda, `dunyaKodu` yalnız yayımlanmış dünyadan kurulan DAO koşusunda)
NULLABLE = {"sector", "sec_per_week_p50", "scenarioId", "world", "from",
            "firmam", "loncam", "mevduat", "talep_karsilama", "lonca", "firma",
            "karsilanma", "sepet", "harcama", "urunler", "hareket",            # M10 ekonomi bloğu: ölçülmeyen hafta / kayıt yok / pano kapalı
            "ise", "issiz", "dis", "npc_issiz_parasiz"}                        # M10: şehirde hane yok (n == 0) grup null; NPC havuzu kapalıysa null
# null <-> değer (model verisine bağlı; "firmam".."firma" DAO gözlemi)


def kind(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "bool"
    if isinstance(x, (int, float)):
        return "number"
    if isinstance(x, str):
        return "string"
    return "list" if isinstance(x, list) else "object"


def ui_value(v):
    """UIValue: sayı | dizge | bool | dizge listesi | düz skaler nesne (fields)."""
    if isinstance(v, (bool, int, float, str)):
        return True
    if isinstance(v, list):
        return all(isinstance(x, str) for x in v)
    if isinstance(v, dict):
        return all(isinstance(x, (bool, int, float, str)) for x in v.values())
    return False


EMPTY_OK = {"girisimci", "medya", "yeniden", "resources", "olaylar", "firmalar", "eksikler", "degisen", "yeni", "kapanan", "urunler", "sektor"}      # gerçekten boş olabilen liste yolları (ör. kaynaksız şehir); öteki yollarda boş gerçek liste fark sayılır


def shape_diff(actual, want, path="$", nullable=False):
    """Uyuşmazlıkların listesi (boş = uyumlu)."""
    ka, kw = kind(actual), kind(want)
    if ka != kw:
        if nullable and "null" in (ka, kw):
            return []
        return [f"{path}: {ka} != {kw}"]
    if ka == "object" and path.endswith(".values"):
        # şablon/senaryo değer haritası: anahtarlar kart kimlikleridir (açık küme); yalnız değer türü (UIValue) denetlenir
        return [f"{path}.{k}: UIValue değil" for k, v in sorted(actual.items()) if not ui_value(v)]
    if ka == "object":
        out = []
        ak, wk = set(actual), set(want)
        for k in sorted(ak ^ wk):
            if k == "edges" and path.endswith("chain"):          # kenar listesi yalnız tarifin değiştiği haftanın paketinde
                continue
            if k in OPTIONAL and path.startswith("$") and (path in ("$", "$.state") or path.endswith("state")):
                continue
            out.append(f"{path}.{k}: {'yalnız gerçekte' if k in ak else 'yalnız örnekte'}")
        for k in sorted(ak & wk):
            if path.endswith(".values") or path.endswith("values"):
                out += shape_diff(actual[k], want[k], f"{path}.{k}", True)
            else:
                out += shape_diff(actual[k], want[k], f"{path}.{k}", nullable or k in NULLABLE or path.endswith(".world") or ".makro" in path)   # M10 makro: ölçülmeyen gösterge null
        return out
    if ka == "list":
        if not want:
            return [] if not actual else [f"{path}: örnek boş, gerçek dolu"]
        if not actual:
            return [] if path.rsplit(".", 1)[-1] in EMPTY_OK else [f"{path}: gerçek boş, örnek dolu"]
        out = []
        for i, a in enumerate(actual):        # öğe örneğin herhangi bir öğesine uymalı; boş gerçek liste geçerli (ör. kaynaksız şehir); öğe örneğin herhangi bir öğesine uymalı
            tries = [shape_diff(a, w, f"{path}[{i}]", nullable) for w in want]
            if not any(not t for t in tries):
                out += tries[0]
        return out
    return []


class WireContract(unittest.TestCase):
    def assertShape(self, actual, key):
        """`harita` bloğu: zorunlu haftalarda (Kurucu: 1 ve 10'un katları; DAO: her hafta) varlığı denetlenir ve iç şekli örnekle karşılaştırılır;
        zorunlu olmayan haftada yokluk kabul edilir (örnekten çıkarılır), varlık yine şekil denetiminden geçer."""
        want = FIX[key]
        pks = actual if isinstance(actual, list) else [actual]
        wants = want if isinstance(want, list) else [want]
        if key in ("packet", "weeks", "packet_dao", "packet_harita", "packet_harita_fark") and all(isinstance(p, dict) and "week" in p for p in pks) and all(isinstance(w, dict) for w in wants):
            tam = [key == "packet_dao" or p["week"] == 1 or p["week"] % 10 == 0 for p in pks]
            for p, d in zip(pks, tam):
                if d:
                    self.assertIn("harita", p, f"{key}: hafta {p['week']} paketinde harita zorunlu")
                    self.assertNotIn("haritaFark", p, f"{key}: hafta {p['week']} tam harita haftası: fark yok")
                else:
                    self.assertIn("haritaFark", p, f"{key}: hafta {p['week']} (Kurucu, tam harita yok) paketinde haritaFark zorunlu")
                    self.assertNotIn("harita", p, f"{key}: hafta {p['week']} fark haftası: tam harita yok")
            har, fark = FIX["packet_harita"]["harita"], FIX["packet_harita_fark"]["haritaFark"]
            sec = []
            for p, w in zip(pks, wants + wants[-1:] * len(pks)):
                w = {k: v for k, v in w.items() if k not in ("harita", "haritaFark")}
                if "harita" in p:
                    w["harita"] = har
                if "haritaFark" in p:
                    w["haritaFark"] = fark
                sec.append(w)
            want = sec if isinstance(want, list) else sec[0]
        diff = shape_diff(actual, want, "$")
        self.assertEqual(diff, [], f"{key}: {diff}")

    def assertSettingsShape(self, settings):
        """`info.settings`: her düzenlenebilir kart {id, changeable, [reason], options[{value, available, [reason]}]};
        örnekteki kartların seçenek değerleri birebir aynı. Sayı/alan/aç-kapa kartlarında `options` boş olabilir (R1a: kayıt büyüdü)."""
        sample = {x["id"]: [o["value"] for o in x["options"]] for x in FIX["info"]["settings"]}
        for item in settings:
            self.assertEqual(set(item) - {"reason"}, {"id", "changeable", "options"}, item["id"])
            self.assertIsInstance(item["changeable"], bool)
            self.assertIsInstance(item["options"], list)
            if item["id"] in sample:
                self.assertEqual([o["value"] for o in item["options"]], sample[item["id"]], item["id"])
            for o in item["options"]:
                self.assertEqual(set(o) - {"reason"}, {"value", "available"}, item["id"])
                self.assertIsInstance(o["available"], bool)
        self.assertTrue(set(sample) <= {x["id"] for x in settings})

    def test_shape_checker_detects_drift(self):
        self.assertTrue(shape_diff({"a": 1}, {"a": 1, "b": 2}))
        self.assertTrue(shape_diff({"a": "x"}, {"a": 1}))
        self.assertTrue(shape_diff({"a": [1]}, {"a": []}))
        self.assertTrue(shape_diff({"a": []}, {"a": [1]}))                           # boş gerçek liste yalnız izinli yollarda geçerli
        self.assertEqual(shape_diff({"resources": []}, {"resources": [1]}), [])
        self.assertEqual(shape_diff({"a": [{"x": 1}, {"y": 1}]}, {"a": [{"x": 1}, {"y": 2}]}), [])   # öğe örneklerden herhangi birine uyar
        self.assertTrue(shape_diff({"a": [{"z": 1}]}, {"a": [{"x": 1}, {"y": 2}]}))
        self.assertEqual(shape_diff({"world": {"x": None}}, {"world": {"x": 1.0}}), [])
        self.assertTrue(shape_diff({"runId": None}, {"runId": "x"}))

    def test_fixture_runtime_endpoints(self):
        with live_app() as (srv, app, _w):
            app.sec_per_week_p50 = 0.5
            self.assertShape(call(srv, "GET", "/api/hello")[2], "hello")
            info = call(srv, "GET", "/api/info")[2]
            self.assertIn("registry", info)                      # kayıt gövdesi içerik değişir: biçimi registry_contract.json kilitler
            rest = {k: v for k, v in info.items() if k not in ("registry", "settings", "dunyalarKalici")}     # dunyalarKalici: info_dunyalar_kalici örneği (web sahte sunucusu henüz taşımıyor)
            self.assertEqual(shape_diff(rest, {k: v for k, v in FIX["info"].items() if k != "settings"}, "$"), [])
            self.assertSettingsShape(info["settings"])
            self.assertShape(call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali"}})[2], "availability_ok")
            self.assertShape(call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "yok"}})[2], "availability_blocked")
            s, _, handle = call(srv, "POST", "/api/runs", {"config": CONFIG})
            self.assertEqual(s, 201)
            self.assertShape(handle, "handle")
            self.assertShape(handle["state"], "state_ready")
            rid = handle["runId"]
            for _ in range(3):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 3)
            self.assertShape(call(srv, "GET", f"/api/runs/{rid}")[2]["state"], "state_running")
            weeks = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]
            self.assertShape(weeks, "weeks")
            self.assertShape(weeks[0], "packet")
            self.assertIn("ekonomi", weeks[0])                       # M10: ekonomi anahtarı zorunlu (sözleşme)
            s_u, _h_u, b_u = call(srv, "GET", f"/api/runs/{rid}/drawer/urun/un?week=3")      # M10: ürün çekmecesi örneği
            self.assertEqual(s_u, 200)
            self.assertEqual(shape_diff(b_u, FIX["drawer_urun"], "$"), [])
            self.assertShape(call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {}})[2], "change_rejected")
            self.assertEqual(call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"dunya_tohumu": 1}})[2],
                             FIX["change_start_only"])
            locked = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"dunya_sabit_kalemleri": 10}})[2]
            self.assertEqual(locked["fields"], [{"id": "dunya_sabit_kalemleri", "reason": "locked"}])   # düzenlenemez kart hâlâ locked
            multi = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"dunya_tohumu": 1, "dunya_sabit_kalemleri": 10}})[2]
            self.assertEqual(multi, FIX["change_rejected_multi"])                                # atomik ret: her geçersiz ayar kendi nedeniyle, yama sırasıyla
            self.assertEqual(locked, FIX["change_locked"])                                       # düzenlenemez kart: locked; başlangıç-yalnız kart (dunya_tohumu) change_start_only verir
            info_run = call(srv, "GET", f"/api/info?run={rid}")[2]
            info_run.pop("registry")
            info_run.pop("dunyalarKalici")
            fix_run = dict(FIX["info_run"])                                                      # koşu ortası bağlamı
            want_settings = {x["id"]: x for x in fix_run.pop("settings")}
            got_settings = info_run.pop("settings")
            got_fixed, want_fixed = info_run.pop("fixedRules"), fix_run.pop("fixedRules")
            self.assertEqual(shape_diff(got_fixed, want_fixed, "$"), [])                        # kilitli kartlar kayıtla büyür/küçülür
            self.assertEqual({x["settingId"] for x in got_fixed}, {"dunya_sabit_kalemleri"})   # zararda_once_kucul V oldu
            got_tpl = {t["id"]: t for t in info_run.pop("templates")}                            # şablon kümesi kayıtla büyür: örnek şablonlar aynen bulunur
            for t in fix_run.pop("templates"):
                self.assertEqual(got_tpl[t["id"]], t)
            self.assertEqual(info_run, fix_run)
            self.assertEqual({x["id"]: x for x in got_settings if x["id"] in want_settings}, want_settings)
            self.assertSettingsShape(got_settings)
            self.assertShape(call(srv, "GET", "/api/runs/yok")[2], "error_404")
            self.assertShape(call(srv, "POST", "/api/runs", {"config": dict(CONFIG, durationWeeks=1)})[2], "error_422")

    def test_fixture_harita_paketi(self):
        """T10: 10. haftanın paketi `harita` taşır (satır: [id, tür, şehir, çalışan, lonca|null, sahip, doğum|null, durum]); öteki haftalarda yok. Web aynı örneği ayrıştırır."""
        with live_app() as (srv, _app, _w):
            rid = create_run(srv)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
            wait_week(srv, rid, 10)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "pause"})
            pk = call(srv, "GET", f"/api/runs/{rid}/weeks?from=9&to=10")[2]
            self.assertEqual([("harita" in p) for p in pk], [False, True])
            self.assertShape(pk[1], "packet_harita")
            self.assertShape(pk[0], "packet")
            gh = pk[1]["harita"]
            self.assertEqual(gh["alanlar"], FIX["packet_harita"]["harita"]["alanlar"])
            for sat in gh["firmalar"]:
                self.assertEqual(len(sat), 8)
                self.assertTrue(sat[6] is None or isinstance(sat[6], int))
                self.assertIn(sat[7], ("uretim", "zayif", "issiz", "kapali"))
                self.assertIn(gh["sahipler"][sat[5]], ("npc", "oyuncu", "dao"))
                self.assertLess(sat[1], len(gh["turler"]))
        h = FIX["packet_harita"]["harita"]
        self.assertEqual(h["hafta"], FIX["packet_harita"]["week"])
        self.assertEqual({h["sahipler"][s[5]] for s in h["firmalar"]}, {"npc", "oyuncu", "dao"})

    def test_fixture_harita_fark_paketi(self):
        """Kurucu'da tam harita taşımayan hafta `haritaFark` taşır (tabana göre degisen/yeni/kapanan); tam harita haftasında fark yok. Web aynı örneği `parseHaritaFark` ile çözer."""
        with live_app() as (srv, _app, _w):
            rid = create_run(srv)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
            wait_week(srv, rid, 12)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "pause"})
            pk = call(srv, "GET", f"/api/runs/{rid}/weeks?from=10&to=12")[2]
            self.assertEqual([("harita" in p, "haritaFark" in p) for p in pk], [(True, False), (False, True), (False, True)])
            self.assertShape(pk[1], "packet_harita_fark")
            gf = pk[1]["haritaFark"]
            self.assertEqual((gf["hafta"], gf["taban"]), (11, 10))
            for d in gf["degisen"]:
                self.assertEqual((len(d), isinstance(d[0], str), d[1] in range(4), isinstance(d[2], int)), (3, True, True, True))
        f = FIX["packet_harita_fark"]["haritaFark"]
        self.assertEqual((f["hafta"], f["taban"]), (FIX["packet_harita_fark"]["week"], 10))

    def test_fixture_dao_kosusu(self):
        """T6a: DAO koşusunun durumu `mode` taşır, paketi `dao` gözlemini taşır; Kurucu'da ikisi de yok."""
        with live_app() as (srv, _app, _w):
            s, _, handle = call(srv, "POST", "/api/runs", {"config": {**{k: v for k, v in CONFIG.items() if k != "durationWeeks"}, "mode": "dao"}})
            self.assertEqual(s, 201, handle)
            self.assertShape(handle, "handle_dao")
            self.assertEqual((handle["state"]["mode"], handle["state"]["durationWeeks"]), ("dao", 520))
            rid = handle["runId"]
            for _ in range(2):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 2)
            st = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]
            self.assertEqual(st["mode"], "dao")
            self.assertShape(st, "state_dao")
            weeks = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]
            for p in weeks:
                self.assertShape(p, "packet_dao")
                self.assertIn("ekonomi", p)
                self.assertEqual(p["dao"]["hafta"], p["week"])
            kid = create_run(srv)
            self.assertNotIn("mode", call(srv, "GET", f"/api/runs/{kid}")[2]["state"])

    def test_fixture_dunyalar(self):
        """T8b: dünya yayınlama uçları, `/info.dunyalarKalici` ve dünyadan kurulan DAO koşusunun durumu (`dunyaKodu`)."""
        from oyun_server.dunyalar.bellek import BellekDepo
        k = "oyuncu-0001"
        tarif = {"v": 1, "templateId": "dayanikli_taban", "durationWeeks": 100, "seedIndex": 0, "values": {}}
        with live_app(depo=BellekDepo()) as (srv, app, _w):
            self.assertShape({"dunyalarKalici": call(srv, "GET", "/api/info")[2]["dunyalarKalici"]}, "info_dunyalar_kalici")
            s, _, y = call(srv, "POST", "/api/dunyalar", {"tarif": tarif, "ad": "Kıtlık", "aciklama": "Zor dünya", "oyuncu": k})
            self.assertEqual(s, 201)
            self.assertShape(y, "dunya_yayinla")
            kod = y["kod"]
            self.assertShape(call(srv, "GET", "/api/dunyalar/" + kod)[2], "dunya_getir")
            self.assertShape(call(srv, "GET", "/api/dunyalar?kurucu=" + k)[2], "dunya_liste")
            s, _, o = call(srv, "POST", "/api/dunyalar/%s/oyna" % kod, {"oyuncu": k})
            self.assertEqual(s, 201)
            self.assertShape(o, "dunya_oyna")
            st = call(srv, "GET", "/api/runs/" + o["runId"])[2]["state"]
            self.assertEqual(st["dunyaKodu"], kod)
            self.assertEqual(st["cityNames"], [])                    # tarifte şehir adı yok: web `cityDisplayName` varsayılan ad üretir
            self.assertShape(dict(st, cityNames=["A", "B", "C", "D", "E"]), "state_dao_dunya")
            app.manager._runs[o["runId"]].duration = 2
            call(srv, "POST", "/api/runs/%s/control" % o["runId"], {"action": "play", "speed": 16})
            wait_week(srv, o["runId"], 2)
            deadline = time.time() + 10
            while time.time() < deadline and not call(srv, "GET", "/api/dunyalar/%s/skor" % kod)[2]:
                time.sleep(0.01)
            s, _, a = call(srv, "POST", "/api/runs/%s/dao/ad" % o["runId"], {"oyuncu": k, "ad": "Ayşe"})
            self.assertEqual(s, 200)
            self.assertShape(a, "dunya_ad")
            skor = call(srv, "GET", "/api/dunyalar/%s/skor" % kod)[2]
            self.assertShape(skor, "dunya_skor")
            self.assertEqual(skor[0]["ad"], "Ayşe")

    def test_fixture_s2_runs_branch_preparing_errors(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"OYUN_FAKE_STEP_MS": "60"}), live_app() as (srv, _a, _w):
            s, _, h = call(srv, "POST", "/api/runs", {"config": CONFIG, "fastForwardTo": 40})
            self.assertEqual(s, 201)
            self.assertShape(h, "handle")                                  # preparing/parentRunId/forkWeek isteğe bağlı
            self.assertIn("preparing", h["state"])
            s, _, b = call(srv, "POST", "/api/runs", {"config": CONFIG, "fastForwardTo": 5})
            self.assertEqual(b, FIX["error_busy_preparing"])
            lst = call(srv, "GET", "/api/runs")[2]
            self.assertShape(lst, "runs_list")
            s, _, b = call(srv, "POST", f"/api/runs/{h['runId']}/branch", {"week": 3, "patch": {"dunya_tohumu": 1}})
            self.assertEqual((s, b), (422, FIX["error_422_branch"]))
            call(srv, "DELETE", f"/api/runs/{h['runId']}")
            a = create_run(srv)
            s, _, c = call(srv, "POST", f"/api/runs/{a}/branch", {"week": 3})
            self.assertEqual(s, 201)
            self.assertEqual((c["state"]["parentRunId"], c["state"]["forkWeek"], c["state"]["preparing"]), (a, 3, {"done": 0, "total": 3}))
            self.assertShape({"runId": c["runId"], "state": dict(c["state"])}, "state_preparing")
            ids = [create_run(srv)]
            self.assertEqual(len(ids), 1)

    def test_fixture_sse_events_and_version_event(self):
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            for _ in range(3):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 3)
            s, _, res = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertTrue(res["accepted"], res)
            self.assertShape(res, "change_accepted")
            for _ in range(8):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step"})
            wait_week(srv, rid, res["seamWeek"])
            deadline = time.time() + 30
            while time.time() < deadline and app.manager.stats(rid)["released"] < res["seamWeek"]:
                time.sleep(0.01)
            self.assertGreaterEqual(app.manager.stats(rid)["released"], res["seamWeek"], "seam haftası yayımlanmadı")
            st = Stream(srv, rid)
            try:
                items = read_until(st, lambda it, out: any(i[0] != "ping" and i[1] == "world_event" for i in out))
            finally:
                st.close()
            ev = next(i[2] for i in items if i[0] != "ping" and i[1] == "world_event")
            self.assertShape(ev, "version_event")
            self.assertEqual(ev["textKey"], "event.version")
            self.assertShape(next(i[2] for i in items if i[0] != "ping" and i[1] == "week"), "packet")
            self.assertShape(items[0][2], "state_running" if items[0][2]["status"] != "ready" else "state_ready")

    def test_fixture_ended_and_state_ended(self):
        from tests.route_helpers import make_cfg
        with live_app(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0})) as (srv, _a, _w):
            rid = create_run(srv)
            st = Stream(srv, rid, timeout=30)
            try:
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
                real = [i for i in st.items() if i[0] != "ping"]
            finally:
                st.close()
            self.assertShape(real[-1][2], "ended")
            self.assertShape(real[-2][2], "state_ended")
            s, _, b = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertEqual((s, b), (200, FIX["change_ended"]))

    def test_fixture_failed_state(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {"OYUN_FAKE_FAIL_WEEK": "2"}):
            with live_app() as (srv, _a, _w):
                rid = create_run(srv)
                for _ in range(4):
                    call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
                    time.sleep(0.05)
                deadline = time.time() + 30
                state = None
                while time.time() < deadline:
                    state = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]
                    if state["status"] == "failed":
                        break
                    call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step"})
                    time.sleep(0.02)
                self.assertEqual(state["status"], "failed")
                self.assertEqual(state["error"]["messageKey"], "hata.model_coktu")
                self.assertShape(state, "state_failed")


if __name__ == "__main__":
    unittest.main()
