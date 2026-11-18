"""B2: oturum anlık görüntüsü (pickle). Model davranışı ve `simkit` değişmez; yalnız host durumu seçilerek, dünya (`W`) özel Pickler ile yazılır.

Biçim (tek zlib akışı, art arda iki pickle): (1) başlık: şema, `init` komutu (tarif), host ve oturum durumu, canlı yama değerleri; (2) gövde: `W`.
Yükleme: başlıktaki tarifle host YENİDEN KURULUR (`make_host`: yeni `simbuild` modül kopyası), sonra `W` bu kopyanın sınıflarına bağlanarak okunur
(`Unpickler.find_class` kopyanın modüllerini görür; `sys.modules` dokunulmaz), canlı yamalar modül küreseline yeniden yazılır.

Pickle edilemeyen lambdalar `W` içinde özel indirgeyiciyle çözülür: (a) `phase_metrics` lambdaları (`W.is_player` ve kardeşleri) her haftanın başında yeniden kurulur -> None;
(b) `W.supply.default_factory` ve `W.tsup['by_kind'].default_factory` aynı davranışlı modül düzeyi eşdeğerlerine bağlanır (model koduna dokunulmaz; kanıt: kesintisiz koşuyla bayt bayt eşitlik testi).
Lambdalar KİMLİĞİYLE tanınır (modül + qualname + `co_firstlineno` + `co_names`); ÇAĞRILMAZ. Tanınmayan lambda açık hata verir (`TaninmayanLambda`).

B4a: şema 2. Başlık uyumluluk anahtarını (`model_sha256` + Pyodide sürümü + şema) taşır; `load_session` uyumsuz anahtarda `UyumsuzGoruntu` fırlatır (B4b yakalayıp "baştan yeniden oynat" akışına yönlendirir).
Host önbellekleri (`_snap_*`, `_facts_*`, `_labour_*`) görüntüye girer: yükleme sonrası aynı hafta yeniden hesaplama OLMAZ (farka dayalı host durumu iki kez ilerlemez).
"""
from __future__ import annotations

import collections
import functools
import hashlib
import json
import os
import pickle
import struct
import sys
import time
import types
import zlib
from contextlib import contextmanager
from typing import Any, Callable

SCHEMA = 2
# Host örneğinin yazılmayan alanları: model kopyası ve ondan türeyenler yeniden kurulur; CSV dizini yeni host'un. Önbellekler (`_snap_*`, `_facts_*`, `_labour_*`) YAZILIR (B4a).
HOST_SKIP = frozenset({"_model", "_mods", "_week_step", "_P", "_W", "closed", "_csv_dir", "_live_keys"})     # `_live_keys`: yeni sürümün canlı anahtar listesi geçerli (görüntüdekiyle ezilmez)
HOST_SEMA = 1                                                           # `ModelHost` durum alanlarının ANLAMI değişirse elle artırılır (alan adı kümesi ayrıca otomatik denetlenir)
HOST_TEMBEL = frozenset({"_profit_hist", "_dead_seen"})                 # `__init__`te kurulmayıp ilk kullanımda eklenen host alanları (taze host'ta yok, görüntüde olabilir)
MAGIC = b"DLGS"                                                         # görüntü biçimi: MAGIC + 4 bayt (big-endian) JSON uzunluğu + düz JSON önek (şema, anahtar, ek) + zlib(pickle(başlık), pickle(W))

# Görüntü kadansı (TEK yerde; Python karar verir, JS `goruntu_gerekli` ile sorar): 13 haftada bir; son ham görüntü eşiği aşarsa 26.
GORUNTU_KADANS = 13
GORUNTU_KADANS_UZUN = 26
HAM_ESIK_BAYT = 300 * 1024 * 1024


def kadans(son_ham_bayt: int | None) -> int:
    """Bir sonraki görüntüye dek hafta sayısı: son ham (sıkıştırılmamış) görüntü `HAM_ESIK_BAYT`ı AŞARSA 26, aksi halde 13."""
    return GORUNTU_KADANS_UZUN if son_ham_bayt is not None and son_ham_bayt > HAM_ESIK_BAYT else GORUNTU_KADANS


class UyumsuzGoruntu(ValueError):
    """Görüntü bu model/Pyodide/şema ile uyumsuz. `fark`: `{alan: (görüntüde, şimdi)}` (`model_sha256`, `pyodide`, `schema`). B4b: yakalayıp tarif + günlükle baştan oynatmaya yönlendirir."""

    def __init__(self, fark: dict):
        super().__init__("görüntü uyumsuz: %r" % (fark,))
        self.fark = fark


class GuvensizGoruntu(UyumsuzGoruntu):
    """Görüntü izin listesinde olmayan bir sınıf/işlev istiyor (bozuk ya da kötü niyetli kayıt). Hiçbir şey çalıştırılmadı. `fark = {"guvensiz": (modül, ad)}`."""


class TaninmayanReferans(TypeError):
    """YAZARKEN: `W`/başlıkta, yükleme izin listesinde (`IZIN`, `IZIN_MODEL`) olmayan bir sınıf/işlev referansı var. Görüntü yazılmaz (yüklenemeyecekti): sorun ilk kayıtta görünür."""


class TaninmayanLambda(TypeError):
    """`W` içinde modelin bilinen lambdaları dışında bir lambda var: sessiz atlama yok (davranış değişebilir)."""


def _pyodide_surumu() -> str | None:
    try:
        import pyodide                                            # yalnız Pyodide'de var
        return str(pyodide.__version__)
    except Exception:                                             # noqa: BLE001
        return None


@functools.lru_cache(maxsize=4)
def _model_sha256(model_root: str) -> str:
    """`simkit/**/*.py` + `simbuild.py` + `model_mod.py` içerik özeti; dosya sırası göreli yola göre sabit (ad + içerik özeti birlikte)."""
    dosyalar = []
    for d, ds, fs in os.walk(os.path.join(model_root, "simkit")):
        ds[:] = sorted(x for x in ds if x != "__pycache__")
        dosyalar += [os.path.join(d, f) for f in fs if f.endswith(".py")]
    dosyalar += [os.path.join(model_root, "simbuild.py"), os.path.join(model_root, "model_mod.py")]
    h = hashlib.sha256()
    for yol in sorted(dosyalar, key=lambda p: os.path.relpath(p, model_root).replace(os.sep, "/")):
        with open(yol, "rb") as fh:
            h.update(os.path.relpath(yol, model_root).replace(os.sep, "/").encode("utf-8") + b"\0" + hashlib.sha256(fh.read().replace(b"\r\n", b"\n")).digest())     # satır sonu normalleştirilir (CRLF derlemesi anahtarı bozmaz)
    return h.hexdigest()


def uyumluluk_anahtari(model_root: str | None = None, pyodide: str | None = None) -> dict:
    """`{"model_sha256", "pyodide", "schema", "host_sema"}`. `pyodide` verilmezse Python'dan okunur (Pyodide'de `pyodide.__version__`; CPython'da None). Okunamıyorsa çağıran verir."""
    if model_root is None:
        from .. import config
        model_root = str(config.MODEL_ROOT)
    return {"model_sha256": _model_sha256(str(model_root)), "pyodide": pyodide if pyodide is not None else _pyodide_surumu(), "schema": SCHEMA, "host_sema": HOST_SEMA}


# ---- lambda eşdeğerleri (modül düzeyi: pickle ada göre bulur) ----------------------------------------------------
def _dd_list():
    return collections.defaultdict(list)


def _pair():
    return [0.0, 0.0]


def _none():
    return None



# Model lambdaları KİMLİĞİYLE tanınır: (modül, qualname, `co_firstlineno`, `co_names`). Lambda ÇAĞRILMAZ (yan etki yok, `[0, 0] == [0.0, 0.0]` gibi eşitlik tuzağı yok).
# Model kodu (`simkit`) değişirse `model_sha256` değişir ve görüntü zaten uyumsuz sayılır; bu tablo o koda göredir (`test_lambda_tablosu_modelle_uyumlu` kilitler).
_PM = "phase_metrics.<locals>.<lambda>"
_NONE_LAMBDALAR = {                                                      # week_metrics.py:61-67 `W.is_player/is_npc/is_firm/is_lonca/is_city/g/dg`: her haftanın `phase_metrics` girişinde yeniden kurulur -> None
    ("simkit.week_metrics", _PM, 61, ()), ("simkit.week_metrics", _PM, 62, ()), ("simkit.week_metrics", _PM, 63, ("endswith",)),
    ("simkit.week_metrics", _PM, 64, ("endswith",)), ("simkit.week_metrics", _PM, 65, ("city_accounts",)), ("simkit.week_metrics", _PM, 66, ("sum", "bal", "items")),
    ("simkit.week_metrics", _PM, 67, ("sum", "sorted", "set", "bal", "start_bal")),
}
_LAMBDA_DD_LIST = ("simkit.week_cycle_parts", "phase_cycle_plan.<locals>.<lambda>", 130, ("defaultdict", "list"))     # `W.supply`: `defaultdict(lambda: defaultdict(list))` iç fabrikası
_LAMBDA_PAIR = ("simkit.transition", "_st.<locals>.<lambda>", 27, ())                                                 # `W.tsup['by_kind']`: `defaultdict(lambda: [0.0, 0.0])` (`[0, 0]` sayaçları başka koddur)


class SnapPickler(pickle.Pickler):
    """`reducer_override`: model lambdalarını eşdeğer adlandırılmış işlevlere bağlar. Tanınmayan lambda: AÇIK hata (`TaninmayanLambda`; sessiz atlama yok)."""
    UNKNOWN: list[str] = []

    def reducer_override(self, obj):
        if type(obj) is types.FunctionType and obj.__name__ == "<lambda>":
            c = obj.__code__
            kimlik = (obj.__module__, obj.__qualname__, c.co_firstlineno, tuple(c.co_names))
            if kimlik in _NONE_LAMBDALAR:
                return (_none, ())
            if kimlik == _LAMBDA_DD_LIST:
                return (_get_dd_list, ())
            if kimlik == _LAMBDA_PAIR:
                return (_get_pair, ())
            self.UNKNOWN.append("%s:%s:%d" % kimlik[:3])
            raise TaninmayanLambda("tanınmayan lambda: %s %s satır %d" % kimlik[:3])
        bagli = isinstance(obj, types.BuiltinFunctionType) and not isinstance(getattr(obj, "__self__", None), types.ModuleType) and getattr(obj, "__self__", None) is not None
        if not bagli and isinstance(obj, (type, types.FunctionType, types.BuiltinFunctionType)):       # bağlı yerleşik yöntem (ör. `KesimHaritasi.__getitem__`): `getattr(nesne, ad)` ile kurulur, `getattr` ve sınıfı ayrıca denetlenir          # sınıf/işlev referansı: yükleme izin listesiyle AYNI kaynak (yazarken red)
            ref = (getattr(obj, "__module__", None), getattr(obj, "__qualname__", getattr(obj, "__name__", None)))
            if ref not in IZIN and ref not in IZIN_MODEL:
                self.UNKNOWN.append("%s:%s" % ref)
                raise TaninmayanReferans("izin listesinde olmayan referans: %s.%s (görüntü yüklenemezdi; `goruntu.IZIN`/`IZIN_MODEL` güncellenmeli)" % ref)
        return NotImplemented


def _get_dd_list():
    return _dd_list


def _get_pair():
    return _pair


# `find_class` İZİN LİSTESİ (gerçek görüntüden çıkarıldı; `test_izin_listesi_gercek_goruntuyle_ayni`): yalnız bunlar ve host'un model kopyasındaki (`simkit.*`/`model_mod`) kendi tanımlı sınıf/işlevler.
IZIN = frozenset({
    ("builtins", "float"), ("builtins", "int"), ("builtins", "list"), ("builtins", "set"), ("builtins", "frozenset"), ("builtins", "dict"), ("builtins", "tuple"),
    ("builtins", "str"), ("builtins", "bool"), ("builtins", "bytes"), ("builtins", "getattr"),
    ("collections", "defaultdict"), ("collections", "deque"), ("collections", "OrderedDict"), ("functools", "partial"),
    ("oyun_server.sim.extract_ekonomi", "EkonomiState"), ("oyun_server.sim.flowhook", "KesimHaritasi"), ("oyun_server.sim.flowhook", "KesimMatrisi"),
    ("oyun_server.sim.labour", "LabourState"), ("oyun_server.sim.makro", "MakroState"),
    ("oyun_server.tarayici.goruntu", "_get_dd_list"), ("oyun_server.tarayici.goruntu", "_get_pair"), ("oyun_server.tarayici.goruntu", "_none"),
    ("oyun_server.tarayici.goruntu", "_dd_list"), ("oyun_server.tarayici.goruntu", "_pair"),                 # yüklenmiş dünyanın yeniden görüntülenmesinde fabrikalar doğrudan görülür
})


_GETATTR_IZIN = frozenset({"__getitem__"})


# Model kopyasından (host'un `simkit.*`/`model_mod` modülleri) istenebilen sınıf/işlevler: gerçek görüntüden (yükle -> yeniden görüntüle -> yükle zinciri) çıkarıldı, `test_izin_listesi_gercek_goruntuyle_ayni` kilitler.
# `bond_hook`/`bond_room`: `week_open.py:121-122` `partial(bond_hook, W)` yalnız MONEY_CAP + BOND_ON + hafta > MINT_OPEN_WEEKS iken kurulur (kısa görüntüde görünmez; 40 hf Kurucu testinde görüldü).
IZIN_MODEL = frozenset({("simkit.ledger", "Ledger"), ("simkit.results", "results"), ("simkit.world", "World"), ("simkit.policy", "bond_hook"), ("simkit.policy", "bond_room"),
                                                   ("simkit.credit_money", "CreditMoney")}      # `CREDIT_MONEY=1` (kart): `world_init.py:612-615` `W.cm = L.cm = CreditMoney(W)`
                       | {("simkit.world", "fac_%02d" % i) for i in range(1, 13)})


def _guvenli_getattr(obj, ad, *varsayilan):
    """Bağlı yöntem/öznitelik yeniden kurulumu için `getattr`; `_` ile başlayan adlar (dunder zincirleri) reddedilir (gerçek görüntüde yalnız `__getitem__` görülür: `KesimHaritasi`)."""
    if not isinstance(ad, str) or (ad.startswith("_") and ad not in _GETATTR_IZIN):
        raise GuvensizGoruntu({"guvensiz": ("builtins", "getattr:%s" % (ad,))})
    return getattr(obj, ad, *varsayilan)


class SnapUnpickler(pickle.Unpickler):
    """`find_class`: `mods` (host'un modül kopyası) varsa `simkit.*`/`model_mod` oradan (yalnız o modülde TANIMLI sınıf/işlev); öbürleri yalnız `IZIN` listesinden. Listede olmayan: `GuvensizGoruntu`."""
    mods: dict | None = None

    def find_class(self, module, name):
        m = self.mods
        if m is not None and module in m:
            if (module, name) not in IZIN_MODEL:
                raise GuvensizGoruntu({"guvensiz": (module, name)})
            obj = m[module]
            for part in name.split("."):
                obj = getattr(obj, part)
            if not (isinstance(obj, type) or callable(obj)) or getattr(obj, "__module__", None) != module:
                raise GuvensizGoruntu({"guvensiz": (module, name)})
            return obj
        if (module, name) not in IZIN:
            raise GuvensizGoruntu({"guvensiz": (module, name)})
        if (module, name) == ("builtins", "getattr"):
            return _guvenli_getattr
        return super().find_class(module, name)


@contextmanager
def swapped_modules(mods: dict):
    """Dump sırasında C Pickler sınıfları `sys.modules[ad]` ile doğrular: kopya geçici olarak oraya konur, çıkışta eskiler geri gelir."""
    def own(n):
        return n == "model_mod" or n == "simkit" or n.startswith("simkit.")
    saved = {n: sys.modules.pop(n) for n in list(sys.modules) if own(n)}
    sys.modules.update(mods)
    try:
        yield
    finally:
        for n in [n for n in sys.modules if own(n)]:
            del sys.modules[n]
        sys.modules.update(saved)


class ZSink:
    """Pickle -> zlib akışı; her sıkışık parça `sink(bytes)` ile hemen dışarı verilir (tek parça `bytes` birikmez)."""

    def __init__(self, sink: Callable[[bytes], Any], level: int = 6):
        self._z = zlib.compressobj(level)
        self._sink = sink
        self.raw = 0
        self.comp = 0
        self.parts = 0

    def write(self, b) -> int:
        n = len(b)
        self.raw += n
        out = self._z.compress(b)
        if out:
            self.comp += len(out)
            self.parts += 1
            self._sink(out)
        return n

    def finish(self) -> None:
        out = self._z.flush()
        if out:
            self.comp += len(out)
            self.parts += 1
            self._sink(out)


class ZSource:
    """zlib akışı <- `next_chunk()` (bytes; bitince b""). `read/readline/readinto/peek`: Unpickler'ın istediği dosya arayüzü."""

    def __init__(self, next_chunk: Callable[[], bytes], ilk: bytes = b""):
        self._next, self._z, self._buf, self._eof, self._ilk = next_chunk, zlib.decompressobj(), bytearray(), False, ilk

    def _fill(self, n: int) -> None:
        while len(self._buf) < n and not self._eof:
            c, self._ilk = (self._ilk or self._next()), b""
            if not c:
                self._buf += self._z.flush()
                self._eof = True
                break
            self._buf += self._z.decompress(bytes(c))

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            self._fill(1 << 62)
            n = len(self._buf)
        else:
            self._fill(n)
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out

    def readinto(self, b) -> int:
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)

    def readline(self) -> bytes:
        while True:
            i = self._buf.find(b"\n")
            if i >= 0 or self._eof:
                break
            self._fill(len(self._buf) + 65536)
        i = self._buf.find(b"\n")
        n = len(self._buf) if i < 0 else i + 1
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out


def dump_session(core, sink: Callable[[bytes], Any], level: int = 6, ek: dict | None = None, pyodide: str | None = None) -> dict:
    """`core` (SessionCore) durumunu akışla yazar; {raw, comp, parts, secs} döner. Adımlar arasında çağrılır (yarım hafta yok).
    İlk parça düz JSON önektir (şema + uyumluluk anahtarı + `ek`): `load_session` pickle'ı açmadan ÖNCE denetler.
    `ek`: JSON'a dönüşebilir ek bilgi (yönetici durumu ile eşleştirme kimliği). `pyodide`: Pyodide sürümü Python'dan okunamıyorsa çağıran verir."""
    t0 = time.perf_counter()
    host = core.host
    model_root = (core.init_cmd or {}).get("model_root")
    onek = json.dumps({"schema": SCHEMA, "anahtar": uyumluluk_anahtari(model_root, pyodide), "ek": ek}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sink(MAGIC + struct.pack(">I", len(onek)) + onek)
    zs = ZSink(sink, level)
    hs = {k: v for k, v in host.__dict__.items() if k not in HOST_SKIP}
    header = {
        "schema": SCHEMA,
        "init": core.init_cmd, "model_version": host.model_version,
        "session": {"target": core.target, "version": core.version, "schedule": core.schedule, "firms_on": core.firms_on, "ff_total": core.ff_total},
        "patched": {k: host.effective.get(k, host.base_values[k]) for k in host.base_values},          # canlı yamalı anahtarlar (taban değerler host durumunda `base_values`); `revert_to` sonrası da dayanıklı
        "host": hs,
    }
    SnapPickler.UNKNOWN.clear()
    with swapped_modules(host._mods):
        p = SnapPickler(zs, protocol=5)
        p.dump(header)
        p.dump(host._W)
    zs.finish()
    return {"raw": zs.raw, "comp": zs.comp, "parts": zs.parts + 1, "secs": time.perf_counter() - t0}      # parça sayısı önek parçasını da içerir


def _onek_oku(next_chunk: Callable[[], bytes]) -> tuple[dict, bytes]:
    """Düz JSON öneki okur (pickle/zlib açılmaz); (önek, artan sıkışık bayt)."""
    buf = bytearray()
    while len(buf) < 8:
        c = next_chunk()
        if not c:
            raise UyumsuzGoruntu({"bicim": ("kisa", "onek")})
        buf += c
    if bytes(buf[:4]) != MAGIC:
        raise UyumsuzGoruntu({"bicim": (bytes(buf[:4]).hex(), MAGIC.hex())})                          # eski (öneksiz) biçim ya da başka dosya
    n = struct.unpack(">I", bytes(buf[4:8]))[0]
    if n > 1 << 20:
        raise UyumsuzGoruntu({"bicim": ("onek_cok_uzun", n)})
    while len(buf) < 8 + n:
        c = next_chunk()
        if not c:
            raise UyumsuzGoruntu({"bicim": ("kisa", "onek")})
        buf += c
    try:
        onek = json.loads(bytes(buf[8:8 + n]).decode("utf-8"))
    except ValueError:
        raise UyumsuzGoruntu({"bicim": ("onek_json", "bozuk")})
    if not isinstance(onek, dict):
        raise UyumsuzGoruntu({"bicim": ("onek", "nesne_degil")})
    return onek, bytes(buf[8 + n:])


def load_session(core, next_chunk: Callable[[], bytes], csv_dir: str | None = None, model_root: str | None = None, pyodide: str | None = None,
                 live_keys: Any = None) -> dict:
    """Taze `core`a (host yok) anlık görüntüyü yükler; `advance()` kaldığı haftadan sürer. {week, secs, ek} döner.
    Uyumluluk anahtarı pickle AÇILMADAN önce denetlenir; uyumsuz görüntü (model özeti, Pyodide sürümü, şema, host yapısı) `UyumsuzGoruntu`, izin listesi dışı sınıf `GuvensizGoruntu` fırlatır
    (hiçbir şey çalıştırılmaz/kurulmaz). Yükleme sırasında `AttributeError`/`KeyError`/`ImportError` de `UyumsuzGoruntu`ya sarılır. `pyodide`: Python'dan okunamıyorsa çağıran verir.
    `live_keys`: yeni sürümün canlı anahtar listesi (taze host bununla kurulur; görüntüdeki eski liste kullanılmaz; None = host kendi `load_live_keys()`ini okur).
    Bozuk/yarım kayıt (`EOFError`, `UnpicklingError`, `zlib.error`, `TypeError`, kesilmiş akış) `UyumsuzGoruntu{bozuk}` olur: B4b hepsini tariften oynatmaya yönlendirir.
    GÜVENLİK: izin listesi yalnız bozuk/eski kayda karşı savunmadır; dışarıdan (paylaşılan dosya) gelen görüntü ASLA açılmamalıdır (yalnız tarif + günlük, `tariften_oynat`)."""
    try:
        return _yukle(core, next_chunk, csv_dir, model_root, pyodide, live_keys)
    except UyumsuzGoruntu:
        raise
    except (EOFError, pickle.UnpicklingError, zlib.error, TypeError, StopIteration, struct.error) as e:
        raise UyumsuzGoruntu({"bozuk": (type(e).__name__, str(e))}) from e


def _yukle(core, next_chunk, csv_dir, model_root, pyodide, live_keys) -> dict:
    from ..sim import livepatch
    t0 = time.perf_counter()
    onek, artan = _onek_oku(next_chunk)
    spec_root = model_root or (None)
    var, simdi = onek.get("anahtar") or {}, uyumluluk_anahtari(spec_root or None, pyodide)
    if onek.get("schema") != SCHEMA:
        raise UyumsuzGoruntu({"schema": (onek.get("schema"), SCHEMA)})
    fark = {k: (var.get(k), simdi[k]) for k in simdi if var.get(k) != simdi[k]}
    if fark:
        raise UyumsuzGoruntu(fark)
    u = SnapUnpickler(ZSource(next_chunk, artan))
    host = None
    try:
        header = u.load()
        spec = dict(header.get("init") or {})
        spec.pop("live_keys", None)                                # eski sürümün listesi geçersiz: yenisi (ya da host'un kendi okuması)
        if live_keys is not None:
            spec["live_keys"] = sorted(live_keys)
        if csv_dir is not None:
            spec["csv_dir"] = csv_dir
        if model_root is not None:
            spec["model_root"] = model_root
        host = core.host_factory(spec)                             # yeni simbuild kopyası + taze dünya (üzerine yazılacak)
        taze = set(host.__dict__) - HOST_SKIP
        eski = set(header["host"])
        if taze - eski or (eski - taze - HOST_TEMBEL):
            raise UyumsuzGoruntu({"host_alanlari": (sorted(eski - taze - HOST_TEMBEL), sorted(taze - eski))})
        u.mods = host._mods
        W = u.load()
        host._W = W
        for k, v in header["host"].items():
            host.__dict__[k] = v                                   # önbellekler dahil: aynı hafta yeniden hesaplama yok
        if header["patched"]:
            livepatch.apply_overrides(host._mods, W, header["patched"])   # canlı yamalar modül küresellerinde: yeniden yaz (W_SYNC boş)
        host._hook()
    except (AttributeError, KeyError, ImportError) as e:
        if host is not None:
            host.close()
        raise UyumsuzGoruntu({"yukleme": (type(e).__name__, str(e))}) from e
    except BaseException:
        if host is not None:
            host.close()
        raise
    core.host, core.init_cmd = host, spec
    s = header["session"]
    core.target, core.version, core.schedule, core.firms_on, core.ff_total = s["target"], s["version"], s["schedule"], s["firms_on"], s["ff_total"]
    return {"week": host.week, "secs": time.perf_counter() - t0, "ek": onek.get("ek")}
