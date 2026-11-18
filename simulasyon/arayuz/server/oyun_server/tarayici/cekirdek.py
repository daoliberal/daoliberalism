"""B2: tarayıcı çekirdeği (Pyodide, Web Worker). Sunucunun Python tarafı, süreç içi ve bloklamayan biçimde: HTTP, iş parçacığı, alt süreç, SSE yok.

Kullanım (Worker tarafı, JS):
  - `istek(yontem, yol, govde)` / `istek_json(...)`: `/api/...` uçları (`runs/routes.py`), sunucuyla aynı gövde ve hata sözleşmesi.
  - `tick()`: JS zamanlayıcısı çağırır (`RunManager.tick`): pump + her canlı koşuda en çok BİR hafta adımı + olay işleme. Hafta başına bir `tick()`, aralarda
    JS mesaj kuyruğuna nefes verilmelidir (bir adım 3-6 sn; istek gecikmesi = adım süresi).
  - `GET /api/runs/<id>/events` SSE yerine `{"abone": n}` verir; `olaylar(n)` o ana dek biriken olayları `[{id, event, data}]` olarak boşaltır, `olay_kapat(n)` aboneliği keser.
  - `p50_ayarla(sn)`: `/api/hello` `sec_per_week_p50` değeri Pyodide'deki gerçek ölçümden (S4) gelir.
B4a kayıt/devam (Python tarafı; tel biçimi `tel_b4.json`): `goruntu_gerekli(kosu)` (kadans 13/26 hf: `goruntu.kadans`), `goruntu_al(kosu, sink)` (görüntü parçaları `sink`e + yönetici durumu),
`gunluk_al(kosu, sonra)` (kabul edilen karar/şart girişleri), `devam(goruntu, gunluk, hedef, ...)` (görüntüyü yükle + günlüğü oynat, en çok 12 hf), `tariften_oynat(tarif, gunluk, hedef)` (görüntü uyumsuzsa baştan).
B3 bellek sözleşmesi: Python yalnız son `PAKET_PENCERESI` (4) haftanın paketini tutar ve YALNIZ en az bir abone varken kırpar (abonesiz haftalar birikir; abone gelince hepsi oynar).
Köprü her koşuya (dal dahil) koşu yaratılır yaratılmaz abone olmalıdır (`GET /api/runs/<id>/events`). Köprü (Worker JS) HER `week` olayını `olaylar()` ile alıp IndexedDB'ye yazmakla yükümlüdür (olay akışı tek kaynak:
yeni abonelik yalnız pencereyi yeniden oynatır). Pencere dışı `/weeks` ve çekmece (`?week=`) istekleri `istek()` içinde `arsiv_gerek` döndürür; köprü o haftaları IndexedDB'den verip isteği `arsiv=[...]` ile yineler.
Sınırlar: `MAX_RUNS` 2 (tek oyun + en çok 1 dal; ebeveyn korunur, üçüncü koşu abonesiz en eskiyi çıkarır, hepsi abone ise 429), iş işçisi (`jobs`) ve dünya deposu yok, koşu diske yazılmaz.
"""
from __future__ import annotations

import copy
import json
import re
import types
import uuid
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from .. import config
from ..http import Response, Route
from ..registry import defaults as defaults_mod
from ..registry import loader
from ..runs import routes
from ..runs.manager import CLOSED, RunManager, UnknownRun
from ..security import HttpError
from ..sim import host as host_mod
from ..sim.extract_cities import static_world_info
from . import devam as devam_mod
from . import goruntu as goruntu_mod
from .istemci import inproc_factory
from .yonlendirici import Yonlendirici

MAX_RUNS = 2                                                  # tek oyun + en çok 1 dal (dal ebeveyni korur: 2 eşzamanlı koşu)
PAKET_PENCERESI = 4                                           # B3: Python'da yalnız son 4 haftanın paketi kalır; eski haftalar JS/IndexedDB'de (abone olay akışından), `/weeks` köprüden

_WEEKS_RE = re.compile(r"/runs/(?P<id>[^/]+)/weeks")
_DRAWER_RE = re.compile(r"/runs/(?P<id>[^/]+)/drawer/[^/]+/[^/]+")
_SAYI_RE = re.compile(r"[0-9]{1,6}")


def tarayici_cfg(base=config):
    """`config` modülünün büyük harfli sabitleri + tarayıcı ayarları (`MAX_RUNS` 2); karar dosyası okuması da `max_runs` 2 verir."""
    ns = types.SimpleNamespace(**{k: getattr(base, k) for k in dir(base) if k.isupper()})
    ns.MAX_RUNS = MAX_RUNS
    ns.load_live_keys = base.load_live_keys
    ns.load_decisions = lambda: {**base.load_decisions(), "max_runs": MAX_RUNS}
    return ns


def _json_dumps(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


class TarayiciCekirdegi:
    def __init__(self, model_root: str | None = None, host_factory: Callable[[dict], Any] | None = None,
                 sec_per_week_p50: float | None = None, defaults: dict | None = None, registry: Any = None, cfg: Any = None,
                 paket_penceresi: int | None = PAKET_PENCERESI, pyodide_surumu: str | None = None):
        """`defaults`/`registry` yalnız testler içindir (verilmezse model varsayılanları süreç içinde okunur, kayıt yüklenir).
        `paket_penceresi` (B3): Python'da tutulan son hafta sayısı; None = hepsi (karşılaştırma/test).
        `pyodide_surumu` (B4a): Pyodide'de `pyodide.__version__` okunur; okunamıyorsa (CPython testleri) çağıran verir (uyumluluk anahtarına girer)."""
        if paket_penceresi is not None and (type(paket_penceresi) is not int or paket_penceresi < 1):
            raise ValueError("paket_penceresi None ya da >= 1 tam sayı olmalı: %r" % (paket_penceresi,))
        self.model_root = str(model_root or config.MODEL_ROOT)
        self.cfg = cfg or tarayici_cfg()
        with defaults_mod.inproc_baglami():
            d = defaults if defaults is not None else defaults_mod.read_param_defaults(self.model_root)
            reg = registry if registry is not None else loader.load_registry(loader.DEFAULT_DATA_DIR, d)
            self.manager = RunManager(reg, inproc_factory(self.model_root if host_factory is None else None, host_factory),
                                      cfg=self.cfg, runs_dir=None)
            self.manager.cooperative = True
            self.manager.gunluk_kayit = True                        # B4a: karar/şart girişleri yeniden oynatma günlüğüne
            self.manager.packet_keep = paket_penceresi
            self.manager.defaults_hash = defaults_mod.defaults_hash(d)
            self.app = routes.App(reg, self.manager, str(d["VERSION"]), defaults_mod.defaults_hash(d), routes.PING_S, sec_per_week_p50,
                                  surum=host_mod.guncel_surum(self.model_root, str(d["VERSION"])))
            self.app.world_info = static_world_info(d, routes.MAX_CITIES)
        self.app.capabilities["jobs"] = False                   # tarayıcıda iş işçisi yok
        rotalar = [r for r in routes.make_routes(self.app) if not r.pattern.pattern.endswith("/events")]
        rotalar.append(Route("GET", re.compile(r"/runs/(?P<id>[^/]+)/events"), self._olay_ac))
        self.yonlendirici = Yonlendirici(rotalar)
        self._aboneler: dict[int, list] = {}                    # abone no -> [Subscription, sıradaki olay no]
        self._abone_no = 0
        self.pyodide_surumu = pyodide_surumu
        self._goruntu_kaydi: dict[str, tuple[int, int | None]] = {}   # koşu -> (son görüntü haftası, son ham bayt); kadans kararı için

    # ---- API ---------------------------------------------------------------------------------------------------
    def istek(self, yontem: str, yol: str, govde: Any = None, arsiv: list | None = None) -> dict:
        """`{status, headers, body}`; gövde JSON turundan geçer (HTTP'den dönen gövdeyle aynı türler: tuple -> liste).

        B3 köprü sözleşmesi: `/runs/<id>/weeks` ve `/runs/<id>/drawer/...?week=` istekleri pencere dışına (son `PAKET_PENCERESI` haftadan eski) düşerse
        `{"status": 0, "headers": {}, "body": None, "arsiv_gerek": {"runId", "from", "to"}}` döner (eksik haftalar); köprü o haftaların paketlerini JS/IndexedDB'den
        okuyup AYNI isteği `arsiv=[paket, ...]` ile yineler. Köprü `arsiv_gerek` kalmayana dek SINIRLI sayıda (en çok 3) yinelemelidir: IndexedDB beklenirken
        `tick()` bir hafta daha yayımlayıp pencereyi kaydırabilir ve yeni düşen hafta yeniden istenir. `arsiv` yalnız bu çağrı süresince görünür; paketin `run_id`si
        koşuyla eşleşmeli ve `week` tam sayı olmalıdır (aksi yok sayılır)."""
        r = self._isle(yontem, yol, govde, arsiv)
        if "arsiv_gerek" in r:
            return r
        return {"status": r["status"], "headers": r["headers"], "body": None if r["body"] is None else json.loads(_json_dumps(r["body"]))}

    def istek_json(self, yontem: str, yol: str, govde_json: str | None = None, arsiv_json: str | None = None) -> str:
        """JS sınırı için dizge arayüzü: gövde JSON dizgesi, yanıt `{"status", "headers", "body"}` JSON dizgesi (`arsiv_gerek` ve yineleme kuralı: bkz. `istek`; `arsiv_json` paket listesi dizgesi)."""
        return _json_dumps(self._isle(yontem, yol, govde_json, None if arsiv_json is None else json.loads(arsiv_json)))

    # ---- B4a: kayıt ve devam -----------------------------------------------------------------------------------
    def uyumluluk_anahtari(self) -> dict:
        """`{"model_sha256", "pyodide", "schema"}` (görüntü başlığındaki anahtar ile aynı; B4b `kosular` kaydına yazar ve açılışta karşılaştırır)."""
        return goruntu_mod.uyumluluk_anahtari(self.model_root, self.pyodide_surumu)

    def goruntu_gerekli(self, kosu_id: str) -> bool:
        """Son görüntüden beri `goruntu.kadans(son ham bayt)` hafta (13; ham görüntü > 300 MB ise 26) yayımlandı mı? (Yalnız karar; alma `goruntu_al`.)"""
        run = self.manager._runs.get(kosu_id)
        if run is None or run.status in ("ended", "failed") or run.worker is None:
            return False
        son, ham = self._goruntu_kaydi.get(kosu_id, (0, None))
        return run.released - son >= goruntu_mod.kadans(ham)

    def goruntu_al(self, kosu_id: str, sink: Callable[[bytes], Any]) -> dict:
        """Koşunun görüntüsünü alır: sıkışık parçalar `sink(bytes)` ile hemen verilir; dönüş JSON'a dönüşebilir:
        `{"hafta", "yayimlanan", "goruntu_kimligi", "ham", "sikisik", "parca", "anahtar", "gunluk_sira", "yonetici"}`. Adımlar arasında çağrılır (tick içinde değil).
        Şimdi alınamazsa `devam.GoruntuHazirDegil` (hazırlık, bekleyen değişiklik/karar/çekmece, koşu bitti): çağıran sonraki tick'te yineler."""
        kimlik = uuid.uuid4().hex
        with self.manager._lock:
            yonetici = devam_mod.disa_aktar(self.manager, kosu_id, kimlik)
            run = self.manager._get(kosu_id)
            bilgi = goruntu_mod.dump_session(run.worker.core, sink, ek={"goruntu_kimligi": kimlik, "kosu_id": kosu_id}, pyodide=self.pyodide_surumu)
            self._goruntu_kaydi[kosu_id] = (run.released, bilgi["raw"])
            yonetici["son_ham"] = bilgi["raw"]                       # devam sonrası kadans kararı bu boyutu hatırlar
            return {"hafta": run.worker.core.host.week, "yayimlanan": run.released, "goruntu_kimligi": kimlik, "ham": bilgi["raw"], "sikisik": bilgi["comp"],
                    "parca": bilgi["parts"], "anahtar": self.uyumluluk_anahtari(), "gunluk_sira": run.gunluk_sira, "yonetici": yonetici}

    def gunluk_al(self, kosu_id: str, sonra: int = 0) -> list:
        """Yeniden oynatma günlüğü: `sira > sonra` girişleri, kabul sırasıyla (JSON). `{"sira", "tur": "karar", "dikis", "karar"}` ya da
        `{"sira", "tur": "sart", "dikis", "yama", "not", "surum"}`; `dikis` = girişin uygulandığı an host haftası (karar `dikis + 1`. haftada etkili)."""
        with self.manager._lock:
            run = self.manager._get(kosu_id)
            return json.loads(_json_dumps([e for e in run.gunluk if e["sira"] > sonra]))

    def devam(self, goruntu: dict, gunluk: list, hedef_hafta: int, paketler: list | None = None, kosu_id: str | None = None,
              ebeveyn: tuple | list | None = None, azami_hafta: int | None = 12, ilerleme: Callable[[int], Any] | None = None) -> dict:
        """Görüntüyü yükler (en yakın görüntü; JS seçer) ve günlüğü kendi haftalarında uygulayarak `hedef_hafta`ya dek ilerler.
        `goruntu` = `{"parcalar": [bytes, ...], "yonetici": <goruntu_al().yonetici>}`; `paketler` = son <= `PAKET_PENCERESI` yayımlanmış haftanın paketi (JS deposundan; yoksa `dao_gozlem` bir sonraki haftaya dek yok);
        `kosu_id` verilirse koşu bu kimlikle kurulur (dal: yeni kimlik) ve `ebeveyn` = (ebeveyn kimliği, dal haftası). `azami_hafta`: en çok bu kadar hafta oynatılır (varsayılan 12); aşılırsa `ValueError("devam_cok_uzun")`.
        Hata: `goruntu.UyumsuzGoruntu` (sürüm farkı: B4b `tariften_oynat`a yönlendirir), `ValueError` (geçersiz hedef/eşleşmeyen görüntü), `devam.GoruntuHazirDegil` değil, `TooManyRuns`.
        Dönüş: `{"durum": "tamam"|"reddedildi"|"sapma"|"takildi"|"basarisiz", "kosu_id", "hafta", "uygulanan", "kalan", ...}` (tamam dışında `giris`, `neden`). Koşu `paused` kalır; JS hemen abone olur (`GET /events`)."""
        d = goruntu["yonetici"]
        if d.get("sema") != devam_mod.SEMA:
            raise goruntu_mod.UyumsuzGoruntu({"yonetici_sema": (d.get("sema"), devam_mod.SEMA)})
        if ebeveyn is not None and not (type(hedef_hafta) is int and d["worker_week"] <= hedef_hafta == ebeveyn[1]):
            raise ValueError("dal_goruntu_ileride: görüntü host haftası %r dal haftası %r'yi aşıyor (daha eski görüntü seçin)" % (d["worker_week"], ebeveyn[1]))
        if type(hedef_hafta) is not int or hedef_hafta < d["released"]:
            raise ValueError("hedef_hafta yayımlanan haftadan küçük: %r < %r" % (hedef_hafta, d["released"]))
        if azami_hafta is not None and hedef_hafta - d["released"] > azami_hafta:
            raise ValueError("devam_cok_uzun: %d hafta > %d" % (hedef_hafta - d["released"], azami_hafta))
        m = self.manager
        rid = kosu_id or d["id"]
        parcalar = goruntu.get("parcalar")
        it = iter(list(parcalar) + [b""]) if parcalar is not None else None
        oku = goruntu.get("oku") or (lambda: next(it))
        with defaults_mod.inproc_baglami(), m._lock:
            if rid in m._runs:
                raise ValueError("koşu kimliği zaten var: %s" % rid)
            devam_mod._yer_ac(m, ebeveyn[0] if ebeveyn else None)
            worker = m.factory({"run_id": rid})
            try:
                bilgi = goruntu_mod.load_session(worker.core, oku, csv_dir=worker.csv_dir, model_root=self.model_root, pyodide=self.pyodide_surumu,
                                                  live_keys=m.live_keys)
                ek = bilgi.get("ek") or {}
                h = worker.core.host
                if (ek.get("goruntu_kimligi") != d.get("goruntu_kimligi") or h.week != d["worker_week"] or worker.core.target != d["target"]):
                    raise ValueError("görüntü ile yönetici durumu eşleşmiyor (kimlik/hafta/hedef)")
                run = devam_mod.ice_aktar(m, d, worker, run_id=kosu_id, ebeveyn=tuple(ebeveyn) if ebeveyn else None, paketler=paketler)
            except BaseException:
                worker.kill()
                raise
            self._goruntu_kaydi[rid] = (run.released, d.get("son_ham"))
        return self._oynat(rid, gunluk, hedef_hafta, ilerleme)

    def _oynat(self, rid: str, gunluk: list, hedef: int, ilerleme: Callable[[int], Any] | None) -> dict:
        """Sürücü; beklenmeyen istisnada yarım koşu silinir (bellekte artık kalmaz) ve istisna yükselir. Reddedilen/sapan sonuçta koşu kalır (çağıran siler)."""
        try:
            with defaults_mod.inproc_baglami():
                return devam_mod.oynat(self.manager, rid, gunluk, hedef, ilerleme)
        except BaseException:
            if rid in self.manager._runs:
                self.manager.delete(rid)
            raise

    def tariften_oynat(self, tarif: dict, gunluk: list, hedef_hafta: int, kosu_id: str | None = None, azami_hafta: int | None = None,
                       ilerleme: Callable[[int], Any] | None = None) -> dict:
        """Görüntü uyumsuzsa (sürüm farkı) ya da yoksa: tarif (`{"config", "takvim"}`: `kosu.tarif`) + TAM günlükle 0. haftadan yeniden oynatır (aynı sürücü; reddedilen girişte durur).
        Uzun koşu için JS/B4b önce `azami_hafta` ile böler ya da kullanıcıya süreyi bildirir (hafta başına ~1,5-6 sn)."""
        if type(hedef_hafta) is not int or hedef_hafta < 0 or (azami_hafta is not None and hedef_hafta > azami_hafta):
            raise ValueError("hedef_hafta geçersiz ya da azami_hafta aşıldı: %r" % (hedef_hafta,))
        if kosu_id is not None and kosu_id in self.manager._runs:
            raise ValueError("koşu kimliği zaten var: %s" % kosu_id)
        with defaults_mod.inproc_baglami():
            pid, fw, dk = tarif.get("parent_id"), tarif.get("fork_week"), tarif.get("dunya_kodu")
            rid = self.manager.create(copy.deepcopy(tarif["config"]), copy.deepcopy(tarif.get("takvim") or []), None,
                                      parent=(pid, fw) if pid is not None and type(fw) is int else None,
                                      dunya=(dk, tarif.get("oyuncu")) if dk is not None else None, run_id=kosu_id)["runId"]
            self._goruntu_kaydi[rid] = (0, None)
        return self._oynat(rid, gunluk, hedef_hafta, ilerleme)

    def tarif_al(self, kosu_id: str) -> dict:
        """Yeniden oynatma tarifi `{"config", "takvim"}` (koşu kuruluşunda belirlenir, değişmez; B4b `kosular` kaydına yazar). Canlı kabul edilen değişiklikler günlüktedir."""
        run = self.manager._get(kosu_id)
        return json.loads(_json_dumps({"config": run.raw_config, "takvim": run.tarif_takvim, "parent_id": run.parent_id, "fork_week": run.fork_week,
                                       "dunya_kodu": run.dunya_kodu, "oyuncu": run.oyuncu}))

    def goruntu_al_json(self, kosu_id: str, sink: Callable[[bytes], Any]) -> str:
        return _json_dumps(self.goruntu_al(kosu_id, sink))

    def gunluk_al_json(self, kosu_id: str, sonra: int = 0) -> str:
        return _json_dumps(self.gunluk_al(kosu_id, sonra))

    def devam_json(self, parcalar: list, yonetici_json: str, gunluk_json: str, hedef_hafta: int, paketler_json: str | None = None,
                   kosu_id: str | None = None, ebeveyn_json: str | None = None, azami_hafta: int | None = 12, ilerleme: Callable[[int], Any] | None = None) -> str:
        """JS sınırı için dizge arayüzü (`devam`)."""
        return _json_dumps(self.devam({"parcalar": parcalar, "yonetici": json.loads(yonetici_json)}, json.loads(gunluk_json), hedef_hafta,
                                      None if paketler_json is None else json.loads(paketler_json), kosu_id,
                                      None if ebeveyn_json is None else json.loads(ebeveyn_json), azami_hafta, ilerleme))

    def tariften_oynat_json(self, tarif_json: str, gunluk_json: str, hedef_hafta: int, kosu_id: str | None = None, azami_hafta: int | None = None,
                            ilerleme: Callable[[int], Any] | None = None) -> str:
        return _json_dumps(self.tariften_oynat(json.loads(tarif_json), json.loads(gunluk_json), hedef_hafta, kosu_id, azami_hafta, ilerleme))

    # ---- B3: pencere dışı haftalar köprüden --------------------------------------------------------------------
    def _hedef(self, yontem: str, yol: str):
        """(koşu kimliği ya da None, (ilk, son) pencere dışına düşen haftalar ya da None). URL burada TEK kez ayrıştırılır. Geçersiz istek (aralık, bilinmeyen koşu)
        eksik hafta saymaz: normal yol 4xx verir."""
        parts = urlsplit(yol)
        if not parts.path.startswith("/api/"):
            return None, None
        sub = parts.path[4:]
        m = _WEEKS_RE.fullmatch(sub)
        d = _DRAWER_RE.fullmatch(sub) if m is None else None
        if m is None and d is None:
            return None, None
        rid = (m or d).group("id")
        run = self.manager._runs.get(rid)
        if yontem.upper() != "GET" or run is None or not run.packet_base:
            return rid, None
        q = {k: v[0] for k, v in parse_qs(parts.query, keep_blank_values=True).items()}
        if m is not None:
            a, b = q.get("from"), q.get("to")
            if a is None or b is None or not _SAYI_RE.fullmatch(a) or not _SAYI_RE.fullmatch(b):
                return rid, None
            a, b = int(a), int(b)
            if not 1 <= a <= b <= run.duration:
                return rid, None
            lo, hi = a, min(b, run.released, run.packet_base)
        else:
            w = q.get("week")
            if w is None or not _SAYI_RE.fullmatch(w):
                return rid, None
            lo = hi = int(w)
            if not 1 <= lo <= run.packet_base:
                return rid, None
        return rid, ((lo, hi) if lo <= hi else None)

    def _isle(self, yontem: str, yol: str, govde: Any, arsiv: list | None) -> dict:
        """`istek`/`istek_json` ortak gövdesi: `{"status", "headers", "body"}` (ham gövde) ya da `{"status": 0, ..., "arsiv_gerek": {...}}`."""
        rid, aralik = self._hedef(yontem, yol)
        var = {p["week"]: p for p in (arsiv or []) if isinstance(p, dict) and type(p.get("week")) is int and p.get("run_id") == rid}
        if aralik is not None:
            eksik = [w for w in range(aralik[0], aralik[1] + 1) if w not in var]
            if eksik:
                return {"status": 0, "headers": {}, "body": None, "arsiv_gerek": {"runId": rid, "from": eksik[0], "to": eksik[-1]}}
        self.manager._arsiv = {(rid, w): p for w, p in var.items()}
        try:
            with defaults_mod.inproc_baglami():
                status, headers, body = self.yonlendirici.isle(yontem, yol, govde)
        finally:
            self.manager._arsiv = {}
        return {"status": status, "headers": headers, "body": body}

    def tick(self) -> None:
        with defaults_mod.inproc_baglami():
            self.manager.tick()

    def p50_ayarla(self, sn: float | None) -> None:
        self.app.sec_per_week_p50 = sn

    # ---- olaylar (SSE yerine) ----------------------------------------------------------------------------------
    def _olay_ac(self, req) -> Response:
        try:
            sub = self.manager.subscribe(req.params["id"])
        except UnknownRun:
            raise HttpError(404, "not_found", "Bu koşu bulunamadı.")
        self._abone_no += 1
        self._aboneler[self._abone_no] = [sub, 0]
        return Response.json({"abone": self._abone_no})

    def olaylar(self, abone: int) -> dict:
        """Birikmiş olaylar `{"olaylar": [{id, event, data}], "kapandi": bool}`; `id` aboneliğe özel 1'den artan sıra (SSE `id:` ile aynı)."""
        kayit = self._aboneler.get(abone)
        if kayit is None:
            return {"olaylar": [], "kapandi": True}
        sub = kayit[0]
        out, kapandi = [], False
        with defaults_mod.inproc_baglami():
            while True:
                item = sub.next(0)
                if item is None:
                    break
                if item[0] == CLOSED:
                    kapandi = True
                    break
                kayit[1] += 1
                out.append({"id": kayit[1], "event": item[0], "data": item[1]})
        if kapandi:
            self._aboneler.pop(abone, None)
        return {"olaylar": json.loads(_json_dumps(out)), "kapandi": kapandi}

    def olay_kapat(self, abone: int) -> None:
        kayit = self._aboneler.pop(abone, None)
        if kayit is not None:
            kayit[0].close()

    def kapat(self) -> None:
        for n in list(self._aboneler):
            self.olay_kapat(n)
        self.manager.shutdown()
