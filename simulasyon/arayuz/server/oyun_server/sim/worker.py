"""İşçi süreç (A5): stdin'den NDJSON komut, stdout'a NDJSON olay. `python -P -m oyun_server.sim.worker`.

Oturum çekirdeği (`Session`) süreç dışı kullanım için de açıktır (testing.InProcWorker aynı çekirdeği iş parçacığında koşar).
Yama adımlar arasında, atomik uygulanır: her adımdan önce bekleyen tüm komutlar sırayla işlenir.

S2: `init.schedule = [{week, overrides, version}]` (tarif takvimi; `week` artan) her entry `host.week == week` olunca, o
haftanın adımından ÖNCE uygulanır (`patched` olayı `scheduled:true`). `ff` komutu `target` gibi ilerler ama hazırlık
için: her 10 haftada bir `progress` olayı (`{week, total}`) yayımlar.

S5: `week` olayı host `snapshot()` verirse `cities`, `chain` ve (PLAN-TAKIP) `holdings` bloklarını taşır. `drawer` komutu (`{id, kind, ref}`) adımlar arasında,
o anki (en son hesaplanan) dünyadan salt okur ve `{ev:"drawer", id, week, data}` ya da `{ev:"drawer", id, error}` yanıtlar; adım atmaz.

T6a (DAO oyunu): `week` olayı host `dao_gozlem()` verirse (HUMAN_ON açık) `dao` bloğunu taşır (Kurucu'da anahtar yoktur). `karar` komutu (`{id, karar}`) adımlar arasında
host `dao_karar` ile oyuncu kararını sıraya koyar ve `{ev:"karar", id, kabul:true, hafta}` ya da `{ev:"karar", id, kabul:false, kod, fields}` yanıtlar (`kod` = hata kodu;
red koşuyu düşürmez; `fields` öğesi alan kimliği dizgesi ya da nedenli `{id, reason}`: ör. ahırdayken `ayril` -> `{id:"tur", reason:"ahirda"}`);
`hafta` = kararın uygulanacağı model haftası.
"""
from __future__ import annotations

import json
import os
import queue
import signal
import sys
import threading
import traceback
from typing import Any, Callable

from .drawers import UnknownRef

_LEAK_KEYS = ("DBGF", "SDUMP", "KDUMP", "BDUMP", "PFDUMP", "SECDUMP", "MODEL_PARAMS")


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _alan_nedeni(x: Any) -> Any:
    """Karar hatasının alan öğesi: nedenli `{id, reason}` (modelin `KararHatasi.fields` öğesi) olduğu gibi, gerisi dizge (neden sunucuda `invalid`)."""
    if isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("reason"), str):
        return {"id": x["id"], "reason": x["reason"]}
    return str(x)


def make_host(spec: dict[str, Any]):
    kind = spec.get("host", "model")
    overrides = spec.get("overrides") or {}
    weeks = spec.get("weeks", 200)
    root = spec.get("model_root")
    csv_dir = spec.get("csv_dir")             # ebeveynin oluşturduğu geçici dizin (kill'de ebeveyn siler)
    if not root:
        from .. import config
        root = str(config.MODEL_ROOT)
    if kind == "fake":
        from ..testing import FakeHost
        return FakeHost(root, overrides, weeks, csv_dir=csv_dir, live_keys=spec.get("live_keys"))
    if kind == "model":
        from .host import ModelHost
        from . import nufus
        if nufus.needs_split(overrides):          # D4: kesirli NPC_Y modelde sessizce kesilir; aynı toplamla NPC_X'e bölünür
            from ..registry import defaults
            overrides = nufus.to_model(overrides, defaults.read_param_defaults(root))
        return ModelHost(root, overrides, weeks, live_keys=spec.get("live_keys"), csv_dir=csv_dir, hafiza=spec.get("hafiza") is True)    # B3: yalnız tarayıcı kipi (`InProcClient`) açar; sunucu kipinde anahtar yok
    raise ValueError("bilinmeyen host: %r" % (kind,))


class SessionCore:
    """B2: bloklamayan oturum çekirdeği. `handle(cmd)` bir komutu hemen işler (hafta HESAPLAMAZ), `advance()` en çok bir hafta atar.
    Kuyruk ve iş parçacığı yok: tarayıcıda (Pyodide) JS zamanlayıcısı `advance()`i, sunucuda `Session.run` aynı çekirdeği kuyrukla sarar."""

    def __init__(self, emit: Callable[[dict], None], host_factory: Callable[[dict], Any] = make_host,
                 before_step: Callable[[], None] | None = None):
        self.emit, self.host_factory, self.before_step = emit, host_factory, before_step
        self.host = None
        self.init_cmd: dict | None = None
        self.target = 0
        self.version = 0
        self.schedule: list[dict] = []
        self.firms_on = False
        self.ff_total = 0                      # >0: hızlı ilerleme hedefi (progress olayları için)

    def _bad(self) -> bool:
        self.emit({"ev": "failed", "error": "bad_cmd"})
        return True

    def _fail(self, week: int, e: BaseException) -> bool:
        self.emit({"ev": "failed", "week": week, "error": "%s: %s" % (type(e).__name__, e)})
        return True

    def handle(self, cmd: Any) -> bool:
        """True = bitir."""
        if not isinstance(cmd, dict):
            return self._bad()
        name = cmd.get("cmd")
        if name == "shutdown":
            return True
        if name == "init":
            if self.host is not None:
                return self._bad()
            ov, weeks = cmd.get("overrides", {}), cmd.get("weeks", 200)
            if not isinstance(ov, dict) or not _is_int(weeks) or weeks < 1:
                return self._bad()
            sched = cmd.get("schedule") or []
            if not self._schedule_ok(sched):
                return self._bad()
            self.schedule = [dict(e) for e in sched]
            self.init_cmd = dict(cmd)                                  # B1: anlık görüntü (`snapshot.dump_session`) tarifi buradan alır
            self.firms_on = cmd.get("firms") is True                  # yalnız canlı koşu ister (jobs işçileri firma anlık görüntüsü üretmez)
            try:
                self.host = self.host_factory(cmd)
            except Exception as e:
                return self._fail(0, e)
            ready = {"ev": "ready", "model_version": getattr(self.host, "model_version", "?"),
                     "hashseed": os.environ.get("PYTHONHASHSEED"),
                     "env_leak": [k for k in _LEAK_KEYS if k in os.environ]}
            firms = getattr(self.host, "firm_rows", None)
            if self.firms_on and callable(firms) and ov.get("HUMAN_ON"):
                try:                                                 # yalnız DAO: hafta 0 haritası (oyuncu ilk paketten önce şehri görür); Kurucu'nun `ready`si değişmez
                    ready["firms"] = firms()
                except Exception:                                    # noqa: BLE001  yardımcıdır: hata koşuyu düşürmez
                    traceback.print_exc(file=sys.stderr)
            gozlem0 = getattr(self.host, "dao_gozlem", None)
            if self.firms_on and callable(gozlem0) and ov.get("HUMAN_ON"):
                try:                                                 # yalnız DAO: hafta 0 gözlemi (üst metrikler ilk paketten önce dolu); Kurucu'nun `ready`si değişmez
                    dao0 = gozlem0()
                    if dao0 is not None:
                        ready["dao"] = dao0
                except Exception:                                    # noqa: BLE001  yardımcıdır: hata koşuyu düşürmez
                    traceback.print_exc(file=sys.stderr)
            self.emit(ready)
            return False
        if self.host is None:
            return self._bad()
        if name == "drawer":
            return self._drawer(cmd)
        if name == "karar":
            return self._karar(cmd)
        if name == "target":
            wk = cmd.get("week")
            if not _is_int(wk) or wk < 0:
                return self._bad()
            self.target = min(wk, self.host.weeks)
            return False
        if name == "ff":
            wk = cmd.get("week")
            if not _is_int(wk) or wk < 0:
                return self._bad()
            self.target = max(self.target, min(wk, self.host.weeks))
            self.ff_total = self.target
            return False
        if name == "patch":
            ov = cmd.get("overrides")
            ver = cmd.get("version", self.version + 1)
            if not isinstance(ov, dict) or not _is_int(ver):
                return self._bad()
            try:
                self.host.patch(ov)
            except Exception as e:
                return self._fail(self.host.week, e)
            if self.host.week == 0:                # gerçek dikiş 0 (henüz hesap yok): başlangıç kuralı, sürüm 1 kalır
                ver = 1
            self.version = ver
            self.emit({"ev": "patched", "from_week": self.host.week, "version": ver})
            return False
        return self._bad()

    def _drawer(self, cmd: dict) -> bool:
        """S5: çekmece: o anki dünyadan salt okuma (adım atmaz). Yanıt: `{ev:"drawer", id, week, data}` ya da `{ev:"drawer", id, error}`
        (`not_found`: bilinmeyen kayıt; `failed`: okuma hatası; ikisi de koşuyu düşürmez)."""
        rid, kind, ref = cmd.get("id"), cmd.get("kind"), cmd.get("ref")
        if not _is_int(rid) or not isinstance(kind, str) or not isinstance(ref, str):
            return self._bad()
        fn = getattr(self.host, "drawer", None)
        if not callable(fn):
            self.emit({"ev": "drawer", "id": rid, "error": "failed"})
            return False
        try:
            data = fn(kind, ref)
        except UnknownRef:
            self.emit({"ev": "drawer", "id": rid, "error": "not_found"})
            return False
        except Exception:                                     # noqa: BLE001  okuma hatası koşuyu düşürmez
            traceback.print_exc(file=sys.stderr)
            self.emit({"ev": "drawer", "id": rid, "error": "failed"})
            return False
        self.emit({"ev": "drawer", "id": rid, "week": self.host.week, "data": data})
        return False

    def _karar(self, cmd: dict) -> bool:
        """T6a: DAO kararı. Yanıt: `{ev:"karar", id, kabul:true, hafta}` ya da `{ev:"karar", id, kabul:false, kod, fields}`. Geçersiz karar (ValueError; `str(e)` kod) ve
        host'ta DAO desteği yokluğu (`karar_gecersiz`) koşuyu düşürmez; beklenmedik hata izi stderr'e yazılır ve yine `karar_gecersiz` döner."""
        rid, karar = cmd.get("id"), cmd.get("karar")
        if not _is_int(rid) or not isinstance(karar, dict):
            return self._bad()
        fn = getattr(self.host, "dao_karar", None)
        if not callable(fn):
            self.emit({"ev": "karar", "id": rid, "kabul": False, "kod": "karar_gecersiz", "fields": ["human"]})
            return False
        try:
            hafta = fn(karar)
        except ValueError as e:
            fields = [_alan_nedeni(x) for x in getattr(e, "fields", ())]
            self.emit({"ev": "karar", "id": rid, "kabul": False, "kod": str(e) or "karar_gecersiz", "fields": fields})
            return False
        except Exception:                                     # noqa: BLE001  karar hatası koşuyu düşürmez
            traceback.print_exc(file=sys.stderr)
            self.emit({"ev": "karar", "id": rid, "kabul": False, "kod": "karar_gecersiz", "fields": []})
            return False
        self.emit({"ev": "karar", "id": rid, "kabul": True, "hafta": hafta})
        return False

    @staticmethod
    def _schedule_ok(sched: Any) -> bool:
        if not isinstance(sched, list):
            return False
        prev = 0
        for e in sched:
            if (not isinstance(e, dict) or not _is_int(e.get("week")) or e["week"] < prev or e["week"] < 1
                    or not isinstance(e.get("overrides"), dict) or not e["overrides"] or not _is_int(e.get("version"))):
                return False
            prev = e["week"]
        return True

    def _apply_due(self) -> bool:
        """Çizelgede sırası gelen yamalar (host.week == week): True = hata (failed yayımlandı)."""
        while self.schedule and self.schedule[0]["week"] <= self.host.week:
            e = self.schedule.pop(0)
            try:
                self.host.patch(e["overrides"])
            except Exception as ex:
                self._fail(self.host.week, ex)
                return True
            self.version = e["version"]
            self.emit({"ev": "patched", "from_week": self.host.week, "version": self.version, "scheduled": True})
        return False

    def idle(self) -> bool:
        """Hesaplanacak hafta yok (host yok ya da hedefe varıldı)."""
        return self.host is None or self.host.week >= self.target

    def advance(self) -> bool:
        """Vadesi gelen takvim yamalarını uygular, hedefe varılmadıysa TEK hafta adımı atar (olay yayımlar). True = oturum bitti/düştü.
        Bekleyen komutlara bakmaz: komutlar `handle` ile adımlar arasında işlenir (Session.run kuyruktan, tarayıcı çekirdeği `send` anında)."""
        if self.host is None:
            return False
        if self.idle():
            # Boştayken de vadesi gelen takvim yamaları uygulanır (ör. dal W'de duraklamış): adım arası olmadığından
            # sonuç yeniden kurmayla aynıdır; sonraki canlı yama doğru sürüm sırasıyla ardına eklenir.
            return self._apply_due()
        if self.before_step is not None:
            self.before_step()
        if self._apply_due():
            return True
        wk = self.host.week + 1
        try:
            row = self.host.step()
        except Exception as e:
            self._fail(wk, e)
            return True
        facts = getattr(self.host, "facts", None)
        if callable(facts):                                  # tanı olguları (model satırında olmayanlar), satıra eklenir
            row = {**row, **facts()}
        ev = {"ev": "week", "week": wk, "version": self.version, "row": row}
        snap = getattr(self.host, "snapshot", None)
        if callable(snap):                                   # S5: şehir satırları ve zincir (`cities`, `chain`)
            try:
                ev.update(snap())
            except Exception:                                # noqa: BLE001  bu bloklar yardımcıdır: hata koşuyu düşürmez
                traceback.print_exc(file=sys.stderr)
        gozlem = getattr(self.host, "dao_gozlem", None)
        if callable(gozlem):                                 # T6a: DAO gözlemi (HUMAN_ON kapalıysa None: anahtar yok); yardımcıdır, hata koşuyu düşürmez
            try:
                dao = gozlem()
                if dao is not None:
                    ev["dao"] = dao
            except Exception:                                # noqa: BLE001
                traceback.print_exc(file=sys.stderr)
        firms = getattr(self.host, "firm_rows", None)
        if self.firms_on and callable(firms) and _firms_due(wk, self.host.weeks, "dao" in ev):
            try:                                             # D2: firma düzeyi anlık görüntü HAFTA OLAYINA gömülür (ayrı olay yok: sıra yarışı olamaz)
                ev["firms"] = firms()
            except Exception:                                # noqa: BLE001  yardımcıdır: hata koşuyu düşürmez
                traceback.print_exc(file=sys.stderr)
        self.emit(ev)
        if self.ff_total and wk % 10 == 0 and wk < self.ff_total:
            self.emit({"ev": "progress", "week": wk, "total": self.ff_total})
        return False

    def close(self) -> None:
        if self.host is not None:
            try:
                self.host.close()
            except Exception:
                pass


class Session(SessionCore):
    """cmds: komut sözlükleri kuyruğu (`None` = girdi sonu). emit: olay yazıcı. Dönüşte süreç/iş parçacığı biter. Çekirdek `SessionCore`, burası kuyrukla sarar."""

    def __init__(self, cmds: "queue.Queue", emit: Callable[[dict], None],
                 host_factory: Callable[[dict], Any] = make_host,
                 before_step: Callable[[], None] | None = None):
        super().__init__(emit, host_factory, before_step)
        self.cmds = cmds

    _handle = SessionCore.handle

    def run(self) -> None:
        try:
            while True:
                idle = self.idle()
                # Boştayken de vadesi gelen takvim yamaları uygulanır (ör. dal W'de duraklamış): adım arası olmadığından
                # sonuç yeniden kurmayla aynıdır; sonraki canlı yama doğru sürüm sırasıyla ardına eklenir.
                if idle and self.host is not None and self._apply_due():
                    return
                try:
                    cmd = self.cmds.get(block=idle)
                except queue.Empty:
                    cmd = queue.Empty            # bekleyen komut yok: sıradaki adım
                if cmd is None:
                    return
                if cmd is not queue.Empty:
                    if self.handle(cmd):
                        return
                    continue
                if self.advance():
                    return
        finally:
            self.close()


def _firms_due(wk: int, weeks: int, dao: bool) -> bool:
    """Firma anlık görüntüsü her hafta (`firms_on` isteyen canlı koşuda): DAO her hafta tam harita, Kurucu 1./10'un katları/son haftada tam harita, aradaki haftalarda `haritaFark`.
    Tam/delta kararı yöneticidedir (diske yazım kadansı da orada: `firmalar.jsonl` 10 haftada bir)."""
    return True


def main() -> int:
    # Protokol kanalı: fd 1'in kopyası. fd 1 ve sys.stdout stderr'e yönlenir (print/C çıktısı protokolü bozamaz).
    proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    cmds: "queue.Queue" = queue.Queue()

    def reader() -> None:
        try:
            for line in sys.stdin.buffer:
                line = line.strip()
                if not line:
                    continue
                try:
                    cmds.put(json.loads(line))
                except ValueError:
                    cmds.put({"cmd": "\0bad"})
        except Exception:
            pass
        cmds.put(None)

    threading.Thread(target=reader, daemon=True).start()

    def emit(ev: dict) -> None:
        proto.write(json.dumps(ev, separators=(",", ":"), default=repr) + "\n")
        proto.flush()

    failed: list[int] = []

    def emit_tracked(ev: dict) -> None:
        if ev.get("ev") == "failed":
            failed.append(1)
        emit(ev)

    try:
        Session(cmds, emit_tracked).run()
    except OSError:
        return 1
    try:
        proto.flush()
    except OSError:
        pass
    return 1 if failed else 0


if __name__ == "__main__":
    code = main()
    try:
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(code)      # stdin okuyucu iş parçacığı kapanışta "could not acquire lock" ile SIGABRT üretmesin
