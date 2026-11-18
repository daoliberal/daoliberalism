"""D7: Kurucu için saf açılış hesabı (model koşusu yok): ayarlardan dünya kurulur, birinci haftanın kadro kuralı okunur, hiçbir hafta oynatılmaz.

`world_plan(model_root, overrides)` kısa ömürlü alt süreçte `simbuild.build(Params(**overrides))` + `new_world` + `labor.start_report` çalıştırır
(ana süreç `simkit` içe aktarmaz; sonuç JSON). Aynı ayarlar aynı yanıtı verir: sonuçlar bellekte önbelleklenir.

Yanıt (`/api/world/plan`, bkz. `runs/routes.py`):
  population   {playersPerCity, cities, players, npc, total}
  firms        {total, perCity[], per1000}
  openingStaff {total, perCity[], npcRate}      ilk haftada işe alınacak NPC ve NPC nüfusuna oranı (hafta sonu avans yüzünden biraz düşebilir)
  kinds[]      {kind, label, group, firms, capacity, maxPeople, target, planned, blocked, shortfall, growthCeiling}
                 capacity = işletme başına en büyük kapasite; maxPeople = türün toplam kapasitesi; target = birinci hafta kadro hedefi (kişi, kesirli);
                 planned = işe alınacak kişi (kapasiteyle kırpılmış, tam sayı); blocked = bazı işletmenin hedefi kapasitesini aşıyor; shortfall = aşan kişi toplamı;
                 growthCeiling = büyüme tavanının tabanı (işletme başına kişi): yatırım yolunda (makine-bina yatırımı açıkken) kapasite bunun iki katına yaklaşana dek +2 adımla büyüyebilir
  blockedKinds [kind...]                         tıkanan türler
  housing      {stock[], total, tenants[]}       açılış konut stoku (konut kapalıysa null); tenants şehir başına oyuncu + işe alınacak NPC (stokun karşılaştırıldığı kiracı sayısı)
  scale        {employment, population}          START_EMP ölçeği (1 = türetilmiş) ve nüfus ölçeği (POP_SCALE)
  capMode      "sabit" | "otomatik" | "elle"
  capGrowth    "sabit_taban" | "acilis_kapasitesi" | "yok" (kâr hanelere temettü seçiliyken kapasite tavanı yoktur)
  laborForce   {mode, players, npc, dependents, participation, total}   D9 (A2): işgücü = oyuncu + işgücündeki NPC; mode "tek_kisi" (her NPC işgücünde) | "hane" (D10: seçilen kipten gelir, bağımlı sayısından değil);
                 dependents = işgücü dışı (bakmakla yükümlü) NPC; participation = işgücündeki NPC / NPC nüfusu. Eski istemciler için ek alan (geriye uyumlu)
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import threading
from collections import OrderedDict
from typing import Any

from ..registry.schema import NEW_MEASUREMENT_DECISIONS
from . import labels, nufus

TIMEOUT_S = 60
_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_CACHE_MAX = 32
_LOCK = threading.Lock()
_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SYSTEMROOT")
_GROUP_OUT = {"raw": "hammadde", "make": "imalat", "serv": "hizmet", "log": "lojistik"}
_CAP_MODES = {0: "sabit", 1: "otomatik", 2: "elle"}
_CAP_GROWTH = {0: "sabit_taban", 1: "acilis_kapasitesi", 2: "yok"}      # yok: kâr hanelere temettü seçiliyken tavan kalkar

_CODE = r"""
import ast, json, sys
import simbuild
ov = ast.literal_eval(sys.argv[1])
m = simbuild.build(simbuild.Params(**ov))
W = m.new_world(200, 5, True)
m._modules["simkit.engine"].start_world(W)
sys.stdout.write(json.dumps(m._modules["simkit.labor"].start_report(W), allow_nan=False))
"""


def _run_inproc(model_root: str, overrides: dict[str, Any]) -> dict[str, Any]:
    """B2: `_CODE` ile aynı hesap süreç içinde (tarayıcıda alt süreç yok). Hata ayıklama bayrakları geçici temizlenir; `simbuild.build` kendi kopyasını kurar."""
    from .host import _scrubbed_env
    root = str(model_root)
    if root not in sys.path:
        sys.path.insert(0, root)
    import simbuild
    ov = ast.literal_eval(repr(dict(overrides)))                  # alt sürecin argv yolu gibi: değer biçimi aynı
    m = simbuild.build(simbuild.Params(**ov))
    with _scrubbed_env():
        W = m.new_world(200, 5, True)
        m._modules["simkit.engine"].start_world(W)
        rep = m._modules["simkit.labor"].start_report(W)
    return json.loads(json.dumps(rep, allow_nan=False))


def _run(model_root: str, overrides: dict[str, Any], inproc: bool | None = None) -> dict[str, Any]:
    from ..registry import defaults as _defaults
    if inproc if inproc is not None else _defaults.inproc_mode():
        return _run_inproc(model_root, overrides)
    env = {k: os.environ[k] for k in _ENV_KEEP if k in os.environ}
    env["PYTHONPATH"] = str(model_root)           # MODEL_PARAMS / WEEKLY_CSV bilerek yok: ayarlar yalnız Params ile gider
    env["PYTHONHASHSEED"] = "0"
    try:
        r = subprocess.run([sys.executable, "-P", "-c", _CODE, repr(dict(overrides))], env=env, cwd=str(model_root),
                           capture_output=True, text=True, timeout=TIMEOUT_S)
    except (subprocess.TimeoutExpired, OSError) as e:
        raise RuntimeError("açılış hesabı başlatılamadı ya da zaman aşımına uğradı") from e
    if r.returncode != 0:
        raise RuntimeError("açılış hesabı çalışmadı: " + r.stderr.strip()[-400:])
    return json.loads(r.stdout)


def _shape(rep: dict[str, Any], overrides: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    pop = nufus.totals(overrides, defaults)
    ppc = overrides.get("PLAYERS_PER_CITY", defaults.get("PLAYERS_PER_CITY"))
    total = pop["total"]
    kinds = []
    for r in rep["kinds"]:
        kinds.append({
            "kind": r["kind"], "label": labels.sector_label(r["kind"]), "group": _GROUP_OUT.get(r["group"], "hizmet"),
            "firms": r["firms"], "capacity": r["capacity"], "maxPeople": r["max_people"], "target": r["need"], "planned": r["planned"],
            "blocked": r["blocked_firms"] > 0, "shortfall": r["shortfall"], "growthCeiling": r["growth_ceiling"],
        })
    per_city_players = int(ppc) if isinstance(ppc, (int, float)) else 0
    housing = None
    if rep["housing_stock"] is not None:
        housing = {"stock": rep["housing_stock"], "total": rep["housing_stock_total"],
                   "tenants": [per_city_players + n for n in rep["opening_staff_per_city"]]}
    return {
        "population": {"playersPerCity": ppc, "cities": nufus.CITIES, **pop},
        "firms": {"total": rep["firms_total"], "perCity": rep["firms_per_city"], "per1000": round(1000.0 * rep["firms_total"] / total, 3) if total else None},
        "openingStaff": {"total": rep["opening_staff"], "perCity": rep["opening_staff_per_city"],
                         "npcRate": round(rep["opening_staff"] / pop["npc"], 4) if pop["npc"] else None},
        "kinds": kinds,
        "blockedKinds": list(rep["blocked"]),
        "housing": housing,
        "scale": {"employment": rep["scale"], "population": rep["pop_scale"]},
        "capMode": _CAP_MODES.get(rep["cap_mode"], "sabit"),
        "capGrowth": _CAP_GROWTH.get(rep["cap_growth"], "sabit_taban"),
        "laborForce": {"mode": "hane" if overrides.get("NPC_HOUSE", defaults.get("NPC_HOUSE")) == 1 else "tek_kisi", "players": rep["players_total"], "npc": rep["npc_in_labor_force"],
                       "dependents": rep["npc_dependents"], "participation": rep["npc_participation"], "total": rep["labor_force"]},
    }


def world_plan(model_root: str, overrides: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    """Kurucu ayarlarının (çözümlenmiş model geçersiz kılmaları) açılış planı. `defaults`: model varsayılanları (nüfus toplamı için)."""
    ov = nufus.to_model(overrides, defaults) if nufus.needs_split(overrides) else dict(overrides)
    key = repr(sorted(ov.items(), key=lambda kv: kv[0]))
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
    if hit is None:
        hit = _run(model_root, ov)
        with _LOCK:
            _CACHE[key] = hit
            while len(_CACHE) > _CACHE_MAX:
                _CACHE.popitem(last=False)
    return _shape(hit, overrides, defaults)


DECISIONS = NEW_MEASUREMENT_DECISIONS         # yeni ölçüm sayılan kartların `decision` değerleri: tek tanım registry/schema.py (kayıt yayınındaki `new_measurement` alanı ve web Sonuç süzgeci de buradan gelir)


def new_measurement(settings, overrides: dict[str, Any], defaults: dict[str, Any], later=()) -> dict[str, Any]:
    """A10: koşu D7/D9/D10/D11 kartlarından (dünya kurulumu, NPC hanesi, açılış geçişi, hane geliri, iş piyasası akışları, para devresi, hayalet işletme) en az birini varsayılandan farklı bir değerle kurduysa "yeni ölçüm"dür
    (altınlar ve geçmiş ölçümlerle karşılaştırılamaz). `settings`: kayıt kartları (`decision`, `id`, `params`). `later`: koşu ortasında kabul edilen canlı yamaların model geçersiz kılmaları;
    bir kart sonradan değiştirilip geri alınsa bile koşu ölçüm dışı kalmıştır. {new: bool, settings: [kart kimliği]}."""
    sets = [overrides, *later]
    ids = []
    for s in settings:
        if getattr(s, "decision", None) not in DECISIONS:
            continue
        if any(p in o and o[p] != defaults.get(p) for o in sets for p in s.params):
            ids.append(s.id)
    return {"new": bool(ids), "settings": ids}
