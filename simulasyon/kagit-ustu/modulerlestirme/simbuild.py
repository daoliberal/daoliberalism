#!/usr/bin/env python3
"""simbuild: Params nesnesi ve izole model kurucusu (Aşama P; aynı süreçte farklı konfigürasyonlarla koşular).

AMAÇ: simkit/params.py parametreleri İÇE AKTARMA ANINDA MODEL_PARAMS ortam değişkeninden okur (davranış orijinalle bayt bayt aynı kalsın
diye). `build(Params(...))` her konfigürasyon için `model_mod` + `simkit` paketinin AYRI bir kopyasını kurar (sys.modules'ten geçici
çıkarma, ortam değişkeni geçici yazma, taze içe aktarma, eski modüllerin geri konması). Dönen nesne `model_mod` modülüdür:
`m.run(weeks, n_cities)`, `m.report(...)`, `m.AHIR_KAMU`; iki kopya aynı anda yaşar ve birbirini etkilemez.
ARAYÜZ:
  Params(**geçersiz_kılmalar)   Params.parse("A=1,B=(1,2)")   Params.from_env()   p.with_(A=2)   p.to_env()   p.derived()
  build(params=None) -> model_mod kopyası (params None ise ortamdaki MODEL_PARAMS)
DEĞER BİÇİMİ: bool/int/float/str düz; tuple/list/dict/küme parametre Python değeri (ast.literal_eval). Bilinmeyen anahtar KeyError (aynı).
SINIR: kurulum iş parçacığı güvenli DEĞİL (ortam değişkenini yazar; kilitli); koşular kurulumdan sonra bağımsızdır. Türetilmiş sabit
LOG_CAP içe aktarma sırası gereği orijinaldeki gibi geçersiz kılmadan ÖNCE hesaplanır (davranış korunur).
"""
import os
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
_LOCK = threading.Lock()


def _fmt(v):
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, str):
        return v
    return repr(v)


class Params:
    """Geçersiz kılmaların değişmez kümesi (ad -> değer)."""

    def __init__(self, **overrides):
        self.overrides = dict(overrides)

    @classmethod
    def parse(cls, s):
        """'A=1,B=(1,2)' (MODEL_PARAMS biçimi) -> Params; değerler build() sırasında params.py kurallarıyla çevrilir (burada metin kalır)."""
        o = {}
        depth, cur, parts = 0, [], []
        for ch in s or "":
            depth += ch in "([{"
            depth -= ch in ")]}"
            if ch == "," and depth == 0:
                parts.append("".join(cur))
                cur = []
            else:
                cur.append(ch)
        parts.append("".join(cur))
        for kv in filter(None, parts):
            k, v = kv.split("=", 1)
            o[k] = v
        return cls(**o)

    @classmethod
    def from_env(cls):
        return cls.parse(os.environ.get("MODEL_PARAMS", ""))

    def with_(self, **more):
        d = dict(self.overrides)
        d.update(more)
        return Params(**d)

    def to_env(self):
        """MODEL_PARAMS metni (params.py'nin okuduğu biçim)."""
        return ",".join(f"{k}={_fmt(v)}" for k, v in self.overrides.items())

    def __repr__(self):
        return f"Params({self.to_env()})"

    def __eq__(self, o):
        return isinstance(o, Params) and self.to_env() == o.to_env()

    def __hash__(self):
        return hash(self.to_env())

    def derived(self):
        """Bu konfigürasyonun türetilmiş sabitleri: fiyat çıpaları, pazar marjı, tarifler (kopyalar)."""
        m = build(self)
        p = m._params
        return dict(REF=dict(p.REF_BASE), MM_BASE=p.MM_BASE0, TOPO=list(p.TOPO0),
                    RECIPES={k: (dict(o), dict(i)) for k, (o, i) in p.RECIPES0.items()})


def _purge():
    saved = {n: sys.modules.pop(n) for n in list(sys.modules) if n == "model_mod" or n == "simkit" or n.startswith("simkit.")}
    return saved


def build(params=None):
    """Parametre kümesi için model_mod'un yalıtılmış kopyasını kurar (bkz. modül başlığı)."""
    if params is None:
        params = Params.from_env()
    with _LOCK:
        saved = _purge()
        old_env = os.environ.get("MODEL_PARAMS")
        os.environ["MODEL_PARAMS"] = params.to_env()
        added_path = ROOT not in sys.path
        if added_path:
            sys.path.insert(0, ROOT)
        try:
            import model_mod
            fresh = {n: sys.modules[n] for n in list(sys.modules) if n == "model_mod" or n == "simkit" or n.startswith("simkit.")}
        finally:
            if old_env is None:
                os.environ.pop("MODEL_PARAMS", None)
            else:
                os.environ["MODEL_PARAMS"] = old_env
            for n in [n for n in sys.modules if n == "model_mod" or n == "simkit" or n.startswith("simkit.")]:
                del sys.modules[n]
            sys.modules.update(saved)
            if added_path and ROOT in sys.path:
                sys.path.remove(ROOT)
    model_mod._modules = fresh                          # kopyanın modüllerini canlı tut
    model_mod._params = fresh["simkit.params"]
    return model_mod
